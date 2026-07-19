export interface PopularSearch {
  term: string;
  count: number;
  rank: number;
  change: 'new' | 'flat' | 'up' | 'down';
  delta: number;
}

export interface PopularSearchResponse {
  asOf: number;
  items: PopularSearch[];
}

export function trackSearch(query: string): void {
  const term = query.trim();
  if (!term) return;
  fetch('/api/local/track-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: term }),
  }).catch(() => undefined);
}

export async function fetchPopularSearches(): Promise<PopularSearchResponse> {
  const res = await fetch('/api/local/popular-searches');
  if (!res.ok) throw new Error('인기 검색어를 불러오지 못했습니다.');
  return res.json();
}

// 같은 브라우저가 하루에 한 번만 방문으로 집계되게 한다. 새로고침·페이지 이동마다
// 세면 숫자가 부풀려져 홍보 효과를 못 읽는다. 날짜가 바뀌면 다시 한 번 센다.
export function trackVisit(): void {
  const today = new Date().toISOString().slice(0, 10);
  const key = 'pokegre_visit_marked';
  try {
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
  } catch {
    // 저장이 막힌 환경(시크릿 등)에서는 매번 세더라도 그냥 진행한다.
  }
  fetch('/api/local/track-visit', { method: 'POST' }).catch(() => undefined);
}

// 기능별 사용 횟수만 센다(누가 썼는지·개인정보는 안 남김). 허용된 이벤트만 서버가 받는다.
export type TrackedEvent = 'snkrdunk_search' | 'ebay_search' | 'scan' | 'centering';
export function trackEvent(event: TrackedEvent): void {
  fetch('/api/local/track-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => undefined);
}

export interface EventCounts {
  snkrdunk_search?: number;
  ebay_search?: number;
  scan?: number;
  centering?: number;
}

// 날짜별 기능 사용 칸. "legacy"는 날짜 구분이 없던 옛 누적치(전체 합계에만 포함).
export type EventDayBuckets = Record<string, EventCounts>;

// 기능별 사용 횟수(날짜별). 운영자만 부를 수 있다(아니면 서버가 404).
export async function fetchEventStats(): Promise<EventDayBuckets> {
  const res = await fetch('/api/local/track-event');
  if (!res.ok) throw new Error('기능 통계를 불러오지 못했습니다.');
  const data = (await res.json()) as { days?: EventDayBuckets };
  return data.days ?? {};
}

export interface SearchDayStat {
  date: string;
  count: number;
}

// 날짜별 검색 횟수 합계(검색어 목록 아님). 운영자만 부를 수 있다(아니면 서버가 404).
export async function fetchSearchStats(): Promise<SearchDayStat[]> {
  const res = await fetch('/api/local/search-stats');
  if (!res.ok) throw new Error('검색 통계를 불러오지 못했습니다.');
  const data = (await res.json()) as { items?: SearchDayStat[] };
  return data.items ?? [];
}

export interface VisitStat {
  date: string;
  count: number;
}

export interface VisitStatsResponse {
  items: VisitStat[];
  total: number;
  // 가입 회원 수(개수만). 회원번호 등 개인정보는 서버가 내려주지 않는다.
  memberCount: number;
}

// 카드 제목·시리즈명 한글화가 이상할 때 사용자가 알려주는 신고. 화면에 보인 제목,
// 한글화 전 원본(일본어) 제목, 원본 링크를 보낸다(개인정보 없음). 원본 제목은 운영자
// 화면에서 최신 사전으로 다시 변환해 "지금 이름"을 보여주는 데 쓴다. 실패해도 조용히
// 무시한다(부가 기능).
export function reportCardTitleMiss(title: string, raw: string, link: string): void {
  fetch('/api/local/translation-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, raw, link }),
  }).catch(() => undefined);
}

// 운영자만 부를 수 있다. 아니면 서버가 404를 준다.
export async function fetchVisitStats(): Promise<VisitStatsResponse> {
  const res = await fetch('/api/local/visit-stats');
  if (!res.ok) throw new Error('방문 통계를 불러오지 못했습니다.');
  return res.json();
}

export interface TitleFeedback {
  title: string;
  // 한글화 전 원본(일본어) 제목. 최신 사전으로 다시 변환해 "지금 이름"을 보여준다.
  // 이 필드가 추가되기 전의 옛 신고엔 없을 수 있다.
  raw?: string;
  link: string;
  at: number;
}

// 카드 이름 한글화 신고 목록. 운영자만 부를 수 있다(아니면 서버가 404).
export async function fetchTitleFeedback(): Promise<TitleFeedback[]> {
  const res = await fetch('/api/local/translation-feedback');
  if (!res.ok) throw new Error('신고 목록을 불러오지 못했습니다.');
  const data = (await res.json()) as { items?: TitleFeedback[] };
  return data.items ?? [];
}

// 처리 끝난 신고 하나를 지운다(운영자만).
export async function deleteTitleFeedback(at: number): Promise<void> {
  const res = await fetch('/api/local/translation-feedback', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ at }),
  });
  if (!res.ok) throw new Error('삭제하지 못했습니다.');
}

// 신고 목록을 전부 비운다(운영자만).
export async function clearTitleFeedback(): Promise<void> {
  const res = await fetch('/api/local/translation-feedback', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ all: true }),
  });
  if (!res.ok) throw new Error('비우지 못했습니다.');
}
