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

// 카드 제목·시리즈명 한글화가 이상할 때 사용자가 알려주는 신고. 화면에 보인 제목과
// 원본(스니커덩크) 링크만 보낸다(개인정보 없음). 실패해도 조용히 무시한다(부가 기능).
export function reportCardTitleMiss(title: string, link: string): void {
  fetch('/api/local/translation-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, link }),
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
