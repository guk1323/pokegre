import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMoreUniqueCards, type SnkrdunkCard } from './api/snkrdunk';
import { fetchPopularSearches, trackEvent, trackSearch, trackVisit, type PopularSearch } from './api/localStats';
import { fetchPokemonNews, type KoreanNewsItem } from './api/koreanNews';
import { fetchRemoteSuggestions } from './api/suggestions';
import { searchEbayCards, EBAY_RATE_LIMITED, EBAY_PAGE_SIZE, type CardEdition, type EbayCard } from './api/ebayPrices';
import { translateSearchQuery, canonicalizeSearchTerm } from './lib/translateQuery';
import { getLocalSuggestions } from './lib/localSuggestions';
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
import { CardDetail } from './components/CardDetail';
import { CardRow } from './components/CardRow';
import { PopularSearches } from './components/PopularSearches';
import { PokemonNews } from './components/PokemonNews';
import { OnboardingBanner } from './components/OnboardingBanner';
import { EbayCardTile } from './components/EbayCardTile';
import { EbayCardDetail } from './components/EbayCardDetail';
import { CardScanButton } from './components/CardScanButton';
import { reportScanMiss, scanCard, type CardScanResult } from './api/cardScan';
import { Community } from './Community';
import { Footer } from './components/legal/Footer';
import { NicknameSetup } from './components/NicknameSetup';
import { LoginModal } from './components/LoginModal';
import { MyPage } from './components/MyPage';
import { ReportInbox } from './components/ReportInbox';
import { VisitStats } from './components/VisitStats';
import { TitleFeedbackList } from './components/TitleFeedbackList';
import { CenteringTool } from './components/CenteringTool';
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

type MainView = 'cards' | 'mypage' | 'community' | 'centering' | 'reports' | 'stats';
type PriceSource = 'snkrdunk' | 'ebay';

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

