import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CardImg } from './components/CardImg';
import { AdSlot, AdRails } from './components/AdSlot';
import { ThemeToggle } from './components/ThemeToggle';
// 세트 이름 한글 목록(자동완성에서 고르면 그 세트로 간다). scripts/gen-set-name-suggestions.mts
import setNamesKo from './data/setNamesKo.json';
import { ErrorBoundary } from './components/ErrorBoundary';
import { fetchMoreUniqueCards, type SnkrdunkCard } from './api/snkrdunk';
import { fetchPopularSearches, trackEvent, trackSearch, trackVisit, type PopularSearch } from './api/localStats';
import { fetchPokemonNews, type KoreanNewsItem } from './api/koreanNews';
import { fetchRemoteSuggestions } from './api/suggestions';
// ⚠️ `ebayPrices.ts`에는 이제 **꼴과 도우미만** 남아 있다(EbayCard·대표등급·등급 이름…).
//    저쪽에 매물을 물어보던 함수들은 2026-08-13에 옛 길과 함께 지웠다.
import type { CardEdition, EbayCard } from './api/ebayPrices';
import { searchCardBoard, fetchBoardDetail, type BoardCard } from './api/cardBoard';
import {
  도감검색어,
  도감검색어들,
  도감표시,
  마켓순서,
  값없음문구,
  값없음이유,
  같은카드인가,
  짧은세트,
  type 도감카드정보,
} from './lib/pokedexRoute';
import { 시트가스스로닫힘 } from './lib/sheetHistory';
// 사전을 하나도 안 가져오는 파일이라 첫 화면 무게가 늘지 않는다(lib/cardImg.ts 머리말).
import { cardImg, thumb, usable, 공유이름 } from './lib/cardImg';
import { loadNameDict, warmNameDict } from './lib/nameDict';

import {
  addRecentlyViewed,
  getFavoriteRefs,
  getRecentRefs,
  isFavorite as checkIsFavorite,
  toggleFavorite,
  writeFavoriteRefs,
  writeRecentRefs,
  removeStoredRefs,
} from './lib/localCollections';
import { resolveStoredCards, type StoredCardRef } from './api/snkrdunk';
import { SearchBar } from './components/SearchBar';
import { SearchSuggestions } from './components/SearchSuggestions';
import { CardTile } from './components/CardTile';
import { CompareView } from './components/CompareView';
import { EbayCompareView } from './components/EbayCompareView';

import { CardDetail } from './components/CardDetail';
import { CardRow } from './components/CardRow';
import { PopularSearches } from './components/PopularSearches';
import { HomeNotice } from './components/HomeNotice';
import { PokemonNews } from './components/PokemonNews';
// ⚠️ PackShelfPromo(오늘의 상점 홍보칸)는 홈에서 뺐다(2026-08-12). 되돌리려면 이 줄과
//    아래 홈 곁다리 구역의 주석을 같이 살리면 된다.
// import { PackShelfPromo } from './components/PackShelfPromo';
import { BoxPrices } from './components/BoxPrices';
import { EbayCardTile } from './components/EbayCardTile';
import { EbayCardDetail } from './components/EbayCardDetail';
import { EbayCheckView } from './components/EbayCheckView';
import { TcgPlayerCardDetail } from './components/TcgPlayerCardDetail';
import { CardScanButton } from './components/CardScanButton';
import { reportScanMiss, scanCard, type CardScanResult } from './api/cardScan';
import { findCardByIllustrator } from './lib/findCardByIllustrator';
const Community = lazy(() => import('./Community').then((m) => ({ default: m.Community })));
import { Footer } from './components/legal/Footer';
import { PullBanner } from './components/PackShelfPromo';
// ⚠️ 홈 배너는 2026-08-27에 내렸다(아래 「홈 배너를 내렸다」 주석). 되살릴 때 같이 푼다.
// import { FeedbackBanner } from './components/FeedbackBanner';
import { NicknameSetup } from './components/NicknameSetup';
import { LoginModal } from './components/LoginModal';
const MyPage = lazy(() => import('./components/MyPage').then((m) => ({ default: m.MyPage })));
const ReportInbox = lazy(() => import('./components/ReportInbox').then((m) => ({ default: m.ReportInbox })));
const VisitStats = lazy(() => import('./components/VisitStats').then((m) => ({ default: m.VisitStats })));
const ScanTest = lazy(() => import('./components/ScanTest').then((m) => ({ default: m.ScanTest })));
const FleaAdmin = lazy(() => import('./components/FleaAdmin').then((m) => ({ default: m.FleaAdmin })));
// ⚠️ 게임은 도트 그림·규칙 자료가 딸려 와 무겁다. **지연 import로 두어** 첫 화면에 안 실리게 한다.
const PokeDefense = lazy(() => import('./components/PokeDefense').then((m) => ({ default: m.PokeDefense })));
const PackSim = lazy(() => import('./components/PackSim').then((m) => ({ default: m.PackSim })));
const SetsView = lazy(() => import('./components/SetsView').then((m) => ({ default: m.SetsView })));
const TitleFeedbackList = lazy(() => import('./components/TitleFeedbackList').then((m) => ({ default: m.TitleFeedbackList })));
const CenteringTool = lazy(() => import('./components/CenteringTool').then((m) => ({ default: m.CenteringTool })));
const PopulationView = lazy(() => import('./components/PopulationView').then((m) => ({ default: m.PopulationView })));
const SealedPricesView = lazy(() => import('./components/SealedPricesView').then((m) => ({ default: m.SealedPricesView })));
const ArtistsView = lazy(() => import('./components/ArtistsView').then((m) => ({ default: m.ArtistsView })));
const PokedexView = lazy(() => import('./components/PokedexView').then((m) => ({ default: m.PokedexView })));
import { DetailSheet } from './components/DetailSheet';
import { fetchMe, logout, mergeCollections, saveCollections, type LoginProvider } from './api/auth';

const INITIAL_TARGET = 16;
const LOAD_MORE_TARGET = 12;

// 큰 화면(lg)은 오른쪽 2단에 상세를 미리 띄워 빈 칸을 채우려고 검색 직후 첫 카드를
// 자동 선택한다. 하지만 폰에서는 그 선택이 곧바로 시트를 띄워, 검색만 했는데 상세가
// 확 올라오는 방해가 된다. 그래서 자동 선택은 큰 화면에서만 한다.
// (Tailwind의 lg 분기점과 같은 1024px)
function isWideScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
}

type MainView = 'cards' | 'mypage' | 'community' | 'centering' | 'artists' | 'pokedex' | 'reports' | 'stats' | 'sets' | 'scantest' | 'packsim' | 'flea' | 'population' | 'sealed' | 'pokedefense' | 'ebaycheck';

// 화면 → 주소. 카테고리를 누르면 주소창도 같이 바뀌게 한다(운영자 지적 2026-08-05 —
// 카테고리를 옮겨 다녀도 주소가 pokegre.com 그대로라 링크를 복사해 줄 수가 없었다).
//
// ⚠️ 여기 적을 수 있는 건 **서버가 아는 주소뿐이다**(server/index.ts에 같은 이름의
//    라우트가 있어야 한다). 없는 주소를 적으면 그 주소를 복사해 다시 들어갔을 때
//    홈이 떠서 주소가 거짓말이 된다. 마이페이지·운영자 화면이 여기 없는 이유다.
const VIEW_PATH: Partial<Record<MainView, string>> = {
  cards: '/',
  sets: '/sets',
  artists: '/artists',
  pokedex: '/pokedex',
  centering: '/centering',
  population: '/population',
  sealed: '/sealed',
  packsim: '/packsim',
  community: '/community',
  // ⚠️ **두 층으로 둔다**(사장님 2026-08-18). 「미니게임」은 게임 하나의 이름이 아니라
  //    게임들이 들어가는 자리다. 둘째 게임이 생기면 `/minigame`을 목록으로 바꾸기만 하면
  //    되고, 메뉴 이름도 방문자 동선도 그대로 간다.
  pokedefense: '/minigame/defense',
};

// 화면 → 브라우저 탭 제목.
//
// ⚠️ **서버(server/index.ts)가 그 주소에 붙이는 제목과 글자까지 같아야 한다.** 다르면
//    같은 화면인데 새로고침 전후로 탭 이름이 바뀐다.
// ⚠️ 이게 없어서 탭 제목이 통째로 남아 있었다(운영자 지적 2026-08-05). 커뮤니티를
//    보다 홈으로 와도 탭에는 "커뮤니티 | pokegre"였고, 카드를 보다 검색을 지워도
//    탭에는 그 카드 이름이 남았다. 없애려면 새로고침밖에 없었다 — 서버가 보낸
//    제목을 앱이 한 번도 고치지 않았기 때문이다.
// ⚠️ 주소(VIEW_PATH)와 달리 **제목은 모든 화면에 적는다**. 주소는 서버가 아는 것만
//    적을 수 있지만, 제목은 서버와 무관하게 앱이 정하면 된다. 마이페이지·운영자
//    화면을 빼놨더니 거기 들어가도 탭에는 직전 화면 이름이 그대로 남았다
//    (2026-08-05 배포 전 점검에서 발견 — 고친 버그가 이 다섯 화면에만 남아 있었다).
const HOME_TITLE = '포켓몬 카드 시세 | pokegre — 포켓몬 카드의 모든 것';
const VIEW_TITLE: Partial<Record<MainView, string>> = {
  cards: HOME_TITLE,
  sets: '포켓몬 카드 세트 목록 | pokegre',
  artists: '포켓몬 카드 일러스트레이터 | pokegre',
  pokedex: '포켓몬·트레이너별 카드 목록 | pokegre',
  centering: '포켓몬 카드 센터링 측정 | pokegre',
  population: '포켓몬 카드 감정 수량(팝수) 조회 | pokegre',
  sealed: '포켓몬 카드 박스·팩 시세 | pokegre',
  packsim: '오늘의 상점 — 포켓몬 카드 팩 열어 보기 | pokegre',
  community: '게시판 | pokegre',
  mypage: '마이페이지 | pokegre',
  reports: '신고함 | pokegre',
  stats: '방문 통계 | pokegre',
  scantest: '스캔 테스트 | pokegre',
  pokedefense: '포켓몬 디펜스 · 관동지방 | pokegre',
  flea: '플리마켓 | pokegre',
};

// 카드 이름을 탭 제목에 쓸 만큼만 다듬는다. 서버(server/index.ts의 shareName)와 같은
// 규칙이어야 새로고침 전후로 탭 이름이 안 바뀐다 — 뒤의 (팩 이름)과 [세트 번호]를 떼고
// 40자에서 자른다.
// 카드 이름을 탭 제목에 쓸 만큼만 다듬는다. **서버·공유 버튼과 같은 함수**를 쓴다
// (lib/cardImg.ts의 공유이름) — 세 벌로 두면 같은 카드를 셋이 다르게 부른다.

