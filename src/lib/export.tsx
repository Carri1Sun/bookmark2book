import { renderToStaticMarkup } from 'react-dom/server';
import { BookDocument } from '../components/BookDocument';
import type { Book } from '../../shared/types';
import bookStyles from '../styles/book.css?raw';
import coverStyles from '../styles/cover.css?raw';
export function buildBookHtml(book: Book): string {
  const title = book.title.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'"><title>${title} · 拾页</title><style>${coverStyles}\n${bookStyles}</style></head><body>${renderToStaticMarkup(<BookDocument book={book} />)}</body></html>`;
}
export function downloadBook(book: Book) {
  const blob = new Blob([buildBookHtml(book)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${book.title.replace(/[\\/:*?"<>|\n]/g, '')}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
