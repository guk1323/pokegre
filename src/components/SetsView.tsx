import { useEffect, useRef, useState } from 'react';
import {
  CARD_BACK,
  cardImg,
  koName,
  koSet,
  loadSetCards,
  loadSetIndex,
  rarityRank,
  thumb,
  usable,
  type SetCard,
  type SetIndexEntry,
} from '../lib/cardCatalog';
import pokemonNames from '../data/pokemonNames.json';
import { useSubScreen } from '../lib/useSubScreen';
import { trackEvent } from '../api/localStats';
import { fetchExchangeRates, formatKrwApprox } from '../api/exchangeRate';

// 세트(발매 패키지)별 수록 카드. 데이터는 TCGdex에서 미리 긁어 public/sets/에 저장해둔 걸
// 읽는다. 일본판(ja)·북미판(en). 카드 이름은 원어로 저장돼 있어 화면에서 우리 변환기로
// 한글화한다. 공개 화면(더보기 ▾ 메뉴). 세트 데이터는 정적 public/sets JSON이라 서버 인증 불필요.
// 타입·이미지 규칙·한글화는 플리마켓 카드 고르기와 함께 쓰므로 lib/cardCatalog.ts에 있다.

const PAGE = 60;

const SERIE_LABEL: Record<string, string> = {
  '剣と盾': '소드&실드',
  'ポケットモンスターカードゲーム': '초기 시리즈 (1996~)',
};
const koSerie = (ed: 'ja' | 'en', serie: string) => SERIE_LABEL[serie] ?? koSet(ed, serie);
const shortDate = (d: string) => (d ? d.slice(0, 7).replace('-', '.') : '');

// 세트의 간판 카드. 레어도가 높은 순으로 고르되 포켓몬이 그려진 카드만 본다 —
// 등급만 보면 금박 에너지·스타디움 카드가 올라오는데(SV 시리즈의 맨 끝 카드들),
// 세트를 알아보는 데는 도움이 안 된다.
// 같은 이름이 여러 장이면(그림만 다른 같은 카드) 한 장만 남긴다.
const POKEMON_KO = (pokemonNames as { ko: string }[]).map((p) => p.ko).filter((k) => k.length >= 2);

