import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import type { Book, Job } from '../shared/types';
import { z } from 'zod';
import { bookFlagsSchema, type BookFlags } from '../shared/book-flags';

const flagUpdates = new Map<string, Promise<Book>>();
export async function updateBookFlags(id: string, input: BookFlags): Promise<Book> {
  z.string().uuid().parse(id);
  const flags = bookFlagsSchema.parse(input);
  // Serialize partial updates so simultaneous pin/feature requests retain both fields.
  const update = (flagUpdates.get(id) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const filename = path.join(config.dataDir, 'books', `${id}.json`);
      const book = JSON.parse(await fs.readFile(filename, 'utf8')) as Book;
      const updated = { ...book, ...flags };
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
    ['jobs', 'books'].map((name) =>
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
  if (!/^[a-f\d-]{36}$/.test(id)) throw new Error('无效文集编号');
  await fs.unlink(path.join(config.dataDir, 'books', `${id}.json`));
}
