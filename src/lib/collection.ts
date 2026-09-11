import type { Book, Source } from '../../shared/types';
import { safeHttpUrl } from './bookmarks';

export interface CollectionArticle {
  id: string;
  title: string;
  introduction: string;
  url: string | null;
  status?: Source['status'];
}

export function collectionArticles(book: Book): CollectionArticle[] {
  if (book.isDemo && !book.sources.length) {
    return book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      introduction: `${chapter.introduction}${chapter.sections[0]?.paragraphs[0]?.text || ''}`,
      url: null,
    }));
  }
  return book.sources.map((source) => ({
    id: source.id,
    title: source.title,
    introduction: source.summary?.trim() || '暂未生成介绍，可以通过原文链接阅读。',
    url: safeHttpUrl(source.url),
    status: source.status,
  }));
}
