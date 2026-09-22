import type { Book, Source } from '../../shared/types';
import { safeHttpUrl } from './bookmarks';
import { defaultLocale, translate, type Locale } from '../../shared/i18n';

export interface CollectionArticle {
  id: string;
  title: string;
  introduction: string;
  url: string | null;
  status?: Source['status'];
  folder?: string;
  images?: Source['images'];
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

export function collectionArticles(
  book: Book,
  locale: Locale = defaultLocale,
): CollectionArticle[] {
  return book.sources.map((source) => ({
    id: source.id,
    title: source.title,
    introduction: source.summary?.trim() || translate(locale, 'reader.noIntroduction'),
    url: safeHttpUrl(source.url),
    status: source.status,
    folder: source.folder,
    images: source.images,
  }));
}
