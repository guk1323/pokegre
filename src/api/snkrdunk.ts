import { loadNameDict } from '../lib/nameDict';

export type ProductCategory = 'box' | 'card' | 'other';

export interface SnkrdunkCard {
  apparelId: number;
  title: string;
  // 한글화 전 원본(일본어) 제목. 이름 오류 신고에 함께 보내, 운영자 화면에서 최신
  // 사전으로 다시 변환해 "지금 이름"을 확인하는 데 쓴다.
  rawTitle?: string;
  imageUrl: string;
  price: number;
  stock: number;
  // 검색 결과에만 있는 값. 저장해둔 카드를 ID로 복원할 때는 상세 API에 이 필드가
  // 없어서 채울 수 없다 — 그때는 화면에서 "찜" 표기를 숨긴다.
  favoriteCount?: number;
  link: string;
  category: ProductCategory;
}

// 즐겨찾기·최근 본 카드에 저장하는 최소 단위. 가격·매물수는 계속 변하므로 저장하지
// 않고 볼 때마다 조회한다(예전엔 카드를 통째로 복사해서 찜한 순간 가격이 박제됐다).
// ID와 카테고리는 변하지 않으므로 저장해도 안전하고, 카테고리를 들고 있으면 복원할 때
// 상세 응답의 불안정한 카테고리 표기를 해석하지 않아도 된다.
export interface StoredCardRef {
  apparelId: number;
  category: ProductCategory;
}

export interface SizeChip {
  conditionId: number;
  filterConditionId: string;
  text: string;
  hasListing: boolean;
  usedMinPrice?: number;
  listingCount?: number;
}

interface ApparelDetailResponse {
  id: number;
  productCatalogId?: number;
  localizedName: string;
  primaryMedia?: { imageUrl: string };
  // 중고(싱글카드) 쪽 값
  usedMinPrice?: number;
  usedListingCount?: number;
  // 미개봉(박스·팩) 쪽 값
  minPrice?: number;
  listingCount?: number;
}

interface RawProduct {
  title: string;
  link: string;
  imageUrl: string;
  salePrice: number;
  stockFromGeneralUsers: number;
  favoriteCount: number;
  supershipLog?: { categoryId?: string };
}

interface SearchResponse {
  analyticsLog?: { totalHits?: number; rankingTotalHits?: number };
  search?: { products?: RawProduct[]; rankingProducts?: RawProduct[] };
}

function parseApparelId(link: string): number {
  const match = link.match(/apparels\/(\d+)/);
  return match ? Number(match[1]) : 0;
}

// SNKRDUNK 카테고리 ID: 6/26 = 박스·팩 등 미개봉 상품, 6/33 = 싱글 카드.
function deriveCategory(categoryId?: string): ProductCategory {
  if (categoryId === '6/26') return 'box';
  if (categoryId === '6/33') return 'card';
  return 'other';
}

function toCard(raw: RawProduct): SnkrdunkCard {
  return {
    apparelId: parseApparelId(raw.link),
    title: raw.title,
    imageUrl: raw.imageUrl,
    price: raw.salePrice,
    stock: raw.stockFromGeneralUsers,
    favoriteCount: raw.favoriteCount,
    link: raw.link,
    category: deriveCategory(raw.supershipLog?.categoryId),
  };
}

export async function searchPokemonCards(
  keyword: string,
  page = 1,
  signal?: AbortSignal,
): Promise<{ items: SnkrdunkCard[]; totalHits: number }> {
  const params = new URLSearchParams({
    func: 'all',
    refId: 'search',
    keyword: (await loadNameDict()).translateSearchQuery(keyword),
    sortKey: 'default',
    cardVersion: '2',
    brandIds: 'pokemon',
    perPage: '24',
    page: String(page),
  });

  const res = await fetch(`/api/snkrdunk/v3/search?${params.toString()}`, { signal });
  if (!res.ok) throw new Error('시세 검색에 실패했습니다.');

  const data: SearchResponse = await res.json();
  const rawItems = data.search?.products?.length ? data.search.products : (data.search?.rankingProducts ?? []);

  const seen = new Set<number>();
  const items = rawItems.map(toCard).filter((card) => {
    if (seen.has(card.apparelId)) return false;
    seen.add(card.apparelId);
    return true;
  });

  return {
    items,
    totalHits: data.analyticsLog?.rankingTotalHits ?? data.analyticsLog?.totalHits ?? items.length,
  };
}

