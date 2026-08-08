import { loadNameDict } from '../lib/nameDict';
import { pptSetKo } from '../lib/pptSetKo';
import { 레어도떼기, 레어도맞나, 마켓전용말떼기 } from '../lib/rarityCode';

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
  sales?: { price: number; date: string; url: string; auction: boolean; title?: string; 뺀까닭?: string }[];
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
  totalSales: number;
  /** 딴 카드로 보여 뺀 낙찰 건수. 세트 이름이 겹쳐 저쪽이 섞어 놓은 것을 우리가 뺐다. */
  droppedOther?: number;
  // 최근 한 달 낙찰 건수. 없으면 null(옛 캐시 응답 대비 옵션).
  monthlySales?: number | null;
  // 값이 있는 카드에만 붙는다(없으면 null → 화면에서 자동으로 숨김).
  tcgplayer: TcgPlayerPrice | null;
  grades: EbayGradeStat[];
}

// 한 페이지에 받는 카드 수. 유료 전환 전엔 크레딧을 아끼려 10장에 묶어뒀지만, 이제
// 여유가 있어 한 화면을 채우는 12장씩 받고 "더 보기"로 offset을 넘겨 이어 받는다.
// (그리드가 2·3·4열이라 12가 어느 열 수에서도 딱 떨어진다.) 서버가 같은 요청을 24시간
// 캐싱하고, PokemonPriceTracker는 page 대신 offset 방식만 지원한다.
export const EBAY_PAGE_SIZE = 12;
// 레어도로 좁힐 때 한 번에 받는 장수(우리가 걸러야 하므로 재료가 더 필요하다).
const EBAY_RARITY_PAGE_SIZE = 48;

// 카드 발매판. PokemonPriceTracker는 일본판/영문판을 각각 별도 DB로 들고 있어서
// language 파라미터로 고른다. SNKRDUNK는 일본 마켓이라 영문판 카탈로그가 없고,
// 그래서 영문판 시세는 이쪽(eBay)에서만 볼 수 있다.
// 한글판은 PPT가 아니라 이베이 Browse API(호가)로 별도 처리하지만, 발매판 토글을
// 공유하려고 여기 함께 둔다. PPT 검색 함수엔 'korean'을 넘기지 않게 호출부에서 막는다.
export type CardEdition = 'japanese' | 'english' | 'korean';

// PokemonPriceTracker 일일 크레딧 초과(429)를 호출부에서 식별하기 위한 에러 표식.
export const EBAY_RATE_LIMITED = 'ebay_rate_limited';
// 하루치를 다 쓴 경우. 분당 한도와 달리 한국시간 오전 9시까지 안 열리므로 안내가 다르다.
export const EBAY_DAILY_LIMIT = 'ebay_daily_limit';

export interface EbaySearchResult {
  cards: EbayCard[];
  /** 뒤에 붙은 레어도로 실제로 좁혔을 때 그 코드("SAR"). 화면에 알려 준다. */
  rarity?: string;
  /** 레어도를 쳤는데 받아 온 것 중에 하나도 없을 때 그 코드(전체를 보여 준 까닭). */
  rarityMissing?: string;
  /** 레어도**만** 쳤을 때 그 코드. 이름 없이는 찾을 수 없다고 알려야 한다. */
  rarityOnly?: string;
  /** 저쪽이 모르는 말(":1ED")을 빼고 찾았을 때 그 말. 빈 화면 대신 알려 주려는 것이다. */
  droppedTerm?: string;
  // 더 받을 게 남았는지. 원본 페이지가 꽉 찼으면(=요청한 만큼 왔으면) 뒤에 더 있다고 본다.
  hasMore: boolean;
  /** 실제로 보낸 영문 검색어. 결과가 없을 때 "이베이에서 직접 찾아보기" 링크에 쓴다. */
  translated?: string;
  /**
   * 지금 받은 게 아니라 지난번에 받아 둔 시세일 때, 그때 받은 시각(ISO).
   * 하루치 크레딧을 다 썼거나 통신이 실패하면 서버가 이걸 붙여 지난 값을 준다 —
   * 아무것도 안 보여주는 것보다 "언제 기준인지 밝히고 보여주는 것"이 낫기 때문이다.
   */
  asOf?: string;
}

