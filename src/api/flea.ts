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
// 감정 회사부터 드롭다운으로 정확히 고른다(사장님 2026-08-21 — "어느 회사껀지").
// 저장은 「회사 + 등급」 한 벌 문자열("PSA 10")이다 — 서버 FLEA_SLAB_GRADES와 같은 조합.
export const SLAB_COMPANIES = [
  { name: 'PSA', grades: ['10', '9', '8 이하'] },
  { name: 'BGS', grades: ['10 블랙라벨', '10', '9.5', '9 이하'] },
  { name: 'CGC', grades: ['10 퍼펙트', '10', '9.5', '9 이하'] },
  { name: 'SGC', grades: ['10', '9.5', '9 이하'] },
  { name: 'ARS', grades: ['10+', '10', '9', '8 이하'] },
  { name: '기타', grades: ['감정품'] },
] as const;
export type SlabCompany = (typeof SLAB_COMPANIES)[number]['name'];

// 다루는 판은 **화면·서버가 같은 한 벌**을 쓴다(src/lib/fleaSets.ts).
// 영문판은 안 받는다 — 왜인지는 그 파일 머리말에 있다.
import { FLEA_EDITION_LABEL, type FleaEdition } from '../lib/fleaSets';

export const EDITION_LABEL = FLEA_EDITION_LABEL;
export type Edition = FleaEdition;

// 등급 이름과 기준. 등록 화면에서 고를 때 바로 보이게 해서 후하게 매기는 걸 줄이고,
// 상세에서도 같은 글을 보여 사는 쪽도 "B가 무슨 뜻인지" 안다(사장님 지시 2026-08-21 —
// "4개의 상태를 잘 구분해줬으면").
export const RAW_GRADE_TITLE: Record<(typeof RAW_GRADES)[number], string> = {
  A: '거의 새 카드',
  B: '가벼운 사용감',
  C: '사용감 뚜렷',
  D: '하자 있음',
};
export const RAW_GRADE_HINT: Record<(typeof RAW_GRADES)[number], string> = {
  A: '슬리브 보관 수준. 모서리 흰 까짐 없음 · 정면에서 흠이 안 보임',
  B: '모서리 흰 까짐 1mm 이하 2곳까지 · 잔기스 2곳까지 · 정면에선 티가 잘 안 남',
  C: '흰 까짐 3곳 이상이거나 정면에서 흠이 바로 보임 · 살짝 휜 카드 포함',
  D: '접힘·찢어짐·물 젖음·낙서·움푹 찍힘 중 하나라도 있으면 D',
};

/**
 * 필수 사진 10칸 — 등급 카드든 싱글 카드든 같다(사장님 지시 2026-08-21).
 * 앞·뒤 전체 1장씩 + 앞·뒤를 4분의 1씩(왼쪽 위→오른쪽 위→왼쪽 아래→오른쪽 아래) 4장씩.
 * ⚠️ **images 배열의 차례가 곧 이 차례다.** 상세 화면이 순서로 이름표를 붙이므로
 *    서버·화면 어디서도 순서를 섞으면 안 된다.
 */
export const PHOTO_SLOTS = [
  { key: 'front', label: '앞 전체', 전체: true },
  { key: 'back', label: '뒤 전체', 전체: true },
  { key: 'f-tl', label: '앞 · 왼쪽 위' },
  { key: 'f-tr', label: '앞 · 오른쪽 위' },
  { key: 'f-bl', label: '앞 · 왼쪽 아래' },
  { key: 'f-br', label: '앞 · 오른쪽 아래' },
  { key: 'b-tl', label: '뒤 · 왼쪽 위' },
  { key: 'b-tr', label: '뒤 · 오른쪽 위' },
  { key: 'b-bl', label: '뒤 · 왼쪽 아래' },
  { key: 'b-br', label: '뒤 · 오른쪽 아래' },
] as const;
export const PHOTO_COUNT = PHOTO_SLOTS.length;

