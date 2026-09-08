import { useEffect, useMemo, useRef, useState } from 'react';
import { AdSlot } from './AdSlot';
import { trackEvent } from '../api/localStats';
import { useSubScreen } from '../lib/useSubScreen';
import { SearchInput } from './SearchInput';
import { CARD_BACK, cardImg, thumb } from '../lib/cardImg';
import { 보일번호 } from '../lib/cardNo';

/**
 * 목록에 보일 **대표 카드 그림**. 목록 파일이 두 배로 불지 않게 `cv`에는 PPT 번호만
 * 적혀 있고(6,177개), PPT 주소가 아닌 것만 주소가 통째로 들어 있다(223개).
 * 주소는 여기서 만든다 — 목록이 981KB가 아니라 674KB로 끝난다.
 */
const 대표그림 = (cv?: string) => {
  if (!cv) return CARD_BACK;
  if (/^\d+$/.test(cv)) return thumb(`https://tcgplayer-cdn.tcgplayer.com/product/${cv}_in_400x400.jpg`, 140);
  return thumb(cardImg(cv), 140);
};

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
  /** 목록에 보일 대표 카드. PPT 번호 또는 주소. */
  cv?: string;
}

interface PokeCard {
  /** 번역 전 원문 이름 */
  name: string;
  /** 세트 슬러그 */
  s: string;
  n: string;
  /**
   * **카드에 실제로 찍힌 번호**(옛 일본 세트만). 있으면 `n` 대신 이걸 보여 준다.
   * ⚠️ 1996~2001 구판은 카드 번호가 없고 포켓몬 도감번호가 「No.004」로 찍혀 있는데,
   *    우리 `n`은 정렬 순번이라 실물과 다르다(파이리가 012 ↔ 카드엔 004).
   */
  p?: string;
  img?: string;
  r?: string;
  /** PPT 번호(tcgPlayerId). 시세를 이름이 아니라 이 번호로 부른다. */
  tcg?: string;
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
  onPickCard: (card: {
    /** 화면에 보이는 한글 카드 이름 */
    ko: string
    /** 영문 카드 이름(영문판 카드일 때만). PPT 검색에 쓴다. */
    en: string
    /** 번역 전 원문 이름. 스니커덩크 2차 검색("이름 번호")에 쓴다. */
    raw: string
    /** 이 포켓몬·트레이너의 영문 이름. 일본판 카드를 PPT에서 찾을 때 쓴다
     *  — PPT는 일본판 DB도 영문 이름으로 색인돼 있다. */
    speciesEn: string
    /** 세트 슬러그(ja-SV6 등). PPT 세트 이름 대응표를 찾는 열쇠. */
    slug: string
    /** 세트코드(SV6 등). 스니커덩크는 "코드 번호"로 찾는 게 가장 정확하다. */
    setCode: string
    /** 우리 세트 이름(원문) */
    setName: string
    /** 한글 세트 이름(화면 문구용) */
    setNameKo: string
    num: string
    jp: boolean
    /** 누른 카드의 그림. 마켓에 값이 없을 때 무엇을 찾고 있는지 보여주는 데 쓴다. */
    img?: string
    /** PPT 번호(tcgPlayerId). 시세를 이름이 아니라 이 번호로 부른다. */
    tcg?: string
  }) => void;
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
        indexRef.current = px;
        setIndex(px);
        setSets(new Map(sx.map((s) => [s.slug, s])));
        // 목록이 늦게 와서 미뤄 둔 복원이 있으면 지금 연다(아래 설명 참고).
        const 기다린것 = 복원대기.current;
        복원대기.current = null;
        if (기다린것 != null) {
          const p = px.find((x) => x.id === 기다린것);
          if (p) void open(p, false);
        }
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

