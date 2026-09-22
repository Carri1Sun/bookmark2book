import { AppError, isMessage } from '../../shared/i18n';
import { getUiLocale } from './locale';
import type { ArticleEdit, Book, Bookmark, Job, Outline, Palette } from '../../shared/types';
import type { SettingsInput, SettingsStatus } from '../../shared/settings';
import type { BookFlags } from '../../shared/book-flags';
import { extensionContext, sendExtensionMessage } from '../extension/protocol';
import type { ImageAsset, SourceImages } from '../../shared/page-images';
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-UI-Language': getUiLocale(),
        ...options?.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new AppError('error.localService');
  }
  const body = await response.json().catch(() => {
    throw new AppError('error.request');
  });
  if (!response.ok)
    throw isMessage(body.errorDetails)
      ? new AppError(body.errorDetails.key, body.errorDetails.params)
      : new AppError('error.request');
  return body as T;
}
export const api = {
  sourceImages: (id: string, sourceId: string) =>
    extensionContext
      ? sendExtensionMessage<SourceImages>('background', 'books.images', { id, sourceId })
      : request<SourceImages>(`/books/${id}/sources/${encodeURIComponent(sourceId)}/images`, {
          method: 'POST',
          body: '{}',
        }),
  imageAsset: (id: string) =>
    extensionContext
      ? sendExtensionMessage<ImageAsset | undefined>('background', 'images.get', { id })
      : request<ImageAsset>(`/images/${id}`),
  health: () =>
    extensionContext
      ? sendExtensionMessage<{ configured: boolean; model: string }>('background', 'health')
      : request<{ configured: boolean; model: string }>('/health'),
  books: () =>
    extensionContext
      ? sendExtensionMessage<Book[]>('background', 'books.list')
      : request<Book[]>('/books'),
  updateBookFlags: (id: string, flags: BookFlags) =>
    extensionContext
      ? sendExtensionMessage<Book>('background', 'books.flags', { id, flags })
      : request<Book>(`/books/${id}/flags`, { method: 'POST', body: JSON.stringify(flags) }),
  generateIntroduction: (id: string) =>
    extensionContext
      ? sendExtensionMessage<{ introduction: string }>('background', 'books.introduction', {
          id,
          locale: getUiLocale(),
        })
      : request<{ introduction: string }>(`/books/${id}/introduction`, {
          method: 'POST',
          body: JSON.stringify({ locale: getUiLocale() }),
        }),
  settings: () =>
    extensionContext
      ? sendExtensionMessage<SettingsStatus>('background', 'settings.get')
      : request<SettingsStatus>('/settings'),
  saveSettings: (input: SettingsInput) =>
    extensionContext
      ? sendExtensionMessage<SettingsStatus>('background', 'settings.save', input)
      : request<SettingsStatus>('/settings', { method: 'POST', body: JSON.stringify(input) }),
  testSettings: (input: SettingsInput) =>
    extensionContext
      ? sendExtensionMessage<{ ok: true }>('background', 'settings.test', input)
      : request<{ ok: true }>('/settings/test', { method: 'POST', body: JSON.stringify(input) }),
  allowSites: (urls: string[]) => {
    if (!extensionContext) return Promise.resolve(true);
    const origins = [
      ...new Set(
        urls.map((value) => {
          const url = new URL(value);
          return `${url.protocol}//${url.hostname}/*`;
        }),
      ),
    ];
    return chrome.permissions.request({ origins });
  },
  create: (
    bookmarks: Bookmark[],
    palette: Palette,
    direction: string,
    collectionTitle?: string,
    coverImage?: string,
  ) =>
    extensionContext
      ? sendExtensionMessage<Job>('background', 'jobs.create', {
          bookmarks,
          palette,
          direction,
          collectionTitle,
          coverImage,
          locale: getUiLocale(),
        })
      : request<Job>('/jobs', {
          method: 'POST',
          body: JSON.stringify({
            bookmarks,
            palette,
            direction,
            collectionTitle,
            coverImage,
            locale: getUiLocale(),
          }),
        }),
  job: async (id: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const job = extensionContext
      ? await sendExtensionMessage<Job>('background', 'jobs.get', { id })
      : await request<Job>(`/jobs/${id}`, { signal });
    signal?.throwIfAborted();
    return job;
  },
  write: (id: string, outline: Outline, articles?: ArticleEdit[]) =>
    extensionContext
      ? sendExtensionMessage<Job>('background', 'jobs.write', { id, value: { outline, articles } })
      : request<Job>(`/jobs/${id}/write`, {
          method: 'POST',
          body: JSON.stringify({ outline, articles }),
        }),
  cancel: (id: string) =>
    extensionContext
      ? sendExtensionMessage('background', 'jobs.cancel', { id })
      : request(`/jobs/${id}/cancel`, { method: 'POST', body: '{}' }),
  remove: (id: string) =>
    extensionContext
      ? sendExtensionMessage('background', 'books.remove', { id })
      : request(`/books/${id}`, { method: 'DELETE' }),
};
