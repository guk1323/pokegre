import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CardImg } from './components/CardImg';
import { ErrorBoundary } from './components/ErrorBoundary';
import { fetchMoreUniqueCards, type SnkrdunkCard } from './api/snkrdunk';
import { fetchPopularSearches, trackEvent, trackSearch, trackVisit, type PopularSearch } from './api/localStats';
import { fetchPokemonNews, type KoreanNewsItem } from './api/koreanNews';
import { fetchRemoteSuggestions } from './api/suggestions';
import {
  searchEbayCards,
  fetchCardNameById,
  EBAY_RATE_LIMITED,
  EBAY_DAILY_LIMIT,
  EBAY_PAGE_SIZE,
  type CardEdition,
  type EbayCard,
} from './api/ebayPrices';
import {
  도감검색어,
  도감검색어들,
  도감표시,
  마켓순서,
  값없음문구,
  값없음이유,
  같은카드인가,
  pptSetName,
  짧은세트,
  type 도감카드정보,
  저쪽번호를우리번호로,
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
import { PokemonNews } from './components/PokemonNews';
import { PackShelfPromo } from './components/PackShelfPromo';
import { NewSetHitCards } from './components/NewSetHitCards';
import { EbayCardTile } from './components/EbayCardTile';
import { EbayCardDetail } from './components/EbayCardDetail';
import { TcgPlayerCardDetail } from './components/TcgPlayerCardDetail';
import { CardScanButton } from './components/CardScanButton';
import { reportScanMiss, scanCard, type CardScanResult } from './api/cardScan';
import { findCardByIllustrator } from './lib/findCardByIllustrator';
// 한글판 화면은 카드 이름 사전을 쓴다. 첫 화면에는 안 나오므로 나중에 불러온다.
const KoreanEbayView = lazy(() => import('./components/KoreanEbayView').then((m) => ({ default: m.KoreanEbayView })));
const Community = lazy(() => import('./Community').then((m) => ({ default: m.Community })));
import { Footer } from './components/legal/Footer';
import { NicknameSetup } from './components/NicknameSetup';
import { LoginModal } from './components/LoginModal';
const MyPage = lazy(() => import('./components/MyPage').then((m) => ({ default: m.MyPage })));
const ReportInbox = lazy(() => import('./components/ReportInbox').then((m) => ({ default: m.ReportInbox })));
const VisitStats = lazy(() => import('./components/VisitStats').then((m) => ({ default: m.VisitStats })));
const ScanTest = lazy(() => import('./components/ScanTest').then((m) => ({ default: m.ScanTest })));
const FleaAdmin = lazy(() => import('./components/FleaAdmin').then((m) => ({ default: m.FleaAdmin })));
const PackSim = lazy(() => import('./components/PackSim').then((m) => ({ default: m.PackSim })));
const SetsView = lazy(() => import('./components/SetsView').then((m) => ({ default: m.SetsView })));
const TitleFeedbackList = lazy(() => import('./components/TitleFeedbackList').then((m) => ({ default: m.TitleFeedbackList })));
const CenteringTool = lazy(() => import('./components/CenteringTool').then((m) => ({ default: m.CenteringTool })));
const PopulationView = lazy(() => import('./components/PopulationView').then((m) => ({ default: m.PopulationView })));
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

type MainView = 'cards' | 'mypage' | 'community' | 'centering' | 'artists' | 'pokedex' | 'reports' | 'stats' | 'sets' | 'scantest' | 'packsim' | 'flea' | 'population';

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
  packsim: '/packsim',
  community: '/community',
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
  packsim: '오늘의 상점 — 포켓몬 카드 팩 열어 보기 | pokegre',
  community: '커뮤니티 | pokegre',
  mypage: '마이페이지 | pokegre',
  reports: '신고함 | pokegre',
  stats: '방문 통계 | pokegre',
  scantest: '스캔 테스트 | pokegre',
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
  if (/^\/(artist|artists)\//.test(p) || /^\/artists\/?$/.test(p)) return 'artists';
  if (/^\/(set|series)\//.test(p) || /^\/sets\/?$/.test(p)) return 'sets';
  if (/^\/pokedex\/?$/.test(p)) return 'pokedex';
  if (/^\/centering\/?$/.test(p)) return 'centering';
  if (/^\/population\/?$/.test(p)) return 'population';
  if (/^\/packsim\/?$/.test(p)) return 'packsim';
  if (/^\/community\/?$/.test(p)) return 'community';
  return null;
}
type PriceSource = 'snkrdunk' | 'ebay' | 'tcgplayer';
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
}: {
  main: React.ReactNode;
  detail: React.ReactNode | null;
  onCloseDetail?: () => void;
}) {
  return (
    <>
      {detail ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="min-w-0">{main}</div>
          {/* 오른쪽 2단은 큰 화면에서만. 좁은 화면에서는 아래 시트가 대신한다. */}
          <div className="hidden lg:block">{detail}</div>
        </div>
      ) : (
        <div>{main}</div>
      )}

      <DetailSheet open={detail != null} onClose={() => onCloseDetail?.()}>
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
    return (window.history.state as { nav?: Record<string, unknown> } | null)?.nav ?? {};
  } catch {
    return {};
  }
}

// "3시간 전"·"어제" 처럼 사람이 읽는 말로 바꾼다. 정확한 시각보다 이게 읽기 쉽다.
function asOfLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '조금 전';
  const h = Math.floor((Date.now() - t) / 3_600_000);
  if (h < 1) return '조금 전';
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d === 1 ? '어제' : `${d}일 전`;
}

