import { ArrowLeft, ArrowUpRight, Download } from 'lucide-react';
import type { Book } from '../../shared/types';
import { collectionArticles, groupArticlesByFolder } from '../lib/collection';
import { FeaturedBadge, PendingBadge } from './BookActions';
import { FixedHeader } from './FixedHeader';
import { NotebookCover } from './NotebookCover';

export function BookDocument({
  book,
  entering = false,
  onBack,
  onExport,
}: {
  book: Book;
  entering?: boolean;
  onBack?: () => void;
  onExport?: () => void;
}) {
  const articles = collectionArticles(book);
  const groups = groupArticlesByFolder(articles);
  let running = 0;
  const numbered = groups.map((group) => {
    const start = running;
    running += group.articles.length;
    return { group, start };
  });
  return (
    <main
      className={`collection-document palette-${book.palette} ${entering ? 'is-entering' : ''}`}
    >
      <FixedHeader enabled={Boolean(onBack || onExport)}>
        <header className="collection-header">
          <div className="collection-header-inner">
            {onBack && (
              <button className="collection-back" onClick={onBack} aria-label="回到文集">
                <ArrowLeft size={21} strokeWidth={1.5} />
              </button>
            )}
            <div className="collection-heading">
              <h1 className="collection-title" tabIndex={-1}>
                {book.title.replace(/\n/g, '')}
              </h1>
              {book.featured ? (
                <FeaturedBadge />
              ) : book.editorial?.status === 'pending' ? (
                <PendingBadge />
              ) : null}
              <p className="collection-count">{articles.length} 篇文章</p>
            </div>
            {onExport && (
              <button className="collection-export" onClick={onExport} aria-label="导出 HTML">
                <Download size={16} />
                <span>导出 HTML</span>
              </button>
            )}
          </div>
        </header>
      </FixedHeader>
      <div className="collection-content">
        {numbered.map(({ group, start }) => (
          <section className="article-group" key={group.folder || 'articles'}>
            {group.folder && <h2 className="article-group-title">{group.folder}</h2>}
            <div className="article-grid" inert={entering}>
              {group.articles.map((article, index) => (
                <article className="article-card" id={`article-${article.id}`} key={article.id}>
                  {article.url ? (
                    <a
                      className="article-cover-link"
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`阅读原文：${article.title}`}
                    >
                      <NotebookCover title={article.title} index={start + index} />
                    </a>
                  ) : (
                    <div className="article-cover-link">
                      <NotebookCover title={article.title} index={start + index} />
                    </div>
                  )}
                  <p className="article-introduction">{article.introduction}</p>
                  {article.status === 'excerpt' && (
                    <p className="article-source-note">介绍基于正文节选</p>
                  )}
                  {article.url && (
                    <a
                      className="article-original"
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      阅读原文 <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
        {!articles.length && <p className="collection-empty">此文集暂无文章。</p>}
      </div>
    </main>
  );
}
