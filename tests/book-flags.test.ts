import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyBookFlags, bookFlagsSchema } from '../shared/book-flags';
import { featuredMedals } from '../shared/featured-medals';
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

const submission = {
  editorial: { action: 'submit', reason: '值得分享', introduction: '合辑介绍' },
} as const;

async function checkEditorialLifecycle(
  update: (flags: import('../shared/book-flags').BookFlags) => Promise<Book>,
  read: () => Promise<Book>,
) {
  await assert.rejects(update({ featuredMedal: 'aurora' }), /无法佩戴/);
  await assert.rejects(update({ editorial: { action: 'approve' } }), /没有待审核/);
  await Promise.all([update({ pinned: true }), update(submission)]);
  const pending = await read();
  assert.equal(pending.pinned, true);
  assert.equal(pending.featured, false);
  assert.equal(pending.editorial?.status, 'pending');
  assert.equal(pending.editorial?.reason, '值得分享');
  assert.equal(pending.editorial?.introduction, '合辑介绍');
  assert(Number.isFinite(Date.parse(pending.editorial!.submittedAt)));
  assert.deepEqual(pending.sources, book.sources);
  await assert.rejects(update(submission), /正在审核/);
  const approved = await update({ editorial: { action: 'approve' } });
  assert.equal(approved.featured, true);
  assert.equal(approved.editorial?.status, 'approved');
  assert.equal(approved.editorial?.introduction, '合辑介绍');
  for (const medal of featuredMedals) {
    await update({ featuredMedal: medal.id });
    assert.equal((await read()).featuredMedal, medal.id);
  }
  await Promise.all([update({ pinned: false }), update({ featuredMedal: 'sparkles' })]);
  assert.equal((await read()).featuredMedal, 'sparkles');
  assert.equal((await read()).pinned, false);
  assert.deepEqual((await read()).sources, book.sources);
  await update({ editorial: { action: 'cancel' }, pinned: false });
  assert.deepEqual(await read(), { ...book, pinned: false, featured: false });
  await update({ editorial: { action: 'submit', reason: '', introduction: '' } });
  await update({ editorial: { action: 'cancel' } });
  await assert.rejects(update({ editorial: { action: 'approve' } }), /没有待审核/);
  assert.deepEqual(await read(), { ...book, pinned: false, featured: false });
}

test('editorial actions reject direct feature edits and preserve legacy featured books', () => {
  for (const input of [
    { featured: true },
    { featuredMedal: 'invalid' },
    { featuredMedal: 'orbit' },
    { featuredMedal: 'corona' },
    { editorial: { action: 'submit' } },
    { editorial: { action: 'submit', reason: 'a'.repeat(2001), introduction: '' } },
    { editorial: { action: 'submit', reason: '', introduction: 'a'.repeat(1001) } },
    { editorial: { action: 'approve', status: 'approved' } },
  ])
    assert.equal(bookFlagsSchema.safeParse(input).success, false);
  const legacy = { ...book, featured: true };
  assert.equal(applyBookFlags(legacy, { pinned: true }).featured, true);
  assert.equal(applyBookFlags(legacy, { editorial: { action: 'cancel' } }).featured, false);
});

test('extension persists editorial lifecycle across reopening and merges concurrent pin updates', async () => {
  const name = `flags-${crypto.randomUUID()}`;
  const store = createCollectionStore(name);
  await store.saveCollection(job, book);
  const reopened = createCollectionStore(name);
  await checkEditorialLifecycle(
    (flags) => store.updateBookFlags(book.id, flags),
    async () => (await reopened.books())[0]!,
  );
  await assert.rejects(store.updateBookFlags('missing', submission), /未找到/);
  assert.deepEqual((await store.jobs())[0], job);
});

test('file storage persists editorial lifecycle and rejects unrelated edits', async () => {
  const previous = config.dataDir;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmark-flags-test-'));
  config.dataDir = temporary;
  try {
    await initStore();
    await saveRecord('books', book);
    await checkEditorialLifecycle(
      (flags) => updateBookFlags(book.id, flags),
      async () => (await readRecords<Book>('books'))[0]!,
    );
    await assert.rejects(updateBookFlags('../invalid', { pinned: true }));
    await assert.rejects(updateBookFlags(book.id, { pinned: true, title: 'bad' } as never));
  } finally {
    config.dataDir = previous;
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
