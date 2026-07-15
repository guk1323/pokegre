import { translateSearchQueryToEnglish } from '../lib/translateQueryToEnglish';
import { koreanizeEnglishCardName, koreanizeEnglishSetName } from '../lib/koreanizeEnglishTitle';

export interface EbayGradeStat {
  grade: string;
  count: number;
  averagePrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  marketTrend: string | null;
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

// 무료 티어가 하루 100크레딧뿐이고 includeEbay=true는 카드당 2크레딧이라, 한 번
// 검색에 최대 10장(20크레딧)만 요청한다. 서버 프록시가 동일 검색어를 6시간 캐싱해서
// 반복 검색은 크레딧을 추가로 쓰지 않는다.
const SEARCH_LIMIT = 10;

// 카드 발매판. PokemonPriceTracker는 일본판/영문판을 각각 별도 DB로 들고 있어서
// language 파라미터로 고른다. SNKRDUNK는 일본 마켓이라 북미판 카탈로그가 없고,
// 그래서 북미판 시세는 이쪽(eBay)에서만 볼 수 있다.
export type CardEdition = 'japanese' | 'english';

// PokemonPriceTracker 일일 크레딧 초과(429)를 호출부에서 식별하기 위한 에러 표식.
export const EBAY_RATE_LIMITED = 'ebay_rate_limited';

// 서버 프록시(vite.config.ts의 shapeEbayCards)가 원본 PokemonPriceTracker 응답을
// 재배포하지 않도록 화면용 필드만 추려 { cards: EbayCard[] } 형태로 내려준다.
// 여기서는 그대로 받아 쓰기만 한다.
export async function searchEbayCards(query: string, edition: CardEdition = 'japanese'): Promise<EbayCard[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // PokemonPriceTracker의 search는 일본판 DB도 영문 카드명으로 색인돼 있어서,
  // 두 발매판 모두 한글→영문 번역을 태워 보낸다.
  const translated = translateSearchQueryToEnglish(trimmed);
  const params = new URLSearchParams({
    language: edition,
    search: translated,
    includeEbay: 'true',
    limit: String(SEARCH_LIMIT),
  });

  const res = await fetch(`/api/local/card-prices?${params.toString()}`);
  // 무료 티어는 하루 100크레딧이라 429가 흔하다. 호출부가 "일시적 오류"와 구분해서
  // 안내할 수 있도록 별도 에러로 던진다.
  if (res.status === 429) throw new Error(EBAY_RATE_LIMITED);
  if (!res.ok) throw new Error(`card-prices request failed: ${res.status}`);

  // 서버가 내려주는 이름은 TCGPlayer 영문 표기라, SNKRDUNK 결과(koreanizeTitle)와
  // 나란히 놓았을 때 이질적이다. 화면에 뿌리기 전에 한글 표기로 맞춰준다.
  const json = (await res.json()) as { cards?: EbayCard[] };
  return (json.cards ?? []).map((card) => ({
    ...card,
    name: koreanizeEnglishCardName(card.name),
    setName: koreanizeEnglishSetName(card.setName),
  }));
}

// "psa10" -> "PSA 10", "cgc9" -> "CGC 9"
export function formatGradeLabel(grade: string): string {
  const match = grade.match(/^([a-z]+)(\d+(?:\.\d+)?)$/i);
  if (!match) return grade.toUpperCase();
  return `${match[1].toUpperCase()} ${match[2]}`;
}
