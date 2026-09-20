import type { ArticleEdit, Book, Bookmark, Job, Outline, Palette } from '../../shared/types';
import type { SettingsInput, SettingsStatus } from '../../shared/settings';
import type { BookFlags } from '../../shared/book-flags';
import { extensionContext, sendExtensionMessage } from '../extension/protocol';
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('本地服务未连接。请在项目目录运行 pnpm dev，再重试。');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '请求失败，请重试。');
  return body as T;
}
export const api = {
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
        })
      : request<Job>('/jobs', {
          method: 'POST',
          body: JSON.stringify({ bookmarks, palette, direction, collectionTitle, coverImage }),
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
