import { AppError } from './i18n';
import { publicSource, type ArticleEdit, type Book, type Outline, type Source } from './types';

export function assembleCollection(
  metadata: Pick<Book, 'id' | 'createdAt' | 'palette' | 'coverImage' | 'model' | 'locale'>,
  outline: Outline,
  sources: Source[],
  articles?: ArticleEdit[],
): Book {
  const known = new Map(sources.map((source) => [source.id, source]));
  const edits =
    articles ||
    sources.map((source) => ({
      id: source.id,
      title: source.title,
      summary: source.summary || '',
    }));
  if (
    edits.length !== sources.length ||
    new Set(edits.map((article) => article.id)).size !== sources.length ||
    edits.some((article) => !known.has(article.id))
  ) {
    throw new AppError('error.pageList');
  }
  if (edits.some((article) => !article.title.trim() || !article.summary.trim())) {
    throw new AppError('error.pageEmpty');
  }
  const ordered = edits.map((article) => ({
    ...publicSource(known.get(article.id)!),
    title: article.title.trim(),
    summary: article.summary.trim(),
  }));
  return {
    ...outline,
    ...metadata,
    chapters: [],
    sources: ordered,
    readingMinutes: Math.max(
      1,
      Math.ceil(ordered.reduce((sum, source) => sum + source.summary.length, 0) / 400),
    ),
  };
}
