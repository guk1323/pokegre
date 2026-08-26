// ⚠️⚠️ **이 파일에는 이제 「꼴」과 「도우미」만 남아 있다.**
//    저쪽(PPT)에 매물을 물어보던 함수들(`searchEbayCards`·`fetchCardNameById`)과 그
//    부속(`EBAY_PAGE_SIZE`·`EbaySearchResult`·`EBAY_RATE_LIMITED`…)은 **2026-08-13에
//    옛 시세 길과 함께 지웠다.** 지금 시세는 `api/cardBoard.ts`가 가져온다.
//    남긴 것: `EbayCard`·`EbayGradeStat`·`TcgPlayerPrice` 꼴과 `대표등급`·`mainPrice`·
//    `formatGradeLabel`·`ebaySoldUrl`·`CONFIDENCE_LABEL` — 화면 부품이 그대로 쓴다.


// PPT가 쓰는 세트 이름 → 우리 한글 세트 이름.
//
// 왜: 영문 세트명 사전이 못 잡는 이름이 있다. 일본판 세트를 PPT는 "Start Deck 100
// Battle Collection"이라 부르는데, 그 사전은 영문판 이름만 알아서 영문이 그대로
// 화면에 나갔다 — 목록에서는 "스타트 덱 100 배틀컬렉션"으로 보다가 상세에서
// 영문을 보게 된다(점검 중 발견 2026-08-06).
// 우리는 이미 slug↔PPT 이름 대응표를 갖고 있으니 거꾸로 찾으면 된다.
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
  // 실제 낙찰 몇 건(최근 순, 등급당 최대 5건). 통계가 아니라 낱개 거래다.
  // 옛 응답 캐시에는 없을 수 있어 옵션으로 둔다.
  /** 낱개 낙찰. title은 "이 낙찰이 정말 그 카드인가"를 사람이 가리는 유일한 단서다. */
  /** 뺀까닭이 있으면 목록에만 보이고 평균·중앙값에는 안 들어간 기록이다. */
  /** 옮겨온곳이 있으면 다른 카드 칸에 잘못 담겨 있다가 **제자리로 옮겨 온** 기록이다. */
  sales?: { price: number; date: string; url: string; auction: boolean; title?: string; 뺀까닭?: string; 옮겨온곳?: string; 출처?: string; itm?: string; 고친값?: number; 메모?: string; 베스트오퍼?: boolean }[];
}

// TCGplayer(미국 마켓) 시세. 미감정(로우) 카드 기준. 값이 있을 때만 서버가 담아준다.
export interface TcgPlayerPrice {
  market: number;
  low: number;
  sellers: number;
  printing: string | null;
  // 이 값이 잡힌 매물의 상태("Near Mint"·"Moderately Played"…). 모르면 null.
  condition: string | null;
  // 추이 그래프가 어느 상태의 것인지. 위 condition과 다를 수 있다.
  historyCondition?: string | null;
  lastUpdated: string | null;
  url: string;
  // 날짜별 마켓가 추이(오래된→최신). 그래프에 쓴다. 없으면 빈 배열(옛 캐시 응답 대비 옵션).
  history?: EbayGradePoint[];
  /**
   * **인쇄판이 여럿일 때만** 오는 목록(1st Edition·Unlimited·Reverse Holofoil …).
   *
   * ⚠️⚠️ 같은 카드라도 인쇄판이 다르면 값이 크게 다르다 — 인쇄판이 둘 이상인 카드
   *    16,818장 중 **61%가 2배 넘게** 갈린다(리자몽 베이스셋: 1st Edition $10,000 ↔
   *    Unlimited $2,146). 위 `market`·`printing`은 **그중 제일 비싼 하나**라, 이것만
   *    보여 주면 흔한 쪽을 가진 사람이 남의 값을 보게 된다.
   * ⚠️ **하나뿐인 카드에는 안 온다**(전체의 68%). 있을 때만 여러 줄로 보이면 된다.
   * ⚠️ `market`·`printing`은 **그대로 둔다** — 타일·비교·미개봉이 그걸 쓰고 있어
   *    바꾸면 조용히 어긋난다. 여기서는 **더하기만** 한다.
   */
  printings?: { printing: string; market: number; low: number }[];
}

