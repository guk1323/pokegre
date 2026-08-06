import { useEffect, useMemo, useRef, useState } from 'react';
import { trackEvent } from '../api/localStats';
import { useSubScreen } from '../lib/useSubScreen';

// 포켓몬 하나를 고르면 그 포켓몬 카드가 **발매 순으로** 다 나온다. 어느 세트 것인지도
// 같이 적는다("개굴닌자를 치면 개굴닌자 카드가 다 나오게" — 운영자 지시 2026-08-06).
//
// 자료는 scripts/gen-pokedex.mts가 미리 만들어 둔 public/pokedex/를 읽는다.
// · index.json  — 카드가 있는 포켓몬 목록(52KB). 검색은 이것만으로 한다.
// · <id>.json   — 그 포켓몬 카드들. 고른 뒤에 받는다(대개 몇 KB).
// 세트 파일 371개를 브라우저가 받지 않아도 되는 이유다.

interface PokeIndex {
  id: number;
  ko: string;
  en: string;
  /** 카드 장수 */
  c: number;
  /** 'p' = 포켓몬 · 't' = 트레이너·에너지 */
  t: 'p' | 't';
}

interface PokeCard {
  /** 번역 전 원문 이름 */
  name: string;
  /** 세트 슬러그 */
  s: string;
  n: string;
  img?: string;
  r?: string;
}

interface SetMeta {
  slug: string;
  ed: 'ja' | 'en';
  /** 세트코드(M6·sv08 등). 스니커덩크는 "세트코드 번호"로 찾는 게 가장 정확하다. */
  id: string;
  name: string;
  releaseDate?: string;
  serie?: string;
}

// 한 번에 보여줄 포켓몬 수. 1,025종을 통째로 펴면 폰에서 끝없이 스크롤된다.
const 한번에 = 60;

