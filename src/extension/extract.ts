import { Readability } from '@mozilla/readability';
import type { Bookmark, Source } from '../../shared/types';
import { safeHttpUrl } from '../lib/bookmarks';

const MAX_BYTES = 2500000;
export async function extractBrowserSource(
  bookmark: Bookmark,
  signal: AbortSignal,
): Promise<Source> {
  try {
    const url = safeHttpUrl(bookmark.url);
    if (!url) throw new Error('网页地址不可读取。');
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([signal, AbortSignal.timeout(18000)]),
      headers: { Accept: 'text/html,application/xhtml+xml,text/plain' },
    });
    if (
      !response.ok ||
      !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(
        response.headers.get('content-type') || '',
      )
    ) {
      await response.body?.cancel();
      throw new Error('网页无法读取，可能需要登录或不是文章网页。');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('网页没有返回正文。');
    const decoder = new TextDecoder();
    let bytes = 0,
      html = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('网页过大，未读取正文。');
        html += decoder.decode(chunk.value, { stream: true });
      }
      html += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc
      .querySelectorAll(
        'script,style,noscript,iframe,form,link,img,video,audio,source,object,embed',
      )
      .forEach((el) => el.remove());
    const description =
      doc
        .querySelector('meta[name="description"],meta[property="og:description"]')
        ?.getAttribute('content') || '';
    const article = new Readability(doc).parse();
    const content = article?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      ...bookmark,
      status: content.length < 200 ? 'metadata' : content.length > 14000 ? 'excerpt' : 'full',
      content: content.length < 200 ? description.slice(0, 1200) : content.slice(0, 14000),
      wordCount: content.length,
    };
  } catch (error) {
    signal.throwIfAborted();
    const message = error instanceof Error ? error.message : '';
    return {
      ...bookmark,
      status: 'unavailable',
      error: /^网页/.test(message) ? message : '网页未能读取，将仅依据书签标题生成介绍。',
    };
  }
}
