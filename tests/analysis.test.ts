import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCollection } from '../shared/analysis';
import { createModelClient } from '../shared/model';
import { assembleCollection } from '../shared/collection';
import { normalizePageAnalysis, type PageAnalysis } from '../shared/page-analysis';
import type { Job, Source } from '../shared/types';

const settings = { baseUrl: 'https://example.com', model: 'fixture', apiKey: 'fixture-secret' };
const direction = '面向独立开发者，优先说明可解决的问题。';
const types = [
  'tool',
  'documentation',
  'video',
  'repository',
  'product',
  'website',
  'article',
] as const;
const fixtures: Source[] = types.map((type, index) => ({
  id: `s${index + 1}`,
  title: `${type} 页面`,
  url: `https://example.com/${index}`,
  status: index === 2 ? 'metadata' : index === 4 ? 'unavailable' : 'full',
  content:
    index === 4
      ? undefined
      : index === 0
        ? '内容'.repeat(2500) + '完整材料末尾'
        : `${type} 的页面说明`,
  pageMetadata: {
    title: type,
    description: `${type} 的简介`,
    siteName: '示例',
    declaredType: '',
    headings: ['功能说明'],
  },
}));
function jobFor(sources = fixtures, title?: string): Job {
  return {
    id: 'job',
    bookmarks: sources.map(({ id, title, url }) => ({ id, title, url })),
    sources: [],
    palette: 'forest',
    direction,
    collectionTitle: title,
    status: 'extracting',
    progress: 0,
    message: '',
    createdAt: '2026-09-22',
  };
}
function classification(id: string): { id: string; analysis: PageAnalysis } {
  const index = fixtures.findIndex((source) => source.id === id);
  return {
    id,
    analysis: {
      type: types[index]!,
      subject: fixtures[index]!.title,
      confidence: 'high',
      basis: index === 5 ? 'blocked' : 'content',
    },
  };
}
function response(value: unknown) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
}
function inputFrom(init: RequestInit) {
  const payload = JSON.parse(String(init.body));
  const prompt = payload.messages[1].content as string;
  const line = prompt.split('\n').find((line) => line.startsWith('{"direction":'))!;
  return {
    prompt,
    input: JSON.parse(line) as {
      direction: string;
      sources: Array<{ id: string; text: string; pageAnalysis?: PageAnalysis }>;
    },
  };
}
function dependencies(sources = fixtures) {
  return {
    extractSource: async (bookmark: { id: string }) =>
      structuredClone(sources.find((source) => source.id === bookmark.id)!),
    askModel: createModelClient(settings),
    update: async (job: Job, change: Partial<Job>) => {
      Object.assign(job, change);
    },
  };
}

test('mixed webpages are classified before introductions, keep direction and evidence, and persist by ID', async (t) => {
  const phases: string[] = [];
  let classified = 0;
  let introduced = 0;
  const progress: number[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert(!String(init.body).includes(settings.apiKey));
    const { prompt, input } = inputFrom(init);
    assert.equal(input.direction, direction);
    if (prompt.startsWith('Task: classify')) {
      phases.push('classify');
      assert(input.sources.every((source) => source.text.length <= 3000));
      classified += input.sources.length;
      return response({
        sources: input.sources.map((source) => classification(source.id)).reverse(),
      });
    }
    if (prompt.startsWith('Task: write an introduction')) {
      assert.equal(classified, fixtures.length);
      phases.push('introduce');
      introduced += input.sources.length;
      const tool = input.sources.find((source) => source.id === 's1');
      if (tool) assert(tool.text.includes('完整材料末尾'));
      const unavailable = input.sources.find((source) => source.id === 's5');
      if (unavailable)
        assert.deepEqual(unavailable.pageAnalysis, {
          type: 'product',
          subject: 'product 页面',
          confidence: 'low',
          basis: 'title',
        });
      return response({
        sources: input.sources
          .map((source) => ({ id: source.id, summary: `${source.id} 的用途介绍。` }))
          .reverse(),
      });
    }
    assert.equal(introduced, fixtures.length);
    phases.push('title');
    assert(!prompt.includes('完整材料末尾'));
    return response({ title: '开发工具与资料' });
  });
  const job = jobFor();
  await analyzeCollection(job, new AbortController().signal, {
    ...dependencies(),
    update: async (job, change) => {
      Object.assign(job, change);
      progress.push(job.progress);
    },
  });
  assert.deepEqual(phases, ['classify', 'classify', 'introduce', 'introduce', 'title']);
  assert(progress.every((value, index) => index === 0 || value >= progress[index - 1]!));
  assert.equal(job.status, 'outline_ready');
  assert.equal(job.sources[0]?.summary, 's1 的用途介绍。');
  assert.match(job.sources[2]!.summary!, /^仅依据页面标题、简介等信息：/);
  assert.match(job.sources[4]!.summary!, /^仅依据标题与网址推测：/);
  assert.match(job.sources[5]!.summary!, /^未能读取目标内容：/);
  assert.equal(job.sources[5]?.pageAnalysis?.type, 'unknown');
  const saved = assembleCollection(
    { id: 'saved', createdAt: job.createdAt, palette: job.palette },
    job.outline!,
    job.sources,
  );
  assert.equal(saved.sources[1]?.pageAnalysis?.type, 'documentation');
  assert(saved.sources.every((source) => !source.content && !source.pageMetadata));
});

