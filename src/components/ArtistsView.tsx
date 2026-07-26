import { useEffect, useRef, useState } from 'react';
import { trackEvent } from '../api/localStats';
import { koreanizeEnglishCardName } from '../lib/koreanizeEnglishTitle';
import { koSetName } from '../lib/setNameKo';
import { useSubScreen } from '../lib/useSubScreen';

// 작가별 카드 모음. 스니커덩크엔 일러스트레이터 정보가 없어서, 작가 정보가 있는 해외
// 카드 DB(pokemontcg.io)에서 미리 긁어 public/artists/에 저장해둔 데이터를 읽는다.
// 카드 아트는 일본판도 같은 작가라, 카드를 누르면 그 이름으로 우리 사이트 시세 검색으로
// 넘어간다.
interface ArtistIndexEntry {
  slug: string;
  ko: string;
  en: string;
  note: string;
  era: string;
  count: number;
  cover: string;
}

interface ArtistCard {
  name: string;
  number: string;
  set: string;
  img: string;
}

interface ArtistFile {
  en: string;
  ko: string;
  note: string;
  cards: ArtistCard[];
}

// 한 화면에 이만큼만 먼저 보여주고 "더 보기"로 늘린다. 작가 한 명이 카드 수백 장이라
// 처음부터 다 걸면 이미지 로딩으로 버벅인다.
const PAGE = 60;

// 카드 원본 이미지는 pokemontcg.io의 큰 PNG(장당 ~150KB)라, 그리드·목록에 수백 장 깔면
// 느리다. 우리(도쿄) 서버의 이미지 프록시로 WebP 축소본을 받아 10~25배 줄이고(표지 ~6KB,
// 카드 ~14KB), 서버가 캐시해 유럽 CDN 지연도 없앤다. w는 표시 크기의 약 2배(레티나 대비).
function thumb(url: string, w: number): string {
  if (!url) return url;
  return `/api/img?u=${encodeURIComponent(url)}&w=${w}`;
}

