import type { Bookmark, BookmarkNode } from '../../shared/types';

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
export function flattenBookmarks(nodes: BookmarkNode[], path: string[] = []): Bookmark[] {
  return nodes.flatMap((node) =>
    node.url
      ? safeHttpUrl(node.url)
        ? [
            {
              id: node.id,
              title: node.title || new URL(node.url).hostname,
              url: node.url,
              folder: path.join(' / '),
            },
          ]
        : []
      : flattenBookmarks(node.children || [], node.title ? [...path, node.title] : path),
  );
}
export function deduplicateBookmarks(items: Bookmark[]): Bookmark[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const url = safeHttpUrl(item.url);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}
export function parseLinks(text: string): Bookmark[] {
  const urls = text.match(/https?:\/\/[^\s<>"\u3000]+/gi) || [];
  return deduplicateBookmarks(
    urls.flatMap((value, i) => {
      const url = safeHttpUrl(value.replace(/[，。；、）)]+$/, ''));
      return url
        ? [
            {
              id: `link-${i}`,
              title: new URL(url).hostname + new URL(url).pathname.slice(0, 100),
              url,
              folder: '粘贴的链接',
            },
          ]
        : [];
    }),
  );
}
export function parseBookmarkHtml(
  html: string,
  parser: DOMParser = new DOMParser(),
): BookmarkNode[] {
  const doc = parser.parseFromString(html, 'text/html');
  let nextId = 0;
  function walk(list: Element): BookmarkNode[] {
    return Array.from(list.children).flatMap((child) => {
      if (child.tagName === 'P') return walk(child);
      if (child.tagName !== 'DT') return [];
      const heading = Array.from(child.children).find((el) => el.tagName === 'H3');
      const link = Array.from(child.children).find((el) => el.tagName === 'A');
      if (link) {
        const url = safeHttpUrl(link.getAttribute('href') || '');
        return url
          ? [
              {
                id: `import-${nextId++}`,
                title: link.textContent?.trim() || new URL(url).hostname,
                url,
              },
            ]
          : [];
      }
      if (heading) {
        const nested =
          Array.from(child.children).find((el) => el.tagName === 'DL') ||
          (child.nextElementSibling?.tagName === 'DL' ? child.nextElementSibling : null);
        return [
          {
            id: `folder-${nextId++}`,
            title: heading.textContent?.trim() || '未命名文件夹',
            children: nested ? walk(nested) : [],
          },
        ];
      }
      return [];
    });
  }
  const root = doc.querySelector('dl');
  if (!root) throw new Error('没有找到书签。请选择浏览器导出的 HTML 书签文件。');
  const result = walk(root);
  if (!flattenBookmarks(result).length) throw new Error('文件中没有可用的网页书签。');
  return result;
}
export async function readBrowserBookmarks(): Promise<BookmarkNode[]> {
  if (!globalThis.chrome?.bookmarks?.getTree)
    throw new Error('请在 Tabbit 文集浏览器扩展中读取收藏夹，网页无法直接读取浏览器书签。');
  const tree = await chrome.bookmarks.getTree();
  return tree.length === 1 && !tree[0]!.title ? tree[0]!.children || [] : tree;
}
