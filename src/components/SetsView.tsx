import { useEffect, useRef, useState } from 'react';
import { koreanizeTitle } from '../lib/koreanizeTitle';
import { koreanizeEnglishCardName } from '../lib/koreanizeEnglishTitle';
import { useSubScreen } from '../lib/useSubScreen';

// 세트(발매 패키지)별 수록 카드. 데이터는 TCGdex에서 미리 긁어 public/sets/에 저장해둔 걸
// 읽는다. 일본판(ja)·북미판(en). 카드 이름은 원어로 저장돼 있어 화면에서 우리 변환기로
// 한글화한다. 지금은 운영자만 보는 화면(App에서 admin 게이트).
interface SetIndexEntry {
  slug: string;
  ed: 'ja' | 'en';
  id: string;
  name: string;
  count: number;
  releaseDate: string;
  serie: string;
  boxImg?: string; // 스니덩크 박스(팩) 상품 사진. 제일 우선.
  logo: string; // 팩(패키지) 로고 이미지 URL.
  cover: string; // 첫 카드 이미지(최후 대체).
}
interface SetCard {
  n: string;
  name: string;
  img: string;
}
interface SetFile {
  ed: 'ja' | 'en';
  id: string;
  name: string;
  cards: SetCard[];
}

const PAGE = 60;

// 카드 이미지 주소. TCGdex는 베이스 주소라 /low.webp를 붙이고,
// 다른 소스(리미트리스·포켈렉터·스니덩크·pokemontcg CDN)는 완성된 주소 그대로 쓴다.
const cardImg = (base: string) =>
  !base ? '' : /\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base}/low.webp`;
// 목록 썸네일은 64px인데 원본(로고 127KB·박스 59KB)을 그대로 받으면 느리다.
// 무료 CDN(wsrv.nl)으로 필요한 크기의 WebP로 줄여 받는다(~5KB). w는 표시의 2배(레티나).
const thumb = (url: string, w: number) => (url ? `/api/img?u=${encodeURIComponent(url)}&w=${w}` : '');
// 일본판은 일본어 변환 후, TCGdex에 영어로 섞여 오는 이름(옛 세트의 Koffing 등)까지
// 영어 변환기로 한 번 더 잡는다. 북미판은 영어 변환만.
const koName = (ed: 'ja' | 'en', name: string) =>
  ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name);
const koSet = (ed: 'ja' | 'en', name: string) => (ed === 'ja' ? koreanizeTitle(name) : name);
// 시리즈 이름 중 자동 변환이 어색한 것만 손으로 잡는다.
// (剣と盾는 と가 "토"로 변환돼 "剣토盾"처럼 깨진다.)
const SERIE_LABEL: Record<string, string> = {
  '剣と盾': '소드&실드',
  'ポケットモンスターカードゲーム': '초기 시리즈 (1996~)',
};
const koSerie = (ed: 'ja' | 'en', serie: string) => SERIE_LABEL[serie] ?? koSet(ed, serie);
const shortDate = (d: string) => (d ? d.slice(0, 7).replace('-', '.') : '');

export function SetsView({ onPickCard }: { onPickCard: (name: string) => void }) {
  const [index, setIndex] = useState<SetIndexEntry[] | null>(null);
  const [ed, setEd] = useState<'ja' | 'en'>('ja');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SetIndexEntry | null>(null);
  const [cards, setCards] = useState<SetCard[] | null>(null);
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
    fetch(`/sets/${s.slug}.json`)
      .then((r) => r.json())
      .then((d: SetFile) => setCards(d.cards))
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
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
    fetch('/sets/index.json')
      .then((r) => (r.ok ? r.json() : []))
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
    showSet(s);
    sub.push(s.slug);
  }

  // ── 세트 한 개의 카드 그리드 ──────────────────────────────────────────────
  if (selected) {
    const visible = (cards ?? []).slice(0, shown);
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
            <p className="mt-1.5 text-xs text-neutral-400">카드를 누르면 그 카드 시세를 검색해요.</p>
          </div>
        </div>

        {loading ? (
          // 스켈레톤: 자리를 미리 잡아 로딩이 덜 튀어 보인다.
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4">
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
            <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4">
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
                      {c.img && (
                        <img
                          src={thumb(cardImg(c.img), 320)}
                          alt={nm}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
                          onError={(e) => {
                            // 축소 CDN이 실패하면 원본으로 한 번 더 시도한다.
                            const img = e.currentTarget;
                            if (img.src !== cardImg(c.img)) img.src = cardImg(c.img);
                            else img.style.display = 'none';
                          }}
                        />
                      )}
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
  const list = (index ?? [])
    .filter((s) => s.ed === ed)
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
          <h2 className="text-lg font-bold text-black">세트별 카드 <span className="align-middle text-[11px] font-semibold text-amber-600">운영자</span></h2>
          <p className="mt-1 text-xs text-neutral-400">발매 팩별로 수록 카드를 봐요.</p>
        </div>
        {index && index.length > 0 && (
          <div className="relative w-full flex-shrink-0 sm:w-60 md:w-72">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">🔍</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="세트 찾기"
              className="w-full rounded-full border border-neutral-200 bg-white py-2.5 pl-10 pr-9 text-sm outline-none focus:border-neutral-400"
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

      {/* 판 선택 */}
      <div className="mb-4 inline-flex rounded-full border border-neutral-300 p-1">
        {(['ja', 'en'] as const).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEd(e)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${ed === e ? 'bg-black text-white' : 'text-neutral-600'}`}
          >
            {e === 'ja' ? '일본판' : '북미판'}
          </button>
        ))}
      </div>

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
          <p className="text-3xl">🔍</p>
          <p className="mt-2 text-sm font-semibold text-neutral-500">검색 결과가 없어요</p>
          <p className="mt-1 text-xs text-neutral-400">다른 이름으로 찾아보세요.</p>
        </div>
      ) : (
        groups.map((grp) => (
          <section key={grp.serie} className="mb-8">
            {/* 시리즈 헤더 */}
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="text-sm font-extrabold text-neutral-900">{koSerie(ed, grp.serie)}</h3>
              <span className="text-[11px] font-semibold text-neutral-400">{grp.sets.length}개 세트</span>
              <span className="ml-1 h-px flex-1 bg-neutral-100" />
            </div>
            {/* 세로 갤러리 타일: 대표 카드(1번 카드)로 통일 — 전 세트 100% 일관 */}
            <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {grp.sets.map((s) => (
                <button key={s.slug} type="button" onClick={() => openSet(s)} className="group text-left">
                  <div className="aspect-[5/7] overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200/70 transition group-hover:shadow-lg group-hover:ring-neutral-300">
                    <img
                      src={thumb(cardImg(s.cover), 200)}
                      alt={s.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.src !== cardImg(s.cover)) img.src = cardImg(s.cover);
                        else img.style.display = 'none';
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
