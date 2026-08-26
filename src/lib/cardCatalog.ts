
// 카드 카탈로그(세트별 수록 카드). public/sets/에 미리 긁어 둔 JSON을 읽는다.
// 세트별 목록 화면(SetsView)과 플리마켓 카드 목록이 같이 쓴다.
//
// 이미지 주소를 만드는 규칙이 소스마다 달라서 여기 한곳에 모아 둔다 — 화면마다
// 따로 두면 한쪽만 고쳐져서 어긋난다.

import { 번호비교 } from './cardNo.ts';

export interface SetIndexEntry {
  slug: string;
  ed: 'ja' | 'en';
  id: string;
  name: string;
  count: number;
  releaseDate: string;
  serie: string;
  boxImg?: string; // 스니덩크 박스(팩) 상품 사진. 제일 우선.
  logo: string; // 팩(패키지) 로고 이미지 URL.
  cover: string; // 첫 카드 이미지(최후 대체).
}

export interface SetCard {
  n: string;
  name: string;
  img: string;
  // 한글판 정보. scripts/match-ko-cards.mts 가 포켓몬코리아 공식 자료를 이름으로 맞춰 붙인다.
  // ⚠️ koNo가 n과 다를 수 있다 — 한국판은 서포트·굿즈를 가나다순으로 다시 매기기 때문이다.
  // 없는 카드도 많다(한국 미발매 시크릿 구간). 없으면 한글판 목록에서 빼면 된다.
  koImg?: string;
  koNo?: string;
  koName?: string;
  /**
   * **이 그림은 그 카드 것이 아니라 같은 번호의 일반판 것**이라는 표시.
   *
   * ⚠️ 저쪽(tcgplayer) CDN에 그 카드 그림이 없어(403) 카드 뒷면이 나오던 자리를,
   *    같은 밑번호의 일반판 그림으로 메운 것이다(scripts/fix-dead-card-imgs.mts).
   *    무늬 변종(마스터볼·몬스터볼 미러)에 몰려 있다.
   * ⚠️⚠️ **반드시 화면에 밝혀야 한다.** 무늬 변종은 그림 자체가 값어치라, 말없이
   *    일반판 그림을 보여 주면 사는 사람이 헷갈린다(사장님 지시 2026-08-16:
   *    "일반 카드 이미지는 쓰되 마스터볼 미러라고 명시는 제대로 해주는거").
   */
  imgBase?: boolean;
  /**
   * **카드에 실제로 찍힌 번호.** 옛 일본 세트(1996~2001 구판)는 「4/102」 같은 카드 번호가
   * 없고 **그 포켓몬의 도감번호**가 「No. 004」로 찍혀 있다(실물 그림으로 확인).
   * ⚠️ 우리 `n`은 pokellector가 매긴 **정렬 순번**이라 실물과 다르다(파이리가 012).
   *    사장님 지시(2026-08-17): 화면에는 **카드에 찍힌 번호**를 보여 준다.
   * ⚠️ `n`은 안 바꾼다 — 인쇄번호는 **겹칠 수 있어서**다(같은 포켓몬 카드가 한 세트에 둘).
   *    만드는 곳: scripts/fill-print-no.mts
   */
  printNo?: string;
  /**
   * **PPT 번호**(tcgPlayerId). 2026-08-09에 도감을 PPT 덤프로 갈아엎으며 박아 두었다
   * (65,596장 중 58,151장). 이게 있으면 이베이·TCGplayer 시세를 이름으로 뒤지지 않고
   * 콕 집어 부를 수 있다.
   */
  tcg?: string;
  // 레어도(원본 DB 표기). 채워진 세트가 많지 않다 — 2023년 이후 24개 세트뿐이라
  // 없으면 없는 대로 다뤄야 한다.
  r?: string;
}

