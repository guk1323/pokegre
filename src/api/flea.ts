// 플리마켓(회원끼리 카드 거래) 운영 설정. 지금은 운영자 화면에서만 쓴다 —
// 서버가 운영자가 아니면 404를 주므로, 여기서 감추는 건 메뉴를 깔끔히 두는 편의일 뿐이다.

export interface FleaConfig {
  // 0 준비중(닫힘) · 1 매물+쪽지 · 2 거래기록까지 · 3 시세 공개
  stage: 0 | 1 | 2 | 3;
  // 단계와 별개인 즉시 차단 스위치. 끄면 단계가 몇이든 닫힌다.
  open: boolean;
  // 같은 카드·같은 등급으로 이만큼 모여야 시세로 보여준다.
  minSamples: number;
  // 외부 시세(스니커덩크·이베이) 대비 이 배수 밖이면 시세 집계에서 뺀다.
  outlierLow: number;
  outlierHigh: number;
  // 전자상거래법 제20조 제1항 고지("저희는 거래 당사자가 아닙니다")를 화면에 붙였는지.
  // 이걸 안 켜면 서버가 3단계로 못 가게 막는다.
  noticeShown: boolean;
  updatedAt: number;
}

export interface FleaStatus {
  config: FleaConfig;
  counts: { listings: number; deals: number };
}

export const STAGE_LABEL: Record<FleaConfig['stage'], string> = {
  0: '준비 중',
  1: '매물·쪽지',
  2: '거래 기록',
  3: '시세 공개',
};

export const STAGE_NOTE: Record<FleaConfig['stage'], string> = {
  0: '아직 아무에게도 안 보입니다. 만드는 동안 여기에 둡니다.',
  1: '매물을 올리고 쪽지를 주고받을 수 있습니다. 거래가는 아직 안 모읍니다.',
  2: '제안·수락·완료로 거래가를 모읍니다. 아직 시세로는 안 씁니다.',
  3: '모인 거래가를 시세로 보여줍니다.',
};

export async function fetchFleaStatus(): Promise<FleaStatus> {
  const res = await fetch('/api/local/flea/config');
  if (!res.ok) throw new Error('불러오지 못했습니다.');
  return res.json();
}

// ── 매물·제안 ──────────────────────────────────────────────────────────────

// 표기는 스니커덩크와 맞춘다. 판정 기준은 docs/플리마켓-등급기준.md 참고.
export const RAW_GRADES = ['A', 'B', 'C', 'D'] as const;
export const SLAB_GRADES = [
  'PSA10', 'PSA9', 'PSA8 이하',
  'BGS10 BL', 'BGS10 GL', 'BGS9.5', 'BGS9.5 이하',
  'ARS10+', 'ARS10', 'ARS9', 'ARS8 이하',
  '기타 감정품',
] as const;

export const EDITION_LABEL = { jp: '일본판', na: '영문판', kr: '한글판' } as const;
export type Edition = keyof typeof EDITION_LABEL;

// 등급별 한 줄 설명. 등록 화면에서 고를 때 바로 보이게 해서 후하게 매기는 걸 줄인다.
export const RAW_GRADE_HINT: Record<(typeof RAW_GRADES)[number], string> = {
  A: '모서리 흰 까짐 없음 · 정면에서 흠이 안 보임',
  B: '모서리 흰 까짐 1mm 이하 2곳까지 · 잔흠 2개까지',
  C: '흰 까짐 3곳 이상 · 정면에서 흠이 바로 보임',
  D: '접힘·찢어짐·물 젖음·낙서 중 하나라도 있으면 D',
};

// 등급별 필수 사진 장수. 비싼 등급일수록 많이 받는다.
export function requiredPhotos(grade: string): number {
  return grade === 'A' || grade === 'B' ? 4 : 3;
}

export function photoGuide(grade: string): string {
  return grade === 'A' || grade === 'B'
    ? '앞면 · 뒷면 · 빛 반사 · 모서리'
    : '앞면 · 뒷면 · 결함 부위';
}

export function isSlab(grade: string): boolean {
  return (SLAB_GRADES as readonly string[]).includes(grade);
}

