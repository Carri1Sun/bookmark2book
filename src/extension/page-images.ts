import { capturePage, type CaptureSession } from '../../shared/capture-page';
import { createSourceImageService } from '../../shared/source-images';
import { collectionStore } from './database';
import { AppError } from '../../shared/i18n';

function publicPageUrl(raw: string): string {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new AppError('error.pageUrl');
  return url.href;
}

async function normalizeImage(dataUrl: string) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: dataUrl.slice(5, dataUrl.indexOf(';')) }),
  );
  try {
    if (bitmap.width < 180 || bitmap.height < 100 || bitmap.width * bitmap.height > 40_000_000)
      return;
    const scale = Math.min(1, 1000 / bitmap.width, 800 / bitmap.height);
    const width = Math.round(bitmap.width * scale),
      height = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > 400_000) return;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { dataUrl: `data:image/webp;base64,${btoa(binary)}`, width, height };
  } finally {
    bitmap.close();
  }
}

export async function openCaptureTab(): Promise<CaptureSession> {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (tab.id === undefined) throw new AppError('error.pageUnavailable');
  const target = { tabId: tab.id };
  let attached = false;
  const send: CaptureSession['send'] = (method, params) =>
    chrome.debugger.sendCommand(target, method, params) as never;
  const onEvent = (source: chrome.debugger.Debuggee, method: string) => {
    if (source.tabId === tab.id && method === 'Page.javascriptDialogOpening')
      void send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  };
  const close = async () => {
    chrome.debugger.onEvent.removeListener(onEvent);
    if (attached) await chrome.debugger.detach(target).catch(() => {});
    await chrome.tabs.remove(tab.id!).catch(() => {});
  };
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.tabs.update(tab.id, { muted: true });
    await send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
    return {
      send,
      close,
      loadImage: async (raw) => {
        const url = publicPageUrl(raw);
        const { frameTree } = await send<{ frameTree: { frame: { id: string } } }>(
          'Page.getFrameTree',
        );
        const { resource } = await send<{
          resource: { success: boolean; stream?: string; headers?: Record<string, string> };
        }>('Network.loadNetworkResource', {
          frameId: frameTree.frame.id,
          url,
          options: { disableCache: false, includeCredentials: false },
        });
        if (!resource.stream) return;
        const handle = resource.stream;
        try {
          const headers = Object.fromEntries(
            Object.entries(resource.headers || {}).map(([key, value]) => [
              key.toLowerCase(),
              value,
            ]),
          );
          const mime = headers['content-type']?.split(';')[0];
          if (!resource.success || !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime || '')) return;
          let data = '',
            bytes = 0;
          for (;;) {
            const chunk = await send<{ data: string; base64Encoded?: boolean; eof: boolean }>(
              'IO.read',
              { handle, size: 64 * 1024 },
            );
            const binary = chunk.base64Encoded ? atob(chunk.data) : chunk.data;
            bytes += binary.length;
            if (bytes > 4_000_000) return;
            data += binary;
            if (chunk.eof) break;
          }
          return `data:${mime};base64,${btoa(data)}`;
        } finally {
          await send('IO.close', { handle }).catch(() => {});
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export const ensureSourceImages = createSourceImageService({
  book: async (id) => (await collectionStore.books()).find((book) => book.id === id),
  save: collectionStore.saveSourceImages,
  capture: (source) =>
    capturePage(publicPageUrl(source.url), openCaptureTab, normalizeImage, source.imageCandidates),
});
