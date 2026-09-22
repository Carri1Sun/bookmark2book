import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionStore } from '../src/extension/database';
import { createExtensionJobs } from '../src/extension/jobs';
import {
  defaultSettings,
  resolveSettings,
  settingsInputSchema,
  settingsStatus,
} from '../shared/settings';
import { createModelClient, testModelConnection } from '../shared/model';
import { z } from 'zod';
import type { Job } from '../shared/types';
import { readBrowserBookmarks } from '../src/lib/bookmarks';
import { trustedMessage } from '../src/extension/protocol';

const settings = { ...defaultSettings, apiKey: 'test-secret-never-return' };
const bookmark = {
  id: 'chosen',
  title: '所选文章',
  url: 'https://example.com/chosen',
  folder: '设计',
};
async function waitReady(jobs: ReturnType<typeof createExtensionJobs>, id: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const job = await jobs.get(id);
    if (!['extracting', 'analyzing', 'outlining'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Test job did not finish');
}

test('native bookmark reading preserves folders without mutating bookmarks; messages reject web pages', async (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'chrome', prior);
    else Reflect.deleteProperty(globalThis, 'chrome');
  });
  const children = [{ id: 'folder', title: '收藏夹', children: [bookmark] }];
  let reads = 0;
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        id: 'extension-id',
        getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      },
      bookmarks: {
        getTree: async () => {
          reads++;
          return [{ id: '0', title: '', children }];
        },
      },
    },
  });
  assert.deepEqual(await readBrowserBookmarks(), children);
  assert.equal(reads, 1);
  const message = { channel: 'tabbit-collections', target: 'runner', method: 'jobs.get' };
  assert.equal(trustedMessage(message, { id: 'extension-id' }, 'runner'), true);
  assert.equal(
    trustedMessage(message, { id: 'extension-id', url: 'https://example.com' }, 'runner'),
    false,
  );
  assert.equal(trustedMessage(message, { id: 'different-id' }, 'runner'), false);
});

test('settings retain a blank key, redact status, require a new key for a new host, and allow clearing', () => {
  assert.deepEqual(resolveSettings({ ...defaultSettings, apiKey: '' }, settings), settings);
  assert.equal(JSON.stringify(settingsStatus(settings)).includes(settings.apiKey), false);
  assert.throws(
    () => resolveSettings({ ...defaultSettings, baseUrl: 'https://another.example/v1' }, settings),
    /重新填写/,
  );
  assert.equal(resolveSettings({ ...defaultSettings, clearKey: true }, settings).apiKey, '');
  for (const baseUrl of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com?key=secret',
  ])
    assert.equal(settingsInputSchema.safeParse({ ...defaultSettings, baseUrl }).success, false);
});

test('API requests omit cookies, refuse redirects, and never expose raw provider errors', async (t) => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls.push(options);
    return new Response(settings.apiKey, { status: 401 });
  });
  await assert.rejects(
    createModelClient(settings)(
      'test',
      z.object({ value: z.string() }),
      new AbortController().signal,
    ),
    (error: Error) => {
      assert.match(error.message, /API Key 验证失败/);
      assert.equal(error.message.includes(settings.apiKey), false);
      return true;
    },
  );
  assert.equal(calls[0]?.credentials, 'omit');
  assert.equal(calls[0]?.redirect, 'error');
  assert.equal(calls[0]?.body?.toString().includes(settings.apiKey), false);
});

test('connection test checks the configured model without generating content', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.deepseek.com/models');
    assert.equal(options.body, undefined);
    return Response.json({ data: [{ id: settings.model }] });
  });
  assert.deepEqual(await testModelConnection(settings), { ok: true });
  await assert.rejects(testModelConnection({ ...settings, model: 'not-present' }), /没有这个模型/);
});

test('extension jobs deduplicate chosen bookmarks and save an editable collection atomically', async (t) => {
  const databaseName = `test-${crypto.randomUUID()}`;
  const store = createCollectionStore(databaseName);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    requests.push(String(options.body));
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              sources:
                requests.length === 1
                  ? [
                      {
                        id: 's1',
                        analysis: {
                          type: 'article',
                          subject: '所选文章',
                          confidence: 'high',
                          basis: 'content',
                        },
                      },
                    ]
                  : [{ id: 's1', summary: '介绍所选文章的内容与阅读价值。' }],
            }),
          },
        },
      ],
    });
  });
  const jobs = createExtensionJobs({
    store,
    settings: async () => settings,
    extract: async (item) => ({ ...item, status: 'full', content: 'Selected article content' }),
  });
  const created = await jobs.create({
    bookmarks: [bookmark, { ...bookmark, id: 'duplicate', url: bookmark.url + '#section' }],
    palette: 'forest',
    direction: '',
    collectionTitle: '设计收藏',
    locale: 'en',
  });
  const ready = await waitReady(jobs, created.id);
  assert.equal(ready.status, 'outline_ready');
  assert.equal(ready.bookmarks.length, 1);
  assert.equal(ready.outline?.title, '设计收藏');
  assert.equal(ready.sources[0]?.content, undefined);
  assert.equal(requests.length, 2);
  assert.equal(ready.locale, 'en');
  assert(requests.every((request) => request.includes('Output language: English (en)')));
  assert.equal(requests[0]?.includes(settings.apiKey), false);
  const input = {
    outline: ready.outline,
    articles: [{ id: 's1', title: '编辑后的标题', summary: '编辑后的介绍。' }],
  };
  const saves = await Promise.allSettled([
    jobs.write(ready.id, input),
    jobs.write(ready.id, input),
  ]);
  assert.equal(saves.filter((result) => result.status === 'fulfilled').length, 1);
  const books = await store.books();
  assert.equal(books.length, 1);
  assert.equal(books[0]?.locale, 'en');
  assert.equal(books[0]?.sources[0]?.title, '编辑后的标题');
  assert.equal(books[0]?.sources[0]?.url, bookmark.url);
  assert.equal(books[0]?.sources[0]?.content, undefined);
  assert.equal(books[0]?.sources[0]?.pageAnalysis?.type, 'article');
  assert.equal((await jobs.get(ready.id)).bookId, books[0]?.id);
  assert.equal(JSON.stringify(await store.jobs()).includes(settings.apiKey), false);
  const reopened = createCollectionStore(databaseName);
  assert.deepEqual(await reopened.books(), books);
  await store.removeBook(books[0]!.id);
  assert.equal((await store.books()).length, 0);
});

test('cancelled work cannot be revived by a late extraction and interrupted jobs remain recoverable', async (t) => {
  const store = createCollectionStore(`test-${crypto.randomUUID()}`);
  let finishExtraction: (() => void) | undefined;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Should not call model');
  });
  const jobs = createExtensionJobs({
    store,
    settings: async () => settings,
    extract: async (item) => {
      await new Promise<void>((resolve) => {
        finishExtraction = resolve;
      });
      return { ...item, status: 'full', content: 'Article' };
    },
  });
  const created = await jobs.create({ bookmarks: [bookmark], palette: 'forest', direction: '' });
  await jobs.cancel(created.id);
  finishExtraction?.();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await jobs.get(created.id)).status, 'cancelled');
  assert.equal(fetchMock.mock.callCount(), 0);
  await store.saveJob({ ...created, id: 'interrupted', status: 'analyzing' } as Job);
  const restarted = createExtensionJobs({
    store,
    settings: async () => settings,
    extract: async (item) => ({ ...item, status: 'unavailable' }),
  });
  const interrupted = await restarted.get('interrupted');
  assert.equal(interrupted.status, 'failed');
  assert.deepEqual(interrupted.bookmarks, created.bookmarks);
});