export interface FleaListing {
  id: number;
  // 회원번호는 서버가 안 내려준다. 대신 "내 매물인지"만 알려준다.
  mine: boolean;
  seller: string;
  // 어느 카드인지. 카탈로그의 세트 코드 + 카드 번호로 못 박는다.
  cardSlug: string;
  cardNo: string;
  cardImg: string;
  cardName: string;
  setName: string;
  edition: Edition;
  grade: string;
  certNo: string;
  price: number;
  images: string[];
  note: string;
  status: 'open' | 'sold' | 'closed';
  createdAt: number;
  // 목록에서만 붙는다 — 들어온 제안 수.
  offers?: number;
}

export interface FleaOffer {
  id: number;
  listingId: number;
  buyer: string;
  price: number;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
  // 내 매물에 들어온 제안이라 수락·거절할 수 있는지. 서버가 판단해서 준다.
  canAnswer: boolean;
  // 내가 보낸 제안인지.
  mine: boolean;
}

export interface NewListing {
  cardSlug: string;
  cardNo: string;
  cardImg: string;
  cardName: string;
  setName: string;
  edition: Edition;
  grade: string;
  certNo: string;
  price: number;
  images: string[];
  note: string;
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const reason = await res.json().catch(() => null);
    throw new Error(reason?.error ?? fallback);
  }
  return res.json();
}

// 매물이 하나라도 올라온 카드 한 줄. 매물 탭 첫 화면에 쓴다.
export interface FleaCardRow {
  cardSlug: string;
  cardNo: string;
  cardImg: string;
  cardName: string;
  setName: string;
  edition: Edition;
  onSale: number;
  sold: number;
  lowest: number | null;
}

// 카드 이름으로 세트를 가리지 않고 찾은 결과 한 줄.
export interface FleaSearchRow {
  slug: string;
  n: string;
  name: string;
  img: string;
  setName: string;
  ed: Edition;
  onSale: number;
  lowest: number | null;
}

// 색인이 3MB라 클라이언트로 안 내려받는다 — 서버가 찾아서 결과만 준다.
export async function searchCards(q: string, ed: Edition): Promise<{ rows: FleaSearchRow[]; total: number }> {
  const res = await fetch(`/api/local/flea/search?q=${encodeURIComponent(q)}&ed=${ed}`);
  return jsonOrThrow(res, '카드를 찾지 못했습니다.');
}

export async function fetchCardsWithListings(): Promise<FleaCardRow[]> {
  const res = await fetch('/api/local/flea/cards');
  return jsonOrThrow(res, '카드 목록을 불러오지 못했습니다.');
}

// slug·no를 주면 그 카드의 매물만. 팔린 매물도 같이 온다(시세를 가늠하는 자료라서).
export async function fetchListings(opts: { slug?: string; no?: string; q?: string } = {}): Promise<FleaListing[]> {
  const p = new URLSearchParams();
  if (opts.slug) {
    p.set('slug', opts.slug);
    p.set('no', opts.no ?? '');
  }
  if (opts.q) p.set('q', opts.q);
  const res = await fetch(`/api/local/flea/listings${p.toString() ? `?${p}` : ''}`);
  return jsonOrThrow(res, '매물을 불러오지 못했습니다.');
}

export async function createListing(input: NewListing): Promise<FleaListing> {
  const res = await fetch('/api/local/flea/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res, '올리지 못했습니다.');
}

export async function closeListing(id: number): Promise<void> {
  const res = await fetch(`/api/local/flea/listings/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('내리지 못했습니다.');
}

export async function fetchOffers(listingId: number): Promise<FleaOffer[]> {
  const res = await fetch(`/api/local/flea/offers?listingId=${listingId}`);
  return jsonOrThrow(res, '제안을 불러오지 못했습니다.');
}

export async function sendOffer(listingId: number, price: number): Promise<FleaOffer> {
  const res = await fetch('/api/local/flea/offers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ listingId, price }),
  });
  return jsonOrThrow(res, '보내지 못했습니다.');
}

export async function answerOffer(id: number, accept: boolean): Promise<FleaOffer> {
  const res = await fetch(`/api/local/flea/offers/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accept }),
  });
  return jsonOrThrow(res, '처리하지 못했습니다.');
}

export async function saveFleaConfig(config: FleaConfig): Promise<FleaConfig> {
  const res = await fetch('/api/local/flea/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    // 서버가 이유를 보내면(예: 고지문 없이 3단계) 그대로 보여준다.
    const reason = await res.json().catch(() => null);
    throw new Error(reason?.error ?? '저장하지 못했습니다.');
  }
  return res.json();
}
