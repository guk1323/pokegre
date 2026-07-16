import { useEffect, useMemo, useState } from 'react';
import { fetchMoreUniqueCards, type SnkrdunkCard } from './api/snkrdunk';
import { fetchPopularSearches, trackSearch, type PopularSearch } from './api/localStats';
import { fetchPokemonNews, type KoreanNewsItem } from './api/koreanNews';
import { fetchRemoteSuggestions } from './api/suggestions';
import { searchEbayCards, EBAY_RATE_LIMITED, type CardEdition, type EbayCard } from './api/ebayPrices';
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
import { EbayCardTile } from './components/EbayCardTile';
import { EbayCardDetail } from './components/EbayCardDetail';
import { CardScanButton } from './components/CardScanButton';
import { Community } from './Community';
import { Footer } from './components/legal/Footer';
import { NicknameSetup } from './components/NicknameSetup';
import { LoginModal } from './components/LoginModal';
import { MyPage } from './components/MyPage';
import { ReportInbox } from './components/ReportInbox';
import { fetchMe, logout, mergeCollections, saveCollections } from './api/auth';

const INITIAL_TARGET = 16;
const LOAD_MORE_TARGET = 12;

type MainView = 'cards' | 'mypage' | 'community' | 'reports';
type PriceSource = 'snkrdunk' | 'ebay';

// 오른쪽 상세보기 패널이 비어 있을 때도 320px 칸을 그대로 차지해서 흰 여백만
// 남는 걸 막기 위해, 상세 카드가 있을 때만 2단 그리드로 감싸고 없으면 본문이
// 전체 폭을 그대로 쓰게 한다.
function DetailLayout({ main, detail }: { main: React.ReactNode; detail: React.ReactNode | null }) {
  if (!detail) return <div>{main}</div>;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="min-w-0">{main}</div>
      <div>{detail}</div>
    </div>
  );
}

function App() {
  const [view, setView] = useState<MainView>('cards');
  const [source, setSource] = useState<PriceSource>('snkrdunk');
  const [query, setQuery] = useState('');
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
  const [edition, setEdition] = useState<CardEdition>('japanese');
  const [nickname, setNickname] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [createdAt, setCreatedAt] = useState<number | undefined>(undefined);
  // 신고함 탭을 보여줄지 정하는 값일 뿐이다. 이걸 위조해도 서버가 신고 목록을
  // 안 주므로 아무것도 못 본다.
  const [isAdmin, setIsAdmin] = useState(false);
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
    if (params.has('setNickname') || params.has('login')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function handleLogout() {
    await logout();
    setLoggedIn(false);
    setNickname(null);
    setCreatedAt(undefined);
    setIsAdmin(false);
    // 운영자가 로그아웃했는데 신고함이 그대로 열려 있으면 빈 화면만 남는다.
    if (view === 'reports') setView('cards');
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
          setLastPage(lastPage);
          setExhausted(exhausted);
          setSelectedId((prev) => (items.some((c) => c.apparelId === prev) ? prev : (items[0]?.apparelId ?? null)));
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
        .then((cards) => {
          setEbayItems(cards);
          setEbaySelectedId((prev) =>
            cards.some((c) => c.tcgPlayerId === prev) ? prev : (cards[0]?.tcgPlayerId ?? null),
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
      trackSearch(canonicalizeSearchTerm(trimmed));
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

  const boxResults = useMemo(() => items.filter((c) => c.category === 'box'), [items]);
  const cardResults = useMemo(() => items.filter((c) => c.category === 'card'), [items]);

  useEffect(() => {
    setSelectedId((prev) => (items.some((c) => c.apparelId === prev) ? prev : (items[0]?.apparelId ?? null)));
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
                <h1 className="text-xl font-extrabold text-black tracking-tight">pokegre</h1>
                <p className="text-sm text-neutral-500 mt-1">
                  일본판·북미판 포켓몬카드 시세 · SNKRDUNK 실거래가와 eBay 등급별 낙찰가
                </p>
              </div>
              <nav className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setView('cards')}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                    view === 'cards' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  카드 시세
                </button>
                <button
                  type="button"
                  onClick={() => setView('community')}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                    view === 'community' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  커뮤니티
                </button>
                {/* 운영자에게만 보인다. 다른 사람 메뉴를 깔끔하게 두려는 것뿐이고,
                    실제 차단은 서버가 한다 — 주소를 직접 쳐도 목록을 안 준다. */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setView('reports')}
                    className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                      view === 'reports' ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    신고함
                  </button>
                )}
                {/* 로그인 버튼을 헤더에 두면 공급자가 늘 때마다(네이버 등) 자리가 모자란다.
                    진입점을 마이페이지 한 곳으로 모으고, 헤더엔 상태만 드러낸다. */}
                <button
                  type="button"
                  onClick={() => setView('mypage')}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
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
          ) : view === 'community' ? (
            <Community loggedIn={loggedIn} onRequestLogin={() => setLoginOpen(true)} />
          ) : view === 'mypage' ? (
            <DetailLayout
              main={myPageMain}
              detail={interestSelectedCard ? <CardDetail card={interestSelectedCard} /> : null}
            />
          ) : (
            <>
              <div className="mb-4 max-w-xl">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchBar
                      value={query}
                      onChange={setQuery}
                      onFocus={() => setSuggestionsOpen(true)}
                      onBlur={() => setSuggestionsOpen(false)}
                    >
                      {suggestionsOpen && <SearchSuggestions items={suggestions} onSelect={handleSelectSuggestion} />}
                    </SearchBar>
                  </div>
                  <CardScanButton onResult={(name) => setQuery(name)} />
                </div>
                {showTranslationHint && (
                  <p className="text-xs text-neutral-400 mt-2">
                    '{query.trim()}' → '{translatedQuery}'로 검색했습니다.
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
                />
              ) : (
                <DetailLayout main={searchMain} detail={selectedCard ? <CardDetail card={selectedCard} /> : null} />
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
