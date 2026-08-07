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

// 개발·테스트용 집계 제외 스위치. 주소 뒤에 ?notrack=1 을 붙여 한 번 들어오면 그
// 브라우저는 이후 방문·검색·기능 사용이 집계되지 않는다(?notrack=0 이면 다시 켜진다).
// 운영자 계정은 서버가 이미 걸러내지만, 로그인 없이 확인할 때는 그 방법이 안 통한다.
// 어차피 숫자에서 자기를 빼는 것뿐이라 남이 켜도 문제될 게 없다.
const NOTRACK_KEY = 'pokegre_notrack';

if (typeof window !== 'undefined') {
  const flag = new URLSearchParams(window.location.search).get('notrack');
  try {
    if (flag === '1') localStorage.setItem(NOTRACK_KEY, '1');
    else if (flag === '0') localStorage.removeItem(NOTRACK_KEY);
  } catch {
    // 저장이 막힌 환경(시크릿 등)에서는 그냥 집계된다.
  }
}

function trackingOff(): boolean {
  try {
    return localStorage.getItem(NOTRACK_KEY) === '1';
  } catch {
    return false;
  }
}

// 이 브라우저가 집계 제외(notrack) 상태인지. 방문·검색·기능 외에 글 조회수처럼
// 서버에서 올리는 숫자도 빼려면, 요청 때 이 값을 서버에 알려줘야 한다.
export function isTrackingOff(): boolean {
  return trackingOff();
}

export function trackSearch(query: string): void {
  if (trackingOff()) return;
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
  if (trackingOff()) return;
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
export type TrackedEvent =
  // 도감·세트별 목록·작가별 목록에서 카드 한 장을 눌렀을 때(2026-08-06).
  // card_found의 라벨은 값을 찾은 마켓, card_miss의 라벨은 그 카드(세트+번호)다.
  | 'card_found'
  | 'card_miss'
  // 카드 화면에서 감정 수량이 실제로 보인 횟수(2026-08-07 추가).
  | 'population'
  // 팝수 조회 화면(2026-08-07). search=카드를 찾은 횟수, detail=등급표를 실제로 본 횟수.
  | 'population_search'
  | 'population_detail'
  | 'share'
  | 'snkrdunk_search'
  | 'ebay_search'
  | 'scan'
  | 'centering'
  | 'artist'
  | 'tcgplayer'
  | 'packsim_checkin'
  | 'packsim_godpack'
  | 'packsim_value'
  | 'packsim_share'
  | 'sets'
  // 검색으로 /series/<슬러그>에 바로 들어온 경우. 세트와 같은 순위표에 "(시리즈)"를
  // 붙여 쌓는다(서버 track-event 참고).
  | 'series'
  | 'ebay_korean'
  // 운영자 전용 화면(카드 뽑기·스캔 테스트). 운영자 사용은 서버가 집계에서 빼므로
  // 지금은 늘 0이지만, 나중에 공개로 돌리면 그때부터 바로 잡힌다.
  | 'packsim'
  | 'scantest'
  // 인기 검색어에 한 표가 들어갈 때, 그 검색어를 무엇으로 확정했는지. 앞의 넷은 사람이
  // 분명히 "이걸 찾는다"고 밝힌 것이고, typed는 그냥 치다 멈춘 것이다(기준이 애매해
  // 나중에 뗄지 판단하려고 따로 센다 — App.tsx의 confirmSearch 참고).
  | 'search_scan'
  | 'search_pick'
  | 'search_popular'
  | 'search_enter'
  | 'search_typed'
  // 홈의 뽑기 결과 한 줄을 눌러 상점으로 들어온 횟수. 이게 낮으면 그 줄을 뺀다.
  | 'packsim_banner'
  // 작가 화면에서 포켓몬 이름으로 "이걸 그린 작가"를 찾아 결과가 나온 횟수.
  | 'artist_by_pokemon'
  // 홈의 "신팩 힛카드"(2026-08-05). card=카드를 눌러 시세로 감, set=전체 보기.
  // 이게 낮으면 그 줄이 자리만 먹는 것이라 뺀다.
  | 'home_hit_card'
  | 'home_hit_set'
  // 포켓몬별 카드(2026-08-06). 어느 포켓몬을 열었는지도 라벨로 센다.
  | 'pokedex';
// label은 '작가별 조회'에서 어떤 작가를 봤는지 같은 세부 항목을 남길 때만 쓴다.
export function trackEvent(event: TrackedEvent, label?: string): void {
  if (trackingOff()) return;
  fetch('/api/local/track-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(label ? { event, label } : { event }),
  }).catch(() => undefined);
}

export interface EventCounts {
  snkrdunk_search?: number;
  ebay_search?: number;
  scan?: number;
  centering?: number;
  artist?: number;
  tcgplayer?: number;
}

// 날짜별 기능 사용 칸. "legacy"는 날짜 구분이 없던 옛 누적치(전체 합계에만 포함).
export type EventDayBuckets = Record<string, EventCounts>;

// 작가별 조회 순위 한 줄(많이 본 순).
export interface ArtistStat {
  name: string;
  count: number;
}

// 기능별 사용 횟수(날짜별) + 작가별·세트별 조회 순위. 운영자만 부를 수 있다(아니면 서버가 404).
export async function fetchEventStats(): Promise<{
  days: EventDayBuckets;
  artists: ArtistStat[];
  sets: ArtistStat[];
}> {
  const res = await fetch('/api/local/track-event');
  if (!res.ok) throw new Error('기능 통계를 불러오지 못했습니다.');
  const data = (await res.json()) as { days?: EventDayBuckets; artists?: ArtistStat[]; sets?: ArtistStat[] };
  return { days: data.days ?? {}, artists: data.artists ?? [], sets: data.sets ?? [] };
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
  // 오늘 시세 조회 크레딧. 이게 0이 되면 방문자에게 이베이·TCGplayer 시세가 안 보인다.
  credits?: {
    left: number | null; // null = 아직 한 번도 안 불러서 모름
    daily: number;
    fillSpent: number; // 오늘 세트 시세 채우기에 쓴 것
    fillBudget: number;
    keepForVisitors: number; // 채우기가 넘지 않는 선
    resetAt: string; // 다시 차는 시각(한국시간 오전 9시)
    blocked: boolean; // 지금 한도에 걸려 쉬는 중인지
    // ⚠️ left는 우리 서버가 마지막으로 PPT를 부른 때의 값이라 낡을 수 있다. "하루치를
    //    다 썼다"는 실제로 429를 받아 본 이 값이 정확하다(2026-08-07).
    dailyOut?: boolean;
  };
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