export function PokedexView({
  onPickCard,
}: {
  /**
   * 카드 한 장을 눌렀을 때. 이름만 넘기면 "개굴닌자"로 72장이 다 나온다.
   * 세트코드·번호·판을 같이 넘겨 그 한 장으로 좁힌다 — 사진 스캔이 쓰는 규칙과 같다
   * (운영자 지시 2026-08-06).
   */
  onPickCard: (card: { ko: string; en: string; setCode: string; setName: string; num: string; jp: boolean }) => void;
}) {
  const [index, setIndex] = useState<PokeIndex[] | null>(null);
  const [sets, setSets] = useState<Map<string, SetMeta> | null>(null);
  const [q, setQ] = useState('');
  const [보임, set보임] = useState(한번에);
  const [picked, setPicked] = useState<PokeIndex | null>(null);
  const [cards, setCards] = useState<PokeCard[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // 카드 이름·세트 이름을 한글로 만드는 사전. 무거워서(약 200KB) 첫 화면에 안 싣고
  // 여기서 늦게 받는다 — cardCatalog가 이름 사전을 통째로 끌고 오기 때문이다.
  const [cat, setCat] = useState<typeof import('../lib/cardCatalog') | null>(null);

  useEffect(() => {
    let dead = false;
    void Promise.all([
      fetch('/pokedex/index.json').then((r) => r.json()),
      fetch('/sets/index.json').then((r) => r.json()),
    ])
      .then(([px, sx]: [PokeIndex[], SetMeta[]]) => {
        if (dead) return;
        setIndex(px);
        setSets(new Map(sx.map((s) => [s.slug, s])));
      })
      .catch(() => !dead && setLoadFailed(true));
    void import('../lib/cardCatalog')
      .then((m) => !dead && setCat(m))
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => set보임(한번에), [q]);

  // 목록으로 돌아갈 때 주소도 되돌린다(useSubScreen 설명 참고).
  const sub = useSubScreen<number>(
    'pokedex',
    (id) => {
      if (id == null) {
        setPicked(null);
        setCards(null);
        return;
      }
      const p = index?.find((x) => x.id === id);
      if (p) void open(p, false);
    },
    { path: '/pokedex', title: '포켓몬·트레이너별 카드 목록 | pokegre' },
  );

  const 열린것 = useRef(0);
  async function open(p: PokeIndex, push = true) {
    setPicked(p);
    setCards(null);
    열린것.current = p.id;
    if (push) {
      trackEvent('pokedex', p.ko);
      sub.push(p.id);
    }
    try {
      const r = await fetch(`/pokedex/${p.id}.json`);
      const list = (await r.json()) as PokeCard[];
      if (열린것.current === p.id) setCards(list);
    } catch {
      if (열린것.current === p.id) setCards([]);
    }
  }

  // ⚠️ 찾을 때는 띄어쓰기를 무시한다. "박사의연구"라고 붙여 쳐도 "박사의 연구"가
  //    나와야 한다 — 카드 이름의 띄어쓰기를 외우고 있는 사람은 없다.
  const 붙임 = (s: string) => s.toLowerCase().replace(/[\s·]/g, '');
  const 찾은것 = useMemo(() => {
    if (!index) return [];
    const s = 붙임(q);
    if (!s) return index;
    const hit = index.filter((p) => 붙임(p.ko).includes(s) || 붙임(p.en).includes(s));
    // ⚠️ 이름이 정확히 맞는 것을 맨 위로. "피카츄"를 치면 "피카츄"가 "캡틴피카츄"보다
    //    먼저 나와야 한다. 그다음은 이름이 그 말로 시작하는 것, 그다음 장수 많은 순.
    return hit.sort((a, b) => {
      const 점수 = (p: PokeIndex) => (붙임(p.ko) === s ? 0 : 붙임(p.ko).startsWith(s) ? 1 : 2);
      return 점수(a) - 점수(b) || b.c - a.c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, q]);

  // 탭 제목도 지금 보는 포켓몬으로.
  useEffect(() => {
    document.title = picked ? `${picked.ko} 카드 목록 | pokegre` : '포켓몬·트레이너별 카드 목록 | pokegre';
  }, [picked]);

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-4xl py-16 text-center">
        <p className="text-sm text-neutral-500">목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>
      </div>
    );
  }

  // ── 포켓몬 하나의 카드들 ────────────────────────────────────────────────
  if (picked) {
    return (
      <div className="mx-auto max-w-4xl">
        <button
          type="button"
          onClick={() => sub.back()}
          className="mb-3 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          ← 목록으로
        </button>
        <h2 className="text-lg font-bold text-black">{picked.ko}</h2>
        <p className="mt-1 text-xs text-neutral-400">
          {[picked.t === 't' ? '트레이너·에너지' : picked.en, `카드 ${picked.c}장`, '발매 순']
            .filter(Boolean)
            .join(' · ')}
        </p>

        {cards === null ? (
          <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
        ) : cards.length === 0 ? (
          <p className="py-16 text-center text-sm text-neutral-400">카드를 불러오지 못했습니다.</p>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
            {cards.map((c, i) => {
              const meta = sets?.get(c.s);
              const 이름 = meta && cat ? cat.koName(meta.ed, c.name) : c.name;
              const 세트 = meta && cat ? cat.koSet(meta.ed, meta.name) : (meta?.name ?? c.s);
              return (
                <button
                  key={`${c.s}-${c.n}-${i}`}
                  type="button"
                  // 카드를 누르면 그 이름으로 시세를 검색한다(세트 화면과 같은 동작).
                  onClick={() =>
                    onPickCard({
                      ko: 이름,
                      // 북미판 카드는 원문이 곧 영어 이름이다. 일본판이면 영어 이름이
                      // 없으니 빈 값 — 부르는 쪽이 이름 대신 세트코드로 찾는다.
                      en: meta?.ed === 'en' ? c.name : '',
                      setCode: meta?.id ?? '',
                      // 이베이는 결과에 세트 이름이 붙어 오므로, 그걸로 그 한 장을 골라낸다.
                      // 원문 세트 이름을 넘긴다 — 이베이 쪽도 영문이라 그대로 맞는다.
                      setName: meta?.name ?? '',
                      num: c.n,
                      jp: meta?.ed !== 'en',
                    })
                  }
                  className="text-left"
                >
                  {cat && cat.usable(c.img) ? (
                    <img
                      src={cat.thumb(cat.cardImg(c.img!), 240)}
                      alt=""
                      loading="lazy"
                      className="aspect-[5/7] w-full rounded-lg bg-neutral-50 object-contain ring-1 ring-neutral-200"
                    />
                  ) : (
                    <div className="grid aspect-[5/7] w-full place-items-center rounded-lg bg-neutral-100 text-[10px] text-neutral-400 ring-1 ring-neutral-200">
                      이미지 준비 중
                    </div>
                  )}
                  <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-800">{이름}</p>
                  <p className="line-clamp-1 text-[10px] text-neutral-400">
                    {세트} {c.n}
                  </p>
                  {/* 발매 연월. "출시순"이 눈에 보이게 한다. */}
                  <p className="text-[10px] text-neutral-300">{(meta?.releaseDate ?? '').slice(0, 7)}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── 포켓몬 고르기 ──────────────────────────────────────────────────────
  const 볼것 = q.trim() ? 찾은것 : 찾은것.slice(0, 보임);
  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="text-lg font-bold text-black">포켓몬·트레이너별 카드</h2>
      <p className="mt-1 text-xs text-neutral-400">
        이름을 고르면 그 카드가 발매 순으로 나옵니다. 어느 세트 것인지도 함께 적습니다.
        포켓몬뿐 아니라 트레이너·에너지 카드도 찾을 수 있습니다.
      </p>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="이름 찾기 (예: 개굴닌자, 박사의 연구)"
        className="mt-3 w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm focus:border-black focus:outline-none"
      />
      {index === null ? (
        <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
      ) : 찾은것.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-400">그런 이름을 찾지 못했습니다.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {볼것.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void open(p)}
                className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-3 text-left hover:border-neutral-300"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-black">{p.ko}</span>
                  <span className="block truncate text-[11px] text-neutral-400">
                    {p.t === 't' ? (p.en ? `트레이너·에너지 · ${p.en}` : '트레이너·에너지') : p.en}
                  </span>
                </span>
                <span className="ml-2 shrink-0 text-xs font-semibold text-neutral-400">{p.c}장</span>
              </button>
            ))}
          </div>
          {/* 찾는 중에는 안 자른다 — 찾으려던 포켓몬이 잘리면 "없다"고 오해한다. */}
          {!q.trim() && 보임 < 찾은것.length && (
            <button
              type="button"
              onClick={() => set보임((n) => n + 한번에)}
              className="mt-4 w-full rounded-lg border border-neutral-300 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              더 보기 (남은 {찾은것.length - 보임}종)
            </button>
          )}
        </>
      )}
    </div>
  );
}