// 검색 결과의 imageUrl은 개별 판매자가 올린 실물 사진인 경우가 많아 화질/구도가 제각각이다.
// 상품 상세(apparels/{id})의 primaryMedia는 스니커덩크가 배경을 정리해 올린 대표 이미지라
// 카드 목록에는 이쪽을 우선 사용한다.
// 같은 순간에 같은 카드를 두 곳에서 부르면 요청을 하나로 합친다.
// 홈 화면이 "즐겨찾기"와 "최근 본 카드"를 각자 되살리는데, 양쪽에 다 있는 카드는
// 같은 주소를 두 번 불렀다(실측: 8종을 13번). 시세는 계속 새로 받아야 하므로
// 결과를 오래 들고 있지는 않는다 — 진행 중인 요청만 나눠 쓰고 끝나면 지운다.
const detailInFlight = new Map<number, Promise<{ title: string; imageUrl: string; price: number; stock: number } | null>>();

export function fetchApparelDetail(apparelId: number) {
  const running = detailInFlight.get(apparelId);
  if (running) return running;
  const job = fetchApparelDetailOnce(apparelId).finally(() => detailInFlight.delete(apparelId));
  detailInFlight.set(apparelId, job);
  return job;
}

async function fetchApparelDetailOnce(apparelId: number): Promise<{ title: string; imageUrl: string; price: number; stock: number } | null> {
  const res = await fetch(`/api/snkrdunk/v1/apparels/${apparelId}`);
  if (!res.ok) return null;
  const data: ApparelDetailResponse = await res.json();
  if (!data.primaryMedia?.imageUrl) return null;
  // 가격이 상품 종류에 따라 다른 필드에 담겨 온다. 싱글카드는 중고 거래라
  // usedMinPrice(박스는 0)에, 박스·팩은 미개봉이라 minPrice(싱글은 0)에 들어있다.
  // 한쪽만 읽으면 다른 쪽이 ¥0으로 보인다.
  return {
    title: data.localizedName,
    imageUrl: data.primaryMedia.imageUrl,
    price: data.usedMinPrice || data.minPrice || 0,
    stock: data.usedListingCount || data.listingCount || 0,
  };
}

// 저장해둔 참조(ID + 카테고리)를 현재 시세로 채워서 되살린다. 실패한 카드는 조용히
// 빼는데, 판매 종료 등으로 사라진 상품을 목록에서 계속 붙들고 있을 이유가 없다.
export async function resolveStoredCards(refs: StoredCardRef[]): Promise<SnkrdunkCard[]> {
  // 비어 있으면 여기서 끝낸다. 아래에서 이름 사전을 받는데, 즐겨찾기가 하나도 없는
  // 사람까지 첫 화면에서 사전을 통째로 받게 된다(운영 빌드에서 실제로 그랬다).
  if (refs.length === 0) return [];
  const details = await Promise.all(refs.map((ref) => fetchApparelDetail(ref.apparelId).catch(() => null)));
  const dict = await loadNameDict();

  return refs
    .map((ref, i): SnkrdunkCard | null => {
      const detail = details[i];
      if (!detail) return null;
      return {
        apparelId: ref.apparelId,
        title: dict.koreanizeTitle(detail.title),
        rawTitle: detail.title,
        imageUrl: detail.imageUrl,
        price: detail.price,
        stock: detail.stock,
        link: `https://snkrdunk.com/apparels/${ref.apparelId}`,
        category: ref.category,
      };
    })
    .filter((card): card is SnkrdunkCard => card !== null);
}

