// 팩·박스를 뽑는 순수 로직. 서버(server/api.ts)가 이걸로 뽑아서 결과를 내려준다 —
// 화면에서 뽑으면 GP·앨범을 얼마든지 조작할 수 있어서 뽑기 자체를 서버에 뒀다.
import { GOD_TIERS, type RateProfile } from './packSets.ts';

// m: 반짝이 변형판. master=마스터볼 미러(일본판 151 박스당 1장), poke=몬스터볼 미러
// (일본판 151 팩당 1장), rev=리버스 홀로(북미판 팩당 2장).
export type MirrorFlag = 'master' | 'poke' | 'rev';
export type PackCard = { n: string; name: string; img?: string; r?: string; m?: MirrorFlag };
export type MirrorKind = 'jp151' | 'na' | 'prismatic';

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
  'Mega Ultra Rare': 9, // 메가 시리즈 전용 최상위(카드 전체 금박) — 세트당 1장
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

// 슬롯 하나를 확률표대로 굴린다. rolls를 순서대로 판정하고 다 빗나가면 fallback.
// taken은 이 팩에서 이미 뽑힌 번호(겹침 방지는 fallback에서만 — 등급 판정을 다시
// 굴리면 상위 등급 확률이 올라간다).
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

// 특정 등급을 강제로 뽑는다(박스 보장 봉입용). 그 등급이 세트에 없으면 fallback.
function forceTier(
  tier: string,
  pools: Record<string, PackCard[]>,
  fallback: PackCard[],
  taken: Set<string>,
): PackCard {
  const pool = (pools[tier] ?? []).filter((c) => !taken.has(c.n));
  if (pool.length) return randOf(pool);
  const left = fallback.filter((c) => !taken.has(c.n));
  return randOf(left.length ? left : fallback);
}

// 풀에서 서로 다른 카드 n장. 실제 팩처럼 같은 카드가 겹치지 않게 한다.
function drawDistinct(pool: PackCard[], n: number, taken?: Set<string>): PackCard[] {
  const usable = taken ? pool.filter((c) => !taken.has(c.n)) : pool;
  if (usable.length <= n) return [...usable];
  const picked = new Set<number>();
  while (picked.size < n) picked.add(Math.floor(Math.random() * usable.length));
  return [...picked].map((i) => usable[i]);
}

// 갓팩: 팩 장수 그대로, 전부 AR 이상. 상위 등급이 모자라면 아래 등급으로 메운다.
function drawGodPack(pools: Record<string, PackCard[]>, size: number): PackCard[] {
  const top = GOD_TIERS.flatMap((t: string) => pools[t] ?? []);
  const pool = top.length >= size ? top : [...top, ...(pools['Double rare'] ?? []), ...(pools['Rare'] ?? [])];
  return drawDistinct(pool, size);
}

export type DrawResult = { cards: PackCard[]; god: boolean };

type BuildOpts = {
  // 마지막 특수 슬롯에 이 등급을 강제(박스 보장). null이면 확률대로.
  forceLast?: string | null;
  // 일본판 151 전용: 첫 슬롯(AR 슬롯)을 AR로 강제할지.
  forceA?: boolean;
  // 미러 종류. jp151이면 미러 1장(master 지정 시 마스터볼), na면 리버스 2장.
  mirror?: MirrorKind;
  master?: boolean;
};

