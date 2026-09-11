import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Bookmark,
  Check,
  Download,
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
import { demoBooks } from './lib/demo';
import { BookCover } from './components/BookCover';
import { BookDocument } from './components/BookDocument';
import {
  captureOpening,
  CollectionOpening,
  type OpeningState,
} from './components/CollectionOpening';
import { collectionArticles } from './lib/collection';
import { Studio } from './components/Studio';
import { extensionContext } from './extension/protocol';
import { downloadBook } from './lib/export';
import './styles/cover.css';
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
);

type View = { page: 'library' | 'studio' | 'reader'; bookId?: string };
function currentView(): View {
  const params = new URLSearchParams(location.search);
  return params.get('book')
    ? { page: 'reader', bookId: params.get('book')! }
    : params.get('view') === 'studio'
      ? { page: 'studio' }
      : { page: 'library' };
}
function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button className="brand" onClick={onClick} aria-label="拾页，回到文集">
      <span className="brand-symbol">
        <Bookmark size={26} strokeWidth={1.4} />
        <i />
      </span>
      <span className="brand-name">拾页</span>
    </button>
  );
}
export default function App() {
  const [view, setView] = useState<View>(currentView);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<'checking' | 'ready' | 'offline' | 'missing'>('checking');
  const [filter, setFilter] = useState<'all' | 'mine' | 'demo'>(extensionContext ? 'mine' : 'all');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [guide, setGuide] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(
    new URLSearchParams(location.search).has('settings'),
  );
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<OpeningState | null>(null);
  const finishOpening = useCallback(() => {
    setOpening(null);
    document.querySelector<HTMLElement>('.collection-title')?.focus({ preventScroll: true });
  }, []);
  const guideRef = useRef<HTMLDialogElement>(null);
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
  useEffect(() => {
    if (guide) guideRef.current?.showModal();
    else guideRef.current?.close();
  }, [guide]);
  function navigate(next: View) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    if (next.page === 'studio') url.searchParams.set('view', 'studio');
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
  const allBooks = [...books, ...demoBooks];
  const book = allBooks.find((item) => item.id === view.bookId);
  const displayed = allBooks.filter(
    (item) =>
      (filter === 'all' || (filter === 'mine' ? !item.isDemo : item.isDemo)) &&
      `${item.title} ${item.subtitle} ${item.theme}`.toLowerCase().includes(search.toLowerCase()),
  );
  function exportCurrent(current: Book) {
    try {
      downloadBook(current);
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
          <header className="app-header page-width">
            <Brand onClick={() => navigate({ page: 'library' })} />
            <nav className="main-nav" aria-label="主导航">
              <button
                className={view.page === 'library' ? 'active' : ''}
                onClick={() => navigate({ page: 'library' })}
              >
                文集
              </button>
              <button onClick={() => setGuide(true)}>使用说明</button>
              <button
                className="settings-entry"
                aria-label="设置"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={18} strokeWidth={1.6} />
              </button>
            </nav>
            {(health === 'offline' || health === 'missing') && (
              <button className="connection offline" onClick={() => setSettingsOpen(true)}>
                {health === 'missing'
                  ? '配置 API Key'
                  : extensionContext
                    ? '扩展连接中断'
                    : '本地服务未连接'}
              </button>
            )}
          </header>
          {view.page === 'studio' ? (
            <Studio
              configured={health === 'ready'}
              onSettings={() => setSettingsOpen(true)}
              onClose={() => navigate({ page: 'library' })}
              onComplete={async () => {
                await refresh();
                setFilter('mine');
                navigate({ page: 'library' });
                notice('文集已添加到首页。');
              }}
            />
          ) : view.page === 'reader' ? (
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
              <section className="library-section" id="library">
                <div className="section-heading">
                  <h1>我的文集</h1>
                  <button className="button primary" onClick={() => navigate({ page: 'studio' })}>
                    <Plus size={17} />
                    添加
                  </button>
                </div>
                <div className="library-toolbar">
                  <div className="library-filters" role="tablist" aria-label="文集分类">
                    {(
                      [
                        ['all', '全部'],
                        ['mine', '已整理'],
                        ['demo', '示例'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        role="tab"
                        aria-selected={filter === value}
                        className={filter === value ? 'active' : ''}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="library-tools">
                    <label className="library-search">
                      <Search size={16} />
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
                    <div className="view-switch">
                      <button
                        className={layout === 'grid' ? 'active' : ''}
                        onClick={() => setLayout('grid')}
                        aria-label="封面视图"
                        aria-pressed={layout === 'grid'}
                      >
                        <Grid2X2 size={17} />
                      </button>
                      <button
                        className={layout === 'list' ? 'active' : ''}
                        onClick={() => setLayout('list')}
                        aria-label="列表视图"
                        aria-pressed={layout === 'list'}
                      >
                        <List size={18} />
                      </button>
                    </div>
                  </div>
                </div>
                {error && filter === 'mine' && (
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
                        />
                      </button>
                      <div className="book-card-info">
                        <div className="book-card-title-row">
                          <button
                            className="book-title-button"
                            onClick={(event) => openCollection(item, event.currentTarget)}
                          >
                            <h2>{item.title.replace(/\n/g, '')}</h2>
                          </button>
                          <button
                            className="icon-button book-download"
                            aria-label={`导出 ${item.title}`}
                            onClick={() => exportCurrent(item)}
                            title="导出 HTML"
                          >
                            <Download size={17} />
                          </button>
                        </div>
                        <p className="book-meta">
                          {collectionArticles(item).length} 篇文章{item.isDemo ? ' · 示例' : ''}
                        </p>
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
      <dialog
        ref={guideRef}
        className="guide-dialog"
        onCancel={() => setGuide(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setGuide(false);
        }}
      >
        <div className="guide-content">
          <button
            className="icon-button close-guide"
            onClick={() => setGuide(false)}
            aria-label="关闭使用指南"
          >
            <X size={20} />
          </button>
          <h2>使用说明</h2>
          <div className="guide-steps">
            {[
              ['1', '添加收藏', '在设置中填写 API Key，然后点击首页的添加，选择收藏夹或文章。'],
              ['2', '确认文章', '查看每篇文章的 AI 介绍，可修改标题、介绍和排列顺序。'],
              ['3', '保存文集', '文章以本子封面陈列，点击可阅读原文，也可以导出 HTML。'],
            ].map(([number, title, text]) => (
              <div key={number}>
                <span>{number}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="install-note">
            <h3>安装插件</h3>
            <p>
              在 Chrome / Edge 扩展管理页打开「开发者模式」，加载项目中的 dist/extension
              文件夹。点击插件图标即可使用，无需启动本地服务。
            </p>
          </div>
          <p className="guide-privacy">
            仅发送所选内容用于分析。插件中的密钥与文集保存在当前浏览器。
          </p>
          <button
            className="button primary"
            onClick={() => {
              setGuide(false);
              navigate({ page: 'studio' });
            }}
          >
            添加文集
          </button>
        </div>
      </dialog>
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
