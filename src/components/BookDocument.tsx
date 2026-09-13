import { ArrowLeft, ArrowUpRight, Download } from 'lucide-react';
import type { Book } from '../../shared/types';
import { collectionArticles, groupArticlesByFolder } from '../lib/collection';
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
      <header className="collection-header">
        <div className="collection-header-inner">
          {onBack && (
            <button className="collection-back" onClick={onBack} aria-label="回到文集">
              <ArrowLeft size={21} strokeWidth={1.5} />
            </button>
          )}
          <h1 className="collection-title" tabIndex={-1}>
            {book.title.replace(/\n/g, '')}
          </h1>
          {onExport && (
            <button className="collection-export" onClick={onExport} aria-label="导出 HTML">
              <Download size={16} />
              <span>导出 HTML</span>
            </button>
          )}
        </div>
      </header>
      <div className="collection-content">
        <p className="collection-count">
          {articles.length} 篇文章 <span>·</span> {book.isDemo ? '内置示例' : '简介由 AI 整理'}
        </p>
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
                  {article.status && article.status !== 'full' && (
                    <p className="article-source-note">
                      {article.status === 'excerpt'
                        ? '介绍基于正文节选'
                        : '未获取正文，介绍仅供参考'}
                    </p>
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
