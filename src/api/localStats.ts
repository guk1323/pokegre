import { kstDateStr } from '../lib/kstDay';
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
//
// ⚠️ **날짜는 반드시 한국시간으로 끊는다.** 예전엔 여기만 UTC였다(2026-08-07 발견).
//    서버는 방문을 한국시간 칸에 담는데 화면은 UTC로 "오늘 이미 셌다"를 기억하니,
//    UTC 날짜가 넘어가는 **한국시간 오전 9시**까지 두 쪽의 "오늘"이 달랐다.
//    저녁에 왔던 사람이 **자정~오전 9시**에 다시 오면 서버에는 새 날인데 화면이
//    안 보내서, 그 시간대 재방문이 통째로 빠졌다.
export function trackVisit(): void {
  if (trackingOff()) return;
  const today = kstDateStr();
  const key = 'pokegre_visit_marked';
  try {
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
  } catch {
    // 저장이 막힌 환경(시크릿 등)에서는 매번 세더라도 그냥 진행한다.
  }
  fetch('/api/local/track-visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...어디서왔나(), 첫화면: 첫화면() }),
  }).catch(() => undefined);
}

/**
 * **어느 화면으로 들어왔는지** 한 낱말로. 주소는 안 보내고 갈래만 보낸다.
 *
 * ⚠️ 왜 필요한가: 카드 한 장 주소(/card/<번호>)를 2026-08-31에 붙였는데, 그게 실제로
 *    사람을 데려오는지 볼 자료가 없었다. 방문 수는 하루 총합 하나뿐이라 「카드 화면으로
 *    들어온 사람」을 가릴 수 없다. 애드센스 재신청 전에 이 시범이 먹혔는지 봐야 한다.
 * ⚠️ **주소를 통째로 보내지 않는다.** 카드 번호까지 담으면 누가 무슨 카드를 봤는지
 *    쌓이는 셈이라, 갈래 이름 하나로 줄여 보낸다.
 */