/**
 * 낮은 등급 → 높은 등급. 세트의 간판 카드(「주요 카드」)를 고르는 데 쓴다.
 *
 * ⚠️⚠️ **이 표가 오래 망가져 있었다**(2026-08-16에 고침). 두 가지가 겹쳤다:
 *   ① **대소문자.** 표에는 `Double rare`(TCGdex 표기)만 있었는데 도감을 PPT 덤프로
 *      갈아엎은 뒤로는 `Double Rare`가 들어온다. 글자가 한 칸 달라 **2,935장이 -1**이었다.
 *      (카드 뽑기에서 똑같은 사고를 이미 냈었다 — CLAUDE.md의 `등급열쇠()` 항목.)
 *   ② **일본판 표기가 통째로 없었다.** AR·SR·SAR·MUR·홀로 레어가 한 줄도 없어서
 *      **일본 세트는 전부** 간판이 커먼·레어로 나갔다(M6는 「메가레쿠쟈 ex」 대신 「파비코리」).
 *   전체로는 레어도가 붙은 58,513장 중 **35,823장(61%)만** 순위가 잡히고 있었다.
 *
 * ⚠️ **순서를 짐작으로 정하지 않았다.** 카드는 특별할수록 **인쇄된 분모보다 뒷번호**를
 *    받는다(「113/108」). 그래서 레어도마다 「분모를 넘는 카드의 비율」을 세어 갈랐다
 *    (재료: index.json의 `denom` 374개 세트). 그 값이 아래 「시크릿 구간」 주석의 %다.
 *    같은 100%끼리의 앞뒤는 굳이 다투지 않는다 — **등급이 같으면 뒷번호가 이기므로**
 *    (`topCards`의 두 번째 잣대) 세트 안에서는 저절로 맨 끝 카드가 앞에 선다.
 *
 * ⚠️ 새 레어도가 나오면 **여기 한 줄을 넣어야 한다.** 안 넣으면 -1이 되어 간판 후보에서
 *    통째로 빠진다 — 30주년의 `Futuristic Rare`(FUR)가 그럴 뻔했다.
 *    빠진 게 없는지는 `npx tsx scripts/check-rarity-order.mts`가 세어 준다.
 */
const RARITY_ORDER = [
  // ── 포켓몬 TCG 포켓(◇) ──
  'One Diamond',
  'Two Diamond',
  'Three Diamond',
  'Four Diamond',
  // ── 본세트 (인쇄된 분모 안) ──
  'Common',
  'Common Holo',
  'Uncommon',
  'Rare',
  'Holo Rare', // 0.2%
  'Rare Holo',
  'Double Rare', // 0.3% — 일본판 RR
  'Triple Rare',
  'Rare Ace',
  'ACE Rare',
  'ACE SPEC Rare',
  'Rare BREAK',
  'Rare Holo LV.X',
  'Prism Rare', // 1.3%
  'Radiant Rare',
  'Kagayaku', // 일본판 「카가야쿠」 = Radiant. 전부 Radiant 포켓몬인 것을 확인했다.
  'Amazing Rare',
  'Shining',
  'Trainer Rare',
  'Ultra Rare', // 28.4% — 여기서 갈린다(영문판 풀아트 구간)
  // ── 포켓몬 TCG 포켓(★) ──
  'One Star',
  'Two Star',
  'Three Star',
  // ── 시크릿 (인쇄된 분모 밖) ─────────────────────────────────────────────
  'Art Rare', // 86.5% — 일본판 AR
  'Super Rare', // 94.8% — 일본판 SR
  'Super Rare Holo',
  'Shiny Rare', // 95.2%
  'Shiny Holo Rare',
  'Shiny Ultra Rare',
  'Special Art Rare', // 97.3% — 일본판 SAR
  'Hyper Rare', // 98.5%
  'Secret Rare', // 99.2%
  'Illustration Rare', // 100%
  'Special Illustration Rare', // 100%
  'Character Rare', // 100%
  'Character Super Rare', // 100%
  'Shiny Secret Rare', // 100%
  'Rainbow Rare', // 100%
  'Rare Holo LEGEND',
  'Black White Rare',
  'Mega Attack Rare',
  'Futuristic Rare', // 30주년(M6a)에서 새로 생긴 FUR. en-ME 157·158이 128장짜리 세트의 뒷번호다.
  'Mega Hyper Rare', // 영문판 MUR — 세트의 마지막 카드
  'Mega Ultra Rare', // 일본판 MUR — 〃
];