test('duplicate classification IDs and omitted summary IDs are retried before results are accepted', async (t) => {
  const counts = { classify: 0, introduce: 0 };
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const { prompt, input } = inputFrom(init);
    assert.equal(input.direction, direction);
    if (prompt.startsWith('Task: classify')) {
      counts.classify++;
      return response({
        sources:
          counts.classify === 1
            ? [classification('s1'), classification('s1')]
            : input.sources.map((source) => classification(source.id)),
      });
    }
    assert(prompt.startsWith('Task: write an introduction'));
    counts.introduce++;
    return response({
      sources: (counts.introduce === 1 ? input.sources.slice(0, 1) : input.sources).map(
        (source) => ({ id: source.id, summary: '网页用途。' }),
      ),
    });
  });
  const sources = fixtures.slice(0, 2);
  const job = jobFor(sources, '用户自己的名称');
  await analyzeCollection(job, new AbortController().signal, dependencies(sources));
  assert.deepEqual(counts, { classify: 2, introduce: 2 });
  assert.equal(job.outline?.title, '用户自己的名称');
});

test('invented IDs and unsupported page types never reach the introduction step', async (t) => {
  for (const invalid of [
    { ...classification('s1'), id: 'invented' },
    { id: 's1', analysis: { ...classification('s1').analysis, type: 'invented-type' } },
  ]) {
    let calls = 0;
    const mocked = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      calls++;
      assert(inputFrom(init).prompt.startsWith('Task: classify'));
      return response({ sources: [invalid] });
    });
    await assert.rejects(
      analyzeCollection(jobFor(fixtures.slice(0, 1)), new AbortController().signal, dependencies()),
      /格式校验/,
    );
    assert.equal(calls, 2);
    mocked.mock.restore();
  }
});

test('cancellation during classification prevents summaries and readiness updates', async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    controller.abort();
    return response({ sources: [classification('s1')] });
  });
  const job = jobFor(fixtures.slice(0, 1));
  await assert.rejects(analyzeCollection(job, controller.signal, dependencies()), {
    name: 'AbortError',
  });
  assert.equal(calls, 1);
  assert.notEqual(job.status, 'outline_ready');
});

test('evidence ceilings never promote a cautious classification, including short pages with headings', () => {
  const short = { ...fixtures[0]!, status: 'metadata' as const, content: '' };
  const analysis = classification('s1').analysis;
  assert.deepEqual(normalizePageAnalysis(short, analysis), {
    ...analysis,
    basis: 'metadata',
    confidence: 'medium',
  });
  assert.deepEqual(normalizePageAnalysis(short, { ...analysis, basis: 'title' }), {
    ...analysis,
    basis: 'title',
    confidence: 'low',
  });
  assert.equal(
    normalizePageAnalysis(fixtures[0]!, { ...analysis, type: 'unknown' }).confidence,
    'low',
  );
});
