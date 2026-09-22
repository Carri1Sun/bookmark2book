import { useSyncExternalStore } from 'react';
import type { CoverMode, DetailLayout } from '../../shared/page-images';
import { coverModeKey, detailLayoutKey } from './storage-keys';

const event = 'tabbit-display-preferences';
const memory = new Map<string, string>();
function read(key: string) {
  if (memory.has(key)) return memory.get(key);
  try {
    return localStorage.getItem(key) || memory.get(key);
  } catch {
    return memory.get(key);
  }
}
function subscribe(listener: () => void) {
  const changed = (event: StorageEvent) => {
    if (event.key) memory.delete(event.key);
    else memory.clear();
    listener();
  };
  window.addEventListener(event, listener);
  window.addEventListener('storage', changed);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener('storage', changed);
  };
}
function save(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session preference still works. */
  }
  window.dispatchEvent(new Event(event));
}
export const getCoverMode = (): CoverMode =>
  read(coverModeKey) === 'screenshot' ? 'screenshot' : 'preview';
export const getDetailLayout = (): DetailLayout =>
  read(detailLayoutKey) === 'list' ? 'list' : 'grid';
export function useCoverMode() {
  return [
    useSyncExternalStore(subscribe, getCoverMode, () => 'preview' as const),
    (mode: CoverMode) => save(coverModeKey, mode),
  ] as const;
}
export function useDetailLayout() {
  return [
    useSyncExternalStore(subscribe, getDetailLayout, () => 'grid' as const),
    (layout: DetailLayout) => save(detailLayoutKey, layout),
  ] as const;
}
