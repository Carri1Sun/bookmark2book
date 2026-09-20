import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEditorialIntroduction } from '../shared/editorial-introduction';
import type { Book } from '../shared/types';

test('editorial AI uses bounded article summaries and returns editable introduction', async () => {
  const original = globalThis.fetch;
  let payload: { messages: { content: string }[] } | undefined;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init!.body as string);
    return Response.json({
      choices: [
        { message: { content: JSON.stringify({ introduction: '围绕产品设计的阅读文集。' }) } },
      ],
    });
  };
  try {
    const book = {
      title: '设计阅读',
      sources: [{ title: '原文标题', summary: '已有文章简介', content: '不发送完整原文' }],
    } as Book;
    const output = await generateEditorialIntroduction(book, {
      baseUrl: 'https://example.com',
      apiKey: 'test-only',
      model: 'test-model',
    });
    assert.equal(output.introduction, '围绕产品设计的阅读文集。');
    assert(payload!.messages[1]!.content.includes('已有文章简介'));
    assert(!payload!.messages[1]!.content.includes('不发送完整原文'));
    assert(!payload!.messages[1]!.content.includes('test-only'));
  } finally {
    globalThis.fetch = original;
  }
});