// 서버 프록시(shapeEbayCards)가 원본 PokemonPriceTracker 응답을 재배포하지 않도록
// 화면용 필드만 추려 { cards, rawCount } 형태로 내려준다. offset으로 다음 페이지를 잇는다.
// 같은 PPT 데이터에서 어느 시세를 볼지. 'ebay'는 낙찰 기록이 있는 카드, 'tcgplayer'는
// TCGplayer 마켓가가 있는 카드만 서버가 추려 준다(have 파라미터).
export type PriceMarket = 'ebay' | 'tcgplayer';

// 검색어와 카드 이름이 실제로 맞는 것을 앞으로 올린다.
//
// 왜 필요한가: PPT의 search가 세트 이름에도 걸리기 때문이다. "Bulbasaur"를 찾으면
// 「Intro Pack (Bulbasaur)」의 모든 카드가 딸려 온다 — 이름이 이상해씨가 아닌 것들이다.
// 순서만 바꾸고 빼지는 않는다(세트 이름으로 찾는 경우도 있다).
//
// 검색어에 번호나 등급이 섞여 있어도(예: "Pikachu 191") 글자 부분만 본다.
function rankByNameMatch<T extends { nameEn?: string; name: string }>(cards: T[], query: string): T[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);
  if (!words.length) return cards;
  const score = (c: T) => {
    const n = String(c.nameEn ?? c.name).toLowerCase();
    return words.some((w) => n.includes(w)) ? 0 : 1;
  };
  // 안정 정렬 — 같은 점수끼리는 PPT가 준 순서(값 높은 순)를 지킨다.
  return cards.map((c, i) => ({ c, i, s: score(c) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.c);
}

/**
 * 카드 번호(tcgPlayerId)로 그 한 장의 **이름**을 알아낸다.
 *
 * 왜: 이베이·TCGplayer 공유 링크는 /e/<번호>·/t/<번호> 꼴인데(주소가 길어져 이름을 뺐다),
 * 받는 쪽은 ?n=이름이 있어야만 카드를 열 수 있었다. 그래서 그 링크로 들어오면 아무것도
 * 안 열리고 홈이 됐다(2026-08-07 운영자 제보). 코드에는 'PPT가 tcgPlayerId 단건 조회를
 * 안 받는다'고 적혀 있었는데 **받는다** — 직접 불러 확인했다.
 *
 * ⚠️ **이름만으로는 부족하다.** "Pikachu"로 찾으면 값 높은 다른 피카츄가 먼저 와서
 * 우리 카드가 12장 안에 아예 없다(실측). PPT의 search는 번호도 읽으므로
 * "Pikachu XY95"처럼 번호를 붙여 보낸다 — 그러면 정확히 한 장만 온다(실측).
 * 판(일본/북미)은 링크에 없으므로 북미로 먼저 찾고 없으면 일본으로 한 번 더 본다.
 */
export async function fetchCardNameById(
  tcgPlayerId: string,
  // 주소가 `/e/`면 'ebay', `/t/`면 'tcgplayer'. **이미 아는 정보라 먼저 물어본다** —
  // 안 주면 네 번 다 두드리게 되어 헛걸음이 생긴다.
  먼저?: 'ebay' | 'tcgplayer',
): Promise<{ query: string; edition: CardEdition } | null> {
  // ⚠️ **판(일본/북미) × 소스(이베이/TCGplayer) 네 가지를 다 물어봐야 한다.**
  //    서버는 `have`에 따라 카드를 거른다 — 기본값(이베이)은 **낙찰 기록이 있는 카드만**
  //    통과시킨다. 그래서 낙찰이 없는 카드는 이름을 못 찾고, 공유 링크를 받은 사람이
  //    홈으로 떨어졌다. `/t/`는 TCGplayer 링크인데도 이베이 조건으로 걸러졌다
  //    (2026-08-07 발견: /t/611448 · /t/614026이 그랬다. 우리 표본에서 이베이 낙찰이
  //    없는 카드가 절반쯤이라, 공유 링크 상당수가 이렇게 열리지 않았다).
  //    여기서 필요한 건 **이름 한 줄뿐**이라 어느 쪽에서 찾든 상관없다.
  const 소스: ('ebay' | 'tcgplayer')[] =
    먼저 === 'tcgplayer' ? ['tcgplayer', 'ebay'] : ['ebay', 'tcgplayer'];
  const 물을것: { language: CardEdition; have: 'ebay' | 'tcgplayer' }[] = [];
  for (const have of 소스) for (const language of ['english', 'japanese'] as const) 물을것.push({ language, have });
  for (const { language, have } of 물을것) {
    try {
      const p = new URLSearchParams({ language, tcgPlayerId, includeEbay: 'false', limit: '1', have });
      const res = await fetch(`/api/local/card-prices?${p.toString()}`);
      if (!res.ok) continue;
      const json = (await res.json()) as { cards?: { nameEn?: string; name?: string; cardNumber?: string | null }[] };
      const c = json.cards?.[0];
      // 검색에는 원문 영문 이름을 쓴다(한글로 바꾼 이름은 PPT가 못 찾는다).
      const name = c?.nameEn || c?.name;
      if (!name) continue;
      // 번호에서 "XY95" 같은 앞부분만 쓴다("104/110"이면 104).
      const num = String(c?.cardNumber ?? '').split('/')[0].trim();
      // ⚠️ 어느 판에서 찾았는지도 알려야 한다. 화면이 다른 판으로 검색하면 0건이 된다
      //    (영문판 카드를 일본판 탭에서 찾은 꼴 — 2026-08-07에 그렇게 안 나왔다).
      return { query: num ? `${name} ${num}` : name, edition: language };
    } catch {
      /* 다음 판으로 넘어간다 */
    }
  }
  return null;
}

export async function searchEbayCards(
  query: string,
  edition: CardEdition = 'japanese',
  offset = 0,
  market: PriceMarket = 'ebay',
  // 세트 이름으로 한 세트만 보고 싶을 때(도감에서 카드를 눌러 온 경우).
  // ⚠️ 검색어에 세트 이름을 **붙이면 0건**이다(실측). 별도 파라미터라야 걸러진다.
  setName?: string,
): Promise<EbaySearchResult> {
  // ⚠️ **뒤에 붙은 레어도는 떼어서 우리가 거른다.** 저쪽의 search는 카드 이름만 보므로
  //    그대로 보내면 "리자몽 MUR"은 0장이고, "리자몽 SAR"은 더 나쁘다 — 저쪽이 모르는
  //    낱말을 흘려버려 **SAR가 아닌 카드 7장**을 준다(2026-08-08 실측). 엉뚱한 카드를
  //    그 레어도인 것처럼 보여 주는 셈이다. 팝수 화면과 같은 방식으로 고친다.
  // ⚠️ **스니커덩크 전용 꼬리말을 먼저 뗀다.** ":1ED" 같은 것은 저쪽(PPT)이 모르고,
  //    그대로 보내면 0장이 온다. 레어도보다 먼저 떼야 "거북왕 EX RR :1ED"에서
  //    레어도(RR)까지 제대로 잡힌다.
  const { 이름: 저쪽말뺀것, 뗀말 } = 마켓전용말떼기(query);
  const { 이름: 이름부분, 코드: 레어도 } = 레어도떼기(저쪽말뺀것);
  const trimmed = 이름부분.trim();
  // ⚠️ 레어도만 쳤을 때는 빈손으로 돌려주되 **그 까닭을 같이 준다.** 저쪽에는 레어도로
  //    물어보는 방법이 없어서, 그냥 보내면 이름에 그 글자가 든 카드가 잔뜩 온다
  //    ("MUR" → Whismur·Murkrow 76장, 2026-08-08 확인).
  if (!trimmed && 레어도) return { cards: [], hasMore: false, rarityOnly: 레어도 };
  if (!trimmed) return { cards: [], hasMore: false };

  // PokemonPriceTracker의 search는 일본판 DB도 영문 카드명으로 색인돼 있어서,
  // 두 발매판 모두 한글→영문 번역을 태워 보낸다.
  const dict = await loadNameDict();
  const translated = dict.translateSearchQueryToEnglish(trimmed, edition);
  const params = new URLSearchParams({
    language: edition,
    search: translated,
    includeEbay: 'true',
    // ⚠️ 레어도로 거를 때는 **한 번에 더 받는다.** 12장만 받아 거르면 한 페이지에
    //    한두 장만 남아 "없는 카드"처럼 보인다. 값이 높은 순이라 앞쪽에 몰려 있지도 않다.
    //    크레딧은 장당 3배라 48장이면 144크레딧이다(하루 200,000 중).
    limit: String(레어도 ? EBAY_RARITY_PAGE_SIZE : EBAY_PAGE_SIZE),
    offset: String(offset),
    // ⚠️ PPT의 search는 카드 이름만 보는 게 아니라 세트 이름까지 뒤진다.
    //    "Bulbasaur"로 찾으면 「Intro Pack (Bulbasaur)」 세트가 걸려서 그 세트의
    //    포션·에너지·피카츄가 올라온다(사용자 제보: 이상해씨를 찾았는데 엉뚱한 카드).
    //    값이 높은 순으로 받으면 그런 잡동사니가 뒤로 밀린다. 이름만 찾는 파라미터는
    //    없다(name을 보내면 400 — 쓸 수 있는 건 search뿐).
    sortBy: 'price',
    sortOrder: 'desc',
  });
  if (market === 'tcgplayer') params.set('have', 'tcgplayer');
  if (setName) params.set('setName', setName);

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
  const json = (await res.json()) as { cards?: EbayCard[]; rawCount?: number; asOf?: string };
  const cards = await Promise.all(
    (json.cards ?? []).map(async (card) => ({
      ...card,
      // 원본 영문 이름은 이베이 검색 링크용으로 남겨두고, 표시용 이름만 한글로 바꾼다.
      nameEn: card.name,
      // ⚠️ **koName을 쓴다.** 예전엔 koreanizeEnglishCardName만 써서 저쪽 이름에
      //    붙어 오는 번호 꼬리가 그대로 남았다 — "제크로무 ex - 174/086"으로 뜨는데
      //    바로 아랫줄에 번호를 또 적어 **같은 번호가 두 번** 나왔다(2026-08-07 확인).
      //    다른 화면들은 koName을 써서 "제크로무 ex"로 나온다. 한 벌로 맞춘다.
      name: dict.koName('en', card.name),
      // ⚠️ 원본 세트 이름을 남긴다. PPT의 세트 조건은 부분 일치라("Team Rocket"을
      //    걸면 "EX Team Rocket Returns"도 온다) 부르는 쪽이 "정말 그 세트인가"를
      //    확인해야 하는데, 한글로 바꾼 이름으로는 견줄 수 없다(2026-08-07).
      setNameEn: card.setName,
      // 대응표로 먼저 찾고, 없으면 예전처럼 영문 세트명 사전에 맡긴다.
      setName: (await pptSetKo(card.setName)) || dict.koreanizeEnglishSetName(card.setName),
    })),
  );
  // 정렬만으로는 다 안 밀린다. 이름이 실제로 맞는 카드를 앞으로 올린다(빼지는 않는다 —
  // 세트 이름으로 찾는 사람도 있고, 우리가 못 알아본 표기일 수도 있다).
  const ranked = rankByNameMatch(cards, translated);
  // ⚠️ 뒤에 붙은 레어도로 **여기서** 좁힌다. 걸러서 한 장도 안 남으면 거르지 않은
  //    목록을 그대로 준다 — 빈 화면을 주면 그 카드를 우리가 아예 안 다루는 줄 안다.
  //    부르는 쪽이 알 수 있도록 실제로 좁혔는지를 같이 돌려준다.
  //
  // ✅ **실제로 돌려 확인했다**(2026-08-08, 레어도를 20가지로 넓힌 뒤. 288크레딧 씀):
  //      "디안시 PR" → 2장, 둘 다 [Prism Rare]          ← 제대로 좁혀진다
  //      "로토무 TR" → 맞는 게 0장 → 전체를 보여 주며
  //                    "'TR' 카드가 없어 전체를 보여 드립니다"가 화면에 뜬다
  //    **다시 재려면 크레딧이 든다**(레어도 검색은 48장×3 = 144크레딧). 코드가 안 바뀐
  //    동안은 이 기록으로 갈음할 것.
  const 걸러진 = 레어도 ? ranked.filter((c) => 레어도맞나(레어도, c.rarity)) : ranked;
  const 쓸것 = 레어도 && 걸러진.length === 0 ? ranked : 걸러진;
  return {
    cards: 쓸것,
    hasMore: (json.rawCount ?? cards.length) >= (레어도 ? EBAY_RARITY_PAGE_SIZE : EBAY_PAGE_SIZE),
    translated,
    asOf: json.asOf,
    rarity: 레어도 && 걸러진.length > 0 ? 레어도 : undefined,
    rarityMissing: 레어도 && 걸러진.length === 0 ? 레어도 : undefined,
    // 스니커덩크에서만 통하는 말을 빼고 찾았으면 그 사실을 알린다(빈 화면보다 낫다).
    droppedTerm: 뗀말 || undefined,
  };
}

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

export function 대표등급(grades: EbayGradeStat[]): EbayGradeStat | undefined {
  if (!grades.length) return undefined;
  return grades.reduce((a, b) => (b.count > a.count ? b : a));
}

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
