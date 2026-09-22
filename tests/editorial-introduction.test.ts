import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEditorialIntroduction } from '../shared/editorial-introduction';
import type { Book } from '../shared/types';

test('editorial AI uses webpage types and summaries, supports legacy sources, and omits raw extraction', async () => {
  const original = globalThis.fetch;
  let payload: { messages: { content: string }[] } | undefined;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init!.body as string);
    return Response.json({
      choices: [
        { message: { content: JSON.stringify({ introduction: '围绕产品设计的阅读合辑。' }) } },
      ],
    });
  };
  try {
    const book = {
      title: '设计阅读',
      sources: [
        {
          title: '在线绘图工具',
          summary: '提供流程图编辑与导出。',
          status: 'full',
          pageAnalysis: {
            type: 'tool',
            subject: '流程图工具',
            confidence: 'high',
            basis: 'content',
          },
          content: '不发送完整原文',
          pageMetadata: { description: '不发送原始元信息' },
        },
        { title: '旧收藏', summary: '已有网页简介', status: 'metadata' },
      ],
    } as Book;
    const output = await generateEditorialIntroduction(book, {
      baseUrl: 'https://example.com',
      apiKey: 'test-only',
      model: 'test-model',
    });
    assert.equal(output.introduction, '围绕产品设计的阅读合辑。');
    assert(payload!.messages[1]!.content.includes('已有网页简介'));
    assert(payload!.messages[1]!.content.includes('"type":"tool"'));
    assert(payload!.messages[1]!.content.includes('"pageAnalysis":null'));
    assert(payload!.messages[1]!.content.includes('"retrievalStatus":"metadata"'));
    assert(!payload!.messages[1]!.content.includes('不发送完整原文'));
    assert(!payload!.messages[1]!.content.includes('不发送原始元信息'));
    assert(!payload!.messages[1]!.content.includes('test-only'));
  } finally {
    globalThis.fetch = original;
  }
});

test('large editorial collections are explicitly sampled across the collection', async (t) => {
  let prompt = '';
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    prompt = JSON.parse(String(init.body)).messages[1].content;
    return Response.json({
      choices: [{ message: { content: '{"introduction":"混合资源合辑。"}' } }],
    });
  });
  const book = {
    title: '资源',
    sources: Array.from({ length: 201 }, (_, index) => ({
      title: `页面 ${index}`,
      summary: '介绍'.repeat(600),
    })),
  } as Book;
  await generateEditorialIntroduction(book, {
    baseUrl: 'https://example.com',
    apiKey: 'test',
    model: 'test',
  });
  const input = JSON.parse(prompt.split('\n').at(-1)!);
  assert.equal(input.totalSources, 201);
  assert.equal(input.sampled, true);
  assert.equal(input.sources.length, 100);
  assert(
    input.sources.some((source: { title: string }) => Number(source.title.split(' ')[1]) > 100),
  );
  assert(
    input.sources.every((source: { introduction: string }) => source.introduction.length <= 800),
  );
});
