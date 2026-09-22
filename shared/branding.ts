import { defaultLocale, translate, type Locale } from './i18n';

export const localizedProductName = (locale: Locale) => translate(locale, 'brand.name');
export const productName = localizedProductName(defaultLocale);
export const productId = 'tabbit-collections';
export const productDescription = translate(defaultLocale, 'brand.description');
export const extensionArchiveName = `${productId}-extension.zip`;
