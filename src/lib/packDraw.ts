// 팩 한 개를 뽑는 순수 로직. 서버(server/api.ts)가 이걸로 뽑아서 결과를 내려준다 —
// 화면에서 뽑으면 예산·앨범을 얼마든지 조작할 수 있어서 뽑기 자체를 서버에 뒀다.
import { GOD_PACK_RATE, GOD_TIERS, type RateProfile } from './packSets.ts';

export type PackCard = { n: string; name: string; img?: string; r?: string };

// 화면에 등급을 표시할 때 쓰는 순위표. 여기 없는 등급(샤이니 등)은 확률 계산이
// 어긋나므로 아예 뽑기 대상에서 뺀다.
export const RARITY_RANK: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  'Double rare': 3,
  'ACE SPEC Rare': 4,
  'Illustration rare': 5,
  'Ultra Rare': 6,
  'Special illustration rare': 7,
  'Hyper rare': 8,
};
export const rankOf = (r?: string) => RARITY_RANK[r ?? ''] ?? 0;
export const usableCards = (cards: PackCard[]) => cards.filter((c) => c.r && c.r in RARITY_RANK);

const randOf = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

function groupByRarity(cards: PackCard[]) {
  const pools: Record<string, PackCard[]> = {};
  for (const c of cards) (pools[c.r ?? 'Common'] ??= []).push(c);
  return pools;
}
const cardsFlat = (pools: Record<string, PackCard[]>) => Object.values(pools).flat();

// 슬롯 하나를 실측 확률로 굴린다. rolls를 순서대로 판정하고 다 빗나가면 fallback(일반 카드).
// taken은 이 팩에서 이미 뽑힌 번호. 겹침은 fallback에서만 생기므로 fallback만 걸러낸다
// (등급 판정을 통째로 다시 굴리면 상위 등급 확률이 올라가 버린다).
function rollSlot(
  rolls: [string, number][],
  pools: Record<string, PackCard[]>,
  fallback: PackCard[],
  taken: Set<string>,
): PackCard {
  const left = fallback.filter((c) => !taken.has(c.n));
  const pick = left.length ? left : fallback;
  let x = Math.random();
  for (const [tier, p] of rolls) {
    if (x < p) {
      const pool = (pools[tier] ?? []).filter((c) => !taken.has(c.n));
      if (pool.length) return randOf(pool);
      return randOf(pick.length ? pick : cardsFlat(pools));
    }
    x -= p;
  }
  return randOf(pick.length ? pick : cardsFlat(pools));
}

// 풀에서 서로 다른 카드 n장. 실제 팩처럼 같은 커먼이 겹치지 않게 한다.
function drawDistinct(pool: PackCard[], n: number): PackCard[] {
  if (pool.length <= n) return [...pool];
  const picked = new Set<number>();
  while (picked.size < n) picked.add(Math.floor(Math.random() * pool.length));
  return [...picked].map((i) => pool[i]);
}

// 갓팩: 팩 장수 그대로, 전부 AR 이상으로 채운다. 세트에 상위 등급이 모자라면 있는 만큼
// 채우고 나머지는 그 아래(더블레어)로 메운다.
function drawGodPack(pools: Record<string, PackCard[]>, size: number): PackCard[] {
  const top = GOD_TIERS.flatMap((t: string) => pools[t] ?? []);
  const pool = top.length >= size ? top : [...top, ...(pools['Double rare'] ?? []), ...(pools['Rare'] ?? [])];
  return drawDistinct(pool, size);
}

export type DrawResult = { cards: PackCard[]; god: boolean };

// 세트 프로필대로 한 팩을 뽑는다. 아주 낮은 확률로 갓팩이 나온다.
export function drawPack(cards: PackCard[], profile: RateProfile): DrawResult {
  const pools = groupByRarity(cards);
  const size = profile.commons + profile.uncommons + profile.slots.length;

  if (Math.random() < GOD_PACK_RATE) {
    const god = drawGodPack(pools, size);
    // 상위 등급이 거의 없는 세트에서 갓팩이 나오면 밋밋하니, 못 채우면 일반 팩으로 돌린다.
    if (god.length === size) return { cards: god, god: true };
  }

  const commons = pools['Common'] ?? cards;
  const uncommons = pools['Uncommon'] ?? commons;
  const cu = [...commons, ...uncommons];
  const out: PackCard[] = [...drawDistinct(commons, profile.commons), ...drawDistinct(uncommons, profile.uncommons)];
  const taken = new Set(out.map((c) => c.n));
  for (const slot of profile.slots) {
    const fb = slot.fb === 'rare' ? pools['Rare'] ?? uncommons : cu;
    const card = rollSlot(slot.rolls, pools, fb, taken);
    taken.add(card.n);
    out.push(card);
  }
  return { cards: out, god: false };
}