function App() {
  const [view, setView] = useState<MainView>('cards');
  const [source, setSource] = useState<PriceSource>('snkrdunk');
  const [query, setQuery] = useState('');
  // 방금 스캔한 결과. "이 카드 아니에요" 신고에 쓰고, 사용자가 직접 타이핑하면 지운다.
  const [scannedResult, setScannedResult] = useState<CardScanResult | null>(null);
  const [scanReported, setScanReported] = useState(false);
  // 마지막으로 "결과가 실제로 나온" 검색어와 개수. 인기 검색어 집계 때, 결과가 0인
  // 오타·타이핑 조각이 순위에 끼는 걸 막는 데 쓴다(집계 시점에 최신값을 참조).
  const searchResultRef = useRef<{ query: string; count: number; source: PriceSource }>({ query: '', count: 0, source: 'snkrdunk' });
  const [items, setItems] = useState<SnkrdunkCard[]>([]);
  const [lastPage, setLastPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [news, setNews] = useState<KoreanNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [ebayItems, setEbayItems] = useState<EbayCard[]>([]);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [ebaySelectedId, setEbaySelectedId] = useState<string | null>(null);
  // "더 보기"용. ebayOffset은 지금까지 요청한 원본 카드 수(페이지 크기의 배수)다.
  const [ebayOffset, setEbayOffset] = useState(0);
  const [ebayHasMore, setEbayHasMore] = useState(false);
  const [ebayLoadingMore, setEbayLoadingMore] = useState(false);
  const [edition, setEdition] = useState<CardEdition>('japanese');
  const [nickname, setNickname] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [createdAt, setCreatedAt] = useState<number | undefined>(undefined);
  // 신고함 탭을 보여줄지 정하는 값일 뿐이다. 이걸 위조해도 서버가 신고 목록을
  // 안 주므로 아무것도 못 본다.
  const [isAdmin, setIsAdmin] = useState(false);
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
      if (link === 'ok') window.alert('계정을 연결했어요. 이제 어느 쪽으로 로그인해도 같은 계정으로 들어옵니다.');
      else if (link === 'taken') window.alert('이미 다른 계정에 연결된 로그인 수단이에요.');
      else window.alert('연결하지 못했어요. 다시 시도해주세요.');
    }

    if (params.has('setNickname') || params.has('login') || params.has('link')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // 처음 화면(카드 시세 홈)으로. 검색·선택·화면을 비우고 맨 위로 올린다.
  const goHome = () => {
    setView('cards');
    setQuery('');
    setSelectedId(null);
    setEbaySelectedId(null);
    setInterestSelectedId(null);
    window.scrollTo({ top: 0 });
  };
  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;

  // 스캔 결과를 검색어·소스·판(일/북미)에 반영한다. 카메라 버튼과 센터링 도구가 공유한다.
  const applyScanResult = (result: CardScanResult) => {
    const num = result.cardNumber;
    const snkrdunk = num ? [result.setCode, num].filter(Boolean).join(' ') : (result.pokemonNameEn ?? '');
    const ebay = num ? [result.pokemonNameEn, num].filter(Boolean).join(' ') : (result.pokemonNameEn ?? '');
    const ed: 'japanese' | 'english' = result.edition === 'english' ? 'english' : 'japanese';
    const target = ed === 'english' ? 'ebay' : source;
    setEdition(ed);
    setSource(target);
    setQuery(target === 'ebay' ? ebay : snkrdunk);
    setScannedResult(result);
    setScanReported(false);
  };

  // 센터링 도구의 "이 카드 시세 보러 가기": 찍어둔 사진을 그대로 스캔해 시세 화면으로.
  const searchByPhoto = async (file: File) => {
    trackEvent('scan');
    const result = await scanCard(file);
    if (!result.found || !(result.pokemonNameEn || result.cardNumber)) {
      throw new Error('카드를 인식하지 못했어요. 앞면이 또렷한 사진으로 다시 해보세요.');
    }
    applyScanResult(result);
    setView('cards');
    window.scrollTo({ top: 0 });
  };

  // 안드로이드 뒤로가기(제스처·물리 버튼)로 사이트를 통째로 나가버리는 걸 막는다.
  // 검색 중이거나 홈이 아닌 화면(커뮤니티·마이페이지 등)에 있을 때 뒤로가기를 누르면,
  // 사이트를 벗어나는 대신 홈으로 돌아오게 한다. 홈에서는 가드가 없어 정상적으로 나간다.
  // 폰의 카드 상세 시트(DetailSheet)는 자체적으로 뒤로가기를 처리하는데, 시트는 이 가드
  // 위에 쌓이므로(검색→카드 탭 순서) 뒤로가기 한 번은 시트만 닫고, 그다음이 홈 복귀다.
  // 시트가 최상단일 때는 history.state.appDeep가 아직 남아 있어 이 핸들러가 넘긴다.
  const isDeep = view !== 'cards' || query.trim() !== '';
  useEffect(() => {
    if (!isDeep) return;
    const onPop = () => {
      if (window.history.state?.appDeep) return;
      goHomeRef.current();
    };
    window.history.pushState({ appDeep: true }, '');
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.history.state?.appDeep) window.history.back();
    };
  }, [isDeep]);

  async function handleLogout() {
    await logout();
    setLoggedIn(false);
    setNickname(null);
    setCreatedAt(undefined);
    setIsAdmin(false);
    setProviders([]);
    // 운영자가 로그아웃했는데 운영자 전용 화면이 그대로 열려 있으면 빈 화면만 남는다.
    if (view === 'reports' || view === 'stats') setView('cards');
  }

  useEffect(() => {
    fetchPokemonNews()
      .then(setNews)
      .catch(() => undefined)
      .finally(() => setNewsLoading(false));
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      return;
    }

    setSuggestions(getLocalSuggestions(trimmed));

    let cancelled = false;
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
  }, [query, source]);

  // 이베이 쪽은 검색당 크레딧이 소모돼서 스니덩크(350ms)보다 디바운스를 여유 있게 뒀다.
  useEffect(() => {
    if (source !== 'ebay') return;

    const trimmed = query.trim();
    if (!trimmed) {
      setEbayItems([]);
      setEbayError(null);
      return;
    }

    const timer = setTimeout(() => {
      setEbayLoading(true);
      setEbayError(null);
      searchEbayCards(trimmed, edition)
        .then(({ cards, hasMore }) => {
          setEbayItems(cards);
          searchResultRef.current = { query: trimmed, count: cards.length, source: 'ebay' };
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
            err.message === EBAY_RATE_LIMITED
              ? 'eBay 시세 조회 한도를 초과했어요. 잠시 후 다시 시도해주세요.'
              : 'eBay 시세를 불러오지 못했습니다.',
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
      trackSearch(canonicalizeSearchTerm(trimmed));
      // 어느 소스로 실제 검색이 이뤄졌는지만 센다(개인정보 없음).
      trackEvent(r.source === 'ebay' ? 'ebay_search' : 'snkrdunk_search');
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
    searchEbayCards(query.trim(), edition, ebayOffset)
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
  }

  const selectedCard = items.find((c) => c.apparelId === selectedId) ?? null;
  const interestSelectedCard =
    [...recentlyViewed, ...favorites].find((c) => c.apparelId === interestSelectedId) ?? null;
  const ebaySelectedCard = ebayItems.find((c) => c.tcgPlayerId === ebaySelectedId) ?? null;

  const translatedQuery = useMemo(() => translateSearchQuery(query), [query]);
  const showTranslationHint = source === 'snkrdunk' && translatedQuery && translatedQuery !== query.trim();
  const hasMore = !exhausted;
  const isHome = query.trim().length === 0;

  const homeMain = (
    <>
      <OnboardingBanner />
      <div className="mb-6">
        <PopularSearches items={popularSearches} asOf={popularAsOf} loading={popularLoading} onSelect={setQuery} />
      </div>
      <PokemonNews items={news} loading={newsLoading} />
    </>
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
        <p className="text-sm text-rose-500 py-12 text-center">{error}</p>
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

  const ebayMain = (
    <>
      {!ebayError && (
        <p className="text-sm text-neutral-500 mb-3">
          {ebayLoading ? '검색 중...' : `eBay 등급 데이터 ${ebayItems.length}종 표시`}
        </p>
      )}

      {ebayError ? (
        <p className="text-sm text-rose-500 py-12 text-center">{ebayError}</p>
      ) : !ebayLoading && ebayItems.length === 0 ? (
        <p className="text-sm text-neutral-400 py-12 text-center">eBay 낙찰 데이터가 없습니다.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {ebayItems.map((card) => (
              <EbayCardTile
                key={card.tcgPlayerId}
                card={card}
                selected={card.tcgPlayerId === ebaySelectedId}
                onSelect={setEbaySelectedId}
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
              <div>
                {/* 로고를 누르면 처음 화면(카드 시세 홈)으로. 검색·선택을 비우고 맨 위로
                    올린다. 사이트 아무 데서나 "처음으로" 돌아오는 흔한 길이다. */}
                <h1 className="text-xl font-extrabold text-black tracking-tight">
                  <button type="button" onClick={goHome} className="hover:opacity-70">
                    pokegre
                  </button>
                </h1>
                {/* 헤더는 "여기가 뭐 하는 곳"인지만 짧게 알린다. 소스(스니덩크·이베이)나
                    시세 읽는 법 같은 상세는 커뮤니티 이용안내 공지가 대신한다. */}
                <p className="text-sm text-neutral-500 mt-1">일본판·북미판 포켓몬 카드 시세</p>
              </div>
              {/* 좁은 화면에서 메뉴 글자가 단어 중간에 꺾이지 않게, 버튼 단위로만 줄바꿈한다. */}
              <nav className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setView('cards')}
                  className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
                    view === 'cards' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  카드 시세
                </button>
                <button
                  type="button"
                  onClick={() => setView('community')}
                  className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
                    view === 'community' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  커뮤니티
                </button>
                {/* 아직 다듬는 중인 기능이라 운영자(본인)에게만 보인다. 완성되면 이 조건을
                    풀어 모두에게 공개한다. 서버 데이터가 없는 순수 클라이언트 도구라 굳이
                    서버 차단은 필요 없고, 메뉴만 감춰도 일반 방문자는 접근 경로가 없다.
                    개발 모드에서는 레이아웃 확인을 위해 항상 보이게 한다(배포엔 영향 없음). */}
                {(isAdmin || import.meta.env.DEV) && (
                  <button
                    type="button"
                    onClick={() => setView('centering')}
                    className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
                      view === 'centering' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    센터링<span className="ml-1 text-[10px] text-amber-500">베타</span>
                  </button>
                )}
                {/* 운영자에게만 보인다. 다른 사람 메뉴를 깔끔하게 두려는 것뿐이고,
                    실제 차단은 서버가 한다 — 주소를 직접 쳐도 목록을 안 준다. */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setView('reports')}
                    className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
                      view === 'reports' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    신고함
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setView('stats')}
                    className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
                      view === 'stats' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    통계
                  </button>
                )}
                {/* 로그인 버튼을 헤더에 두면 공급자가 늘 때마다(네이버 등) 자리가 모자란다.
                    진입점을 마이페이지 한 곳으로 모으고, 헤더엔 상태만 드러낸다. */}
                <button
                  type="button"
                  onClick={() => setView('mypage')}
                  className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
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
          {view === 'reports' ? (
            <ReportInbox />
          ) : view === 'stats' ? (
            <div className="space-y-10">
              <VisitStats />
              <TitleFeedbackList />
            </div>
          ) : view === 'community' ? (
            <Community loggedIn={loggedIn} isAdmin={isAdmin} onRequestLogin={() => setLoginOpen(true)} />
          ) : view === 'centering' ? (
            <div className="mx-auto max-w-4xl">
              <CenteringTool onSearchByPhoto={searchByPhoto} />
            </div>
          ) : view === 'mypage' ? (
            <DetailLayout
              main={myPageMain}
              detail={interestSelectedCard ? <CardDetail card={interestSelectedCard} /> : null}
              onCloseDetail={() => setInterestSelectedId(null)}
            />
          ) : (
            <>
              <div className="mb-4 max-w-xl">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchBar
                      value={query}
                      onChange={(v) => {
                        setQuery(v);
                        // 직접 타이핑하면 방금 스캔 맥락은 끝난 것 — 신고 링크를 거둔다.
                        setScannedResult(null);
                      }}
                      onFocus={() => setSuggestionsOpen(true)}
                      onBlur={() => setSuggestionsOpen(false)}
                    >
                      {suggestionsOpen && <SearchSuggestions items={suggestions} onSelect={handleSelectSuggestion} />}
                    </SearchBar>
                  </div>
                  {/* 북미판(영문) 카드는 SNKRDUNK에 없으니 이베이로 보내고, 일본어·한국어
                      카드는 지금 보던 소스를 유지한다. 소스에 맞는 검색어를 고른다 —
                      SNKRDUNK는 세트+번호(확실), 이베이는 영어 이름+번호. */}
                  <CardScanButton
                    onResult={({ snkrdunk, ebay, edition: ed, result }) => {
                      const target = ed === 'english' ? 'ebay' : source;
                      setEdition(ed);
                      setSource(target);
                      setQuery(target === 'ebay' ? ebay : snkrdunk);
                      setScannedResult(result);
                      setScanReported(false);
                    }}
                  />
                </div>
                {showTranslationHint && (
                  <p className="text-xs text-neutral-400 mt-2">
                    '{query.trim()}' → '{translatedQuery}'로 검색했습니다.
                  </p>
                )}
                {/* 스캔 직후에만 뜨는 신고 링크. 사진은 안 보내고 "뭐라고 읽었는지"만 보낸다. */}
                {scannedResult && (
                  <p className="text-xs text-neutral-400 mt-2">
                    {scanReported ? (
                      '알려주셔서 감사해요! 개선에 참고할게요.'
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
                          스캔이 틀렸어요
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
                    onClick={() => setSource('snkrdunk')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      source === 'snkrdunk' ? 'bg-black text-white' : 'text-neutral-600'
                    }`}
                  >
                    SNKRDUNK
                  </button>
                  <button
                    type="button"
                    onClick={() => setSource('ebay')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      source === 'ebay' ? 'bg-black text-white' : 'text-neutral-600'
                    }`}
                  >
                    eBay
                  </button>
                </div>

                {/* 발매판 선택은 eBay일 때만 노출한다. SNKRDUNK는 일본 마켓이라
                    북미판 카탈로그가 사실상 없어서(영문 프로모 몇 종뿐) 고를 게 없다. */}
                {source === 'ebay' && (
                  <div className="inline-flex rounded-full border border-neutral-300 p-1">
                    <button
                      type="button"
                      onClick={() => setEdition('japanese')}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        edition === 'japanese' ? 'bg-black text-white' : 'text-neutral-600'
                      }`}
                    >
                      일본판
                    </button>
                    <button
                      type="button"
                      onClick={() => setEdition('english')}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        edition === 'english' ? 'bg-black text-white' : 'text-neutral-600'
                      }`}
                    >
                      북미판
                    </button>
                  </div>
                )}
              </div>

              {/* 검색어가 없으면 소스와 무관하게 항상 홈(인기 검색어 + 뉴스)을 띄운다.
                  스니덩크/이베이 토글은 "검색 결과를 어느 소스에서 가져올지"만 정하는
                  설정이라, 홈 화면까지 바꾸지는 않는다. */}
              {isHome ? (
                <DetailLayout main={homeMain} detail={null} />
              ) : source === 'ebay' ? (
                <DetailLayout
                  main={ebayMain}
                  detail={ebaySelectedCard ? <EbayCardDetail card={ebaySelectedCard} /> : null}
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
        </main>

        <Footer />
      </div>

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
