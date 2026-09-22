import { useI18n, useMessageState } from './lib/i18n';
import { message } from '../shared/i18n';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, LoaderCircle, Plus, Search, Settings, X } from 'lucide-react';
import type { Book } from '../shared/types';
import { api } from './lib/api';
import { BookCover } from './components/BookCover';
import { BookActions, BookBadges } from './components/BookActions';
import type { MedalTier } from '../shared/featured-medals';
import type { BookFlags } from '../shared/book-flags';
import { compareBooks } from '../shared/book-order';
import { FixedHeader } from './components/FixedHeader';
import { LayoutToggle } from './components/LayoutToggle';
import { BookDocument } from './components/BookDocument';
import {
  captureOpening,
  CollectionOpening,
  type OpeningState,
} from './components/CollectionOpening';
import { collectionArticles } from './lib/collection';
import { EditorialApplication } from './components/EditorialApplication';
import { Studio } from './components/Studio';
import { downloadBook } from './lib/export';
import './styles/cover.css';
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
);

type View = { page: 'library' | 'studio' | 'reader' | 'editorial'; bookId?: string };
function currentView(): View {
  const params = new URLSearchParams(location.search);
  if (params.get('apply')) return { page: 'editorial', bookId: params.get('apply')! };
  return params.get('book')
    ? { page: 'reader', bookId: params.get('book')! }
    : params.get('view') === 'studio'
      ? { page: 'studio' }
      : { page: 'library' };
}
function Brand({ onClick, label }: { onClick: () => void; label?: string }) {
  const { t } = useI18n();
  return (
    <button
      className="brand"
      onClick={onClick}
      aria-label={t('brand.home', { name: label || t('brand.name') })}
    >
      <img className="brand-logo" src="./app-logo.png" alt="" width={32} height={32} />
      <span className="brand-name">{label || t('brand.name')}</span>
      <span className="brand-beta">{t('common.beta')}</span>
    </button>
  );
}
export default function App() {
  const { t } = useI18n();
  const [view, setView] = useState<View>(currentView);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<'checking' | 'ready' | 'offline' | 'missing'>('checking');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [settingsOpen, setSettingsOpen] = useState(
    new URLSearchParams(location.search).has('settings'),
  );
  const [toast, setToast] = useMessageState();
  const [error, setError] = useMessageState();
  const [opening, setOpening] = useState<OpeningState | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const finishOpening = useCallback(() => {
    setOpening(null);
    document.querySelector<HTMLElement>('.collection-title')?.focus({ preventScroll: true });
  }, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  async function refresh() {
    try {
      setBooks(await api.books());
      setError('');
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const check = () =>
      void api
        .health()
        .then((result) => setHealth(result.configured ? 'ready' : 'missing'))
        .catch(() => setHealth('offline'));
    check();
    const interval = setInterval(check, 30000);
    const pop = () => {
      setView(currentView());
      setOpening(null);
    };
    window.addEventListener('popstate', pop);
    return () => {
      clearInterval(interval);
      window.removeEventListener('popstate', pop);
      clearTimeout(toastTimer.current);
    };
  }, []);
  function navigate(next: View) {
    setOpenMenu(null);
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    if (next.page === 'studio') url.searchParams.set('view', 'studio');
    if (next.page === 'editorial' && next.bookId) url.searchParams.set('apply', next.bookId);
    if (next.page === 'reader' && next.bookId) url.searchParams.set('book', next.bookId);
    history.pushState({}, '', url);
    setView(next);
    setOpening(null);
    window.scrollTo({ top: 0 });
    if (next.page === 'library') void refresh();
  }
  function openCollection(current: Book, trigger: HTMLElement) {
    const transition = captureOpening(current, trigger);
    navigate({ page: 'reader', bookId: current.id });
    setOpening(transition);
  }
  function notice(text: unknown) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }
  const book = books.find((item) => item.id === view.bookId);
  const displayed = books
    .filter((item) =>
      `${item.title} ${item.subtitle} ${item.theme}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(compareBooks);
  async function updateFlags(current: Book, flags: BookFlags) {
    try {
      const updated = await api.updateBookFlags(current.id, flags);
      setBooks((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      notice(
        flags.pinned !== undefined
          ? flags.pinned
            ? message('notice.pinned')
            : message('notice.unpinned')
          : flags.editorial?.action === 'approve'
            ? message('notice.approved')
            : message('notice.unfeatured'),
      );
    } catch (error) {
      notice(error);
    }
  }
  async function equipMedal(current: Book, tier: MedalTier) {
    const updated = await api.updateBookFlags(current.id, { featuredMedal: tier });
    setBooks((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
  }
  async function exportCurrent(current: Book) {
    try {
      await downloadBook(current);
      notice(message('notice.exported'));
    } catch {
      notice(message('error.export'));
    }
  }
  return (
    <>
      {view.page === 'reader' && book ? (
        <>
          <BookDocument
            book={book}
            entering={Boolean(opening)}
            onBack={() => navigate({ page: 'library' })}
            onExport={() => exportCurrent(book)}
            onEquip={(tier) => equipMedal(book, tier)}
          />
          {opening && <CollectionOpening opening={opening} onFinish={finishOpening} />}
        </>
      ) : (
        <>
          <FixedHeader>
            <div className="app-header-shell">
              <header className="app-header page-width">
                <Brand
                  label={
                    view.page === 'editorial'
                      ? t('menu.apply')
                      : view.page === 'studio'
                        ? t('library.create')
                        : t('brand.name')
                  }
                  onClick={() => navigate({ page: 'library' })}
                />
                <div className="header-actions" role="group" aria-label={t('library.actions')}>
                  {view.page === 'library' && (
                    <>
                      <label className="library-search">
                        <Search size={16} aria-hidden="true" />
                        <input
                          placeholder={t('library.search')}
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          aria-label={t('library.search')}
                        />
                        {search && (
                          <button
                            aria-label={t('common.clearSearch')}
                            onClick={() => setSearch('')}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </label>
                      <LayoutToggle layout={layout} onChange={setLayout} />
                    </>
                  )}
                  <button
                    className={`header-settings${health === 'offline' || health === 'missing' ? ' needs-attention' : ''}`}
                    aria-label={t('common.settings')}
                    title={
                      health === 'missing'
                        ? t('library.configureKey')
                        : health === 'offline'
                          ? t('library.offline')
                          : t('common.settings')
                    }
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings size={19} strokeWidth={1.6} />
                  </button>
                  {view.page === 'library' && (
                    <button className="button primary" onClick={() => navigate({ page: 'studio' })}>
                      <Plus size={17} />
                      {t('common.add')}
                    </button>
                  )}
                </div>
              </header>
            </div>
          </FixedHeader>
          {view.page === 'studio' ? (
            <Studio
              configured={health === 'ready'}
              onSettings={() => setSettingsOpen(true)}
              onClose={() => navigate({ page: 'library' })}
              onComplete={async () => {
                await refresh();
                setSearch('');
                navigate({ page: 'library' });
                notice(message('notice.added'));
              }}
            />
          ) : view.page === 'editorial' && book ? (
            <EditorialApplication
              key={book.id}
              book={book}
              onBack={() => navigate({ page: 'library' })}
              onSubmit={async (reason, introduction) => {
                const updated = await api.updateBookFlags(book.id, {
                  editorial: { action: 'submit', reason, introduction },
                });
                setBooks((previous) =>
                  previous.map((item) => (item.id === updated.id ? updated : item)),
                );
                navigate({ page: 'library' });
                notice(message('notice.submitted'));
              }}
            />
          ) : view.page === 'reader' || view.page === 'editorial' ? (
            <div className="missing-book page-width">
              {loading ? (
                <>
                  <LoaderCircle className="spin" />
                  {t('common.loading')}
                </>
              ) : (
                <>
                  <h1>{t('library.notFound')}</h1>
                  <p>{error || t('library.removed')}</p>
                  <button className="button primary" onClick={() => navigate({ page: 'library' })}>
                    {t('common.back')}
                  </button>
                </>
              )}
            </div>
          ) : (
            <main className="page-width">
              <section
                className="library-section"
                id="library"
                aria-label={t('library.collections')}
              >
                {error && (
                  <div className="error-message" role="alert">
                    {error}
                    <button className="text-button" onClick={() => void refresh()}>
                      {t('common.retryConnect')}
                    </button>
                  </div>
                )}
                <div className={`library-grid ${layout === 'list' ? 'list-layout' : ''}`}>
                  {displayed.map((item) => (
                    <article className="library-card" key={item.id}>
                      <button
                        className={`book-display display-${item.palette}`}
                        onClick={(event) => openCollection(item, event.currentTarget)}
                        aria-label={t('library.read', { title: item.title.replace(/\n/g, '') })}
                      >
                        <BookCover
                          title={item.title}
                          palette={item.palette}
                          variant={['forest', 'vermilion', 'sand', 'ink'].indexOf(item.palette)}
                          image={item.coverImage}
                        />
                      </button>
                      <div className="book-card-info">
                        <div className="book-card-title-row">
                          <h2 className="book-card-heading">
                            <BookBadges book={item} onEquip={(tier) => equipMedal(item, tier)} />
                            <button
                              className="book-title-button"
                              onClick={(event) => openCollection(item, event.currentTarget)}
                            >
                              {item.title.replace(/\n/g, '')}
                            </button>
                          </h2>
                          <BookActions
                            book={item}
                            open={openMenu === item.id}
                            onOpenChange={(open) => setOpenMenu(open ? item.id : null)}
                            onUpdate={(flags) => updateFlags(item, flags)}
                            onExport={() => exportCurrent(item)}
                            onApply={() => navigate({ page: 'editorial', bookId: item.id })}
                          />
                        </div>
                        <p className="book-meta">
                          {t('common.pages', { count: collectionArticles(item).length })}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
                {!displayed.length && (
                  <div className="empty-library">
                    <BookOpen size={30} strokeWidth={1.4} />
                    <h2>{search ? t('library.noMatch') : t('library.empty')}</h2>
                    <button
                      className="button secondary"
                      onClick={() => (search ? setSearch('') : navigate({ page: 'studio' }))}
                    >
                      {search ? t('common.clearSearch') : t('library.add')}
                    </button>
                  </div>
                )}
              </section>
            </main>
          )}
        </>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
              const url = new URL(location.href);
              if (url.searchParams.has('settings')) {
                url.searchParams.delete('settings');
                history.replaceState({}, '', url);
              }
            }}
            onSaved={(settings) => {
              setHealth(settings.hasKey ? 'ready' : 'missing');
              notice(
                settings.hasKey ? message('notice.settingsSaved') : message('notice.keyRemoved'),
              );
            }}
          />
        </Suspense>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </>
  );
}
