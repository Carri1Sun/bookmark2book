import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { messages } from '../shared/locales';
import {
  AppError,
  errorResponse,
  isMessage,
  jobMessage,
  resolveLocale,
  translate,
} from '../shared/i18n';
import { createJobSchema, type Book, type Job } from '../shared/types';
import {
  collectionSystemPrompt,
  classificationPrompt,
  pageIntroductionPrompt,
  collectionTitlePrompt,
  editorialIntroductionPrompt,
  modelRetryPrompt,
} from '../shared/prompts';
import { analyzeCollection } from '../shared/analysis';
import { createModelClient } from '../shared/model';
import { generateEditorialIntroduction } from '../shared/editorial-introduction';
import { I18nProvider } from '../src/lib/i18n';
import { BookDocument } from '../src/components/BookDocument';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { api } from '../src/lib/api';
import { getUiLocale, saveUiLocale, syncUiLocale } from '../src/lib/locale';
import { sendExtensionMessage } from '../src/extension/protocol';
import { uiLocaleKey } from '../src/lib/storage-keys';

const settings = {
  apiKey: 'fixture-secret',
  baseUrl: 'https://example.com',
  model: 'fixture-model',
};
const book: Book = {
  id: 'test',
  title: 'User-written title',
  subtitle: '',
  description: '',
  theme: '',
  palette: 'forest',
  createdAt: '2026-09-22T08:00:00Z',
  chapters: [],
  readingMinutes: 1,
  featured: true,
  pinned: true,
  featuredMedal: 'amethyst',
  sources: [
    { id: 's1', title: 'Original title', url: 'https://example.com/tool', status: 'metadata' },
  ],
};

