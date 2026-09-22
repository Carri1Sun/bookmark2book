export type CoverMode = 'preview' | 'screenshot';
export type DetailLayout = 'grid' | 'list';
export interface ImageCandidate {
  url: string;
  score: number;
}
export interface ImageAsset {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
}
export interface SourceImages {
  preview?: string;
  screenshot?: string;
  attemptedAt: string;
}
export type EmbeddedImages = Record<string, Partial<Record<CoverMode, string>>>;

export function safeImageData(value: unknown): value is string {
  return (
    typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

// Self-contained so exactly the same ranking runs on static and rendered DOMs.
export function readImageCandidates(doc: Document, pageUrl: string): ImageCandidate[] {
  const candidates = new Map<string, number>();
  let baseUrl = pageUrl;
  try {
    baseUrl = new URL(doc.querySelector('base[href]')?.getAttribute('href') || pageUrl, pageUrl)
      .href;
  } catch {
    /* Fall back to the actual document URL. */
  }
  const add = (raw: string | null | undefined, score: number) => {
    if (!raw) return;
    try {
      const url = new URL(raw, baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
      if (/\.(svg|ico)(?:[?#]|$)/i.test(url.href)) return;
      if (/(?:favicon|sprite|tracking|pixel|avatar|\/logos?\/)/i.test(url.pathname)) score -= 150;
      if (score > 0) candidates.set(url.href, Math.max(candidates.get(url.href) || 0, score));
    } catch {
      /* Invalid publisher metadata is ignored. */
    }
  };
  doc
    .querySelectorAll(
      'meta[property="og:image"],meta[property="og:image:url"],meta[property="og:image:secure_url"]',
    )
    .forEach((el) => add(el.getAttribute('content'), 120));
  doc
    .querySelectorAll(
      'meta[name="twitter:image"],meta[property="twitter:image"],meta[name="twitter:image:src"]',
    )
    .forEach((el) => add(el.getAttribute('content'), 110));
  doc.querySelectorAll('link[rel="image_src"]').forEach((el) => add(el.getAttribute('href'), 100));
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    if ((el.textContent || '').length > 100_000) return;
    const visit = (value: unknown, depth = 0) => {
      if (!value || depth > 5) return;
      if (Array.isArray(value)) {
        value.slice(0, 20).forEach((v) => visit(v, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const images = [record.image, record.thumbnailUrl].flat().slice(0, 5);
      images.forEach((image) => {
        if (typeof image === 'string') add(image, 95);
        else if (image && typeof image === 'object') {
          const item = image as Record<string, unknown>;
          if (typeof item.url === 'string') add(item.url, 95);
          if (typeof item.contentUrl === 'string') add(item.contentUrl, 95);
        }
      });
      if (record['@graph']) visit(record['@graph'], depth + 1);
    };
    try {
      visit(JSON.parse(el.textContent || ''));
    } catch {
      /* Malformed JSON-LD. */
    }
  });
  [...doc.querySelectorAll('img')].slice(0, 160).forEach((img, index) => {
    const width = img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const height = img.naturalHeight || Number(img.getAttribute('height')) || 0;
    if (
      (width && width < 180) ||
      (height && height < 100) ||
      (width && height && width / height > 4)
    )
      return;
    if (/logo|avatar|icon|badge/i.test(`${img.alt} ${img.className} ${img.id}`)) return;
    const score =
      45 +
      (img.closest('main,article,[role="main"]') ? 25 : 0) +
      Math.min(18, (width * height) / 40_000) -
      Math.min(20, index);
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    const largest = srcset
      ?.split(',')
      .map((entry) => entry.trim().split(/\s+/))
      .sort((a, b) => parseFloat(b[1] || '1') - parseFloat(a[1] || '1'))[0]?.[0];
    add(
      img.currentSrc ||
        largest ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('src'),
      score,
    );
  });
  return [...candidates]
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export function imagesAreFresh(images?: SourceImages): boolean {
  if (!images) return false;
  if (images.preview && images.screenshot) return true;
  return Date.now() - Date.parse(images.attemptedAt) < 6 * 60 * 60 * 1000;
}

/** Bound browser/render work independently of how many cards enter the viewport. */
export function createImageQueue(concurrency = 2) {
  let active = 0;
  const pending: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => pending.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      const next = pending.shift();
      if (next) next();
      else active--;
    }
  };
}
