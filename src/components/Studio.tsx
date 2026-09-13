import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Folder,
  Globe,
  Link,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { ArticleEdit, BookmarkNode, Job, Outline, Palette } from '../../shared/types';
import { api } from '../lib/api';
import {
  deduplicateBookmarks,
  flattenBookmarks,
  parseLinks,
  readBrowserBookmarks,
} from '../lib/bookmarks';
import { sampleNodes } from '../lib/demo';
import { BookCover, palettes } from './BookCover';

type SourceMode = 'browser' | 'links' | 'sample';
const workingStatuses = ['extracting', 'analyzing', 'outlining', 'writing'];
function CheckBox({
  checked,
  mixed = false,
  disabled = false,
  onChange,
  label,
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      className="checkbox"
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      title={disabled ? '已随上级文件夹收录' : undefined}
      aria-label={label}
    />
  );
}
function FolderBranch({
  node,
  selectedFolders,
  toggleFolder,
  active,
  onActivate,
  onSelectFolder,
  ancestorSelected = false,
  depth = 0,
}: {
  node: BookmarkNode;
  selectedFolders: Set<string>;
  toggleFolder: (node: BookmarkNode) => void;
  active: string;
  onActivate: (id: string) => void;
  onSelectFolder: (node: BookmarkNode) => void;
  ancestorSelected?: boolean;
  depth?: number;
}) {
  const [open, setOpen] = useState(true);
  if (node.url) return null;
  const included = selectedFolders.has(node.id) || ancestorSelected;
  const ids = flattenBookmarks([node]).map((item) => item.id);
  const children = node.children?.filter((child) => !child.url) || [];
  return (
    <>
      <div
        className={`folder-item ${active === node.id ? 'active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        {children.length > 0 ? (
          <button
            className="tree-toggle"
            onClick={() => setOpen(!open)}
            aria-label={`${open ? '折叠' : '展开'}${node.title}`}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="tree-spacer" />
        )}
        <CheckBox
          checked={included}
          disabled={ancestorSelected}
          onChange={() => {
            toggleFolder(node);
            if (!included) onSelectFolder(node);
          }}
          label={`选择文件夹 ${node.title}`}
        />
        <button className="folder-name" onClick={() => onActivate(node.id)}>
          <Folder size={14} />
          <span>{node.title || '书签'}</span>
          <small>{ids.length}</small>
        </button>
      </div>
      {open &&
        children.map((child) => (
          <FolderBranch
            key={child.id}
            node={child}
            selectedFolders={selectedFolders}
            toggleFolder={toggleFolder}
            active={active}
            onActivate={onActivate}
            onSelectFolder={onSelectFolder}
            ancestorSelected={included}
            depth={depth + 1}
          />
        ))}
    </>
  );
}
function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children || [], id);
    if (found) return found;
  }
}

export function Studio({
  onClose,
  onComplete,
  configured,
  onSettings,
}: {
  onClose: () => void;
  onComplete: (id: string) => void;
  configured: boolean;
  onSettings: () => void;
}) {
  const isExtension = Boolean(globalThis.chrome?.bookmarks?.getTree);
  const [mode, setMode] = useState<SourceMode>('browser');
  const [readingBookmarks, setReadingBookmarks] = useState(isExtension);
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [activeFolder, setActiveFolder] = useState('all');
  const [search, setSearch] = useState('');
  const [links, setLinks] = useState('');
  const [palette, setPalette] = useState<Palette>('forest');
  const [direction, setDirection] = useState('');
  const [collectionTitle, setCollectionTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [articles, setArticles] = useState<ArticleEdit[]>([]);
  const [pollError, setPollError] = useState('');
  const all = useMemo(() => flattenBookmarks(nodes), [nodes]);
  const activeNode = activeFolder === 'all' ? undefined : findNode(nodes, activeFolder);
  const visible = useMemo(
    () =>
      (activeNode ? flattenBookmarks([activeNode]) : all).filter((item) =>
        `${item.title} ${item.url} ${item.folder}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [all, activeNode, search],
  );
  const picked = useMemo(() => {
    const roots: BookmarkNode[] = [];
    const walk = (list: BookmarkNode[]) => {
      for (const node of list) {
        if (node.url) continue;
        if (selectedFolders.has(node.id)) roots.push(node);
        else walk(node.children || []);
      }
    };
    walk(nodes);
    return deduplicateBookmarks(flattenBookmarks(roots));
  }, [nodes, selectedFolders]);
  const pickedIds = useMemo(() => new Set(picked.map((item) => item.id)), [picked]);

  function useNodes(data: BookmarkNode[], selectAll = false) {
    setNodes(data);
    setSelectedFolders(
      new Set(selectAll ? data.filter((node) => !node.url).map((node) => node.id) : []),
    );
    setActiveFolder('all');
    setSearch('');
  }
  function toggleFolder(node: BookmarkNode) {
    setSelectedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }
  async function switchMode(next: SourceMode) {
    if (next === mode) return;
    setMode(next);
    setError('');
    setLinks('');
    useNodes([]);
    if (next === 'sample') useNodes(sampleNodes, true);
    if (next === 'browser') {
      setReadingBookmarks(true);
      try {
        useNodes(await readBrowserBookmarks());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReadingBookmarks(false);
      }
    }
  }
  useEffect(() => {
    if (isExtension)
      void readBrowserBookmarks()
        .then((data) => useNodes(data))
        .catch((e) => setError(e.message))
        .finally(() => setReadingBookmarks(false));
    const stored = localStorage.getItem('bookmark-press-draft');
    if (stored)
      void api
        .job(stored)
        .then((draft) => {
          if (['completed', 'cancelled'].includes(draft.status)) {
            localStorage.removeItem('bookmark-press-draft');
            return;
          }
          setJob(draft);
          setPalette(draft.palette);
          setDirection(draft.direction);
          setCollectionTitle(draft.collectionTitle || '');
          setOutline(draft.outline || null);
          setArticles(
            draft.sources.map(({ id, title, summary }) => ({ id, title, summary: summary || '' })),
          );
        })
        .catch(() => {});
  }, []);
  useEffect(() => {
    if (!job || !workingStatuses.includes(job.status)) return;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const next = await api.job(job.id, controller.signal);
        if (stopped) return;
        setPollError('');
        setJob(next);
        if (next.outline && next.status === 'outline_ready') {
          setOutline(next.outline);
          setArticles(
            next.sources.map(({ id, title, summary }) => ({ id, title, summary: summary || '' })),
          );
        }
        if (next.status === 'completed' && next.bookId) {
          localStorage.removeItem('bookmark-press-draft');
          onComplete(next.bookId);
          return;
        }
        if (['failed', 'cancelled'].includes(next.status)) {
          localStorage.removeItem('bookmark-press-draft');
          return;
        }
        if (workingStatuses.includes(next.status)) timeout = setTimeout(poll, 1500);
      } catch (e) {
        if (stopped) return;
        setPollError((e as Error).message);
        timeout = setTimeout(poll, 4000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [job?.id, job?.status]);
  async function start() {
    if (!picked.length || picked.length > 500) return;
    if (!configured) {
      onSettings();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!(await api.allowSites(picked.map((bookmark) => bookmark.url))))
        throw new Error('未获得所选网页的访问权限，请允许读取后重试。');
      const next = await api.create(picked, palette, direction, collectionTitle);
      setJob(next);
      localStorage.setItem('bookmark-press-draft', next.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function write() {
    if (!job || !outline) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.write(job.id, outline, articles);
      if (next.status === 'completed' && next.bookId) {
        localStorage.removeItem('bookmark-press-draft');
        onComplete(next.bookId);
      } else {
        setJob(next);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!job) return;
    setBusy(true);
    try {
      await api.cancel(job.id);
      setJob({ ...job, status: 'cancelled' });
      localStorage.removeItem('bookmark-press-draft');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    if (job) {
      useNodes(
        [
          {
            id: 'retry',
            title: '上次选择的素材',
            children: job.bookmarks.map((item) => ({
              id: item.id,
              title: item.title,
              url: item.url,
            })),
          },
        ],
        true,
      );
    }
    setJob(null);
    setOutline(null);
    setError('');
  }
  const folderById = useMemo(
    () => new Map((job?.sources || []).map((source) => [source.id, source.folder] as const)),
    [job],
  );
  const step = !job
    ? 1
    : job.status === 'outline_ready'
      ? 2
      : job.status === 'writing' || job.status === 'completed'
        ? 3
        : 1;
  return (
    <div className="studio page-width">
      <div className="studio-heading">
        <button className="text-button" onClick={onClose}>
          <ArrowLeft size={16} /> 回到文集
        </button>
        <div className="studio-steps">
          {['选择收藏', '确认文章', '保存文集'].map((label, i) => (
            <div key={label} className={step >= i + 1 ? 'active' : ''}>
              <span>{step > i + 1 ? <Check size={12} /> : i + 1}</span>
              {label}
              {i < 2 && <i />}
            </div>
          ))}
        </div>
      </div>
      {!job ? (
        <>
          <div className="studio-intro">
            <h1>添加文集</h1>
            <p>勾选一个收藏夹作为根目录，其中的文章与子文件夹都会收录进同一本文集。</p>
          </div>
          <div className="studio-grid">
            <section className="source-panel">
              <div className="source-tabs" role="tablist" aria-label="素材来源">
                {(
                  [
                    ['browser', '浏览器书签', BookOpen],
                    ['links', '粘贴链接', Link],
                    ['sample', '示例素材', Sparkles],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={mode === value}
                    className={mode === value ? 'active' : ''}
                    onClick={() => void switchMode(value)}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
              {mode === 'links' && (
                <div className="link-input-area">
                  <label htmlFor="links">粘贴要收录的文章链接，每行一个</label>
                  <textarea
                    id="links"
                    value={links}
                    placeholder={
                      'https://example.com/an-interesting-article\nhttps://example.com/another-idea'
                    }
                    onChange={(event) => {
                      setLinks(event.target.value);
                      useNodes(
                        [
                          {
                            id: 'links',
                            title: '粘贴的链接',
                            children: parseLinks(event.target.value),
                          },
                        ],
                        true,
                      );
                    }}
                  />
                  <p>支持公开的 HTTP / HTTPS 网页，重复链接会自动合并。</p>
                </div>
              )}
              {!all.length && mode === 'browser' && (
                <div className="import-empty">
                  {readingBookmarks ? (
                    <LoaderCircle className="spin" size={28} />
                  ) : (
                    <Globe size={30} strokeWidth={1} />
                  )}
                  <h3>
                    {readingBookmarks
                      ? '正在读取收藏夹…'
                      : isExtension
                        ? '暂无书签'
                        : '在插件中读取收藏夹'}
                  </h3>
                  {!readingBookmarks && (
                    <p>
                      {isExtension
                        ? '添加浏览器书签后重新打开，也可以粘贴文章链接。'
                        : '安装 Tabbit 文集扩展后，点击插件图标即可直接选择收藏夹。'}
                    </p>
                  )}
                  {!isExtension && (
                    <a className="button secondary" href="/api/extension">
                      下载插件
                    </a>
                  )}
                </div>
              )}
              {all.length > 0 && (
                <>
                  <div className="source-toolbar">
                    <label className="search-field">
                      <Search size={15} />
                      <input
                        aria-label="搜索书签"
                        placeholder="搜索书签、网址…"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <span>{all.length} 个书签</span>
                  </div>
                  <div className="bookmark-browser">
                    <aside className="folder-sidebar">
                      <button
                        className={`all-folders ${activeFolder === 'all' ? 'active' : ''}`}
                        onClick={() => setActiveFolder('all')}
                      >
                        <BookOpen size={15} />
                        全部书签<span>{all.length}</span>
                      </button>
                      {nodes
                        .filter((node) => !node.url)
                        .map((node) => (
                          <FolderBranch
                            key={node.id}
                            node={node}
                            selectedFolders={selectedFolders}
                            toggleFolder={toggleFolder}
                            active={activeFolder}
                            onActivate={setActiveFolder}
                            onSelectFolder={(folder) => {
                              setActiveFolder(folder.id);
                              if (!collectionTitle) setCollectionTitle(folder.title.slice(0, 60));
                            }}
                          />
                        ))}
                    </aside>
                    <div className="bookmark-list">
                      <div className="select-all-row">
                        <span>{activeNode ? '此文件夹内的文章' : '全部书签'}</span>
                        <small>{visible.length} 篇</small>
                      </div>
                      {visible.map((item) => (
                        <div
                          key={item.id}
                          className={`bookmark-row ${pickedIds.has(item.id) ? 'selected' : ''}`}
                        >
                          <span className="bookmark-initial">
                            {new URL(item.url).hostname
                              .replace('www.', '')
                              .slice(0, 1)
                              .toUpperCase()}
                          </span>
                          <span className="bookmark-copy">
                            <strong>{item.title}</strong>
                            <small>{new URL(item.url).hostname}</small>
                          </span>
                          {pickedIds.has(item.id) && <em className="bookmark-included">已收录</em>}
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`打开 ${item.title}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            ↗
                          </a>
                        </div>
                      ))}
                      {!visible.length && <p className="no-search">没有找到匹配的书签。</p>}
                    </div>
                  </div>
                  <div className="source-footer">
                    <Check size={14} />
                    <span>已收录 {picked.length} 篇，重复链接自动合并</span>
                    <button className="text-button" onClick={() => setSelectedFolders(new Set())}>
                      清空选择
                    </button>
                  </div>
                </>
              )}
            </section>
            <aside className="studio-settings">
              <div className="settings-preview">
                <BookCover
                  title={collectionTitle || '封面预览'}
                  palette={palette}
                  variant={Object.keys(palettes).indexOf(palette)}
                />
              </div>
              <label className="collection-name-field">
                文集名称
                <input
                  value={collectionTitle}
                  maxLength={60}
                  placeholder="留空由 AI 拟定"
                  onChange={(event) => setCollectionTitle(event.target.value)}
                />
              </label>
              <fieldset className="palette-field">
                <legend>封面颜色</legend>
                <div className="palette-options">
                  {Object.entries(palettes).map(([value, color]) => (
                    <button
                      key={value}
                      className={palette === value ? 'selected' : ''}
                      style={{ background: color.background, color: color.ink }}
                      onClick={() => setPalette(value as Palette)}
                      aria-label={color.name}
                      title={color.name}
                      aria-pressed={palette === value}
                    >
                      {palette === value && <Check size={15} />}
                    </button>
                  ))}
                  <span>{palettes[palette].name}</span>
                </div>
              </fieldset>
              <label className="direction-field">
                编辑方向 <span>选填</span>
                <textarea
                  maxLength={1000}
                  value={direction}
                  onChange={(event) => setDirection(event.target.value)}
                  placeholder="例如：比较这些文章对产品设计的不同观点。"
                />
              </label>
              <div className="privacy-note">
                <BookOpen size={14} />
                <p>仅发送所选内容用于分析，不修改原始书签。</p>
              </div>
            </aside>
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <div className="studio-bottom">
            <p>
              {picked.length > 500
                ? '第一版每本最多 500 篇，请缩小选择范围。'
                : picked.length
                  ? ''
                  : '请至少勾选一个文件夹。'}
            </p>
            <button
              className="button primary"
              disabled={!picked.length || picked.length > 500 || busy}
              onClick={() => void start()}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} 生成介绍{' '}
              <ArrowRight size={17} />
            </button>
          </div>
        </>
      ) : job.status === 'outline_ready' && outline ? (
        <>
          <div className="studio-intro">
            <h1>确认文章</h1>
            <p>确认文集名称、文章顺序和介绍后保存。</p>
          </div>
          <div className="outline-grid">
            <section className="outline-editor">
              <label>
                文集名称
                <input
                  className="title-edit"
                  maxLength={60}
                  value={outline.title}
                  onChange={(event) => setOutline({ ...outline, title: event.target.value })}
                />
              </label>
              <div className="outline-list-heading">
                <span>收录文章</span>
                <span>{articles.length} 篇</span>
              </div>
              <div className="article-review-list">
                {articles.map((article, index) => (
                  <article className="article-review-row" key={article.id}>
                    <div className="article-review-fields">
                      {folderById.get(article.id) && (
                        <small className="article-folder-tag">
                          {folderById.get(article.id)}
                        </small>
                      )}
                      <input
                        aria-label={`第 ${index + 1} 篇文章标题`}
                        maxLength={500}
                        value={article.title}
                        onChange={(event) =>
                          setArticles(
                            articles.map((item) =>
                              item.id === article.id
                                ? { ...item, title: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <label>
                        AI 介绍
                        <textarea
                          aria-label={`第 ${index + 1} 篇文章介绍`}
                          maxLength={2000}
                          value={article.summary}
                          onChange={(event) =>
                            setArticles(
                              articles.map((item) =>
                                item.id === article.id
                                  ? { ...item, summary: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <div className="reorder-buttons">
                      <button
                        className="icon-button"
                        disabled={index === 0}
                        aria-label={`上移第 ${index + 1} 篇文章`}
                        onClick={() => {
                          const next = [...articles];
                          [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                          setArticles(next);
                        }}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={index === articles.length - 1}
                        aria-label={`下移第 ${index + 1} 篇文章`}
                        onClick={() => {
                          const next = [...articles];
                          [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                          setArticles(next);
                        }}
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <aside className="outline-preview">
              <BookCover title={outline.title} palette={palette} />
              <div className="source-report">
                <h3>素材阅读情况</h3>
                {job.sources.map((source) => (
                  <div key={source.id}>
                    <span className={`source-dot ${source.status}`} />
                    <span>{source.title}</span>
                    <small>
                      {
                        (
                          {
                            full: '已读取',
                            excerpt: '正文节选',
                            metadata: '仅简介',
                            unavailable: '未读取',
                          } as const
                        )[source.status]
                      }
                    </small>
                  </div>
                ))}
              </div>
            </aside>
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <div className="studio-bottom">
            <button className="text-button" onClick={() => void cancel()}>
              取消草稿
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                !outline.title.trim() ||
                !articles.length ||
                articles.some((article) => !article.title.trim() || !article.summary.trim())
              }
              onClick={() => void write()}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <BookOpen size={16} />}
              保存文集 <ArrowRight size={17} />
            </button>
          </div>
        </>
      ) : ['failed', 'cancelled'].includes(job.status) ? (
        <section className="job-result">
          <h1>{job.status === 'cancelled' ? '已取消生成' : '生成失败'}</h1>
          <p role="alert">{job.error || job.message}</p>
          <button className="button primary" onClick={reset}>
            重新选择素材 <ArrowRight size={16} />
          </button>
        </section>
      ) : (
        <section className="generation-view" aria-live="polite">
          <div className="generation-copy">
            <h1>{job.status === 'writing' ? '正在保存文集' : '正在生成文章介绍'}</h1>
            <p>{job.message}</p>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="整理进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress}
            >
              <div style={{ width: `${job.progress}%` }} />
            </div>
            <div className="progress-caption">
              <span>{job.status === 'writing' ? '保存文章与介绍' : '读取文章与生成介绍'}</span>
              <span>{job.progress}%</span>
            </div>
            <div className="generation-stages">
              {(job.status === 'writing'
                ? ['确认文章', '保留原文链接', '保存文集']
                : ['读取文章', '生成介绍', '整理文集名称']
              ).map((label, i) => {
                const current =
                  job.status === 'writing'
                    ? Math.min(2, Math.floor(job.progress / 40))
                    : ['extracting', 'analyzing', 'outlining'].indexOf(job.status);
                return (
                  <div key={label} className={current >= i ? 'active' : ''}>
                    {current > i ? (
                      <CircleCheck size={16} />
                    ) : current === i ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <span className="stage-dot" />
                    )}
                    {label}
                  </div>
                );
              })}
            </div>
            <p className="generation-hint">
              {isExtension
                ? '可以离开此页，保持浏览器打开，任务会继续。'
                : '可以离开此页；保持本地服务运行，任务会继续。'}
            </p>
            {pollError && (
              <p className="error-message" role="alert">
                {pollError} 正在尝试重新连接…
              </p>
            )}
            <div className="generation-actions">
              <button className="text-button" onClick={onClose}>
                <ArrowLeft size={14} />
                回到文集
              </button>
              <button className="text-button" disabled={busy} onClick={() => void cancel()}>
                <X size={14} />
                停止整理
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
