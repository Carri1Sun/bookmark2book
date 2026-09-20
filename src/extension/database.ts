import type { Book, Job } from '../../shared/types';
import { applyBookFlags, bookFlagsSchema, type BookFlags } from '../../shared/book-flags';
import { compareBooks } from '../../shared/book-order';

export interface CollectionStore {
  jobs(): Promise<Job[]>;
  books(): Promise<Book[]>;
  saveJob(job: Job): Promise<void>;
  saveCollection(job: Job, book: Book): Promise<void>;
  removeBook(id: string): Promise<void>;
  updateBookFlags(id: string, flags: BookFlags): Promise<Book>;
}

export function createCollectionStore(name = 'bookmark-press'): CollectionStore {
  let opened: Promise<IDBDatabase> | undefined;
  function database() {
    return (opened ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('books', { keyPath: 'id' });
        request.result.createObjectStore('jobs', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        opened = undefined;
        reject(new Error('浏览器存储无法打开。'));
      };
    }));
  }
  async function records<T>(kind: 'jobs' | 'books'): Promise<T[]> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(kind, 'readonly').objectStore(kind).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(new Error('无法读取已保存的文集。'));
    });
  }
  async function mutate(kinds: string[], operation: (tx: IDBTransaction) => void): Promise<void> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(kinds, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('浏览器存储失败，请检查可用空间。'));
      tx.onerror = () => reject(new Error('浏览器存储失败，请检查可用空间。'));
      operation(tx);
    });
  }
  return {
    jobs: () => records<Job>('jobs'),
    books: async () => (await records<Book>('books')).sort(compareBooks),
    updateBookFlags: async (id, input) => {
      const flags = bookFlagsSchema.parse(input);
      const db = await database();
      return new Promise<Book>((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        const store = tx.objectStore('books');
        const request = store.get(id);
        let updated: Book;
        let failure = '浏览器存储失败，请重试。';
        request.onsuccess = () => {
          if (!request.result) {
            failure = '未找到这本文集。';
            tx.abort();
            return;
          }
          try {
            updated = applyBookFlags(request.result as Book, flags);
            store.put(updated);
          } catch (error) {
            failure = (error as Error).message;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve(updated);
        tx.onabort = tx.onerror = () => reject(new Error(failure));
      });
    },
    saveJob: (job) =>
      mutate(['jobs'], (tx) => {
        tx.objectStore('jobs').put(job);
      }),
    saveCollection: (job, book) =>
      mutate(['jobs', 'books'], (tx) => {
        tx.objectStore('jobs').put(job);
        tx.objectStore('books').put(book);
      }),
    removeBook: (id) =>
      mutate(['books'], (tx) => {
        tx.objectStore('books').delete(id);
      }),
  };
}
export const collectionStore = createCollectionStore();