// 한 팩을 만든다. 미러/리버스는 커먼 자리 일부를 대체해 팩 장수를 지킨다:
// jp151(7장) = 커먼3 + 언커먼1 + 미러1 + 슬롯2 · na(10장) = 커먼3 + 언커먼3 + 리버스2 + 슬롯2.
function buildPack(cards: PackCard[], profile: RateProfile, opts: BuildOpts = {}): PackCard[] {
  const pools = groupByRarity(cards);
  const commons = pools['Common'] ?? cards;
  const uncommons = pools['Uncommon'] ?? commons;
  const cu = [...commons, ...uncommons];
  // 이 팩에 넣을 변형판 목록. jp151=미러 1장 · na=리버스 2장 ·
  // prismatic=몬스터볼 포일 1/3팩 + 마스터볼 포일 1/20팩(팩마다 있을 수도 없을 수도).
  const mirrorFlags: MirrorFlag[] =
    opts.mirror === 'jp151'
      ? [opts.master ? 'master' : 'poke']
      : opts.mirror === 'na'
        ? ['rev', 'rev']
        : opts.mirror === 'prismatic'
          ? [...(Math.random() < 1 / 20 ? (['master'] as const) : []), ...(Math.random() < 1 / 3 ? (['poke'] as const) : [])]
          : [];
  const mirrorCount = mirrorFlags.length;

  const out: PackCard[] = [
    ...drawDistinct(commons, Math.max(0, profile.commons - mirrorCount)),
    ...drawDistinct(uncommons, profile.uncommons),
  ];
  const taken = new Set(out.map((c) => c.n));

  // 미러/리버스/포일: 커먼~레어 풀에서 뽑아 변형판 표시를 붙인다.
  if (mirrorCount > 0) {
    const mirrorPool = [...cu, ...(pools['Rare'] ?? [])];
    for (let i = 0; i < mirrorCount; i++) {
      const base = drawDistinct(mirrorPool, 1, taken)[0];
      if (!base) break;
      taken.add(base.n);
      out.push({ ...base, m: mirrorFlags[i] });
    }
  }

  profile.slots.forEach((slot, si) => {
    const fb = slot.fb === 'rare' ? pools['Rare'] ?? uncommons : cu;
    const isLast = si === profile.slots.length - 1;
    let card: PackCard;
    if (si === 0 && profile.slots.length > 1 && opts.forceA) {
      card = forceTier('Illustration rare', pools, fb, taken);
    } else if (isLast && opts.forceLast) {
      card = forceTier(opts.forceLast, pools, fb, taken);
    } else {
      card = rollSlot(slot.rolls, pools, fb, taken);
    }
    taken.add(card.n);
    out.push(card);
  });
  return out;
}

// 세트 프로필대로 한 팩을 뽑는다. godRate(151류 특수팩만 >0)면 갓팩이 나올 수 있다.
export function drawPack(cards: PackCard[], profile: RateProfile, godRate = 0, mirror?: MirrorKind): DrawResult {
  const pools = groupByRarity(cards);
  const size = profile.commons + profile.uncommons + profile.slots.length;

  if (godRate > 0 && Math.random() < godRate) {
    const god = drawGodPack(pools, size);
    if (god.length === size) return { cards: god, god: true };
  }
  // 일본판 151 팩은 미러가 항상 1장 — 낱팩에서 마스터볼은 박스 확률(1/20)로 굴린다.
  const master = mirror === 'jp151' && Math.random() < 1 / 20;
  return { cards: buildPack(cards, profile, { mirror, master }), god: false };
}

// ── 박스 개봉 ─────────────────────────────────────────────────────────────
// 일본판은 실물처럼 박스 보장 봉입을 지킨다(사용자 제공 공식 스펙):
//   일반(30팩): AR 3장 + RR 4~5장 + SR이상 1장 + ACE 1장(수록 세트만)
//   151(20팩): AR 3장 + RR 4~5장 + SR이상 1장 + 마스터볼 미러 1장
// 북미판(36팩)은 보장이 없어 순수 독립시행이다. 갓팩은 박스 안에서도 팩별 독립 판정.
export type BoxGuarantee = 'jp' | 'jp151' | null;

