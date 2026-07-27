import { useEffect, useMemo, useState } from 'react';
import {
  CARD_BACK,
  cardImg,
  koName,
  koSet,
  loadSetCards,
  loadSetIndex,
  thumb,
  usable,
  type SetCard,
  type SetIndexEntry,
} from '../lib/cardCatalog';

// 매물을 올릴 때 "어느 카드인지"를 우리 카탈로그에서 고르게 하는 화면.
//
// 카드 이름을 자유롭게 타이핑하게 두면 안 된다. "리자몽 ex SAR" / "리자몽ex sar" /
// "리자몽 이엑스"가 전부 다른 카드로 잡혀 시세가 흩어진다. 세트 코드와 카드 번호로
// 못 박아야 같은 카드의 매물이 한곳에 모이고, 그래야 시세가 쌓인다.

export interface PickedCard {
  slug: string;
  ed: 'ja' | 'en';
  setName: string; // 한글화된 세트 이름
  n: string;
  name: string; // 한글화된 카드 이름
  img: string; // 카탈로그 이미지(공식 렌더). 실물 사진과는 별개다.
}

const PAGE = 60;

export function CardPicker({ onPick, onCancel }: { onPick: (c: PickedCard) => void; onCancel: () => void }) {
  const [index, setIndex] = useState<SetIndexEntry[] | null>(null);
  const [tab, setTab] = useState<'ja' | 'en'>('ja');
  const [setQuery, setSetQuery] = useState('');
  const [selected, setSelected] = useState<SetIndexEntry | null>(null);
  const [cards, setCards] = useState<SetCard[] | null>(null);
  const [cardQuery, setCardQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSetIndex()
      .then(setIndex)
      .catch(() => setError('세트 목록을 불러오지 못했습니다.'));
  }, []);

  function openSet(s: SetIndexEntry) {
    setSelected(s);
    setCards(null);
    setCardQuery('');
    setShown(PAGE);
    setLoading(true);
    loadSetCards(s.slug)
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }

  // 모바일 포켓(디지털)은 실물이 없으니 뺀다 — 팔 수 없는 카드가 목록에 섞이면 안 된다.
  const sets = useMemo(() => {
    if (!index) return [];
    const q = setQuery.trim().toLowerCase();
    return index
      .filter((s) => s.ed === tab && !s.slug.includes('pocket'))
      .filter((s) => !q || koSet(s.ed, s.name).toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  }, [index, tab, setQuery]);

  const filteredCards = useMemo(() => {
    if (!cards || !selected) return [];
    const q = cardQuery.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter(
      (c) => koName(selected.ed, c.name).toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.n === q,
    );
  }, [cards, cardQuery, selected]);

  // ── 카드 고르기 ────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="text-xs font-semibold text-neutral-500 hover:text-black"
        >
          ← 세트 다시 고르기
        </button>
        <div>
          <p className="text-sm font-bold text-black">{koSet(selected.ed, selected.name)}</p>
          <p className="text-xs text-neutral-500">카드 {cards?.length ?? selected.count}장</p>
        </div>
        <input
          value={cardQuery}
          onChange={(e) => {
            setCardQuery(e.target.value);
            setShown(PAGE);
          }}
          placeholder="카드 이름 또는 번호"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />

        {loading ? (
          <p className="py-12 text-center text-sm text-neutral-400">불러오는 중...</p>
        ) : filteredCards.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-200 py-12 text-center text-sm text-neutral-400">
            찾는 카드가 없습니다.
          </p>
        ) : (
          <>
            {/* 세트별 목록 화면과 같은 칸 수로 맞춘다 — 넓은 화면에서 카드가
                한 장씩 거대해지지 않게. */}
            <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredCards.slice(0, shown).map((c) => {
                const src = usable(c.img) ? thumb(cardImg(c.img), 240) : CARD_BACK;
                return (
                  <button
                    key={`${c.n}-${c.name}`}
                    type="button"
                    onClick={() =>
                      onPick({
                        slug: selected.slug,
                        ed: selected.ed,
                        setName: koSet(selected.ed, selected.name),
                        n: c.n,
                        name: koName(selected.ed, c.name),
                        img: usable(c.img) ? cardImg(c.img) : '',
                      })
                    }
                    className="text-left"
                  >
                    <img
                      src={src}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = CARD_BACK;
                      }}
                      className="aspect-[63/88] w-full rounded-lg border border-neutral-200 object-cover"
                    />
                    <p className="mt-1 truncate text-[11px] font-semibold text-black">{koName(selected.ed, c.name)}</p>
                    <p className="text-[11px] text-neutral-400">No.{c.n}</p>
                  </button>
                );
              })}
            </div>
            {filteredCards.length > shown && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="w-full rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                더 보기 ({filteredCards.length - shown}장 남음)
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  // ── 세트 고르기 ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-black">어느 카드인가요?</p>
        <button type="button" onClick={onCancel} className="text-xs text-neutral-500 hover:text-black">
          닫기
        </button>
      </div>

      <div className="flex gap-2">
        {(
          [
            ['ja', '일본판'],
            ['en', '북미판'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
              tab === v ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        value={setQuery}
        onChange={(e) => setSetQuery(e.target.value)}
        placeholder="세트 이름 또는 코드 (예: 흑염, sv3)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />

      {error && <p className="text-sm text-rose-500">{error}</p>}
      {!index ? (
        <p className="py-12 text-center text-sm text-neutral-400">불러오는 중...</p>
      ) : (
        <ul className="max-h-96 space-y-1 overflow-y-auto">
          {sets.map((s) => (
            <li key={s.slug}>
              <button
                type="button"
                onClick={() => openSet(s)}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-neutral-50"
              >
                <img
                  src={thumb(s.boxImg || s.logo || s.cover, 96)}
                  alt=""
                  loading="lazy"
                  className="h-10 w-10 flex-shrink-0 object-contain"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-black">{koSet(s.ed, s.name)}</span>
                  <span className="block text-xs text-neutral-400">
                    {s.id.toUpperCase()} · {s.count}장 · {s.releaseDate?.slice(0, 7).replace('-', '.')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
