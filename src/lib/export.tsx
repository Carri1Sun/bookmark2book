import { renderToStaticMarkup } from 'react-dom/server';
import { BookDocument } from '../components/BookDocument';
import type { Book } from '../../shared/types';
import bookStyles from '../styles/book.css?raw';
import themeStyles from '../styles/theme.css?raw';
import coverStyles from '../styles/cover.css?raw';
import fontStyles from '../styles/fonts.css?raw';
import fontLicense from '../../public/fonts/OFL.txt?raw';
export function buildBookHtml(book: Book, embeddedFonts = ''): string {
  const title = book.title.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><title>${title} · Tabbit 文集</title><style>/* ${fontLicense} */\n${embeddedFonts}\n${themeStyles}\n${coverStyles}\n${bookStyles}</style></head><body>${renderToStaticMarkup(<BookDocument book={book} />)}</body></html>`;
}
async function embedFonts(): Promise<string> {
  const paths = [
    ...new Set([...fontStyles.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1]!)),
  ];
  const embedded = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${path.slice(1)}`);
      if (!response.ok) throw new Error('无法加载导出字体。');
      const font = await response.blob();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('无法读取导出字体。'));
        reader.readAsDataURL(font);
      });
      return [path, data] as const;
    }),
  );
  return embedded.reduce((css, [path, data]) => css.replaceAll(path, data), fontStyles);
}
export async function downloadBook(book: Book) {
  const embeddedFonts = await embedFonts();
  const blob = new Blob([buildBookHtml(book, embeddedFonts)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${book.title.replace(/[\\/:*?"<>|\n]/g, '')}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
