import { koreanizeTitle } from './koreanizeTitle';
import { koreanizeEnglishCardName } from './koreanizeEnglishTitle';
import { koSetName } from './setNameKo';

// 카드 카탈로그(세트별 수록 카드). public/sets/에 미리 긁어 둔 JSON을 읽는다.
// 세트별 목록 화면(SetsView)과 플리마켓 카드 목록이 같이 쓴다.
//
// 이미지 주소를 만드는 규칙이 소스마다 달라서 여기 한곳에 모아 둔다 — 화면마다
// 따로 두면 한쪽만 고쳐져서 어긋난다.

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
  // 레어도(원본 DB 표기). 채워진 세트가 많지 않다 — 2023년 이후 24개 세트뿐이라
  // 없으면 없는 대로 다뤄야 한다.
  r?: string;
}

// 낮은 등급 → 높은 등급. 세트의 간판 카드를 고르는 데 쓴다.
// 원본 DB(TCGdex) 표기를 그대로 쓴다 — 표기가 바뀌면 목록에 없어 -1이 되고,
// 그런 카드는 자동으로 뒤로 밀린다(틀린 카드를 올리는 것보다 낫다).
const RARITY_ORDER = [
  'Common',
  'Uncommon',
  'Rare',
  'Double rare',
  'ACE SPEC Rare',
  'Ultra Rare',
  'Illustration rare',
  'Shiny rare',
  'Shiny Ultra Rare',
  'Special illustration rare',
  'Secret Rare',
  'Hyper rare',
  'Black White Rare',
  'Mega Hyper Rare',
];

export function rarityRank(r?: string): number {
  return r ? RARITY_ORDER.indexOf(r) : -1;
}

export interface SetFile {
  ed: 'ja' | 'en';
  id: string;
  name: string;
  cards: SetCard[];
}

// TCGdex는 베이스 주소라 /high.webp를 붙인다(low.webp는 245px라 320px 표시에서 뿌옇게
// 확대돼, 600px high를 받아 프록시가 선명하게 축소한다). 다른 소스는 완성된 주소 그대로.
export const cardImg = (base: string) =>
  !base ? '' : /\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base}/high.webp`;

// 썸네일은 원본(로고 127KB·박스 59KB)을 그대로 받으면 느리다. 무료 CDN(wsrv.nl)으로
// 필요한 크기의 WebP로 줄여 받는다(~5KB). w는 표시의 2배(레티나).
export const thumb = (url: string, w: number) => (url ? `/api/img?u=${encodeURIComponent(url)}&w=${w}` : '');

// 이미지가 아직 없는 카드(옛 프로모·트레이너킷 등)의 임시 대체. 빈 회색칸 대신
// "뒷면(이미지 준비 중)"을 보여줘 일관성을 지킨다.
export const CARD_BACK = '/card-back.svg';

// 스니덩크는 "마켓 거래 사진"(슬랩·손·책상 위 등)이라 공식 카드 렌더가 아니다.
// 경로 불문 "이미지 없음"으로 취급해 뒷면으로 대체한다.
export const usable = (url?: string) => !!url && !url.includes('snkrdunk');

// 일본판은 일본어 변환 후, TCGdex에 영어로 섞여 오는 이름(옛 세트의 Koffing 등)까지
// 영어 변환기로 한 번 더 잡는다. 북미판은 영어 변환만.
// 일본어 글자가 하나도 없으면 영어 이름이다. 일본판 세트에도 영어 이름이 섞여 있다
// (옛 세트의 깨진 원본 데이터, 그리고 PPT에서 받아 채운 시크릿 레어).
// 그런 이름에 일본어 변환기를 먼저 돌리면 오히려 망가진다 — 일본어 사전에는 옛 세트를
// 고치려고 넣은 조각들이 있어서("Rocket"→"로켓단", "Jasmine"→"규리"), 멀쩡한 영어
// 이름이 "Team 로켓단의 Wobbuffet"처럼 반쪽이 된다. 영어면 영어 변환기만 태운다.
const hasJapanese = (s: string) => /[ぁ-んァ-ヶ一-龯]/.test(s);

export const koName = (ed: 'ja' | 'en', name: string) => {
  if (ed !== 'ja') return koreanizeEnglishCardName(name);
  if (hasJapanese(name)) return koreanizeEnglishCardName(koreanizeTitle(name));
  // 영어 이름이다. 영어 사전이 통째로 아는 이름이면 그대로 쓴다.
  const en = koreanizeEnglishCardName(name);
  if (/[가-힣]/.test(en) && !/[A-Za-z]{3,}/.test(en)) return en;
  // 영어 사전이 못 잡은 것만 일본어 사전에 맡긴다. 옛 세트에는 원본이 깨져 영어로 들어온
  // 이름이 있는데("Bugsy's Pinsir", "Mime Ex"), 그건 일본어 쪽에 고치는 규칙을 넣어 뒀다.
  return koreanizeEnglishCardName(koreanizeTitle(name));
};

// 일본판 세트인데 이름이 영어로 붙은 것들이 있다(「Pokémon GO」, 「25th Anniversary」).
// 일본어 사전은 이런 이름을 손대지 못해 영어 그대로 나갔다. 한글이 하나도 안 남으면
// 영어 세트명 사전으로 한 번 더 시도한다.
export const koSet = (ed: 'ja' | 'en', name: string) => {
  if (ed !== 'ja') return koSetName(name);
  const ko = koreanizeTitle(name);
  return /[가-힣]/.test(ko) ? ko : koSetName(ko);
};

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

export async function loadSetCards(slug: string): Promise<SetCard[]> {
  const hit = setCache.get(slug);
  if (hit) return hit;
  const res = await fetch(`/sets/${slug}.json`);
  if (!res.ok) throw new Error('수록 카드를 불러오지 못했습니다.');
  const file = (await res.json()) as SetFile;
  const cards = file.cards ?? [];
  setCache.set(slug, cards);
  return cards;
}