  // ⚠️ 목록(index)은 받아오는 데 시간이 걸린다. 복원은 화면이 붙자마자 불리므로 그때는
  //    아직 null이다. 그대로 두면 카드를 눌러 시세를 보고 **뒤로가기로 돌아왔을 때
  //    보던 목록이 사라진다** — 램프라를 다시 검색해야 했다(점검 중 발견 2026-08-06).
  //    ref로 최신 목록을 보고, 아직 없으면 적어 뒀다가 도착했을 때 연다.
  const indexRef = useRef<PokeIndex[] | null>(null);
  const 복원대기 = useRef<number | null>(null);

  // 목록으로 돌아갈 때 주소도 되돌린다(useSubScreen 설명 참고).
  const sub = useSubScreen<number>(
    'pokedex',
    (id) => {
      if (id == null) {
        setPicked(null);
        setCards(null);
        복원대기.current = null;
        return;
      }
      const p = indexRef.current?.find((x) => x.id === id);
      if (p) void open(p, false);
      else 복원대기.current = id;
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
          {[picked.t === 't' ? '트레이너·에너지' : picked.en, `카드 ${picked.c}종`, '발매 순']
            .filter(Boolean)
            .join(' · ')}
        </p>

        {/* ⚠️ 아래 카드 격자는 **작가 화면과 같은 값**이다. 예전엔 3/5/6칸이라 같은 카드가
            작가 화면보다 훨씬 작게 보였다(2026-08-09 사장님 지적). */}
        {cards === null ? (
          <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
        ) : cards.length === 0 ? (
          <p className="py-16 text-center text-sm text-neutral-400">카드를 불러오지 못했습니다.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {cards.map((c, i) => {
              const meta = sets?.get(c.s);
              const 이름 = meta && cat ? cat.koName(meta.ed, c.name) : c.name;
              const 세트 = meta && cat ? cat.koSet(meta.ed, meta.name) : (meta?.name ?? c.s);
              return (
                <div key={`${c.s}-${c.n}-${i}`} className="contents">
                {i === 4 && <AdSlot 형태="가로" 이름="도감" className="col-span-full sm:hidden" />}
                {i === 6 && <AdSlot 형태="가로" 이름="도감" className="col-span-full hidden sm:block md:hidden" />}
                {i === 8 && <AdSlot 형태="가로" 이름="도감" className="col-span-full hidden md:block" />}
                <button
                  key={`${c.s}-${c.n}-${i}`}
                  type="button"
                  // 카드를 누르면 그 이름으로 시세를 검색한다(세트 화면과 같은 동작).
                  onClick={() =>
                    onPickCard({
                      ko: 이름,
                      // 영문판 카드는 원문이 곧 영어 이름이다. 일본판이면 영어 이름이
                      // 없으니 빈 값 — 부르는 쪽이 종 영문 이름(speciesEn)으로 찾는다.
                      en: meta?.ed === 'en' ? c.name : '',
                      raw: c.name,
                      speciesEn: picked?.en ?? '',
                      slug: c.s,
                      setCode: meta?.id ?? '',
                      setName: meta?.name ?? '',
                      setNameKo: 세트,
                      num: c.n,
                      jp: meta?.ed !== 'en',
                      tcg: c.tcg,
                      // 마켓에 값이 없을 때 "무엇을 찾고 있는지" 보여줄 그림.
                      img: cat && cat.usable(c.img) ? c.img : '',
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
                  {/* ⚠️ 세트 이름과 번호를 한 줄에 두면, 이름이 긴 세트에서 **번호가
                      잘려 안 보인다**("SWSH 블랙스타 프로모…" — 점검 중 발견
                      2026-08-06). 번호는 그 한 장을 가리키는 값이라 늘 보여야 한다.
                      세트 이름만 줄이고, 번호는 아래 발매 연월 줄에 붙인다. */}
                  <p className="line-clamp-1 text-[10px] text-neutral-400">{세트}</p>
                  {/* 발매 연월. "출시순"이 눈에 보이게 한다. */}
                  <p className="text-[10px] text-neutral-300">
                    {/* ⚠️ **날것(`c.n`)을 그대로 쓰면 안 된다.** `#577000`처럼 우리가 지어낸
                        자리표가 그대로 나간다. 세트 화면과 같은 `보일번호()`를 거친다. */}
                    {[(meta?.releaseDate ?? '').slice(0, 7), c.p ? `No.${c.p}` : 보일번호(c.n)].filter(Boolean).join(' · ')}
                  </p>
                </button>
                </div>
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
    // ⚠️ **목록 화면은 `max-w-6xl`.** 세트·작가 목록이 그 폭이라, 여기만 4xl이면 넓은
    //    화면에서 양옆에 빈 자리가 생긴다(2026-08-09 사장님 지적).
    //    카드 상세(위 picked 쪽)는 셋 다 4xl이라 그대로 둔다.
    <div className="mx-auto max-w-6xl">
      {/* ⚠️ 머리 줄은 **작가 화면과 같은 꼴**로 맞춘다 — 제목·설명은 왼쪽, 검색창은
          오른쪽에 두고 좁은 화면에선 아래로 접힌다(2026-08-09 사장님 지적). */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {/* ⚠️ **제목에 「에너지」를 넣고 설명을 없앴다**(사장님 지시 2026-08-27).
              예전엔 제목이 「포켓몬·트레이너별」이라 에너지가 안 보여서, 밑에 「트레이너·에너지
              카드도 찾을 수 있습니다」라고 **설명으로 메우고 있었다.** 설명을 붙이는 대신
              **이름을 고치는** 쪽이 맞다 — 2026-08-13에 「신뢰도 낮음」을 「거래 적음」으로
              바꿔 설명 줄을 통째로 없앴던 것과 같은 잣대다.
              ⚠️ 「이름을 고르면 … 나옵니다」 같은 **조작 안내는 되살리지 말 것.** */}
          <h2 className="text-lg font-bold text-black">포켓몬·트레이너·에너지별 카드</h2>
        </div>
        {index && index.length > 0 && (
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="이름 찾기 (예: 개굴닌자, 릴리에)"
            className="w-full flex-shrink-0 sm:w-60 md:w-72"
          />
        )}
      </div>
      {index === null ? (
        <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
      ) : 찾은것.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-400">그런 이름을 찾지 못했습니다.</p>
      ) : (
        <>
          {/* ⚠️ **작가 화면과 같은 칸 꼴**로 맞춘다 — 왼쪽에 대표 카드, 오른쪽에 이름,
              종수는 폰에서 자기 줄로 내린다(2026-08-09 사장님 지적). */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {볼것.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void open(p)}
                className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white p-2 text-left hover:shadow-md sm:gap-3 sm:p-3"
              >
                <img
                  src={대표그림(p.cv)}
                  alt={p.ko}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const t = e.currentTarget;
                    if (!t.src.endsWith(CARD_BACK)) t.src = CARD_BACK;
                  }}
                  className="h-[64px] w-[46px] flex-shrink-0 rounded object-cover sm:h-[84px] sm:w-[60px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-xs font-bold text-black sm:text-sm">{p.ko}</p>
                  <p className="line-clamp-1 text-[11px] text-neutral-500 sm:text-xs">
                    {p.t === 't' ? (p.en ? `트레이너·에너지 · ${p.en}` : '트레이너·에너지') : p.en}
                  </p>
                  {/* ⚠️ 세는 말은 **"종"으로 맞춘다**. 셋 다 "서로 다른 카드가 몇 개인가"인데
                      포켓몬만 "장"이라 세트·작가와 어긋났다(2026-08-08). */}
                  <p className="mt-0.5 text-[11px] font-semibold text-neutral-400 sm:hidden">
                    {p.c.toLocaleString()}종
                  </p>
                </div>
                <span className="hidden flex-shrink-0 self-start rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-500 sm:inline">
                  {p.c.toLocaleString()}종
                </span>
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
