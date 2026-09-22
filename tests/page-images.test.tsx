import 'fake-indexeddb/auto';
import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { readImageCandidates, safeImageData, type SourceImages } from '../shared/page-images';
import { createSourceImageService } from '../shared/source-images';
import { capturePage, type CaptureSession } from '../shared/capture-page';
import { createCollectionStore } from '../src/extension/database';
import { BookDocument } from '../src/components/BookDocument';
import type { Book } from '../shared/types';
import { openCaptureTab } from '../src/extension/page-images';
import { fetchImageResource } from '../server/page-images';
import { publicDispatcher } from '../server/extract';
import { MockAgent } from 'undici';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config';
import {
  initStore,
  saveRecord,
  saveSourceImages,
  updateBookFlags,
  readBook,
  removeBook,
  readImageAsset,
} from '../server/store';

const preview = 'data:image/webp;base64,UklGRg==';
const screenshot = 'data:image/jpeg;base64,/9j/';

test('native capture only owns a new inactive muted tab and always cleans up failed attachments', async () => {
  const original = globalThis.chrome;
  const calls: unknown[] = [];
  let fail = false;
  const listeners = new Set<unknown>();
  globalThis.chrome = {
    tabs: {
      create: async (input: unknown) => {
        calls.push(['create', input]);
        return { id: 741 };
      },
      update: async (id: number, input: unknown) => {
        calls.push(['update', id, input]);
      },
      remove: async (id: number) => {
        calls.push(['remove', id]);
      },
    },
    debugger: {
      attach: async (target: unknown) => {
        calls.push(['attach', target]);
        if (fail) throw new Error('permission denied');
      },
      detach: async (target: unknown) => {
        calls.push(['detach', target]);
      },
      sendCommand: async () => ({}),
      onEvent: {
        addListener: (fn: unknown) => listeners.add(fn),
        removeListener: (fn: unknown) => listeners.delete(fn),
      },
    },
  } as unknown as typeof chrome;
  try {
    const session = await openCaptureTab();
    assert.deepEqual(calls.slice(0, 3), [
      ['create', { url: 'about:blank', active: false }],
      ['attach', { tabId: 741 }],
      ['update', 741, { muted: true }],
    ]);
    await session.close();
    assert.deepEqual(calls.slice(-2), [
      ['detach', { tabId: 741 }],
      ['remove', 741],
    ]);
    assert.equal(listeners.size, 0);
    fail = true;
    await assert.rejects(openCaptureTab, /permission denied/);
    assert.deepEqual(calls.at(-1), ['remove', 741]);
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.chrome = original;
  }
});

test('the image and renderer transport refuses private, credentialed, and non-HTTP resources before connecting', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://192.168.1.1/',
    'http://localhost/',
    'file:///etc/passwd',
    'https://user:secret@example.com/',
  ]) {
    await assert.rejects(fetchImageResource(url, new AbortController().signal));
  }
});

test('redirects stay in the pinned transport and cannot send the renderer to a private address', async (t) => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  t.mock.method(publicDispatcher, 'dispatch', mock.dispatch.bind(mock));
  const origin = mock.get('https://public.example');
  origin
    .intercept({ path: '/private' })
    .reply(302, '', { headers: { location: 'http://127.0.0.1/internal' } });
  origin
    .intercept({ path: '/start' })
    .reply(302, '', { headers: { location: '/final/image.png' } });
  origin
    .intercept({ path: '/final/image.png' })
    .reply(200, 'fixture', { headers: { 'content-type': 'image/png' } });
  try {
    await assert.rejects(
      fetchImageResource('https://public.example/private', new AbortController().signal),
      /./,
    );
    const response = await fetchImageResource(
      'https://public.example/start',
      new AbortController().signal,
    );
    assert.equal(response.url, 'https://public.example/final/image.png');
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), 'fixture');
    mock.assertNoPendingInterceptors();
  } finally {
    await mock.close();
  }
});
const book = (): Book => ({
  id: crypto.randomUUID(),
  title: 'Image collection',
  subtitle: '',
  description: '',
  theme: '',
  palette: 'forest',
  createdAt: new Date().toISOString(),
  chapters: [],
  readingMinutes: 1,
  sources: [
    {
      id: 'one',
      title: 'One page',
      url: 'https://example.com',
      status: 'full',
      summary: 'A useful page.',
    },
  ],
});

