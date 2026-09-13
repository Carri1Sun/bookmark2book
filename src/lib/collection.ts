import type { Book, Source } from '../../shared/types';
import { safeHttpUrl } from './bookmarks';

export interface CollectionArticle {
  id: string;
  title: string;
  introduction: string;
  url: string | null;
  status?: Source['status'];
  folder?: string;
}

export interface ArticleGroup {
  folder: string;
  articles: CollectionArticle[];
}

export function groupArticlesByFolder(articles: CollectionArticle[]): ArticleGroup[] {
  if (!articles.length) return [];
  const paths = articles.map((article) => (article.folder || '').split(' / ').filter(Boolean));
  let common = 0;
  for (;;) {
    const first = paths[0]![common];
    if (!first || paths.some((path) => path[common] !== first)) break;
    common++;
  }
  const groups: ArticleGroup[] = [];
  const index = new Map<string, ArticleGroup>();
  articles.forEach((article, i) => {
    const label = paths[i]!.slice(common).join(' / ');
    let group = index.get(label);
    if (!group) {
      group = { folder: label, articles: [] };
      index.set(label, group);
      groups.push(group);
    }
    group.articles.push(article);
  });
  return groups;
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
    folder: source.folder,
  }));
}
