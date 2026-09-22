import { useI18n } from '../lib/i18n';
import { ArrowLeft, ArrowUpRight, Download } from 'lucide-react';
import type { Book } from '../../shared/types';
import { collectionArticles, groupArticlesByFolder } from '../lib/collection';
import { PendingBadge } from './BookActions';
import { FeaturedBadge } from './FeaturedBadge';
import type { MedalTier } from '../../shared/featured-medals';
import { FixedHeader } from './FixedHeader';
import { PageCover } from './PageCover';
import { LayoutToggle } from './LayoutToggle';
import { useCoverMode, useDetailLayout } from '../lib/display-preferences';
import type { CoverMode, DetailLayout, EmbeddedImages } from '../../shared/page-images';

export function BookDocument({
  book,
  entering = false,
  onBack,
  onExport,
  onEquip,
  coverMode,
  layout: exportLayout,
  embeddedImages,
}: {
  book: Book;
  entering?: boolean;
  onBack?: () => void;
  onExport?: () => void;
  onEquip?: (tier: MedalTier) => Promise<void>;
  coverMode?: CoverMode;
  layout?: DetailLayout;
  embeddedImages?: EmbeddedImages;
}) {
  const { t, locale } = useI18n();
  const [preferredCover] = useCoverMode();
  const [preferredLayout, setLayout] = useDetailLayout();
  const layout = exportLayout || preferredLayout;
  const interactive = Boolean(onBack || onExport);
  const articles = collectionArticles(book, locale);
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
      data-layout={layout}
    >
      <FixedHeader enabled={Boolean(onBack || onExport)}>
        <header className="collection-header">
          <div className="collection-header-inner">
            {onBack && (
              <button className="collection-back" onClick={onBack} aria-label={t('common.back')}>
                <ArrowLeft size={21} strokeWidth={1.5} />
              </button>
            )}
            <div className="collection-heading">
              <h1 className="collection-title" tabIndex={-1}>
                {book.title.replace(/\n/g, '')}
              </h1>
              {book.featured ? (
                <FeaturedBadge tier={book.featuredMedal} onEquip={onEquip} />
              ) : book.editorial?.status === 'pending' ? (
                <PendingBadge />
              ) : null}
              <p className="collection-count">{t('common.pages', { count: articles.length })}</p>
            </div>
            <div className="collection-controls">
              {interactive && <LayoutToggle layout={layout} onChange={setLayout} />}
              {onExport && (
                <button
                  className="collection-export"
                  onClick={onExport}
                  aria-label={t('common.export')}
                >
                  <Download size={16} />
                  <span>{t('common.export')}</span>
                </button>
              )}
            </div>
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
                      aria-label={t('common.openPageTitle', { title: article.title })}
                    >
                      <PageCover
                        bookId={book.id}
                        sourceId={article.id}
                        title={article.title}
                        index={start + index}
                        mode={coverMode || preferredCover}
                        images={article.images}
                        embedded={embeddedImages?.[article.id]}
                        live={interactive && !entering}
                      />
                    </a>
                  ) : (
                    <div className="article-cover-link">
                      <PageCover
                        bookId={book.id}
                        sourceId={article.id}
                        title={article.title}
                        index={start + index}
                        mode={coverMode || preferredCover}
                        embedded={embeddedImages?.[article.id]}
                      />
                    </div>
                  )}
                  <div className="article-card-body">
                    <h3 className="article-title">{article.title}</h3>
                    <p className="article-introduction">{article.introduction}</p>
                    {article.status === 'excerpt' && (
                      <p className="article-source-note">{t('reader.excerpt')}</p>
                    )}
                    {article.url && (
                      <a
                        className="article-original"
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('common.openPage')}
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
        {!articles.length && <p className="collection-empty">{t('common.emptyPages')}</p>}
      </div>
    </main>
  );
}