async function enrichWithCleanImages(cards: SnkrdunkCard[], signal?: AbortSignal): Promise<SnkrdunkCard[]> {
  if (cards.length === 0) return [];
  // ⚠️ 여기가 요청이 제일 많이 나가는 자리다 — 카드마다 상세를 한 번씩 부른다
  //    (한 검색에 91번까지 나갔다, 실측 2026-08-04). 검색어가 이미 바뀌었으면
  //    아예 시작하지 않는다. 위 목록 요청과 달리 이건 시작 전에 막아야 한다 —
  //    fetchApparelDetail은 같은 카드를 부르는 다른 화면과 요청을 합쳐 쓰므로,
  //    신호를 넘겨 끊으면 남의 요청까지 같이 끊긴다.
  if (signal?.aborted) return cards;
  const details = await Promise.all(cards.map((card) => fetchApparelDetail(card.apparelId).catch(() => null)));
  const dict = await loadNameDict();
  return cards.map((card, i) => {
    const detail = details[i];
    if (!detail) return { ...card, title: dict.koreanizeTitle(card.title), rawTitle: card.title };
    return {
      ...card,
      title: dict.koreanizeTitle(detail.title || card.title),
      rawTitle: detail.title || card.title,
      imageUrl: detail.imageUrl || card.imageUrl,
      price: detail.price || card.price,
      stock: detail.stock || card.stock,
    };
  });
}

// SNKRDUNK 검색 결과는 카드 종류가 아니라 "매물" 단위라, 인기 상품 하나의 개별 판매글이
// 한 페이지를 통째로 채우는 경우가 많다. 그래서 한 번의 "더보기"로 페이지를 여러 장
// 넘겨가며 실제로 처음 보는 카드가 일정 수 모일 때까지 훑어준다.
export async function fetchMoreUniqueCards(
  keyword: string,
  startPage: number,
  excludeIds: Set<number>,
  targetNew = 12,
  // ⚠️ 예전엔 15장이었다. 첫 검색 한 번이 목록 페이지를 15번까지 넘기고, 거기 나온
  //    카드마다 상세를 또 받는다. 그래서 손으로 한 글자씩 치면 "리자몽 VSTAR" 한
  //    마디에 요청이 120번 나갔다(실측 2026-08-04). 우리 서버가 한 사람당 10분에
  //    600번으로 막고 있어서, 10분에 다섯 번만 검색하면 그 뒤로 "시세를 불러오지
  //    못했습니다"가 떴다. 첫 검색은 3장까지만 보고 모자라면 "더보기"에서 채운다.
  maxPages = 3,
  signal?: AbortSignal,
): Promise<{ items: SnkrdunkCard[]; lastPage: number; exhausted: boolean }> {
  const collected: SnkrdunkCard[] = [];
  const seen = new Set(excludeIds);
  let page = startPage;
  let exhausted = false;

  for (let attempt = 0; attempt < maxPages; attempt++) {
    // 검색어가 바뀌었으면 다음 장을 넘기지 않는다. 이게 없으면 앞 검색의 7~9페이지와
    // 뒤 검색의 1~4페이지가 동시에 도는 일이 생긴다(실제로 기록으로 확인).
    if (signal?.aborted) break;
    const { items } = await searchPokemonCards(keyword, page, signal);
    if (items.length === 0) {
      exhausted = true;
      break;
    }
    for (const card of items) {
      if (!seen.has(card.apparelId)) {
        seen.add(card.apparelId);
        collected.push(card);
      }
    }
    if (collected.length >= targetNew) break;
    page += 1;
  }

  const enriched = await enrichWithCleanImages(collected, signal);
  return { items: enriched, lastPage: page, exhausted };
}

export type PriceRange = 'oneWeek' | 'oneMonth' | 'threeMonths' | 'all';

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface Trade {
  price: number;
  soldAt: string;
  title: string;
  label: string;
}

export interface RangeOption {
  key: PriceRange;
  name: string;
  hasData: boolean;
}

export interface ConditionOption {
  code: string;
  name: string;
}

export interface VariantOption {
  id: number;
  name: string;
}

export interface PriceHistory {
  points: PricePoint[];
  trades: Trade[];
  ranges: RangeOption[];
  conditions: ConditionOption[];
  variants: VariantOption[];
}

interface TradingHistoryResponse {
  chart?: { lines?: { points?: PricePoint[] }[]; ranges?: RangeOption[] };
  trades?: Trade[];
  filters?: {
    conditions?: { options?: ConditionOption[] };
    variants?: { options?: VariantOption[] };
  };
}

