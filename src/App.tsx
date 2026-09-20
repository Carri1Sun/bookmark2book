import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  Grid2X2,
  List,
  LoaderCircle,
  Plus,
  Search,
  Settings,
  X,
} from 'lucide-react';
import type { Book } from '../shared/types';
import { api } from './lib/api';
import { BookCover } from './components/BookCover';
import { BookActions, BookBadges } from './components/BookActions';
import type { BookFlags } from '../shared/book-flags';
import { compareBooks } from '../shared/book-order';
import { FixedHeader } from './components/FixedHeader';
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
function Brand({ onClick, label = 'Tabbit 文集' }: { onClick: () => void; label?: string }) {
  return (
    <button className="brand" onClick={onClick} aria-label={`${label}，回到文集首页`}>
      <img className="brand-logo" src="./app-logo.png" alt="" width={32} height={32} />
      <span className="brand-name">{label}</span>
      <span className="brand-beta">Beta</span>
    </button>
  );
}
export default function App() {
  const [view, setView] = useState<View>(currentView);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<'checking' | 'ready' | 'offline' | 'missing'>('checking');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [settingsOpen, setSettingsOpen] = useState(
    new URLSearchParams(location.search).has('settings'),
  );
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
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
      setError((e as Error).message);
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
  function notice(text: string) {
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
            ? '已置顶文集。'
            : '已取消置顶。'
          : flags.editorial?.action === 'approve'
            ? '审核已通过，已设为编辑精选。'
            : '已取消编辑精选。',
      );
    } catch (error) {
      notice((error as Error).message || '保存失败，请重试。');
    }
  }
  async function exportCurrent(current: Book) {
    try {
      await downloadBook(current);
      notice('已导出独立 HTML，离线也能阅读。');
    } catch {
      notice('导出失败，请重试。');
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
                      ? '申请编辑精选'
                      : view.page === 'studio'
                        ? '创建文集'
                        : 'Tabbit 文集'
                  }
                  onClick={() => navigate({ page: 'library' })}
                />
                <div className="header-actions" role="group" aria-label="文集操作">
                  {view.page === 'library' && (
                    <>
                      <label className="library-search">
                        <Search size={16} aria-hidden="true" />
                        <input
                          placeholder="搜索文集"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          aria-label="搜索文集"
                        />
                        {search && (
                          <button aria-label="清空搜索" onClick={() => setSearch('')}>
                            <X size={14} />
                          </button>
                        )}
                      </label>
                      <button
                        className="layout-toggle"
                        role="switch"
                        aria-label="列表视图"
                        aria-checked={layout === 'list'}
                        title={layout === 'grid' ? '切换为列表视图' : '切换为封面视图'}
                        onClick={() =>
                          setLayout((current) => (current === 'grid' ? 'list' : 'grid'))
                        }
                      >
                        <span className="layout-toggle-thumb" aria-hidden="true" />
                        <Grid2X2 size={15} aria-hidden="true" />
                        <List size={16} aria-hidden="true" />
                      </button>
                    </>
                  )}
                  <button
                    className={`header-settings${health === 'offline' || health === 'missing' ? ' needs-attention' : ''}`}
                    aria-label="设置"
                    title={
                      health === 'missing'
                        ? '设置 · 配置 API Key'
                        : health === 'offline'
                          ? '设置 · 服务未连接'
                          : '设置'
                    }
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings size={19} strokeWidth={1.6} />
                  </button>
                  {view.page === 'library' && (
                    <button className="button primary" onClick={() => navigate({ page: 'studio' })}>
                      <Plus size={17} />
                      添加
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
                notice('文集已添加到首页。');
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
                notice('申请已提交，精选审核中。');
              }}
            />
          ) : view.page === 'reader' || view.page === 'editorial' ? (
            <div className="missing-book page-width">
              {loading ? (
                <>
                  <LoaderCircle className="spin" />
                  正在加载…
                </>
              ) : (
                <>
                  <h1>未找到文集</h1>
                  <p>{error || '这本文集可能已被移除。'}</p>
                  <button className="button primary" onClick={() => navigate({ page: 'library' })}>
                    回到文集
                  </button>
                </>
              )}
            </div>
          ) : (
            <main className="page-width">
              <section className="library-section" id="library" aria-label="文集">
                {error && (
                  <div className="error-message" role="alert">
                    {error}
                    <button className="text-button" onClick={() => void refresh()}>
                      重新连接
                    </button>
                  </div>
                )}
                <div className={`library-grid ${layout === 'list' ? 'list-layout' : ''}`}>
                  {displayed.map((item) => (
                    <article className="library-card" key={item.id}>
                      <button
                        className={`book-display display-${item.palette}`}
                        onClick={(event) => openCollection(item, event.currentTarget)}
                        aria-label={`阅读 ${item.title.replace(/\n/g, '')}`}
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
                          <button
                            className="book-title-button"
                            onClick={(event) => openCollection(item, event.currentTarget)}
                          >
                            <h2>
                              <BookBadges book={item} />
                              {item.title.replace(/\n/g, '')}
                            </h2>
                          </button>
                          <BookActions
                            book={item}
                            open={openMenu === item.id}
                            onOpenChange={(open) => setOpenMenu(open ? item.id : null)}
                            onUpdate={(flags) => updateFlags(item, flags)}
                            onExport={() => exportCurrent(item)}
                            onApply={() => navigate({ page: 'editorial', bookId: item.id })}
                          />
                        </div>
                        <p className="book-meta">{collectionArticles(item).length} 篇文章</p>
                      </div>
                    </article>
                  ))}
                </div>
                {!displayed.length && (
                  <div className="empty-library">
                    <BookOpen size={30} strokeWidth={1.4} />
                    <h2>{search ? '没有匹配的文集' : '暂无文集'}</h2>
                    <button
                      className="button secondary"
                      onClick={() => (search ? setSearch('') : navigate({ page: 'studio' }))}
                    >
                      {search ? '清空搜索' : '添加文集'}
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
              notice(settings.hasKey ? '设置已保存。' : '密钥已删除。');
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
