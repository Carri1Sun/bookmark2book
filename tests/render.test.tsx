import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookDocument } from '../src/components/BookDocument';
import { demoBooks } from '../src/lib/demo';
import { groupArticlesByFolder } from '../src/lib/collection';
import type { Book } from '../shared/types';

test('article folders group under the common root and keep first-seen order', () => {
  const groups = groupArticlesByFolder([
    { id: 'a', title: 'A', introduction: '', url: null, folder: 'AI / 读材料' },
    { id: 'b', title: 'B', introduction: '', url: null, folder: 'AI' },
    { id: 'c', title: 'C', introduction: '', url: null, folder: 'AI / 读材料 / 评估' },
    { id: 'd', title: 'D', introduction: '', url: null, folder: 'AI / 写代码' },
    { id: 'e', title: 'E', introduction: '', url: null, folder: 'AI / 读材料' },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.folder, group.articles.map((article) => article.id)]),
    [
      ['读材料', ['a', 'e']],
      ['', ['b']],
      ['读材料 / 评估', ['c']],
      ['写代码', ['d']],
    ],
  );
});

test('collections render one notebook and introduction per source without legacy long-form content', () => {
  const book: Book = {
    ...demoBooks[0]!,
    isDemo: false,
    title: '<script>alert("x")</script>',
    description: 'Obsolete collection foreword',
    sources: [
      {
        id: 's1',
        title: '<script>Unsafe title</script>',
        url: 'https://example.com/one',
        status: 'full',
        summary: '<img src=x onerror=alert(1)>',
        folder: 'AI / 评估',
      },
      {
        id: 's2',
        title: 'Second article',
        url: 'javascript:alert(1)',
        status: 'unavailable',
        summary: 'Introduction based on metadata.',
        folder: 'AI / 评估',
      },
    ],
  };
  const output = renderToStaticMarkup(<BookDocument book={book} />);
  const dom = new JSDOM(output);
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('.article-card').length, 2);
    assert.equal(doc.querySelectorAll('.notebook-cover h2').length, 2);
    assert.equal(doc.querySelectorAll('.article-introduction').length, 2);
    assert.equal(doc.querySelector('.collection-title')?.textContent, book.title);
    assert.equal(doc.querySelector('.article-introduction')?.textContent, book.sources[0]!.summary);
    assert.equal(doc.querySelector('script, img'), null);
    assert.equal(doc.querySelector('a[href^="javascript:"]'), null);
    assert.equal(doc.querySelector('#article-s1 a')?.getAttribute('href'), book.sources[0]!.url);
    assert.equal(doc.querySelector('#article-s2 a'), null);
    assert.equal(doc.querySelectorAll('.article-group-title').length, 0);
    assert.equal(doc.querySelectorAll('.article-group').length, 1);
    assert(!output.includes('Obsolete collection foreword'));
    assert(!output.includes(book.chapters[0]!.sections[0]!.paragraphs[0]!.text));
    assert.equal(doc.querySelector('.reading-chapter, .book-title-page, .book-toc'), null);
  } finally {
    dom.window.close();
  }
});