function 첫화면(): string {
  const p = location.pathname;
  if (p === '/' || p === '') return '홈';
  if (/^\/(card|[cet])\//.test(p)) return '카드 한 장';
  if (/^\/set\//.test(p)) return '세트';
  if (/^\/series\//.test(p)) return '시리즈';
  if (/^\/artist\//.test(p)) return '일러스트레이터';
  if (/^\/community/.test(p)) return '게시판';
  if (/^\/sets\/?$/.test(p)) return '세트 목록';
  if (/^\/artists\/?$/.test(p)) return '일러스트레이터 목록';
  if (/^\/pokedex/.test(p)) return '포켓몬별';
  if (/^\/packsim/.test(p)) return '카드 뽑기';
  if (/^\/centering/.test(p)) return '센터링';
  if (/^\/sealed/.test(p)) return '미개봉';
  return '그밖';
}

/**
 * 어디서 들어왔는지 **한 낱말로만** 알아낸다.
 *
 * ⚠️⚠️ **주소 전체를 보내지 않는다.** `document.referrer`에는 검색어가 통째로 붙어
 *    오는 일이 있어서(`google.com/search?q=…`) 그대로 보내면 **남의 검색어를 우리가
 *    저장하게 된다.** 호스트만 떼어 「구글·네이버·직접」 같은 낱말로 바꿔 보낸다.
 *
 * ⚠️ 2026-08-16에 붙였다. 방문자가 하루 만에 두 배(80→163)가 됐는데 **사람인지
 *    크롤러인지 가릴 자료가 하나도 없어서** 못 밝힌 일이 있었다. 서치 콘솔은 2~3일
 *    늦게 나와 그날 일을 그날 못 본다.
 */
function 어디서왔나(): { from: string; 곳?: string } {
  let host = '';
  let 주소: URL;
  try {
    const r = document.referrer;
    if (!r) return { from: '직접' };
    주소 = new URL(r);
    host = 주소.hostname.replace(/^www\./, '');
  } catch {
    return { from: '알수없음' };
  }
  if (host === location.hostname) return { from: '사이트안' };
  // ⚠️ **한 낱말로 잘게 나눈다.** 2026-08-16에 「SNS」 한 칸에 인스타·페북·X를 묶어
  //    놨더니 어디서 온 건지 알 수가 없었다(사장님 지적). 특히 **카카오톡이 「다음·카카오」에
  //    섞여** 검색으로 온 것과 링크로 온 것이 구분이 안 됐다 — 한국에서는 그게 제일 큰 통로다.
  // ⚠️ 위에서부터 차례로 보므로 **좁은 것을 먼저** 둔다(`cafe.naver`가 `naver`보다 앞).
  const 표: [RegExp, string][] = [
    // 검색
    [/(^|\.)google\./, '구글'],
    [/(^|\.)cafe\.naver\./, '네이버 카페'],
    [/(^|\.)blog\.naver\./, '네이버 블로그'],
    [/(^|\.)naver\./, '네이버'],
    [/(^|\.)daum\.|(^|\.)search\.daum\./, '다음'],
    [/(^|\.)bing\./, '빙'],
    [/(^|\.)duckduckgo\./, '덕덕고'],
    // 메신저 — 카카오톡은 링크를 눌러 들어오는 통로라 검색과 갈라야 한다
    [/(^|\.)kakao\./, '카카오톡'],
    [/(^|\.)line\.me$/, '라인'],
    [/(^|\.)t\.me$/, '텔레그램'],
    // SNS
    [/(^|\.)instagram\./, '인스타그램'],
    [/(^|\.)(x|twitter)\.com$/, 'X(트위터)'],
    [/(^|\.)(facebook|fb)\./, '페이스북'],
    [/(^|\.)threads\./, '스레드'],
    [/(^|\.)tiktok\./, '틱톡'],
    [/(^|\.)reddit\./, '레딧'],
    // 영상
    [/(^|\.)youtube\.|(^|\.)youtu\.be$/, '유튜브'],
    // 커뮤니티
    [/(^|\.)dcinside\./, '디시인사이드'],
    [/(^|\.)fmkorea\./, '에펨코리아'],
    [/(^|\.)ruliweb\./, '루리웹'],
    [/(^|\.)inven\./, '인벤'],
    [/(^|\.)theqoo\./, '더쿠'],
    [/(^|\.)clien\./, '클리앙'],
    [/(^|\.)arca\.live$/, '아카라이브'],
    [/(^|\.)bunjang\.|(^|\.)joongna\./, '중고거래'],
    // AI
    [/(^|\.)(chatgpt|openai)\./, '챗GPT'],
    [/(^|\.)perplexity\./, '퍼플렉시티'],
    [/(^|\.)claude\./, '클로드'],
    [/(^|\.)gemini\.google\./, '제미나이'],
  ];
  for (const [re, 이름] of 표) if (re.test(host)) {
    const 곳 = 곳뽑기(이름, 주소);
    return 곳 ? { from: 이름, 곳 } : { from: 이름 };
  }
  return { from: '그밖' };
}

// 아이디 꼴. 이것을 통과한 것만 보낸다 — 사람 이름·검색어·글 내용은 이 꼴이 될 수 없다.
const 아이디꼴 = /^[A-Za-z0-9_-]{2,30}$/;

// 여기 적힌 곳만 「어디인지」를 한 칸 더 본다. 나머지는 예전과 똑같이 낱말만 보낸다.
// ⚠️ 서버(server/api.ts의 `곳받는곳`)와 **한 글자도 틀리면 안 된다.**
const 곳볼곳 = new Set(['네이버 블로그', '네이버 카페', '디시인사이드', '아카라이브']);

/**
 * 「어느 블로그·어느 카페에서 왔나」를 **주소의 아는 칸 하나**에서만 뽑는다(2026-08-27 ·
 * 사장님 「네이버 블로그에서 들어오는 건 어디 블로그야」).
 *
 * ⚠️⚠️ **여기서 뽑는 것은 「우리에게 링크를 건 글이 있는 자리」다.** 방문한 사람이
 *    누구인지가 아니다 — 블로그 아이디는 이미 세상에 공개된 그 글의 주소다.
 * ⚠️⚠️ **주소를 통째로 보내면 안 된다.** 글 제목·검색어가 주소에 붙어 오는 일이 있고,
 *    그러면 남의 글자를 우리가 저장하게 된다. 그래서 ①아는 자리 한 칸만 뽑고
 *    ②`아이디꼴`을 통과한 것만 보낸다. 하나라도 어긋나면 그냥 안 보낸다.
 */
function 곳뽑기(낱말: string, u: URL): string | undefined {
  if (!곳볼곳.has(낱말)) return undefined;
  const 칸 = u.pathname.split('/').filter(Boolean);
  let 값 = '';
  if (낱말 === '네이버 블로그') {
    // 폰은 blog.naver.com/<아이디>/<글번호>, PC는 iframe이라 PostView.naver?blogId=<아이디>
    값 = u.searchParams.get('blogId') || 칸[0] || '';
    if (/\.(naver|nhn)$/i.test(값)) 값 = ''; // PostView.naver 같은 파일 이름은 아이디가 아니다
  } else if (낱말 === '네이버 카페') {
    // 옛 주소는 cafe.naver.com/<카페주소>/<글번호>,
    // 새 주소는 cafe.naver.com/f-e/cafes/<카페번호>/articles/<글번호>
    값 = 칸[0] === 'f-e' || 칸[0] === 'ca-fe' ? (칸[칸.indexOf('cafes') + 1] ?? '') : (칸[0] ?? '');
  } else if (낱말 === '디시인사이드') {
    // gall.dcinside.com/board/lists/?id=<갤러리> · m.dcinside.com/board/<갤러리>/…
    값 = u.searchParams.get('id') || (칸[0] === 'board' ? (칸[1] ?? '') : '');
  } else if (낱말 === '아카라이브') {
    값 = 칸[0] === 'b' ? (칸[1] ?? '') : '';
  }
  return 아이디꼴.test(값) ? 값 : undefined;
}

// 기능별 사용 횟수만 센다(누가 썼는지·개인정보는 안 남김). 허용된 이벤트만 서버가 받는다.
export type TrackedEvent =
  // 홈 배너 의견함(2026-08-21). 보내기 성공 한 번에 1.
  | 'feedback'
  // 오늘의 상점의 「내 GP 내역」을 펼친 횟수(2026-08-22).
  | 'packsim_log' 
  // 홈 「최신 발매 박스 시세」에서 박스를 눌러 그 팩 시세로 들어간 횟수(2026-09-03).
  // 라벨은 그 팩 이름이다 — 어느 팩이 눌리는지 봐야 목록을 손볼 수 있다.
  | 'home_box'
  // 홈 맨 위 공지의 단추를 눌러 공식 안내로 나간 횟수(2026-09-04). 라벨은 공지 제목이다.
  | 'home_notice'
  // 도감·세트별 목록·작가별 목록에서 카드 한 장을 눌렀을 때(2026-08-06).
  // card_found의 라벨은 값을 찾은 마켓, card_miss의 라벨은 그 카드(세트+번호)다.
  | 'card_found'
  | 'card_miss'
  // 카드 화면에서 감정 수량이 실제로 보인 횟수(2026-08-07 추가).
  | 'population'
  // 팝수 조회 화면(2026-08-07). search=카드를 찾은 횟수, detail=등급표를 실제로 본 횟수.
  | 'population_search'
  | 'population_detail'
  | 'population_miss'
  | 'share'
  | 'snkrdunk_search'
  | 'ebay_search'
  // 해외 시세 검색 횟수(2026-08-12). 옛 길(ebay_search)을 이어받은 줄이다 —
  // 2026-08-13에 옛 탭을 떼면서 이쪽이 유일한 해외 시세 검색이 됐다.
  | 'cardboard_search'
  // 해외 시세 안에서 **TCGplayer 눈으로 바꾼** 횟수(2026-08-13). 옛 'tcgplayer'를
  // 이어받은 줄이다.
  // ⚠️ 이게 없으면 새 길에서 **eBay를 보는지 TCGplayer를 보는지 아예 알 수 없다** —
  //    검색은 `cardboard_search` 하나로만 세어서, 마켓 칩이 통계에서 통째로 빠진다.
  | 'cardboard_tcg'
  // 포켓몬 대전쟁(2026-08-17 · 운영자 베타). 라벨은 스테이지 이름이다.
  // start=한 판 시작 · clear=적 성을 부숨 · lose=내 성이 부서짐.
  // ⚠️ 셋을 같이 봐야 **어느 스테이지에서 사람들이 그만두는지** 보인다 —
  //    start만 세면 「많이 했다」밖에 모르고, clear만 세면 못 깬 판이 안 보인다.
  | 'battle_start'
  | 'battle_clear'
  | 'battle_lose'
  /**
   * **왜 졌나**(2026-08-18). 라벨은 짧은 열쇠다(`벽없음`·`상성`·`지갑넘침`…).
   *
   * ⚠️ `battle_lose`와 따로 세는 까닭: 짐 라벨에 까닭을 덧붙이면
   *    판 12 × 난이도 3 × 까닭 6 = 216칸이 되어 **하루 칸(150)을 넘어 조용히 잘린다.**
   *    까닭만 따로 세면 여섯 칸이면 된다.
   * ⚠️ 사람이 읽는 글이 아니라 **열쇠**를 보낸다 — 글을 다듬을 때마다 줄이 갈리면
   *    지난 것과 못 견준다.
   */
  | 'battle_why'
  /**
   * **숫자키 1~8로 냈다**(2026-08-18). 라벨이 없다 — 「쓰는 사람이 있나」만 알면 된다.
   *
   * ⚠️ **한 판에 한 번만** 보낸다. 누를 때마다 보내면 한 판에 수십 번이라
   *    시작(`battle_start`)과 견줄 수 없는 숫자가 된다 — 지금은 「몇 판에서 썼나」다.
   * ⚠️ 라벨을 붙이면 서버가 판별 표(`<판> · <난이도>`)에 섞어 쌓으므로 붙이지 않는다.
   */
  | 'battle_key'
  /**
   * **첫 판 안내**(2026-08-18). 라벨이 없다 — 「몇 사람에게 떴나」만 알면 된다.
   *
   * - `battle_guide` … 안내가 처음 뜬 브라우저(=이 게임이 처음인 사람)
   * - `battle_guide_done` … 그 안내를 따라 **첫 포켓몬을 낸** 브라우저
   *
   * ⚠️ **둘을 같이 봐야 뜻이 있다.** 뜬 수만 세면 「처음 온 사람이 몇인가」밖에 모르고,
   *    끝낸 수만 세면 잘 되고 있는지 견줄 것이 없다. 둘의 비율이 곧 안내의 성적이다.
   * ⚠️ 브라우저에 한 번씩만 보낸다(`pokegre_battle_guide`) — 새로고침마다 보내면
   *    같은 사람이 여러 번 세어져 비율이 뜻을 잃는다.
   */
  | 'battle_guide'
  | 'battle_guide_done'
  /**
   * - `battle_card_detail` … 카드를 **길게 눌러** 능력치를 펴 본 횟수(라벨=포켓몬 이름)
   * ⚠️ 안 열어 보면 그 기능은 짐이다. 세어 둬야 뗄지 말지를 숫자로 정한다.
   */
  | 'battle_card_detail'
  /**
   * - `battle_quit` … 판을 **시작해 놓고 끝을 안 보고 나간** 것(라벨=`<판> · <난이도>`)
   * ⚠️ 이게 없으면 「시작 100 · 깸 40 · 짐 20」에서 남은 40이 어디 갔는지 알 수 없다.
   *    「다시」는 안 센다 — 그건 나간 게 아니라 더 하려는 것이다.
   */
  | 'battle_quit'
  | 'scan'
  | 'centering'
  | 'artist'
  | 'tcgplayer'
  | 'sealed'
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
  | 'pokedex'
  // 센터링 화면을 연 횟수(사진을 올린 횟수는 'centering').
  | 'centering_open';
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
  /** 날짜별 작가·세트 순위(2026-08-16부터 쌓인다). 달력에서 하루를 고르면 쓴다. */
  dayRanks?: Record<string, { artists: ArtistStat[]; sets: ArtistStat[]; battles?: ArtistStat[] }>;
  days: EventDayBuckets;
  artists: ArtistStat[];
  sets: ArtistStat[];
  /** 빈손 카드(누적 · 2026-09-01부터). 열었는데 시세도 팝수도 없던 카드다. */
  misses?: ArtistStat[];
  /** 대전쟁 스테이지별 시작/깸/짐. 「어느 판에서 막히나」를 보는 표다. */
  battles?: ArtistStat[];
}> {
  const res = await fetch('/api/local/track-event');
  if (!res.ok) throw new Error('기능 통계를 불러오지 못했습니다.');
  const data = (await res.json()) as {
    days?: EventDayBuckets; artists?: ArtistStat[]; sets?: ArtistStat[]; misses?: ArtistStat[]; battles?: ArtistStat[];
    dayRanks?: Record<string, { artists: ArtistStat[]; sets: ArtistStat[]; battles?: ArtistStat[] }>;
  };
  return { days: data.days ?? {}, artists: data.artists ?? [], sets: data.sets ?? [], misses: data.misses ?? [], battles: data.battles ?? [], dayRanks: data.dayRanks };
}

export interface VisitStat {
  date: string;
  count: number;
}

/**
 * 회원 한 명의 이용 현황(운영자만). 닉네임은 오지만 **회원번호(kakao:1234…)는
 * 서버가 아예 안 내려준다** — 로그인 식별자라서, 「누가 쓰나」를 보는 데는 필요 없다.
 * 닉네임은 본인이 우리 사이트에서 정한 이름이고, 아직 안 정했으면 빈 문자열이다.
 */
export interface MemberStat {
  닉네임: string;
  가입일: string;
  가입한지: number | null;
  로그인수: number;
  마지막출석: string;
  안온지: number | null;
  연속: number;
  GP: number;
  깐팩: number;
  쓴GP: number;
  앨범: number;
}

export interface VisitStatsResponse {
  items: VisitStat[];
  total: number;
  members?: MemberStat[];
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
  /**
   * 어디서 들어왔나 — 최근 14일, 날짜별로 낱말과 횟수뿐이다(2026-08-16).
   * ⚠️ 주소도 IP도 안 담는다. 화면이 호스트를 「구글·네이버·직접」 같은 낱말로 바꿔
   *    보내고 서버는 아는 낱말만 받는다.
   */
  from?: { date: string; counts: Record<string, number> }[];
  /**
   * 어느 블로그·카페·갤러리에서 왔나 — 날짜 → 낱말 → 아이디 → 횟수(2026-08-27).
   * ⚠️ 담기는 것은 **우리에게 링크를 건 글이 있는 자리**다(블로그 아이디·카페 주소·
   *    갤러리 이름). 방문한 사람을 가리키는 값이 아니고, 주소도 여전히 안 담는다.
   * ⚠️ 2026-08-27부터 쌓인다. 그 전 것은 「네이버 블로그 5번」처럼 낱말까지만 남아 있다.
   */
  places?: { date: string; counts: Record<string, Record<string, number>> }[];
  // 어느 화면으로 들어왔나(2026-08-31). 카드 한 장 주소가 먹히는지 보는 자리다.
  landings?: { date: string; counts: Record<string, number> }[];
  /**
   * 「그밖 로봇」으로 뭉뚱그려진 것이 **실제로 무슨 프로그램인지**. 날짜 → 이름 → 횟수.
   * ⚠️ 칸(구글봇·네이버봇처럼)을 미리 안 만들어도 화면에서 바로 확인하려고 둔다.
   *    개인을 알아볼 수 있는 값은 없다 — 프로그램이 스스로 밝힌 이름뿐이다.
   * ⚠️ 2026-08-16 저녁부터 쌓인다. 그 전 것은 이름이 안 남아 있다.
   */
  botAgents?: Record<string, Record<string, number>>;
}

// 카드 제목·시리즈명 한글화가 이상할 때 사용자가 알려주는 신고. 화면에 보인 제목,
// 한글화 전 원본(일본어) 제목, 원본 링크를 보낸다(개인정보 없음). 원본 제목은 운영자
// 화면에서 최신 사전으로 다시 변환해 "지금 이름"을 보여주는 데 쓴다. 실패해도 조용히
// 무시한다(부가 기능).
// ⚠️ `note`는 사용자가 적은 메모다. **비어 있을 수 있다** — 확인 단계를 두는 것이
//    본래 목적이고 메모는 덤이라, 안 쓰고 보내는 길을 막지 않는다.
export function reportCardTitleMiss(title: string, raw: string, link: string, note = ''): void {
  fetch('/api/local/translation-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, raw, link, note }),
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
  // 사용자가 남긴 메모(2026-08-18). 안 쓰고 보낼 수 있어서 **비었거나 아예 없을 수 있다** —
  // 이 칸이 생기기 전의 옛 신고에는 없다(원본 이름 `raw`와 같은 사정이다).
  note?: string;
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