test('preview ranking resolves publisher metadata, responsive and lazy images, excluding small tracking and executable URLs', () => {
  const dom = new JSDOM(`<meta property="og:image" content="/share.webp">
    <meta name="twitter:image" content="https://cdn.example.com/social.jpg">
    <script type="application/ld+json">{"@graph":[{"image":{"url":"/structured.png"}}]}</script>
    <main><img data-src="/hero.jpg" width="1200" height="700">
    <img src="/small.jpg" srcset="/medium.jpg 600w, /large.jpg 1200w" width="900" height="600"></main>
    <img src="/logo.png" alt="site logo" width="500" height="500">
    <img src="/pixel.gif" width="1" height="1"><meta property="og:image" content="javascript:alert(1)">
    <meta property="og:image" content="https://user:password@example.com/private.jpg">`);
  try {
    const candidates = readImageCandidates(dom.window.document, 'https://example.com/page');
    assert.deepEqual(
      candidates.map((item) => item.url),
      [
        'https://example.com/share.webp',
        'https://cdn.example.com/social.jpg',
        'https://example.com/structured.png',
        'https://example.com/hero.jpg',
        'https://example.com/large.jpg',
      ],
    );
    assert.equal(safeImageData('data:image/svg+xml;base64,AAAA'), false);
    assert.equal(safeImageData('https://example.com/remote.jpg'), false);
  } finally {
    dom.window.close();
  }
});

test('source image work is deduplicated, bounded and independently caches both images, including failed attempts', async () => {
  const saved = book();
  saved.sources = Array.from({ length: 7 }, (_, i) => ({ ...saved.sources[0]!, id: String(i) }));
  let active = 0,
    maximum = 0,
    calls = 0;
  const ensure = createSourceImageService({
    book: async () => saved,
    capture: async (source) => {
      calls++;
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (source.id === '6') throw new Error('publisher is unavailable');
      return {
        preview: { dataUrl: preview, width: 1000, height: 600 },
        screenshot: { dataUrl: screenshot, width: 960, height: 600 },
      };
    },
    save: async (_, id, images, assets) => {
      saved.sources.find((source) => source.id === id)!.images = images;
      assert(assets.every((asset) => safeImageData(asset.dataUrl)));
    },
  });
  const first = ensure(saved.id, '0');
  assert.equal(first, ensure(saved.id, '0'));
  await Promise.all([first, ...saved.sources.map((source) => ensure(saved.id, source.id))]);
  assert.equal(maximum, 2);
  assert.equal(calls, 7);
  assert(saved.sources[0]!.images?.preview);
  assert(saved.sources[0]!.images?.screenshot);
  assert(saved.sources[6]!.images?.attemptedAt);
  assert.equal(saved.sources[6]!.images?.preview, undefined);
  await ensure(saved.id, '0');
  await ensure(saved.id, '6');
  assert.equal(calls, 7);
});

test('capture retains a screenshot when preview fails and closes its own target on all outcomes', async () => {
  let closed = 0;
  const commands: string[] = [];
  const send = async (method: string, params?: Record<string, unknown>) => {
    commands.push(method);
    if (method === 'Page.captureScreenshot') return { data: '/9j/' };
    if (method === 'Runtime.evaluate')
      return {
        result: {
          value: String(params?.expression).includes('readImageCandidates')
            ? [{ url: 'https://example.com/image.jpg', score: 120 }]
            : true,
        },
      };
    return {};
  };
  const session: CaptureSession = {
    send: send as CaptureSession['send'],
    loadImage: async () => {
      throw new Error('image blocked');
    },
    close: async () => {
      closed++;
    },
  };
  const result = await capturePage(
    'https://example.com',
    async () => session,
    async () => undefined,
  );
  assert.equal(result.screenshot?.dataUrl, screenshot);
  assert.equal(result.preview, undefined);
  assert.equal(closed, 1);
  assert(commands.includes('Emulation.setDeviceMetricsOverride'));
  const failed = {
    ...session,
    send: async () => {
      throw new Error('browser detached');
    },
  } as CaptureSession;
  assert.deepEqual(
    await capturePage(
      'https://example.com',
      async () => failed,
      async () => undefined,
    ),
    {},
  );
  assert.equal(closed, 2);
});