export interface EbayCard {
  tcgPlayerId: string;
  // 화면 표시용 한글 이름. nameEn은 이베이 검색 링크를 만들 원본 영문 이름이다
  // (이베이 매물 제목이 영문이라 한글로 검색하면 안 잡힌다).
  name: string;
  nameEn: string;
  setName: string;
  /** 원본(영문) 세트 이름. 화면에는 안 쓰고, "정말 그 세트인가"를 견줄 때만 쓴다. */
  setNameEn: string;
  cardNumber: string | null;
  /**
   * **어느 카드인지 가릴 수 없는 낙찰만 모인 칸.** 저쪽이 이름만으로 묶어 둔 것을
   * 번호·세트로 갈랐는데, 제목에 아무 단서도 없어 어디에도 못 넣은 것들이다.
   * 수십 년에 걸친 다른 카드가 섞여 있으므로 **대표 시세를 믿으면 안 된다.**
   */
  가릴수없음?: boolean;
  /** 저쪽이 준 레어도. 뒤에 붙은 코드로 좁힐 때 쓴다. */
  rarity: string;
  imageUrl: string;
  /**
   * **그림이 그 카드 것이 아니라 같은 번호의 일반판 것**이라는 표시.
   * ⚠️ 저쪽 CDN에 무늬 변종(마스터볼·몬스터볼 미러) 그림이 없어 카드 뒷면이 나오던
   *    자리를 메운 것이다. **화면에서 반드시 밝힌다** — 그림 자체가 값어치인 카드다.
   */
  imgBase?: boolean;
  /**
   * **카드에 실제로 찍힌 번호.** 옛 일본 세트(1996~2001 구판)는 카드 번호가 없고
   * 포켓몬 도감번호가 「No. 004」로 찍혀 있다. 있으면 **이걸 보여 준다** — 사람이
   * 손에 든 카드와 같아야 한다(사장님 지시 2026-08-17).
   */
  printNo?: string;
  totalSales: number;
  /** 딴 카드로 보여 뺀 낙찰 건수. 세트 이름이 겹쳐 저쪽이 섞어 놓은 것을 우리가 뺐다. */
  droppedOther?: number;
  /**
   * **다른 카드 칸에 잘못 담겨 있다가 이 카드로 옮겨 온 낙찰 건수.**
   * 저쪽이 같은 이름의 카드를 한 칸에 묶어 둔 것을 우리가 제자리로 보낸 것이다.
   */
  movedIn?: number;
  // 최근 한 달 낙찰 건수. 없으면 null(옛 캐시 응답 대비 옵션).
  monthlySales?: number | null;
  // 값이 있는 카드에만 붙는다(없으면 null → 화면에서 자동으로 숨김).
  tcgplayer: TcgPlayerPrice | null;
  grades: EbayGradeStat[];
}


// 카드 발매판. PokemonPriceTracker는 일본판/영문판을 각각 별도 DB로 들고 있어서
// language 파라미터로 고른다. SNKRDUNK는 일본 마켓이라 영문판 카탈로그가 없고,
// 그래서 영문판 시세는 이쪽(eBay)에서만 볼 수 있다.
// ⚠️ 예전엔 'korean'(이베이 한글판)이 하나 더 있었다. **2026-08-10에 뺐다** — 그것만
//    낙찰가가 아니라 **호가**라 같은 화면에서 값의 뜻이 달랐고, 매물 제목으로만 찾아
//    세트·번호를 못 좁혔다(server/api.ts의 「(없앰) 이베이 한글판」 참고).
export type CardEdition = 'japanese' | 'english';


// 신뢰도 표기. PPT의 high/medium/low를 한글로. 그 외 값은 그대로 둔다.
export const CONFIDENCE_LABEL: Record<string, string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
};

// 메인에 쓸 대표가. 스마트 적정가가 있으면 그걸, 없으면 중앙값으로 대체한다.
/**
 * 목록·비교표에서 **대표로 보여 줄 등급**. 가장 많이 팔린 등급을 고른다.
 *
 * ⚠️ **배열 순서에 기대면 안 된다.** 등급 목록은 사람이 찾기 쉽도록 등급 순
 *    (미감정 → PSA 10 → 9 …)으로 세우기 때문에, 맨 앞이 "가장 많이 팔린 등급"이
 *    아니다. 예전에 grades[0]을 쓰던 곳이 셋 있었고(타일·비교표·추이 그래프),
 *    2026-08-07에 순서를 바꾸면서 셋 다 조용히 다른 등급을 가리키게 됐다.
 */
// 등급 세우는 순서는 lib/gradeOrder.ts 한 벌만 쓴다(서버도 같은 파일을 쓴다).
// 쓰는 쪽 편하라고 여기서 다시 내보낸다.
export { 등급순서값 } from '../lib/gradeOrder';

/**
 * 타일에 대표로 세울 등급 하나. **낙찰이 제일 많은 등급**을 고른다.
 *
 * ⚠️⚠️ **「등급 확인 안 됨」(ungraded)은 대표가 될 수 없다.** 그 칸은 값을 안 보여 주므로
 *    대표로 세우면 타일에 값이 빈다. 그리고 그 칸은 낙찰이 많은 편이라, 안 막으면
 *    꽤 많은 카드가 값 없는 타일이 된다.
 */
export function 대표등급(grades: EbayGradeStat[]): EbayGradeStat | undefined {
  const 쓸것 = grades.filter((g) => !등급확인안됨(g.grade));
  if (!쓸것.length) return undefined;
  return 쓸것.reduce((a, b) => (b.count > a.count ? b : a));
}