// SNKRDUNK가 등급/수량 표기에 쓰는 일본어. "PSA8以下"처럼 영문 등급명에 한자가 섞여
// 오기 때문에 부분 문자열로 치환한다. BL(Black Label)/GL(Gold Label)이나 ARS 같은
// 감정 용어는 국내에서도 그대로 쓰므로 건드리지 않는다.
// 수량 단위는 상품 종류마다 다르다 — 싱글카드는 枚(장), 박스는 個(개), 팩은 パック(팩).
const GRADE_TERMS: [string, string][] = [
  ['他鑑定品', '기타 감정품'],
  ['以下', ' 이하'],
  ['新品', '미개봉'],
  ['パック', '팩'],
  ['枚', '장'],
  ['個', '개'],
];

export function koreanizeGrade(text: string): string {
  let result = text;
  for (const [ja, ko] of GRADE_TERMS) {
    if (result.includes(ja)) result = result.split(ja).join(ko);
  }
  return result;
}

// SNKRDUNK 시세 그래프는 apparelId가 아니라 productCatalogId로 조회한다. 이 값은
// 상품 상세(/v1/apparels/{id}) 응답에 이미 들어 있어서 한 번 더 태워 얻는다.
// (apparelId를 그대로 넣으면 200은 오지만 데이터가 비어 있다.)
//
// conditionCode를 주지 않으면 PSA10(¥36만)과 생카B(¥4.8만)가 한 줄에 섞여 그려져서
// 톱니처럼 튀는 무의미한 그래프가 나온다. 등급을 지정해야 시세 추이로 읽을 수 있다.
//
// variantId(수량)도 마찬가지다. 특히 박스는 가격이 묶음 "총액"이라 10개 묶음이
// ¥109,000에 팔리는데, 필터 없이 조회하면 1개짜리 ¥10,900과 한 줄에 그려져 시세가
// 10배로 부풀어 보인다(싱글카드는 장당 가격이라 영향이 0.5% 수준으로 작다).
export async function fetchPriceHistory(
  apparelId: number,
  range: PriceRange = 'all',
  conditionCode?: string,
  variantId?: number,
): Promise<PriceHistory | null> {
  const detailRes = await fetch(`/api/snkrdunk/v1/apparels/${apparelId}`);
  if (!detailRes.ok) return null;
  const detail: ApparelDetailResponse = await detailRes.json();
  const productCatalogId = detail.productCatalogId;
  if (!productCatalogId) return null;

  const params = new URLSearchParams({ range });
  if (conditionCode) params.set('condition_code', conditionCode);
  if (variantId) params.set('variant_id', String(variantId));

  const res = await fetch(`/api/snkrdunk/v3/products/${productCatalogId}/trading-history?${params.toString()}`);
  if (!res.ok) return null;
  const data: TradingHistoryResponse = await res.json();

  const points = data.chart?.lines?.find((line) => line.points?.length)?.points ?? [];

  return {
    points,
    trades: data.trades ?? [],
    ranges: data.chart?.ranges ?? [],
    // 박스는 등급 개념이 없어서 빈 배열로 온다 — 그대로 넘겨서 UI가 선택기를 숨기게 한다.
    conditions: data.filters?.conditions?.options ?? [],
    variants: data.filters?.variants?.options ?? [],
  };
}

