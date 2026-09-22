import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractBrowserSource } from '../src/extension/extract';
import { publicSource } from '../shared/types';

test('short non-article pages retain bounded metadata for classification without exposing raw inputs in saved sources', async (t) => {
  const dom = new JSDOM('');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: dom.window.DOMParser,
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'DOMParser', original);
    else Reflect.deleteProperty(globalThis, 'DOMParser');
    dom.window.close();
  });
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        `
    <title>Diagram Tool</title><meta name="description" content="在浏览器绘制流程图">
    <meta property="og:site_name" content="Diagram"><meta property="og:type" content="website">
    <nav><h2>菜单</h2></nav><main><h1>在线画图</h1><h2>导出 SVG</h2></main>
    <script>throw new Error('must not execute')</script>
  `,
        { headers: { 'content-type': 'text/html' } },
      ),
  );
  const source = await extractBrowserSource(
    { id: 'tool', title: '我的工具', url: 'https://example.com' },
    new AbortController().signal,
  );
  assert.equal(source.status, 'metadata');
  assert.equal(source.content, '在浏览器绘制流程图');
  assert.equal(source.pageMetadata?.title, 'Diagram Tool');
  assert.equal(source.pageMetadata?.declaredType, 'website');
  assert.deepEqual(source.pageMetadata?.headings, ['在线画图', '导出 SVG']);
  assert.equal(publicSource(source).pageMetadata, undefined);
  assert.equal(publicSource(source).content, undefined);
});