/**
 * 저쪽(PPT)이 **등급을 못 알아본 낙찰**을 담아 두는 칸인가.
 *
 * ⚠️⚠️ **이름이 `ungraded`라고 「감정 안 한 생카드」가 아니다.** 매물 사진을 직접 읽어
 *    확인했다(2026-08-15). 세 갈래로 표본을 나눠 봤는데 결과가 같았다:
 *
 *      | 어떤 카드에서 | 진짜 생카드 | 감정된 카드 |
 *      |---|---|---|
 *      | 미감정이 PSA 10보다 비싼 카드 | 41 (2%) | 2,072 |
 *      | 평범한 카드 | 1 (5%) | 21 |
 *      | 감정 기록이 아예 없는 카드 | 0 | 8 |
 *
 *    즉 이 칸은 **「제목만 봐서는 뭔지 모르겠는 것」 모음**이다. 판매자가 제목에 등급을
 *    안 적으면 저쪽은 여기 넣는데, 사진에는 감정 케이스가 찍혀 있다.
 * ⚠️ 그래서 **이 칸의 평균·중앙값·시세는 어느 것도 못 쓴다.** 생카드 값도 감정 카드 값도
 *    아닌 섞인 값이다. 사장님이 「싱글카드 가격인 줄 알았다」고 하신 게 그 결과다.
 * ⚠️ **낱개 낙찰은 그대로 보여 준다** — 「그 값에 팔렸다」는 사실은 참이고, 눌러 들어가
 *    직접 볼 수 있어야 한다(이 문제를 찾아낸 길이 바로 그것이었다).
 */
export function 등급확인안됨(grade: string): boolean {
  // ⚠️⚠️ **`raw`는 여기서 뺐다**(사장님 확인 2026-08-19). 사장님이 매물을 하나하나 열어
  //    **사진에 슬랩이 없고 제목·설명에 감정 회사·등급 언급이 하나도 없는 것**을 확인해
  //    주셨다 — 그건 「못 읽은 것」이 아니라 **진짜 미감정 싱글카드**다. 값을 보여 줘야 한다.
  //    `ungraded`만 남긴다 — 그건 저쪽이 등급을 못 읽어 던져 둔 칸이라 여전히 못 믿는다.
  // ⚠️ 「기타 감정 회사」도 **한 줄짜리 대표값은 안 낸다.** 회사도 등급도 섞인 칸이라
  //    (PCG 10 · TAG 8 · ACE 9가 한 칸) 가운데 값에 뜻이 없다 — 사장님이 「다른 것이
  //    섞인 칸에 중앙값이 무슨 뜻이냐」고 하신 그 잣대를 그대로 적용한 것이다.
  //    **낱개는 값과 회사 이름이 그대로 보인다** — 감추는 게 아니다.
  return grade === 'ungraded' || grade === '기타';
}

export function mainPrice(g: EbayGradeStat): { price: number; isSmart: boolean } {
  return g.smartPrice != null ? { price: g.smartPrice, isSmart: true } : { price: g.medianPrice, isSmart: false };
}

// "psa10" -> "PSA 10", "cgc9" -> "CGC 9"
export function formatGradeLabel(grade: string): string {
  // ⚠️ 예전엔 이 칸이 「미감정」으로 나갔다. 그 말이 「감정 안 한 생카드」로 읽혀서
  //    사람들이 생카드 시세로 오해했다 — 실제로는 대부분 감정된 카드다(위 `등급확인안됨`).
  // ⚠️ 「미감정」만으로는 옆칸 「등급 확인 안 됨」과 무엇이 다른지 안 보인다.
  //    **「싱글」을 붙여 슬랩이 안 씌워진 낱장임을 못 박는다**(사장님 지시 2026-08-19).
  if (grade === 'raw') return '미감정 싱글';
  if (grade === '기타') return '기타 감정 회사';
  if (등급확인안됨(grade)) return '등급 확인 안 됨';
  // ⚠️ 10 위의 등급은 사람 말로 적는다 — 「CGCP 10」이라고 나가면 아무도 못 알아본다.
  if (grade === 'cgcp10') return 'CGC 프리스틴 10';
  if (grade === 'bgsbl10') return 'BGS 블랙라벨 10';
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
  // ⚠️⚠️ **한글이 든 괄호는 떼고 보낸다.** 이베이 매물 제목은 영어라, 우리가 붙인 한글
  //    꼬리표가 검색어에 섞이면 **한 건도 안 나온다** — 「Captain Pikachu AR (중국판)」로
  //    검색이 나가고 있었다(사장님 지적 2026-08-19). 판을 밝히려고 붙인 말이라 화면에는
  //    그대로 두고, **저쪽에 보내는 검색어에서만** 뗀다.
  const 검색이름 = nameEn.replace(/\s*\([^)]*[가-힣][^)]*\)/g, '').trim();
  const query = [검색이름 || nameEn, number, gradeTerm].filter(Boolean).join(' ');
  const params = new URLSearchParams({ _nkw: query, LH_Sold: '1', LH_Complete: '1' });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}