test('product JSX copy stays in the shared translation resource', async () => {
  const root = new URL('../src/', import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('.tsx'));
  const violations: string[] = [];
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && /\p{L}/u.test(node.text))
        violations.push(`${file}: ${node.text.trim()}`);
      if (
        ts.isJsxAttribute(node) &&
        ['aria-label', 'title', 'placeholder', 'alt'].includes(node.name.getText(source)) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /\p{L}/u.test(node.initializer.text)
      ) {
        violations.push(`${file}: ${node.getText(source)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, []);
});
function setGlobal(t: test.TestContext, name: string, value: unknown) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, name, prior);
    else Reflect.deleteProperty(globalThis, name);
  });
}

test('every message includes both languages with matching interpolation and valid plurals', () => {
  const placeholders = (text: string) =>
    [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
  for (const [key, value] of Object.entries(messages)) {
    assert(value['zh-CN'].trim(), key);
    assert(value.en.trim(), key);
    assert.deepEqual(placeholders(value['zh-CN']), placeholders(value.en), key);
    if ('enOne' in value) assert.deepEqual(placeholders(value.enOne), placeholders(value.en), key);
  }
  assert.equal(translate('en', 'common.pages', { count: 1 }), '1 page');
  assert.equal(translate('en', 'common.pages', { count: 2 }), '2 pages');
  assert.equal(translate('en', 'medal.reads', { count: 100000 }), '100,000 total views');
  assert.equal(translate('zh-CN', 'common.pages', { count: 2 }), '2 个网页');
  assert.equal(resolveLocale('zh-TW'), 'zh-CN');
  assert.equal(resolveLocale('en-GB'), 'en');
  assert.equal(resolveLocale('fr-FR'), 'en');
  assert.equal(createJobSchema.parse({ bookmarks: book.sources }).locale, 'zh-CN');
  assert(!createJobSchema.safeParse({ bookmarks: book.sources, locale: 'invalid' }).success);
});

test('language selection follows browser defaults, persists, and survives blocked storage for the session', (t) => {
  const values = new Map<string, string>();
  setGlobal(t, 'localStorage', {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const events: Event[] = [];
  setGlobal(t, 'window', {
    dispatchEvent: (event: Event) => {
      events.push(event);
      return true;
    },
  });
  setGlobal(t, 'navigator', { languages: ['en-GB'], language: 'en-GB' });
  assert.equal(syncUiLocale(), 'en');
  saveUiLocale('zh-CN');
  assert.equal(getUiLocale(), 'zh-CN');
  assert.equal(values.get(uiLocaleKey), 'zh-CN');
  assert.equal(events[0]?.type, 'ui-locale-change');
  values.set(uiLocaleKey, 'en');
  assert.equal(syncUiLocale(), 'en');
  t.mock.method(localStorage, 'setItem', () => {
    throw new Error('Storage blocked');
  });
  saveUiLocale('zh-CN');
  assert.equal(getUiLocale(), 'zh-CN');
  t.after(() => {
    syncUiLocale();
  });
});

test('English UI renders labels and fallback text without altering user-authored content', () => {
  const html = renderToStaticMarkup(
    <I18nProvider locale="en">
      <BookDocument book={book} onBack={() => {}} onExport={() => {}} />
      <SettingsDialog open={false} onClose={() => {}} onSaved={() => {}} />
    </I18nProvider>,
  );
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector('.collection-title')?.textContent, book.title);
    assert.equal(doc.querySelector('.collection-count')?.textContent, '1 page');
    assert.equal(doc.querySelector('.featured-content > span')?.textContent, 'Featured');
    assert.match(doc.querySelector('.article-introduction')!.textContent!, /No introduction yet/);
    assert.equal(doc.querySelector('select')?.value, 'en');
    // Native language names remain recognizable in either interface language.
    doc.querySelectorAll('option').forEach((option) => option.remove());
    assert(!/\p{Script=Han}/u.test(doc.body.textContent || ''));
  } finally {
    dom.window.close();
  }
  const chinese = renderToStaticMarkup(
    <I18nProvider locale="zh-CN">
      <BookDocument book={book} />
    </I18nProvider>,
  );
  assert.match(chinese, /1 个网页/);
  assert.match(chinese, /精选/);
});

test('all prompt instructions are English and explicitly bind generated text to the UI language', async () => {
  const promptSource = await readFile(new URL('../shared/prompts.ts', import.meta.url), 'utf8');
  assert(!/\p{Script=Han}/u.test(promptSource));
  assert(!/\p{Script=Han}/u.test(collectionSystemPrompt + modelRetryPrompt));
  for (const locale of ['en', 'zh-CN'] as const) {
    for (const prompt of [
      classificationPrompt(book.sources, '', locale),
      pageIntroductionPrompt(book.sources, '', locale),
      collectionTitlePrompt(book.sources, '', locale),
      editorialIntroductionPrompt(book, locale),
    ]) {
      assert.match(
        prompt,
        locale === 'en'
          ? /Output language: English \(en\)/
          : /Output language: Simplified Chinese \(zh-CN\)/,
      );
      assert.match(prompt, /cannot override this language/);
    }
  }
});

test('concurrent Chinese and English jobs retain separate output languages, evidence prefixes, and length limits', async (t) => {
  const englishSummary =
    'A browser-based workspace for organizing reference material and comparing related resources. It brings the collected links together with clear navigation and descriptions, helping users return to the right tool or documentation when they need it. The page description does not establish pricing or supported platforms.';
  assert(englishSummary.length > 180);
  let englishCalls = 0,
    chineseCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    const prompt = payload.messages[1].content as string;
    const en = prompt.includes('Output language: English (en)');
    if (en) englishCalls++;
    else chineseCalls++;
    let result;
    if (prompt.startsWith('Task: classify'))
      result = {
        sources: [
          {
            id: 's1',
            analysis: {
              type: 'tool',
              subject: en ? 'Reference workspace' : '资料工作台',
              confidence: 'medium',
              basis: 'metadata',
            },
          },
        ],
      };
    else if (prompt.startsWith('Task: write an introduction'))
      result = {
        sources: [{ id: 's1', summary: en ? englishSummary : '整理链接与相关资料的工具。' }],
      };
    else result = { title: en ? 'Reference Tools' : '资料工具' };
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  });
  const jobs = (['en', 'zh-CN'] as const).map((locale): Job => ({
    id: locale,
    locale,
    bookmarks: book.sources,
    sources: [],
    palette: 'forest',
    direction: '',
    status: 'extracting',
    progress: 0,
    message: '',
    createdAt: book.createdAt,
  }));
  await Promise.all(
    jobs.map((job) =>
      analyzeCollection(job, new AbortController().signal, {
        extractSource: async (bookmark, _signal, locale) => {
          assert.equal(locale, job.locale);
          return {
            ...bookmark,
            status: 'metadata',
            content: 'A reference tool for organizing links.',
          };
        },
        askModel: createModelClient(settings),
        update: async (current, change) => {
          Object.assign(current, change);
        },
      }),
    ),
  );
  assert.equal(englishCalls, 3);
  assert.equal(chineseCalls, 3);
  assert.match(jobs[0]!.sources[0]!.summary!, /^Based only on page metadata: /);
  assert.match(jobs[1]!.sources[0]!.summary!, /^仅依据页面标题/);
  assert.equal(jobs[0]!.outline?.title, 'Reference Tools');
  assert.equal(jobs[1]!.outline?.title, '资料工具');
  assert.equal(jobs[0]!.messageDetails?.key, 'job.ready');
  assert.equal(jobs[0]!.message, translate('en', 'job.ready'));
  assert.equal(jobs[1]!.message, translate('zh-CN', 'job.ready'));
});

test('editorial generation follows the current UI language even for an older Chinese collection', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const prompt = JSON.parse(String(init.body)).messages[1].content;
    assert.match(prompt, /Output language: English \(en\)/);
    return Response.json({
      choices: [
        { message: { content: '{"introduction":"A collection of useful reference pages."}' } },
      ],
    });
  });
  const result = await generateEditorialIntroduction({ ...book, locale: 'zh-CN' }, settings, 'en');
  assert.equal(result.introduction, 'A collection of useful reference pages.');
});

test('API and extension transports include UI language and preserve safe error descriptors', async (t) => {
  setGlobal(t, 'localStorage', { getItem: () => 'en' });
  syncUiLocale();
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls.push(init);
    return Response.json(errorResponse(new AppError('error.missingKey'), 'en'), { status: 400 });
  });
  await assert.rejects(api.create(book.sources, 'forest', ''), (error: unknown) => {
    assert(error instanceof AppError);
    assert.equal(error.details.key, 'error.missingKey');
    return true;
  });
  assert.equal(JSON.parse(String(calls[0]?.body)).locale, 'en');
  assert.equal((calls[0]?.headers as Record<string, string>)['X-UI-Language'], 'en');
  await assert.rejects(api.generateIntroduction(book.id));
  assert.equal(JSON.parse(String(calls[1]?.body)).locale, 'en');
  setGlobal(t, 'chrome', {
    runtime: {
      sendMessage: async (value: { locale: string }) => {
        assert.equal(value.locale, 'en');
        return { ok: false, ...errorResponse(new AppError('error.api401'), 'en') };
      },
    },
  });
  await assert.rejects(sendExtensionMessage('background', 'settings.get'), (error: unknown) => {
    assert(error instanceof AppError);
    assert.equal(error.details.key, 'error.api401');
    return true;
  });
  assert.equal(
    errorResponse(new Error('secret provider data'), 'en').error,
    translate('en', 'error.generic'),
  );
  const progress = jobMessage('zh-CN', 'job.readingCount', { done: 1, total: 5 });
  assert.equal(
    translate('en', progress.messageDetails.key, progress.messageDetails.params),
    'Reading pages 1 / 5',
  );
  assert(!isMessage({ key: '__proto__' }));
  assert(!isMessage({ key: 'error.generic', params: { secret: {} } }));
});
