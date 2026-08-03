import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { fetchMoreUniqueCards, type SnkrdunkCard } from './api/snkrdunk';
import { fetchPopularSearches, trackEvent, trackSearch, trackVisit, type PopularSearch } from './api/localStats';
import { fetchPokemonNews, type KoreanNewsItem } from './api/koreanNews';
import { fetchRemoteSuggestions } from './api/suggestions';
import { searchEbayCards, EBAY_RATE_LIMITED, EBAY_DAILY_LIMIT, EBAY_PAGE_SIZE, type CardEdition, type EbayCard } from './api/ebayPrices';
import { loadNameDict, warmNameDict } from './lib/nameDict';

import {
  addRecentlyViewed,
  getFavoriteRefs,
  getRecentRefs,
  isFavorite as checkIsFavorite,
  toggleFavorite,
  writeFavoriteRefs,
  writeRecentRefs,
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
import { OnboardingBanner } from './components/OnboardingBanner';
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
const ArtistsView = lazy(() => import('./components/ArtistsView').then((m) => ({ default: m.ArtistsView })));
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

type MainView = 'cards' | 'mypage' | 'community' | 'centering' | 'artists' | 'reports' | 'stats' | 'sets' | 'scantest' | 'packsim' | 'flea';
type PriceSource = 'snkrdunk' | 'ebay' | 'tcgplayer';

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

function App() {
  const [view, setView] = useState<MainView>(() => savedNav().view ?? 'cards');
  // 상단 드롭다운(더보기·운영) 중 열린 것. 뒤 백드롭 클릭으로 닫는다(z-index로만 처리).
  const [openMenu, setOpenMenu] = useState<'more' | 'admin' | null>(null);
  const [source, setSource] = useState<PriceSource>(() => savedNav().source ?? 'snkrdunk');
  const [query, setQuery] = useState(() => savedNav().query ?? '');
  // 방금 스캔한 결과. "이 카드가 아닙니다" 신고에 쓰고, 사용자가 직접 타이핑하면 지운다.
  const [scannedResult, setScannedResult] = useState<CardScanResult | null>(null);
  const [scanReported, setScanReported] = useState(false);
  // 스캔이 "세트+번호"로 검색했는데 0건이면 카드 이름으로 자동 재검색하기 위한 백업 이름.
  // 번호를 써서 검색한 경우에만 채운다(번호를 못 읽었으면 이미 이름으로 검색 중).
  const scanFallbackRef = useRef<string | null>(null);
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
  // 번호 대신 일러스트레이터로 찾아낸 경우 그 사실을 알려 준다(후보가 여럿이면 몇 개인지).
  const [scanFoundByArtist, setScanFoundByArtist] = useState(0);
  // 마지막으로 "결과가 실제로 나온" 검색어와 개수. 인기 검색어 집계 때, 결과가 0인
  // 오타·타이핑 조각이 순위에 끼는 걸 막는 데 쓴다(집계 시점에 최신값을 참조).
  const searchResultRef = useRef<{ query: string; count: number; source: PriceSource }>({ query: '', count: 0, source: 'snkrdunk' });
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
  // /set/<슬러그>로 들어오면 바로 세트 화면을 연다. 서버가 그 주소로 힛카드가 적힌
  // 페이지를 미리 만들어 보내므로(검색 노출용), 사람이 눌러 들어오면 앱이 이어받는다.
  useEffect(() => {
    if (!/^\/set\//.test(window.location.pathname)) return;
    setView('sets');
    // 주소는 그대로 둔다 — 새로고침·공유해도 같은 세트가 열린다.
    document.getElementById('seo-fallback')?.remove();
  }, []);
  // /artist/<슬러그>·/series/<슬러그>·/centering도 같은 방식이다. 서버가 그 주소로
  // 검색 노출용 페이지를 미리 만들어 보내므로, 사람이 눌러 들어오면 앱이 이어받는다.
  useEffect(() => {
    const p = window.location.pathname;
    if (/^\/artist\//.test(p)) setView('artists');
    else if (/^\/series\//.test(p)) setView('sets');
    else if (/^\/centering\/?$/.test(p)) setView('centering');
    else return;
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
  useEffect(() => {
    let cancelled = false;
    resolveStoredCards(favoriteRefs).then((cards) => {
      if (!cancelled) setFavorites(cards);
    });
    return () => {
      cancelled = true;
    };
  }, [favoriteRefs]);

  useEffect(() => {
    let cancelled = false;
    resolveStoredCards(recentRefs).then((cards) => {
      if (!cancelled) setRecentlyViewed(cards);
    });
    return () => {
      cancelled = true;
    };
  }, [recentRefs]);

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
    setQuery(target === 'ebay' ? ebay : snkrdunk);
    setScannedResult(result);
    setScanReported(false);
  };

  // 시세 소스(탭)를 바꾼다. 사진으로 찾은 카드라면 검색어도 그 소스에 맞게 갈아 끼운다 —
  // 안 그러면 스니커덩크에서 "M4 086/083"으로 잘 나온 카드가, 이베이로 옮기는 순간
  // 그 세트코드를 그대로 들고 가서 0건이 된다(사용자 제보).
  // 검색어를 손으로 고친 뒤라면 그대로 둔다(둘 중 어느 것과도 같지 않으면 손댄 것이다).
  const switchSource = (next: PriceSource) => {
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
        .then((cards) => {
          if (!cards[0]) {
            setRestoringShare(false);
            return;
          }
          setPendingSnkr(cards[0]);
          setQuery(cards[0].title);
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
    if (!shared) {
      setRestoringShare(false);
      return;
    }
    setPendingCardId(id);
    setQuery(shared);
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
    // 이름 목록(포켓몬·팩)도 사전만큼 커서 같이 나중에 받는다. 검색창을 누르는
    // 순간 미리 받아 두므로 글자를 칠 때쯤이면 이미 와 있다.
    void import('./lib/localSuggestions').then((m) => {
      if (!cancelled) setSuggestions(m.getLocalSuggestions(trimmed));
    });
    fetchRemoteSuggestions(trimmed).then((remote) => {
      if (cancelled || remote.length === 0) return;
      setSuggestions((prev) => [...new Set([...prev, ...remote])].slice(0, 10));
    });

    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    if (source !== 'snkrdunk') return;

    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchMoreUniqueCards(trimmed, 1, new Set(), INITIAL_TARGET)
        .then(({ items, lastPage, exhausted }) => {
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
          setItems(items);
          searchResultRef.current = { query: trimmed, count: items.length, source: 'snkrdunk' };
          setLastPage(lastPage);
          setExhausted(exhausted);
          // 이미 고른 카드가 새 결과에도 있으면 유지하고, 없으면 큰 화면에서만 첫
          // 카드를 자동 선택한다. 폰에서는 null로 둬서 사용자가 누를 때까지 시트를
          // 안 띄운다.
          setSelectedId((prev) =>
            items.some((c) => c.apparelId === prev) ? prev : isWideScreen() ? (items[0]?.apparelId ?? null) : null,
          );
        })
        .catch(() => setError('시세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'))
        .finally(() => setLoading(false));
    }, 350);

    return () => clearTimeout(timer);
  }, [query, source, retryTick]);

  // 이베이 쪽은 검색당 크레딧이 소모돼서 스니덩크(350ms)보다 디바운스를 여유 있게 뒀다.
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
      return;
    }

    const timer = setTimeout(() => {
      setEbayLoading(true);
      setEbayError(null);
      searchEbayCards(trimmed, edition, 0, market)
        .then(({ cards, hasMore }) => {
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
          setEbayItems(cards);
          searchResultRef.current = { query: trimmed, count: cards.length, source };
          setEbayOffset(EBAY_PAGE_SIZE);
          setEbayHasMore(hasMore);
          setEbaySelectedId((prev) =>
            cards.some((c) => c.tcgPlayerId === prev)
              ? prev
              : isWideScreen()
                ? (cards[0]?.tcgPlayerId ?? null)
                : null,
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
          setEbaySelectedId(null);
          setEbayHasMore(false);
        })
        .finally(() => setEbayLoading(false));
    }, 600);

    return () => clearTimeout(timer);
  }, [query, source, edition]);

  // 인기 검색어 집계는 검색 실행(350ms)보다 훨씬 긴 텀을 두고, 타이핑 도중의
  // 미완성 문자열("피카츄"를 치다 멈춘 "피카" 같은)이 그대로 순위에 올라가는 걸 막는다.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const timer = setTimeout(() => {
      // 결과가 실제로 나온 검색어만 집계한다. 오타·존재하지 않는 카드처럼 결과가 0인
      // 문자열이 인기 검색어를 오염시키는 걸 막는다. 검색(350·600ms)은 1500ms 전에
      // 끝나므로 이 시점의 ref는 지금 검색어의 결과를 담고 있다.
      const r = searchResultRef.current;
      if (r.query !== trimmed || r.count === 0) return;
      void loadNameDict().then((d) => {
        // 사진으로 찾으면 검색어가 카드 번호라("M4 114/083") 그대로 순위에 올리면
        // 무슨 카드인지 알 수 없다. 그럴 땐 읽어낸 카드 이름으로 집계한다.
        const scanned = scannedResult?.pokemonNameEn ? d.koreanizeEnglishCardName(scannedResult.pokemonNameEn) : '';
        const term = d.canonicalizeSearchTerm(trimmed) || scanned.trim();
        if (term) trackSearch(term);
      });
      // 어느 소스로 실제 검색이 이뤄졌는지만 센다(개인정보 없음).
      trackEvent(r.source === 'ebay' ? 'ebay_search' : r.source === 'tcgplayer' ? 'tcgplayer' : 'snkrdunk_search');
      loadPopularSearches();
    }, 1500);

    return () => clearTimeout(timer);
  }, [query]);

  function loadMore() {
    setLoadingMore(true);
    const excludeIds = new Set(items.map((c) => c.apparelId));
    fetchMoreUniqueCards(query.trim(), lastPage + 1, excludeIds, LOAD_MORE_TARGET)
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
    searchEbayCards(query.trim(), edition, ebayOffset, source === 'tcgplayer' ? 'tcgplayer' : 'ebay')
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

  function handleSelectSuggestion(term: string) {
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
    if (path) {
      window.history.replaceState(window.history.state, '', path);
    } else if (!restoringShare && /^\/[cet]\//.test(window.location.pathname)) {
      window.history.replaceState(window.history.state, '', '/');
    }
  }, [selectedCard, ebaySelectedCard, view, source, restoringShare]);

  // 사전이 온 뒤에 채운다. 안내문 한 줄이라 조금 늦게 떠도 티가 안 난다.
  const [translatedQuery, setTranslatedQuery] = useState('');
  useEffect(() => {
    // ⚠️ 검색어가 없으면 사전을 부르지 않는다. 부르면 첫 화면에서 사전을 통째로
    // 받아 버려 떼어 놓은 뜻이 없어진다(실제로 그랬다 — 운영 빌드에서 잡았다).
    if (!query.trim()) {
      setTranslatedQuery('');
      return;
    }
    let alive = true;
    void loadNameDict().then((d) => {
      if (alive) setTranslatedQuery(d.translateSearchQuery(query));
    });
    return () => {
      alive = false;
    };
  }, [query]);
  const showTranslationHint = source === 'snkrdunk' && translatedQuery && translatedQuery !== query.trim();
  const hasMore = !exhausted;
  const isHome = query.trim().length === 0;

  // 홈의 세로 간격은 여기 한 곳에서만 정한다(space-y-8 = 32px).
  //
  // 예전에는 구역마다 자기 바깥 여백을 들고 있었다(배너 mb-6, 상점 mt-8, 뉴스 mt-8 mb-6…).
  // 그래서 순서를 바꾸자마자 간격이 32/0/32로 어긋났다 — 상점 아래에 여백이 없고 인기
  // 검색어 위에도 없어서 둘이 딱 붙어 버렸다. 간격을 컨테이너가 쥐고 있으면 순서를 어떻게
  // 바꿔도 항상 같은 간격이 나온다. 구역 컴포넌트에는 바깥 여백을 넣지 말 것.
  const homeMain = (
    <div className="space-y-8">
      <OnboardingBanner />
      {/* 오늘의 상점을 인기 검색어보다 위에 둔다(2026-07-26 사용자 결정). 상점은 팩 사진이
          있어 첫인상을 만들고 매일 진열이 바뀌어 다시 올 이유가 되는데, 아래에 두면 폰에서
          제목만 걸치고 사진이 잘렸다. 인기 검색어는 아직 항목이 적고, 검색하러 온 사람은
          맨 위 검색창을 바로 쓴다. */}
      <PackShelfPromo onEnter={() => navigate({ view: 'packsim' })} />
      <PopularSearches items={popularSearches} asOf={popularAsOf} loading={popularLoading} onSelect={setQuery} />
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

      {error ? (
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
        <p className="text-sm text-neutral-400 py-12 text-center">검색 결과가 없습니다.</p>
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
              className="mt-4 w-full rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
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

      {ebayError ? (
        <p className="text-sm text-rose-500 py-12 text-center">{ebayError}</p>
      ) : !ebayLoading && ebayItems.length === 0 ? (
        // 왜 없는지까지 알려준다. 그냥 "없습니다"만 뜨면 고장난 줄 안다.
        // 이베이·TCGplayer 시세는 PPT를 통해 보는데, PPT는 북미판·일본판만 다룬다.
        // 인도네시아·중국·태국판 같은 지역 한정 카드는 거기에 아예 없다(사용자 제보:
        // 사진으로 찾은 인도네시아 프로모 피카츄가 스니커덩크에는 있는데 여기선 빈 화면).
        <div className="py-12 text-center">
          <p className="text-sm text-neutral-500">
            {isTcg ? 'TCGplayer 시세가 없습니다.' : 'eBay 낙찰 데이터가 없습니다.'}
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-neutral-400">
            이베이·TCGplayer는 북미판과 일본판을 주로 다룹니다. 인도네시아·중국·태국판처럼
            일부 나라에서만 나온 카드는 여기에 올라오지 않습니다.
          </p>
          <button
            type="button"
            onClick={() => switchSource('snkrdunk')}
            className="mt-4 rounded-full border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:border-black hover:text-black"
          >
            스니커덩크에서 찾아보기
          </button>
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
              className="mt-4 w-full rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
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
              <nav className="relative z-50 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate({ view: 'cards' })}
                  className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold ${
                    view === 'cards' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  홈
                </button>
                {/* 더보기: "카드를 다른 각도로 보는" 도구 묶음(작가별·세트별 목록, 센터링 측정).
                    앞으로 도구가 늘어도 여기로만 쌓인다. */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenMenu(openMenu === 'more' ? null : 'more')}
                    className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold ${
                      view === 'artists' || view === 'sets' || view === 'centering' || view === 'packsim'
                        ? 'bg-black text-white'
                        : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    카드 도구 <span className="text-[10px]">▾</span>
                  </button>
                  {openMenu === 'more' && (
                    <div className="absolute right-0 z-50 mt-1 w-40 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
                      {([
                        { v: 'artists', label: '작가별 목록' },
                        { v: 'sets', label: '세트별 목록', beta: true },
                        { v: 'centering', label: '센터링 측정', beta: true },
                        { v: 'packsim', label: '오늘의 상점' },
                      ] as { v: MainView; label: string; beta?: boolean }[]).map((it) => (
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
                <button
                  type="button"
                  onClick={() => navigate({ view: 'community' })}
                  className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold ${
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
                      className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold ${
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
                <button
                  type="button"
                  onClick={() => navigate({ view: 'mypage' })}
                  className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold ${
                    view === 'mypage' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  {loggedIn ? (nickname ?? '마이페이지') : '마이페이지'}
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
            />
          ) : view === 'sets' ? (
            <SetsView
              initialSlug={setsInitialSlug}
              initialSerie={window.location.pathname.match(/^\/series\/([^/?#]+)/)?.[1] ?? null}
              onInitialSlugDone={() => setSetsInitialSlug(null)}
              onPickCard={(name) => navigate({ view: 'cards', source: 'snkrdunk', query: name })}
            />
          ) : view === 'community' ? (
            <Community loggedIn={loggedIn} isAdmin={isAdmin} onRequestLogin={() => setLoginOpen(true)} />
          ) : view === 'centering' ? (
            <CenteringTool onSearchByPhoto={searchByPhoto} />
          ) : view === 'artists' ? (
            <ArtistsView
              onPickCard={(name) => navigate({ view: 'cards', source: 'snkrdunk', query: name })}
            />
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
              <div className="mb-4 max-w-xl">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchBar
                      value={query}
                      onChange={(v) => {
                        setQuery(v);
                        // 직접 타이핑하면 방금 스캔 맥락은 끝난 것 — 신고 링크·백업을 거둔다.
                        setScannedResult(null);
                        scanFallbackRef.current = null;
                        setScanFellBack(false);
                      }}
                      onFocus={() => {
                        setSuggestionsOpen(true);
                        // 검색창을 누르는 순간 이름 사전을 미리 받아 둔다. 실제로
                        // 검색을 누를 때쯤이면 이미 와 있어서 기다림이 없다.
                        warmNameDict();
                      }}
                      onBlur={() => setSuggestionsOpen(false)}
                      onSubmit={() => setSuggestionsOpen(false)}
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
                {scanFoundByArtist > 0 && (
                  <p className="text-xs text-neutral-400 mt-2">
                    카드 번호가 안 보여서 일러스트레이터로 찾았습니다. 내 카드가 아니면
                    카드 이름으로 다시 검색해 보세요.
                  </p>
                )}
                {scanFellBack && (
                  <p className="text-xs text-neutral-400 mt-2">번호로 찾지 못해 카드 이름으로 다시 검색했습니다.</p>
                )}
                {showTranslationHint && (
                  <p className="text-xs text-neutral-400 mt-2">
                    '{query.trim()}' → '{translatedQuery}'로 검색했습니다.
                  </p>
                )}
                {/* 스캔 직후에만 뜨는 신고 링크. 사진은 안 보내고 "뭐라고 읽었는지"만 보낸다. */}
                {scannedResult && (
                  <p className="text-xs text-neutral-400 mt-2">
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

              <div className="mb-6 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-full border border-neutral-300 p-1">
                  <button
                    type="button"
                    onClick={() => switchSource('snkrdunk')}
                    className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                      source === 'snkrdunk' ? 'bg-black text-white' : 'text-neutral-600'
                    }`}
                  >
                    SNKRDUNK
                  </button>
                  <button
                    type="button"
                    onClick={() => switchSource('ebay')}
                    className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                      source === 'ebay' ? 'bg-black text-white' : 'text-neutral-600'
                    }`}
                  >
                    eBay
                  </button>
                  <button
                    type="button"
                    onClick={() => switchSource('tcgplayer')}
                    className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                      source === 'tcgplayer' ? 'bg-black text-white' : 'text-neutral-600'
                    }`}
                  >
                    TCGplayer
                  </button>
                </div>

                {/* 발매판 선택은 eBay·TCGplayer일 때 노출한다(둘 다 PPT라 두 판 다 있다).
                    SNKRDUNK는 일본 마켓이라 북미판 카탈로그가 사실상 없어(영문 프로모 몇
                    종뿐) 고를 게 없다. */}
                {(source === 'ebay' || source === 'tcgplayer') && (
                  <div className="inline-flex rounded-full border border-neutral-300 p-1">
                    <button
                      type="button"
                      onClick={() => setEdition('japanese')}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                        edition === 'japanese' ? 'bg-black text-white' : 'text-neutral-600'
                      }`}
                    >
                      일본판
                    </button>
                    <button
                      type="button"
                      onClick={() => setEdition('english')}
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
                        onClick={() => setEdition('korean')}
                        className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
                          edition === 'korean' ? 'bg-black text-white' : 'text-neutral-600'
                        }`}
                      >
                        한글판
                      </button>
                    )}
                  </div>
                )}
              </div>

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
                        <TcgPlayerCardDetail card={ebaySelectedCard} />
                      ) : (
                        <EbayCardDetail card={ebaySelectedCard} />
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
                  <img src={c.imageUrl} alt="" className="h-7 w-7 rounded object-contain" />
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
                  {c.imageUrl && <img src={c.imageUrl} alt="" className="h-7 w-7 rounded object-contain" />}
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