function topCards(ed: 'ja' | 'en', cards: SetCard[], limit = 8): SetCard[] {
  const ranked = cards
    .filter((c) => rarityRank(c.r) >= 0)
    // 그림이 없는 카드는 뺀다. 간판으로 올려 놓고 "이미지 준비 중"이 뜨면 초라하다.
    .filter((c) => usable(c.img))
    .filter((c) => {
      const nm = koName(ed, c.name);
      return POKEMON_KO.some((k) => nm.includes(k));
    })
    // 등급이 같으면 뒷번호를 앞에 둔다 — 세트 뒤쪽일수록 특별 카드다.
    .sort((a, b) => rarityRank(b.r) - rarityRank(a.r) || Number(b.n) - Number(a.n));

  const out: SetCard[] = [];
  const seen = new Set<string>();
  for (const c of ranked) {
    const nm = koName(ed, c.name);
    if (seen.has(nm)) continue;
    seen.add(nm);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export function SetsView({
  onPickCard,
  initialSlug,
  onInitialSlugDone,
}: {
  onPickCard: (name: string) => void;
  // 팩 개봉 화면의 "수록 카드 보기"가 특정 세트를 바로 열 때 쓴다.
  initialSlug?: string | null;
  // 위 이동을 한 번 적용한 뒤 App의 기억을 지운다 — 안 지우면 세트별 목록에
  // 들어올 때마다 그 세트로 강제 이동돼 목록을 볼 수 없게 된다(실제 겪은 버그).
  onInitialSlugDone?: () => void;
}) {
  const [index, setIndex] = useState<SetIndexEntry[] | null>(null);
  // 일본판 / 북미판 / 모바일 포켓 3분류. Pocket은 실물 아닌 디지털 게임(Pokémon TCG Pocket)이라
  // 실물 시세가 없어서 따로 뗀다 — 북미판에 섞이면 눌러도 시세가 빈 막다른 길이 됨.
  const [tab, setTab] = useState<'ja' | 'en' | 'pocket'>('ja');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SetIndexEntry | null>(null);
  // initialSlug(팩 개봉의 "수록 카드 전체 보기")가 오면 목록 로드 뒤 그 세트를 연다.
  // 반드시 클릭과 같은 showSet을 타야 한다 — 예전에 setSelected만 해서 제목만 뜨고
  // 카드 목록이 영영 안 불려오는 버그가 있었다.
  const initialApplied = useRef(false);
  useEffect(() => {
    if (!initialSlug || !index || initialApplied.current) return;
    initialApplied.current = true;
    const hit = index.find((e) => e.slug === initialSlug);
    if (hit) {
      setTab(hit.slug.startsWith('en-') ? 'en' : 'ja');
      showSet(hit);
    }
    onInitialSlugDone?.();
    // showSet은 렌더마다 새로 만들어지는 일반 함수라 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlug, index]);
  const [cards, setCards] = useState<SetCard[] | null>(null);
  // 값이 높은 순으로 고른 힛카드. 앨범 시세를 받아 둔 세트에서만 온다.
  // 없는 세트는 예전처럼 레어도로 고른다(그때는 "주요 카드"라고 부른다).
  const [hitCards, setHitCards] = useState<{ n: string; usd: number; name: string }[] | null>(null);
  // 힛카드 값을 원화로 보여주려고 환율을 한 번 받아 둔다. 못 받으면 달러로 적는다.
  const [usdToKrw, setUsdToKrw] = useState<number | null>(null);
  useEffect(() => {
    void fetchExchangeRates().then((r) => setUsdToKrw(r?.usdToKrw ?? null));
  }, []);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const indexRef = useRef<SetIndexEntry[] | null>(null);
  indexRef.current = index;

  // 상세 화면을 열되 방문기록은 건드리지 않는다(복원·뒤로가기용).
  function showSet(s: SetIndexEntry) {
    setSelected(s);
    setCards(null);
    setShown(PAGE);
    setLoading(true);
    setHitCards(null);
    loadSetCards(s.slug)
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
    // 값 기준 힛카드. 실패하거나 시세가 없는 세트면 그냥 예전 방식으로 둔다.
    fetch(`/api/local/set-hit-cards?slug=${encodeURIComponent(s.slug)}&limit=8`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHitCards(d?.priced && d.cards?.length ? d.cards : null))
      .catch(() => setHitCards(null));
  }

  // 세트 상세를 방문기록 한 칸으로: 뒤로가기 = 세트 목록으로.
  const sub = useSubScreen<string>('set', (slug) => {
    if (!slug) {
      setSelected(null);
      return;
    }
    const s = indexRef.current?.find((x) => x.slug === slug);
    if (s) showSet(s);
  });

  useEffect(() => {
    loadSetIndex()
      .catch(() => [] as SetIndexEntry[])
      .then((list: SetIndexEntry[]) => {
        setIndex(list);
        indexRef.current = list;
        // 다른 화면에 갔다가 돌아왔을 때: 기록에 남은 상세를 복원한다.
        const slug = (window.history.state as { sub?: { set?: string } } | null)?.sub?.set;
        const s = slug ? list.find((x) => x.slug === slug) : undefined;
        if (s) showSet(s);
      })
      .catch(() => setIndex([]));
  }, []);

  function openSet(s: SetIndexEntry) {
    // 어떤 세트를 열었는지 통계에 남긴다(운영자 방문 통계의 "세트별 조회" 랭킹). 라벨은 화면 한글명.
    trackEvent('sets', koSet(s.ed, s.name));
    showSet(s);
    sub.push(s.slug);
  }

  // ── 세트 한 개의 카드 그리드 ──────────────────────────────────────────────
  if (selected) {
    const visible = (cards ?? []).slice(0, shown);
    // 값으로 고른 카드가 있으면 그것을 쓴다. 세트 파일에서 같은 번호를 찾아 그림·이름을
    // 가져온다(값만 있고 그림이 없으면 화면에 못 올린다).
    const byNum = new Map((cards ?? []).map((c) => [String(Number(c.n)), c]));
    const priced = (hitCards ?? [])
      .map((h) => byNum.get(String(Number(h.n))))
      .filter((c): c is SetCard => !!c && usable(c.img));
    const highlights = priced.length >= 3 ? priced : topCards(selected.ed, cards ?? []);
    const pricedMode = priced.length >= 3;
    // 번호 → 값(USD). 화면에 원화로 적는다.
    const usdByNum = new Map((hitCards ?? []).map((h) => [String(Number(h.n)), h.usd]));
    return (
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={() => sub.back()}
          className="mb-4 inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 hover:text-black"
        >
          ← 세트 목록
        </button>

        {/* 세트 헤더: 대표 카드 + 이름 + 정보 칩 */}
        <div className="mb-5 flex items-center gap-4">
          <div className="h-[84px] w-[60px] flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100 shadow-sm">
            {selected.cover && (
              <img src={thumb(cardImg(selected.cover), 128)} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold leading-tight text-black">{koSet(selected.ed, selected.name)}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${selected.ed === 'ja' ? 'bg-rose-500' : 'bg-indigo-500'}`}>
                {selected.ed === 'ja' ? '일본판' : '북미판'}
              </span>
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">{selected.count}종</span>
              {selected.releaseDate && (
                <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">{shortDate(selected.releaseDate)} 발매</span>
              )}
              {selected.serie && (
                <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">{koSerie(selected.ed, selected.serie)}</span>
              )}
            </div>
            <p className="mt-1.5 text-xs text-neutral-400">카드를 누르면 그 카드 시세를 검색합니다.</p>
          </div>
        </div>

        {loading ? (
          // 스켈레톤: 자리를 미리 잡아 로딩이 덜 튀어 보인다.
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[5/7] rounded-xl bg-neutral-100" />
                <div className="mt-2 h-3 w-3/4 rounded bg-neutral-100" />
                <div className="mt-1 h-2.5 w-1/3 rounded bg-neutral-100" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* 이 세트의 간판 카드. 레어도가 채워진 세트에만 나온다(원본 DB에 없는 세트가
                많다). 없으면 이 줄을 통째로 감춘다 — 억지로 채우면 엉뚱한 카드가 올라간다. */}
            {highlights.length > 0 && (
              <div className="mb-6">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-bold text-black">
                    {pricedMode ? '이 세트의 힛카드' : '이 세트의 주요 카드'}
                  </p>
                  {/* 기준을 안 밝히면 "왜 스니커덩크 값과 다르냐"는 오해가 생긴다.
                      등급 카드가 아니라 미감정 생카드의 TCGplayer 마켓가다. */}
                  {pricedMode && (
                    <span className="text-[11px] text-neutral-400">TCGplayer 마켓가 · 미감정 기준</span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-x-3 gap-y-4">
                  {highlights.map((c) => {
                    const nm = koName(selected.ed, c.name);
                    return (
                      <button key={`top-${c.n}`} type="button" onClick={() => onPickCard(nm)} className="group text-left">
                        <div className="aspect-[5/7] overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200/70 transition group-hover:shadow-lg">
                          <img
                            src={usable(c.img) ? thumb(cardImg(c.img), 320) : CARD_BACK}
                            alt={nm}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
                            onError={(e) => {
                              const img = e.currentTarget;
                              if (usable(c.img) && img.src !== cardImg(c.img)) img.src = cardImg(c.img);
                              else if (!img.src.endsWith(CARD_BACK)) img.src = CARD_BACK;
                            }}
                          />
                        </div>
                        <p className="mt-1.5 line-clamp-1 text-[11px] font-bold text-black">{nm}</p>
                        {(() => {
                          const usd = usdByNum.get(String(Number(c.n)));
                          if (!usd) return null;
                          return (
                            <p className="text-[11px] text-neutral-500">
                              {usdToKrw ? formatKrwApprox(usd * usdToKrw) : `$${Math.round(usd).toLocaleString()}`}
                            </p>
                          );
                        })()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
              {visible.map((c, i) => {
                const nm = koName(selected.ed, c.name);
                return (
                  <button
                    key={`${c.n}-${i}`}
                    type="button"
                    onClick={() => onPickCard(nm)}
                    className="group text-left"
                  >
                    <div className="aspect-[5/7] overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200/70 transition group-hover:shadow-lg group-hover:ring-neutral-300">
                      <img
                        src={usable(c.img) ? thumb(cardImg(c.img), 320) : CARD_BACK}
                        alt={nm}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
                        onError={(e) => {
                          // 축소 CDN 실패 → 원본 한 번 더 → 그래도 없으면 뒷면(빈칸 방지).
                          const img = e.currentTarget;
                          if (usable(c.img) && img.src !== cardImg(c.img)) img.src = cardImg(c.img);
                          else if (!img.src.endsWith(CARD_BACK)) img.src = CARD_BACK;
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-start justify-between gap-1.5">
                      <p className="line-clamp-1 text-xs font-bold text-black">{nm}</p>
                      <span className="flex-shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-500">
                        {c.n}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {shown < (cards?.length ?? 0) && (
              <div className="mt-8 text-center">
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="rounded-full bg-black px-6 py-2.5 text-sm font-semibold text-white hover:opacity-85"
                >
                  더 보기 ({(cards?.length ?? 0) - shown}장 남음)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── 세트 목록 ─────────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const isPocket = (s: SetIndexEntry) => /pocket/i.test(s.serie || '');
  const list = (index ?? [])
    .filter((s) => (tab === 'pocket' ? isPocket(s) : s.ed === tab && !isPocket(s)))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || koSet(s.ed, s.name).toLowerCase().includes(q));
  // 시리즈별로 묶는다(등장 순서 = 발매 최신순 유지). 평평한 나열보다 훨씬 정돈돼 보인다.
  const groups: { serie: string; sets: SetIndexEntry[] }[] = [];
  for (const s of list) {
    const key = s.serie || '기타';
    const g = groups.find((x) => x.serie === key);
    if (g) g.sets.push(s);
    else groups.push({ serie: key, sets: [s] });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-black">세트별 목록 <span className="align-middle text-[11px] font-semibold text-amber-500">베타</span></h2>
          <p className="mt-1 text-xs text-neutral-400">발매 팩별로 수록 카드를 볼 수 있습니다. 일부 세트는 이미지·이름을 다듬는 중입니다.</p>
        </div>
        {index && index.length > 0 && (
          <div className="relative w-full flex-shrink-0 sm:w-60 md:w-72">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="세트 찾기"
              className="w-full rounded-full border border-neutral-200 bg-white py-2.5 pl-4 pr-9 text-sm outline-none focus:border-neutral-400"
            />
            {query && (
              <button
                type="button"
                aria-label="검색어 지우기"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 판 선택: 일본판 / 북미판 / 모바일 포켓 */}
      <div className="mb-4 inline-flex rounded-full border border-neutral-300 p-1">
        {([
          ['ja', '일본판'],
          ['en', '북미판'],
          ['pocket', '모바일 포켓'],
        ] as const).map(([e, label]) => (
          <button
            key={e}
            type="button"
            onClick={() => setTab(e)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === e ? 'bg-black text-white' : 'text-neutral-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'pocket' && (
        <p className="-mt-2 mb-4 text-[11px] text-neutral-400">모바일 게임(Pokémon TCG Pocket) 카드입니다. 실물 카드가 아니라 시세는 없습니다.</p>
      )}

      {index === null ? (
        // 스켈레톤: 로딩 중에도 갤러리 자리를 미리 잡는다.
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[5/7] rounded-xl bg-neutral-100" />
              <div className="mt-2 h-3 w-4/5 rounded bg-neutral-100" />
              <div className="mt-1 h-2.5 w-2/5 rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="py-20 text-center">
          <p className="mt-2 text-sm font-semibold text-neutral-500">검색 결과가 없습니다</p>
          <p className="mt-1 text-xs text-neutral-400">다른 이름으로 찾아보세요.</p>
        </div>
      ) : (
        groups.map((grp) => (
          <section key={grp.serie} className="mb-8">
            {/* 시리즈 헤더 */}
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="text-sm font-extrabold text-neutral-900">{koSerie(grp.sets[0]?.ed ?? 'en', grp.serie)}</h3>
              <span className="text-[11px] font-semibold text-neutral-400">{grp.sets.length}개 세트</span>
              <span className="ml-1 h-px flex-1 bg-neutral-100" />
            </div>
            {/* 세로 갤러리 타일: 대표 카드(1번 카드)로 통일 — 전 세트 100% 일관 */}
            <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {grp.sets.map((s) => (
                <button key={s.slug} type="button" onClick={() => openSet(s)} className="group text-left">
                  <div className="aspect-[5/7] overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200/70 transition group-hover:shadow-lg group-hover:ring-neutral-300">
                    <img
                      src={usable(s.cover) ? thumb(cardImg(s.cover), 200) : CARD_BACK}
                      alt={s.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (usable(s.cover) && img.src !== cardImg(s.cover)) img.src = cardImg(s.cover);
                        else if (!img.src.endsWith(CARD_BACK)) img.src = CARD_BACK;
                      }}
                    />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs font-bold leading-snug text-black">{koSet(s.ed, s.name)}</p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-neutral-400">
                    {s.count}종{s.releaseDate ? ` · ${shortDate(s.releaseDate)}` : ''}
                  </p>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
