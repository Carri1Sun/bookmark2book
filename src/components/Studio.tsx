import { useI18n, useMessageState } from '../lib/i18n';
import { AppError } from '../../shared/i18n';
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
  ImagePlus,
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
import { fileToCoverDataUrl } from '../lib/image';
import { BookCover, palettes } from './BookCover';
import { collectionDraftKey } from '../lib/storage-keys';
import './Studio.css';

type SourceMode = 'browser' | 'links';
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
  const { t } = useI18n();
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
      title={disabled ? t('studio.includedParent') : undefined}
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
  const { t } = useI18n();
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
            aria-label={t(open ? 'studio.collapse' : 'studio.expand', { title: node.title })}
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
          label={t('studio.selectFolder', { title: node.title })}
        />
        <button className="folder-name" onClick={() => onActivate(node.id)}>
          <Folder size={14} />
          <span>{node.title || t('studio.bookmarks')}</span>
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
  const { t, locale } = useI18n();
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
  const [coverImage, setCoverImage] = useState('');
  const [error, setError] = useMessageState();
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [articles, setArticles] = useState<ArticleEdit[]>([]);
  const [pollError, setPollError] = useMessageState();
  useEffect(() => {
    setNodes((current) =>
      current.map((node) =>
        node.id === 'links' && mode === 'links'
          ? { ...node, title: t('studio.pasted') }
          : node.id === 'retry'
            ? { ...node, title: t('studio.previous') }
            : node,
      ),
    );
  }, [locale]);
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
    if (next === 'browser') {
      setReadingBookmarks(true);
      try {
        useNodes(await readBrowserBookmarks());
      } catch (e) {
        setError(e);
      } finally {
        setReadingBookmarks(false);
      }
    }
  }
  useEffect(() => {
    if (isExtension)
      void readBrowserBookmarks()
        .then((data) => useNodes(data))
        .catch((e) => setError(e))
        .finally(() => setReadingBookmarks(false));
    const stored = localStorage.getItem(collectionDraftKey);
    if (stored)
      void api
        .job(stored)
        .then((draft) => {
          if (['completed', 'cancelled'].includes(draft.status)) {
            localStorage.removeItem(collectionDraftKey);
            return;
          }
          setJob(draft);
          setPalette(draft.palette);
          setDirection(draft.direction);
          setCollectionTitle(draft.collectionTitle || '');
          setCoverImage(draft.coverImage || '');
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
          localStorage.removeItem(collectionDraftKey);
          onComplete(next.bookId);
          return;
        }
        if (['failed', 'cancelled'].includes(next.status)) {
          localStorage.removeItem(collectionDraftKey);
          return;
        }
        if (workingStatuses.includes(next.status)) timeout = setTimeout(poll, 1500);
      } catch (e) {
        if (stopped) return;
        setPollError(e);
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
        throw new AppError('error.pagePermission');
      const next = await api.create(
        picked,
        palette,
        direction,
        collectionTitle,
        coverImage || undefined,
      );
      setJob(next);
      localStorage.setItem(collectionDraftKey, next.id);
    } catch (e) {
      setError(e);
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
        localStorage.removeItem(collectionDraftKey);
        onComplete(next.bookId);
      } else {
        setJob(next);
      }
    } catch (e) {
      setError(e);
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
      localStorage.removeItem(collectionDraftKey);
    } catch (e) {
      setError(e);
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
            title: t('studio.previous'),
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
    <div className="studio studio-compact page-width">
      <div className="studio-heading">
        <div className="studio-steps">
          {[t('studio.choose'), t('studio.review'), t('studio.save')].map((label, i) => (
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
            <p>{t('studio.chooseHint')}</p>
          </div>
          <div className="studio-grid">
            <section className="source-panel">
              <div className="source-tabs" role="tablist" aria-label={t('studio.source')}>
                {(
                  [
                    ['browser', t('studio.browser'), BookOpen],
                    ['links', t('studio.links'), Link],
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
                  <label htmlFor="links">{t('studio.linksLabel')}</label>
                  <textarea
                    id="links"
                    value={links}
                    placeholder={t('studio.linksExample')}
                    onChange={(event) => {
                      setLinks(event.target.value);
                      useNodes(
                        [
                          {
                            id: 'links',
                            title: t('studio.pasted'),
                            children: parseLinks(event.target.value),
                          },
                        ],
                        true,
                      );
                    }}
                  />
                  <p>{t('studio.linksHint')}</p>
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
                      ? t('studio.readingBookmarks')
                      : isExtension
                        ? t('studio.noBookmarks')
                        : t('studio.useExtension')}
                  </h3>
                  {!readingBookmarks && (
                    <p>
                      {isExtension
                        ? t('studio.addBookmarksHint')
                        : t('studio.installHint', { name: t('brand.name') })}
                    </p>
                  )}
                  {!isExtension && (
                    <a className="button secondary" href="/api/extension">
                      {t('studio.download')}
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
                        aria-label={t('common.searchBookmarks')}
                        placeholder={t('studio.searchPlaceholder')}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <span>{t('common.bookmarks', { count: all.length })}</span>
                  </div>
                  <div className="bookmark-browser">
                    <aside className="folder-sidebar">
                      <button
                        className={`all-folders ${activeFolder === 'all' ? 'active' : ''}`}
                        onClick={() => setActiveFolder('all')}
                      >
                        <BookOpen size={15} />
                        {t('studio.allBookmarks')}
                        <span>{all.length}</span>
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
                        <span>
                          {activeNode ? t('studio.folderPages') : t('studio.allBookmarks')}
                        </span>
                        <small>{t('common.items', { count: visible.length })}</small>
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
                          {pickedIds.has(item.id) && (
                            <em className="bookmark-included">{t('studio.included')}</em>
                          )}
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t('common.open', { title: item.title })}
                            onClick={(event) => event.stopPropagation()}
                          >
                            ↗
                          </a>
                        </div>
                      ))}
                      {!visible.length && <p className="no-search">{t('studio.noMatch')}</p>}
                    </div>
                  </div>
                  <div className="source-footer">
                    <Check size={14} />
                    <span>{t('studio.selectionCount', { count: picked.length })}</span>
                    <button className="text-button" onClick={() => setSelectedFolders(new Set())}>
                      {t('common.clearSelection')}
                    </button>
                  </div>
                </>
              )}
            </section>
            <aside className="studio-settings">
              <div className="settings-preview">
                <BookCover
                  title={collectionTitle || t('studio.coverPreview')}
                  palette={palette}
                  variant={Object.keys(palettes).indexOf(palette)}
                  image={coverImage || undefined}
                />
              </div>
              <label className="collection-name-field">
                {t('common.collectionName')}
                <span>{t('common.optional')}</span>
                <input
                  value={collectionTitle}
                  maxLength={60}
                  placeholder={t('studio.namePlaceholder')}
                  onChange={(event) => setCollectionTitle(event.target.value)}
                />
              </label>
              <fieldset className="palette-field">
                <legend>{t('studio.cover')}</legend>
                <div className="palette-options">
                  {Object.entries(palettes).map(([value, color]) => (
                    <button
                      key={value}
                      className={!coverImage && palette === value ? 'selected' : ''}
                      style={{ background: color.background, color: color.ink }}
                      onClick={() => {
                        setPalette(value as Palette);
                        setCoverImage('');
                      }}
                      aria-label={t('studio.preset', { color: t(color.name) })}
                      title={t('studio.preset', { color: t(color.name) })}
                      aria-pressed={!coverImage && palette === value}
                    >
                      {!coverImage && palette === value && <Check size={15} />}
                    </button>
                  ))}
                  <label
                    className={`cover-image-button${coverImage ? ' selected' : ''}`}
                    title={coverImage ? t('studio.photoSelected') : t('studio.photoChoose')}
                  >
                    {coverImage ? (
                      <Check size={13} aria-hidden="true" />
                    ) : (
                      <ImagePlus size={13} aria-hidden="true" />
                    )}
                    {t('studio.photo')}
                    <input
                      type="file"
                      accept="image/*"
                      aria-label={coverImage ? t('studio.photoReplace') : t('studio.photoSelect')}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        try {
                          setCoverImage(await fileToCoverDataUrl(file));
                        } catch (e) {
                          setError(e);
                        }
                      }}
                    />
                  </label>
                </div>
              </fieldset>
              <label className="direction-field">
                {t('studio.direction')}
                <span>{t('common.optional')}</span>
                <textarea
                  maxLength={1000}
                  value={direction}
                  onChange={(event) => setDirection(event.target.value)}
                  placeholder={t('studio.directionPlaceholder')}
                />
              </label>
            </aside>
          </div>
          <div className="studio-bottom">
            <div className="studio-feedback" aria-live="polite">
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <p>
                {picked.length > 500
                  ? t('studio.tooMany')
                  : picked.length
                    ? ''
                    : t('studio.selectOne')}
              </p>
            </div>
            <div className="studio-footer-actions">
              <button className="button secondary" disabled={busy} onClick={onClose}>
                {t('studio.cancelCreate')}
              </button>
              <button
                className="button primary"
                disabled={!picked.length || picked.length > 500 || busy}
                onClick={() => void start()}
              >
                {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{' '}
                {t('studio.generate')}
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </>
      ) : job.status === 'outline_ready' && outline ? (
        <>
          <div className="studio-intro">
            <p>{t('studio.reviewHint')}</p>
          </div>
          <div className="outline-grid">
            <section className="outline-editor">
              <label>
                {t('common.collectionName')}
                <input
                  className="title-edit"
                  maxLength={60}
                  value={outline.title}
                  onChange={(event) => setOutline({ ...outline, title: event.target.value })}
                />
              </label>
              <div className="outline-list-heading">
                <span>{t('studio.includedPages')}</span>
                <span>{t('common.items', { count: articles.length })}</span>
              </div>
              <div className="article-review-list">
                {articles.map((article, index) => (
                  <article className="article-review-row" key={article.id}>
                    <div className="article-review-fields">
                      {folderById.get(article.id) && (
                        <small className="article-folder-tag">{folderById.get(article.id)}</small>
                      )}
                      <input
                        aria-label={t('studio.pageTitle', { index: index + 1 })}
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
                        {t('studio.aiIntroduction')}
                        <textarea
                          aria-label={t('studio.pageIntroduction', { index: index + 1 })}
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
                        aria-label={t('studio.moveUp', { index: index + 1 })}
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
                        aria-label={t('studio.moveDown', { index: index + 1 })}
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
              <BookCover title={outline.title} palette={palette} image={coverImage || undefined} />
              <div className="source-report">
                <h3>{t('studio.readingStatus')}</h3>
                {job.sources.map((source) => (
                  <div key={source.id}>
                    <span
                      className={`source-dot ${source.pageAnalysis?.basis === 'blocked' ? 'unavailable' : source.status}`}
                    />
                    <span>{source.title}</span>
                    <small>
                      {source.pageAnalysis?.basis === 'blocked'
                        ? t('studio.blocked')
                        : (
                            {
                              full: t('studio.full'),
                              excerpt: t('studio.excerpt'),
                              metadata: t('studio.metadata'),
                              unavailable: t('studio.unavailable'),
                            } as const
                          )[source.status]}
                    </small>
                  </div>
                ))}
              </div>
            </aside>
          </div>
          <div className="studio-bottom">
            <div className="studio-feedback" aria-live="polite">
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="studio-footer-actions">
              <button className="button secondary" disabled={busy} onClick={() => void cancel()}>
                {t('studio.cancelDraft')}
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
                {t('studio.save')}
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </>
      ) : ['failed', 'cancelled'].includes(job.status) ? (
        <section className="job-result">
          <h1>{job.status === 'cancelled' ? t('studio.cancelled') : t('studio.failed')}</h1>
          <p role="alert">
            {job.errorDetails
              ? t(job.errorDetails.key, job.errorDetails.params)
              : job.messageDetails
                ? t(job.messageDetails.key, job.messageDetails.params)
                : job.error || job.message}
          </p>
          <button className="button primary" onClick={reset}>
            {t('studio.reselect')}
            <ArrowRight size={16} />
          </button>
        </section>
      ) : (
        <section className="generation-view" aria-live="polite">
          <div className="generation-copy">
            <h1>{job.status === 'writing' ? t('studio.saving') : t('studio.generating')}</h1>
            <p>
              {job.messageDetails
                ? t(job.messageDetails.key, job.messageDetails.params)
                : job.message}
            </p>
            <div
              className="progress-track"
              role="progressbar"
              aria-label={t('studio.progress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress}
            >
              <div style={{ width: `${job.progress}%` }} />
            </div>
            <div className="progress-caption">
              <span>
                {job.status === 'writing' ? t('studio.savePages') : t('studio.readAndIntroduce')}
              </span>
              <span>{job.progress}%</span>
            </div>
            <div className="generation-stages">
              {(job.status === 'writing'
                ? [t('studio.review'), t('studio.keepLinks'), t('studio.save')]
                : [t('studio.readPages'), t('studio.analyze'), t('studio.name')]
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
              {isExtension ? t('studio.keepBrowser') : t('studio.keepServer')}
            </p>
            {pollError && (
              <p className="error-message" role="alert">
                {pollError} {t('common.reconnecting')}
              </p>
            )}
            <div className="generation-actions">
              <button className="text-button" onClick={onClose}>
                <ArrowLeft size={14} />
                {t('common.back')}
              </button>
              <button className="text-button" disabled={busy} onClick={() => void cancel()}>
                <X size={14} />
                {t('studio.stop')}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
