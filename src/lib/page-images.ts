import { api } from './api';
import {
  imagesAreFresh,
  safeImageData,
  type CoverMode,
  type SourceImages,
} from '../../shared/page-images';

const assets = new Map<string, Promise<string | undefined>>();
export function imageData(id: string) {
  let asset = assets.get(id);
  if (!asset) {
    asset = api
      .imageAsset(id)
      .then((image) => (safeImageData(image?.dataUrl) ? image!.dataUrl : undefined))
      .catch(() => {
        assets.delete(id);
        return undefined;
      });
    assets.set(id, asset);
    // Keep a bounded decoded-data cache; IndexedDB / disk remains the source of truth.
    if (assets.size > 160) assets.delete(assets.keys().next().value!);
  }
  return asset;
}
export async function resolveImages(images?: SourceImages) {
  const output: Partial<Record<CoverMode, string>> = {};
  await Promise.all(
    (['preview', 'screenshot'] as const).map(async (kind) => {
      if (images?.[kind]) output[kind] = await imageData(images[kind]!);
    }),
  );
  return output;
}
const pending = new Map<string, Promise<SourceImages>>();
export async function ensureImages(bookId: string, sourceId: string, images?: SourceImages) {
  if (imagesAreFresh(images)) return images!;
  const key = JSON.stringify([bookId, sourceId]);
  let work = pending.get(key);
  if (work && !imagesAreFresh(await work)) {
    pending.delete(key);
    work = undefined;
  }
  if (!work) {
    work = api.sourceImages(bookId, sourceId);
    pending.set(key, work);
    void work.catch(() => pending.delete(key));
    if (pending.size > 600) pending.delete(pending.keys().next().value!);
  }
  return work;
}
