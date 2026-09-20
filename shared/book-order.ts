import type { Book } from './types';

export function compareBooks(a: Book, b: Book) {
  return (
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.createdAt.localeCompare(a.createdAt)
  );
}