// ⚠️ **대소문자를 무시하고 찾는다.** 같은 등급을 소스마다 다르게 적는다
//    (TCGdex `Illustration rare` ↔ PPT `Illustration Rare`). 둘이 같은 것이라는 건
//    짐작이 아니라 잰 값이다 — 분모를 넘는 비율이 **양쪽 다 100%**로 같았다.
const RARITY_RANK = new Map(RARITY_ORDER.map((r, i) => [r.toLowerCase(), i]));

export function rarityRank(r?: string): number {
  return r ? (RARITY_RANK.get(r.trim().toLowerCase()) ?? -1) : -1;
}

export interface SetFile {
  ed: 'ja' | 'en';
  id: string;
  name: string;
  cards: SetCard[];
}

// 이미지 주소 규칙은 cardImg.ts로 옮겼다 — 사전을 안 쓰는 것들이라, 첫 화면에 늘 있는
// CardTile이 thumb() 하나 때문에 이름 사전 109KB를 같이 받던 것을 끊기 위해서다.
// 쓰는 쪽이 안 바뀌도록 여기서 그대로 다시 내보낸다.
export { cardImg, thumb, CARD_BACK, usable, 기준일글 } from './cardImg';

// 일본판은 일본어 변환 후, TCGdex에 영어로 섞여 오는 이름(옛 세트의 Koffing 등)까지
// 영어 변환기로 한 번 더 잡는다. 영문판은 영어 변환만.
// 일본어 글자가 하나도 없으면 영어 이름이다. 일본판 세트에도 영어 이름이 섞여 있다
// (옛 세트의 깨진 원본 데이터, 그리고 PPT에서 받아 채운 시크릿 레어).
// 그런 이름에 일본어 변환기를 먼저 돌리면 오히려 망가진다 — 일본어 사전에는 옛 세트를
// 고치려고 넣은 조각들이 있어서("Rocket"→"로켓단", "Jasmine"→"규리"), 멀쩡한 영어
// 이름이 "Team 로켓단의 Wobbuffet"처럼 반쪽이 된다. 영어면 영어 변환기만 태운다.

// 옛 세트 원본에는 이름 뒤에 번호가 붙어 오는 것이 있다("MUK -004/092"). 그대로 두면
// 화면에 "질뻐기 -004/092"로 뜬다 — 번호는 옆 칸에 따로 적히므로 이름에 있을 이유가
// 없다. 도감을 만드는 쪽은 이미 떼고 있었는데 화면만 남아 있었다(점검 중 발견
// 2026-08-06 — 같은 규칙을 쓰는 두 곳이 어긋난 경우다).
// 카드·세트 이름 한글화는 lib/koCardName.ts 한 벌만 쓴다(**서버도 같은 파일**을 쓴다).
// 여기 있던 사본을 옮겼다 — 서버가 베껴 두고 있었고, 화면만 고쳐져 어긋났었다.
// 쓰는 쪽 편하라고 여기서 다시 내보낸다.
export { koName, koSet } from './koCardName.ts';

// 한 번 받은 건 다시 안 받는다. 세트 파일이 284개라 오가며 고를 때 체감이 크다.
let indexCache: SetIndexEntry[] | null = null;
const setCache = new Map<string, SetCard[]>();

