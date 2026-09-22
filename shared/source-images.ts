import { AppError } from './i18n';
import type { Book, Source } from './types';
import {
  createImageQueue,
  imagesAreFresh,
  safeImageData,
  type ImageAsset,
  type SourceImages,
} from './page-images';
import type { CapturedImages } from './capture-page';

export function createSourceImageService(deps: {
  book(id: string): Promise<Book | undefined>;
  capture(source: Source): Promise<CapturedImages>;
  save(id: string, sourceId: string, images: SourceImages, assets: ImageAsset[]): Promise<void>;
}) {
  const queue = createImageQueue(2);
  const pending = new Map<string, Promise<SourceImages>>();
  return (bookId: string, sourceId: string): Promise<SourceImages> => {
    const key = JSON.stringify([bookId, sourceId]);
    const existing = pending.get(key);
    if (existing) return existing;
    const work = queue(async () => {
      const book = await deps.book(bookId);
      const source = book?.sources.find((source) => source.id === sourceId);
      if (!source) throw new AppError('error.bookNotFound');
      if (imagesAreFresh(source.images)) return source.images!;
      const captured = await deps.capture(source).catch(() => ({}) as CapturedImages);
      const images: SourceImages = { ...source.images, attemptedAt: new Date().toISOString() };
      const assets: ImageAsset[] = [];
      for (const kind of ['preview', 'screenshot'] as const) {
        const image = captured[kind];
        if (!image || !safeImageData(image.dataUrl) || image.dataUrl.length > 600_000) continue;
        const asset = { ...image, id: crypto.randomUUID() };
        assets.push(asset);
        images[kind] = asset.id;
      }
      await deps.save(bookId, sourceId, images, assets);
      return images;
    });
    pending.set(key, work);
    void work.finally(() => pending.delete(key)).catch(() => {});
    return work;
  };
}
