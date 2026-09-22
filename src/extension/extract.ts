import { AppError, defaultLocale, errorResponse, type Locale } from '../../shared/i18n';
import { readPageMetadata } from '../../shared/page-metadata';
import { readImageCandidates } from '../../shared/page-images';
import { Readability } from '@mozilla/readability';
import type { Bookmark, Source } from '../../shared/types';
import { safeHttpUrl } from '../lib/bookmarks';

const MAX_BYTES = 2500000;
export async function extractBrowserSource(
  bookmark: Bookmark,
  signal: AbortSignal,
  locale: Locale = defaultLocale,
): Promise<Source> {
  try {
    const url = safeHttpUrl(bookmark.url);
    if (!url) throw new AppError('error.pageUrl');
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
      throw new AppError('error.pageContent');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError('error.pageBody');
    const decoder = new TextDecoder();
    let bytes = 0,
      html = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new AppError('error.pageSize');
        html += decoder.decode(chunk.value, { stream: true });
      }
      html += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imageCandidates = readImageCandidates(doc, response.url || url);
    doc
      .querySelectorAll(
        'script,style,noscript,iframe,form,link,img,video,audio,source,object,embed',
      )
      .forEach((el) => el.remove());
    const pageMetadata = readPageMetadata(doc);
    const article = new Readability(doc).parse();
    const content = article?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      ...bookmark,
      pageMetadata,
      imageCandidates,
      status: content.length < 200 ? 'metadata' : content.length > 14000 ? 'excerpt' : 'full',
      content: content.length < 200 ? pageMetadata.description : content.slice(0, 14000),
      wordCount: content.length,
    };
  } catch (error) {
    signal.throwIfAborted();
    return {
      ...bookmark,
      status: 'unavailable',
      ...errorResponse(
        error instanceof AppError ? error : new AppError('error.pageUnavailable'),
        locale,
      ),
    };
  }
}
