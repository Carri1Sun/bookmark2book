import { useEffect, useRef, useState } from 'react';
import type { CoverMode, SourceImages } from '../../shared/page-images';
import { safeImageData } from '../../shared/page-images';
import { ensureImages, resolveImages } from '../lib/page-images';

export function PageCover({
  bookId,
  sourceId,
  title,
  index,
  mode,
  images,
  embedded,
  live = false,
}: {
  bookId: string;
  sourceId: string;
  title: string;
  index: number;
  mode: CoverMode;
  images?: SourceImages;
  embedded?: Partial<Record<CoverMode, string>>;
  live?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [urls, setUrls] = useState(embedded || {});
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    if (!live || !ref.current) return;
    let cancelled = false;
    const load = async () => {
      const stored = await resolveImages(images);
      if (!cancelled) setUrls(stored);
      try {
        const current = await ensureImages(bookId, sourceId, images);
        const fresh = await resolveImages(current);
        if (!cancelled) setUrls(fresh);
      } catch {
        /* A missing cover never blocks reading. */
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [bookId, sourceId, live, images?.preview, images?.screenshot]);
  const preferred = [mode, mode === 'preview' ? 'screenshot' : 'preview'] as const;
  const kind = preferred.find((kind) => safeImageData(urls[kind]) && !failed.includes(urls[kind]!));
  const url = kind ? urls[kind] : undefined;
  return (
    <div
      ref={ref}
      className={`page-cover notebook-tone-${index % 5}${url ? ' has-image' : ''}`}
      data-cover-kind={kind || 'fallback'}
    >
      <div className="page-cover-fallback" aria-hidden="true">
        <span className="page-cover-monogram">{title.trim().slice(0, 1).toLocaleUpperCase()}</span>
        <i />
        <i />
        <i />
      </div>
      {url && (
        <img
          key={url}
          src={url}
          alt=""
          decoding="async"
          onError={() => setFailed((previous) => [...previous, url])}
        />
      )}
      <span className="page-cover-sheen" aria-hidden="true" />
    </div>
  );
}
