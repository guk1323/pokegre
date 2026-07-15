import type { SnkrdunkCard } from '../api/snkrdunk';

const FAVORITES_KEY = 'pokegre:favorites';
const RECENT_KEY = 'pokegre:recent';
const RECENT_LIMIT = 20;

function readList(key: string): SnkrdunkCard[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: SnkrdunkCard[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // 저장 공간이 꽉 찼거나 localStorage를 못 쓰는 환경이면 조용히 무시한다.
  }
}

export function getFavorites(): SnkrdunkCard[] {
  return readList(FAVORITES_KEY);
}

export function isFavorite(apparelId: number, favorites: SnkrdunkCard[]): boolean {
  return favorites.some((c) => c.apparelId === apparelId);
}

export function toggleFavorite(card: SnkrdunkCard): SnkrdunkCard[] {
  const current = getFavorites();
  const exists = current.some((c) => c.apparelId === card.apparelId);
  const next = exists ? current.filter((c) => c.apparelId !== card.apparelId) : [card, ...current];
  writeList(FAVORITES_KEY, next);
  return next;
}

export function getRecentlyViewed(): SnkrdunkCard[] {
  return readList(RECENT_KEY);
}

export function addRecentlyViewed(card: SnkrdunkCard): SnkrdunkCard[] {
  const current = readList(RECENT_KEY).filter((c) => c.apparelId !== card.apparelId);
  const next = [card, ...current].slice(0, RECENT_LIMIT);
  writeList(RECENT_KEY, next);
  return next;
}
