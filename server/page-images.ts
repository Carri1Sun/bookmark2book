import { chromium } from 'playwright';
import sharp from 'sharp';
import { fetch } from 'undici';
import { JSDOM } from 'jsdom';
import { productId } from '../shared/branding';
import { capturePage, type CaptureSession } from '../shared/capture-page';
import { createSourceImageService } from '../shared/source-images';
import { readBook, saveSourceImages } from './store';
import { publicDispatcher, validatePublicUrl } from './extract';

// Every browser HTTP request uses the same public, DNS-pinned transport as text
// extraction. Browser routing alone with a DNS precheck would allow rebinding.
export async function fetchImageResource(
  raw: string,
  signal: AbortSignal,
  maxBytes = 8_000_000,
  consume?: (bytes: number) => void,
) {
  let url = validatePublicUrl(raw);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetch(url, {
      dispatcher: publicDispatcher,
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': `Mozilla/5.0 ${productId}/1.0`, Accept: '*/*' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 4) throw new Error('Invalid resource redirect');
      url = validatePublicUrl(new URL(location, url).href);
      continue;
    }
    try {
      if (Number(response.headers.get('content-length')) > maxBytes)
        throw new Error('Resource too large');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body!) {
        size += chunk.byteLength;
        consume?.(chunk.byteLength);
        if (size > maxBytes) throw new Error('Resource too large');
        chunks.push(chunk);
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.concat(chunks),
        url: url.href,
      };
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  }
  throw new Error('Resource redirect limit');
}

async function loadImage(raw: string): Promise<string | undefined> {
  const signal = AbortSignal.timeout(6000);
  const response = await fetchImageResource(raw, signal, 4_000_000);
  const mime = response.headers['content-type']?.split(';')[0];
  if (response.status !== 200 || !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime || '')) return;
  return `data:${mime};base64,${response.body.toString('base64')}`;
}

function redirectedBody(
  response: Awaited<ReturnType<typeof fetchImageResource>>,
  initialUrl: string,
) {
  if (response.url === initialUrl) return response.body;
  const contentType = response.headers['content-type'] || '';
  // Playwright continues browser redirects without invoking the route again.
  // Follow them in the pinned transport, then preserve relative HTML/CSS URLs.
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    const dom = new JSDOM(response.body.toString('utf8'), { url: response.url });
    try {
      const doc = dom.window.document;
      const base = doc.querySelector('base[href]') || doc.createElement('base');
      base.setAttribute(
        'href',
        new URL(base.getAttribute('href') || response.url, response.url).href,
      );
      doc.head.prepend(base);
      return Buffer.from(dom.serialize());
    } finally {
      dom.window.close();
    }
  }
  if (/text\/css/i.test(contentType)) {
    const absolute = (value: string) => {
      try {
        return new URL(value.trim(), response.url).href.replaceAll('"', '%22');
      } catch {
        return value;
      }
    };
    return Buffer.from(
      response.body
        .toString('utf8')
        .replace(
          /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
          (_, _quote, value: string) => `url("${absolute(value)}")`,
        )
        .replace(
          /(@import\s+)(['"])(.*?)\2/gi,
          (_, prefix, _quote, value: string) => `${prefix}"${absolute(value)}"`,
        ),
    );
  }
  return response.body;
}

async function normalizeImage(dataUrl: string) {
  const input = Buffer.from(dataUrl.split(',')[1] || '', 'base64');
  const image = sharp(input, { limitInputPixels: 40_000_000, animated: false });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width < 180 || metadata.height < 100) return;
  const { data, info } = await image
    .rotate()
    .resize({ width: 1000, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  if (data.length > 400_000) return;
  return {
    dataUrl: `data:image/webp;base64,${data.toString('base64')}`,
    width: info.width,
    height: info.height,
  };
}

async function openCaptureBrowser(): Promise<CaptureSession> {
  const browser = await chromium.launch({ headless: true, timeout: 15000 });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    const controller = new AbortController();
    let requests = 0,
      bytes = 0;
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        if (++requests > 180 || bytes > 35_000_000 || !['GET', 'HEAD'].includes(request.method())) {
          await route.abort();
          return;
        }
        const response = await fetchImageResource(
          request.url(),
          AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
          8_000_000,
          (size) => {
            bytes += size;
            if (bytes > 35_000_000) throw new Error('Page resource budget exceeded');
          },
        );
        // Bodies are already decompressed; never replay cookies into the renderer.
        const headers = { ...response.headers };
        for (const key of ['content-encoding', 'content-length', 'set-cookie', 'transfer-encoding'])
          delete headers[key];
        await route.fulfill({
          status: response.status,
          headers,
          body: redirectedBody(response, request.url()),
        });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    page.on('dialog', (dialog) => void dialog.dismiss().catch(() => {}));
    context.on('page', (popup) => {
      if (popup !== page) void popup.close().catch(() => {});
    });
    const cdp = await context.newCDPSession(page);
    return {
      send: (method, params) => cdp.send(method as never, params as never) as never,
      loadImage,
      close: async () => {
        controller.abort();
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export const ensureSourceImages = createSourceImageService({
  book: readBook,
  save: saveSourceImages,
  capture: async (source) => {
    validatePublicUrl(source.url);
    const images = await capturePage(
      source.url,
      openCaptureBrowser,
      normalizeImage,
      source.imageCandidates,
    ).catch(() => ({}));
    // Static publisher previews still work if Chromium has not been installed.
    if (!('preview' in images)) {
      for (const candidate of source.imageCandidates || []) {
        const preview = await loadImage(candidate.url)
          .then((data) => (data ? normalizeImage(data) : undefined))
          .catch(() => undefined);
        if (preview) return { ...images, preview };
      }
    }
    return images;
  },
});
