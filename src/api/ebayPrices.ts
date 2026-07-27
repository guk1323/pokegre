import { translateSearchQueryToEnglish } from '../lib/translateQueryToEnglish';
import { koreanizeEnglishCardName, koreanizeEnglishSetName } from '../lib/koreanizeEnglishTitle';

export interface EbayGradePoint {
  date: string;
  price: number;
}

export interface EbayGradeStat {
  grade: string;
  count: number;
  averagePrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  marketTrend: string | null;
  // 이 등급의 마지막 낙찰 날짜(ISO). 표시 값이 얼마나 최신인지 알려준다. 없으면 null.
  lastSaleDate: string | null;
  // PPT가 최근 30일로 계산한 현재 적정가와 신뢰도. 메인에 이 값을 쓰고, 없으면 중앙값으로
  // 대체한다.
  smartPrice: number | null;
  confidence: string | null;
  // 그 등급의 날짜별 낙찰 평균가(오래된→최신). 그래프에 쓴다. 없으면 빈 배열.
  history: EbayGradePoint[];
}

// TCGplayer(미국 마켓) 시세. 미감정(로우) 카드 기준. 값이 있을 때만 서버가 담아준다.
export interface TcgPlayerPrice {
  market: number;
  low: number;
  sellers: number;
  printing: string | null;
  lastUpdated: string | null;
  url: string;
  // 날짜별 마켓가 추이(오래된→최신). 그래프에 쓴다. 없으면 빈 배열(옛 캐시 응답 대비 옵션).
  history?: EbayGradePoint[];
}

export interface EbayCard {
  tcgPlayerId: string;
  // 화면 표시용 한글 이름. nameEn은 이베이 검색 링크를 만들 원본 영문 이름이다
  // (이베이 매물 제목이 영문이라 한글로 검색하면 안 잡힌다).
  name: string;
  nameEn: string;
  setName: string;
  cardNumber: string | null;
  imageUrl: string;
  totalSales: number;
  // 값이 있는 카드에만 붙는다(없으면 null → 화면에서 자동으로 숨김).
  tcgplayer: TcgPlayerPrice | null;
  grades: EbayGradeStat[];
}

// 한 페이지에 받는 카드 수. 유료 전환 전엔 크레딧을 아끼려 10장에 묶어뒀지만, 이제
// 여유가 있어 한 화면을 채우는 12장씩 받고 "더 보기"로 offset을 넘겨 이어 받는다.
// (그리드가 2·3·4열이라 12가 어느 열 수에서도 딱 떨어진다.) 서버가 같은 요청을 24시간
// 캐싱하고, PokemonPriceTracker는 page 대신 offset 방식만 지원한다.
export const EBAY_PAGE_SIZE = 12;

// 카드 발매판. PokemonPriceTracker는 일본판/영문판을 각각 별도 DB로 들고 있어서
// language 파라미터로 고른다. SNKRDUNK는 일본 마켓이라 북미판 카탈로그가 없고,
// 그래서 북미판 시세는 이쪽(eBay)에서만 볼 수 있다.
// 한글판은 PPT가 아니라 이베이 Browse API(호가)로 별도 처리하지만, 발매판 토글을
// 공유하려고 여기 함께 둔다. PPT 검색 함수엔 'korean'을 넘기지 않게 호출부에서 막는다.
export type CardEdition = 'japanese' | 'english' | 'korean';

// PokemonPriceTracker 일일 크레딧 초과(429)를 호출부에서 식별하기 위한 에러 표식.
export const EBAY_RATE_LIMITED = 'ebay_rate_limited';
// 하루치를 다 쓴 경우. 분당 한도와 달리 한국시간 오전 9시까지 안 열리므로 안내가 다르다.
export const EBAY_DAILY_LIMIT = 'ebay_daily_limit';

export interface EbaySearchResult {
  cards: EbayCard[];
  // 더 받을 게 남았는지. 원본 페이지가 꽉 찼으면(=요청한 만큼 왔으면) 뒤에 더 있다고 본다.
  hasMore: boolean;
}

// 서버 프록시(shapeEbayCards)가 원본 PokemonPriceTracker 응답을 재배포하지 않도록
// 화면용 필드만 추려 { cards, rawCount } 형태로 내려준다. offset으로 다음 페이지를 잇는다.
// 같은 PPT 데이터에서 어느 시세를 볼지. 'ebay'는 낙찰 기록이 있는 카드, 'tcgplayer'는
// TCGplayer 마켓가가 있는 카드만 서버가 추려 준다(have 파라미터).
export type PriceMarket = 'ebay' | 'tcgplayer';

