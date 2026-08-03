import type { ProductCategory, SnkrdunkCard, StoredCardRef } from '../api/snkrdunk';

const FAVORITES_KEY = 'pokegre:favorites';
const RECENT_KEY = 'pokegre:recent';
const RECENT_LIMIT = 20;

// 예전엔 카드 객체를 통째로 저장해서 찜한 순간의 가격이 그대로 박제됐다(시세 앱인데
// 즐겨찾기 시세만 옛날 값이었다). 지금은 변하지 않는 값(ID·카테고리)만 남기고 가격은
// 볼 때마다 조회한다. 저장 용량도 카드당 262B → 40B 수준으로 줄었다.
function readRefs(key: string): StoredCardRef[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as (StoredCardRef | SnkrdunkCard)[];
    // 예전 형식(카드 통째로)이 남아 있을 수 있으니 필요한 필드만 뽑아 쓴다.
    // ⚠️ 같은 카드가 두 번 들어 있는 기록이 실제로 있다(즐겨찾기 3장이 6개로). 담고
    //    빼는 쪽은 중복을 거르지만, 한 번 이렇게 저장돼 버리면 스스로 낫지 않는다.
    //    화면은 카드 번호를 목록의 키로 쓰기 때문에 중복이 있으면 리액트가 카드를
    //    빠뜨리거나 겹쳐 그린다. 읽는 이 자리에서 거르면 어떤 경로로 생겼든 낫는다.
    const seen = new Set<number>();
    const out: StoredCardRef[] = [];
    for (const item of parsed) {
      if (typeof item?.apparelId !== 'number' || seen.has(item.apparelId)) continue;
      seen.add(item.apparelId);
      out.push({ apparelId: item.apparelId, category: item.category ?? 'card' });
    }
    return out;
  } catch {
    return [];
  }
}

function writeRefs(key: string, refs: StoredCardRef[]) {
  try {
    localStorage.setItem(key, JSON.stringify(refs));
  } catch {
    // 저장 공간이 꽉 찼거나 localStorage를 못 쓰는 환경이면 조용히 무시한다.
  }
}

function toRef(card: SnkrdunkCard): StoredCardRef {
  return { apparelId: card.apparelId, category: card.category };
}

export function getFavoriteRefs(): StoredCardRef[] {
  return readRefs(FAVORITES_KEY);
}

// 로그인해서 계정 것과 합친 결과를 이 기기에도 반영해둔다. 로그아웃해도 그대로
// 쓸 수 있게 하려는 것.
export function writeFavoriteRefs(refs: StoredCardRef[]) {
  writeRefs(FAVORITES_KEY, refs);
}

export function writeRecentRefs(refs: StoredCardRef[]) {
  writeRefs(RECENT_KEY, refs);
}

export function isFavorite(apparelId: number, favorites: { apparelId: number }[]): boolean {
  return favorites.some((c) => c.apparelId === apparelId);
}

export function toggleFavorite(card: SnkrdunkCard): StoredCardRef[] {
  const current = getFavoriteRefs();
  const exists = current.some((c) => c.apparelId === card.apparelId);
  const next = exists ? current.filter((c) => c.apparelId !== card.apparelId) : [toRef(card), ...current];
  writeRefs(FAVORITES_KEY, next);
  return next;
}

export function getRecentRefs(): StoredCardRef[] {
  return readRefs(RECENT_KEY);
}

export function addRecentlyViewed(card: SnkrdunkCard): StoredCardRef[] {
  const current = readRefs(RECENT_KEY).filter((c) => c.apparelId !== card.apparelId);
  const next = [toRef(card), ...current].slice(0, RECENT_LIMIT);
  writeRefs(RECENT_KEY, next);
  return next;
}

export type { ProductCategory };
