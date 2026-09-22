export interface PageMetadata {
  title: string;
  description: string;
  siteName: string;
  declaredType: string;
  headings: string[];
}

export function readPageMetadata(doc: Document): PageMetadata {
  const clean = (value: string | null | undefined, limit: number) =>
    (value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const meta = (selector: string, limit: number) =>
    clean(doc.querySelector(selector)?.getAttribute('content'), limit);
  return {
    title: clean(doc.title, 500),
    description: meta('meta[name="description"],meta[property="og:description"]', 1200),
    siteName: meta('meta[property="og:site_name"]', 120),
    declaredType: meta('meta[property="og:type"]', 80),
    headings: Array.from(doc.querySelectorAll('h1,h2'))
      .filter((node) => !node.closest('nav,footer,aside,[hidden],[aria-hidden="true"]'))
      .slice(0, 12)
      .map((node) => clean(node.textContent, 160))
      .filter(Boolean),
  };
}
