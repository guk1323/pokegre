import { useEffect, useState } from 'react';
import { trackEvent } from '../api/localStats';
import { koreanizeEnglishCardName } from '../lib/koreanizeEnglishTitle';

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

export function ArtistsView({ onPickCard }: { onPickCard: (name: string) => void }) {
  const [index, setIndex] = useState<ArtistIndexEntry[] | null>(null);
  const [selected, setSelected] = useState<ArtistIndexEntry | null>(null);
  const [cards, setCards] = useState<ArtistCard[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  // 작가 한 명의 카드가 수백 장이라, 그 안에서 포켓몬명(한글·영어)으로 거르는 검색.
  const [cardQuery, setCardQuery] = useState('');

  useEffect(() => {
    fetch('/artists/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then(setIndex)
      .catch(() => setIndex([]));
  }, []);

  function openArtist(a: ArtistIndexEntry) {
    setSelected(a);
    setCards(null);
    setShown(PAGE);
    setCardQuery('');
    setLoading(true);
    trackEvent('artist', a.en);
    fetch(`/artists/${a.slug}.json`)
      .then((r) => r.json())
      .then((d: ArtistFile) => setCards(d.cards))
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
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
          onClick={() => setSelected(null)}
          className="mb-3 text-sm font-semibold text-neutral-500 hover:text-black"
        >
          ← 작가 목록
        </button>
        {/* 작가 프로필 — 카드 그리드 위에 소개·활동시기·종수를 한 칸에 */}
        <div className="mb-5 flex gap-4 rounded-2xl border border-neutral-200 bg-white p-4">
          <img
            src={selected.cover}
            alt={selected.en}
            loading="lazy"
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
        <p className="mb-3 text-xs text-neutral-400">카드를 누르면 그 카드 시세를 검색해요.</p>

        {/* 이 작가 카드 안에서 포켓몬명으로 거르기(한글·영어) */}
        {!loading && (cards?.length ?? 0) > 0 && (
          <div className="relative mb-3">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">🔍</span>
            <input
              type="text"
              value={cardQuery}
              onChange={(e) => {
                setCardQuery(e.target.value);
                setShown(PAGE);
              }}
              placeholder="이 작가 카드에서 포켓몬 찾기 (예: 리자몽, Charizard)"
              className="w-full rounded-full border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-neutral-400"
            />
          </div>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-neutral-400">'{cardQuery}'에 맞는 카드가 없어요.</p>
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
                      <img src={c.img} alt={koName} loading="lazy" className="h-full w-full object-cover" />
                    </div>
                    <p className="mt-1.5 line-clamp-1 text-xs font-semibold text-black">{koName}</p>
                    <p className="line-clamp-1 text-[11px] text-neutral-400">{c.set}</p>
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
      <h2 className="text-lg font-bold text-black">작가별 카드</h2>
      <p className="mt-1 mb-4 text-xs text-neutral-400">
        일러스트레이터로 카드를 모아 봐요. 카드 아트는 일본판도 같은 작가예요. (해외 카드 DB 기준)
      </p>

      {index === null ? (
        <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
      ) : index.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-400">작가 데이터를 준비 중이에요.</p>
      ) : (
        <ArtistList index={index} query={query} setQuery={setQuery} onOpen={openArtist} />
      )}
    </div>
  );
}

// 작가 목록 + 이름 검색. 영어명·한글명 아무거나 일부만 쳐도 걸러진다.
function ArtistList({
  index,
  query,
  setQuery,
  onOpen,
}: {
  index: ArtistIndexEntry[];
  query: string;
  setQuery: (v: string) => void;
  onOpen: (a: ArtistIndexEntry) => void;
}) {
  const q = query.trim().toLowerCase();
  const filtered = q ? index.filter((a) => a.en.toLowerCase().includes(q) || a.ko.toLowerCase().includes(q)) : index;
  return (
    <>
      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="작가 이름으로 찾기 (예: Arita, 아리타)"
          className="w-full rounded-full border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-neutral-400"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-400">'{query}'에 맞는 작가가 없어요.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((a) => (
            <button
              key={a.slug}
              type="button"
              onClick={() => onOpen(a)}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left hover:shadow-md"
            >
              <img src={a.cover} alt={a.en} loading="lazy" className="h-[84px] w-[60px] flex-shrink-0 rounded object-cover" />
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
