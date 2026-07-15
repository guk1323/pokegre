import { translateSearchQuery } from '../lib/translateQuery';
import { koreanizeTitle } from '../lib/koreanizeTitle';

export type ProductCategory = 'box' | 'card' | 'other';

export interface SnkrdunkCard {
  apparelId: number;
  title: string;
  imageUrl: string;
  price: number;
  stock: number;
  favoriteCount: number;
  link: string;
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
  usedMinPrice?: number;
  usedListingCount?: number;
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
): Promise<{ items: SnkrdunkCard[]; totalHits: number }> {
  const params = new URLSearchParams({
    func: 'all',
    refId: 'search',
    keyword: translateSearchQuery(keyword),
    sortKey: 'default',
    cardVersion: '2',
    brandIds: 'pokemon',
    perPage: '24',
    page: String(page),
  });

  const res = await fetch(`/api/snkrdunk/v3/search?${params.toString()}`);
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
export async function fetchApparelDetail(apparelId: number): Promise<{ title: string; imageUrl: string; price: number; stock: number } | null> {
  const res = await fetch(`/api/snkrdunk/v1/apparels/${apparelId}`);
  if (!res.ok) return null;
  const data: ApparelDetailResponse = await res.json();
  if (!data.primaryMedia?.imageUrl) return null;
  return {
    title: data.localizedName,
    imageUrl: data.primaryMedia.imageUrl,
    price: data.usedMinPrice ?? 0,
    stock: data.usedListingCount ?? 0,
  };
}

async function enrichWithCleanImages(cards: SnkrdunkCard[]): Promise<SnkrdunkCard[]> {
  const details = await Promise.all(cards.map((card) => fetchApparelDetail(card.apparelId).catch(() => null)));
  return cards.map((card, i) => {
    const detail = details[i];
    if (!detail) return { ...card, title: koreanizeTitle(card.title) };
    return {
      ...card,
      title: koreanizeTitle(detail.title || card.title),
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
  maxPages = 15,
): Promise<{ items: SnkrdunkCard[]; lastPage: number; exhausted: boolean }> {
  const collected: SnkrdunkCard[] = [];
  const seen = new Set(excludeIds);
  let page = startPage;
  let exhausted = false;

  for (let attempt = 0; attempt < maxPages; attempt++) {
    const { items } = await searchPokemonCards(keyword, page);
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

  const enriched = await enrichWithCleanImages(collected);
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

export interface PriceHistory {
  points: PricePoint[];
  trades: Trade[];
  ranges: RangeOption[];
  conditions: ConditionOption[];
}

interface TradingHistoryResponse {
  chart?: { lines?: { points?: PricePoint[] }[]; ranges?: RangeOption[] };
  trades?: Trade[];
  filters?: { conditions?: { options?: ConditionOption[] } };
}

// SNKRDUNK 시세 그래프는 apparelId가 아니라 productCatalogId로 조회한다. 이 값은
// 상품 상세(/v1/apparels/{id}) 응답에 이미 들어 있어서 한 번 더 태워 얻는다.
// (apparelId를 그대로 넣으면 200은 오지만 데이터가 비어 있다.)
//
// conditionCode를 주지 않으면 PSA10(¥36만)과 생카B(¥4.8만)가 한 줄에 섞여 그려져서
// 톱니처럼 튀는 무의미한 그래프가 나온다. 등급을 지정해야 시세 추이로 읽을 수 있다.
export async function fetchPriceHistory(
  apparelId: number,
  range: PriceRange = 'all',
  conditionCode?: string,
): Promise<PriceHistory | null> {
  const detailRes = await fetch(`/api/snkrdunk/v1/apparels/${apparelId}`);
  if (!detailRes.ok) return null;
  const detail: ApparelDetailResponse = await detailRes.json();
  const productCatalogId = detail.productCatalogId;
  if (!productCatalogId) return null;

  const params = new URLSearchParams({ range });
  if (conditionCode) params.set('condition_code', conditionCode);

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
  };
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