function App() {
  // 주소가 먼저다. 검색·공유로 들어온 사람은 그 주소가 보고 싶은 화면이고,
  // 방문기록(savedNav)은 그 사람이 전에 보던 화면이라 새로 들어온 뜻을 덮으면 안 된다.
  const [view, setView] = useState<MainView>(
    () => viewFromPath(window.location.pathname) ?? savedNav().view ?? 'cards',
  );
  // 상단 드롭다운(도감·도구·운영) 중 열린 것. 뒤 백드롭 클릭으로 닫는다(z-index로만 처리).
  const [openMenu, setOpenMenu] = useState<'find' | 'tools' | 'admin' | null>(null);
  const [source, setSource] = useState<PriceSource>(() => savedNav().source ?? 'snkrdunk');
  const [query, setQuery] = useState(() => savedNav().query ?? '');
  // 방금 스캔한 결과. "이 카드가 아닙니다" 신고에 쓰고, 사용자가 직접 타이핑하면 지운다.
  const [scannedResult, setScannedResult] = useState<CardScanResult | null>(null);
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
  const [ebayItems, setEbayItems] = useState<EbayCard[]>([]);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);
  // 지금 받은 게 아니라 지난번 값일 때 그 시각. 크레딧을 다 썼거나 통신이 실패하면
  // 서버가 지난 시세를 대신 준다 — 화면에 언제 기준인지 밝혀야 오해가 없다.
  const [ebayAsOf, setEbayAsOf] = useState<string | null>(null);
  // 뒤에 붙은 레어도로 좁혔을 때 그 코드. 못 찾았으면 rarityMissing에 담긴다.
  const [ebayRarity, setEbayRarity] = useState<{ 좁힘?: string; 없음?: string }>({});
  // 이베이에 실제로 보낸 영문 검색어. 결과가 없을 때 "직접 찾아보기" 링크에 쓴다.
  const [ebayQueryEn, setEbayQueryEn] = useState('');
  const [ebaySelectedId, setEbaySelectedId] = useState<string | null>(null);
  // 공유 링크(/e/·/t/)로 들어왔을 때 열어야 할 카드. 번호로 미리 받아 두고, 검색 결과가
  // 오면 그 안에서 고른다. 결과에 없으면(다른 세트가 먼저 잡히는 등) 받아 둔 카드를
  // 목록 맨 앞에 꽂아서 반드시 열리게 한다.
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [pendingSnkr, setPendingSnkr] = useState<SnkrdunkCard | null>(null);
  // 공유 링크로 들어와 카드를 찾는 중. 이 동안에는 주소를 건드리지 않는다 —
  // 카드가 아직 안 골라졌다고 주소를 /로 되돌려 버리면 링크가 무용지물이 된다.
  const [restoringShare, setRestoringShare] = useState(() => /^\/[cet]\//.test(window.location.pathname));
  // "더 보기"용. ebayOffset은 지금까지 요청한 원본 카드 수(페이지 크기의 배수)다.
  const [ebayOffset, setEbayOffset] = useState(0);
  const [ebayHasMore, setEbayHasMore] = useState(false);
  const [ebayLoadingMore, setEbayLoadingMore] = useState(false);
  const [edition, setEdition] = useState<CardEdition>(() => savedNav().edition ?? 'japanese');
  const [nickname, setNickname] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [createdAt, setCreatedAt] = useState<number | undefined>(undefined);
  // 신고함 탭을 보여줄지 정하는 값일 뿐이다. 이걸 위조해도 서버가 신고 목록을
  // 안 주므로 아무것도 못 본다.
  const [isAdmin, setIsAdmin] = useState(false);
  // 검색·공유로 들어온 주소(/set/…·/artist/…·/series/…·/centering, 그리고 카테고리
  // 대문 /sets·/artists·/packsim·/community)로 들어오면 서버가 그 화면의 내용을 글자로
  // 미리 넣어 보낸다. 앱이 뜨면 그 조각을 걷어 낸다 — 화면은 위 useState에서 이미 그
  // 주소에 맞춰 열렸다(viewFromPath).
  // ⚠️ 주소는 그대로 둔다. 새로고침·공유해도 같은 자리가 열려야 한다.
  useEffect(() => {
    if (!viewFromPath(window.location.pathname)) return;
    document.getElementById('seo-fallback')?.remove();
  }, []);
  // 팩 개봉의 "수록 카드 보기" → 세트 목록에서 그 세트를 바로 연다.
  // /set/<슬러그>로 들어와도 같은 자리로 보낸다(검색으로 들어오는 길).
  const [setsInitialSlug, setSetsInitialSlug] = useState<string | null>(
    // +도 받는다(SM1+ 같은 옛 세트 코드). 빼면 그 주소로 들어와도 세트가 안 열린다.
    () => decodeURIComponent(window.location.pathname.match(/^\/set\/([\w.%+-]+)/)?.[1] ?? '') || null,
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
  // 이베이 카드 비교(운영자 베타). SNKRDUNK와 별개 트레이 — 소스가 다르면 비교 의미가 없다.
  const [compareEbay, setCompareEbay] = useState<EbayCard[]>([]);
  function toggleCompareEbay(card: EbayCard) {
    setCompareEbay((prev) => {
      if (prev.some((c) => c.tcgPlayerId === card.tcgPlayerId)) return prev.filter((c) => c.tcgPlayerId !== card.tcgPlayerId);
      return [...prev, card].slice(-2);
    });
  }
  function removeCompareEbay(id: string) {
    setCompareEbay((prev) => prev.filter((c) => c.tcgPlayerId !== id));
  }
  // 소스(스니덩크↔이베이)를 바꾸면 열려 있던 비교 표는 닫는다(소스별 표가 달라서).
  useEffect(() => setCompareOpen(false), [source]);
  // 한글판은 이베이 전용 판이라, 이베이가 아닌 소스로 옮기면 일본판으로 되돌린다
  // (안 그러면 TCGplayer에서 '한글판' 상태가 남아 PPT에 잘못된 판이 넘어간다).
  useEffect(() => {
    if (source !== 'ebay' && edition === 'korean') setEdition('japanese');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
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
      // 뽑기는 공개 화면이지만 로그인이 필요하므로 같이 홈으로 보낸다.
      // 지금 화면은 setView의 함수형으로 읽는다 — 이 효과는 한 번만 돌아야 해서
      // view를 의존성에 넣을 수 없다.
      setView((v) => {
        const adminOnly = v === 'reports' || v === 'stats' || v === 'scantest' || v === 'flea';
        if (adminOnly && !me.isAdmin) return 'cards';
        if (v === 'packsim' && !me.loggedIn) return 'cards';
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
    if (next.source !== undefined) setSource(snap.source);
    if (next.edition !== undefined) setEdition(snap.edition);
    // 소스별 검색어도 새 방문기록에 실어 둔다. 안 그러면 커뮤니티 등에 갔다 뒤로 왔을 때
    // 탭을 바꿔도 검색어가 안 갈린다(위 scanQueriesRef 설명).
    if (!same) window.history.pushState({ nav: { ...snap, scanQueries: scanQueriesRef.current } }, '');
  };

  // 처음 화면(카드 시세 홈)으로. 검색·선택·화면을 비우고 맨 위로 올린다.
  const goHome = () => {
    setSelectedId(null);
    setEbaySelectedId(null);
    setInterestSelectedId(null);
    navigate({ view: 'cards', query: '' });
    window.scrollTo({ top: 0 });
  };

  // 사진에서 번호를 못 읽었을 때, 일러스트레이터 이름으로 카드를 찾아 번호를 채운다.
  // 번호는 구석에 아주 작게 있어 사진이 조금만 잘려도 못 읽는데, 일러스트레이터 이름은
  // 그림 바로 아래라 웬만하면 찍힌다. "작가 + 카드이름"이면 86%가 한 장으로 좁혀진다.
  // 못 찾으면 원래대로 이름으로만 검색한다(조용히 넘어간다).
  const applyScanWithLookup = async (result: CardScanResult) => {
    // ⚠️ 북미판일 때만 쓴다. 작가별 카드 목록이 북미판 기준이라, 일본판 카드에 쓰면
    // 같은 그림의 "북미판 번호"가 나와 스니커덩크에서 엉뚱한 카드를 찾게 된다
    // (일본판 메가리자몽Y ex는 MC 766/742인데 목록은 북미판 294를 준다).
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
    const snkrdunk = num ? [result.setCode, num].filter(Boolean).join(' ') : (result.pokemonNameEn ?? '');
    const ebay = num ? [result.pokemonNameEn, num].filter(Boolean).join(' ') : (result.pokemonNameEn ?? '');
    const ed: 'japanese' | 'english' = result.edition === 'english' ? 'english' : 'japanese';
    const target = ed === 'english' ? 'ebay' : source;
    // 번호로 검색하는 경우에만 이름 백업을 둔다. 번호로 0건이면 이름으로 다시 찾는다.
    scanFallbackRef.current = num && result.pokemonNameEn ? result.pokemonNameEn : null;
    scanQueriesRef.current = { snkrdunk, ebay };
    setScanFellBack(false);
    setScanFoundByArtist(0);
    setEdition(ed);
    setSource(target);
    const scanQuery = target === 'ebay' ? ebay : snkrdunk;
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
  const switchSource = (next: PriceSource) => {
    // 도감에서 온 카드를 보고 있으면, 옮겨 간 마켓에 맞는 검색어로 갈아 준다.
    // 이게 없으면 스니커덩크용 "SV6 050"을 이베이에 그대로 넣어 0건이 된다
    // (운영자 지적 2026-08-06).
    const c = 도감카드(query);
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
      setSource(nav.source);
      setEdition(nav.edition);
      // 소스별 검색어도 같이 되살린다 — 없으면 뒤로 온 뒤 탭을 바꿔도 안 갈린다.
      scanQueriesRef.current = nav.scanQueries ?? null;
      setSelectedId(null);
      setEbaySelectedId(null);
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
    // packsim은 이제 이용자 화면이지만 로그인 필요라, 로그아웃하면 홈으로 보낸다.
    if (view === 'reports' || view === 'stats' || view === 'scantest' || view === 'flea' || view === 'packsim')
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
    const m = window.location.pathname.match(/^\/([cet])\/([\w-]+)/);
    if (!m) return;
    const [, kind, id] = m;

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

    // 이베이·TCGplayer는 카드 번호(tcgPlayerId)로 찾는다. 번호로 카드를 한 장 받아
    // 그 이름으로 검색을 태우고, 목록이 오면 아래 효과가 그 카드를 골라 준다.
    // 이베이·TCGplayer는 카드 번호만으로 조회할 방법이 없다(PPT가 tcgPlayerId 단건
    // 조회를 안 받는다). 그래서 주소에 짧은 이름을 같이 실어 그 이름으로 검색하고,
    // 결과에서 번호가 같은 카드를 골라 연다.
    setSource(kind === 'e' ? 'ebay' : 'tcgplayer');
    const shared = new URLSearchParams(window.location.search).get('n');
    setPendingCardId(id);
    if (shared) {
      setQuery(shared);
      return;
    }
    // ⚠️ 이름이 안 실린 링크(요즘 만드는 꼴)에서는 예전에 아무것도 안 하고 끝나서
    //    홈 화면이 됐다(2026-08-07 운영자 제보). 위 주석에 'PPT가 tcgPlayerId 단건
    //    조회를 안 받는다'고 적혀 있었는데 **받는다** — 그걸로 이름을 알아내
    //    예전 길(이름으로 검색 → 번호가 같은 카드를 고름)을 그대로 태운다.
    void fetchCardNameById(id, kind === 'e' ? 'ebay' : 'tcgplayer')
      .then((찾음) => {
        if (!찾음) {
          setRestoringShare(false);
          return;
        }
        setEdition(찾음.edition);
        setQuery(찾음.query);
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
    // 이건 우리 파일 안에서 찾는 거라 밖으로 안 나간다 — 기다림 없이 바로 보여준다.
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
        setSuggestions((prev) => [...new Set([...prev, ...remote])].slice(0, 10));
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
          //    데이터가 북미판 번호를 담고 있어, ja-neo4 38번을 누르면 화면엔
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
            //    (점검 중 발견 2026-08-06 — 북미판 파이숭이를 스니커덩크에서 봤을 때).
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
            if (scanQueriesRef.current) scanQueriesRef.current = { ...scanQueriesRef.current, snkrdunk: fb };
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

  // 이베이 쪽은 검색당 크레딧이 소모돼서(1회 36크레딧) 스니덩크보다 더 기다린다.
  useEffect(() => {
    if (source !== 'ebay' && source !== 'tcgplayer') return;
    // 한글판(이베이)은 PPT가 아니라 Browse API(KoreanEbayView가 자체 조회)라 여기선 건너뛴다.
    if (source === 'ebay' && edition === 'korean') return;
    // 이베이·TCGplayer는 같은 PPT 데이터를 쓰되, 서버가 소스별로 카드를 추려 준다.
    const market = source === 'tcgplayer' ? 'tcgplayer' : 'ebay';

    const trimmed = query.trim();
    if (!trimmed) {
      setEbayItems([]);
      setEbayError(null);
      setEbayLoading(false);
      return;
    }
    // 스니커덩크와 같은 기준. 한 글자로는 안 부른다 — 여기는 크레딧까지 든다.
    if (trimmed.length < MIN_SEARCH_LEN) {
      setEbayLoading(false);
      return;
    }

    // 기다리는 동안에도 "검색 중"으로 둔다(스니커덩크 쪽 설명 참고).
    setEbayLoading(true);

    const timer = setTimeout(() => {
      setEbayLoading(true);
      setEbayError(null);
      // 도감에서 온 카드면 그 세트로 좁힌다. PPT 세트 이름은 우리 것과 달라서
      // 대응표(pptSetNames)를 쓴다 — ja-PMCG1 → "Expansion Pack".
      const 도감 = 도감카드(trimmed);
      // ⚠️ 검색어에 **번호를 붙이면 그 한 장으로 좁혀진다**. 처음엔 "번호를 붙이면
      //    0건"이라고 결론 냈는데 틀렸다 — 원본은 오는데 낙찰 필터에 걸린 것을 0건으로
      //    본 것이었다(rawCount를 안 봤다, 2026-08-06 정정). 실제로 "Charizard ex 125"는
      //    setName과 함께 쓰면 딱 1건, 세트 조건 없이도 4건까지 줄어든다.
      //    세트 대응표가 틀리거나 없어도 번호가 지켜 준다.
      //    다만 번호 표기가 안 맞는 카드도 있으므로, 0건이면 이름만으로 한 번 더 찾는다.
      const 번호붙임 = 도감?.num ? `${trimmed} ${도감.num.replace(/^0+/, '') || 도감.num}` : trimmed;
      searchEbayCards(번호붙임, edition, 0, market, 도감 ? pptSetName(도감) : undefined)
        .then(async (r) =>
          도감 && r.cards.length === 0 && 번호붙임 !== trimmed
            ? await searchEbayCards(trimmed, edition, 0, market, pptSetName(도감))
            : r,
        )
        .then(({ cards, hasMore, translated, asOf, rarity, rarityMissing }) => {
          setEbayQueryEn(translated ?? '');
          // 스캔한 "이름+번호"가 0건이면 이름만으로 자동 재검색(번호 표기가 안 맞는 경우).
          const fb = scanFallbackRef.current;
          if (cards.length === 0 && fb && fb.trim() && fb.trim() !== trimmed) {
            scanFallbackRef.current = null;
            setScanFellBack(true);
            // ⚠️ 대체한 검색어를 그 소스 자리에 다시 적어 둔다. 안 그러면 아래
            //    switchSource가 "사람이 손으로 고쳤다"고 보고, 탭을 되돌려도 원래
            //    검색어로 안 돌아온다(사진으로 찾은 인도네시아 피카츄가 이베이에서
            //    "Pikachu"로 대체된 뒤, 스니커덩크로 와도 계속 "Pikachu"였다).
            if (scanQueriesRef.current) scanQueriesRef.current = { ...scanQueriesRef.current, ebay: fb };
            setQuery(fb);
            return;
          }
          // 카드 번호 비교용 열쇠. 빗금 앞만 보고, 앞의 0을 떼고, 대소문자를 맞춘다.
          //   "125/197" → 125 · "030/XY-P" → 30 · "XY133" → XY133 · "SM169" → SM169
          // ⚠️ 숫자로 바꿔 비교하면 안 된다. 프로모 번호는 글자가 섞여 있어(XY133·BW97)
          //    Number()가 NaN이 되고, NaN끼리는 절대 같지 않아 **전부 못 찾는다**
          //    (운영자 발견 2026-08-06 — 지우개굴닌자 EX XY133이 눈앞에 있는데도
          //    "찾지 못해"라고 나왔다).
          // ⚠️ 세트에 따라 저쪽(PPT)이 **다른 번호 체계**를 쓴다. 셀레브레이션즈 클래식
          //    컬렉션은 우리가 CC001~CC025로 두는데 저쪽은 원본 카드 번호(4/102)다.
          //    그대로 견주면 그 25장은 영원히 '그 카드가 아니다'가 되어 시세가 안 뜬다
          //    (2026-08-07 덤프 대조로 찾았다). 견주기 전에 우리 번호로 되돌린다.
          const 번호열쇠 = (s: string, 이름?: string) => {
            const 되돌린 = 도감 ? 저쪽번호를우리번호로(도감.slug, String(s), 이름) : String(s);
            return 되돌린.split('/')[0].trim().toUpperCase().replace(/^0+(?=[0-9])/, '');
          };
          // ⚠️ 이름 비교에서 괄호를 지우면 안 된다. "히스이 미끄네일"과 "히스이 미끄네일
          //    (Mirror Holofoil)"이 같은 이름이 되어 버린다. 괄호는 다른 인쇄를 가리키는
          //    표시이므로 그대로 두고 정확히 맞춘다.
          // ⚠️ PPT는 이름 뒤에 번호를 붙여 준다("모란 - 105/078"). 그건 다른 인쇄가
          //    아니라 같은 카드다 — 안 떼면 멀쩡한 카드에도 "다른 인쇄만 값이 있다"는
          //    안내가 붙는다(점검 중 발견 2026-08-06). 꼬리 번호만 떼고, **괄호는
          //    그대로 둔다**(괄호는 진짜 다른 인쇄를 가리킨다).
          const 다듬 = (s: string) =>
            String(s)
              .toLowerCase()
              // 꼬리에 붙는 번호를 뗀다. PPT는 두 가지 꼴로 붙인다:
              //   "모란 - 105/078"  ·  "신뇽 (4)"
              .replace(/\s*-\s*[0-9a-z]+(?:\/[0-9a-z-]+)?\s*$/i, '')
              // ⚠️ 괄호 안이 **번호뿐일 때만** 뗀다. 글자가 들었으면 다른 인쇄를
              //    가리키므로(Master Ball Pattern · Holo Common) 남겨야 구분이 된다.
              .replace(/\s*\(\s*[0-9]+(?:\/[0-9]+)?\s*\)\s*$/, '')
              .replace(/\s+/g, ' ')
              .trim();
          // 같은 번호에 인쇄 변형이 여럿 있다(054/071이 일반 · Mirror Holofoil 두 장).
          // 그냥 첫 장을 고르면 값이 높은 쪽이 걸려, 054를 눌렀는데 미러가 열린다
          // (점검 중 발견 2026-08-06). 이름이 정확히 같은 것을 먼저 본다.
          // ⚠️ **번호만 봐서는 안 된다.** PPT의 세트 조건은 부분 일치라, "Team Rocket"을
          //    걸면 "EX Team Rocket Returns"가 함께 오고 두 세트는 번호가 83개나 겹친다
          //    ("Expansion Pack"↔"CP6: Expansion Pack 20th Anniversary"는 102개).
          //    그러면 남의 카드 값을 그 카드인 양 보여 주게 된다(2026-08-07 전수 확인).
          //    보낸 세트 이름이 있으면 **돌아온 세트도 그것이어야** 그 카드로 인정한다.
          //    ⚠️ 대응표에 없어 세트를 안 보낸 경우(빈 값)에는 이 검사를 건너뛴다 —
          //       걸지도 않은 조건으로 걸러내면 값이 있는 카드까지 놓친다.
          const 보낸세트 = 도감 ? pptSetName(도감) : '';
          const 세트열쇠 = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
          // ⚠️ setName은 화면용으로 한글화된 값이다("팀 로켓"). 견줄 때는 반드시
          //    원본 영문(setNameEn)을 쓴다 — 한글과 영문을 견주면 늘 어긋나서
          //    모든 카드가 "그 카드가 아님"이 된다(2026-08-07에 한 번 그렇게 깨뜨렸다).
          const 세트맞음 = (c: { setNameEn?: string }) =>
            !보낸세트 || 세트열쇠(c.setNameEn ?? '') === 세트열쇠(보낸세트);
          const 번호맞음 = 도감
            ? cards.filter(
                // ⚠️ cardNumber가 비어도 버리면 안 된다. 옛 일본판은 저쪽에 번호가 없어
                //    이름으로만 짝지을 수 있다(표의 NAME: 항목).
                (c) => 번호열쇠(c.cardNumber ?? '', c.nameEn ?? c.name) === 번호열쇠(도감.num) && 세트맞음(c),
              )
            : [];
          const 이름까지맞음 = 번호맞음.find((c) => 다듬(c.name) === 다듬(도감!.ko));
          const 그카드 = 번호맞음.length ? (이름까지맞음 ?? 번호맞음[0]) : undefined;
          // 번호는 맞는데 이름 끝에 인쇄 표기가 붙어 있는 경우다
          //  ("펜드라 (Master Ball Pattern)" · "레지드래고 V (Alternate Full Art)").
          //
          // ⚠️ 이게 "다른 카드"인지 "그 번호가 원래 그 인쇄"인지는 우리 데이터로 가릴 수
          //    없다. 실버 템페스트 184번은 번호 자체가 Alternate Full Art인데, 예전 문구는
          //    "다른 인쇄만 값이 있다"고 단정해 멀쩡한 카드를 의심하게 만들었다(점검 중
          //    발견 2026-08-06). 번호가 같으면 그 카드가 맞다 — 단정하지 말고 어떤 표기로
          //    값이 잡혔는지만 알린다.
          const 인쇄표기 = 그카드 && !이름까지맞음 ? 그카드.name : '';
          // "그 카드가 아님이 확실한가". 돌아온 카드 전부에 번호가 붙어 있는데 그중
          // 우리 번호가 없으면 확실히 아니다.
          //
          // ⚠️ 결과가 있다고 찾은 게 아니다. XY 프로모에는 같은 이름의 리자몽 EX가 넉
          //    장(030·075·213·276) 있는데, 276을 눌러도 값이 있는 030만 돌아온다. 예전엔
          //    그걸 그 카드인 양 열어서 135만원짜리 남의 카드를 보여 줬다(운영자 발견
          //    2026-08-06). 번호가 어긋나면 열지 않고 다음 마켓으로 간다.
          // ⚠️ 반대로 PPT 일본판은 번호 칸이 비어 있는 카드가 많다. 그건 "아니다"라고
          //    단정할 수 없으므로 그대로 둔다 — 아니면 값이 있는데도 계속 넘어간다.
          const 확실히아님 =
            Boolean(도감) && !그카드 && cards.length > 0 && cards.every((c) => Boolean(c.cardNumber));
          if (도감 && (cards.length === 0 || 확실히아님)) {
            if (다음마켓으로(도감)) return;
            // 더 갈 곳이 없거나 사람이 직접 고른 마켓이다. 앞서 뜬 안내를 그대로 두면
            // 결과가 없는데 "값을 보여 드립니다"가 남는다.
            // 카드 자체를 못 찾은 것이라 "안 팔렸다"가 아니다. 마켓에 맞는 말로 알린다.
            set도감안내(
              `${도감.ko} · ${짧은세트(도감.setNameKo)} ${도감.num}번은 이 마켓에 ` +
                `${값없음문구(마켓순서(도감.jp)[마켓칸ref.current].source, false)}.`,
            );
          }
          // 세트로 좁혀도 그 세트에 같은 이름이 여러 장 있다(리자몽 ex가 4장). 번호로
          // 그 한 장을 맨 앞에 세우고 골라 둔다. 나머지는 지우지 않는다 — 번호 표기가
          // 어긋나면(228/197처럼 빗금이 붙거나 일본판은 아예 비어 있다) 아무것도 안
          // 남을 수 있다.
          let 정렬됨 = cards;
          let 고를것: string | null = null;
          if (도감) {
            if (그카드) {
              정렬됨 = [그카드, ...cards.filter((c) => c !== 그카드)];
              고를것 = 그카드.tcgPlayerId;
            } else if (pptSetName(도감) && cards.every((c) => !c.cardNumber)) {
              // ⚠️ PPT 일본판은 번호 칸이 비어 있어 번호로 못 맞춘다. 그럴 땐 **이름이
              //    정확히 같은 것**을 고른다. 그냥 첫 장을 열면 같은 카드의 다른 인쇄가
              //    걸린다 — 히스이 미끄네일 054를 눌렀는데 "(Mirror Holofoil)"이 열렸다
              //    (점검 중 발견 2026-08-06).
              const 이름같음 = cards.filter((c) => 다듬(c.name) === 다듬(도감.ko));
              // 딱 한 장일 때만 연다. 여럿이면 어느 것인지 알 수 없으므로 목록만 보여 준다.
              if (이름같음.length === 1) {
                정렬됨 = [이름같음[0], ...cards.filter((c) => c !== 이름같음[0])];
                고를것 = 이름같음[0].tcgPlayerId;
              } else if (cards.length === 1) {
                고를것 = cards[0].tcgPlayerId;
              }
            }
            // 왜 이 결과를 보고 있는지 한 줄로 밝힌다. 틀린 것보다 빈칸이 낫고,
            // 빈칸보다는 사실이 낫다.
            const 칸 = 마켓칸ref.current;
            const 순서 = 마켓순서(도감.jp);
            if (고를것) trackEvent('card_found', 순서[칸].label);
            set도감안내(
              // ⚠️ 보여 줄 카드가 하나도 없는데 "다른 카드를 보여 드립니다"라고 하면
              //    거짓말이 된다(점검 중 발견 2026-08-06).
              cards.length === 0
                ? `${도감.ko} · ${짧은세트(도감.setNameKo)} ${도감.num}번은 이 마켓에 ${값없음문구(순서[칸].source, false)}.`
                : 인쇄표기
                  ? `${짧은세트(도감.setNameKo)} ${도감.num}번은 “${인쇄표기}”로 값이 잡힙니다.`
                : !고를것
                  ? `${짧은세트(도감.setNameKo)} ${도감.num}번은 이 마켓에서 찾지 못해, 같은 이름의 다른 카드를 보여 드립니다.`
                  : 자동이동ref.current && 칸 > 0
                    ? `${순서[칸 - 1].label}에 ${값없음이유(순서[칸 - 1].source)} ${순서[칸].label} 값을 보여 드립니다.`
                    : null,
            );
          }
          setEbayItems(정렬됨);
          setEbayAsOf(asOf ?? null);
          setEbayRarity({ 좁힘: rarity, 없음: rarityMissing });
          searchResultRef.current = { query: trimmed, count: 정렬됨.length, source };
          setResultTick((n) => n + 1);
          setEbayOffset(EBAY_PAGE_SIZE);
          setEbayHasMore(hasMore);
          setEbaySelectedId((prev) =>
            // 도감에서 눌러 온 그 카드가 있으면 폰에서도 바로 연다 — 그 한 장을 보러
            // 온 것이므로, 목록만 띄우고 다시 누르게 하는 건 한 번 더 시키는 셈이다.
            고를것 ??
            (정렬됨.some((c) => c.tcgPlayerId === prev)
              ? prev
              : isWideScreen()
                ? (정렬됨[0]?.tcgPlayerId ?? null)
                : null),
          );
        })
        .catch((err: Error) => {
          setEbayError(
            err.message === EBAY_DAILY_LIMIT
              ? '오늘 볼 수 있는 시세 조회량을 다 썼습니다. 내일 오전 9시에 다시 열립니다.'
              : err.message === EBAY_RATE_LIMITED
                ? '지금 조회가 몰렸습니다. 30초쯤 뒤에 다시 눌러 주세요.'
                : '시세를 불러오지 못했습니다.',
          );
          // 이전 검색 결과가 남아 있으면 에러 문구 아래에 엉뚱한 카드가 계속
          // 보이므로(특히 발매판을 바꿨을 때) 같이 비워준다.
          setEbayItems([]);
          setEbayAsOf(null);
          setEbaySelectedId(null);
          setEbayHasMore(false);
        })
        .finally(() => setEbayLoading(false));
    }, 600);

    return () => clearTimeout(timer);
  }, [query, source, edition]);

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
      if (r.count === 0) {
        if (r.source === 'ebay' || r.source === 'tcgplayer') {
          if (trackedQueryRef.current !== trimmed) {
            trackedQueryRef.current = trimmed;
            trackEvent(r.source === 'ebay' ? 'ebay_search' : 'tcgplayer');
          }
        }
        return;
      }
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
      trackEvent(r.source === 'ebay' ? 'ebay_search' : r.source === 'tcgplayer' ? 'tcgplayer' : 'snkrdunk_search');
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

  function loadMoreEbay() {
    setEbayLoadingMore(true);
    searchEbayCards(
      query.trim(),
      edition,
      ebayOffset,
      source === 'tcgplayer' ? 'tcgplayer' : 'ebay',
      (() => {
        const c = 도감카드(query.trim());
        return c ? pptSetName(c) : undefined;
      })(),
    )
      .then(({ cards, hasMore }) => {
        // offset 페이지가 겹쳐 같은 카드가 들어오는 일을 막는다.
        setEbayItems((prev) => {
          const seen = new Set(prev.map((c) => c.tcgPlayerId));
          return [...prev, ...cards.filter((c) => !seen.has(c.tcgPlayerId))];
        });
        setEbayOffset((prev) => prev + EBAY_PAGE_SIZE);
        setEbayHasMore(hasMore);
      })
      .catch(() => setEbayHasMore(false))
      .finally(() => setEbayLoadingMore(false));
  }

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

  function handleSelectSuggestion(term: string) {
    confirmSearch(term, 'pick');
    setQuery(term);
    setSuggestionsOpen(false);
    setSuggestActive(-1);
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

  useEffect(() => {
    if (!pendingCardId) return;
    if (ebayItems.length === 0) return;
    // 결과에 있으면 그 카드를 편다. 없으면(다른 세트가 먼저 잡힌 경우) 목록만 두고
    // 표시만 지운다 — 검색어가 그 카드 이름이라 사용자가 바로 찾을 수 있다.
    if (ebayItems.some((c) => c.tcgPlayerId === pendingCardId)) setEbaySelectedId(pendingCardId);
    setPendingCardId(null);
    setRestoringShare(false);
  }, [ebayItems, pendingCardId]);

  const selectedCard = items.find((c) => c.apparelId === selectedId) ?? null;
  const interestSelectedCard =
    [...recentlyViewed, ...favorites].find((c) => c.apparelId === interestSelectedId) ?? null;
  const ebaySelectedCard = ebayItems.find((c) => c.tcgPlayerId === ebaySelectedId) ?? null;

  // 상세를 열면 주소창을 그 카드의 공유 링크(/c/<id>?n=<이름>)로 바꾼다. replaceState라
  // 히스토리 스택은 안 건드려서 기존 뒤로가기 처리와 충돌하지 않는다. 이걸로 사용자가
  // 주소를 복사해 붙이면 카드 이름·시세 미리보기가 뜨는 링크가 된다.
  useEffect(() => {
    // 소스마다 주소를 따로 둔다. 전에는 스니커덩크만 있어서 이베이·TCGplayer 카드는
    // 아예 공유할 주소가 없었다.
    //   /c/<번호>  스니커덩크      /e/<번호>  이베이      /t/<번호>  TCGplayer
    // 카드 화면이 아니거나 아무 카드도 안 골랐으면 주소를 /로 되돌린다.
    const path =
      view !== 'cards'
        ? null
        : source === 'snkrdunk' && selectedCard
          ? // 스니커덩크 카드는 서버가 이름을 스스로 알아내므로 주소에 안 싣는다.
            // 주소창에서 그대로 복사해 붙이는 사람이 많은데, 한글이 %EB%A6%AC…로 늘어나면
            // 91자짜리 알 수 없는 주소가 된다.
            `/c/${selectedCard.apparelId}`
          : source === 'ebay' && ebaySelectedCard
            ? `/e/${ebaySelectedCard.tcgPlayerId}`
            : source === 'tcgplayer' && ebaySelectedCard
              ? `/t/${ebaySelectedCard.tcgPlayerId}`
              : null;
    // ⚠️ ?notrack=1 같은 물음표 뒤는 지우지 않는다. 예전엔 주소를 바꿀 때마다 통째로
    //    날아가서, 운영자가 확인하려고 붙인 notrack이 카테고리 한 번 누르면 풀렸다.
    const q = window.location.search;
    const cur = window.location.pathname;
    if (path) {
      if (cur !== path) window.history.replaceState(window.history.state, '', path + q);
      // 탭 제목도 그 카드로. 서버가 /c/<번호>에 붙이는 것과 같은 모양이다.
      const nm = selectedCard?.title ?? ebaySelectedCard?.name ?? '';
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
      (view === 'sets' && /^\/(set|series)\//.test(cur)) || (view === 'artists' && /^\/artist\//.test(cur));
    // 깊은 링크는 주소도 제목도 서버가 붙여 준 것을 그대로 둔다.
    if (deep) return;
    const want = VIEW_PATH[view] ?? '/';
    if (cur !== want) window.history.replaceState(window.history.state, '', want + q);
    document.title = VIEW_TITLE[view] ?? HOME_TITLE;
  }, [selectedCard, ebaySelectedCard, view, source, restoringShare]);

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
      {/* ⚠️ 공지 배너(OnboardingBanner)를 홈에서 뺐다(2026-08-05, 운영자 지시).
          컴포넌트 파일은 남겨 두었으니 다시 붙이려면 여기에 <OnboardingBanner />만
          되살리면 된다. */}
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
      {/* ⚠️ 신팩 힛카드는 인기 검색어 바로 아래다(운영자 지시 2026-08-05). 검색을 한
          번도 안 해도 지금 제일 비싼 카드가 얼마인지 보이게 하려는 자리다.
          어느 세트를 띄울지는 서버가 고른다 — 발매일이 제일 최근이면서 시세가 있는
          세트다. 여기에 세트를 박아 두면 새 팩이 나올 때마다 사람이 고쳐야 한다. */}
      <NewSetHitCards
        // ⚠️ 예전엔 이름만 넘겨서 검색창에 "라이코 ex"만 떴다. 도감·세트·작가는
        //    "라이코 ex · 스톰에메랄드 · 108번"으로 그 한 장을 찾는데 홈만 달랐다
        //    (점검 중 발견 2026-08-06). 같은 길(카드로가기)을 타게 한다.
        onOpenCard={(c) =>
          카드로가기({
            ko: c.ko,
            en: c.set.ed === 'en' ? c.name : '',
            raw: c.name,
            speciesEn: '',
            slug: c.set.slug,
            setCode: 세트목록ref.current?.find((s) => s.slug === c.set.slug)?.id ?? '',
            setName: c.set.name,
            setNameKo: c.set.name,
            num: c.n,
            jp: c.set.ed !== 'en',
          })
        }
        onOpenSet={(slug) => {
          setSetsInitialSlug(slug);
          navigate({ view: 'sets' });
        }}
      />
      <PackShelfPromo onEnter={() => navigate({ view: 'packsim' })} />
      <PokemonNews items={news} loading={newsLoading} />
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
                {cardResults.map((card) => (
                  <CardTile
                    key={card.apparelId}
                    card={card}
                    selected={card.apparelId === selectedId}
                    onSelect={handleSelectCard}
                    isFavorite={checkIsFavorite(card.apparelId, favoriteRefs)}
                    onToggleFavorite={handleToggleFavorite}
                    onCompare={showCompare ? toggleCompare : undefined}
                    inCompare={compareCards.some((c) => c.apparelId === card.apparelId)}
                  />
                ))}
              </div>
            </div>
          )}

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

  const isTcg = source === 'tcgplayer';
  const ebayMain = (
    <>
      {!ebayError && (
        <p className="text-sm text-neutral-500 mb-3">
          {ebayLoading
            ? '검색 중...'
            : `${isTcg ? 'TCGplayer 시세' : 'eBay 등급 데이터'} ${ebayItems.length}종 표시`}
        </p>
      )}

      {/* 지금 받은 값이 아닐 때만 밝힌다. 아무것도 안 보여주는 것보다 낫지만,
          언제 기준인지 안 적으면 지금 시세로 오해한다. */}
      {!ebayError && !ebayLoading && ebayAsOf && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          오늘 볼 수 있는 시세 조회량을 다 써서 {asOfLabel(ebayAsOf)} 받아 둔 시세를 보여드립니다. 오전 9시에 다시 열립니다.
        </p>
      )}

      {/* ⚠️ 뒤에 붙은 레어도로 좁혔으면 그렇다고 밝힌다. 안 밝히면 "왜 몇 장뿐이지"가 된다.
          못 찾았을 때는 **전체를 보여 주고 까닭을 적는다** — 빈 화면을 주면 우리가 그 카드를
          아예 안 다루는 줄 안다(2026-08-08). 조사(가/이)가 코드마다 달라져 따옴표로 묶었다. */}
      {!ebayError && !ebayLoading && (ebayRarity.좁힘 || ebayRarity.없음) && (
        <p className="mb-3 text-xs text-neutral-500">
          {ebayRarity.좁힘
            ? `${ebayRarity.좁힘} 카드만 보고 있습니다.`
            : `'${ebayRarity.없음}' 카드가 없어 전체를 보여 드립니다.`}
        </p>
      )}

      {ebayError ? (
        <p className="text-sm text-rose-500 py-12 text-center">{ebayError}</p>
      ) : !ebayLoading && ebayItems.length === 0 ? (
        // 왜 없는지까지 알려준다. 그냥 "없습니다"만 뜨면 고장난 줄 안다.
        // 이베이·TCGplayer 시세는 PPT를 통해 보는데, PPT는 북미판·일본판만 다룬다.
        // 인도네시아·중국·태국판 같은 지역 한정 카드는 거기에 아예 없다(사용자 제보:
        // 사진으로 찾은 인도네시아 프로모 피카츄가 스니커덩크에는 있는데 여기선 빈 화면).
        // ⚠️ 왜 없는지는 단정하지 않는다. 우리 데이터에 있는데 검색어가 안 맞아 못
        //    찾는 것일 수도 있고, 이베이에는 매물이 있는데 우리 데이터에만 없는 것일
        //    수도 있다. 확인할 방법이 없는 것을 사실처럼 적으면 안 된다.
        //    대신 다음에 해볼 수 있는 것을 준다.
        <div className="py-12 text-center">
          <p className="text-sm text-neutral-500">
            {isTcg ? 'TCGplayer에서 이 검색어로 찾지 못했습니다.' : 'eBay에서 이 검색어로 찾지 못했습니다.'}
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-neutral-400">
            카드 번호 대신 카드 이름으로, 또는 영어 이름으로 바꿔 보시면 나올 수 있습니다.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => switchSource('snkrdunk')}
              className="rounded-full border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:border-black hover:text-black"
            >
              스니커덩크에서 찾아보기
            </button>
            <a
              href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebayQueryEn || query.trim())}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:border-black hover:text-black"
            >
              이베이에서 직접 찾아보기 ↗
            </a>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {ebayItems.map((card) => (
              <EbayCardTile
                key={card.tcgPlayerId}
                card={card}
                variant={isTcg ? 'tcgplayer' : 'ebay'}
                selected={card.tcgPlayerId === ebaySelectedId}
                onSelect={setEbaySelectedId}
                onCompare={!isTcg && showCompare ? toggleCompareEbay : undefined}
                inCompare={compareEbay.some((c) => c.tcgPlayerId === card.tcgPlayerId)}
              />
            ))}
          </div>

          {ebayHasMore && (
            <button
              type="button"
              onClick={loadMoreEbay}
              disabled={ebayLoadingMore}
              className="mt-4 w-full rounded-lg border border-neutral-300 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {ebayLoadingMore ? '더 불러오는 중...' : '결과 더 보기'}
            </button>
          )}
        </>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-neutral-100">
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
              <nav className="relative z-50 flex flex-wrap items-center gap-1.5 sm:gap-2">
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
                    //    ⚠️ 화면 안 제목은 "포켓몬·트레이너별 카드 목록" 그대로 둔다 —
                    //       메뉴는 짧게, 들어가면 정확하게.
                    label: '도감',
                    items: [
                      // ⚠️ **베타 배지는 뗐다.** 넷 중 넷이 베타라 배지가 뜻을 잃었고,
                      //    오히려 "아직 덜 됐나 보다" 싶어 안 누르게 만든다(2026-08-08).
                      //    다시 붙일 일이 있으면 beta: true 한 줄이면 된다.
                      { v: 'pokedex', label: '포켓몬' },
                      { v: 'sets', label: '세트' },
                      { v: 'artists', label: '작가' },
                    ],
                  },
                  {
                    key: 'tools' as const,
                    label: '도구',
                    items: [
                      // ⚠️ 도감 쪽과 마찬가지로 **한 낱말**로 맞춘다. 무엇을 하는지는
                      //    들어가면 바로 아래 한 줄로 설명한다 — 메뉴에 설명을 넣으면
                      //    길어지기만 한다.
                      { v: 'population', label: '팝수' },
                      { v: 'centering', label: '센터링' },
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
                  커뮤니티
                </button>
                {/* 운영: 운영자 전용 화면(신고함·통계)을 드롭다운 하나로 묶어 상단을 깔끔히 둔다.
                    실제 차단은 서버가 한다 — 주소를 직접 쳐도 데이터를 안 준다. */}
                {isAdmin && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === 'admin' ? null : 'admin')}
                      className={`whitespace-nowrap rounded-full px-3 py-2.5 text-sm font-semibold sm:px-4 ${
                        view === 'reports' || view === 'stats' || view === 'scantest' || view === 'flea'
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
                  className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-sm font-semibold ${
                    view === 'mypage' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  {loggedIn && nickname ? (
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
                        view === 'mypage' ? 'bg-white text-black' : 'bg-neutral-800 text-white'
                      }`}
                    >
                      {[...nickname][0]}
                    </span>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
                    </svg>
                  )}
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
                  일본어라 그대로 견주면 일본판 13개가 통째로 안 걸린다 — 탭만 바뀌고
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
            <Community loggedIn={loggedIn} isAdmin={isAdmin} onRequestLogin={() => setLoginOpen(true)} />
          ) : view === 'centering' ? (
            <CenteringTool onSearchByPhoto={searchByPhoto} />
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
              <div className="mx-auto mb-4 max-w-3xl">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchBar
                      source={source}
                      onSourceChange={switchSource}
                      value={보일검색어}
                      onChange={(v) => {
                        setQuery(v);
                        // 직접 타이핑하면 방금 스캔 맥락은 끝난 것 — 신고 링크·백업을 거둔다.
                        setScannedResult(null);
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
                        setScannedResult(null);
                        scanFallbackRef.current = null;
                        setScanFellBack(false);
                        scanQueriesRef.current = null;
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
                        confirmSearch(query, 'enter');
                        setSuggestionsOpen(false);
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
                  {/* 북미판(영문) 카드는 SNKRDUNK에 없으니 이베이로 보내고, 일본어·한국어
                      카드는 지금 보던 소스를 유지한다. 소스에 맞는 검색어를 고른다 —
                      SNKRDUNK는 세트+번호(확실), 이베이는 영어 이름+번호. */}
                  <CardScanButton onResult={({ result }) => void applyScanWithLookup(result)} />
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
              <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5 pl-1.5">
                {/* ⚠️ 소스(SNKRDUNK·eBay·TCGplayer) 고르는 줄을 검색창 안으로 옮겼다
                    (2026-08-05 운영자 지시). 검색창 한 줄 + 토글 한 줄로 두 줄을
                    쓰고 있었는데, 검색창 왼쪽에 넣으니 한 줄로 준다.
                    실제 버튼은 SearchBar 안에 있다(source·onSourceChange). */}

                {/* 발매판 선택은 eBay·TCGplayer일 때 노출한다(둘 다 PPT라 두 판 다 있다).
                    ⚠️ 여기 예전에 "SNKRDUNK는 북미판이 영문 프로모 몇 종뿐"이라고 적혀
                       있었는데 틀린 말이다(사용자 지적 2026-08-04). 실제로는 제목에
                       【英語版】이 붙은 일반 세트 카드까지 있다
                       (예: ピカチュウ C [TEF EN 051/162]【英語版】).
                       다만 아무거나 다 있는 건 아니다 — 북미판 카드 18장을 스캔이 만드는
                       검색어 꼴("세트 번호")로 두드려 보니 6장만 나왔고, 나온 것은 UR·SIR·
                       프로모처럼 값나가는 것에 몰려 있었다(일본 수집가가 사 모으는 것들이다).
                       그래서 발매판 토글은 아직 안 붙인다 — 고를 만큼 고르게 있지가 않다.
                       북미판 카드를 스캔하면 이베이로 보내는 것도 같은 이유다
                       (applyScanResult 참고). */}
                {(source === 'ebay' || source === 'tcgplayer') && (
                  <div className="inline-flex rounded-full border border-neutral-300 p-1">
                    {/* ⚠️ 판을 **사용자가 직접** 고르면, 자동으로 옮기며 남긴 안내는 지운다.
                        안 지우면 한글판을 보고 있는데 "이베이 낙찰(일본판)에서 찾고 있습니다"가
                        그대로 떠 있어 사실과 어긋난다(2026-08-07 점검 중 발견).
                        마켓을 바꿀 때(switchSource)와 같은 처리다 — 자동 이동도 함께 멈춘다.
                        사람이 고른 자리에서 값이 없다고 저절로 딴 데로 옮기면 안 된다. */}
                    <button
                      type="button"
                      onClick={() => {
                        set도감안내(null);
                        자동이동ref.current = false;
                        setEdition('japanese');
                      }}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                        edition === 'japanese' ? 'bg-black text-white' : 'text-neutral-600'
                      }`}
                    >
                      일본판
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        set도감안내(null);
                        자동이동ref.current = false;
                        setEdition('english');
                      }}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                        edition === 'english' ? 'bg-black text-white' : 'text-neutral-600'
                      }`}
                    >
                      북미판
                    </button>
                    {/* 한글판은 이베이 전용(Browse API 호가). TCGplayer엔 한국판이 없어 안 띄운다. */}
                    {source === 'ebay' && (
                      <button
                        type="button"
                        onClick={() => {
                          set도감안내(null);
                          자동이동ref.current = false;
                          setEdition('korean');
                        }}
                        className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                          edition === 'korean' ? 'bg-black text-white' : 'text-neutral-600'
                        }`}
                      >
                        한글판
                      </button>
                    )}
                  </div>
                )}
                {/* ⚠️ 스니커덩크 탭에 있던 "한글판 시세 보기" 버튼을 뺐다(2026-08-05
                    운영자 지시). 넣었던 이유는 "한글판 시세를 볼 수 있다는 걸 아무도
                    모른다"였는데(2026-08-04), 탭 줄에 버튼이 하나 더 붙어 어수선했다.
                    한글판은 eBay 탭 → 판 선택에서 그대로 고를 수 있다.
                    다시 넣고 싶으면 여기에 되살리면 된다. */}
                {/* 어디 시세인지 한 줄로 밝힌다.
                    ⚠️ 한글판은 같은 이베이라도 값의 성격이 다르다 — Browse API라 "지금 올라온
                       매물 호가"이고, 나머지는 낙찰가다. 뭉뚱그리면 틀린 말이 된다.
                    ⚠️ 왼쪽 마켓 칩(SNKRDUNK·eBay·TCGplayer)에 딸린 설명이라 왼쪽에 붙인다
                       (운영자 지시 2026-08-05). 이제는 판 토글과 같은 줄에 나란히 선다. */}
                <p className="text-xs text-neutral-400">
                  {source === 'snkrdunk'
                    ? 'SNKRDUNK — 일본 마켓 실거래가입니다.'
                    : source === 'tcgplayer'
                      ? 'TCGplayer — 미국 마켓가입니다.'
                      : edition === 'korean'
                        ? 'eBay 한글판 — 지금 올라온 매물의 호가입니다(낙찰가가 아닙니다).'
                        : 'eBay — 등급별 낙찰가입니다.'}
                </p>
              </div>

              {/* 스캔 안내. "이 결과가 왜 이렇게 나왔는지"를 말하는 글이라 결과 바로
                  위에 둔다. 검색창과 판 토글 사이에 있으면 뜰 때마다 그 둘을 갈라놓는다
                  (운영자 지적 2026-08-06). 뜰 때만 자리를 차지하므로 평소엔 영향이 없다. */}
              {(scanFoundByArtist > 0 ||
                scanFellBack ||
                도감안내 ||
                // 시세를 못 받았을 때도 "무엇을 찾고 있는지" 그림을 보여준다.
                // ⚠️ 오류 상태가 마켓마다 따로다. 스니커덩크만 보면 이베이·TCGplayer로
                //    넘어간 카드에는 그림이 안 붙는다(2026-08-07 점검 중 발견).
                ((error || ebayError) && 도감카드(query)) ||
                (edition === 'korean' && 도감카드(query)) ||
                scannedResult) && (
                <div className="mx-auto mb-4 max-w-3xl pl-1.5">
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
                    if (!도감안내 && !((error || ebayError) && 누른것)) return null;
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
                  {/* ⚠️ 한글판은 이베이 **매물 제목**으로 찾는다. 세트 이름이나 번호로
                      좁힐 방법이 없어서, 도감에서 그 한 장을 눌러 와도 같은 이름의 다른
                      세트 매물이 섞여 나온다(밴디트 링 022 샤미드를 눌렀는데 이브이
                      히어로즈 074 매물이 떴다 — 점검 중 발견 2026-08-06).
                      말없이 두면 그 카드의 값으로 오해한다.
                      ⚠️ "섞일 수 있다"고만 적었더니 실제보다 순한 말이었다. 무작위 10장으로
                         재 보니 매물이 있던 4장이 **모두** 다른 세트였다(2026-08-07).
                         한글판 매물 자체가 드물어(10장 중 4장) 이름만 같은 것이 올라온다.
                         알고 고르도록 실측한 대로 적는다.
                      ⚠️ 매물 제목에서 번호를 뽑는 것은 된다(24건 중 20건, 83%). 그래도
                         "이건 다른 카드입니다"라고 **자동으로 판정하지는 않는다** —
                         한국판은 서포트·굿즈 블록을 한글 가나다순으로 다시 매겨서
                         번호가 달라도 같은 카드일 때가 있다(CLAUDE.md 카드명 번역 항목).
                         잘못 "다른 카드"라고 붙이면 지금보다 나쁘다. 제목을 그대로 보여
                         주고 판단은 사람에게 맡긴다. */}
                  {edition === 'korean' && 도감카드(query) && (
                    <p className="mt-1 text-xs text-neutral-400">
                      한글판은 매물 제목으로만 찾아 세트·번호까지 좁히지 못합니다. 무작위 10장으로 재 보니 매물이
                      있던 카드는 모두 다른 세트였습니다(2026-08-07 실측). 아래 제목의 세트·번호를 직접
                      확인해 주세요.
                    </p>
                  )}
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
              ) : source === 'ebay' && edition === 'korean' ? (
                <DetailLayout main={<KoreanEbayView query={query.trim()} />} detail={null} />
              ) : source === 'ebay' || source === 'tcgplayer' ? (
                <DetailLayout
                  main={ebayMain}
                  detail={
                    ebaySelectedCard ? (
                      source === 'tcgplayer' ? (
                        <TcgPlayerCardDetail card={ebaySelectedCard} edition={edition} />
                      ) : (
                        <EbayCardDetail card={ebaySelectedCard} edition={edition} />
                      )
                    ) : null
                  }
                  onCloseDetail={() => setEbaySelectedId(null)}
                />
              ) : (
                <DetailLayout
                  main={searchMain}
                  detail={selectedCard ? <CardDetail card={selectedCard} /> : null}
                  onCloseDetail={() => setSelectedId(null)}
                />
              )}
            </>
          )}
        </Suspense>
          </ErrorBoundary>
        </main>

        <Footer />
      </div>

      {/* 카드 비교(운영자 베타) — 담은 카드가 있으면 하단 바, 비교하기 누르면 표.
          소스(스니덩크/이베이)별로 트레이가 따로 있고, 지금 보는 소스의 것만 띄운다. */}
      {showCompare && source === 'snkrdunk' && compareCards.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 p-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur">
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
      {showCompare && source === 'ebay' && compareEbay.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 p-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur">
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
      {showCompare && compareOpen && source === 'ebay' && compareEbay.length === 2 && (
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
