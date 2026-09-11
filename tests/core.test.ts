import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  flattenBookmarks,
  deduplicateBookmarks,
  parseLinks,
  parseBookmarkHtml,
  safeHttpUrl,
} from '../src/lib/bookmarks';
import { isPublicAddress, validatePublicUrl } from '../server/extract';
import {
  createJobSchema,
  validateReferences,
  validateChapterReferences,
  publicSource,
  type Source,
  type Outline,
} from '../shared/types';

test('nested bookmark imports preserve folders and exclude executable URLs', () => {
  const dom = new JSDOM();
  try {
    const html =
      '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>阅读</H3><DL><p><DT><A HREF="https://example.com/one">一</A><DT><H3>设计</H3><DL><p><DT><A HREF="https://example.com/two">二</A><DT><A HREF="javascript:alert(1)">不可执行</A></DL><p></DL><p><DT><A HREF="https://example.org">根目录</A></DL>';
    const nodes = parseBookmarkHtml(html, new dom.window.DOMParser() as unknown as DOMParser);
    const items = flattenBookmarks(nodes);
    assert.equal(items.length, 3);
    assert.equal(items[0]!.folder, '阅读');
    assert.equal(items[1]!.folder, '阅读 / 设计');
    assert.equal(items[2]!.folder, '');
    assert.equal(new Set(items.map((item) => item.id)).size, 3);
  } finally {
    dom.window.close();
  }
});
test('link parsing deduplicates fragments but preserves meaningful query parameters', () => {
  const values = parseLinks(
    'https://example.com/post#one\nhttps://example.com/post#two\nhttps://example.com/post?q=1\nhttps://example.com/post?q=2\nhttps://user:secret@example.com/',
  );
  assert.equal(values.length, 3);
  assert.equal(values[0]!.url, 'https://example.com/post');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(deduplicateBookmarks([...values, ...values]).length, 3);
  assert.equal(parseLinks('https://example.com/broken%escape').length, 1);
});
test('public URL protection rejects private, mapped, credential, and alternate-port destinations', () => {
  for (const address of [
    '127.0.0.1',
    '0.0.0.0',
    '10.0.0.3',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '224.0.0.1',
    '198.18.0.4',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const url of [
    'http://localhost',
    'http://127.1',
    'http://2130706433',
    'http://[::1]',
    'http://internal.local',
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'http://example.com:8787',
  ])
    assert.throws(() => validatePublicUrl(url), url);
  assert.equal(validatePublicUrl('https://example.com/').hostname, 'example.com');
});
test('outline requires real sources and full coverage', () => {
  const sources: Source[] = [
    { id: 's1', title: 'One', url: 'https://example.com/1', status: 'full' },
    { id: 's2', title: 'Two', url: 'https://example.com/2', status: 'excerpt' },
  ];
  const outline: Outline = {
    title: 'Test',
    subtitle: '',
    description: '',
    theme: '',
    chapters: [{ title: 'Chapter', description: '', sourceIds: ['s1', 's2'] }],
  };
  assert.doesNotThrow(() => validateReferences(outline, sources));
  assert.throws(() =>
    validateReferences(
      { ...outline, chapters: [{ ...outline.chapters[0]!, sourceIds: ['s1'] }] },
      sources,
    ),
  );
  assert.throws(() =>
    validateReferences(
      { ...outline, chapters: [{ ...outline.chapters[0]!, sourceIds: ['s1', 's2', 'fake'] }] },
      sources,
    ),
  );
});
test('every paragraph must cite an allowed source; responses strip extracted content', () => {
  const chapter = {
    introduction: '',
    sections: [{ heading: '', paragraphs: [{ text: 'A supported claim', sourceIds: ['s1'] }] }],
    takeaway: '',
  };
  assert.doesNotThrow(() => validateChapterReferences(chapter, ['s1']));
  assert.throws(() => validateChapterReferences(chapter, ['s2']));
  assert.throws(() =>
    validateChapterReferences(
      { ...chapter, sections: [{ heading: '', paragraphs: [{ text: 'Uncited', sourceIds: [] }] }] },
      ['s1'],
    ),
  );
  const source: Source = {
    id: 's1',
    title: '',
    url: 'https://example.com',
    status: 'full',
    content: 'Raw webpage text',
    summary: 'Summary',
  };
  assert.equal(publicSource(source).content, undefined);
  assert.equal(publicSource(source).summary, 'Summary');
});
test('API input rejects excessive selections and malformed URLs', () => {
  const bookmark = { id: '1', title: 'test', url: 'https://example.com' };
  assert.equal(createJobSchema.safeParse({ bookmarks: [bookmark] }).success, true);
  assert.equal(createJobSchema.safeParse({ bookmarks: [] }).success, false);
  assert.equal(
    createJobSchema.safeParse({ bookmarks: [{ ...bookmark, url: 'javascript:alert(1)' }] }).success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({ bookmarks: Array.from({ length: 501 }, () => bookmark) }).success,
    false,
  );
});