export function isSlab(grade: string): boolean {
  // A~D가 아니면 전부 감정품이다. 회사×등급 조합을 나열해 견주면 옛 표기("PSA10")가
  // 남은 매물이 미감정으로 잘못 갈린다.
  return !(RAW_GRADES as readonly string[]).includes(grade);
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

// ── 구매 희망(매수) ────────────────────────────────────────────────────────

export interface FleaBid {
  id: number;
  mine: boolean;
  buyer: string;
  cardSlug: string;
  cardNo: string;
  cardName: string;
  setName: string;
  cardImg: string;
  edition: Edition;
  price: number;
  status: 'open' | 'cancelled';
  createdAt: number;
}

export async function fetchBids(card?: { slug: string; no: string }): Promise<FleaBid[]> {
  const q = card ? `?slug=${encodeURIComponent(card.slug)}&no=${encodeURIComponent(card.no)}` : '';
  const res = await fetch(`/api/local/flea/bids${q}`);
  if (!res.ok) throw new Error('불러오지 못했습니다.');
  return res.json();
}

export async function createBid(input: {
  cardSlug: string; cardNo: string; cardName: string; setName: string; cardImg: string; edition: Edition; price: number;
}): Promise<FleaBid> {
  const res = await fetch('/api/local/flea/bids', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '걸지 못했습니다.');
  return data;
}

export async function cancelBid(id: number): Promise<void> {
  const res = await fetch(`/api/local/flea/bids/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error('내리지 못했습니다.');
}

// ── 거래 대화방 ────────────────────────────────────────────────────────────
// 글·사진은 자유, 최종 금액은 「거래 확정」 버튼으로만 남는다. 새 글은 5초 폴링.

export interface FleaChatRoom {
  id: number;
  cardSlug: string;
  cardNo: string;
  cardName: string;
  setName: string;
  cardImg: string;
  edition: Edition;
  source: 'bid' | 'listing';
  refId: number;
  refPrice: number;
  상대: string;
  제안?: { price: number; 내가냈나: boolean };
  성사가?: number;
  lastAt: number;
  lastText: string;
  createdAt: number;
  안읽음?: number;
}

export interface FleaChatMsg {
  id: number;
  roomId: number;
  mine: boolean;
  sender: string;
  type: 'text' | 'image' | 'system';
  text: string;
  image: string;
  createdAt: number;
}

async function chatPost(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? '처리하지 못했습니다.');
  return data as Record<string, unknown>;
}

export async function openChat(input: { source: 'bid' | 'listing'; refId: number }): Promise<FleaChatRoom> {
  return (await chatPost('/api/local/flea/chats', input)) as unknown as FleaChatRoom;
}

export async function fetchChats(): Promise<FleaChatRoom[]> {
  const res = await fetch('/api/local/flea/chats');
  if (!res.ok) throw new Error('불러오지 못했습니다.');
  return res.json();
}

export async function fetchChatMessages(roomId: number): Promise<{ room: FleaChatRoom; messages: FleaChatMsg[] }> {
  const res = await fetch(`/api/local/flea/chats/${roomId}/messages`);
  if (!res.ok) throw new Error('불러오지 못했습니다.');
  return res.json();
}

export async function sendChatMessage(roomId: number, body: { text?: string; image?: string }): Promise<FleaChatMsg> {
  return (await chatPost(`/api/local/flea/chats/${roomId}/messages`, body)) as unknown as FleaChatMsg;
}

export async function proposeDeal(roomId: number, price: number): Promise<FleaChatRoom> {
  return (await chatPost(`/api/local/flea/chats/${roomId}/deal`, { price })) as unknown as FleaChatRoom;
}

export async function answerDeal(roomId: number, accept: boolean): Promise<FleaChatRoom> {
  return (await chatPost(`/api/local/flea/chats/${roomId}/deal`, { accept })) as unknown as FleaChatRoom;
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
