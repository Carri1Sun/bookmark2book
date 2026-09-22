import { AppError, defaultLocale, translate, type Locale } from '../../shared/i18n';
import { I18nProvider } from './i18n';
import { getUiLocale } from './locale';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookDocument } from '../components/BookDocument';
import type { Book } from '../../shared/types';
import badgeStyles from '../styles/badges.css?raw';
import bookStyles from '../styles/book.css?raw';
import themeStyles from '../styles/theme.css?raw';
import coverStyles from '../styles/cover.css?raw';
import fontStyles from '../styles/fonts.css?raw';
import fontLicense from '../../public/fonts/OFL.txt?raw';
import pageCardStyles from '../styles/page-cards.css?raw';
import type { CoverMode, DetailLayout, EmbeddedImages } from '../../shared/page-images';
import { getCoverMode, getDetailLayout } from './display-preferences';
import { resolveImages } from './page-images';
import { api } from './api';
export function buildBookHtml(
  book: Book,
  embeddedFonts = '',
  locale: Locale = book.locale || defaultLocale,
  display: { coverMode?: CoverMode; layout?: DetailLayout; images?: EmbeddedImages } = {},
): string {
  const title = book.title.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
  return `<!doctype html><html lang="${locale}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><title>${title} · ${translate(locale, 'brand.name')}</title><style>/* ${fontLicense} */\n${embeddedFonts}\n${themeStyles}\n${coverStyles}\n${badgeStyles}\n${bookStyles}\n${pageCardStyles}</style></head><body>${renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <BookDocument
        book={book}
        coverMode={display.coverMode}
        layout={display.layout}
        embeddedImages={display.images}
      />
    </I18nProvider>,
  )}</body></html>`;
}
async function embedFonts(): Promise<string> {
  const paths = [
    ...new Set([...fontStyles.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1]!)),
  ];
  const embedded = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${path.slice(1)}`);
      if (!response.ok) throw new AppError('error.fontLoad');
      const font = await response.blob();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new AppError('error.fontRead'));
        reader.readAsDataURL(font);
      });
      return [path, data] as const;
    }),
  );
  return embedded.reduce((css, [path, data]) => css.replaceAll(path, data), fontStyles);
}
export async function downloadBook(book: Book) {
  const [embeddedFonts, books] = await Promise.all([embedFonts(), api.books()]);
  const current = books.find((item) => item.id === book.id) || book;
  const images: EmbeddedImages = {};
  // Embed cached assets only. Export never launches hundreds of new capture tabs.
  for (const source of current.sources) images[source.id] = await resolveImages(source.images);
  const blob = new Blob(
    [
      buildBookHtml(current, embeddedFonts, getUiLocale(), {
        coverMode: getCoverMode(),
        layout: getDetailLayout(),
        images,
      }),
    ],
    {
      type: 'text/html;charset=utf-8',
    },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${book.title.replace(/[\\/:*?"<>|\n]/g, '')}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
