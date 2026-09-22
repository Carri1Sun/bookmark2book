import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  defaultLocale,
  errorDetails,
  isMessage,
  translate,
  type Locale,
  type MessageKey,
  type MessageParams,
} from '../../shared/i18n';
import { getUiLocale, saveUiLocale, syncUiLocale } from './locale';
import { uiLocaleKey } from './storage-keys';

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
  locale: defaultLocale,
  setLocale: () => {},
});

// Static locale is used by standalone HTML export and server-rendered tests.
export function I18nProvider({ children, locale }: { children: ReactNode; locale?: Locale }) {
  const [selected, setSelected] = useState(getUiLocale);
  const active = locale || selected;
  useEffect(() => {
    if (locale) return;
    const update = (event: Event) => setSelected((event as CustomEvent<Locale>).detail);
    const stored = (event: StorageEvent) => {
      if (event.key === uiLocaleKey || event.key === null) setSelected(syncUiLocale());
    };
    window.addEventListener('ui-locale-change', update);
    window.addEventListener('storage', stored);
    return () => {
      window.removeEventListener('ui-locale-change', update);
      window.removeEventListener('storage', stored);
    };
  }, [locale]);
  useEffect(() => {
    if (locale) return;
    document.documentElement.lang = active;
    document.title = translate(active, 'brand.name');
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', translate(active, 'brand.description'));
  }, [active, locale]);
  return (
    <LocaleContext.Provider value={{ locale: active, setLocale: saveUiLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(LocaleContext);
  return {
    ...context,
    t: (key: MessageKey, params?: MessageParams) => translate(context.locale, key, params),
  };
}

export function useMessageState() {
  const { locale } = useI18n();
  const [value, setValue] = useState<unknown>('');
  const details = isMessage(value) ? value : errorDetails(value);
  return [
    typeof value === 'string' ? value : translate(locale, details.key, details.params),
    setValue,
  ] as const;
}
