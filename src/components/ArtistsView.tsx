import { useEffect, useState } from 'react';
import { trackEvent } from '../api/localStats';

// 작가별 카드 모음. 스니커덩크엔 일러스트레이터 정보가 없어서, 작가 정보가 있는 해외
// 카드 DB(pokemontcg.io)에서 미리 긁어 public/artists/에 저장해둔 데이터를 읽는다.
// 카드 아트는 일본판도 같은 작가라, 카드를 누르면 그 이름으로 우리 사이트 시세 검색으로
// 넘어간다.
interface ArtistIndexEntry {
  slug: string;
  ko: string;
  en: string;
  note: string;
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
    setLoading(true);
    trackEvent('artist');
    fetch(`/artists/${a.slug}.json`)
      .then((r) => r.json())
      .then((d: ArtistFile) => setCards(d.cards))
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }

  // ── 작가 한 명의 카드 그리드 ────────────────────────────────────────────────
  if (selected) {
    const visible = (cards ?? []).slice(0, shown);
    return (
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="mb-3 text-sm font-semibold text-neutral-500 hover:text-black"
        >
          ← 작가 목록
        </button>
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="text-lg font-bold text-black">{selected.en}</h2>
          {selected.ko && selected.ko !== selected.en && <span className="text-xs text-neutral-400">{selected.ko}</span>}
        </div>
        <p className="mb-4 text-xs text-neutral-400">
          {selected.count.toLocaleString()}종 · 카드를 누르면 그 카드 시세를 검색해요.
        </p>

        {loading ? (
          <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {visible.map((c, i) => (
                <button
                  key={`${c.name}-${c.number}-${i}`}
                  type="button"
                  onClick={() => onPickCard(c.name)}
                  className="text-left"
                >
                  <div className="aspect-[5/7] overflow-hidden rounded-lg bg-neutral-100">
                    <img src={c.img} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-xs font-semibold text-black">{c.name}</p>
                  <p className="line-clamp-1 text-[11px] text-neutral-400">{c.set}</p>
                </button>
              ))}
            </div>
            {cards && shown < cards.length && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="rounded-full border border-neutral-300 px-5 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  더 보기 ({cards.length - shown}장)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── 작가 목록 ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="text-lg font-bold text-black">작가별 카드</h2>
      <p className="mt-1 mb-4 text-xs text-neutral-400">
        일러스트레이터로 카드를 모아 봐요. 카드 아트는 일본판도 같은 작가예요. (해외 카드 DB 기준)
      </p>

      {index === null ? (
        <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
      ) : index.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-400">작가 데이터를 준비 중이에요.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {index.map((a) => (
            <button key={a.slug} type="button" onClick={() => openArtist(a)} className="text-left">
              <div className="aspect-[5/7] overflow-hidden rounded-lg bg-neutral-100">
                <img src={a.cover} alt={a.en} loading="lazy" className="h-full w-full object-cover" />
              </div>
              <p className="mt-1.5 line-clamp-1 text-sm font-bold text-black">{a.en}</p>
              {a.ko && a.ko !== a.en && <p className="line-clamp-1 text-[11px] text-neutral-500">{a.ko}</p>}
              <p className="text-[11px] text-neutral-400">{a.count.toLocaleString()}종</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
