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
  const [reason, setReason] = useState('');
  const [introduction, setIntroduction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const articles = collectionArticles(book);
  async function generate() {
    if (busy.current) return;
    busy.current = true;
    setGenerating(true);
    setError('');
    try {
      setIntroduction((await api.generateIntroduction(book.id)).introduction);
    } catch (e) {
      setError((e as Error).message);
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
      setError((e as Error).message || '提交失败，请重试。');
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }
  return (
    <main className="editorial-page page-width">
      <p className="editorial-subtitle">
        精选审核通过后，你的文章将在 Tiscovery 栏目中展示，同时获得特殊标识
      </p>
      <form className="editorial-layout" onSubmit={submit}>
        <div className="editorial-left">
          <section className="editorial-summary" aria-label="文集信息">
            <div className="editorial-cover">
              <BookCover title={book.title} palette={book.palette} image={book.coverImage} />
            </div>
            <div>
              <h2>{book.title.replace(/\n/g, '')}</h2>
              <dl>
                <div>
                  <dt>作者</dt>
                  <dd>Kaiyi</dd>
                </div>
                <div>
                  <dt>创建时间</dt>
                  <dd>{new Date(book.createdAt).toLocaleDateString('zh-CN')}</dd>
                </div>
                <div>
                  <dt>文章数量</dt>
                  <dd>{articles.length} 篇</dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="editorial-fields" aria-label="申请信息">
            <label htmlFor="editorial-reason">
              申请理由 <span>选填</span>
            </label>
            <textarea
              id="editorial-reason"
              placeholder="为什么推荐这本文集？可以聊聊选文思路或推荐理由。"
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
            />
            <div className="editorial-label-row">
              <label htmlFor="editorial-introduction">
                简介 <span>选填</span>
              </label>
              <button
                className="text-button editorial-ai"
                type="button"
                onClick={() => void generate()}
                disabled={generating || submitting}
              >
                {generating ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                {generating ? '正在生成…' : '使用 AI 自动生成'}
              </button>
            </div>
            <textarea
              id="editorial-introduction"
              placeholder="用一段话介绍文集的主题、内容与阅读价值。"
              maxLength={1000}
              value={introduction}
              onChange={(e) => setIntroduction(e.target.value)}
              disabled={generating || submitting}
            />
          </section>
        </div>
        <section className="editorial-articles" aria-label="文章列表">
          <div className="editorial-list-heading">
            <h2>文章列表</h2>
            <span>{articles.length} 篇文章</span>
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
          {!articles.length && <p className="editorial-empty">此文集暂无文章。</p>}
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
              取消提交
            </button>
            <button className="button primary" type="submit" disabled={submitting || generating}>
              {submitting && <LoaderCircle size={16} className="spin" />}
              {submitting ? '正在提交…' : '提交申请'}
            </button>
          </div>
        </footer>
      </form>
    </main>
  );
}
