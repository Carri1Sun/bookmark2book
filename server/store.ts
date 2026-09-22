import { AppError } from '../shared/i18n';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import type { Book, Job } from '../shared/types';
import { z } from 'zod';
import { applyBookFlags, bookFlagsSchema, type BookFlags } from '../shared/book-flags';
import type { ImageAsset, SourceImages } from '../shared/page-images';

const flagUpdates = new Map<string, Promise<Book>>();
export async function updateBookFlags(id: string, input: BookFlags): Promise<Book> {
  const flags = bookFlagsSchema.parse(input);
  return updateBook(id, (book) => applyBookFlags(book, flags));
}
export async function readBook(id: string): Promise<Book> {
  z.string().uuid().parse(id);
  return JSON.parse(
    await fs.readFile(path.join(config.dataDir, 'books', `${id}.json`), 'utf8'),
  ) as Book;
}
export async function updateBook(
  id: string,
  mutate: (book: Book) => Book | Promise<Book>,
): Promise<Book> {
  z.string().uuid().parse(id);
  // Serialize partial updates so simultaneous pin/feature requests retain both fields.
  const update = (flagUpdates.get(id) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const updated = await mutate(await readBook(id));
      await saveRecord('books', updated);
      return updated;
    });
  flagUpdates.set(id, update);
  try {
    return await update;
  } finally {
    if (flagUpdates.get(id) === update) flagUpdates.delete(id);
  }
}

export async function initStore() {
  await Promise.all(
    ['jobs', 'books', 'images'].map((name) =>
      fs.mkdir(path.join(config.dataDir, name), { recursive: true, mode: 0o700 }),
    ),
  );
}
export async function saveRecord(kind: 'jobs' | 'books', record: Job | Book) {
  const target = path.join(config.dataDir, kind, `${record.id}.json`);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await fs.rename(temporary, target);
}
export async function readRecords<T>(kind: 'jobs' | 'books'): Promise<T[]> {
  const dir = path.join(config.dataDir, kind);
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.json'));
  const results = await Promise.allSettled(
    names.map(async (name) => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as T),
  );
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}
export async function removeBook(id: string) {
  if (!/^[a-f\d-]{36}$/.test(id)) throw new AppError('error.invalidBookId');
  // Join the same per-book queue used by flags and cover backfills.
  const deletion = (flagUpdates.get(id) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const book = await readBook(id);
      await fs.unlink(path.join(config.dataDir, 'books', `${id}.json`));
      await Promise.all(
        book.sources
          .flatMap((source) => [source.images?.preview, source.images?.screenshot])
          .filter((id): id is string => Boolean(id))
          .map((id) => fs.unlink(imagePath(id)).catch(() => {})),
      );
      return book;
    });
  flagUpdates.set(id, deletion);
  try {
    await deletion;
  } finally {
    if (flagUpdates.get(id) === deletion) flagUpdates.delete(id);
  }
}

function imagePath(id: string) {
  z.string().uuid().parse(id);
  return path.join(config.dataDir, 'images', `${id}.json`);
}
export async function readImageAsset(id: string): Promise<ImageAsset> {
  return JSON.parse(await fs.readFile(imagePath(id), 'utf8')) as ImageAsset;
}
export async function saveSourceImages(
  id: string,
  sourceId: string,
  images: SourceImages,
  assets: ImageAsset[],
) {
  const obsolete: string[] = [];
  await updateBook(id, async (book) => {
    const source = book.sources.find((source) => source.id === sourceId);
    if (!source) throw new AppError('error.bookNotFound');
    await Promise.all(
      assets.map((asset) =>
        fs.writeFile(imagePath(asset.id), JSON.stringify(asset), { mode: 0o600 }),
      ),
    );
    const previous = source.images;
    source.images = images;
    // New assets are persisted before the atomic book replacement.
    for (const kind of ['preview', 'screenshot'] as const)
      if (previous?.[kind] && previous[kind] !== images[kind]) obsolete.push(previous[kind]!);
    return book;
  });
  await Promise.all(obsolete.map((id) => fs.unlink(imagePath(id)).catch(() => {})));
}
