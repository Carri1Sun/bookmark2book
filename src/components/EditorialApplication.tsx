import { useI18n, useMessageState } from '../lib/i18n';
import { useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Sparkles } from 'lucide-react';
import type { Book } from '../../shared/types';
import { BookCover } from './BookCover';
import { api } from '../lib/api';
import { collectionArticles } from '../lib/collection';
import './EditorialApplication.css';

export function EditorialApplication({
  book,
  onBack,
  onSubmit,
}: {
  book: Book;
  onBack: () => void;
  onSubmit: (reason: string, introduction: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [reason, setReason] = useState('');
  const [introduction, setIntroduction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useMessageState();
  const busy = useRef(false);
  const articles = collectionArticles(book, locale);
  async function generate() {
    if (busy.current) return;
    busy.current = true;
    setGenerating(true);
    setError('');
    try {
      setIntroduction((await api.generateIntroduction(book.id)).introduction);
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setGenerating(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(reason.trim(), introduction.trim());
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }
  return (
    <main className="editorial-page page-width">
      <p className="editorial-subtitle">{t('editorial.subtitle')}</p>
      <form className="editorial-layout" onSubmit={submit}>
        <div className="editorial-left">
          <section className="editorial-summary" aria-label={t('editorial.collectionInfo')}>
            <div className="editorial-cover">
              <BookCover title={book.title} palette={book.palette} image={book.coverImage} />
            </div>
            <div>
              <h2>{book.title.replace(/\n/g, '')}</h2>
              <dl>
                <div>
                  <dt>{t('editorial.author')}</dt>
                  <dd>{t('editorial.authorName')}</dd>
                </div>
                <div>
                  <dt>{t('editorial.created')}</dt>
                  <dd>{new Date(book.createdAt).toLocaleDateString(locale)}</dd>
                </div>
                <div>
                  <dt>{t('editorial.pageCount')}</dt>
                  <dd>{t('common.items', { count: articles.length })}</dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="editorial-fields" aria-label={t('editorial.applicationInfo')}>
            <label htmlFor="editorial-reason">
              {t('editorial.reason')}
              <span>{t('common.optional')}</span>
            </label>
            <textarea
              id="editorial-reason"
              placeholder={t('editorial.reasonPlaceholder')}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
            />
            <div className="editorial-label-row">
              <label htmlFor="editorial-introduction">
                {t('editorial.introduction')}
                <span>{t('common.optional')}</span>
              </label>
              <button
                className="text-button editorial-ai"
                type="button"
                onClick={() => void generate()}
                disabled={generating || submitting}
              >
                {generating ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                {generating ? t('editorial.generating') : t('editorial.generate')}
              </button>
            </div>
            <textarea
              id="editorial-introduction"
              placeholder={t('editorial.introductionPlaceholder')}
              maxLength={1000}
              value={introduction}
              onChange={(e) => setIntroduction(e.target.value)}
              disabled={generating || submitting}
            />
          </section>
        </div>
        <section className="editorial-articles" aria-label={t('editorial.pages')}>
          <div className="editorial-list-heading">
            <h2>{t('editorial.pages')}</h2>
            <span>{t('common.pages', { count: articles.length })}</span>
          </div>
          <ol>
            {articles.map((article, index) => (
              <li key={article.id}>
                <span className="editorial-article-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  {article.url ? (
                    <a href={article.url} target="_blank" rel="noopener noreferrer">
                      {article.title}
                      <ArrowUpRight size={14} />
                    </a>
                  ) : (
                    <h3>{article.title}</h3>
                  )}
                  {article.introduction && <p>{article.introduction}</p>}
                </div>
              </li>
            ))}
          </ol>
          {!articles.length && <p className="editorial-empty">{t('common.emptyPages')}</p>}
        </section>
        <footer className="editorial-footer">
          <div aria-live="polite">
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="editorial-footer-actions">
            <button
              className="button secondary"
              type="button"
              onClick={onBack}
              disabled={submitting}
            >
              {t('editorial.cancel')}
            </button>
            <button className="button primary" type="submit" disabled={submitting || generating}>
              {submitting && <LoaderCircle size={16} className="spin" />}
              {submitting ? t('editorial.submitting') : t('editorial.submit')}
            </button>
          </div>
        </footer>
      </form>
    </main>
  );
}
