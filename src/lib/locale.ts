import { defaultLocale, resolveLocale, type Locale } from '../../shared/i18n';
import { uiLocaleKey } from './storage-keys';
let sessionLocale: Locale | undefined;

export function getUiLocale(): Locale {
  if (sessionLocale) return sessionLocale;
  try {
    const saved = globalThis.localStorage?.getItem(uiLocaleKey);
    if (saved === 'zh-CN' || saved === 'en') return saved;
  } catch {
    /* A blocked storage must not prevent the app from opening. */
  }
  return typeof window === 'undefined'
    ? defaultLocale
    : resolveLocale(navigator.languages?.[0] || navigator.language);
}

export function saveUiLocale(locale: Locale) {
  sessionLocale = locale;
  try {
    localStorage.setItem(uiLocaleKey, locale);
  } catch {
    /* Keep the in-memory selection. */
  }
  window.dispatchEvent(new CustomEvent('ui-locale-change', { detail: locale }));
}

export function syncUiLocale() {
  sessionLocale = undefined;
  return getUiLocale();
}
