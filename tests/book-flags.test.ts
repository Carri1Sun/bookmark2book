import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bookFlagsSchema } from '../shared/book-flags';
import { compareBooks } from '../shared/book-order';
import { createCollectionStore } from '../src/extension/database';
import { initStore, saveRecord, updateBookFlags, readRecords } from '../server/store';
import { config } from '../server/config';
import type { Book, Job } from '../shared/types';

const book: Book = {
  id: 'a98378df-c0f6-4d52-950e-b230e2cbba04',
  title: '保存原有内容',
  subtitle: '',
  description: '',
  theme: '',
  palette: 'forest',
  createdAt: '2026-09-20T00:00:00Z',
  readingMinutes: 1,
  chapters: [],
  sources: [
    {
      id: 'article',
      title: '文章',
      url: 'https://example.com/',
      status: 'full',
      summary: '原有简介',
    },
  ],
};
const job: Job = {
  id: 'a98378df-c0f6-4d52-950e-b230e2cbba05',
  status: 'completed',
  progress: 100,
  message: '',
  createdAt: book.createdAt,
  bookmarks: [],
  sources: book.sources,
  palette: 'forest',
  direction: '',
  bookId: book.id,
};

test('flags reject unrelated edits and pin sorting preserves newest-first order within groups', () => {
  assert(bookFlagsSchema.safeParse({ pinned: false }).success);
  for (const invalid of [
    {},
    { pinned: 'true' },
    { title: 'overwrite' },
    { featured: true, sources: [] },
  ]) {
    assert.equal(bookFlagsSchema.safeParse(invalid).success, false);
  }
  const recent = { ...book, id: 'new', createdAt: '2026-09-21T00:00:00Z' };
  const pinned = { ...book, id: 'pin', pinned: true };
  const featured = { ...book, id: 'feature', featured: true, createdAt: '2026-09-19T00:00:00Z' };
  assert.deepEqual(
    [featured, book, pinned, recent].sort(compareBooks).map((item) => item.id),
    ['pin', 'new', book.id, 'feature'],
  );
});

test('extension flags survive reopening, merge concurrent updates, and preserve collection content', async () => {
  const name = `flags-${crypto.randomUUID()}`;
  const store = createCollectionStore(name);
  await store.saveCollection(job, book);
  await Promise.all([
    store.updateBookFlags(book.id, { pinned: true }),
    store.updateBookFlags(book.id, { featured: true }),
  ]);
  const reopened = createCollectionStore(name);
  assert.deepEqual((await reopened.books())[0], { ...book, pinned: true, featured: true });
  await reopened.updateBookFlags(book.id, { pinned: false });
  assert.deepEqual((await store.books())[0], { ...book, pinned: false, featured: true });
  await assert.rejects(store.updateBookFlags('missing', { featured: true }), /未找到/);
  assert.equal((await store.books()).length, 1);
  assert.deepEqual((await store.jobs())[0], job);
});

test('file storage merges concurrent flags, persists cancellation, and rejects invalid edits', async () => {
  const previous = config.dataDir;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmark-flags-test-'));
  config.dataDir = temporary;
  try {
    await initStore();
    await saveRecord('books', book);
    await Promise.all([
      updateBookFlags(book.id, { pinned: true }),
      updateBookFlags(book.id, { featured: true }),
    ]);
    assert.deepEqual((await readRecords<Book>('books'))[0], {
      ...book,
      pinned: true,
      featured: true,
    });
    await updateBookFlags(book.id, { featured: false, pinned: false });
    assert.deepEqual((await readRecords<Book>('books'))[0], {
      ...book,
      pinned: false,
      featured: false,
    });
    await assert.rejects(updateBookFlags('../invalid', { pinned: true }));
    await assert.rejects(updateBookFlags(book.id, { pinned: true, title: 'bad' } as never));
  } finally {
    config.dataDir = previous;
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
