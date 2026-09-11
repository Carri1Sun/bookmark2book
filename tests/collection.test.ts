import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleCollection } from '../shared/collection';
import { writeJobSchema, type Outline, type Source } from '../shared/types';

const sources: Source[] = [
  {
    id: 's1',
    title: 'Original one',
    url: 'https://example.com/one',
    status: 'full',
    content: 'Full private extraction',
    summary: 'AI introduction one',
  },
  {
    id: 's2',
    title: 'Original two',
    url: 'https://example.com/two',
    status: 'excerpt',
    content: 'Full extraction two',
    summary: 'AI introduction two',
  },
];
const outline: Outline = {
  title: 'Collection',
  subtitle: '',
  description: '',
  theme: '',
  chapters: [{ title: 'Articles', description: '', sourceIds: ['s1', 's2'] }],
};
const metadata = { id: 'collection', palette: 'forest' as const, createdAt: '2026-09-11' };
test('saving retains edited introductions and order, preserves original URLs, and stores no generated chapters or raw text', () => {
  const input = writeJobSchema.parse({
    outline,
    articles: [
      {
        id: 's2',
        title: 'Edited two',
        summary: 'Revised introduction',
        url: 'https://unexpected.example',
      },
      { id: 's1', title: 'Original one', summary: 'AI introduction one' },
    ],
  });
  const book = assembleCollection(metadata, input.outline, sources, input.articles);
  assert.deepEqual(
    book.sources.map((s) => s.id),
    ['s2', 's1'],
  );
  assert.equal(book.sources[0]!.title, 'Edited two');
  assert.equal(book.sources[0]!.summary, 'Revised introduction');
  assert.equal(book.sources[0]!.url, sources[1]!.url);
  assert.equal(book.sources[0]!.status, 'excerpt');
  assert.deepEqual(book.chapters, []);
  assert(book.sources.every((s) => !('content' in s)));
  assert.equal(sources[1]!.summary, 'AI introduction two');
  assert.equal(assembleCollection(metadata, outline, sources).sources.length, 2);
});
test('saving rejects omitted, duplicated, invented articles and blank introductions', () => {
  const edits = sources.map((s) => ({ id: s.id, title: s.title, summary: s.summary! }));
  for (const invalid of [
    edits.slice(0, 1),
    [edits[0]!, edits[0]!],
    [edits[0]!, { ...edits[1]!, id: 'unknown' }],
    [edits[0]!, { ...edits[1]!, summary: ' ' }],
  ]) {
    assert.throws(() => assembleCollection(metadata, outline, sources, invalid));
  }
});
