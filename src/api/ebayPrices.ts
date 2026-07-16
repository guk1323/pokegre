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
  // 그 등급의 날짜별 낙찰 평균가(오래된→최신). 그래프에 쓴다. 없으면 빈 배열.
  history: EbayGradePoint[];
}

export interface EbayCard {
  tcgPlayerId: string;
  name: string;
  setName: string;
  cardNumber: string | null;
  imageUrl: string;
  totalSales: number;
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
export type CardEdition = 'japanese' | 'english';

// PokemonPriceTracker 일일 크레딧 초과(429)를 호출부에서 식별하기 위한 에러 표식.
export const EBAY_RATE_LIMITED = 'ebay_rate_limited';

export interface EbaySearchResult {
  cards: EbayCard[];
  // 더 받을 게 남았는지. 원본 페이지가 꽉 찼으면(=요청한 만큼 왔으면) 뒤에 더 있다고 본다.
  hasMore: boolean;
}

// 서버 프록시(shapeEbayCards)가 원본 PokemonPriceTracker 응답을 재배포하지 않도록
// 화면용 필드만 추려 { cards, rawCount } 형태로 내려준다. offset으로 다음 페이지를 잇는다.
export async function searchEbayCards(
  query: string,
  edition: CardEdition = 'japanese',
  offset = 0,
): Promise<EbaySearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { cards: [], hasMore: false };

  // PokemonPriceTracker의 search는 일본판 DB도 영문 카드명으로 색인돼 있어서,
  // 두 발매판 모두 한글→영문 번역을 태워 보낸다.
  const translated = translateSearchQueryToEnglish(trimmed);
  const params = new URLSearchParams({
    language: edition,
    search: translated,
    includeEbay: 'true',
    limit: String(EBAY_PAGE_SIZE),
    offset: String(offset),
  });

  const res = await fetch(`/api/local/card-prices?${params.toString()}`);
  // 일일 크레딧 초과(429)는 호출부가 "일시적 오류"와 구분해 안내하도록 별도 에러로 던진다.
  if (res.status === 429) throw new Error(EBAY_RATE_LIMITED);
  if (!res.ok) throw new Error(`card-prices request failed: ${res.status}`);

  // 서버가 내려주는 이름은 TCGPlayer 영문 표기라, SNKRDUNK 결과(koreanizeTitle)와
  // 나란히 놓았을 때 이질적이다. 화면에 뿌리기 전에 한글 표기로 맞춰준다.
  const json = (await res.json()) as { cards?: EbayCard[]; rawCount?: number };
  const cards = (json.cards ?? []).map((card) => ({
    ...card,
    name: koreanizeEnglishCardName(card.name),
    setName: koreanizeEnglishSetName(card.setName),
  }));
  return { cards, hasMore: (json.rawCount ?? cards.length) >= EBAY_PAGE_SIZE };
}

// "psa10" -> "PSA 10", "cgc9" -> "CGC 9"
export function formatGradeLabel(grade: string): string {
  const match = grade.match(/^([a-z]+)(\d+(?:\.\d+)?)$/i);
  if (!match) return grade.toUpperCase();
  return `${match[1].toUpperCase()} ${match[2]}`;
}