export async function loadSetIndex(): Promise<SetIndexEntry[]> {
  if (indexCache) return indexCache;
  const res = await fetch('/sets/index.json');
  if (!res.ok) throw new Error('세트 목록을 불러오지 못했습니다.');
  indexCache = (await res.json()) as SetIndexEntry[];
  return indexCache;
}

// 한글판 그림이 붙어 있는 세트 목록(slug). 세트 파일 284개를 다 열어 보지 않으려고
// match-ko-cards.mts 가 미리 뽑아 둔다. 아직 없으면 빈 배열 — 한글판 탭이 비는 것뿐이다.
let koSetsCache: string[] | null = null;
export async function loadKoSets(): Promise<string[]> {
  if (koSetsCache) return koSetsCache;
  const res = await fetch('/sets/ko-index.json').catch(() => null);
  koSetsCache = res?.ok ? ((await res.json()) as string[]) : [];
  return koSetsCache;
}

/**
 * **카드에 찍힌 번호 차례**로 세운다(`printNo`가 있는 옛 일본 세트만).
 *
 * ⚠️ 왜: 그 세트들의 `n`은 pokellector가 매긴 **정렬 순번**이라 실물과 다르다.
 *    번호만 실물 것으로 바꿔 놓으면 화면에 「004 → 041 → 043 → 088」처럼 뒤죽박죽 나온다
 *    — 사장님 지적 2026-08-17 "번호만 바꿀 게 아니라 순서도 바꿔야지".
 * ⚠️ **번호 없는 카드(트레이너·에너지)는 뒤에 그대로 둔다.** 실물에도 번호가 없고,
 *    지금 파일에서도 이미 맨 뒤에 몰려 있다(PMCG4: 53~64번 자리).
 * ⚠️ **같은 번호가 둘일 수 있다**(에리카의 뚜벅쵸 002·003이 둘 다 No.043) — 그때는
 *    원래 차례를 지킨다(`sort`가 안정 정렬이다).
 * ⚠️ `printNo`가 하나도 없는 세트는 **손대지 않는다**(그대로 돌려준다).
 */
function 인쇄번호순(cards: SetCard[]): SetCard[] {
  if (!cards.some((c) => c.printNo)) return 번호순(cards);
  const 값 = (c: SetCard) => (c.printNo ? Number(c.printNo) : Number.MAX_SAFE_INTEGER);
  return [...cards].sort((a, b) => 값(a) - 값(b));
}

/**
 * `printNo`가 없는 세트를 **카드 번호순**으로 세운다.
 *
 * ⚠️⚠️ 예전엔 이런 세트를 **파일에 적힌 차례 그대로** 내보냈다. 그런데 그 파일은
 *    번호가 겹치는 카드(`12~568512`처럼 구분표를 붙인 것)를 **맨 뒤에 몰아 놓는다.**
 *    그래서 「13 18 21 … 139」 뒤에 12·37·77이 다시 나오는 꼴이 됐다
 *    (사장님 지적 2026-08-20, 예: 북미판 트릭 오어 트레이드 부스터 번들 2024).
 *    **682개 세트 중 118개**가 그렇게 어긋나 있었다.
 * ⚠️ 견주는 규칙은 `번호비교` 한 벌만 쓴다(lib/cardNo.ts). RC5·TG01·SWSH001처럼
 *    글자가 섞인 번호가 많아서, 글자로 견주거나 `Number()`로 바꾸면 둘 다 틀린다.
 */
function 번호순(cards: SetCard[]): SetCard[] {
  return [...cards].sort((a, b) => 번호비교(a.n, b.n));
}

export async function loadSetCards(slug: string): Promise<SetCard[]> {
  const hit = setCache.get(slug);
  if (hit) return hit;
  const res = await fetch(`/sets/${slug}.json`);
  if (!res.ok) throw new Error('수록 카드를 불러오지 못했습니다.');
  const file = (await res.json()) as SetFile;
  const cards = 인쇄번호순(file.cards ?? []);
  setCache.set(slug, cards);
  return cards;
}