// 어느 등급에 "실거래 기록"이 있는지 알아낸다.
//
// 왜 필요한가: 스니커덩크는 그 카드에 거래가 한 건도 없는 등급까지 선택 목록에 다
// 넣어 준다. 골라 봐야 "실거래 기록이 없습니다"만 나오는 칸이 절반이 넘는다.
// 목록만 봐서는 알 수 없고, 응답 어디에도 미리 알려주는 값이 없다(옵션에 code와
// name뿐이고, chart.lines도 등급별로 나뉘지 않는다). 등급마다 한 번씩 물어보는 수밖에 없다.
//
// ⚠️ 매물(size-chips)로 대신 재면 안 된다. 그건 "지금 팔려고 내놓은 것"이고 그래프는
//    "실제로 팔린 것"이라 서로 다른 자료다. 매물 기준으로 거르면 예전에 거래된 등급의
//    기록이 통째로 숨는다(2026-08-03에 그렇게 만들었다가 되돌렸다).
//
// ⚠️ range는 항상 'all'로 본다. 기간을 좁히면 "그 기간에만" 거래가 없는 등급까지
//    빠지는데, 그건 목록에서 지울 일이 아니라 그래프가 비어 있다고 말할 일이다.
// ⚠️ 수량(variantId)은 **그래프와 똑같이** 붙여야 한다. 안 붙이면 "2장 묶음으로
//    팔린 것"까지 세어 '기록 있음'으로 판정하는데, 정작 그래프는 1장짜리만 받아
//    비어 나온다(망나뇽 R [SM11 068/094]의 B등급이 그랬다 — 전체 1건, 1장 0건).
//    두 쪽이 다른 걸 보면 "기록 있다고 해놓고 빈 그래프"가 된다(2026-08-05).
// ⚠️ 스니커덩크는 무료지만 한 번에 열여섯 번을 몰아 보내지는 않는다. 넷씩 끊어 보낸다.
// 카드마다 한 번만 훑는다. 같은 카드를 다시 열면 그때 알아낸 것을 그대로 쓴다
// (안 그러면 카드를 열 때마다 열여섯 번씩 다시 물어본다).
// 수량마다 답이 다르므로 열쇠에 수량도 넣는다.
const tradedGradeCache = new Map<string, Set<string>>();

export async function fetchTradedGrades(
  apparelId: number,
  codes: string[],
  variantId?: number,
): Promise<Set<string>> {
  const cacheKey = `${apparelId}|${variantId ?? ''}`;
  const cached = tradedGradeCache.get(cacheKey);
  if (cached) return cached;
  const out = new Set<string>();
  if (!codes.length) return out;
  const detailRes = await fetch(`/api/snkrdunk/v1/apparels/${apparelId}`);
  if (!detailRes.ok) return out;
  const detail: ApparelDetailResponse = await detailRes.json();
  const productCatalogId = detail.productCatalogId;
  if (!productCatalogId) return out;

  const queue = [...codes];
  const worker = async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      try {
        const q = new URLSearchParams({ range: 'all', condition_code: code });
        if (variantId) q.set('variant_id', String(variantId));
        const res = await fetch(
          `/api/snkrdunk/v3/products/${productCatalogId}/trading-history?${q.toString()}`,
        );
        if (!res.ok) continue;
        const data: TradingHistoryResponse = await res.json();
        if (data.chart?.lines?.some((l) => l.points?.length)) out.add(code);
      } catch {
        // 한 등급을 못 받아도 나머지는 계속 본다. 못 받은 등급은 목록에 남는다(안전한 쪽).
        out.add(code);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  tradedGradeCache.set(cacheKey, out);
  return out;
}

const CONDITION_GROUPS: { label: string; codes: string[] }[] = [
  { label: '싱글 카드', codes: ['like_new', 'minor_scratches', 'moderate_scratches', 'significant_damage'] },
  { label: 'PSA', codes: ['psa_10', 'psa_9', 'psa_8_below'] },
  { label: 'BGS', codes: ['bgs_10_black', 'bgs_10_gold', 'bgs_9_5', 'bgs_9_below'] },
  { label: 'ARS', codes: ['ars_10_plus', 'ars_10', 'ars_9', 'ars_8_below'] },
  { label: '기타', codes: ['other_grading_company'] },
];

export interface ConditionGroup {
  label: string;
  chips: SizeChip[];
}

export const RAW_GRADE_DESCRIPTION: Record<string, string> = {
  like_new: '거의 미사용',
  minor_scratches: '약한 스크래치',
  moderate_scratches: '중간 스크래치',
  significant_damage: '손상 있음',
};


export async function fetchConditionPrices(apparelId: number): Promise<ConditionGroup[]> {
  const res = await fetch(`/api/snkrdunk/v2/products/${apparelId}/size-chips?type=apparel`);
  if (!res.ok) throw new Error('등급별 시세를 불러오지 못했습니다.');
  const data: { chips?: SizeChip[] } = await res.json();
  const chips = data.chips ?? [];
  const byCode = new Map(chips.map((chip) => [chip.filterConditionId, chip]));

  return CONDITION_GROUPS.map((group) => ({
    label: group.label,
    chips: group.codes.map((code) => byCode.get(code)).filter((c): c is SizeChip => Boolean(c)),
  })).filter((group) => group.chips.length > 0);
}