export function drawBox(
  cards: PackCard[],
  profile: RateProfile,
  opts: { packs: number; guarantee: BoxGuarantee; godRate: number; mirror?: MirrorKind },
): { packs: DrawResult[]; god: boolean } {
  const pools = groupByRarity(cards);
  const size = profile.commons + profile.uncommons + profile.slots.length;

  const godIdx = new Set<number>();
  if (opts.godRate > 0) for (let i = 0; i < opts.packs; i++) if (Math.random() < opts.godRate) godIdx.add(i);

  const godOrNormal = (forced: BuildOpts): DrawResult => ({
    cards: buildPack(cards, profile, forced),
    god: false,
  });

  if (!opts.guarantee) {
    const out: DrawResult[] = [];
    for (let i = 0; i < opts.packs; i++) {
      if (godIdx.has(i)) {
        const god = drawGodPack(pools, size);
        out.push(god.length === size ? { cards: god, god: true } : godOrNormal({ mirror: opts.mirror }));
      } else out.push(godOrNormal({ mirror: opts.mirror }));
    }
    return { packs: out, god: out.some((p) => p.god) };
  }

  // 보장 슬롯 배정: 서로 다른 팩에 배치(한 팩의 특수 슬롯은 하나뿐이라).
  const free = [...Array(opts.packs).keys()].filter((i) => !godIdx.has(i));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const forcedLast = new Map<number, string>();
  const takeIdx = () => free.pop();

  // SR이상 1장 — 내부 배분은 확률표 비율 그대로(SAR ≈ 4.8박스당 1장, 금UR ≈ 12박스당 1장).
  const lastRolls = profile.slots[profile.slots.length - 1].rolls;
  const srRolls = lastRolls.filter(([t]) =>
    ['Mega Ultra Rare', 'Hyper rare', 'Special illustration rare', 'Ultra Rare'].includes(t),
  );
  const srTotal = srRolls.reduce((a, [, p]) => a + p, 0);
  let x = Math.random() * srTotal;
  let srTier = 'Ultra Rare';
  for (const [t, p] of srRolls) {
    if (x < p) {
      srTier = t;
      break;
    }
    x -= p;
  }
  const srIdx = takeIdx();
  if (srIdx !== undefined) forcedLast.set(srIdx, srTier);

  // RR 4~5장
  const rrCount = 4 + (Math.random() < 0.5 ? 1 : 0);
  for (let k = 0; k < rrCount; k++) {
    const i = takeIdx();
    if (i !== undefined) forcedLast.set(i, 'Double rare');
  }
  // ACE 1장(일반 박스, 수록 세트만)
  if (opts.guarantee === 'jp' && (pools['ACE SPEC Rare']?.length ?? 0) > 0) {
    const i = takeIdx();
    if (i !== undefined) forcedLast.set(i, 'ACE SPEC Rare');
  }
  // AR 3장 — 151은 전용 AR 슬롯(forceA, 다른 보장과 같은 팩이어도 됨), 일반은 특수 슬롯 배정.
  const arIdx = new Set<number>();
  for (let k = 0; k < 3; k++) {
    if (opts.guarantee === 'jp151') {
      const pool = [...Array(opts.packs).keys()].filter((i) => !godIdx.has(i) && !arIdx.has(i));
      if (pool.length) arIdx.add(randOf(pool));
    } else {
      const i = takeIdx();
      if (i !== undefined) forcedLast.set(i, 'Illustration rare');
    }
  }
  // 마스터볼 미러 1장(151). 갓팩으로 대체된 팩에는 미러가 없으니 일반 팩 중에서 고른다.
  const normals = [...Array(opts.packs).keys()].filter((i) => !godIdx.has(i));
  const masterIdx = opts.guarantee === 'jp151' && normals.length ? randOf(normals) : -1;

  const out: DrawResult[] = [];
  for (let i = 0; i < opts.packs; i++) {
    if (godIdx.has(i)) {
      const god = drawGodPack(pools, size);
      out.push(god.length === size ? { cards: god, god: true } : godOrNormal({ mirror: opts.mirror }));
      continue;
    }
    out.push(
      godOrNormal({
        forceLast: forcedLast.get(i) ?? null,
        forceA: arIdx.has(i),
        mirror: opts.mirror,
        master: i === masterIdx,
      }),
    );
  }
  return { packs: out, god: out.some((p) => p.god) };
}