// 주소 → 화면. 위 표의 반대다.
// ⚠️ 반드시 **첫 렌더 전에** 정해야 한다. 예전엔 useEffect에서 정했는데, 그 한 박자
//    사이에 "지금 화면(cards)에 맞는 주소"로 /를 덮어써서 /set/ja-M6로 들어온 사람의
//    주소가 통째로 날아갔다(2026-08-05).
function viewFromPath(p: string): MainView | null {
  // ⚠️ 카드 한 장 주소(/card/<번호>)와 옛 공유 링크(/c/·/e/·/t/)는 **카드 화면**이다.
  //    여기 없으면 화면을 방문기록(savedNav)에서 가져오는데, 그 사람이 전에 보던 게
  //    게시판이면 카드 주소로 들어와도 게시판이 뜬다. 위 주석대로 주소가 먼저다.
  if (/^\/(card|[cet])\//.test(p)) return 'cards';
  if (/^\/(artist|artists)\//.test(p) || /^\/artists\/?$/.test(p)) return 'artists';
  if (/^\/(set|series)\//.test(p) || /^\/sets\/?$/.test(p)) return 'sets';
  if (/^\/pokedex\/?$/.test(p)) return 'pokedex';
  if (/^\/centering\/?$/.test(p)) return 'centering';
  if (/^\/population\/?$/.test(p)) return 'population';
  if (/^\/sealed\/?$/.test(p)) return 'sealed';
  if (/^\/packsim\/?$/.test(p)) return 'packsim';
  // 글 하나짜리 주소(/community/12)도 게시판으로 보낸다 — 검색·링크로 들어오는 길이다.
  if (/^\/community(\/\d+)?\/?$/.test(p)) return 'community';
  // ⚠️ 게임이 하나뿐인 동안은 `/minigame`도 그대로 디펜스를 연다.
  //    둘째 게임이 생기면 **이 한 줄만** 목록 화면으로 바꾼다.
  if (/^\/minigame(\/defense)?\/?$/.test(p)) return 'pokedefense';
  return null;
}
// ⚠️ `cardboard`는 2026-08-12에 붙인 **새 길**이다. 옛 ebay·tcgplayer는 그대로 산다 —
//    사장님 지시로 나란히 놓고 견주는 중이다(src/api/cardBoard.ts 설명 참고).
// ⚠️ 새 길도 **마켓마다 하나씩** 둔다(`cardboard`=eBay 낙찰 · `cardboard_tcg`=TCGplayer 시세).
//    검색창 왼쪽 칩이 마켓을 고르는 자리인데 그 칩은 `source`를 보고 그리므로, 마켓이
//    하나뿐이면 고를 수가 없다. 옛 두 마켓(ebay·tcgplayer)과 같은 꼴이다.
//    ⚠️ 둘은 **같은 응답을 나눠 본다** — 새 길은 한 번에 두 값을 다 들고 오므로 칩을
//       바꿔도 다시 안 부른다(아래 `board켬`이 검색 조건에서 마켓을 뺀 까닭).
type PriceSource = 'snkrdunk' | 'cardboard' | 'cardboard_tcg';

/**
 * 옛 「해외 시세」 탭이 쓰던 소스를 **새 길의 같은 마켓으로** 옮긴다.
 *
 * ⚠️⚠️ 탭을 없애도 `ebay`·`tcgplayer`는 **사람들 브라우저에 남아 있다** —
 *    ① 방문기록(`savedNav`, localStorage) ② 뒤로가기에 쌓인 화면 상태(history.state).
 *    그대로 되살리면 **이제 없는 탭**을 보게 되어, 탭 표시는 「해외 시세」인데 화면은
 *    옛 길이 그리는 어긋난 상태가 된다. 되살리는 자리마다 이걸 거쳐야 한다.
 */
const 새길로 = (s: string | null | undefined): PriceSource =>
  s === 'ebay' || s === 'cardboard' ? 'cardboard'
  : s === 'tcgplayer' || s === 'cardboard_tcg' ? 'cardboard_tcg'
  : 'snkrdunk';
// 사람이 검색어를 "확정한" 방법. 인기 검색어 집계가 타이핑 조각을 거르면서도
// 확실한 검색은 안 놓치게 하는 데 쓴다(2026-08-04).
//   scan=사진으로 찾기 · pick=자동완성에서 고름 · popular=인기 검색어를 누름 · enter=엔터
type SearchVia = 'scan' | 'pick' | 'popular' | 'enter';

// 이 글자 수 아래로는 검색을 보내지 않고 화면도 홈 그대로 둔다.
// 한 글자로는 어차피 쓸 만한 결과가 안 나오는데, 예전엔 "리" 한 글자에도 진짜 검색이
// 나가고 목록 페이지를 여러 장 넘겼다. 게다가 그 순간 홈이 통째로 사라지고
// "검색 결과가 없습니다"만 남아, 치는 도중에 화면이 한 번 무너졌다(실측 2026-08-04).
const MIN_SEARCH_LEN = 2;

// 큰 화면(lg~)에서는 상세를 오른쪽 2단으로, 좁은 화면에서는 아래에서 올라오는
// 시트로 보여준다. 폰에서 상세를 목록 맨 아래에 붙이면 눌러도 화면이 안 바뀌어
// 반응이 없는 것처럼 느껴진다.
//
// 상세가 없을 땐 오른쪽 320px 칸이 흰 여백만 남으므로, 있을 때만 2단으로 감싼다.
function DetailLayout({
  main,
  detail,
  onCloseDetail,
  아래막힘 = 0,
}: {
  main: React.ReactNode;
  detail: React.ReactNode | null;
  onCloseDetail?: () => void;
  /** 화면 아래에 깔린 고정 띠(비교 담기 바)의 높이(px). 시트가 그만큼 비켜 준다. */
  아래막힘?: number;
}) {
  return (
    <>
      {/* ⚠️⚠️ 상세가 있든 없든 **목록(main)은 같은 자리에 둔다.** 예전엔 상세가 생기면
          2단 틀로, 없어지면 1단 틀로 **갈아 끼웠다** — 리액트는 부모가 바뀌면 목록을
          통째로 새로 만들어서, 폰에서 시트를 닫을 때마다 카드 이미지가 전부 다시
          그려져 **잠깐 사라졌다 나타났다**(사장님 지적 2026-08-21 · 실측: 닫은 뒤
          첫 타일 img 요소가 새 것으로 바뀜). 틀은 하나로 두고 칸 수만 바꾼다. */}
      <div className={`grid grid-cols-1 gap-6 ${detail ? 'lg:grid-cols-[1fr_320px]' : ''}`}>
        <div className="min-w-0">{main}</div>
        {/* 오른쪽 2단은 큰 화면에서만. 좁은 화면에서는 아래 시트가 대신한다. */}
        {detail && <div className="hidden lg:block">{detail}</div>}
      </div>

      <DetailSheet open={detail != null} onClose={() => onCloseDetail?.()} 아래막힘={아래막힘}>
        {detail}
      </DetailSheet>
    </>
  );
}

// 새로고침해도 보던 화면에 남아 있게 한다. 화면 이동마다 history.state.nav에 적어 두므로
// (navigate·아래 replaceState) 새로 뜰 때 그걸 그대로 되읽으면 된다.
// 예전엔 안 읽어서, 뽑기나 커뮤니티를 보다가 새로고침하면 무조건 홈으로 튕겼다.
function savedNav(): {
  view?: MainView
  query?: string
  source?: PriceSource
  edition?: CardEdition
  scanQueries?: { snkrdunk: string; ebay: string } | null
} {
  try {
    const nav = (window.history.state as { nav?: Record<string, unknown> } | null)?.nav ?? {};
    // ⚠️ **없앤 판이 남아 있을 수 있다.** 한글판을 보다가 뒤로 가거나 새로고침하면
    //    `edition: 'korean'`이 그대로 살아 돌아온다(2026-08-10에 한글판을 뺐다).
    //    그대로 두면 판 토글이 아무것도 안 눌린 것처럼 보이고, 저쪽에 없는 판 이름이
    //    넘어간다. 모르는 값은 일본판으로 되돌린다.
    if (nav.edition !== 'japanese' && nav.edition !== 'english') delete nav.edition;
    return nav;
  } catch {
    return {};
  }
}

function App() {
  // 주소가 먼저다. 검색·공유로 들어온 사람은 그 주소가 보고 싶은 화면이고,
  // 방문기록(savedNav)은 그 사람이 전에 보던 화면이라 새로 들어온 뜻을 덮으면 안 된다.
  const [view, setView] = useState<MainView>(
    () => viewFromPath(window.location.pathname) ?? savedNav().view ?? 'cards',
  );
  // 상단 드롭다운(도감·도구·운영) 중 열린 것. 뒤 백드롭 클릭으로 닫는다(z-index로만 처리).
  const [openMenu, setOpenMenu] = useState<'find' | 'tools' | 'admin' | null>(null);
  const [source, setSource] = useState<PriceSource>(() => 새길로(savedNav().source));
  const [query, setQuery] = useState(() => savedNav().query ?? '');
  // 방금 스캔한 결과. "이 카드가 아닙니다" 신고에 쓰고, 사용자가 직접 타이핑하면 지운다.
  const [scannedResult, setScannedResult] = useState<CardScanResult | null>(null);
  // ⚠️ 사진으로 찾기가 실패했나. **글은 부품이 아니라 여기서 그린다** — 부품 안에서 그리면
  //    그 글자 폭만큼 검색 줄의 칸이 넓어져 검색바를 잡아먹었다(`CardScanButton`의 `onError`).
  const [scanFailed, setScanFailed] = useState(false);
  const [scanReported, setScanReported] = useState(false);
  // 스캔이 "세트+번호"로 검색했는데 0건이면 카드 이름으로 자동 재검색하기 위한 백업 이름.
  // 번호를 써서 검색한 경우에만 채운다(번호를 못 읽었으면 이미 이름으로 검색 중).
  const scanFallbackRef = useRef<string | null>(null);
  // 도감(포켓몬·트레이너별 카드)에서 눌러 온 카드.
  //
  // ⚠️ 검색어에 세트 이름을 붙이면 **0건**이다(PPT의 search는 이름과 세트를 함께
  //    묶어 찾지 않는다 — 실측 2026-08-06). 대신 setName 파라미터를 따로 보내면
  //    그 세트만 정확히 걸러진다("Charizard"만 → 10건 전부 다른 세트 / setName을
  //    같이 보내면 → 옵시디언 플레임즈 4장). 그래서 이 길로 좁힌다.
  //
  // 마켓을 옮겨도 이 정보를 들고 다닌다. 검색어를 이름으로 바꿔치기하면 카드가 누구인지
  // 잊어버려서, 다음 마켓에서 "확장팩 제1탄 001"이 아니라 그냥 "이상해씨"를 찾게 된다
  // (운영자 지적 2026-08-06). 어느 마켓에서 값을 찾을지는 lib/pokedexRoute.ts 참고.
  const pokedexPickRef = useRef<도감카드정보 | null>(null);
  // 지금 몇 번째 마켓까지 두드려 봤나. 값이 없으면 다음 마켓으로 넘어간다.
  const 마켓칸ref = useRef(0);
  // 자동으로 마켓을 옮겨도 되는 때인지. 도감에서 막 눌러 왔을 때만 켠다 — 사람이
  // 직접 탭을 눌렀는데 또 저절로 옮겨가면 어디를 보고 있는지 알 수 없게 된다.
  const 자동이동ref = useRef(false);
  // 지금 검색어가 그 카드를 가리키고 있나. 마켓마다 검색어 꼴이 달라서(스니커덩크는
  // "SV6 050", PPT는 "Chien-Pao ex") 어느 꼴이든 맞으면 유효로 본다. 사람이 검색어를
  // 손으로 바꾸면 저절로 풀린다.
  const 도감카드 = (q: string) => {
    const p = pokedexPickRef.current;
    return p && 도감검색어들(p).includes(q.trim()) ? p : null;
  };
  // 지금 마켓에서 못 찾았을 때 다음 마켓으로 넘긴다. 더 갈 곳이 없으면 안내만 띄우고
  // 검색어는 그대로 둔다 — 사람이 직접 다른 탭을 눌러 볼 수 있어야 한다.
  // 옮기는 **까닭**을 같이 받는다. "거래 기록이 없어"와 "같은 번호에 다른 카드가
  // 잡혀"는 사용자에게 전혀 다른 이야기다 — 뭉뚱그리면 사실과 다른 말을 하게 된다.
  const 다음마켓으로 = (c: 도감카드정보, 다른카드였음 = false) => {
    if (!자동이동ref.current) return false;
    const 순서 = 마켓순서(c.jp);
    const 다음 = 마켓칸ref.current + 1;
    if (다음 >= 순서.length) {
      // 어느 마켓에도 없던 카드를 남겨 둔다. 자주 오르는 카드는 손볼 곳이 있다는 뜻이다.
      trackEvent('card_miss', `${c.setNameKo} ${c.num}`);
      set도감안내(
        `${c.ko} · ${짧은세트(c.setNameKo)} ${c.num}번은 지금 어느 마켓에도 값이 없습니다. ` +
          `검색어는 그대로 두었으니 위 탭을 눌러 직접 확인해 보실 수 있습니다.`,
      );
      return false;
    }
    마켓칸ref.current = 다음;
    const 앞 = 순서[마켓칸ref.current - 1];
    const m = 순서[다음];
    // ⚠️ 옮긴 것을 말해 주지 않으면, 일본판 카드를 눌렀는데 스니커덩크가 아니라 이베이
    //    화면이 떠 있는 꼴이 된다. 사용자는 왜 다른 마켓을 보고 있는지 알 수 없고,
    //    그 마켓이 마침 조회에 실패하면 "카드가 없다"고 오해한다(2026-08-07 점검 중 발견).
    set도감안내(
      다른카드였음
        ? `${앞.label}에서는 같은 번호에 다른 카드가 잡혀 값을 쓰지 않고, ${m.label}에서 찾고 있습니다.`
        : `${앞.label}에는 거래 기록이 없어 ${m.label}에서 찾고 있습니다.`,
    );
    setSource(m.source);
    setEdition(m.edition);
    setQuery(도감검색어(c, m));
    return true;
  };

  // 세트 목록(코드→슬러그·이름). 공유 링크로 들어온 카드의 세트를 알아내는 데 쓴다.
  // 다른 화면도 쓰는 것이라 한 번 받아 두면 캐시된다.
  const 세트목록ref = useRef<{ slug: string; ed: 'ja' | 'en'; id: string; name: string }[] | null>(null);
  useEffect(() => {
    let 살아있음 = true;
    void import('./lib/cardCatalog')
      .then((m) => m.loadSetIndex())
      .then((list) => {
        if (!살아있음) return;
        세트목록ref.current = list;
        // ⚠️ 목록이 늦게 오면 그 사이 들어온 공유 링크를 놓친다. 도감에서 같은 실수를
        //    한 적이 있다(뒤로가기로 목록이 사라졌다 — 2026-08-06). 적어 뒀다가 처리한다.
        const 기다린것 = 공유대기ref.current;
        공유대기ref.current = null;
        if (기다린것) 공유카드기억(기다린것.title, 기다린것.rawTitle);
      })
      // 못 받아도 화면은 그대로 돈다 — 공유 링크 검색창이 예전처럼 보일 뿐이다.
      .catch(() => undefined);
    return () => {
      살아있음 = false;
    };
  }, []);

  // 공유 링크로 들어온 스니커덩크 카드를, 도감에서 누른 것과 같은 모양으로 기억한다.
  // 그래야 검색창이 "제크로무 ex · 블랙볼트 · 174번"으로 보이고 마켓도 옮겨 다닐 수 있다.
  //
  // 스니커덩크 제목 꼴: "이름 [코드 번호/총장수](세트 설명)"
  const 공유대기ref = useRef<{ title: string; rawTitle?: string } | null>(null);
  const 공유카드기억 = (title: string, rawTitle?: string) => {
    if (!세트목록ref.current) {
      공유대기ref.current = { title, rawTitle };
      return;
    }
    const m = String(title).match(/^(.*?)\s*\[([A-Za-z0-9+-]+)[\s-]+([^/\]]+?)\s*(?:\/[^\]]*)?\]/);
    if (!m) return;
    const [, 이름원문, 코드, 번호] = m;
    // ⚠️ 제목 끝에 붙은 **등급 표기를 뗀다.** 스니커덩크 제목은 "トゲピー C [SM9a 034/055]"
    //    꼴이라 그대로 두면 이름이 "토게피 C"가 되고, 이베이·TCGplayer에는
    //    "Togepi C 34"가 나가 0건이 된다(2026-08-07 점검 중 발견). 등급은 카드 이름이
    //    아니다 — 같은 카드를 다른 마켓에서 찾으려면 이름만 있어야 한다.
    const 이름 = 이름원문
      .replace(/\s*:\s*\d?ED\s*$/i, '')
      .replace(/\s+(?:C|U|R|RR|RRR|SR|SSR|HR|UR|AR|SAR|CHR|CSR|K|A|PR|PROMO)\s*$/i, '')
      // ⚠️ 옛 세트는 등급을 글자가 아니라 기호로 적는다(★ ◆ ●). 이것도 카드 이름이
      //    아니다 — 안 떼면 검색창에 "나쁜 슬리퍼 ★ · 로켓단의 역습 · 043번"으로 보이고
      //    다른 마켓에는 "わるいスリーパー ★"가 나가 0건이 된다(2026-08-07 발견).
      .replace(/[★☆◆◇●○♢♦]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // ⚠️ 대소문자를 맞춰 견준다. 스니커덩크 제목은 "[e2 004/092]"처럼 소문자로 적는데
    //    우리 세트코드는 "E2"라 못 찾았다(점검 중 발견 2026-08-06).
    const 세트 = 세트목록ref.current?.find(
      (s) => s.id.toLowerCase() === 코드.toLowerCase() && s.ed === 'ja',
    );
    if (!세트) return;
    pokedexPickRef.current = {
      ko: 이름.trim(),
      en: '',
      raw: rawTitle ?? title,
      speciesEn: '',
      slug: 세트.slug,
      setCode: 코드,
      setName: 세트.name,
      setNameKo: 세트.name,
      num: 번호.trim(),
      jp: true,
    };
    마켓칸ref.current = 0;
    자동이동ref.current = false; // 이미 그 카드를 보고 있다 — 저절로 옮기지 않는다
    // ⚠️ 검색어도 그 카드용("SV11B 174")으로 바꾼다. 원본 제목을 그대로 두면 검색창에
    //    일본어 괄호까지 든 긴 글자가 보이고, 마켓을 옮겨도 그 카드로 못 찾는다.
    //    보여줄 글자는 위 정보로 만들어진다(보일검색어).
    setQuery(도감검색어(pokedexPickRef.current, 마켓순서(true)[0]));
  };

  // 카드 한 장(세트·번호·판까지 아는 것)으로 시세를 보러 간다. 도감·세트별 목록·
  // 작가별 목록이 모두 이 길을 쓴다 — 어느 화면에서 눌렀든 그 한 장을 찾아 준다.
  const 카드로가기 = (c: 도감카드정보) => {
    pokedexPickRef.current = c;
    마켓칸ref.current = 0;
    자동이동ref.current = true;
    // 검색어를 이름으로 바꿔치기하던 장치는 끈다. 그러면 카드가 누구인지 잊어버려
    // 다음 마켓을 그 카드로 못 찾는다(운영자 지적 2026-08-06).
    scanFallbackRef.current = null;
    scanQueriesRef.current = null;
    setScanFellBack(false);
    set도감안내(null);
    const m = 마켓순서(c.jp)[0];
    navigate({ view: 'cards', source: m.source, edition: m.edition, query: 도감검색어(c, m) });
  };

  // 검색창에 **보일** 글자. 마켓마다 실제로 보내는 검색어가 다르다(스니커덩크는
  // "XYP 276", PPT는 "Charizard"). 그걸 그대로 보여 주면 마켓을 옮길 때마다 글자가
  // 바뀌고, 특히 PPT에서는 "그냥 리자몽을 찾고 있나?" 싶게 된다(운영자 지적
  // 2026-08-06). 도감에서 온 카드를 쫓는 동안에는 한글 한 가지로 통일해 보여 준다.
  //
  // 상태를 따로 두지 않고 지금 검색어에서 끌어낸다 — 따로 두면 다른 데서 검색어를
  // 바꿨을 때 옛 글자가 남는다.
  const 보일검색어 = (() => {
    const c = 도감카드(query);
    return c ? 도감표시(c) : query;
  })();

  // 스니커덩크 제목에서 그 한 장을 찾는 무늬. [SV6 050 /101] · [PMCG2 No.036] 둘 다 받는다.
  // ⚠️ 드물게 번호가 앞에 오는 꼴도 있다("[001/SV-P]"). 무늬를 넓힐까 재 봤는데,
  //    무작위 45장 중 결과가 있던 38장이 모두 [코드 번호] 꼴이었다(2026-08-07).
  //    뒤집힌 꼴만 있는 카드는 0장이라 지금 무늬로 충분하다 — 넓히면 "[050/101]"처럼
  //    번호/총장수 표기까지 걸려 남의 카드를 그 카드로 볼 위험이 생긴다.
  const 제목무늬 = (setCode: string, num: string) =>
    new RegExp(`\\[${setCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[- ](?:No\\.)?0*${num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/\\]]|\\s)`, 'i');
  // 사진으로 찾은 카드는 소스마다 검색어가 다르다. 스니커덩크는 일본판 카탈로그라
  // "세트코드 번호"(M4 086/083)로 찾는 게 정확하고, 이베이·TCGplayer는 영문 이름이
  // 있어야 걸린다(Charizard ex 086/083). 탭만 바꿨을 때 갈아 끼우려고 둘 다 들고 있는다.
  //
  // ⚠️ 방문기록(history.state.nav)에도 같이 싣는다. 예전엔 여기(메모리)에만 뒀더니,
  //    다른 화면에 갔다 오거나 새로고침하면 사라져서 탭을 바꿔도 검색어가 안 갈렸다.
  //    스니커덩크용 "다크라이 :1ED [CP5 024/036](콘셉트팩…)"을 그대로 들고 이베이로
  //    가서 0건이 됐다(사용자 제보 2026-08-03).
  const scanQueriesRef = useRef<{ snkrdunk: string; ebay: string } | null>(savedNav().scanQueries ?? null);
  // 백업(이름) 재검색이 실제로 일어났음을 알리는 안내.
  const [scanFellBack, setScanFellBack] = useState(false);
  // 도감에서 온 카드를 마켓을 옮겨 가며 찾은 결과를 알리는 한 줄. 검색어는 건드리지
  // 않고 이 문구만 바꾼다 — 검색어를 바꾸면 다른 탭에서 그 카드를 못 찾는다.
  const [도감안내, set도감안내] = useState<string | null>(null);
  // 번호 대신 일러스트레이터로 찾아낸 경우 그 사실을 알려 준다(후보가 여럿이면 몇 개인지).
  const [scanFoundByArtist, setScanFoundByArtist] = useState(0);
  // 마지막으로 "결과가 실제로 나온" 검색어와 개수. 인기 검색어 집계 때, 결과가 0인
  // 오타·타이핑 조각이 순위에 끼는 걸 막는 데 쓴다(집계 시점에 최신값을 참조).
  const searchResultRef = useRef<{ query: string; count: number; source: PriceSource }>({ query: '', count: 0, source: 'snkrdunk' });
  // 결과가 도착할 때마다 1 올린다. 아래 인기 검색어 집계가 "시간이 얼마나 지났나" 대신
  // "결과가 왔나"를 보고 움직이게 하는 신호다(2026-08-04). 예전에는 검색어가 바뀌고
  // 1.5초 뒤 딱 한 번만 확인해서, 그 안에 결과가 못 오면 그 검색은 영영 안 세어졌다.
  const [resultTick, setResultTick] = useState(0);
  // 사람이 "이걸 찾는다"고 분명히 밝힌 검색어. 사진으로 찾기·자동완성 고르기·인기
  // 검색어 누르기·엔터가 여기 해당한다. 이런 검색은 타이핑 조각일 리가 없으므로
  // 기다리지 않고 결과가 오는 대로 바로 센다.
  const confirmedSearchRef = useRef<{ query: string; via: SearchVia } | null>(null);
  // 같은 검색어를 두 번 세지 않도록 마지막으로 집계한 검색어를 들고 있다. 결과가
  // 여러 번 도착해도(소스를 바꾸거나 다시 시도할 때) 한 번만 센다.
  const trackedQueryRef = useRef('');
  const [items, setItems] = useState<SnkrdunkCard[]>([]);
  const [lastPage, setLastPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 실패했을 때 "다시 시도"를 누르면 이 값이 바뀌면서 아래 검색 효과가 다시 돈다.
  const [retryTick, setRetryTick] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [popularSearches, setPopularSearches] = useState<PopularSearch[]>([]);
  const [popularAsOf, setPopularAsOf] = useState<number | null>(null);
  const [popularLoading, setPopularLoading] = useState(true);
  // 저장된 건 참조(ID+카테고리)뿐이고, 화면에 뿌릴 카드는 조회해서 채운다.
  const [favoriteRefs, setFavoriteRefs] = useState<StoredCardRef[]>(() => getFavoriteRefs());
  const [recentRefs, setRecentRefs] = useState<StoredCardRef[]>(() => getRecentRefs());
  const [favorites, setFavorites] = useState<SnkrdunkCard[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<SnkrdunkCard[]>([]);
  const [interestSelectedId, setInterestSelectedId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // 방향키로 고른 자동완성 줄(-1 = 아무것도 안 고름).
  const [suggestActive, setSuggestActive] = useState(-1);
  const [news, setNews] = useState<KoreanNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  // ⚠️ 옛 해외 시세가 쓰던 칸(ebayItems·ebayLoading·ebayOffset…)은 2026-08-13에 길과
  //    함께 지웠다. 지금은 아래 「해외 시세 전용 칸」 하나뿐이다.
  /**
   * 공유 링크(`/e/<번호>`)로 들어와 열어야 할 카드. 색인에서 찾은 slug·번호를 담아
   * 두면, 아래 새 길 검색이 그 카드를 **맨 앞에 세우고 펼친다**(도감에서 눌러 온 것과 같은 길).
   * ⚠️ 한 번 쓰고 비운다 — 안 비우면 그 뒤 검색마다 엉뚱한 카드가 맨 앞에 선다.
   */
  const 공유카드ref = useRef<{ slug: string; no: string; tcg?: string } | null>(null);
  const [pendingSnkr, setPendingSnkr] = useState<SnkrdunkCard | null>(null);
  // 공유 링크로 들어와 카드를 찾는 중. 이 동안에는 주소를 건드리지 않는다 —
  // 카드가 아직 안 골라졌다고 주소를 /로 되돌려 버리면 링크가 무용지물이 된다.
  // ⚠️ `/card/<번호>`도 같이 본다 — 검색으로 들어오는 카드 한 장 주소다(2026-08-31).
  const [restoringShare, setRestoringShare] = useState(() =>
    /^\/([cet]|card)\//.test(window.location.pathname),
  );
  // ── 해외 시세 전용 칸 ──────────────────────────────────────────────────────
  const [boardItems, setBoardItems] = useState<BoardCard[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardTotal, setBoardTotal] = useState(0);
  // 천장(2,000장)에 걸려 잘렸을 때 그 수. 0이면 안 잘렸다 — 즉 **찾은 것이 다 나와 있다.**
  // ⚠️ 「더 보기」·쪽 나누기는 없다. 옛 길이 쪽을 나눈 것은 크레딧 때문인데 여기는 0이다.
  const [board잘림, setBoard잘림] = useState(0);
  const [boardSelectedId, setBoardSelectedId] = useState<string | null>(null);
  // 새 길에서 지금 보는 마켓. **따로 기억하지 않고 `source`에서 읽는다** —
  // 마켓을 고르는 자리는 검색창 왼쪽 칩 하나뿐이고, 그 칩은 `source`를 보고 그린다
  // (사장님 지시 2026-08-12: "어차피 검색바에 마켓 변경 할수있으니까 마켓 토글은 없애줘").
  // 따로 들고 있으면 **칩과 토글 두 군데가 같은 것을 말해** 서로 어긋난다.
  const board켬 = source === 'cardboard' || source === 'cardboard_tcg';
  const board마켓: 'ebay' | 'tcgplayer' = source === 'cardboard_tcg' ? 'tcgplayer' : 'ebay';
  const [board받은날, setBoard받은날] = useState<{ 시세: string | null; 낙찰: string | null; 팝수: string | null } | null>(null);
  const [edition, setEdition] = useState<CardEdition>(() => savedNav().edition ?? 'japanese');
  // 「기타 언어판」(사장님 지시 2026-08-20) — 프랑스·독일판 같은 곁 카드(`~lang`)만 모아 보는
  // 세 번째 판. ⚠️ edition을 셋으로 안 넓힌다 — edition은 스니커덩크 검색 등 딴 자리도 쓰는
  // 값이라 값 하나를 더하면 그쪽이 다 흔들린다. 이 값이 참이면 board 길만 'other'로 묻는다.
  const [board기타언어, setBoard기타언어] = useState(false);
  const board판: 'japanese' | 'english' | 'other' = board기타언어 ? 'other' : edition;
  const [nickname, setNickname] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [createdAt, setCreatedAt] = useState<number | undefined>(undefined);
  // 신고함 탭을 보여줄지 정하는 값일 뿐이다. 이걸 위조해도 서버가 신고 목록을
  // 안 주므로 아무것도 못 본다.
  const [isAdmin, setIsAdmin] = useState(false);
  /**
   * **개발 서버에서만** 열리는 화면. 지금은 만드는 중인 게임(디펜스) 하나뿐이다.
   *
   * ⚠️⚠️ 왜: 게임은 운영자 전용인데 **로컬에는 계정이 아예 없어** 로컬에서도 막혔다.
   *    그래서 고칠 때마다 배포해야 했는데 배포는 한 번에 7초씩 멈춘다(사장님 2026-08-17:
   *    "수정할때마다 배포하는거 좀 그런데 그냥 로컬서버에서 하면어때").
   * ⚠️ `import.meta.env.DEV`는 **빌드하면 false**라 운영에는 안 나간다. 운영에서는 여전히
   *    운영자만 본다. **이 값을 다른 화면(신고함·통계·플리마켓)에 쓰지 말 것** — 그쪽은
   *    진짜 자료가 걸려 있다.
   */
  const 개발중 = import.meta.env.DEV;
  // 검색·공유로 들어온 주소(/set/…·/artist/…·/series/…·/centering, 그리고 카테고리
  // 대문 /sets·/artists·/packsim·/community)로 들어오면 서버가 그 화면의 내용을 글자로
  // 미리 넣어 보낸다. 앱이 뜨면 그 조각을 걷어 낸다 — 화면은 위 useState에서 이미 그
  // 주소에 맞춰 열렸다(viewFromPath).
  // ⚠️ 주소는 그대로 둔다. 새로고침·공유해도 같은 자리가 열려야 한다.
  // ⚠️⚠️ **조건을 걸지 않는다.** 예전엔 `viewFromPath(...)`가 빈 값이면 걷어 내지 않았는데,
  //    홈(`/`)은 특정 화면이 아니라 늘 빈 값이다. 2026-08-18에 홈에도 안쪽 링크를 넣어
  //    보내기 시작하자 **홈에서만 이 조각이 화면에 그대로 남았다**(앱은 멀쩡히 떠 있었다).
  //    이 조각은 서버가 크롤러를 위해 넣은 것이라, 앱이 떴으면 어느 주소든 지우는 게 맞다.
  useEffect(() => {
    document.getElementById('seo-fallback')?.remove();
  }, []);
  // 팩 개봉의 "수록 카드 보기" → 세트 목록에서 그 세트를 바로 연다.
  // /set/<슬러그>로 들어와도 같은 자리로 보낸다(검색으로 들어오는 길).
  const [setsInitialSlug, setSetsInitialSlug] = useState<string | null>(
    // +도 받는다(SM1+ 같은 옛 세트 코드). 빼면 그 주소로 들어와도 세트가 안 열린다.
    () => decodeURIComponent(window.location.pathname.match(/^\/set\/([\w.%+-]+)/)?.[1] ?? '') || null,
  );
  // /community/<번호>로 들어오면 그 글을 바로 연다(검색·링크로 들어오는 길).
  const [postInitialId, setPostInitialId] = useState<number | null>(
    () => Number(window.location.pathname.match(/^\/community\/(\d+)/)?.[1]) || null,
  );
  // 팩 개봉 앨범에서 시세 화면으로 넘어왔는지. 맞으면 "앨범으로 돌아가기"를 띄운다.
  const [backToPacksim, setBackToPacksim] = useState(false);
  // 카드 비교. 최대 2장을 담아 나란히 본다. 베타로 모두에게 공개(2026-07-20).
  const showCompare = true;
  const [compareCards, setCompareCards] = useState<SnkrdunkCard[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  function toggleCompare(card: SnkrdunkCard) {
    setCompareCards((prev) => {
      if (prev.some((c) => c.apparelId === card.apparelId)) return prev.filter((c) => c.apparelId !== card.apparelId);
      return [...prev, card].slice(-2); // 최대 2장, 오래된 것부터 밀어낸다
    });
  }
  function removeCompare(id: number) {
    setCompareCards((prev) => prev.filter((c) => c.apparelId !== id));
  }
  // 이베이 카드 비교. SNKRDUNK와 별개 트레이 — 소스가 다르면 비교 의미가 없다.
  const [compareEbay, setCompareEbay] = useState<EbayCard[]>([]);
  function toggleCompareEbay(card: EbayCard) {
    const 이미담김 = compareEbay.some((c) => c.tcgPlayerId === card.tcgPlayerId);
    setCompareEbay((prev) => {
      if (prev.some((c) => c.tcgPlayerId === card.tcgPlayerId)) return prev.filter((c) => c.tcgPlayerId !== card.tcgPlayerId);
      return [...prev, card].slice(-2);
    });
    // ⚠️⚠️ **새 길 카드는 목록에 등급이 대표 하나뿐이다.** 그대로 담으면 비교표에
    //    한 줄만 나와 「PSA 10만 있는 카드」로 보인다. 담는 순간 전부 받아 채운다
    //    (크레딧 0 — 서버가 쌓아 둔 것을 읽는다).
    const b = card as BoardCard;
    if (!이미담김 && b.gradesTrimmed && /^\d/.test(card.tcgPlayerId)) {
      void fetchBoardDetail(card.tcgPlayerId, board판, undefined, true)
        .then(({ grades }) => {
          if (!grades.length) return;
          setCompareEbay((prev) =>
            prev.map((c) => (c.tcgPlayerId === card.tcgPlayerId ? { ...c, grades, gradesTrimmed: false } : c)),
          );
        })
        .catch(() => undefined);
    }
  }
  function removeCompareEbay(id: string) {
    setCompareEbay((prev) => prev.filter((c) => c.tcgPlayerId !== id));
  }
  // 소스(스니덩크↔이베이)를 바꾸면 열려 있던 비교 표는 닫는다(소스별 표가 달라서).
  useEffect(() => setCompareOpen(false), [source]);
  const [providers, setProviders] = useState<LoginProvider[]>([]);
  const [needsNickname, setNeedsNickname] = useState(false);
  // 로그인 모달은 마이페이지·커뮤니티 어디서든 열리므로 App이 들고 있는다.
  const [loginOpen, setLoginOpen] = useState(false);

  function loadPopularSearches() {
    fetchPopularSearches()
      .then(({ items, asOf }) => {
        setPopularSearches(items);
        setPopularAsOf(asOf);
      })
      .catch(() => undefined)
      .finally(() => setPopularLoading(false));
  }

  useEffect(() => {
    loadPopularSearches();
    // 방문 집계. 같은 브라우저는 하루 한 번만 세고, IP·기기 정보는 저장하지 않는다.
    trackVisit();
  }, []);

  // 참조가 바뀔 때마다 현재 시세로 다시 채운다. 마이페이지를 열 때마다 최신 가격이
  // 보이는 이유이고, SNKRDUNK 조회는 크레딧을 쓰지 않아 부담이 없다.
  // 마이페이지를 한 번이라도 열었는지. 즐겨찾기·최근 본 카드의 "지금 시세와 한글 이름"은
  // 그 화면에서만 쓴다. 그런데 첫 화면에서 미리 받으면 이름 사전(115KB)까지 딸려 와서,
  // 한 번이라도 카드를 담아 본 사람은 홈에 들어올 때마다 그걸 다 받고 있었다
  // (처음 오는 사람 91KB / 다시 오는 사람 215KB — 2026-08-04 운영에서 실측).
  // ⚠️ 카드 옆 북마크 표시는 참조(favoriteRefs)만 보므로 여기 영향을 안 받는다.
  const [interestNeeded, setInterestNeeded] = useState(false);
  useEffect(() => {
    if (view === 'mypage') setInterestNeeded(true);
  }, [view]);

  // 지금 못 받은 장수. 0보다 크면 마이페이지가 "사라진 게 아니라 못 받은 것"이라고
  // 알려 준다(안 알리면 이용자는 찜이 날아간 줄 안다 — 운영자 지적 2026-08-06).
  const [favoritesMissing, setFavoritesMissing] = useState(0);
  const [recentMissing, setRecentMissing] = useState(0);

  useEffect(() => {
    if (!interestNeeded) return;
    let cancelled = false;
    resolveStoredCards(favoriteRefs).then(({ cards, unavailable, gone }) => {
      if (cancelled) return;
      setFavorites(cards);
      setFavoritesMissing(unavailable);
      // 정말 없어진 상품은 저장 목록에서도 지운다 — 안 지우면 열 때마다 다시 훑는다.
      if (gone.length) removeStoredRefs('favorites', gone);
    });
    return () => {
      cancelled = true;
    };
  }, [favoriteRefs, interestNeeded]);

  useEffect(() => {
    if (!interestNeeded) return;
    let cancelled = false;
    resolveStoredCards(recentRefs).then(({ cards, unavailable, gone }) => {
      if (cancelled) return;
      setRecentlyViewed(cards);
      setRecentMissing(unavailable);
      if (gone.length) removeStoredRefs('recent', gone);
    });
    return () => {
      cancelled = true;
    };
  }, [recentRefs, interestNeeded]);

  // 카카오 콜백이 /?setNickname=1 로 돌려보내면 최초 로그인이라 닉네임 설정을 띄운다.
  // 주소창에 흔적을 남기지 않도록 확인 후 쿼리는 지운다.
  useEffect(() => {
    fetchMe().then(async (me) => {
      setLoggedIn(me.loggedIn);
      setNickname(me.nickname ?? null);
      setCreatedAt(me.createdAt);
      setIsAdmin(me.isAdmin ?? false);
      setProviders(me.providers ?? []);
      // 새로고침으로 되살린 화면이 운영자 전용인데 운영자가 아니면 빈 화면만 남는다.
      //
      // ⚠️⚠️ **뽑기(/packsim)는 이제 안 튕긴다**(2026-08-31). 예전엔 로그인 안 했으면
      //    홈으로 보냈는데, 그 주소를 사이트맵에 넣어 두고 있었다 — 구글과 애드센스
      //    심사원이 누르면 **아무것도 없이 홈으로 튕겼다.** 애드센스가 든 사유 그대로다
      //    (「알림, 이동 또는 기타 행동 목적으로 사용되는 화면」 · 2026-08-30 불합격).
      //    PackSim은 손님 처리를 이미 갖고 있다(`guest`) — 진열·값·확률표는 그대로
      //    보이고 출석·구매만 로그인 창을 띄운다. 튕길 까닭이 없었다.
      // 지금 화면은 setView의 함수형으로 읽는다 — 이 효과는 한 번만 돌아야 해서
      // view를 의존성에 넣을 수 없다.
      setView((v) => {
        const adminOnly = v === 'reports' || v === 'stats' || v === 'scantest' || v === 'flea' || v === 'ebaycheck';
        // ⚠️ 로컬 개발(npm run dev)에서는 로그인 없이도 운영 화면을 연다 — 운영 메뉴가
        //    `개발중`으로 이미 보이는 것과 같은 잣대다. 배포판에서는 그대로 막힌다.
        if (adminOnly && !me.isAdmin && !import.meta.env.DEV) return 'cards';
        return v;
      });
      if (me.loggedIn && !me.nickname) setNeedsNickname(true);
      if (!me.loggedIn) return;

      // 로그인 상태면 이 기기에 담아둔 걸 계정과 합치고, 합친 결과를 양쪽에 반영한다.
      // 이 단계가 없으면 로그인하는 순간 비로그인 때 찜해둔 게 사라져 보인다.
      const merged = await mergeCollections({ favorites: getFavoriteRefs(), recent: getRecentRefs() });
      if (!merged) return;
      writeFavoriteRefs(merged.favorites);
      writeRecentRefs(merged.recent);
      setFavoriteRefs(merged.favorites);
      setRecentRefs(merged.recent);
    });

    const params = new URLSearchParams(window.location.search);

    // 계정 연결은 인증하러 나갔다 돌아오는 거라, 알려주지 않으면 아무 일도 안 일어난
    // 것처럼 보인다. 특히 실패했을 땐 이유를 말해줘야 한다.
    const link = params.get('link');
    if (link) {
      setView('mypage');
      if (link === 'ok') window.alert('계정을 연결했습니다. 이제 어느 쪽으로 로그인해도 같은 계정으로 들어옵니다.');
      else if (link === 'taken') window.alert('이미 다른 계정에 연결된 로그인 수단입니다.');
      else window.alert('연결하지 못했습니다. 다시 시도해 주세요.');
    }

    if (params.has('setNickname') || params.has('login') || params.has('link')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // 화면 이동은 여기로 모은다. 상태를 바꾸고 방문기록(history)에 새 항목을 쌓아,
  // 뒤로가기가 한 단계씩 직전 화면으로 가게 한다(탭 이동·일러스트레이터에서 카드 열기 등).
  // 아무것도 안 바뀌면 중복 항목을 안 쌓는다.
  const navigate = (next: { view?: MainView; query?: string; source?: PriceSource; edition?: CardEdition }) => {
    const snap = {
      view: next.view ?? view,
      query: next.query ?? query,
      source: next.source ?? source,
      edition: next.edition ?? edition,
    };
    const same = snap.view === view && snap.query === query && snap.source === source && snap.edition === edition;
    // 시세 화면을 떠나면 "앨범으로 돌아가기" 안내도 거둔다.
    if (next.view !== undefined && next.view !== 'cards') setBackToPacksim(false);
    if (next.view !== undefined) setView(snap.view);
    if (next.query !== undefined) setQuery(snap.query);
    if (next.source !== undefined) setSource(새길로(snap.source));
    if (next.edition !== undefined) setEdition(snap.edition);
    // 소스별 검색어도 새 방문기록에 실어 둔다. 안 그러면 커뮤니티 등에 갔다 뒤로 왔을 때
    // 탭을 바꿔도 검색어가 안 갈린다(위 scanQueriesRef 설명).
    if (!same) window.history.pushState({ nav: { ...snap, scanQueries: scanQueriesRef.current } }, '');
  };

  // 처음 화면(카드 시세 홈)으로. 검색·선택·화면을 비우고 맨 위로 올린다.
  const goHome = () => {
    setSelectedId(null);
    setBoardSelectedId(null);
    setInterestSelectedId(null);
    // ⚠️⚠️ **스캔 자취도 여기서 거둔다.** 안 거두면 홈으로 와도 검색바 밑에 「찾는 카드가
    //    아닌가요? / 스캔이 틀렸습니다」가 그대로 남는다 — 아무것도 안 찾고 있는 화면에
    //    무엇이 틀렸다는 말인지 알 수 없다(사장님 지적 2026-08-13: "스캔 다 하고 볼거 다
    //    보고 홈에 갔는데 … 스캔이 틀렸나요? 라고 뜨는 거").
    //    지우기(X)에는 이 처리가 있었는데 **홈 단추·로고에는 없었다** — 나가는 길이 둘인데
    //    한쪽만 치우고 있었다. 여기 모아서 두 길이 같아진다.
    setScannedResult(null);
    // ⚠️ 오류 글도 같이 거둔다 — 안 거두면 홈으로 와도 「카드 인식에 실패했습니다」가
    //    남는다(신고 링크가 그대로 남던 것과 같은 함정 · 2026-08-13).
    setScanFailed(false);
    setScanReported(false);
    setScanFellBack(false);
    setScanFoundByArtist(0);
    scanFallbackRef.current = null;
    scanQueriesRef.current = null;
    navigate({ view: 'cards', query: '' });
    window.scrollTo({ top: 0 });
  };

  // 사진에서 번호를 못 읽었을 때, 일러스트레이터 이름으로 카드를 찾아 번호를 채운다.
  // 번호는 구석에 아주 작게 있어 사진이 조금만 잘려도 못 읽는데, 일러스트레이터 이름은
  // 그림 바로 아래라 웬만하면 찍힌다. "작가 + 카드이름"이면 86%가 한 장으로 좁혀진다.
  // 못 찾으면 원래대로 이름으로만 검색한다(조용히 넘어간다).
  /**
   * **스캔이 읽은 「세트+번호」가 「이름」과 맞는지 도감에 대 본다.**
   *
   * ⚠️⚠️ 스캔은 **카드 이름은 잘 읽는데 세트 코드를 자주 틀린다.** 세트 코드는 카드 구석에
   *    작게 있어 사진이 조금만 흐려도 놓친다. 신고함에 쌓인 것을 확인해 보니 그랬다
   *    (2026-08-13): 「M3 052 = Iron Valiant ex」라 했는데 M3 052는 **이벨타르 ex**이고,
   *    「S12a 242 = Jasmine」은 실제로 **원규**, 「S-P 157 = Regigigas」는 **밀라**였다.
   *    그 번호로 찾으면 **엉뚱한 카드의 시세**가 뜬다 — 빈손보다 나쁘다.
   * ⚠️ 반대로 신고된 것 중 **맞았던 것도 있다**(s6a 089 = 리피아 VMAX = Leafeon VMAX).
   *    한글 이름이 낯설어 다른 카드로 오해하신 것이다. 그러니 **무턱대고 번호를 버리면 안 된다.**
   * → 도감이 그 번호를 **딱 한 장**으로 짚어 줄 때만 이름을 견주고, **다른 포켓몬이라고
   *   확실히 판정될 때만** 번호를 버린다(`같은카드인가`는 애매하면 null을 준다).
   *   크레딧 0 — 우리 도감만 읽는다.
   */
  const 스캔번호믿을만한가 = async (result: CardScanResult): Promise<boolean> => {
    if (!result.setCode || !result.cardNumber || !result.pokemonNameEn) return true;
    try {
      const ed: CardEdition = result.edition === 'english' ? 'english' : 'japanese';
      // 도감 조회와 사전 읽기는 서로 상관없으니 **동시에** 한다(차례로 하면 그만큼 더 기다린다).
      const [r, dict] = await Promise.all([
        searchCardBoard(`${result.setCode} ${result.cardNumber}`, ed),
        loadNameDict(),
      ]);
      // 한 장으로 안 좁혀지면 판단할 근거가 없다 — 그대로 둔다.
      if (r.cards.length !== 1) return true;
      const 도감이름 = r.cards[0].name;
      const 스캔한글 = dict.koreanizeEnglishCardName(result.pokemonNameEn);
      const 같나 = await 같은카드인가(도감이름, 스캔한글);
      if (같나 !== null) return 같나;
      // ⚠️⚠️ **트레이너·굿즈는 여기로 온다.** `같은카드인가`는 **포켓몬 이름이 잡힐 때만**
      //    판정하고 아니면 null을 준다 — 그래서 신고된 「S-P 157 = Regigigas」(실제 밀라)와
      //    「S12a 242 = Jasmine」(실제 원규)이 그냥 통과했다. 이름끼리 직접 견줘 한 번 더 막는다.
      // ⚠️ 한쪽이 다른 쪽을 품기만 해도 같은 것으로 본다 — 도감은 「규리의 눈빛」인데 스캔은
      //    「규리」처럼 짧게 읽는 일이 흔하다. 여기서 엄격하게 굴면 멀쩡한 번호를 버린다.
      // ⚠️ 잘못 버려도 손해가 작다 — **번호만 빼고 이름으로 찾는다**(빈손이 아니다).
      const 다듬 = (x: string) => x.toLowerCase().replace(/[\s·:()[\]{}'".-]/g, '');
      const a = 다듬(도감이름);
      const b = 다듬(스캔한글);
      if (!a || !b) return true;
      return a.includes(b) || b.includes(a);
    } catch {
      return true; // 못 물어보면 그대로 둔다(스캔을 막을 이유는 없다)
    }
  };

  const applyScanWithLookup = async (result: CardScanResult) => {
    // ⚠️ **번호가 이름과 어긋나면 번호를 버리고 이름으로 찾는다.** 아래 작가로 번호를
    //    채우는 길보다 **먼저** 본다 — 틀린 번호를 들고 그 길로 들어가면 안 된다.
    if (!(await 스캔번호믿을만한가(result))) {
      applyScanResult({ ...result, cardNumber: null, setCode: null });
      setScanFellBack(true);
      return;
    }
    // ⚠️ 영문판일 때만 쓴다. 작가별 카드 목록이 영문판 기준이라, 일본판 카드에 쓰면
    // 같은 그림의 "영문판 번호"가 나와 스니커덩크에서 엉뚱한 카드를 찾게 된다
    // (일본판 메가리자몽Y ex는 MC 766/742인데 목록은 영문판 294를 준다).
    if (result.cardNumber || !result.illustrator || result.edition !== 'english') {
      applyScanResult(result);
      return;
    }
    const hit = await findCardByIllustrator(result.illustrator, result.pokemonNameEn);
    // 후보가 딱 하나일 때만 번호를 채운다. 여럿이면 어느 것인지 알 수 없어서, 번호를
    // 찍어 넣으면 엉뚱한 카드의 시세를 보여주게 된다 — 그럴 바엔 이름으로 찾게 둔다.
    const sure = hit && hit.candidates === 1 ? hit : null;
    applyScanResult(sure ? { ...result, cardNumber: sure.number } : result);
    if (sure) setScanFoundByArtist(1);
  };

  // 스캔 결과를 검색어·소스·판(일/북미)에 반영한다. 카메라 버튼과 센터링 도구가 공유한다.
  const applyScanResult = (result: CardScanResult) => {
    const num = result.cardNumber;
    // ⚠️⚠️ **해외 시세도 「세트코드 + 번호」로 찾는다**(2026-08-16에 바꿈).
    //    예전엔 「영문 이름 + 번호」였는데, 실제 스캔 기록으로 재 보니 그게 제일 나빴다:
    //        세트코드+번호 99% · 이름만 100% · **이름+번호 90%**
    //    이름에 꼬리표가 붙어 있어서다 —「Gardevoir ex (Delta Species) 5」처럼.
    //    CLAUDE.md에 「영문판은 세트코드가 일본 꼴이라 이름 쪽이 확실하다」고 적혀 있었는데,
    //    새 검색이 **우리 도감**을 뒤지게 바뀌면서 그 판단이 뒤집혔다.
    // ⚠️ 세트코드를 못 읽었으면 이름으로 간다(둘 다 없으면 아래에서 이름만 쓴다).
    const 코드번호 = num ? [result.setCode, num].filter(Boolean).join(' ') : '';
    const snkrdunk = 코드번호 || (result.pokemonNameEn ?? '');
    const ebay = (result.setCode && 코드번호) || (num ? [result.pokemonNameEn, num].filter(Boolean).join(' ') : '') || (result.pokemonNameEn ?? '');
    const ed: 'japanese' | 'english' = result.edition === 'english' ? 'english' : 'japanese';
    // ⚠️ 영문판 카드는 스니커덩크(일본 마켓)에 없으므로 해외 시세로 보낸다.
    //    2026-08-13까지 여기가 옛 길(`ebay`)을 가리키고 있었다 — 탭을 없애면서 같이
    //    옮겼다. 안 옮겼으면 **사진으로 찾은 영문 카드가 없는 탭으로 가서 빈손**이 된다.
    const target = ed === 'english' ? 'cardboard' : source;
    // 번호로 검색하는 경우에만 이름 백업을 둔다. 번호로 0건이면 이름으로 다시 찾는다.
    scanFallbackRef.current = num && result.pokemonNameEn ? result.pokemonNameEn : null;
    scanQueriesRef.current = { snkrdunk, ebay };
    setScanFellBack(false);
    setScanFoundByArtist(0);
    setEdition(ed);
    setSource(target);
    // 스니커덩크는 세트코드+번호("M4 086/083")로 찾고, 해외 시세는 영문 이름+번호로
    // 찾는다. 새 길은 두 꼴을 다 알아듣지만, 영문판은 세트코드가 일본 꼴이라 이름 쪽이 확실하다.
    const scanQuery = target === 'snkrdunk' ? snkrdunk : ebay;
    // 사진으로 찾은 건 타이핑 조각일 수가 없다. 결과가 늦게 와도 인기 검색어에 세도록
    // 확정으로 표시한다(예전엔 1.5초를 넘기면 통째로 누락됐다 — 사용자 지적 2026-08-04).
    confirmSearch(scanQuery, 'scan');
    setQuery(scanQuery);
    setScannedResult(result);
    setScanReported(false);
  };

  // 시세 소스(탭)를 바꾼다. 사진으로 찾은 카드라면 검색어도 그 소스에 맞게 갈아 끼운다 —
  // 안 그러면 스니커덩크에서 "M4 086/083"으로 잘 나온 카드가, 이베이로 옮기는 순간
  // 그 세트코드를 그대로 들고 가서 0건이 된다(사용자 제보).
  // 검색어를 손으로 고친 뒤라면 그대로 둔다(둘 중 어느 것과도 같지 않으면 손댄 것이다).
  // ── 마켓 바꾸기 (스니커덩크 / eBay / TCGplayer) ─────────────────────────────
  // ⚠️⚠️ **고르는 자리는 검색창 왼쪽 칩 하나뿐이다.** 2026-08-09부터 위에 탭 막대가
  //    따로 있었는데(「일본 매물 / 해외 시세」) 2026-08-13에 없앴다.
  //    가른 까닭은 **통하는 말의 꼴이 달라서**였다 — 옛 해외 시세는 저쪽(PPT)에 매물을
  //    물어봐서 영문 이름이 있어야 했다. 새 길은 **우리 도감을 한글·영문 이름으로**
  //    뒤지고 스니커덩크도 두 꼴을 다 알아들어, 그 까닭이 사라졌다.
  //    같은 것을 말하는 자리가 둘이면 서로 어긋나기만 한다.
  // ⚠️ **검색어는 마켓을 바꿔도 그대로 간다.** 손으로 친 말은 건드리지 않는다.
  //    아래에서 갈아 끼우는 것은 **우리가 만들어 넣은 말**뿐이다 —
  //    ① 도감·세트에서 눌러 온 카드 ② 사진으로 찾아 넣은 "M4 086/083" 꼴.
  //    그 둘은 마켓마다 통하는 꼴이 달라, 안 갈면 옮기는 순간 0건이 된다(사용자 제보).
  const switchSource = (next: PriceSource) => {
    // 도감에서 온 카드를 보고 있으면, 옮겨 간 마켓에 맞는 검색어로 갈아 준다.
    // 이게 없으면 스니커덩크용 "SV6 050"을 이베이에 그대로 넣어 0건이 된다
    // (운영자 지적 2026-08-06).
    const c = 도감카드(query);
    // 새 길은 **우리 도감을 한글 이름으로** 뒤진다. 옛 길에 맞춰 만든 검색어("M6 113"·
    // 영문 이름)를 그대로 들고 오면 0장이 된다 — 카드 이름으로 갈아 준다.
    // ⚠️ 판(일본/영문)은 그 카드가 실제로 속한 쪽으로 맞춘다. 안 맞추면 일본판 카드를
    //    영문판 서랍에서 찾게 되어 역시 0장이다.
    if (next === 'cardboard' || next === 'cardboard_tcg') {
      자동이동ref.current = false;
      set도감안내(null);
      // ⚠️ **TCGplayer 눈으로 바꾼 것을 센다.** 검색은 `cardboard_search` 하나로만
      //    세므로, 이걸 안 세면 두 마켓 중 어느 쪽을 보는지 통계에서 통째로 빠진다
      //    (옛 길의 'tcgplayer'가 세던 몫을 이 줄이 이어받는다).
      if (next === 'cardboard_tcg' && source !== 'cardboard_tcg') trackEvent('cardboard_tcg');
      // ⚠️ **마켓 칸도 맞춰 둔다.** 안 맞추면 나중에 스니커덩크로 돌아갔을 때
      //    `다음마켓으로`가 엉뚱한 칸에서 세기 시작한다(칸이 0인 채로 남는다).
      if (c) {
        const i = 마켓순서(c.jp).findIndex((m) => m.source === 'cardboard');
        if (i >= 0) 마켓칸ref.current = i;
      }
      // ⚠️ 새 길 안에서 마켓만 바꾸는 것(eBay↔TCGplayer)일 때는 검색어를 안 건드린다.
      //    같은 응답을 나눠 보는 것뿐이라, 여기서 갈아 끼우면 보던 자리를 잃는다.
      if (c && !board켬) {
        setEdition(c.jp ? 'japanese' : 'english');
        setQuery(c.ko);
      }
      // 사진으로 찾은 카드라면 이 마켓에 맞는 검색어로 갈아 준다. 아래 같은 처리가
      // 이미 있지만 여기서 먼저 빠져나가므로 안 거친다 — 없으면 스니커덩크용
      // "M4 086/083"을 그대로 들고 온다(2026-08-13에 옛 탭을 없애며 드러난 자리다).
      if (!c && !board켬) {
        const qs = scanQueriesRef.current;
        if (qs && query === qs.snkrdunk && qs.ebay && qs.ebay !== query) setQuery(qs.ebay);
      }
      setSource(next);
      return;
    }
    if (c) {
      const 순서 = 마켓순서(c.jp);
      const i = 순서.findIndex((m) => m.source === next);
      if (i >= 0) {
        // 사람이 고른 마켓이므로 여기서 값이 없어도 저절로 옮기지 않는다.
        자동이동ref.current = false;
        마켓칸ref.current = i;
        set도감안내(null);
        setEdition(순서[i].edition);
        setQuery(도감검색어(c, 순서[i]));
        setSource(next);
        return;
      }
    }
    const qs = scanQueriesRef.current;
    if (qs && (query === qs.snkrdunk || query === qs.ebay)) {
      const want = next === 'snkrdunk' ? qs.snkrdunk : qs.ebay;
      if (want && want !== query) setQuery(want);
    }
    setSource(next);
  };

  // 센터링 도구의 "이 카드 시세 보러 가기": 찍어둔 사진을 그대로 스캔해 시세 화면으로.
  const searchByPhoto = async (file: File) => {
    trackEvent('scan');
    const result = await scanCard(file);
    if (!result.found || !(result.pokemonNameEn || result.cardNumber)) {
      throw new Error('카드를 인식하지 못했습니다. 앞면이 또렷한 사진으로 다시 시도해 주세요.');
    }
    await applyScanWithLookup(result);
    setView('cards');
    window.scrollTo({ top: 0 });
  };

  // 뒤로가기: navigate()가 방문기록에 실어둔 화면 상태(nav)로 한 단계씩 복원한다.
  // 카드 상세 시트(DetailSheet)는 자체적으로 뒤로가기를 처리하므로(sheet 표식) 넘긴다.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = e.state as {
        sheet?: boolean
        nav?: {
          view: MainView
          query: string
          source: PriceSource
          edition: CardEdition
          scanQueries?: { snkrdunk: string; ebay: string } | null
        }
      } | null;
      if (st?.sheet) return;
      // 시트가 스스로 닫히며 부른 back()이다. 이 칸에 적힌 화면 상태는 시트를 열기 전
      // 것이라, 복원하면 그 사이 바뀐 마켓·검색어가 되돌아간다(lib/sheetHistory.ts).
      if (시트가스스로닫힘.on) {
        시트가스스로닫힘.on = false;
        return;
      }
      const nav = st?.nav;
      if (!nav) return;
      setView(nav.view);
      setQuery(nav.query);
      setSource(새길로(nav.source));
      setEdition(nav.edition);
      // 소스별 검색어도 같이 되살린다 — 없으면 뒤로 온 뒤 탭을 바꿔도 안 갈린다.
      scanQueriesRef.current = nav.scanQueries ?? null;
      setSelectedId(null);
      setBoardSelectedId(null);
      setInterestSelectedId(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 지금 화면 상태를 현재 방문기록 항목에 계속 반영해 둔다. 검색어 타이핑은 새 항목을
  // 쌓지 않고(navigate가 아니므로) 이 항목만 갱신 → 카드 상세를 열었다 뒤로가기로 닫아도
  // 검색어가 남는다. sheet 등 다른 표식은 보존한다.
  // scanQueries도 같이 싣는다 — 사진으로 찾은 카드의 소스별 검색어라, 이게 없으면
  // 화면을 떠났다 온 뒤 탭을 바꿔도 검색어가 안 갈린다(위 scanQueriesRef 설명).
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, nav: { view, query, source, edition, scanQueries: scanQueriesRef.current } },
      '',
    );
  }, [view, query, source, edition, scannedResult]);

  // ⚠️ **화면이 바뀌면 열려 있던 드롭다운을 닫는다.**
  //    드롭다운을 펼친 채로 홈·커뮤니티를 누르면 이동은 되는데 목록이 그대로 떠
  //    있었다(2026-08-08 확인 — /community에서 홈을 누르니 주소는 "/"로 바뀌었는데
  //    "포켓몬 세트 작가"가 계속 보였다). 뒤로가기로 화면이 바뀔 때도 마찬가지다.
  //    드롭다운 항목을 눌러 온 경우엔 이미 닫혀 있으므로 이 줄이 하는 일이 없다.
  useEffect(() => {
    setOpenMenu(null);
  }, [view]);

  async function handleLogout() {
    await logout();
    setLoggedIn(false);
    setNickname(null);
    setCreatedAt(undefined);
    setIsAdmin(false);
    setProviders([]);
    // 운영자가 로그아웃했는데 운영자 전용 화면이 그대로 열려 있으면 빈 화면만 남는다.
    // (세트별 목록은 공개 화면이라 제외 — 로그아웃해도 그대로 볼 수 있다.)
    // ⚠️ 뽑기(packsim)도 제외한다(2026-08-31). 손님으로 진열과 확률표를 볼 수 있으므로
    //    로그아웃했다고 화면을 빼앗을 까닭이 없다 — 위 설명 참고.
    if (view === 'reports' || view === 'stats' || view === 'scantest' || view === 'flea' || view === 'ebaycheck')
      setView('cards');
  }

  useEffect(() => {
    fetchPokemonNews()
      .then(setNews)
      .catch(() => undefined)
      .finally(() => setNewsLoading(false));
  }, []);

  // 카드 공유 링크(/c/<id>)로 들어오면 그 카드를 바로 보여준다.
  // 주소에 이름을 싣지 않는다 — 카드 이름이 길어서 링크가 감당 못 하게 길어졌다
  // (세트명까지 들어가 한글이 퍼센트 인코딩되면 200자가 넘었다). 번호만 있으면
  // 스니커덩크에서 이름·시세를 받아올 수 있으므로 그걸로 충분하다.
  // 옛 링크(?n=이름)도 계속 되게 둔다 — 이미 카톡·카페에 뿌려진 것들이 있다.
  useEffect(() => {
    // ⚠️ `/card/<번호>`는 검색엔진이 들어오는 카드 한 장 주소다(2026-08-31). 앱에서는
    //    TCGplayer 길(`/t/`)과 똑같이 태운다 — 우리 도감에서 번호로 카드를 찾는 같은 길이다.
    const m = window.location.pathname.match(/^\/(card|[cet])\/([\w-]+)/);
    if (!m) return;
    const [, 길, id] = m;
    // ⚠️ **보내는 사람이 보던 탭으로 열어 준다**(사장님 지시 2026-09-02). 예전엔 /card/가
    //    무조건 TCGplayer였다 — 이베이 탭에서 공유했는데 받은 사람은 다른 값을 봤다.
    //    ⚠️ 판(일본어판/영문판)은 이미 따라간다(아래 `setEdition(c.edition)`) — 카드 자체가
    //       어느 판인지 알려 주므로 주소에 실을 까닭이 없다.
    //    ⚠️ 대표 주소는 `?m` 없는 `/card/<번호>`다(서버가 그렇게 박는다). 구글에는 한 쪽으로만
    //       보이고, 탭은 사람이 볼 때만 갈린다.
    const 마켓 = new URLSearchParams(window.location.search).get('m');
    const kind = 길 === 'card' ? (마켓 === 'e' ? 'e' : 't') : 길;

    if (kind === 'c') {
      setSource('snkrdunk');
      // 옛 링크(?n=이름)는 그 이름으로 바로 검색한다.
      const legacyName = new URLSearchParams(window.location.search).get('n');
      if (legacyName) {
        setQuery(legacyName);
        setRestoringShare(false);
        return;
      }
      resolveStoredCards([{ apparelId: Number(id), category: 'card' }])
        .then(({ cards }) => {
          if (!cards[0]) {
            setRestoringShare(false);
            return;
          }
          setPendingSnkr(cards[0]);
          setQuery(cards[0].title);
          // 검색창에 원본 제목이 통째로 들어가 지저분했다 — 일본어 괄호까지 섞여
          // "제크로무 ex BWR [SV11B 174/086](확장팩「…」)"로 보였다(점검 중 발견
          // 2026-08-06). 제목에서 세트코드·번호를 뽑아 도감에서 온 것과 같은 한 줄로
          // 보이게 한다. 뽑지 못하면 예전처럼 제목을 그대로 둔다.
          공유카드기억(cards[0].title, cards[0].rawTitle);
        })
        .catch(() => setRestoringShare(false));
      return;
    }

    // ── 이베이·TCGplayer 공유 링크(`/e/<번호>`·`/t/<번호>`) ──────────────────────
    //
    // ⚠️⚠️ **저쪽에 안 묻는다.** 예전에는 번호로 저쪽에 이름을 물어 그 이름으로 검색을
    //    태웠다 — 크레딧이 나가서 하루 상한(500번)까지 걸어 뒀고, 상한을 넘으면 링크를
    //    열어도 홈이 떴다. 우리 색인에 저쪽 번호가 **57,344장** 들어 있으므로 우리가
    //    바로 찾으면 된다(2026-08-13에 새 길로 옮겼다. **크레딧 0**).
    // ⚠️ 이미 나간 링크는 그대로 산다 — 번호가 같은 번호다.
    setSource(kind === 'e' ? 'cardboard' : 'cardboard_tcg');
    fetch(`/api/local/card-board?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { card?: { slug: string; no: string; name: string; edition: CardEdition } | null } | null) => {
        const c = j?.card;
        if (!c) {
          // 우리 도감에 없는 번호다(옛 프로모 등). 주소에 실린 이름이라도 있으면 그걸로 찾는다.
          const 실린이름 = new URLSearchParams(window.location.search).get('n');
          if (실린이름) setQuery(실린이름);
          setRestoringShare(false);
          return;
        }
        setEdition(c.edition);
        setQuery(c.name);
        // 그 카드를 맨 앞에 세우고 펼치도록 검색에 같이 넘긴다(도감에서 눌러 온 것과 같은 길).
        공유카드ref.current = { slug: c.slug, no: c.no };
        setRestoringShare(false);
      })
      .catch(() => setRestoringShare(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      return;
    }

    setSuggestActive(-1);

    let cancelled = false;
    // 이름 목록(포켓몬·팩·카드명)도 사전만큼 커서 같이 나중에 받는다. 검색창을 누르는
    // 순간 미리 받아 두므로 글자를 칠 때쯤이면 이미 와 있다.
    // 이건 우리 사전에서 찾는 거라 **기다림 없이 바로** 보여준다.
    // ⚠️ 2026-08-08부터 이 모듈이 우리 서버(/api/local/rarity-terms)에서 낱말을 한 번 더
    //    받아 온다(검색창을 처음 누를 때 한 번, 81KB). **다른 마켓을 부르는 게 아니라**
    //    우리 서버라 크레딧과 무관하고, 못 받아도 빌드 시점 목록으로 그대로 돈다.
    //    (예전 주석은 "밖으로 안 나간다"였는데 이제 사실이 아니라 고쳤다.)
    void import('./lib/localSuggestions').then((m) => {
      if (!cancelled) setSuggestions(m.getLocalSuggestions(trimmed));
    });

    // ⚠️ SNKRDUNK 자동완성은 글자마다 그대로 밖으로 나가고 있었다. "리자몽 VSTAR UR"
    //    한 번 치는 동안 10번을 부르고 그중 8번이 실제로 SNKRDUNK까지 갔다(실측
    //    2026-08-04). 조사하던 컴퓨터가 실제로 차단당했다 — 운영 서버가 막히면
    //    방문자 전체가 검색을 못 한다. 그래서 두 겹으로 줄인다:
    //     ① 손이 멈춘 뒤에만 부른다(아래 기다림)
    //     ② 목록이 닫혀 있으면 아예 안 부른다 — 보이지도 않는 걸 받을 이유가 없다
    //    검색 본체(350·600ms)와 달리 여기는 원래 기다림이 아예 없었다.
    // ⚠️ **이베이·TCG 탭에서 스니커덩크 추천을 뺄지 재 봤다(2026-08-08). 안 뺐다.**
    //    사장님 지적("이베이·TCG·팝수는 저쪽 자료라 우리 사전이 더 알맞지 않나")은 옳지만,
    //    실제로 세어 보니 **빼는 손해가 이득보다 컸다**:
    //      · 스니커덩크가 채우는 24줄 중 그 장터에서만 통하는 말은 **2줄**뿐이었다
    //        ("리자몽 구뒷면"·"망나뇽 구뒷면"). 나머지 20여 줄은 진짜 카드말이다
    //        ("팬텀&따라큐"·"릴리에의 전력"·"개굴닌자 MUR").
    //      · 우리 사전만으로 열 줄을 채우는 건 **74.7%**뿐이다(방문자가 친 말 기준).
    //        나머지 넷 중 하나꼴로 목록이 얇아진다.
    //    → 8%쯤 되는 군더더기를 없애자고 25%에서 목록을 줄이는 건 손해다.
    //    다시 재고 싶으면 이 숫자와 견줄 것.
    // ⚠️ **마켓(스니커덩크·이베이·TCGplayer)별로 목록을 가리지는 않는다.**
    //    한때 "스니커덩크일 때만 부르자"고 넣었다가 뺐다(2026-08-08). 자동완성은
    //    "어떤 카드를 찾는가"이지 "어디서 파는가"가 아니고, 마켓 토글이 바로 옆에
    //    있어 고른 뒤 바꾸면 된다. 마켓을 바꿀 때마다 목록이 달라지는 편이 더 헷갈린다.
    //    (다만 "리자몽 MUR"처럼 스니커덩크에서만 통하는 말이 섞이는 건 사실이다 —
    //     이베이·TCGplayer 쪽에서는 0장이 된다. 그건 감수한다.)
    if (!suggestionsOpen) {
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => {
      fetchRemoteSuggestions(trimmed).then((remote) => {
        if (cancelled || remote.length === 0) return;
        setSuggestions((prev) => {
          // ⚠️ **스니커덩크 목록은 사람들이 친 말이라 표기가 제멋대로다.** 우리 목록에
          //    이미 있는 것과 대소문자·띄어쓰기만 다른 것이 나란히 떴다 —
          //    "Charizard ex" 밑에 "charizard ex"가 한 줄 더 붙는 식이다(2026-08-08 확인).
          //    열 줄뿐인 목록에서 한 줄은 크다.
          //    ⚠️ **우리 목록끼리는 안 합친다.** "리자몽 ex"(요즘)와 "리자몽 EX"(2000년대)는
          //       진짜 다른 카드다. 여기서 거르는 건 **뒤에 붙이는 쪽**뿐이다.
          // ⚠️ 친 말 그대로도 뺀다. "리자몽"을 친 사람에게 "리자몽"을 권하는 건 빈 줄이다
          //    (우리 목록은 원래 빼는데, 저쪽 목록에는 들어 있었다).
          const 열쇠 = (t: string) => t.toLowerCase().replace(/[\s-]/g, '');
          const 있는것 = new Set([trimmed, ...prev].map(열쇠));
          const 더할것: string[] = [];
          for (const t of remote) {
            const k = 열쇠(t);
            if (있는것.has(k)) continue;
            있는것.add(k);
            더할것.push(t);
          }
          return [...prev, ...더할것].slice(0, 10);
        });
      });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, suggestionsOpen]);

  useEffect(() => {
    if (source !== 'snkrdunk') return;

    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }

    // ⚠️ 한 글자로는 검색을 보내지 않는다. "리" 한 글자에도 진짜 검색이 나가고
    //    페이지를 여러 장 넘겼다. 화면은 위 tooShort가 "두 글자 이상" 안내로 받는다.
    // ⚠️ 여기서 "검색 중"을 반드시 꺼야 한다. 두 글자를 쳤다가 한 글자로 지우면 앞 요청이
    //    끊기는데(아래 ac.abort), 끊긴 요청은 finally에서 끄지 않으므로 켠 채로 남는다.
    //    그러면 "두 글자 이상 입력하면…" 옆에 "검색 중…"이 나란히 떠 있게 된다.
    if (trimmed.length < MIN_SEARCH_LEN) {
      setLoading(false);
      return;
    }

    // ⚠️ "검색 중"을 기다리기 **전에** 켠다. 예전엔 300ms 뒤에야 켰는데, 그 사이에는
    //    검색 중도 아니고 결과도 없는 상태라 화면이 "검색 결과가 없습니다"(+인기 검색어)를
    //    띄웠다 — 찾아보지도 않고 없다고 하는 말이었고, 곧 결과가 뜨면서 깜빡였다
    //    (운영자 지적 2026-08-05).
    setLoading(true);

    // ⚠️ 검색어가 바뀌면 앞서 나간 요청을 그 자리에서 끊는다. 없으면 앞 검색의
    //    7~9페이지와 뒤 검색의 1~4페이지가 동시에 돌았다(실측 2026-08-04).
    const ac = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchMoreUniqueCards(trimmed, 1, new Set(), INITIAL_TARGET, undefined, ac.signal)
        .then(async ({ items: 받은것, lastPage, exhausted }) => {
          let items = 받은것;
          // 도감에서 눌러 온 일본판 카드는 "세트코드 번호"로 찾았지만, 스니커덩크 검색은
          // 코드를 부분일치로 본다 — "SV6 050"에 SV6a 050이, "SV8 068"에 SV8a 068이
          // 딸려 와 엉뚱한 카드가 맨 앞에 선다(실측 2026-08-06, 40장 중 5장).
          // 그래서 결과 제목의 [코드 번호/…]로 그 한 장을 직접 골라낸다.
          const 도감 = 도감카드(trimmed);
          const 무늬 = 도감?.setCode ? 제목무늬(도감.setCode, 도감.num) : null;
          let 그카드 = 무늬 ? items.find((c) => 무늬.test(c.rawTitle ?? c.title)) : undefined;
          if (도감 && !그카드) {
            // ⚠️ 꼴을 하나만 쓰면 놓친다. "SV10 073"은 0건인데 "フォレトス 073"으로는
            //    1번째로 나온다(실측 2026-08-06). 코드로 못 찾으면 이름꼴로 한 번 더.
            const 이름꼴 = `${도감.raw} ${도감.num}`.trim();
            if (도감.raw && 이름꼴 !== trimmed) {
              const 두번째 = await fetchMoreUniqueCards(이름꼴, 1, new Set(), INITIAL_TARGET, undefined, ac.signal)
                .then((r) => r.items)
                .catch(() => []);
              그카드 = 무늬 ? 두번째.find((c) => 무늬.test(c.rawTitle ?? c.title)) : undefined;
              if (그카드) items = 두번째;
            }
          }
          // ⚠️ 번호가 맞아도 **다른 포켓몬이면 그 카드가 아니다.** 옛 세트는 우리
          //    데이터가 영문판 번호를 담고 있어, ja-neo4 38번을 누르면 화면엔
          //    "다크암스타"인데 스니커덩크는 "상냥한 나인테일"을 준다(27장이 그렇다 —
          //    2026-08-07 전수 확인). 남의 카드 값을 그 카드인 양 보여 주느니
          //    값을 안 보여 주는 편이 낫다.
          let 다른카드였음 = false;
          if (그카드 && 도감) {
            const 같나 = await 같은카드인가(도감.ko, 그카드.title ?? '');
            if (같나 === false) {
              그카드 = undefined;
              다른카드였음 = true;
            }
          }
          // 도감에서 온 카드인데 이 마켓엔 없다 → 다음 마켓으로 넘긴다. 검색어를
          // 이름으로 바꿔치기하지 않는다(그러면 다음 마켓에서 그 카드를 못 찾는다).
          //
          // ⚠️ 카드를 찾았어도 **값이 없으면** 마찬가지로 넘긴다. 스니커덩크는 매물이
          //    있어야 값이 생겨서, 옛 카드는 "매물 0개 · 시세 없음"으로 나온다. 그걸
          //    붙들고 있느니 값이 있는 마켓을 보여 주는 게 낫다(쏘콘 SV10 073이 여기서
          //    막혀 있었고, TCGplayer에는 $0.12가 있었다).
          if (도감 && (!그카드 || !그카드.price)) {
            if (다음마켓으로(도감, 다른카드였음)) return;
            // ⚠️ 결과가 있는데 "값이 없습니다"라고 하면 눈앞의 17건과 말이 어긋난다
            //    (점검 중 발견 2026-08-06 — 영문판 파이숭이를 스니커덩크에서 봤을 때).
            //    보여 줄 게 하나도 없을 때만 "값이 없다"고 한다.
            if (!그카드)
              set도감안내(
                다른카드였음
                  ? `${도감.ko} · ${짧은세트(도감.setNameKo)} ${도감.num}번은 이 마켓에서 같은 번호에 다른 카드가 잡혀, 값을 쓰지 않았습니다.`
                  : items.length === 0
                    ? // 여기는 스니커덩크 결과다. 스니커덩크는 지금 올라온 매물이라
                      // "안 팔렸다"가 아니라 "지금 물건이 없다"가 맞다.
                      `${도감.ko} · ${짧은세트(도감.setNameKo)} ${도감.num}번은 이 마켓에 ${값없음문구('snkrdunk', false)}.`
                    : `${짧은세트(도감.setNameKo)} ${도감.num}번은 이 마켓에서 찾지 못해, 같은 이름의 다른 카드를 보여 드립니다.`,
              );
          }

          // 스캔한 "세트+번호"가 0건이면(코드는 읽었지만 매칭 실패) 이름으로 자동 재검색.
          const fb = scanFallbackRef.current;
          if (items.length === 0 && fb && fb.trim() && fb.trim() !== trimmed) {
            scanFallbackRef.current = null;
            setScanFellBack(true);
            // ⚠️ 대체한 검색어를 그 소스 자리에 다시 적어 둔다. 안 그러면 아래
            //    switchSource가 "사람이 손으로 고쳤다"고 보고, 탭을 되돌려도 원래
            //    검색어로 안 돌아온다(사진으로 찾은 인도네시아 피카츄가 이베이에서
            //    "Pikachu"로 대체된 뒤, 스니커덩크로 와도 계속 "Pikachu"였다).
            // ⚠️ **두 마켓 자리에 다 적는다.** 되찾은 말은 이름이라 어느 마켓에서도 통한다.
            //    한쪽만 적으면 마켓을 옮길 때 다시 0건이 나던 말로 되돌아간다.
            if (scanQueriesRef.current) scanQueriesRef.current = { snkrdunk: fb, ebay: fb };
            setQuery(fb);
            return;
          }
          if (도감 && 그카드) {
            // 첫 마켓에서 바로 찾았거나 사람이 직접 고른 마켓이면 굳이 설명하지 않는다.
            const 칸 = 마켓칸ref.current;
            const 순서 = 마켓순서(도감.jp);
            trackEvent('card_found', 순서[칸].label);
            set도감안내(
              자동이동ref.current && 칸 > 0
                ? `${순서[칸 - 1].label}에 ${값없음이유(순서[칸 - 1].source)} ${순서[칸].label} 값을 보여 드립니다.`
                : null,
            );
          }
          const 정렬됨 = 그카드 ? [그카드, ...items.filter((c) => c !== 그카드)] : items;
          setItems(정렬됨);
          searchResultRef.current = { query: trimmed, count: 정렬됨.length, source: 'snkrdunk' };
          setResultTick((n) => n + 1);
          setLastPage(lastPage);
          setExhausted(exhausted);
          // 이미 고른 카드가 새 결과에도 있으면 유지하고, 없으면 큰 화면에서만 첫
          // 카드를 자동 선택한다. 폰에서는 null로 둬서 사용자가 누를 때까지 시트를
          // 안 띄운다.
          setSelectedId((prev) =>
            // 도감에서 그 한 장을 눌러 왔으면 폰에서도 바로 연다.
            그카드?.apparelId ??
            (정렬됨.some((c) => c.apparelId === prev)
              ? prev
              : isWideScreen()
                ? (정렬됨[0]?.apparelId ?? null)
                : null),
          );
        })
        .catch((e: unknown) => {
          // 우리가 일부러 끊은 것은 오류가 아니다. 안내문을 띄우면 안 된다.
          if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
          setError('시세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
      // 한글은 한 글자 치는 데 0.3~0.6초라 350ms면 거의 매 글자마다 걸렸다.
    }, 600);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query, source, retryTick]);

  // ── 새 길(cardboard) 검색 ──────────────────────────────────────────────────
  //
  // ⚠️ **기다리는 시간이 짧다.** 옛 길은 크레딧이 들어(1회 36) 600ms를 기다렸는데,
  //    여기는 우리 파일만 읽어 **크레딧 0 · 0.02초**라 굳이 참을 이유가 없다.
  // ⚠️ 옛 길이 하던 것 중 **여기서 필요 없어진 것들**: 영어로 옮기기·번호 붙여 좁히기·
  //    세트 대응표·되돌아온 세트 대조·레어도 꼬리 떼기. 카드를 우리가 골랐으므로
  //    "정말 그 카드인가"를 되물을 일이 없다. **잃은 기능이 아니라 필요가 없어진 것**이다.
  // ⚠️ 조건에 **마켓이 없다**(`board켬`은 켜졌나만 본다). 새 길은 두 마켓 값을 한 번에
  //    들고 오므로, 칩으로 eBay↔TCGplayer를 바꿔도 **다시 안 부른다** — 넣어 두면
  //    칩을 누를 때마다 목록이 새로 그려지고 보던 카드 선택이 풀린다.
  useEffect(() => {
    if (!board켬) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setBoardItems([]);
      setBoardTotal(0);
      setBoardLoading(false);
      return;
    }
    if (trimmed.length < MIN_SEARCH_LEN) {
      setBoardLoading(false);
      return;
    }
    setBoardLoading(true);
    const ac = new AbortController();
    // 도감·세트·작가에서 카드 한 장을 눌러 왔으면 그 카드를 맨 앞에 세우고 **바로 펼친다.**
    // ⚠️ 옛 길이 하던 일이다(그쪽은 아예 그 한 장만 보여 준다). 안 하면 눌러 온 카드가
    //    목록 어딘가에 묻혀, 눌렀는데 아무 반응이 없는 것처럼 보인다.
    // 도감에서 눌러 왔거나, 공유 링크로 들어왔거나 — 둘 다 「그 카드를 맨 앞에」다.
    const 도감것 = 도감카드(trimmed);
    const 콕 = 도감것 ? { slug: 도감것.slug, no: 도감것.num, tcg: 도감것.tcg } : 공유카드ref.current;
    const timer = setTimeout(() => {
      searchCardBoard(trimmed, board판, ac.signal, 콕)
        .then((r) => {
          setBoardItems(r.cards);
          setBoardTotal(r.total);
          setBoard잘림(r.잘림 ?? 0);
          setBoard받은날(r.받은날 ?? null);
          // 서버가 그 카드를 맨 앞에 세워 준다. **세트와 번호가 둘 다 맞을 때만** 펼친다 —
          // 못 찾았는데 첫 장을 펼치면 **딴 카드를 그 카드인 양** 보여 주게 된다.
          const 맨앞 = r.cards[0];
          const 번호열쇠 = (s: string) => String(s ?? '').trim().replace(/^0+(?=\d)/, '').toUpperCase();
          // ⚠️ 저쪽 번호가 있으면 그것으로 본다 — 꼬리 붙은 번호(`205~517051`)는 카드에 찍힌
          //    번호(`205`)와 절대 안 맞는다. 없을 때만 옛 길(세트+번호)로 물러선다.
          const 맞나 =
            !!콕 &&
            !!맨앞 &&
            (콕.tcg
              ? String(맨앞.tcgPlayerId) === String(콕.tcg)
              : 맨앞.slug === 콕.slug &&
                번호열쇠(맨앞.cardNumber ?? '') === 번호열쇠(String(콕.no).split('~')[0]));
          setBoardSelectedId(맞나 ? 맨앞.tcgPlayerId : null);
          // 공유 링크로 온 것은 한 번 쓰고 비운다(다음 검색까지 따라다니면 안 된다).
          공유카드ref.current = null;
          trackEvent('cardboard_search');
        })
        .catch((e) => {
          if (ac.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
          setBoardItems([]);
          setBoardTotal(0);
          setBoard잘림(0);
        })
        .finally(() => {
          if (!ac.signal.aborted) setBoardLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [query, board켬, board판]);


  // 인기 검색어 집계. "결과가 도착했나"를 보고 움직인다(resultTick).
  //
  // ⚠️ 예전에는 검색어가 바뀌고 1.5초 뒤에 딱 한 번만 확인했다. 그 안에 결과가 못 오면
  //    그 검색은 영영 안 세어졌다 — 되돌아올 기회가 없었다(효과가 검색어 바뀔 때만 돌았다).
  //    스니커덩크는 0.3초 안에 와서 괜찮았지만, 이베이·TCGplayer는 대기(600ms) 뒤
  //    PPT를 부르므로 느리면 그대로 누락됐다. 사진으로 찾기가 특히 이베이로 가므로
  //    "사진으로 찾은 카드"가 인기 검색어에 잘 안 오르던 원인이 이것이다(사용자 지적).
  //
  // 이제 결과가 오면 그때 판단한다. 사람이 분명히 확정한 검색(사진·자동완성·인기
  // 검색어·엔터)은 기다리지 않고 바로 세고, 그냥 타이핑한 것만 잠깐 기다려
  // 미완성 문자열("피카츄"를 치다 멈춘 "피카")을 거른다.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const confirmed = confirmedSearchRef.current?.query === trimmed;

    const timer = setTimeout(() => {
      // 결과가 실제로 나온 검색어만 집계한다. 오타·존재하지 않는 카드처럼 결과가 0인
      // 문자열이 인기 검색어를 오염시키는 걸 막는다.
      const r = searchResultRef.current;
      // ⚠️ 결과가 0건이어도 이베이·TCGplayer는 이미 크레딧을 썼다(한 번에 36). 여기서
      //    그냥 돌아가면 그 돈이 통계에 한 줄도 안 남는다. 실제로 2026-08-05 새벽에
      //    "이베이 0번"인데 크레딧만 줄어 원인을 못 찾고 헤맸다.
      //    인기 검색어에는 안 올리되(오타가 순위를 더럽히면 안 되니까), 어느 소스를
      //    몇 번 불렀는지는 결과와 상관없이 센다.
      if (r.query !== trimmed) return;
      // ⚠️ 빈손인 검색을 세던 자리는 **옛 해외 시세 전용**이었다(2026-08-13에 지웠다).
      //    까닭이 「검색당 크레딧 36이 나가는데 통계에는 0번으로 잡힌다」였는데, 새 길은
      //    검색에 크레딧을 안 쓰므로 그 까닭이 사라졌다. 스니커덩크는 예전에도 안 셌다.
      if (r.count === 0) return;
      // 결과는 여러 번 도착할 수 있다(소스를 바꾸거나 "다시 시도"). 한 번만 센다.
      if (trackedQueryRef.current === trimmed) return;
      trackedQueryRef.current = trimmed;
      void loadNameDict().then((d) => {
        // 사진으로 찾으면 검색어가 카드 번호라("M4 114/083") 그대로 순위에 올리면
        // 무슨 카드인지 알 수 없다. 그럴 땐 읽어낸 카드 이름으로 집계한다.
        const scanned = scannedResult?.pokemonNameEn ? d.koreanizeEnglishCardName(scannedResult.pokemonNameEn) : '';
        const term = d.canonicalizeSearchTerm(trimmed) || scanned.trim();
        if (term) trackSearch(term);
      });
      // 어느 소스로 실제 검색이 이뤄졌는지만 센다(개인정보 없음).
      // 해외 시세는 제 자리(`cardboard_search`)에서 따로 센다 — 여기는 스니커덩크만.
      if (r.source === 'snkrdunk') trackEvent('snkrdunk_search');
      // 이 한 표가 어떻게 확정된 것인지도 같이 센다. 위 검색 횟수와 합계가 같다.
      const via = confirmed ? confirmedSearchRef.current!.via : null;
      trackEvent(
        via === 'scan' ? 'search_scan'
        : via === 'pick' ? 'search_pick'
        : via === 'popular' ? 'search_popular'
        : via === 'enter' ? 'search_enter'
        : 'search_typed',
      );
      loadPopularSearches();
      // 확정 신호는 한 번 쓰면 버린다. 안 버리면 그 검색어를 다시 칠 때도 "확정한 것"으로
      // 봐서, 타이핑 도중의 같은 조각까지 바로 세어 버린다.
      if (confirmed) confirmedSearchRef.current = null;
    }, confirmed ? 0 : 1500);

    return () => clearTimeout(timer);
    // resultTick이 들어 있어야 "결과 도착"에 반응한다. 검색어만 보면 예전처럼
    // 한 번 놓친 검색을 되찾을 방법이 없다.
  }, [query, resultTick]);

  function loadMore() {
    setLoadingMore(true);
    const excludeIds = new Set(items.map((c) => c.apparelId));
    // "더보기"는 사람이 눌러야 돌므로 타이핑처럼 쏟아지지 않는다. 첫 검색에서 3장으로
    // 줄인 몫을 여기서 넉넉히 훑어 채운다(예전 첫 검색과 같은 15장).
    fetchMoreUniqueCards(query.trim(), lastPage + 1, excludeIds, LOAD_MORE_TARGET, 15)
      .then(({ items: more, lastPage: newLastPage, exhausted: newExhausted }) => {
        setItems((prev) => [...prev, ...more]);
        setLastPage(newLastPage);
        setExhausted(newExhausted || more.length === 0);
      })
      .catch(() => setError('추가 결과를 불러오지 못했습니다.'))
      .finally(() => setLoadingMore(false));
  }

  // ⚠️ **새 길에는 「더 보기」가 없다.** 한 번에 다 온다 — 옛 길이 쪽을 나눈 것은
  //    한 쪽마다 크레딧 36이 나가서인데, 여기는 우리 파일만 읽어 0이다.

  // 카드를 열면 그 카드의 **등급 전부 + 추이 + 낱개 낙찰**을 받아 채운다.
  //
  // ⚠️ 목록에는 대표 등급 하나만 실려 있다 — 17줄을 다 실으면 덩치의 83%가 안 쓰는
  //    것이라 한 번에 몇 장 못 냈다. 여기서 채우므로 상세는 옛 길과 똑같이 다 나온다.
  // ⚠️ 추이·낱개는 **덤프에 없어서 저쪽에 물어야 나온다**(카드당 3크레딧). 서버가 받은
  //    것을 쌓아 두고 이레 동안 다시 안 물으므로, 이미 본 카드는 크레딧이 안 든다.
  useEffect(() => {
    if (!boardSelectedId) return;
    const c = boardItems.find((x) => x.tcgPlayerId === boardSelectedId);
    if (!c || c.채워짐) return; // 이미 채운 카드는 다시 안 부른다
    const ac = new AbortController();
    fetchBoardDetail(boardSelectedId, board판, ac.signal)
      .then(({ grades, tcgHistory, population }) => {
        if (ac.signal.aborted) return;
        setBoardItems((prev) =>
          prev.map((x) =>
            x.tcgPlayerId === boardSelectedId
              ? {
                  ...x,
                  // ⚠️⚠️ **빈 배열도 그대로 쓴다.** 예전엔 비어 있으면 목록에 실려 온 값을
                  //    남겼는데, 그 값은 **덤프에서 온 것**이라 우리가 걷어낸 낙찰이 되살아난다.
                  //    캡틴피카츄는 낙찰 35건이 전부 딴 판(중국판)이라 셈이 0인데, 화면에는
                  //    「등급 확인 안 됨 14건」이 남아 **기록은 잔뜩인데 값은 없는 꼴**로 보였다
                  //    (사장님 지적 2026-08-19). 받아오기가 실패하면 여기까지 안 온다
                  //    (`fetchBoardDetail`이 던진다) — 그러니 **빈 것은 「진짜 없음」이다.**
                  grades,
                  // ⚠️ **머리말의 「낙찰 N건」도 같이 맞춘다.** 목록에 실려 온 수는 덤프 것이라
                  //    걷어낸 낙찰까지 세고 있다. 캡틴피카츄가 「낙찰 35건」인데 아래에는
                  //    한 줄도 없어, **기록은 잔뜩인데 값은 없는** 꼴로 보였다.
                  totalSales: grades.reduce((s, g) => s + g.count, 0),
                  gradesTrimmed: false,
                  채워짐: true,
                  // 감정 수량도 이 한 번에 온다 — 화면이 옛 길(`card-extra`)을 따로 안 부른다.
                  population,
                  // TCGplayer 칸에 추이를 얹는다. `historyCondition`이 있어야 화면이
                  // 「어느 상태의 추이인지」를 제목에 밝힐 수 있다.
                  tcgplayer: x.tcgplayer
                    ? {
                        ...x.tcgplayer,
                        history: tcgHistory?.history ?? [],
                        historyCondition: tcgHistory?.condition ?? null,
                      }
                    : x.tcgplayer,
                }
              : x,
          ),
        );
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [boardSelectedId, boardItems, board판]);

  const boxResults = useMemo(() => items.filter((c) => c.category === 'box'), [items]);
  const cardResults = useMemo(() => items.filter((c) => c.category === 'card'), [items]);

  // items가 바뀔 때 선택을 정리한다. 고른 카드가 사라졌으면 큰 화면에서만 첫 카드로
  // 옮기고, 폰에서는 null로 둬서 검색만 했는데 시트가 뜨는 걸 막는다.
  useEffect(() => {
    setSelectedId((prev) =>
      items.some((c) => c.apparelId === prev) ? prev : isWideScreen() ? (items[0]?.apparelId ?? null) : null,
    );
  }, [items]);

  // 저장은 effect가 아니라 여기서 직접 한다. effect로 걸면 로그인 직후 병합 결과가
  // 다시 저장을 트리거해서 같은 내용을 서버에 한 번 더 쓰게 된다.
  function rememberViewed(card: SnkrdunkCard) {
    const next = addRecentlyViewed(card);
    setRecentRefs(next);
    if (loggedIn) saveCollections({ recent: next });
  }

  function handleSelectCard(id: number) {
    setSelectedId(id);
    const card = items.find((c) => c.apparelId === id);
    if (card) rememberViewed(card);
  }

  function handleSelectInterestCard(id: number) {
    setInterestSelectedId(id);
    const card = [...recentlyViewed, ...favorites].find((c) => c.apparelId === id);
    if (card) rememberViewed(card);
  }

  function handleToggleFavorite(card: SnkrdunkCard) {
    const next = toggleFavorite(card);
    setFavoriteRefs(next);
    if (loggedIn) saveCollections({ favorites: next });
  }

  function handleClearRecent() {
    if (!window.confirm('최근 본 카드 기록을 모두 지울까요?')) return;
    writeRecentRefs([]);
    setRecentRefs([]);
    if (loggedIn) saveCollections({ recent: [] });
  }

  function handleClearFavorites() {
    if (!window.confirm('즐겨찾기한 카드를 모두 지울까요?')) return;
    writeFavoriteRefs([]);
    setFavoriteRefs([]);
    if (loggedIn) saveCollections({ favorites: [] });
  }

  // 검색어를 "확정"했다고 표시한다. 결과만 나오면 기다리지 않고 인기 검색어에 센다.
  function confirmSearch(term: string, via: SearchVia) {
    const t = term.trim();
    if (t) confirmedSearchRef.current = { query: t, via };
  }

  /**
   * 세트 이름을 **검색어로 쓸 꼴**로 다듬는다 — 앞에 붙은 **그 세트의 코드**를 뗀다.
   *
   * ⚠️⚠️ 코드를 달고 보내면 **박스가 0개**다. 스니커덩크에 직접 물어 잰 값
   *    (2026-09-03, 표본 11세트 — 코드를 뗀 쪽이 한 번도 지지 않았다):
   *        「M6 ストームエメラルダ」 박스 0 ↔ 「ストームエメラルダ」 박스 3
   *        「S6a イーブイヒーローズ」 박스 0 ↔ 「イーブイヒーローズ」 박스 3
   *        「S12aVSTARユニバース」 0건   ↔ 「VSTARユニバース」 24건·박스 2
   *    마켓 상품명에 우리 세트코드가 안 들어 있어서다.
   * ⚠️ **그 세트가 실제로 가진 코드일 때만 뗀다.** 앞의 영문 낱말을 무턱대고 떼면
   *    이름이 뭉개진다 — 「25th 애니버서리 골든 박스」의 25th는 코드가 아니라 이름이다.
   *    세트 679개 중 141개가 코드를 달고 있고, 그 141개만 손댄다.
   */
  function 세트검색말(term: string): string {
    const 세트 = (setNamesKo as { ko: string; slug: string }[]).find((x) => x.ko === term);
    if (!세트) return term;
    const id = 세트목록ref.current?.find((s) => s.slug === 세트.slug)?.id ?? '';
    if (!id) return term;
    const 뗀 = term.replace(new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*`, 'i'), '').trim();
    return 뗀 || term;
  }

  function handleSelectSuggestion(term: string) {
    setSuggestionsOpen(false);
    setSuggestActive(-1);
    // ⚠️⚠️ 예전엔 고른 말이 **세트 이름**이면 검색을 접고 그 세트의 **카드 목록 화면**으로
    //    보냈다. 시세를 찾으러 검색창을 쓴 사람에게 카드 목록이 튀어나오는 건 말이 안 된다
    //    (사장님 지적 2026-09-03). 그때 적어 둔 이유는 "세트 이름으론 저쪽이 0건"이었는데
    //    **그 전제가 틀렸다** — 스니커덩크는 세트 이름으로 **박스·팩 매물**을 준다
    //    (「ストームエメラルダ」 → 박스 3개). 그냥 검색한다.
    // ⚠️ 담아 두는 말도 **코드를 뗀 쪽**이다. 인기 검색어에 올라 남이 눌렀을 때도
    //    같은 결과가 나와야 한다 — 코드가 붙은 말은 그 자리에서 0건이 된다.
    const 말 = 세트검색말(term);
    confirmSearch(말, 'pick');
    setQuery(말);
  }

  // 자동완성 목록 키보드 조작. 처리했으면 true를 돌려줘 브라우저 기본 동작을 막는다.
  function handleSuggestKey(key: 'ArrowDown' | 'ArrowUp' | 'Escape' | 'Enter'): boolean {
    if (!suggestionsOpen || suggestions.length === 0) return false;
    if (key === 'Escape') {
      setSuggestionsOpen(false);
      setSuggestActive(-1);
      return true;
    }
    if (key === 'Enter') {
      if (suggestActive < 0) return false; // 고른 게 없으면 친 그대로 검색한다
      handleSelectSuggestion(suggestions[suggestActive]);
      return true;
    }
    // 끝에서 한 번 더 누르면 반대쪽으로 돈다(목록이 짧아 되돌아가기가 빠르다).
    const last = suggestions.length - 1;
    setSuggestActive((i) => (key === 'ArrowDown' ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1));
    return true;
  }

  // 공유 링크로 들어온 카드를 펼쳐 준다. 검색 결과에 이미 있으면 그걸 고르고,
  // 없으면 맨 앞에 꽂는다 — 이름으로 검색하면 다른 세트가 먼저 잡혀 정작 공유한
  // 카드가 첫 페이지에 없을 수 있다.
  useEffect(() => {
    if (!pendingSnkr) return;
    if (items.length === 0) return;
    if (!items.some((c) => c.apparelId === pendingSnkr.apparelId)) {
      setItems((prev) => [pendingSnkr, ...prev]);
    }
    setSelectedId(pendingSnkr.apparelId);
    setPendingSnkr(null);
    setRestoringShare(false);
  }, [items, pendingSnkr]);

  const selectedCard = items.find((c) => c.apparelId === selectedId) ?? null;
  const boardSelectedCard = boardItems.find((c) => c.tcgPlayerId === boardSelectedId) ?? null;
  const interestSelectedCard =
    [...recentlyViewed, ...favorites].find((c) => c.apparelId === interestSelectedId) ?? null;

  // 상세를 열면 주소창을 그 카드의 공유 링크(/c/<id>?n=<이름>)로 바꾼다. replaceState라
  // 히스토리 스택은 안 건드려서 기존 뒤로가기 처리와 충돌하지 않는다. 이걸로 사용자가
  // 주소를 복사해 붙이면 카드 이름·시세 미리보기가 뜨는 링크가 된다.
  useEffect(() => {
    // 소스마다 주소를 따로 둔다. 전에는 스니커덩크만 있어서 이베이·TCGplayer 카드는
    // 아예 공유할 주소가 없었다.
    //   /c/<번호>  스니커덩크      /card/<번호>  이베이·TCGplayer(같은 카드다)
    // 카드 화면이 아니거나 아무 카드도 안 골랐으면 주소를 /로 되돌린다.
    //
    // ⚠️⚠️ **이베이·TCGplayer를 /card/ 하나로 모았다**(2026-08-31). 예전엔 같은 한 장이
    //    보는 탭에 따라 /e/와 /t/ 두 주소로 나갔다 — 구글에게는 **같은 글이 두 쪽**이라
    //    둘 다 값이 깎인다. 탭은 보는 사람의 취향이지 다른 카드가 아니다.
    //    이미 뿌려진 /e/·/t/ 링크는 그대로 살아 있고, 서버가 대표 주소로 /card/를 가리킨다.
    const path =
      view !== 'cards'
        ? null
        : source === 'snkrdunk' && selectedCard
          ? // 스니커덩크 카드는 서버가 이름을 스스로 알아내므로 주소에 안 싣는다.
            // 주소창에서 그대로 복사해 붙이는 사람이 많은데, 한글이 %EB%A6%AC…로 늘어나면
            // 91자짜리 알 수 없는 주소가 된다.
            `/c/${selectedCard.apparelId}`
          : (source === 'cardboard' || source === 'cardboard_tcg') && boardSelectedCard
            ? `/card/${boardSelectedCard.tcgPlayerId}`
            : null;
    // 어느 탭에서 보고 있었는지. 주소 꼬리에 실어 받는 사람도 같은 탭으로 열리게 한다.
    const 마켓꼬리 = source === 'cardboard' ? 'e' : '';
    // ⚠️ ?notrack=1은 지운다. 예전엔 주소를 바꿀 때마다 통째로 날아가서, 운영자가
    //    확인하려고 붙인 notrack이 카테고리 한 번 누르면 풀렸다.
    //
    // ⚠️⚠️ **그런데 물음표 뒤를 통째로 들고 다녔다**(사장님 지적 2026-08-31).
    //    팝수 화면은 `/population?id=670191&lang=japanese`로 열리는데, 거기서 다른 화면을
    //    누르면 그 꼬리가 그대로 따라붙어 **`/sealed?id=670191&lang=japanese`**,
    //    **`/centering?id=670191&lang=japanese`**가 됐다. 미개봉 시세나 센터링에는
    //    아무 뜻도 없는 값이라, 그 주소를 복사해 남에게 보내면 지저분하기만 하다.
    //    → **가는 화면이 실제로 쓰는 값만 남긴다.** id·lang은 팝수 화면의 것이다.
    // ⚠️ **팝수 화면은 예외다.** id·lang이 그 화면의 재료라, 여기서 지우면 새로고침하거나
    //    주소를 복사해 다시 들어왔을 때 그 카드가 안 열린다(카드 상세 → 감정 수량 → 팝수).
    const 꼬리 = (가는곳: string) => {
      const 온것 = new URLSearchParams(window.location.search);
      const 남길것 = new URLSearchParams();
      if (온것.has('notrack')) 남길것.set('notrack', 온것.get('notrack') ?? '1');
      if (가는곳 === '/population') {
        for (const k of ['id', 'lang']) {
          const v = 온것.get(k);
          if (v) 남길것.set(k, v);
        }
      }
      // 카드 한 장 주소는 보던 탭(m)을 지킨다 — 위 설명 참고.
      if (가는곳.startsWith('/card/') && 마켓꼬리) 남길것.set('m', 마켓꼬리);
      const 남 = 남길것.toString();
      return 남 ? `?${남}` : '';
    };
    const cur = window.location.pathname;
    if (path) {
      // ⚠️ **경로만 견주면 안 된다.** 같은 카드에서 탭만 바꾸면 경로가 그대로라 주소를
      //    안 고쳤고, 이베이로 옮겨도 주소에 `?m=e`가 안 붙었다(2026-09-02 실측).
      //    물음표 뒤까지 넣어 견준다.
      const 갈곳 = path + 꼬리(path);
      if (cur + window.location.search !== 갈곳) {
        window.history.replaceState(window.history.state, '', 갈곳);
      }
      // 탭 제목도 그 카드로. 서버가 /c/<번호>에 붙이는 것과 같은 모양이다.
      const nm = selectedCard?.title ?? boardSelectedCard?.name ?? '';
      document.title = nm ? `${공유이름(nm)} 시세 | pokegre` : HOME_TITLE;
      return;
    }
    // 공유 링크로 막 들어와 카드를 되살리는 중이면 건드리지 않는다(주소가 먼저 지워진다).
    if (restoringShare) return;

    // 카드 화면이 아니면 지금 보고 있는 화면에 맞는 주소로 바꾼다.
    // ⚠️ 여기 없는 화면(마이페이지·운영자 화면)은 '/'로 둔다. 서버가 그 주소를 모르므로,
    //    주소만 만들어 두면 새로고침했을 때 홈이 떠서 "주소가 거짓말"이 된다.
    // ⚠️ 깊은 링크(/set/…·/series/…·/artist/…)로 들어온 사람의 주소는 그대로 둔다.
    //    안 그러면 검색으로 들어오자마자 주소가 목록으로 바뀌어 그 사람이 보던 자리를 잃는다.
    const deep =
      (view === 'sets' && /^\/(set|series)\//.test(cur)) ||
      (view === 'artists' && /^\/artist\//.test(cur)) ||
      // 게시판 글 하나(/community/12)도 깊은 링크다(2026-08-23). 안 빼두면 글을 여는
      // 순간 이 효과가 주소를 /community로 되돌려, 글마다 주소를 준 뜻이 사라진다.
      (view === 'community' && /^\/community\/\d+/.test(cur));
    // 깊은 링크는 주소도 제목도 서버가 붙여 준 것을 그대로 둔다.
    if (deep) return;
    const want = VIEW_PATH[view] ?? '/';
    if (cur !== want || window.location.search !== 꼬리(want))
      window.history.replaceState(window.history.state, '', want + 꼬리(want));
    document.title = VIEW_TITLE[view] ?? HOME_TITLE;
  }, [selectedCard, boardSelectedCard, view, source, restoringShare]);

  // ⚠️ "'저지맨' → 'ジャッジマン'로 검색했습니다" 안내를 뺐다(운영자 지시 2026-08-05).
  //    무슨 말로 바꿔 찾았는지는 우리 사정이지 보러 온 사람이 알아야 할 값이 아니다.
  //    그 자리는 "어느 마켓 값인지"가 쓴다 — 그게 실제로 값을 읽는 데 필요한 말이다.
  //    이걸 지우면서 사전(loadNameDict)을 화면에 미리 받을 이유도 없어졌다.
  const hasMore = !exhausted;
  // 한 글자만 친 상태도 홈으로 본다. 검색을 안 보내는데 결과 화면을 띄우면
  // "검색 결과가 없습니다"만 남아 홈이 무너진다(위 MIN_SEARCH_LEN 설명).
  // 홈은 **검색창이 비었을 때만** 보여준다.
  // ⚠️ 예전엔 "두 글자 미만이면 홈"이었다. 그래서 검색어를 지우거나 고쳐 쓰다 한 글자가
  //    되는 순간 홈이 통째로 튀어나왔다 사라졌다 — 인기 검색어·힛카드·상점이 한꺼번에
  //    깜빡였다(운영자 지적 2026-08-05). 한 글자로는 여전히 검색을 보내지 않지만
  //    (MIN_SEARCH_LEN), 화면은 검색 자리에 머문다.
  const isHome = query.trim().length === 0;
  // 아직 검색을 보내기엔 짧다. 결과 자리에 조용히 안내만 둔다.
  // ⚠️ 여기서 "검색 결과가 없습니다"를 띄우면 안 된다 — 찾아보지도 않고 없다고 하는 말이다.
  const tooShort = query.trim().length > 0 && query.trim().length < MIN_SEARCH_LEN;

  // 홈의 세로 간격은 여기 한 곳에서만 정한다(space-y-8 = 32px).
  //
  // 예전에는 구역마다 자기 바깥 여백을 들고 있었다(배너 mb-6, 상점 mt-8, 뉴스 mt-8 mb-6…).
  // 그래서 순서를 바꾸자마자 간격이 32/0/32로 어긋났다 — 상점 아래에 여백이 없고 인기
  // 검색어 위에도 없어서 둘이 딱 붙어 버렸다. 간격을 컨테이너가 쥐고 있으면 순서를 어떻게
  // 바꿔도 항상 같은 간격이 나온다. 구역 컴포넌트에는 바깥 여백을 넣지 말 것.
  const homeMain = (
    <div className="space-y-8">
      {/* ⚠️ 인기 검색어를 공지보다도 위로 올렸다(2026-08-04, 두 번째 조정).
          공지가 폰에서 420px을 써서, 인기 검색어 1위 줄이 화면 끝(812px)에 19px만
          걸쳐 잘렸다 — 통째로 보이는 순위가 한 칸도 없었다. 공지는 한 번 닫으면
          다시 안 뜨므로 이 벽을 맞는 사람은 정확히 "처음 온 사람"이다.
          공지를 없애거나 접지 않는다(운영자 결정) — 순서만 바꾼다. 조금만 내리면
          그대로 나오고, 내용은 한 글자도 안 줄었다. */}
      {/* ⚠️ 인기 검색어를 상점 위로 올렸다(2026-08-04).
          예전엔 상점이 위였는데(2026-07-26 결정), 그 사이 상점이 커져서 인기 검색어가
          폰에서 y=1909 — 2.4화면 아래로 밀렸다. 시세를 보러 온 사람에게 "뭘 검색할 수
          있는지"를 보여주는 자리라 검색창에서 멀면 뜻이 없다.
          그때 상점을 위에 둔 이유(폰에서 팩 사진이 잘린다)는 그대로 살아 있으므로,
          상점은 인기 검색어 바로 다음에 둔다 — 뉴스보다는 위다. */}
      {/* ⚠️⚠️ **홈 배너를 내렸다**(2026-08-27 사장님 지시 「홈 배너 없애줘」).
          이 자리는 배너 **하나만** 쓴다 — 되살릴 때는 아래 한 줄의 주석을 풀면 된다.
            · 의견함 FeedbackBanner — 접속 장애 사과 + 의견 받는 칸
          ⚠️⚠️ **「업데이트 내역」 배너(OnboardingBanner)는 아주 지웠다**(사장님 지시
             2026-09-04 「저거 배너 그냥 없애줘」). 8월 27일에 내려 둔 뒤로 한 번도
             안 띄웠고, 되살릴 자리도 아니다. 알릴 것이 생기면 홈 공지(`HomeNotice`)를
             쓴다 — 글·그림·켜고 끄기가 `src/data/homeNotice.json` 한 곳에 있다.
          ⚠️ 의견함은 **안 지웠다.** 서버 창구(/api/local/feedback)와 신고함의
             「의견함」 칸도 그대로 살아 있어, 전에 받은 의견은 계속 읽힌다. */}
      {/* <div className="mb-6"><FeedbackBanner /></div> */}
      {/* ⚠️ **인기 검색어를 신팩 힛카드보다 위로 올렸다**(2026-08-09 사장님 지시).
          2026-08-08에 반대로 올렸던 것을 되돌린 것이다. 그때 이유는 "첫 화면에 글자만
          보인다"였는데, 지금은 검색바 아래 바로 사람들이 뭘 찾는지가 보이는 쪽을 택했다.
          ⚠️ 다시 되돌리려면 이 <PopularSearches>와 아래 <NewSetHitCards>의 순서만
          맞바꾸면 된다. */}
      {/* ⚠️ 공지는 **검색창 바로 아래, 인기 검색어 위**다. 더 위(검색창 앞)에 두면
          시세를 보러 온 사람의 검색창이 밀린다 — 이 사이트에 오는 까닭의 79%가 시세다.
          글과 켜고 끄기는 `src/data/homeNotice.json`에 있다. */}
      <HomeNotice />
      <PopularSearches
        items={popularSearches}
        asOf={popularAsOf}
        loading={popularLoading}
        onSelect={(term) => {
          // 인기 검색어를 눌러 검색한 것도 "확정한 검색"이다 — 결과만 오면 바로 센다.
          confirmSearch(term, 'popular');
          setQuery(term);
        }}
      />
      {/* ⚠️⚠️ **홈 순서: 인기 검색어 → 최신 발매 박스 시세 → 오늘의 상점 TOP 5.**
          박스 시세를 TOP 5보다 **위로 올렸다**(사장님 지시 2026-09-04). 시세를 보러 온
          사람이 대부분이라(시세 검색 79% ↔ 뽑기 12%) 시세끼리 위에 모으는 편이 맞다.
          ⚠️⚠️ **신팩 힛카드 자리를 「최신 발매 박스 시세」로 바꿨다**(사장님 지시 2026-09-03:
          "요즘 사람들이 박스시세에 관심이 많거든", "힛카드 자리에 박스시세 대체").
          ⚠️ 힛카드 부품(NewSetHitCards)과 서버 창구(/api/local/latest-hit-set)는 **안 지웠다.**
             되살리려면 여기에 <NewSetHitCards …/>를 다시 넣으면 된다 — 오늘의 상점을
             홈에서 뺄 때와 같은 방식이다(그때도 부품을 남겨 뒀다).
          ⚠️ 누르면 **검색창에 친 것과 같은 길**을 탄다. 스니커덩크 일본어판으로 맞춘 뒤
             그 팩을 찾는다 — 이베이·TCGplayer 탭에서는 박스가 안 나온다. */}
      <BoxPrices
        onOpenPack={(q) => {
          if (source !== 'snkrdunk') setSource('snkrdunk');
          if (edition !== 'japanese') setEdition('japanese');
          confirmSearch(q, 'pick');
          setQuery(q);
        }}
      />
      {/* ⚠️ 커피값 상자(SupportBox)는 **뺐다**(사장님 지시 2026-08-12) — 카카오페이 송금
             링크가 모바일 사이트에서 열리지 않았다. 컴포넌트 파일은 남겨 두었으니
             쓸 만한 링크가 생기면 여기에 <SupportBox />만 되살리면 된다.
          ⚠️ 오늘의 상점은 「도구 ▾」로 옮겼지만 TOP 5는 홈에 남긴다 — 뽑기를 안 하는
             사람도 "다른 사람이 뭘 뽑았나"는 보게 된다. */}
      <PullBanner onEnter={() => navigate({ view: 'packsim' })} />
      {/* 광고 자리 — 승인 전엔 아무것도 안 그린다(src/lib/ads.ts). ?adtest=1로 미리보기 */}
      <AdSlot 형태="네모" 이름="홈" />
      {/* ⚠️ **곁다리 구역은 한 덩이로 묶는다.** 제목 크기만 낮춰서는 여러 구역이 여전히
          같은 간격으로 늘어서 보인다 — 위(시세)와 아래(그 밖)를 눈이 가르지 못한다.
          엷은 바탕과 위쪽 선으로 묶어 "여기부터는 곁다리"를 한눈에 알린다.
          기준은 실제 쓰임이다: 시세 검색 2,885회(79%) ↔ 뽑기 424회(12%).
          ⚠️ 오늘의 상점(PackShelfPromo)은 **홈에서 뺐다**(사장님 지시 2026-08-12).
             상단 「도구 ▾」로 옮겼다. 컴포넌트는 남겨 두었으니 되돌리려면 여기에
             <PackShelfPromo onEnter={() => navigate({ view: 'packsim' })} /> 만 넣으면 된다. */}
      <div className="mt-8 space-y-6 border-t border-neutral-200 pt-6">
        <PokemonNews items={news} loading={newsLoading} />
      </div>
    </div>
  );

  const myPageMain = (
    <MyPage
      loggedIn={loggedIn}
      nickname={nickname}
      createdAt={createdAt}
      onLogout={handleLogout}
      onRequestLogin={() => setLoginOpen(true)}
      onNicknameChange={setNickname}
      providers={providers}
      onProvidersChange={setProviders}
      recentlyViewed={recentlyViewed}
      favorites={favorites}
      recentMissing={recentMissing}
      favoritesMissing={favoritesMissing}
      selectedId={interestSelectedId}
      onSelect={handleSelectInterestCard}
      isFavorite={(id) => checkIsFavorite(id, favoriteRefs)}
      onToggleFavorite={handleToggleFavorite}
      onClearRecent={handleClearRecent}
      onClearFavorites={handleClearFavorites}
    />
  );

  const searchMain = (
    <>
      {loading && <p className="text-sm text-neutral-500 mb-3">검색 중...</p>}

      {tooShort ? (
        <p className="py-10 text-center text-sm text-neutral-400">두 글자 이상 입력하면 찾아 드립니다.</p>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm text-rose-500">{error}</p>
          {/* 버튼이 없으면 검색어를 지웠다 다시 쳐야 한다 — 인터넷이 잠깐 끊긴 것뿐인데도. */}
          <button
            type="button"
            onClick={() => setRetryTick((n) => n + 1)}
            className="mt-4 rounded-full bg-black px-5 py-2 text-sm font-semibold text-white"
          >
            다시 시도
          </button>
        </div>
      ) : !loading && items.length === 0 ? (
        // ⚠️ 예전엔 이 한 줄이 전부라 막다른 길이었다. 이베이·TCGplayer 쪽에는 이미
        //    안내와 버튼이 있는데 여기만 비어 있었다(2026-08-04).
        //    이미 받아 둔 인기 검색어를 같이 두면 새로 받는 것 없이 나갈 길이 생긴다.
        <div className="py-10">
          <p className="text-center text-sm text-neutral-400">'{query.trim()}'의 검색 결과가 없습니다.</p>
          <p className="mt-1 text-center text-xs text-neutral-400">
            이름 일부만 쳐도 됩니다. 카드 이름을 모르면 위 사진 버튼을 눌러 찾을 수 있습니다.
          </p>
          {popularSearches.length > 0 && (
            <div className="mx-auto mt-6 max-w-xl">
              <PopularSearches
                items={popularSearches}
                asOf={popularAsOf}
                loading={popularLoading}
                onSelect={(term) => {
                  confirmSearch(term, 'popular');
                  setQuery(term);
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          {boxResults.length > 0 && (
            <CardRow
              title="박스"
              items={boxResults}
              emptyText=""
              selectedId={selectedId}
              onSelect={handleSelectCard}
              isFavorite={(id) => checkIsFavorite(id, favoriteRefs)}
              onToggleFavorite={handleToggleFavorite}
            />
          )}

          {cardResults.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-500 mb-3">싱글카드</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {cardResults.map((card, i) => (
                  <div key={card.apparelId} className="contents">
                    {/* ⚠️ 광고는 **꽉 찬 두 줄 뒤**에 온다. 한 줄이 2→3→4장(폭에 따라)이라
                        경계가 4·6·8로 달라서, 폭마다 하나씩 두고 CSS로 맞는 것만 보인다
                        (사장님 지적 2026-08-21: "PC는 4장씩 1줄인데 6에서 끊으면 이상하다").
                        숨은 복제는 광고 요청을 안 낸다(AdSlot의 offsetWidth 검사). */}
                    {i === 4 && <AdSlot 형태="가로" 이름="검색-목록" className="col-span-full sm:hidden" />}
                    {i === 6 && <AdSlot 형태="가로" 이름="검색-목록" className="col-span-full hidden sm:block xl:hidden" />}
                    {i === 8 && <AdSlot 형태="가로" 이름="검색-목록" className="col-span-full hidden xl:block" />}
                  <CardTile
                    card={card}
                    selected={card.apparelId === selectedId}
                    onSelect={handleSelectCard}
                    isFavorite={checkIsFavorite(card.apparelId, favoriteRefs)}
                    onToggleFavorite={handleToggleFavorite}
                    onCompare={showCompare ? toggleCompare : undefined}
                    inCompare={compareCards.some((c) => c.apparelId === card.apparelId)}
                  />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 광고 자리 — 승인 전엔 아무것도 안 그린다(src/lib/ads.ts). ?adtest=1로 미리보기 */}
          {cardResults.length > 0 && <AdSlot 형태="가로" 이름="검색-끝" />}

          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 w-full rounded-lg border border-neutral-300 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {loadingMore ? '더 많은 페이지를 훑는 중...' : '결과 더 보기'}
            </button>
          )}
        </>
      )}
    </>
  );

  // ── 새 길(cardboard) 결과 ──────────────────────────────────────────────────
  //
  // ⚠️ **부품은 옛 길 것을 그대로 쓴다**(EbayCardTile · EbayCardDetail). 사장님 지시가
  //    "기존에 나오는거랑 형태는 똑같이"라, 겉모습을 새로 그리면 무엇이 달라졌는지
  //    견줄 수가 없다. 다른 것은 **어떻게 찾았나**뿐이다.
  const boardMain = (
    <>
      {/* ⚠️ 「몇 장 중 몇 장」을 안 적는다 — **찾은 것이 다 나와 있기 때문**이다.
          잘린 때(2,000장 천장)만 아래 줄로 따로 밝힌다. */}
      <p className="text-sm text-neutral-500 mb-3">
        {boardLoading ? '찾는 중...' : `우리 도감에서 ${boardTotal.toLocaleString()}장 찾았습니다.`}
      </p>

      {/* ⚠️ **값이 언제 것인지 밝힌다.** 이 길은 실시간이 아니라 받아 둔 덤프를 읽는다 —
          안 밝히면 지금 시세로 오해한다. 옛 길은 크레딧을 다 썼을 때만 이 안내를 냈지만,
          여기는 **늘 받아 둔 값**이라 늘 밝히는 것이 맞다.
          ⚠️ **모르는 날짜는 아예 안 적는다.** 「날짜 모름」이라고 적으면 값까지 못 믿을 것처럼
             읽힌다 — 아는 것만 적고, 하나도 모르면 이 줄을 안 그린다. */}
      {!boardLoading &&
        (() => {
          const 적을것 = [
            board받은날?.시세 ? `TCGplayer 시세 ${board받은날.시세}` : '',
            board받은날?.낙찰 ? `eBay 낙찰 ${board받은날.낙찰}` : '',
          ].filter(Boolean);
          if (!적을것.length) return null;
          return <p className="mb-3 text-xs text-neutral-400">{적을것.join(' · ')} 기준으로 받아 둔 값입니다.</p>;
        })()}

      {!boardLoading && boardItems.length === 0 ? (
        <div className="py-12 text-center">
          {/* ⚠️ 옛 길과 **없는 까닭이 다르다.** 저쪽에 안 물어봤으므로 "이베이에 없다"가
              아니라 **우리 도감에 그 이름이 없다**는 뜻이다. 그대로 말해 준다. */}
          <p className="text-sm text-neutral-500">우리 도감에 그 이름의 카드가 없습니다.</p>
          {/* ⚠️ 여기도 마디로 묶는다 — 안 묶으면 폰에서 「…기타 / 언어판)을 바꿔 보세요」로
              괄호 안이 갈린다(위 설명과 같은 까닭). */}
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-neutral-400">
            <span className="inline-block">카드 이름의 일부만 쳐 보시거나,</span>{' '}
            <span className="inline-block">위에서 판(일본어판·영문판·기타 언어판)을 바꿔 보세요.</span>
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {boardItems.map((card, i) => (
              <div key={card.tcgPlayerId} className="contents">
                {i === 4 && <AdSlot 형태="가로" 이름="검색-목록" className="col-span-full sm:hidden" />}
                {i === 6 && <AdSlot 형태="가로" 이름="검색-목록" className="col-span-full hidden sm:block xl:hidden" />}
                {i === 8 && <AdSlot 형태="가로" 이름="검색-목록" className="col-span-full hidden xl:block" />}
              <EbayCardTile
                card={card}
                variant={board마켓}
                selected={card.tcgPlayerId === boardSelectedId}
                onSelect={setBoardSelectedId}
                // ⚠️ 비교표는 **등급별 표**라 eBay 눈일 때만 붙인다(TCGplayer 눈에는 등급이 없다).
                //    옛 탭이 `!isTcg`로 하던 것과 같은 판단이다.
                onCompare={board마켓 === 'ebay' && showCompare ? toggleCompareEbay : undefined}
                inCompare={compareEbay.some((c) => c.tcgPlayerId === card.tcgPlayerId)}
              />
              </div>
            ))}
          </div>
          <AdSlot 형태="가로" 이름="검색-끝" />

          {/* ⚠️ **「더 보기」는 없다 — 찾은 것이 이미 다 나와 있다.**
              천장(2,000장)에 걸린 때만 그렇다고 밝힌다. 말없이 자르면 「이게 전부」로 읽힌다.
              여기 걸리는 것은 「ex」·「에너지」처럼 카드 이름이 아닌 말뿐이라, 이름을 더
              붙이라고 일러 준다(그게 실제로 원하는 카드에 닿는 길이다). */}
          {board잘림 > 0 && (
            <p className="mt-4 rounded-lg bg-neutral-50 px-3 py-3 text-center text-xs leading-relaxed text-neutral-500">
              걸린 카드가 너무 많아 {board잘림.toLocaleString()}장까지만 보여 드립니다. 카드 이름을 더 붙이면 원하는
              카드가 나옵니다.
            </p>
          )}
        </>
      )}
    </>
  );

  // ⚠️⚠️ **비교 담기 바가 카드 상세 시트의 맨 아랫줄을 덮고 있었다**(2026-08-14에 찾음).
  //    둘 다 `fixed bottom-0`에 z-40인데 바가 DOM에서 뒤라 시트 위에 그려진다. 시트 안쪽
  //    여백은 32px인데 바가 63px이라, 끝까지 내려도 **마지막 31px이 영영 안 보였다**
  //    (실측: 바 위 749px · 시트 마지막 글 아래 780px. 「원화는 … 참고값입니다」가 반쯤 잘림).
  //    ⚠️ 미스클릭은 아니었다 — 바의 단추는 제대로 눌린다. 문제는 **가려진 글**이다.
  //    ⚠️ 「오늘의 상점 하단 바」와는 **원리상 겹칠 수 없다**(다른 화면이고, 상시 바가 아니라
  //       구매 알림 토스트다). 「셋이 겹친다」는 말은 사실이 아니다.
  const 비교바높이 = 63; // p-3(12+12) + 단추 39 — 바 높이를 바꾸면 여기도 바꿀 것
  const 비교바떴나 =
    showCompare &&
    ((source === 'snkrdunk' && compareCards.length > 0) || (source === 'cardboard' && compareEbay.length > 0));
  const 시트아래막힘 = 비교바떴나 ? 비교바높이 : 0;

  return (
    <div className="min-h-screen bg-neutral-100">
      <AdRails />
      <div className="mx-auto max-w-6xl bg-white border-x border-neutral-200 min-h-screen">
        <header className="border-b border-neutral-200 bg-white">
          <div className="px-4 py-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              {/* 카드 상세 시트가 열리면 이 덩어리를 접는다(index.css의 [data-sheet]).
                  폰에서 시트가 올라올 자리를 늘리려는 것이고, 아래 메뉴 줄은 남긴다. */}
              <div className="header-brand">
                {/* 로고를 누르면 처음 화면(카드 시세 홈)으로. 검색·선택을 비우고 맨 위로
                    올린다. 사이트 아무 데서나 "처음으로" 돌아오는 흔한 길이다. */}
                <h1 className="text-xl font-extrabold text-black tracking-tight">
                  <button type="button" onClick={goHome} className="hover:opacity-70">
                    pokegre
                  </button>
                </h1>
                {/* 헤더는 "여기가 뭐 하는 곳"인지만 짧게 알린다. 소스(스니덩크·이베이)나
                    시세 읽는 법 같은 상세는 커뮤니티 이용안내 공지가 대신한다. */}
                {/* ⚠️ 이 문구는 운영자가 정한 것이다. 손대지 말 것.
                    2026-08-04에 "일본·북미 포켓몬 카드 시세"로 바꿨다가 되돌렸다 —
                    "홈에 시세라는 말이 없다"는 비평만 보고, 이게 얼마 전에 운영자가
                    직접 고른 말이라는 걸 확인하지 않았다. 문구를 바꾸자는 제안이 와도
                    이 줄은 먼저 물어볼 것. */}
                <p className="text-sm text-neutral-500 mt-1">포켓몬 카드의 모든 것</p>
              </div>
              {/* 상단은 최상위 4개(카드 시세·더보기·커뮤니티·마이페이지)로 못박는다.
                  새 도구가 생기면 "더보기" 드롭다운으로 흡수해 상단 폭이 안 늘어나게 한다.
                  드롭다운은 뒤에 깔린 백드롭 클릭으로 닫는다(z-index만으로 처리, 문서 리스너 없음). */}
              {openMenu && (
                <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} aria-hidden />
              )}
              {/* 좁은 화면에서 메뉴 글자가 단어 중간에 꺾이지 않게, 버튼 단위로만 줄바꿈한다.
                  relative z-50 으로 버튼이 백드롭 위에 오게 해 클릭이 통한다. */}
              {/* ⚠️⚠️ **폰에서는 메뉴 줄이 통째로 아래로 내려온다**(위 덩어리가 flex-wrap).
                  그때 `w-auto`면 줄이 286px에서 끝나 **오른쪽에 72px이 빈다.** 운영자에게는
                  거기 「운영 ▾」가 들어가 안 보이지만, **일반 사용자 화면에서는 그냥 빈칸**이다
                  (사장님 지적 2026-08-16 · 375px에서 실측). 줄을 꽉 채우고 아래 사람 아이콘을
                  `ml-auto`로 오른쪽 끝에 붙인다 — 계정 단추가 오른쪽 끝인 것은 흔한 꼴이고,
                  운영 메뉴가 있든 없든 자리가 안 흔들린다.
                  ⚠️ 넓은 화면(sm↑)은 로고와 한 줄을 나눠 쓰므로 `w-auto`로 되돌린다. */}
              <nav
                /* ⚠️ 일반 사용자는 상단이 넷+아이콘이라 왼쪽에 몰리면 오른쪽이 허전하다
                   (운영자는 「운영」까지 다섯이라 몰아 두는 게 맞다 — 사장님 지시 2026-08-20).
                   운영 메뉴가 없을 때만 폰에서 고르게 벌린다. sm부터는 원래대로 왼쪽 정렬. */
                className={`relative z-50 flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:gap-2 ${
                  isAdmin || 개발중 ? '' : 'justify-between sm:justify-start'
                }`}
              >
                {/* ⚠️ navigate만 부르면 **이미 시세 화면일 때 아무 일도 안 한다**. 공유
                    링크로 들어와 카드를 보다가 "홈"을 눌러도 그 카드에 갇혔다(점검 중
                    발견 2026-08-06). 검색 중에 눌러도 마찬가지였다. 로고(pokegre)와
                    같은 goHome을 써서 검색어·고른 카드까지 비운다. */}
                <button
                  type="button"
                  onClick={goHome}
                  className={`whitespace-nowrap rounded-full px-3 py-2.5 text-sm font-semibold sm:px-4 ${
                    view === 'cards' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  홈
                </button>
                {/* 상단은 최상위 5개다(홈·찾아보기·도구·커뮤니티·프로필 아이콘).
                    ⚠️ 핸드폰(375px)에서 담는 곳이 334px뿐이라 **글자 메뉴 다섯 개는
                       안 들어간다**(실측: 「마이페이지」를 글자로 두면 377px로 43px
                       넘친다). 마이페이지를 아이콘으로 줄여 296~321px에 맞췄다.
                       메뉴를 더 늘리려면 폭부터 재고 늘려야 한다.
                    묶는 기준: **찾아보기**는 카드를 어떤 기준으로 찾아 들어가는 길,
                    **도구**는 카드를 재고 따져 보는 것. 오늘의 상점은 게임이라 여기
                    두지 않고 홈 배너를 입구로 쓴다. */}
                {/* ⚠️ **드롭다운은 핸드폰에서 왼쪽으로 열린다.** 예전엔 right-0에 폭이 w-40으로
                    고정이라, 375px 화면에서 단추 오른쪽 끝이 140px이면 패널 왼쪽이 **-20px**로
                    나가 글자가 잘렸다(2026-08-07 실측). 글자 길이와 상관없는 자리 문제였다.
                    이제 좁은 화면에서는 왼쪽 기준으로 열고, 폭은 내용에 맞추되 화면을
                    넘지 않게 묶는다. 넓은 화면(sm~)은 예전처럼 오른쪽 기준이다. */}
                {([
                  {
                    key: 'find' as const,
                    // ⚠️ **부모가 "도감"이라 자식은 한 낱말이면 된다.**
                    //    "도감 → 포켓몬"으로 읽힌다. 예전엔 부모가 "찾아보기"라
                    //    자식마다 "…별 목록"을 붙여야 했고, 그중 "포켓몬·트레이너"만
                    //    꼴이 달라 무엇을 주는 자리인지 안 읽혔다 — 같은 메뉴 안의
                    //    세트별이 하루 55회 열릴 때 이건 **이틀 내내 0회**였다
                    //    (2026-08-07 운영 기록 확인. 집계 자체는 정상이었다).
                    //    상단 폭도 25px 아낀다(핸드폰 310px → 285px, 여유 24 → 49px).
                    //    ⚠️ 화면 안 제목은 "포켓몬·트레이너·에너지별 카드" 그대로 둔다 —
                    //       메뉴는 짧게, 들어가면 정확하게.
                    //    ⚠️ 브라우저 탭 제목(`pokedex:` 위쪽)은 **안 건드린다** — 검색에
                    //       걸리는 글이라 함부로 바꾸면 노출이 흔들린다(홍보팀 몫).
                    label: '도감',
                    items: [
                      // ⚠️ **베타 배지는 뗐다.** 넷 중 넷이 베타라 배지가 뜻을 잃었고,
                      //    오히려 "아직 덜 됐나 보다" 싶어 안 누르게 만든다(2026-08-08).
                      //    다시 붙일 일이 있으면 beta: true 한 줄이면 된다.
                      // ⚠️ 차례는 **포켓몬 · 작가 · 세트**다(2026-08-09 사장님 지시).
                      //    앞의 둘은 생김새가 같은 화면이라 붙여 두고, 성격이 다른
                      //    세트를 뒤에 둔다.
                      { v: 'pokedex', label: '포켓몬' },
                      { v: 'artists', label: '작가' },
                      { v: 'sets', label: '세트' },
                      // 미개봉(박스·팩) 시세 모음. 세트마다 흩어 두지 말고 한곳에서
                      // 줄 세워 보게 하라는 지시(2026-08-11)로 도감 갈래에 두었다.
                      // ⚠️ 「미개봉 시세」가 아니라 **「미개봉 박스·팩」**이다(사장님 지시
                      //    2026-08-14: "미개봉 시세가 좀 애매해"). 이 사이트는 전체가
                      //    시세라 메뉴에서 「시세」는 알려 주는 게 없고, 정작 **안에 뭐가
                      //    있는지**가 빠져 있었다(부스터 박스·부스터 팩·엘리트 트레이너 박스).
                      //    ⚠️ 검색엔진용 제목·설명(App.tsx의 `sealed` 제목, server/index.ts)에는
                      //       **「미개봉 시세」를 그대로 둔다** — 사람들이 그 말로 검색한다.
                      { v: 'sealed', label: '박스·팩' },
                    ],
                  },
                  {
                    key: 'tools' as const,
                    label: '도구',
                    items: [
                      // ⚠️ 도감 쪽과 마찬가지로 **한 낱말**로 맞춘다. 무엇을 하는지는
                      //    들어가면 바로 아래 한 줄로 설명한다 — 메뉴에 설명을 넣으면
                      //    길어지기만 한다.
                      // ⚠️ 오늘의 상점을 홈에서 여기로 옮겼다(사장님 지시 2026-08-12).
                      //    홈은 시세를 보러 오는 자리인데(시세 검색 2,885회 ↔ 뽑기 424회)
                      //    상점이 한 칸을 크게 먹고 있었다. 메뉴에 두면 찾는 사람은 찾는다.
                      { v: 'packsim', label: '오늘의 상점' },
                      // ⚠️ **메뉴는 「미니게임」이다 — 게임 이름이 아니라 자리 이름이다.**
                      //    게임이 늘어날 자리라(사장님 2026-08-18), 게임 이름을 메뉴에 쓰면
                      //    둘째 게임 때 메뉴를 갈아야 하고 그때 방문자가 익숙해진 자리가 바뀐다.
                      //    게임 이름(포켓몬 디펜스)은 화면 안 제목에 있다.
                      { v: 'pokedefense', label: '미니게임' },
                      { v: 'population', label: '팝수' },
                      // ⚠️ 「센터링」이 아니라 **「센터링 측정」**이다(2026-08-14). 눌러서 뭘
                      //    하는지가 이름에 있어야 한다. 화면 제목·페이지 제목·통계 항목·
                      //    검색엔진 설명이 **이미 다 「센터링 측정」**이라, 메뉴만 짧아서
                      //    혼자 달랐다. 「계산기」로 하자는 안이 있었지만 사진으로 재는
                      //    것이라 「측정」이 맞고, 낱말을 하나 더 만들 이유도 없다.
                      { v: 'centering', label: '센터링 측정' },
                    ],
                  },
                ] as { key: 'find' | 'tools'; label: string; items: { v: MainView; label: string; beta?: boolean }[] }[]).map(
                  (그룹) => (
                    <div className="relative" key={그룹.key}>
                      <button
                        type="button"
                        onClick={() => setOpenMenu(openMenu === 그룹.key ? null : 그룹.key)}
                        className={`whitespace-nowrap rounded-full px-3 py-2.5 text-sm font-semibold sm:px-4 ${
                          그룹.items.some((it) => it.v === view)
                            ? 'bg-black text-white'
                            : 'text-neutral-600 hover:bg-neutral-100'
                        }`}
                      >
                        {그룹.label} <span className="text-[10px]">▾</span>
                      </button>
                      {openMenu === 그룹.key && (
                        <div className="absolute left-0 z-50 mt-1 w-max min-w-40 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg sm:left-auto sm:right-0">
                          {그룹.items.map((it) => (
                            <button
                              key={it.v}
                              type="button"
                              onClick={() => {
                                navigate({ view: it.v });
                                setOpenMenu(null);
                              }}
                              className={`block w-full px-4 py-2 text-left text-sm font-semibold ${
                                view === it.v ? 'text-black' : 'text-neutral-600 hover:bg-neutral-50'
                              }`}
                            >
                              {it.label}
                              {it.beta && <span className="ml-1 text-[10px] text-amber-500">베타</span>}
                            </button>
                          ))}
                          {/* ⚠️⚠️ 화면 색 단추는 여기 하나뿐이다(머리말에도 마이페이지에도
                              없다). **위 항목들은 다 「다른 화면으로 가는」 것이고 이것만
                              그 자리에서 색을 바꾼다** — 그래서 줄을 그어 갈라 놓는다.
                              까닭과 지금까지 옮겨 다닌 자취는 ThemeToggle.tsx에 적어 뒀다. */}
                          {그룹.key === 'tools' && (
                            <>
                              <div className="my-1 border-t border-neutral-200" />
                              <ThemeToggle onDone={() => setOpenMenu(null)} />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => navigate({ view: 'community' })}
                  className={`whitespace-nowrap rounded-full px-3 py-2.5 text-sm font-semibold sm:px-4 ${
                    view === 'community' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  {/* ⚠️ 「커뮤니티」가 아니라 **「게시판」**이다(사장님 지시 2026-08-20).
                      화면 안(전체 게시판·자유게시판)이 이미 게시판이라 이름이 이어진다.
                      코드 열쇠(community)·주소(/community)·통계 이름은 그대로 둔다. */}
                  게시판
                </button>
                {/* 운영: 운영자 전용 화면(신고함·통계)을 드롭다운 하나로 묶어 상단을 깔끔히 둔다.
                    실제 차단은 서버가 한다 — 주소를 직접 쳐도 데이터를 안 준다. */}
                {(isAdmin || 개발중) && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === 'admin' ? null : 'admin')}
                      className={`whitespace-nowrap rounded-full px-3 py-2.5 text-sm font-semibold sm:px-4 ${
                        view === 'reports' || view === 'stats' || view === 'scantest' || view === 'flea' || view === 'ebaycheck'
                          ? 'bg-black text-white'
                          : 'text-neutral-600 hover:bg-neutral-100'
                      }`}
                    >
                      운영 <span className="text-[10px]">▾</span>
                    </button>
                    {openMenu === 'admin' && (
                      <div className="absolute right-0 z-50 mt-1 w-32 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
                        {([
                          { v: 'reports', label: '신고함' },
                          { v: 'stats', label: '통계' },
                          { v: 'flea', label: '플리마켓' },
                          { v: 'scantest', label: '스캔 테스트' },
                          { v: 'ebaycheck', label: '이베이 검수' },
                        ] as { v: MainView; label: string }[]).map((it) => (
                          <button
                            key={it.v}
                            type="button"
                            onClick={() => {
                              navigate({ view: it.v });
                              setOpenMenu(null);
                            }}
                            className={`block w-full px-4 py-2 text-left text-sm font-semibold ${
                              view === it.v ? 'text-black' : 'text-neutral-600 hover:bg-neutral-50'
                            }`}
                          >
                            {it.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* 로그인 버튼을 헤더에 두면 공급자가 늘 때마다(네이버 등) 자리가 모자란다.
                    진입점을 마이페이지 한 곳으로 모으고, 헤더엔 상태만 드러낸다. */}
                {/* ⚠️ 글자가 아니라 **아이콘**이다. 핸드폰(375px)에서 메뉴 담는 곳이
                    334px뿐인데 「마이페이지」를 글자로 두면 다섯 개가 377px이 되어
                    43px 넘친다(실측 2026-08-07). 아이콘이면 296~321px로 들어간다.
                    닉네임을 글자로 보여 주던 것도 여기서 사라진다 — 대신 로그인하면
                    닉네임 첫 글자를 동그라미에 넣어, 로그인했다는 것이 보이게 한다.
                    ⚠️ 아이콘만 있으면 화면 읽기 프로그램에는 "버튼"으로만 읽힌다.
                       aria-label·title을 꼭 남겨 둘 것. */}
                <button
                  type="button"
                  onClick={() => navigate({ view: 'mypage' })}
                  aria-label={loggedIn ? `마이페이지 (${nickname ?? '로그인됨'})` : '마이페이지'}
                  title={loggedIn ? (nickname ?? '마이페이지') : '마이페이지'}
                  /* ⚠️ `ml-auto`는 **운영자일 때만** — 일반 사용자는 nav가 justify-between으로
                     고르게 벌리는데, auto 여백이 있으면 남는 자리를 혼자 다 먹어 도로 몰린다. */
                  className={`${isAdmin || 개발중 ? 'ml-auto sm:ml-0' : ''} grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-sm font-semibold ${
                    view === 'mypage' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  {/* ⚠️⚠️ **로그인해도 그림은 그대로고, 초록 점만 붙는다**(사장님 결정 2026-08-16).
                      예전엔 닉네임 첫 글자를 동그라미에 넣었는데 **글자마다 폭이 달라**
                      「W」·「ㅋ」가 어색하고 이모지 닉네임은 아예 깨졌다. 모양이 늘 같아야
                      상단바가 안 흔들린다.
                      ⚠️ 점 테두리는 `border-white`다 — 다크모드에서 `--color-white`가
                         `#1a1a1a`로 바뀌어 머리말 바탕과 저절로 맞는다. */}
                  <span className="relative grid place-items-center">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
                    </svg>
                    {loggedIn && (
                      <span
                        aria-hidden
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500"
                      />
                    )}
                  </span>
                </button>
              </nav>
            </div>
          </div>
        </header>

        <main className="px-4 py-6">
          {/* 부화면(커뮤니티·센터링·작가·세트 등)은 눌렀을 때 내려받는다(lazy).
              첫 화면(카드 시세)이 그만큼 가벼워진다. */}
          {/* 화면별로도 한 겹 더 감싼다. 안쪽에서 터졌을 때 상단 메뉴까지 사라지면
              다른 화면으로 옮겨갈 방법이 없어진다. */}
          <ErrorBoundary>
          <Suspense fallback={<p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>}>
          {view === 'reports' ? (
            <div className="space-y-10">
              <ReportInbox />
              <TitleFeedbackList />
            </div>
          ) : view === 'stats' ? (
            <VisitStats />
          ) : view === 'flea' ? (
            <FleaAdmin />
          ) : view === 'scantest' ? (
            <ScanTest />
          ) : view === 'ebaycheck' ? (
            <EbayCheckView />
          ) : view === 'pokedefense' ? (
            <PokeDefense />
          ) : view === 'packsim' ? (
            <PackSim
              onPickCard={(t) => {
                setBackToPacksim(true);
                navigate({ view: 'cards', source: t.source, query: t.query, edition: t.edition });
              }}
              onOpenSet={(slug) => {
                setSetsInitialSlug(slug);
                navigate({ view: 'sets' });
              }}
              onRequestLogin={() => setLoginOpen(true)}
            />
          ) : view === 'sets' ? (
            <SetsView
              initialSlug={setsInitialSlug}
              /* ⚠️ 주소는 인코딩된 채로 온다(%E5%89%A3%E3%81%A8%E7%9B%BE). 시리즈 슬러그는
                  일본어라 그대로 견주면 일본어판 13개가 통째로 안 걸린다 — 탭만 바뀌고
                  그 시리즈로 내려가지 않았다(2026-08-07 점검 중 발견). 풀어서 넘긴다. */
              initialSerie={(() => {
                const raw = window.location.pathname.match(/^\/series\/([^/?#]+)/)?.[1];
                if (!raw) return null;
                try {
                  return decodeURIComponent(raw);
                } catch {
                  return raw;
                }
              })()}
              onInitialSlugDone={() => setSetsInitialSlug(null)}
              onPickCard={카드로가기}
            />
          ) : view === 'community' ? (
            <Community
              loggedIn={loggedIn}
              isAdmin={isAdmin}
              onRequestLogin={() => setLoginOpen(true)}
              initialPostId={postInitialId}
              onInitialPostDone={() => setPostInitialId(null)}
            />
          ) : view === 'centering' ? (
            <CenteringTool onSearchByPhoto={searchByPhoto} />
          ) : view === 'sealed' ? (
            <SealedPricesView
              onOpenSet={(slug) => {
                setSetsInitialSlug(slug);
                navigate({ view: 'sets' });
              }}
            />
          ) : view === 'population' ? (
            // 카드 상세의 "감정 수량"을 눌러 들어오면 ?id=…&lang=… 이 붙는다.
            // 그때는 찾기 단계를 건너뛰고 그 카드 등급표를 바로 연다.
            <PopulationView 처음카드={(() => {
              const q = new URLSearchParams(window.location.search);
              const id = q.get('id')?.trim();
              return id ? { id, lang: q.get('lang') ?? undefined } : null;
            })()} />
          ) : view === 'artists' ? (
            <ArtistsView onPickCard={카드로가기} />
            ) : view === 'pokedex' ? (
              // ⚠️ 이름만 넘기면 "개굴닌자"로 72장이 다 나온다. 세트·번호·판까지 넘겨
              //    그 한 장을 찾는다(카드로가기 → lib/pokedexRoute.ts).
              <PokedexView onPickCard={카드로가기} />
          ) : view === 'mypage' ? (
            <DetailLayout
              main={myPageMain}
              detail={interestSelectedCard ? <CardDetail card={interestSelectedCard} /> : null}
              onCloseDetail={() => setInterestSelectedId(null)}
            />
          ) : (
            <>
              {/* 팩 개봉 앨범에서 "시세 보기"로 넘어온 경우, 되돌아갈 길을 만들어 준다
                  (브라우저 뒤로가기만으론 앨범으로 돌아가는 걸 모르는 사람이 많다). */}
              {backToPacksim && (
                <button
                  type="button"
                  onClick={() => navigate({ view: 'packsim' })}
                  className="mb-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
                >
                  ← 앨범으로 돌아가기
                </button>
              )}
              {/* ⚠️ 검색창을 가운데로 놓는다(2026-08-05 운영자 지시). 예전엔 max-w-xl만
                  걸어 왼쪽에 붙어 있었고, 넓은 화면에서는 오른쪽 절반이 통째로 비었다.
                  이 사이트에서 제일 많이 쓰는 것이 검색이라 눈이 가는 자리에 둔다. */}
              {/* ⚠️ 넓은 화면에서는 더 넓게 쓴다. 768px로 묶여 있어 1,150px 본문에서 검색칸이
                  632px뿐이었다 — **제일 많이 쓰는 기능인데(시세 검색 2,885회) 제일 작았다**
                  (2026-08-08 실측). 좁은 화면은 그대로다. */}
              <div className="mx-auto mb-4 max-w-3xl lg:max-w-5xl">
                {/* ⚠️⚠️ **탭 막대는 2026-08-13에 없앴다. 마켓 칩 하나로 고른다.**
                    2026-08-09에 「일본 매물 / 해외 시세」로 가른 까닭은 **통하는 말의 꼴이
                    달라서**였다 — 옛 해외 시세는 저쪽(PPT)에 매물을 물어봐서 영문 이름이
                    있어야 했고, "리자몽 MUR"을 그대로 보내면 늘 0건이었다.
                    그 까닭이 사라졌다: 새 길은 **우리 도감을 한글·영문 이름으로** 뒤지고,
                    스니커덩크도 두 꼴을 다 알아듣는다. 실측(2026-08-13, 스니커덩크에서):
                    리자몽 23장 · Charizard 23장 · Charizard 136 1장 · 리자몽 SAR 6장 ·
                    M6 113 1장 · 피카츄 24장 — **한 검색어가 세 마켓에 다 통한다.**
                    → 고르는 자리가 둘(탭·칩)이면 서로 어긋나기만 한다. 칩만 남긴다
                    (사장님 지시: "어차피 호환이 되는거면 … 마켓 교체 토글로만 바꾸게 해줘").
                    ⚠️ 갈랐던 것을 되돌리는 것이라, 되살릴 생각이 들면 **위 실측부터 다시
                       재 볼 것** — 까닭이 아니라 숫자가 정한다. */}
                {/* ⚠️ `relative` — 아래 스캔 오류를 **띄워서**(absolute) 붙이려고 있다. */}
                <div className="relative flex gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchBar
                      source={source}
                      onSourceChange={switchSource}
                      // 세 마켓을 한 자리에서 고른다. 검색어는 **그대로 이어진다** —
                      // 마켓을 바꿔도 새로 칠 일이 없다(위 탭 막대 주석의 실측 참고).
                      sources={['snkrdunk', 'cardboard', 'cardboard_tcg']}
                      value={보일검색어}
                      onChange={(v) => {
                        setQuery(v);
                        // 직접 타이핑하면 방금 스캔 맥락은 끝난 것 — 신고 링크·백업·오류를 거둔다.
                        setScannedResult(null);
                        setScanFailed(false);
                        scanFallbackRef.current = null;
                        setScanFellBack(false);
                        // 손으로 고쳤으면 도감에서 쫓던 카드도 놓아준다. 안 그러면
                        // 사람이 친 글자 대신 카드 이름이 계속 보인다.
                        pokedexPickRef.current = null;
                        자동이동ref.current = false;
                        set도감안내(null);
                      }}
                      // ⚠️ 지우기(x)는 검색어만 비우는 게 아니라 **홈으로 되돌린다**
                      //    (운영자 지시 2026-08-05). 검색어만 비우면 골라 둔 카드·사진
                      //    검색 맥락·방문기록에 적힌 검색어가 남아, 홈으로 가려면 새로고침을
                      //    해야 했다. goHome은 그 넷을 한 번에 되돌린다.
                      onClear={() => {
                        // 스캔 자취 치우기는 goHome이 한다(나가는 길을 한 곳으로 모았다).
                        setSuggestionsOpen(false);
                        goHome();
                      }}
                      onFocus={() => {
                        setSuggestionsOpen(true);
                        // 검색창을 누르는 순간 이름 사전을 미리 받아 둔다. 실제로
                        // 검색을 누를 때쯤이면 이미 와 있어서 기다림이 없다.
                        warmNameDict();
                      }}
                      onBlur={() => setSuggestionsOpen(false)}
                      onSubmit={() => {
                        // 엔터(폰 키보드의 "검색")도 확정이다. 예전엔 자동완성만 닫고 끝이라
                        // 집계에 아무 영향이 없었다.
                        setSuggestionsOpen(false);
                        // ⚠️ **친 말이 세트 이름이면 코드를 떼고 검색한다.** 예전엔 여기서도
                        //    세트 화면으로 보냈는데(2026-08-09), 시세를 찾으러 검색창을 쓴
                        //    사람에게 카드 목록이 나오는 건 말이 안 된다(사장님 지적
                        //    2026-09-03). 추천을 누르는 쪽(handleSelectSuggestion)과 **같은
                        //    길을 타야 한다** — 한쪽만 고치면 엔터로 친 사람만 딴 데로 간다.
                        const 친말 = 세트검색말(query.trim());
                        if (친말 !== query.trim()) setQuery(친말);
                        confirmSearch(친말, 'enter');
                      }}
                      onKeyNav={handleSuggestKey}
                    >
                      {suggestionsOpen && (
                        <SearchSuggestions
                          items={suggestions}
                          active={suggestActive}
                          onSelect={handleSelectSuggestion}
                        />
                      )}
                    </SearchBar>
                  </div>
                  {/* 영문판(영문) 카드는 SNKRDUNK에 없으니 이베이로 보내고, 일본어·한국어
                      카드는 지금 보던 소스를 유지한다. 소스에 맞는 검색어를 고른다 —
                      SNKRDUNK는 세트+번호(확실), 이베이는 영어 이름+번호. */}
                  <CardScanButton
                    // 모델이 사진을 읽는 동안 이름 사전을 미리 받아 둔다(뒤처리 1~2초 절감).
                    onStart={() => void warmNameDict()}
                    onResult={({ result }) => void applyScanWithLookup(result)}
                    onError={setScanFailed}
                    failed={scanFailed}
                  />
                </div>
                {/* ⚠️ 스캔 안내 세 줄은 여기(검색창 바로 아래)에 있었는데, 뜰 때마다
                    검색창과 판 토글을 갈라놓아 붙어 있어야 할 두 줄이 떨어졌다
                    (운영자 지적 2026-08-06 — "검색바랑 토글은 계속 붙어있는 게 이쁘다").
                    아래 토글 줄 다음으로 옮겼다 — 셋 다 "이 검색 결과가 왜 이런지"를
                    말하는 글이라, 결과 바로 위가 오히려 제자리다. */}
              </div>

              {/* ⚠️ 탭에 적힌 건 외국 상호 세 개뿐이고 어디 시세인지 설명이 한 줄도
                  없었다(마우스를 올려도 아무 말이 안 뜬다). 처음 온 사람은 무엇을 고르는
                  것인지 알 길이 없다(2026-08-04). 아래 여백을 mb-6에서 mb-1로 줄이고
                  그 자리에 설명 줄을 넣어, 높이는 오히려 짧아지면서 뜻이 생긴다. */}
              {/* 검색창과 같은 폭·같은 가운데 정렬로 묶는다. 따로 놀면 검색창만
                  가운데고 토글은 왼쪽에 붙어 어긋나 보인다(2026-08-05). */}
              {/* ⚠️ 판 토글과 그 아래 설명 줄을 **한 줄로 합쳤다**(운영자 지시 2026-08-06 —
                  "토글 위치가 자리를 너무 많이 차지한다"). 예전엔 검색창 아래로 토글 한 줄 +
                  설명 한 줄이 따로 쌓여 결과가 그만큼 밀려 내려갔다. 왼쪽 정렬로 붙이면
                  설명이 어느 토글에 대한 말인지도 눈으로 이어진다. */}
              {/* ⚠️⚠️ **폭 클래스를 검색줄과 똑같이 둘 것**(`max-w-3xl lg:max-w-5xl`).
                  검색줄이 나중에 `lg:max-w-5xl`을 얻었는데 이 줄은 안 따라가서, 넓은 화면에서
                  **검색바는 왼쪽 121px인데 이 줄만 255px에서 시작**했다(사장님 지적 2026-08-14:
                  "검색바 밑에 설명이랑 토글 왼쪽으로 정렬해줘"). 둘 다 `mx-auto`로 가운데
                  맞추므로 **폭이 다르면 시작점이 어긋난다.**
                  ⚠️ `pl-1.5`(6px)는 일부러 둔 것이다 — 검색바 테두리가 아니라 **그 안의 마켓
                     칩**과 줄을 맞춘다(칩 127px = 검색바 121 + 6). 지우지 말 것. */}
              <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5 pl-1.5 lg:max-w-5xl">
                {/* ⚠️ 소스(SNKRDUNK·eBay·TCGplayer) 고르는 줄을 검색창 안으로 옮겼다
                    (2026-08-05 운영자 지시). 검색창 한 줄 + 토글 한 줄로 두 줄을
                    쓰고 있었는데, 검색창 왼쪽에 넣으니 한 줄로 준다.
                    실제 버튼은 SearchBar 안에 있다(source·onSourceChange). */}

                {/* 발매판 선택은 eBay·TCGplayer일 때 노출한다(둘 다 PPT라 두 판 다 있다).
                    ⚠️ 여기 예전에 "SNKRDUNK는 영문판이 영문 프로모 몇 종뿐"이라고 적혀
                       있었는데 틀린 말이다(사용자 지적 2026-08-04). 실제로는 제목에
                       【英語版】이 붙은 일반 세트 카드까지 있다
                       (예: ピカチュウ C [TEF EN 051/162]【英語版】).
                       다만 아무거나 다 있는 건 아니다 — 영문판 카드 18장을 스캔이 만드는
                       검색어 꼴("세트 번호")로 두드려 보니 6장만 나왔고, 나온 것은 UR·SIR·
                       프로모처럼 값나가는 것에 몰려 있었다(일본 수집가가 사 모으는 것들이다).
                       그래서 발매판 토글은 아직 안 붙인다 — 고를 만큼 고르게 있지가 않다.
                       영문판 카드를 스캔하면 이베이로 보내는 것도 같은 이유다
                       (applyScanResult 참고). */}
                {board켬 && (
                  <div className="inline-flex rounded-full border border-neutral-300 p-1">
                    {/* ⚠️ 판을 **사용자가 직접** 고르면, 자동으로 옮기며 남긴 안내는 지운다.
                        안 지우면 영문판을 보고 있는데 "이베이 낙찰(일본어판)에서 찾고 있습니다"가
                        그대로 떠 있어 사실과 어긋난다(2026-08-07 점검 중 발견).
                        마켓을 바꿀 때(switchSource)와 같은 처리다 — 자동 이동도 함께 멈춘다.
                        사람이 고른 자리에서 값이 없다고 저절로 딴 데로 옮기면 안 된다. */}
                    <button
                      type="button"
                      onClick={() => {
                        set도감안내(null);
                        자동이동ref.current = false;
                        setBoard기타언어(false);
                        setEdition('japanese');
                      }}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                        edition === 'japanese' && !board기타언어 ? 'bg-black text-white' : 'text-neutral-600'
                      }`}
                    >
                      일본어판
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        set도감안내(null);
                        자동이동ref.current = false;
                        setBoard기타언어(false);
                        setEdition('english');
                      }}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                        edition === 'english' && !board기타언어 ? 'bg-black text-white' : 'text-neutral-600'
                      }`}
                    >
                      영문판
                    </button>
                    {/* 기타 언어판(사장님 지시 2026-08-20) — 프랑스·독일판 같은 곁 카드만
                        모아 보는 판. 검수를 통과해 갈라 둔 낙찰이 이 카드들의 값이다. */}
                    <button
                      type="button"
                      onClick={() => {
                        set도감안내(null);
                        자동이동ref.current = false;
                        setBoard기타언어(true);
                      }}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                        board기타언어 ? 'bg-black text-white' : 'text-neutral-600'
                      }`}
                    >
                      기타 언어판
                    </button>
                    {/* ⚠️ **한글판은 뺐다**(사장님 지시 2026-08-10). 이베이 Browse API로 받던
                        것인데 **낙찰가가 아니라 호가**라 나머지(낙찰가)와 값의 성격이 달랐고,
                        매물 제목으로만 찾아 세트·번호를 못 좁혔다 — 무작위 10장으로 재 봤을 때
                        매물이 있던 카드가 **전부 다른 세트**였다(2026-08-07 실측).
                        되살리려면 이 자리에 버튼을 넣고 server의 ebay-korean 길을 되돌리면 된다. */}
                  </div>
                )}
                {/* ⚠️ **새 길에도 마켓 토글을 따로 두지 않는다**(사장님 지시 2026-08-12:
                    "어차피 검색바에 마켓 변경 할수있으니까 마켓 토글은 없애줘").
                    마켓은 검색창 왼쪽 칩 한 곳에서만 고른다 — 같은 것을 말하는 자리가
                    둘이면 서로 어긋나고, 어느 쪽이 진짜인지 헷갈린다. */}
                {/* 어디 시세인지 한 줄로 밝힌다.
                    ⚠️ 왼쪽 마켓 칩(SNKRDUNK·eBay·TCGplayer)에 딸린 설명이라 왼쪽에 붙인다
                       (운영자 지시 2026-08-05). 이제는 판 토글과 같은 줄에 나란히 선다. */}
                {/* ⚠️ 문구는 사장님이 정한 것이다(2026-08-21). 세 마켓을 같은 꼴로 —
                    「마켓 — 무슨 값입니다.」 — 맞추고, 이베이·TCGplayer에만 둘째 줄을 단다:
                    스니덩크는 저쪽에 직접 묻고 이 둘은 **우리 도감에서 찾기** 때문에 나오는
                    카드 목록이 다르다. 그 사실과 「정확한 카드는 도감에서」를 알린다.
                    둘째 줄은 첫 줄보다 작고 연하게. 한 덩어리(div)로 묶어야 옆 판 토글과
                    가운데 맞춤으로 나란히 서고, 폰에서는 통째로 아랫줄로 내려간다. */}
                <div className="min-w-0 max-w-md text-xs leading-snug text-neutral-500">
                  {source === 'snkrdunk' ? (
                    <p>SNKRDUNK — 일본 마켓 실거래가입니다.</p>
                  ) : (
                    <>
                      {/* ⚠️⚠️ **사진으로 못 찾았으면 이 줄이 그때만 바뀐다**(2026-08-29).
                          새 줄을 만들지 않으므로 **줄 수가 그대로**다 — 사장님이 제일 중요하다고
                          하신 「화면이 안 움직이는 것」이 지켜진다.
                          ⚠️ 자리를 네 번 옮기고 여기 왔다. 새 자리를 만들면 ①칸이 넓어져 검색바를
                             먹거나 ②토글이 밀리거나 ③위아래 어디에 속한 글인지 애매해졌다
                             (「자리가 어정쩡하다」). **있던 줄을 빌리면** 셋 다 안 생긴다.
                          ⚠️ 짝은 사진 단추다 — 단추가 빨개져 **무엇이** 실패했는지 가리키고,
                             이 줄이 **무슨 일인지** 말한다. 빨간색이 같아 둘이 이어진다.
                          ⚠️ 바로 아랫줄(「정확한 카드를 찾으시려면 도감을…」)이 다음 할 일을
                             이미 말하고 있어 여기서 또 안 적는다. */}
                      <p className={scanFailed ? 'text-rose-500' : undefined}>
                        {scanFailed
                          ? '사진으로 카드를 못 찾았습니다.'
                          : board마켓 === 'tcgplayer'
                            ? 'TCGplayer — 미국 마켓 실거래가입니다.'
                            : 'eBay — 등급별 낙찰가입니다.'}
                      </p>
                      {/* ⚠️⚠️ **문장 단위로만 끊기게 묶는다**(사장님 지적 2026-08-29).
                          한 문장이 222px·228px인데 이어 놓으면 453px이라, 폰(341px)에서
                          브라우저가 **문장 한가운데를** 끊었다 — 「…정확한 카드를 /
                          찾으시려면 도감을…」. `inline-block`으로 묶으면 넓은 화면에서는
                          한 줄로 붙고, 좁으면 **문장과 문장 사이**에서만 갈린다.
                          ⚠️ 이 화면 문구를 손댈 때는 **폰 폭(341px)에서 어디서 갈리는지**를
                             먼저 재라. 눈으로만 보면 넓은 화면에서는 안 보인다. */}
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        <span className="inline-block">검색 결과가 SNKRDUNK와 다를 수 있습니다.</span>{' '}
                        <span className="inline-block">정확한 카드를 찾으시려면 도감을 이용해 주세요.</span>
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* 스캔 안내. "이 결과가 왜 이렇게 나왔는지"를 말하는 글이라 결과 바로
                  위에 둔다. 검색창과 판 토글 사이에 있으면 뜰 때마다 그 둘을 갈라놓는다
                  (운영자 지적 2026-08-06). 뜰 때만 자리를 차지하므로 평소엔 영향이 없다. */}
              {/* ⚠️ **검색어가 없으면 통째로 안 낸다.** 이 안내들은 전부 「지금 찾고 있는
                  것」에 대한 말이라, 찾는 게 없으면 할 말이 없다. 위 goHome이 상태를
                  거두지만, 뒤로가기·주소 직접 입력처럼 그 길을 안 거치는 경우가 있어
                  **화면에서 한 번 더** 막는다(같은 실수가 다시 나기 쉬운 자리다). */}
              {query.trim() !== '' &&
                (scanFoundByArtist > 0 ||
                scanFellBack ||
                도감안내 ||
                // 시세를 못 받았을 때도 "무엇을 찾고 있는지" 그림을 보여준다.
                // ⚠️ 여기 `error`는 스니커덩크 것이다. 해외 시세는 우리 파일만 읽어
                //    통째로 실패할 일이 없다(옛 길은 저쪽을 불러서 오류 칸이 따로 있었다).
                (error && 도감카드(query)) ||
                scannedResult) && (
                <div className="mx-auto mb-4 max-w-3xl pl-1.5 lg:max-w-5xl">
                  {/* ⚠️ 위 토글 줄과 같은 이유로 폭을 검색줄에 맞춘다(`lg:max-w-5xl`).
                      이 안내들도 검색바 바로 아래에 붙는 글이라 시작점이 같아야 한다. */}
                  {scanFoundByArtist > 0 && (
                    <p className="text-xs text-neutral-400">
                      카드 번호가 안 보여서 일러스트레이터로 찾았습니다. 내 카드가 아니면 카드 이름으로 다시 검색해
                      보세요.
                    </p>
                  )}
                  {scanFellBack && (
                    <p className="mt-1 text-xs text-neutral-400">번호로 찾지 못해 카드 이름으로 다시 검색했습니다.</p>
                  )}
                  {/* ⚠️ 마켓에 값이 없으면 화면에 그림이 하나도 안 남아, 목록에서 누른
                      카드가 맞는지 확인할 방법이 없었다(2026-08-07 점검 중 발견).
                      누른 그 카드 그림을 안내 옆에 붙여 무엇을 찾고 있는지 보이게 한다.
                      ⚠️ 안내 문구가 없을 때도 보여야 한다. 시세 조회가 통째로 실패하면
                         (PPT가 쉬는 중 등) 안내는 안 뜨는데 그때가 제일 필요하다. */}
                  {(() => {
                    const 누른것 = 도감카드(query);
                    const 그림 = 누른것?.img;
                    if (!도감안내 && !(error && 누른것)) return null;
                    return (
                      <div className="mt-1 flex items-start gap-2">
                        {usable(그림) && (
                          <img
                            src={thumb(cardImg(그림!), 120)}
                            alt=""
                            // 안내 바로 옆 작은 그림 한 장이라 미루지 않고 바로 받는다.
                            className="h-16 w-auto shrink-0 rounded-sm"
                          />
                        )}
                        {도감안내 && <p className="text-xs text-neutral-400">{도감안내}</p>}
                      </div>
                    );
                  })()}
                  {/* 스캔 직후에만 뜨는 신고 링크. 사진은 안 보내고 "뭐라고 읽었는지"만 보낸다. */}
                  {scannedResult && (
                    <p className="mt-1 text-xs text-neutral-400">
                      {scanReported ? (
                        '알려주셔서 감사합니다. 개선에 참고하겠습니다.'
                      ) : (
                        <>
                          찾는 카드가 아닌가요?{' '}
                          <button
                            type="button"
                            onClick={() => {
                              reportScanMiss(scannedResult);
                              setScanReported(true);
                            }}
                            className="font-semibold text-[#2a78d6] hover:underline"
                          >
                            스캔이 틀렸습니다
                          </button>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* 검색어가 없으면 소스와 무관하게 항상 홈(인기 검색어 + 뉴스)을 띄운다.
                  스니덩크/이베이 토글은 "검색 결과를 어느 소스에서 가져올지"만 정하는
                  설정이라, 홈 화면까지 바꾸지는 않는다. */}
              {isHome ? (
                <DetailLayout main={homeMain} detail={null} />
              ) : board켬 ? (
                // 새 길. 상세도 옛 것을 그대로 쓴다 — 형태를 맞추라는 지시였다.
                <DetailLayout
                  main={boardMain}
                  detail={
                    boardSelectedCard ? (
                      board마켓 === 'tcgplayer' ? (
                        <TcgPlayerCardDetail card={boardSelectedCard} edition={edition} />
                      ) : (
                        <EbayCardDetail card={boardSelectedCard} edition={edition} />
                      )
                    ) : null
                  }
                  onCloseDetail={() => setBoardSelectedId(null)}
                  아래막힘={시트아래막힘}
                />
              ) : (
                <DetailLayout
                  main={searchMain}
                  detail={selectedCard ? <CardDetail card={selectedCard} /> : null}
                  onCloseDetail={() => setSelectedId(null)}
                  아래막힘={시트아래막힘}
                />
              )}
            </>
          )}
        </Suspense>
          </ErrorBoundary>
        </main>

        <Footer />
      </div>

      {/* 카드 비교 — 담은 카드가 있으면 하단 바, 비교하기 누르면 표.
          소스(스니덩크/이베이)별로 트레이가 따로 있고, 지금 보는 소스의 것만 띄운다. */}
      {showCompare && source === 'snkrdunk' && compareCards.length > 0 && (
        <div className="compare-bar fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 p-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <span className="flex-shrink-0 text-xs font-semibold text-neutral-500">비교 {compareCards.length}/2</span>
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
              {compareCards.map((c) => (
                <span key={c.apparelId} className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 py-1 pl-1 pr-2">
                  <CardImg src={c.imageUrl} alt="" className="h-7 w-7 rounded object-contain" />
                  <span className="max-w-[110px] truncate text-xs text-neutral-700">{c.title}</span>
                  <button type="button" onClick={() => removeCompare(c.apparelId)} className="text-neutral-400 hover:text-black" aria-label="빼기">
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCompareCards([])}
              className="flex-shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-neutral-400 hover:bg-neutral-50"
            >
              비우기
            </button>
            <button
              type="button"
              disabled={compareCards.length < 2}
              onClick={() => setCompareOpen(true)}
              className="flex-shrink-0 rounded-lg bg-black px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              비교하기
            </button>
          </div>
        </div>
      )}
      {showCompare && source === 'cardboard' && compareEbay.length > 0 && (
        <div className="compare-bar fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 p-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <span className="flex-shrink-0 text-xs font-semibold text-neutral-500">비교 {compareEbay.length}/2</span>
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
              {compareEbay.map((c) => (
                <span key={c.tcgPlayerId} className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 py-1 pl-1 pr-2">
                  {c.imageUrl && <CardImg src={c.imageUrl} alt="" className="h-7 w-7 rounded object-contain" />}
                  <span className="max-w-[110px] truncate text-xs text-neutral-700">{c.name}</span>
                  <button type="button" onClick={() => removeCompareEbay(c.tcgPlayerId)} className="text-neutral-400 hover:text-black" aria-label="빼기">
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCompareEbay([])}
              className="flex-shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-neutral-400 hover:bg-neutral-50"
            >
              비우기
            </button>
            <button
              type="button"
              disabled={compareEbay.length < 2}
              onClick={() => setCompareOpen(true)}
              className="flex-shrink-0 rounded-lg bg-black px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              비교하기
            </button>
          </div>
        </div>
      )}
      {showCompare && compareOpen && source === 'snkrdunk' && compareCards.length === 2 && (
        <CompareView cards={compareCards} onClose={() => setCompareOpen(false)} onRemove={removeCompare} />
      )}
      {showCompare && compareOpen && source === 'cardboard' && compareEbay.length === 2 && (
        <EbayCompareView cards={compareEbay} onClose={() => setCompareOpen(false)} onRemove={removeCompareEbay} />
      )}

      {loginOpen && !loggedIn && <LoginModal onClose={() => setLoginOpen(false)} />}

      {needsNickname && (
        <NicknameSetup
          onDone={(name) => {
            setNickname(name);
            setNeedsNickname(false);
          }}
        />
      )}
    </div>
  );
}

export default App;
