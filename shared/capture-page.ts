import { readImageCandidates, type ImageAsset, type ImageCandidate } from './page-images';

export interface CaptureSession {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  loadImage(url: string): Promise<string | undefined>;
  close(): Promise<void>;
}
export type CapturedImages = Partial<Record<'preview' | 'screenshot', Omit<ImageAsset, 'id'>>>;

export async function capturePage(
  url: string,
  open: () => Promise<CaptureSession>,
  normalize: (dataUrl: string) => Promise<Omit<ImageAsset, 'id'> | undefined>,
  candidates: ImageCandidate[] = [],
): Promise<CapturedImages> {
  const session = await open();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const signal = controller.signal;
  // CDP commands have no built-in timeout. Race them, then always close our target.
  async function bounded<T>(action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let abort: () => void;
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          abort = () => reject(new DOMException('Capture timed out', 'AbortError'));
          signal.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener('abort', abort!);
    }
  }
  const send = <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) =>
    bounded(() => session.send<T>(method, params));
  const result: CapturedImages = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const navigation = await send<{ errorText?: string }>('Page.navigate', { url });
    if (navigation.errorText) return result;
    const start = Date.now();
    // Navigation can destroy the about:blank execution context after Page.navigate
    // resolves. Observe the new document before creating a promise inside it.
    while (true) {
      const document = await send<{ result: { value?: boolean } }>('Runtime.evaluate', {
        expression:
          "location.href !== 'about:blank' && document.readyState !== 'loading' && Boolean(document.body)",
        returnByValue: true,
        timeout: 1000,
      }).catch(() => undefined);
      if (document?.result.value) break;
      if (Date.now() - start > 12000 || signal.aborted) return result;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    // Wait for the actual document and above-the-fold images; never wait for network idle.
    const ready = await send<{ result: { value?: boolean } }>('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const started = Date.now();
        const check = () => {
          const loaded = location.href !== 'about:blank' && document.readyState !== 'loading' && document.body;
          const images = [...document.images].filter(image => image.getBoundingClientRect().top < 800);
          if (loaded && ((images.every(image => image.complete) && Date.now() - started > 1200) || Date.now() - started > 10000)) {
            Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 900))]).then(() => resolve(true));
          } else if (Date.now() - started > 12000) resolve(false);
          else setTimeout(check, 150);
        }; check();
      })`,
      awaitPromise: true,
      returnByValue: true,
      timeout: 14000,
    });
    if (!ready.result.value) return result;
    const metadata = await send<{ result: { value?: ImageCandidate[] } }>('Runtime.evaluate', {
      expression: `(() => { const __name = (fn) => fn; return (${readImageCandidates.toString()})(document, location.href); })()`,
      returnByValue: true,
      timeout: 1500,
    }).catch(() => undefined);
    const merged = [...(metadata?.result.value || []), ...candidates];
    const urls = [
      ...new Set(merged.sort((a, b) => b.score - a.score).map((item) => item.url)),
    ].slice(0, 4);
    const shot = await send<{ data: string }>('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 78,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 1280, height: 800, scale: 0.75 },
    });
    result.screenshot = { dataUrl: `data:image/jpeg;base64,${shot.data}`, width: 960, height: 600 };
    for (const candidate of urls) {
      try {
        const image = await bounded(() => session.loadImage(candidate));
        if (image) result.preview = await bounded(() => normalize(image));
        if (result.preview) break;
      } catch {
        if (signal.aborted) break;
      }
    }
    return result;
  } catch {
    // Rendering or a single bad publisher image must never break the collection.
    return result;
  } finally {
    clearTimeout(timer);
    await session.close();
  }
}