test('a stalled browser command is bounded and its target is closed on timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = 0;
  const work = capturePage(
    'https://example.com',
    async () => ({
      send: () => new Promise(() => {}),
      loadImage: async () => undefined,
      close: async () => {
        closed++;
      },
    }),
    async () => undefined,
  );
  await Promise.resolve();
  t.mock.timers.tick(25_001);
  assert.deepEqual(await work, {});
  assert.equal(closed, 1);
});

test('file image writes merge with flags and deletion removes assets without late resurrection', async () => {
  const previous = config.dataDir;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tabbit-images-'));
  config.dataDir = directory;
  try {
    await initStore();
    const saved = book();
    await saveRecord('books', saved);
    const asset = { id: crypto.randomUUID(), dataUrl: preview, width: 1000, height: 600 };
    const images = { preview: asset.id, attemptedAt: new Date().toISOString() };
    await Promise.all([
      saveSourceImages(saved.id, 'one', images, [asset]),
      updateBookFlags(saved.id, { pinned: true }),
    ]);
    const stored = await readBook(saved.id);
    assert.equal(stored.pinned, true);
    assert.equal(stored.sources[0]!.images?.preview, asset.id);
    assert.equal((await readImageAsset(asset.id)).dataUrl, preview);
    await removeBook(saved.id);
    await assert.rejects(saveSourceImages(saved.id, 'one', images, [asset]));
    assert.deepEqual(await fs.readdir(path.join(directory, 'images')), []);
    assert.deepEqual(await fs.readdir(path.join(directory, 'books')), []);
  } finally {
    config.dataDir = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('v1 extension storage upgrades without losing books and image backfills preserve concurrent flags and deletion', async () => {
  const name = `images-${crypto.randomUUID()}`;
  const initial = book();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('books', { keyPath: 'id' });
      request.result.createObjectStore('jobs', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction('books', 'readwrite');
      tx.objectStore('books').put(initial);
      tx.oncomplete = () => {
        request.result.close();
        resolve();
      };
    };
  });
  const store = createCollectionStore(name);
  assert.equal((await store.books())[0]?.title, initial.title);
  const asset = { id: crypto.randomUUID(), dataUrl: preview, width: 1000, height: 600 };
  const images: SourceImages = { preview: asset.id, attemptedAt: new Date().toISOString() };
  await Promise.all([
    store.saveSourceImages(initial.id, 'one', images, [asset]),
    store.updateBookFlags(initial.id, { pinned: true }),
  ]);
  const loaded = (await store.books())[0]!;
  assert.equal(loaded.pinned, true);
  assert.equal(loaded.sources[0]!.images?.preview, asset.id);
  assert.equal((await store.imageAsset(asset.id))?.dataUrl, preview);
  await store.removeBook(initial.id);
  await store.saveSourceImages(initial.id, 'one', images, [asset]);
  assert.equal((await store.books()).length, 0);
  assert.equal(await store.imageAsset(asset.id), undefined);
});

test('reader/export selects either stored cover, falls back safely and renders both layouts without extra static controls', () => {
  const saved = book();
  const render = (
    mode: 'preview' | 'screenshot',
    layout: 'grid' | 'list',
    images = { preview, screenshot },
  ) => {
    const dom = new JSDOM(
      renderToStaticMarkup(
        <BookDocument
          book={saved}
          coverMode={mode}
          layout={layout}
          embeddedImages={{ one: images }}
        />,
      ),
    );
    return dom;
  };
  for (const mode of ['preview', 'screenshot'] as const)
    for (const layout of ['grid', 'list'] as const) {
      const dom = render(mode, layout);
      const doc = dom.window.document;
      assert.equal(doc.querySelector('main')?.dataset.layout, layout);
      assert.equal(doc.querySelector('.page-cover')?.getAttribute('data-cover-kind'), mode);
      assert.equal(
        doc.querySelector('img')?.getAttribute('src'),
        mode === 'preview' ? preview : screenshot,
      );
      assert.equal(doc.querySelector('button'), null);
      dom.window.close();
    }
  const fallback = render('preview', 'grid', { preview: 'javascript:alert(1)', screenshot });
  assert.equal(fallback.window.document.querySelector('img')?.getAttribute('src'), screenshot);
  fallback.window.close();
});
