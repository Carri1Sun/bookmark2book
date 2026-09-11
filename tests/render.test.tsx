import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookDocument } from '../src/components/BookDocument';
import { demoBooks } from '../src/lib/demo';
import type { Book } from '../shared/types';

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
      },
      {
        id: 's2',
        title: 'Second article',
        url: 'javascript:alert(1)',
        status: 'unavailable',
        summary: 'Introduction based on metadata.',
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
    assert(!output.includes('Obsolete collection foreword'));
    assert(!output.includes(book.chapters[0]!.sections[0]!.paragraphs[0]!.text));
    assert.equal(doc.querySelector('.reading-chapter, .book-title-page, .book-toc'), null);
  } finally {
    dom.window.close();
  }
});