export async function searchEbayCards(
  query: string,
  edition: CardEdition = 'japanese',
  offset = 0,
  market: PriceMarket = 'ebay',
): Promise<EbaySearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { cards: [], hasMore: false };

  // PokemonPriceTracker의 search는 일본판 DB도 영문 카드명으로 색인돼 있어서,
  // 두 발매판 모두 한글→영문 번역을 태워 보낸다.
  const translated = translateSearchQueryToEnglish(trimmed, edition);
  const params = new URLSearchParams({
    language: edition,
    search: translated,
    includeEbay: 'true',
    limit: String(EBAY_PAGE_SIZE),
    offset: String(offset),
  });
  if (market === 'tcgplayer') params.set('have', 'tcgplayer');

  const res = await fetch(`/api/local/card-prices?${params.toString()}`);
  // 429는 호출부가 "일시적 오류"와 구분해 안내하도록 별도 에러로 던진다. 하루치를 다 쓴
  // 것인지(오전 9시까지 대기) 분당 한도인지(곧 풀림)는 서버가 알려준다.
  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error === 'daily_limit' ? EBAY_DAILY_LIMIT : EBAY_RATE_LIMITED);
  }
  if (!res.ok) throw new Error(`card-prices request failed: ${res.status}`);

  // 서버가 내려주는 이름은 TCGPlayer 영문 표기라, SNKRDUNK 결과(koreanizeTitle)와
  // 나란히 놓았을 때 이질적이다. 화면에 뿌리기 전에 한글 표기로 맞춰준다.
  const json = (await res.json()) as { cards?: EbayCard[]; rawCount?: number };
  const cards = (json.cards ?? []).map((card) => ({
    ...card,
    // 원본 영문 이름은 이베이 검색 링크용으로 남겨두고, 표시용 이름만 한글로 바꾼다.
    nameEn: card.name,
    name: koreanizeEnglishCardName(card.name),
    setName: koreanizeEnglishSetName(card.setName),
  }));
  return { cards, hasMore: (json.rawCount ?? cards.length) >= EBAY_PAGE_SIZE };
}

// 신뢰도 표기. PPT의 high/medium/low를 한글로. 그 외 값은 그대로 둔다.
export const CONFIDENCE_LABEL: Record<string, string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
};

// 메인에 쓸 대표가. 스마트 적정가가 있으면 그걸, 없으면 중앙값으로 대체한다.
export function mainPrice(g: EbayGradeStat): { price: number; isSmart: boolean } {
  return g.smartPrice != null ? { price: g.smartPrice, isSmart: true } : { price: g.medianPrice, isSmart: false };
}

// "psa10" -> "PSA 10", "cgc9" -> "CGC 9"
export function formatGradeLabel(grade: string): string {
  // PPT는 소수점 등급을 "cgc9.5"로도, "cgc9_5"로도 보낸다. 밑줄도 소수점으로 받아
  // 화면에 "CGC9_5" 같은 원본 값이 그대로 새어 나가지 않게 한다.
  const match = grade.match(/^([a-z]+)(\d+(?:[._]\d+)?)$/i);
  if (!match) return grade.toUpperCase();
  return `${match[1].toUpperCase()} ${match[2].replace('_', '.')}`;
}

// 이베이의 "낙찰 완료(Sold)" 목록으로 바로 가는 검색 링크. PPT는 개별 낙찰 건을 주지
// 않지만, 이베이 자체 페이지에서는 각 낙찰의 날짜·가격·상품 링크가 다 보인다. 등급을
// 붙여 그 등급 낙찰만 걸러 보여준다(무등급은 등급어 없이). 매물 제목이 영문이라 영문
// 이름으로 검색한다.
export function ebaySoldUrl(nameEn: string, cardNumber: string | null, grade: string): string {
  const gradeTerm = grade === 'ungraded' ? '' : formatGradeLabel(grade);
  // PPT 이름에 카드 번호가 이미 들어있는 경우가 많아(예: "... -766/742"), 번호를 또
  // 붙이면 검색어에 중복된다. 이미 있으면 생략한다.
  const number = cardNumber && !nameEn.includes(cardNumber) ? cardNumber : '';
  const query = [nameEn, number, gradeTerm].filter(Boolean).join(' ');
  const params = new URLSearchParams({ _nkw: query, LH_Sold: '1', LH_Complete: '1' });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}
