import { AppError } from '../../shared/i18n';
import { collectionDatabaseName } from '../lib/storage-keys';
import type { Book, Job } from '../../shared/types';
import { applyBookFlags, bookFlagsSchema, type BookFlags } from '../../shared/book-flags';
import { compareBooks } from '../../shared/book-order';
import type { ImageAsset, SourceImages } from '../../shared/page-images';

export interface CollectionStore {
  jobs(): Promise<Job[]>;
  books(): Promise<Book[]>;
  saveJob(job: Job): Promise<void>;
  saveCollection(job: Job, book: Book): Promise<void>;
  removeBook(id: string): Promise<void>;
  updateBookFlags(id: string, flags: BookFlags): Promise<Book>;
  saveSourceImages(
    id: string,
    sourceId: string,
    images: SourceImages,
    assets: ImageAsset[],
  ): Promise<void>;
  imageAsset(id: string): Promise<ImageAsset | undefined>;
}

export function createCollectionStore(name = collectionDatabaseName): CollectionStore {
  let opened: Promise<IDBDatabase> | undefined;
  function database() {
    return (opened ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 2);
      request.onupgradeneeded = () => {
        for (const store of ['books', 'jobs', 'images']) {
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          opened = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        opened = undefined;
        reject(new AppError('error.storageOpen'));
      };
    }));
  }
  async function records<T>(kind: 'jobs' | 'books'): Promise<T[]> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(kind, 'readonly').objectStore(kind).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(new AppError('error.storageRead'));
    });
  }
  async function mutate(kinds: string[], operation: (tx: IDBTransaction) => void): Promise<void> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(kinds, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new AppError('error.storageSpace'));
      tx.onerror = () => reject(new AppError('error.storageSpace'));
      operation(tx);
    });
  }
  return {
    imageAsset: async (id) => {
      const db = await database();
      return new Promise((resolve, reject) => {
        const request = db.transaction('images', 'readonly').objectStore('images').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new AppError('error.storageRead'));
      });
    },
    saveSourceImages: (id, sourceId, images, assets) =>
      mutate(['books', 'images'], (tx) => {
        const books = tx.objectStore('books');
        const request = books.get(id);
        request.onsuccess = () => {
          const book = request.result as Book | undefined;
          const source = book?.sources.find((source) => source.id === sourceId);
          // A deletion while a capture is running must not resurrect the collection.
          if (!book || !source) return;
          const store = tx.objectStore('images');
          for (const kind of ['preview', 'screenshot'] as const) {
            if (source.images?.[kind] && source.images[kind] !== images[kind])
              store.delete(source.images[kind]!);
          }
          for (const asset of assets) store.put(asset);
          source.images = images;
          books.put(book);
        };
      }),
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
        let failure: unknown = new AppError('error.storageWrite');
        request.onsuccess = () => {
          if (!request.result) {
            failure = new AppError('error.bookNotFound');
            tx.abort();
            return;
          }
          try {
            updated = applyBookFlags(request.result as Book, flags);
            store.put(updated);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve(updated);
        tx.onabort = tx.onerror = () => reject(failure);
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
      mutate(['books', 'images'], (tx) => {
        const books = tx.objectStore('books');
        const request = books.get(id);
        request.onsuccess = () => {
          const book = request.result as Book | undefined;
          for (const source of book?.sources || []) {
            for (const kind of ['preview', 'screenshot'] as const)
              if (source.images?.[kind]) tx.objectStore('images').delete(source.images[kind]!);
          }
          books.delete(id);
        };
      }),
  };
}
export const collectionStore = createCollectionStore();
