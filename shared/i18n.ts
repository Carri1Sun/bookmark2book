import { messages } from './locales';

export const locales = ['zh-CN', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'zh-CN';
export type MessageKey = keyof typeof messages;
export type MessageParams = Record<string, string | number>;
export interface MessageDescriptor {
  key: MessageKey;
  params?: MessageParams;
}

export function resolveLocale(value?: string | null): Locale {
  return typeof value !== 'string' || !value
    ? defaultLocale
    : value.toLowerCase().startsWith('zh')
      ? 'zh-CN'
      : 'en';
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const entry = messages[key];
  const template =
    locale === 'en' && params.count === 1 && 'enOne' in entry ? entry.enOne : entry[locale];
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined
      ? placeholder
      : typeof value === 'number'
        ? new Intl.NumberFormat(locale, { useGrouping: name === 'count' }).format(value)
        : value;
  });
}

export function message(key: MessageKey, params?: MessageParams): MessageDescriptor {
  return { key, ...(params ? { params } : {}) };
}

export function isMessage(value: unknown): value is MessageDescriptor {
  if (
    !value ||
    typeof value !== 'object' ||
    !('key' in value) ||
    typeof value.key !== 'string' ||
    !Object.hasOwn(messages, value.key)
  )
    return false;
  if (!('params' in value) || value.params === undefined) return true;
  return Boolean(
    value.params &&
    typeof value.params === 'object' &&
    !Array.isArray(value.params) &&
    Object.values(value.params).every(
      (item) => typeof item === 'string' || typeof item === 'number',
    ),
  );
}

// Carry stable keys across API/extension boundaries; never expose arbitrary provider errors.
export class AppError extends Error {
  readonly details: MessageDescriptor;
  constructor(key: MessageKey, params?: MessageParams) {
    super(translate(defaultLocale, key, params));
    this.name = 'AppError';
    this.details = message(key, params);
  }
}

export function errorDetails(error: unknown): MessageDescriptor {
  if (error instanceof AppError) return error.details;
  if (isMessage(error)) return error;
  if (error && typeof error === 'object' && 'issues' in error) {
    if (Array.isArray(error.issues)) {
      const issue = error.issues.find(
        (item: unknown) =>
          item && typeof item === 'object' && 'message' in item && isMessage({ key: item.message }),
      );
      if (issue) return message(issue.message);
    }
    return message('error.input');
  }
  if (error instanceof Error && error.name === 'TimeoutError') return message('error.timeout');
  return message('error.generic');
}

export function errorResponse(error: unknown, locale: Locale = defaultLocale) {
  const details = errorDetails(error);
  return { error: translate(locale, details.key, details.params), errorDetails: details };
}

export function jobMessage(locale: Locale | undefined, key: MessageKey, params?: MessageParams) {
  return {
    message: translate(locale || defaultLocale, key, params),
    messageDetails: message(key, params),
  };
}