// 일러스트레이터 화면 공용 검색 입력(🔍 + 지우기 X). 작가 찾기·작가 카드 안 검색 둘 다 씀.
function SearchInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-full border border-neutral-200 bg-white py-2.5 pl-4 pr-9 text-sm outline-none focus:border-neutral-400"
      />
      {value && (
        <button
          type="button"
          aria-label="검색어 지우기"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ArtistsView({ onPickCard }: { onPickCard: (name: string) => void }) {
  const [index, setIndex] = useState<ArtistIndexEntry[] | null>(null);
  const [selected, setSelected] = useState<ArtistIndexEntry | null>(null);
  const [cards, setCards] = useState<ArtistCard[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  // 작가 한 명의 카드가 수백 장이라, 그 안에서 포켓몬명(한글·영어)으로 거르는 검색.
  const [cardQuery, setCardQuery] = useState('');

  const indexRef = useRef<ArtistIndexEntry[] | null>(null);
  indexRef.current = index;

  // 상세 화면을 열되 방문기록·통계는 건드리지 않는다(복원·뒤로가기용).
  function showArtist(a: ArtistIndexEntry) {
    setSelected(a);
    setCards(null);
    setShown(PAGE);
    setCardQuery('');
    setLoading(true);
    fetch(`/artists/${a.slug}.json`)
      .then((r) => r.json())
      .then((d: ArtistFile) => setCards(d.cards))
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }

  // 작가 상세를 방문기록 한 칸으로: 뒤로가기 = 작가 목록으로.
  const sub = useSubScreen<string>('artist', (slug) => {
    if (!slug) {
      setSelected(null);
      return;
    }
    const a = indexRef.current?.find((x) => x.slug === slug);
    if (a) showArtist(a);
  });

  useEffect(() => {
    fetch('/artists/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ArtistIndexEntry[]) => {
        setIndex(list);
        indexRef.current = list;
        // 다른 화면에 갔다가 돌아왔을 때: 기록에 남은 상세를 복원한다.
        const slug = (window.history.state as { sub?: { artist?: string } } | null)?.sub?.artist;
        const a = slug ? list.find((x) => x.slug === slug) : undefined;
        if (a) showArtist(a);
      })
      .catch(() => setIndex([]));
  }, []);

  function openArtist(a: ArtistIndexEntry) {
    trackEvent('artist', a.en);
    showArtist(a);
    sub.push(a.slug);
  }

  // ── 작가 한 명의 카드 그리드 ────────────────────────────────────────────────
  if (selected) {
    // 포켓몬명 검색: 한글(변환)·영어 어느 쪽으로 쳐도 걸러진다.
    const cq = cardQuery.trim().toLowerCase();
    const filtered = cq
      ? (cards ?? []).filter(
          (c) =>
            c.name.toLowerCase().includes(cq) || koreanizeEnglishCardName(c.name).toLowerCase().includes(cq),
        )
      : (cards ?? []);
    const visible = filtered.slice(0, shown);
    return (
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={() => sub.back()}
          className="mb-3 text-sm font-semibold text-neutral-500 hover:text-black"
        >
          ← 작가 목록
        </button>
        {/* 작가 프로필 — 카드 그리드 위에 소개·활동시기·종수를 한 칸에 */}
        <div className="mb-5 flex gap-4 rounded-2xl border border-neutral-200 bg-white p-4">
          <img
            src={thumb(selected.cover, 200)}
            alt={selected.en}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const t = e.currentTarget;
              if (t.src !== selected.cover) t.src = selected.cover;
            }}
            className="h-[110px] w-[79px] flex-shrink-0 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="text-lg font-bold text-black">{selected.en}</h2>
              {selected.ko && selected.ko !== selected.en && (
                <span className="text-sm text-neutral-500">{selected.ko}</span>
              )}
            </div>
            {selected.note && <p className="mt-1 text-sm text-neutral-600">{selected.note}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">
                카드 {selected.count.toLocaleString()}종
              </span>
              {selected.era && (
                <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-600">
                  {selected.era} 활동
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="mb-3 text-xs text-neutral-400">카드를 누르면 그 카드 시세를 검색합니다.</p>

        {/* 이 작가 카드 안에서 포켓몬명으로 거르기(한글·영어) */}
        {!loading && (cards?.length ?? 0) > 0 && (
          <SearchInput
            value={cardQuery}
            onChange={(v) => {
              setCardQuery(v);
              setShown(PAGE);
            }}
            placeholder="이 작가 카드에서 포켓몬 찾기 (예: 리자몽, Charizard)"
            className="mb-3"
          />
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-neutral-400">'{cardQuery}'에 맞는 카드가 없습니다.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {visible.map((c, i) => {
                // 카드명은 해외 DB라 영문이다. 사이트 다른 곳(이베이·TCGplayer)과 같은
                // 변환기로 한글화한다. 포켓몬 이름은 한글로, 변환기에 없는 인물·트레이너
                // 카드는 영문 그대로 남는다.
                const koName = koreanizeEnglishCardName(c.name);
                return (
                  <button
                    key={`${c.name}-${c.number}-${i}`}
                    type="button"
                    onClick={() => onPickCard(koName)}
                    className="text-left"
                  >
                    <div className="aspect-[5/7] overflow-hidden rounded-lg bg-neutral-100">
                      <img
                        src={thumb(c.img, 240)}
                        alt={koName}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          const t = e.currentTarget;
                          if (t.src !== c.img) t.src = c.img;
                        }}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <p className="mt-1.5 line-clamp-1 text-xs font-semibold text-black">{koName}</p>
                    <p className="line-clamp-1 text-[11px] text-neutral-400">{koSetName(c.set)}</p>
                  </button>
                );
              })}
            </div>
            {shown < filtered.length && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="rounded-full border border-neutral-300 px-5 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  더 보기 ({filtered.length - shown}장)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── 작가 목록 ──────────────────────────────────────────────────────────────
  // 목록은 카드 그리드라 상세(max-w-4xl)보다 넓게 잡아 큰 화면에서 4열이 답답하지 않게.
  return (
    <div className="mx-auto max-w-6xl">
      {/* 제목과 작가 검색을 한 줄에. 검색은 오른쪽 남는 공간만 쓰고(전체폭 X), 좁은 화면
          에선 아래로 접힌다. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-black">작가별 카드</h2>
          <p className="mt-1 text-xs text-neutral-400">
            일러스트레이터로 카드를 모아 봅니다. 카드 아트는 일본판도 같은 작가입니다. (해외 카드 DB 기준)
          </p>
        </div>
        {index && index.length > 0 && (
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="작가 찾기 (Arita, 아리타)"
            className="w-full flex-shrink-0 sm:w-60 md:w-72"
          />
        )}
      </div>

      {index === null ? (
        <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
      ) : index.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-400">작가 데이터를 준비 중입니다.</p>
      ) : (
        <ArtistList index={index} query={query} onOpen={openArtist} />
      )}
    </div>
  );
}

// 작가 목록 + 이름 검색. 영어명·한글명 아무거나 일부만 쳐도 걸러진다.
function ArtistList({
  index,
  query,
  onOpen,
}: {
  index: ArtistIndexEntry[];
  query: string;
  onOpen: (a: ArtistIndexEntry) => void;
}) {
  const q = query.trim().toLowerCase();
  const filtered = q ? index.filter((a) => a.en.toLowerCase().includes(q) || a.ko.toLowerCase().includes(q)) : index;
  return (
    <>
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-400">'{query}'에 맞는 작가가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((a) => (
            <button
              key={a.slug}
              type="button"
              onClick={() => onOpen(a)}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left hover:shadow-md"
            >
              <img
                src={thumb(a.cover, 140)}
                alt={a.en}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const t = e.currentTarget;
                  if (t.src !== a.cover) t.src = a.cover;
                }}
                className="h-[84px] w-[60px] flex-shrink-0 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-sm font-bold text-black">{a.en}</p>
                {a.ko && a.ko !== a.en && <p className="line-clamp-1 text-xs text-neutral-500">{a.ko}</p>}
              </div>
              <span className="flex-shrink-0 self-start rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-500">
                {a.count.toLocaleString()}종
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
