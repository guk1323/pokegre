import { useEffect, useRef, useState } from 'react';
import { AdSlot } from './AdSlot';
import { 을를 } from '../lib/josa';
import { koName as koCardName } from '../lib/koCardName.ts';
import { trackEvent } from '../api/localStats';
import { koSetName } from '../lib/setNameKo';
import type { 도감카드정보 } from '../lib/pokedexRoute';
import { loadSetIndex, type SetIndexEntry } from '../lib/cardCatalog';
import { useSubScreen } from '../lib/useSubScreen';
// 표지 주소가 죽은 작가가 있어 카드 뒷면으로 대체한다(세트 화면과 같은 그림).
import { CARD_BACK } from '../lib/cardCatalog';
import { cardImg } from '../lib/cardImg';
import { SearchInput } from './SearchInput';
import { 작가이름 } from '../lib/artistName';

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
  cover?: string;
}

interface ArtistCard {
  name: string;
  number: string;
  set: string;
  img: string;
  /** 세트 슬러그(en-swsh11 등). scripts/fill-artist-slugs.mts가 채운다.
   *  이게 있어야 카드를 눌러 **그 한 장**의 시세로 갈 수 있다(없으면 이름으로만 찾는다). */
  s?: string;
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
  // ⚠️ **cardImg를 꼭 거친다.** 작가 카드 그림은 원래 pokemontcg.io의 ".png"라 그냥
  //    써도 됐는데, TCGdex에서 채운 카드는 주소 뒤에 크기가 없다
  //    ("assets.tcgdex.net/en/sv/sv08/045" → 404). cardImg가 "/high.webp"를 붙여 준다.
  //    이미 확장자가 있는 주소는 손대지 않으므로 옛 그림에는 아무 영향이 없다
  //    (2026-08-08: 안 거쳤더니 새로 채운 카드 그림이 깨졌다).
  return `/api/img?u=${encodeURIComponent(cardImg(url))}&w=${w}`;
}

// "이 포켓몬을 그린 작가"를 찾는다.
//
// public/artists/by-card.json은 { 카드이름(영어): [작가번호, …] } 꼴이다(작가번호는
// index.json의 순서). 작가 파일 389개를 다 열지 않으려고 미리 뒤집어 둔 목록이다
// (scripts/gen-artist-by-card.mts).
//
// ⚠️ 통째로 같은지 보면 안 된다. 카드 이름엔 변형이 붙는다 — "Pikachu VMAX" ·
//    "Absol-EX" · "Aegislash V". "피카츄"를 친 사람은 그것들도 다 보고 싶어 한다.
// ⚠️ 아포스트로피가 두 종류다. 우리 사전은 Farfetch’d(U+2019), 작가 데이터는
//    Farfetch'd(U+0027). 안 맞추면 파오리·창파나이트가 통째로 안 나온다(실측 2026-08-04).
const normName = (s: string) => s.toLowerCase().replace(/[‘’ʼ`´]/g, "'").trim();


/** by-card.json — c: 카드이름(영어) → 작가번호, k: 한글 → 영어 대조표. */
interface ByCard {
  c: Record<string, number[]>;
  k: Record<string, string>;
}

function artistsWhoDrew(
  byCard: ByCard,
  index: ArtistIndexEntry[],
  raw: string,
): { label: string; artists: ArtistIndexEntry[] } | null {
  const typed = normName(raw);
  if (typed.length < 2) return null;
  // ⚠️ 한글 대조표는 by-card.json이 같이 들고 온다.
  //    koreanizeEnglishTitle의 CARD_NAME_KO_TO_EN을 쓰려다 실패했다 — 그건 "카드명"
  //    사전이라 "피카츄 ★"는 있어도 그냥 "피카츄"가 없다(1,524개 중 0개, 2026-08-04 확인).
  const en = normName(byCard.k[raw.trim()] || raw);
  const hits = new Set<number>();
  for (const [name, artists] of Object.entries(byCard.c)) {
    const n = normName(name);
    if (!n.includes(en) && !n.includes(typed)) continue;
    for (const a of artists) hits.add(a);
  }
  if (!hits.size) return null;
  // 화면에는 사람이 친 말을 그대로 되돌려 준다("피카츄를 그린 작가 67명입니다").
  return {
    label: raw.trim(),
    artists: index.filter((_, i) => hits.has(i)),
  };
}

export function ArtistsView({ onPickCard }: { onPickCard: (card: 도감카드정보) => void }) {
  // 슬러그 → 세트(코드·이름). 카드를 눌렀을 때 그 한 장으로 좁히는 데 쓴다.
  // 세트 목록은 다른 화면도 쓰는 것이라 한 번 받아 두면 캐시된다.
  const [setBySlug, setSetBySlug] = useState<Map<string, SetIndexEntry> | null>(null);
  useEffect(() => {
    let 살아있음 = true;
    loadSetIndex()
      .then((list) => 살아있음 && setSetBySlug(new Map(list.map((s) => [s.slug, s]))))
      // 못 받아도 화면은 그대로 돈다 — 카드를 누르면 이름으로만 찾는다.
      .catch(() => {});
    return () => {
      살아있음 = false;
    };
  }, []);
  const [index, setIndex] = useState<ArtistIndexEntry[] | null>(null);
  // 못 불러온 것과 "정말 비어 있는 것"은 다르다. 예전에는 실패해도 빈 목록으로 두어
  // "작가 데이터를 준비 중입니다"가 떴다 — 데이터는 다 있는데 못 받은 것이라 사실이 아니다.
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<ArtistIndexEntry | null>(null);
  const [cards, setCards] = useState<ArtistCard[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  // 작가 한 명의 카드가 수백 장이라, 그 안에서 포켓몬명(한글·영어)으로 거르는 검색.
  const [cardQuery, setCardQuery] = useState('');
  // "이 포켓몬을 그린 작가"를 찾는 거꾸로 된 목록. 102KB라 목록 화면에 들어올 때만 받는다
  // (홈 첫 화면과는 무관하다). 못 받아도 작가 이름 검색은 그대로 된다.
  const [byCard, setByCard] = useState<ByCard | null>(null);

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
  const sub = useSubScreen<string>(
    'artist',
    (slug) => {
      if (!slug) {
        setSelected(null);
        return;
      }
      const a = indexRef.current?.find((x) => x.slug === slug);
      if (a) showArtist(a);
    },
    // 닫으면 목록 주소로, 열면 그 작가 주소로.
    { path: '/artists', title: '포켓몬 카드 일러스트레이터 | pokegre' },
    (slug) => `/artist/${slug}`,
  );

  const loadIndex = () => {
    setLoadFailed(false);
    setIndex(null);
    fetch('/artists/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ArtistIndexEntry[]) => {
        setIndex(list);
        indexRef.current = list;
        // 다른 화면에 갔다가 돌아왔을 때: 기록에 남은 상세를 복원한다.
        // /artist/<슬러그>로 바로 들어온 경우(검색·공유)도 같은 자리로 보낸다.
        const fromUrl = window.location.pathname.match(/^\/artist\/([\w.-]+)/)?.[1];
        const slug = fromUrl ?? (window.history.state as { sub?: { artist?: string } } | null)?.sub?.artist;
        const a = slug ? list.find((x) => x.slug === slug) : undefined;
        if (a) {
          showArtist(a);
          // 주소로 들어온 것도 목록에서 누른 것과 똑같이 통계에 남긴다.
          if (fromUrl) trackEvent('artist', a.en);
        }
      })
      .catch(() => {
        setIndex([]);
        setLoadFailed(true);
      });
  };
  useEffect(loadIndex, []);

  // 탭 제목도 지금 보는 작가로. ⚠️ 서버(server/index.ts의 /artist/:slug)와 같은 규칙이다
  //    — 이름은 한글이 있으면 한글, 없으면 영문(a.ko || a.en).
  useEffect(() => {
    if (!selected) {
      document.title = '포켓몬 카드 일러스트레이터 | pokegre';
      return;
    }
    // ⚠️⚠️ **여기가 서버 제목을 덮어쓴다.** 서버(`server/index.ts`)가 검색엔진용으로
    //    「신지 칸다(Shinji Kanda) 일러스트 카드」를 내보내도, 앱이 뜨면서 이 줄이
    //    다시 쓴다. **한쪽만 고치면 소용없다** — 구글은 자바스크립트를 돌린 뒤 화면을
    //    보므로 결국 이쪽 제목을 읽는다. 두 곳을 같은 꼴로 맞춘다(`작가이름`).
    const 이름 = 작가이름(selected.ko, selected.en);
    if (이름) document.title = `${이름} 일러스트 카드 | pokegre`;
  }, [selected]);

  // "이 포켓몬을 그린 작가" 목록. 목록 화면에 들어올 때 한 번만 받는다.
  // 실패해도 아무 말 안 한다 — 작가 이름 검색은 그대로 되고, 포켓몬 검색만 안 될 뿐이다.
  useEffect(() => {
    void fetch('/artists/by-card.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ByCard | null) => setByCard(d && d.c ? d : null))
      .catch(() => undefined);
  }, []);

  function openArtist(a: ArtistIndexEntry) {
    trackEvent('artist', a.en);
    showArtist(a);
    sub.push(a.slug);
    // 주소를 남긴다 — 새로고침·공유해도 같은 작가가 열리고, 검색엔진이 들어올 문이 된다.
    window.history.replaceState(window.history.state, '', `/artist/${a.slug}`);
  }

  // ── 작가 한 명의 카드 그리드 ────────────────────────────────────────────────
  if (selected) {
    // 포켓몬명 검색: 한글(변환)·영어 어느 쪽으로 쳐도 걸러진다.
    // ⚠️ **아래 그리드가 보여주는 것과 같은 함수(koCardName)로 견준다.** 예전엔 여기만
    //    koreanizeEnglishCardName을 썼는데, 그 함수는 전각 부호를 안 다듬는다. 그래서
    //    화면에는 "초련&담죽"이라 적혀 있는데 검색은 "초련＆담죽"과 견주어,
    //    **보이는 대로 쳐도 안 걸렸다**(2026-08-08. "포로!핸드 익스텐션"도 같다).
    const cq = cardQuery.trim().toLowerCase();
    const filtered = cq
      ? (cards ?? []).filter(
          (c) => c.name.toLowerCase().includes(cq) || koCardName('en', c.name).toLowerCase().includes(cq),
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
          {/* 표지 주소가 죽어 있는 작가가 있다(원본에서 그림이 내려간 경우). 비워 두면
              깨진 아이콘이 뜨므로 카드 뒷면으로 대체한다 — 세트 화면과 같은 방식이다. */}
          <img
            src={selected.cover ? thumb(selected.cover, 200) : CARD_BACK}
            alt={selected.en}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const t = e.currentTarget;
              if (selected.cover && t.src !== selected.cover) t.src = selected.cover;
              else if (!t.src.endsWith(CARD_BACK)) t.src = CARD_BACK;
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
                // ⚠️ 예전엔 koreanizeEnglishCardName만 썼다. 화면·서버가 쓰는 정식
                //    규칙과 달라(번호 꼬리·전각 부호를 안 다듬는다) 같은 카드가 여기서만
                //    다르게 보였다. 작가 데이터는 전부 영문판이라 'en'으로 부른다.
                const koName = koCardName('en', c.name);
                // 작가 데이터는 전부 영문판이다(pokemontcg.io 기준). 세트 슬러그가 있으면
                // 세트·번호까지 넘겨 그 한 장으로 좁힌다. 없으면(22장) 이름만 넘긴다.
                const meta = c.s ? setBySlug?.get(c.s) : undefined;
                const 한장: 도감카드정보 = {
                  ko: koName,
                  en: c.name,
                  raw: c.name,
                  speciesEn: '',
                  slug: c.s ?? '',
                  setCode: meta?.id ?? '',
                  setName: meta?.name ?? c.set,
                  setNameKo: koSetName(meta?.name ?? c.set),
                  num: meta ? c.number : '',
                  jp: false,
                  // 마켓에 값이 없을 때 "무엇을 찾고 있는지" 보여줄 그림.
                  img: c.img ?? '',
                };
                return (
                  <div key={`${c.name}-${c.number}-${i}`} className="contents">
                  {i === 4 && <AdSlot 형태="가로" 이름="작가" className="col-span-full sm:hidden" />}
                  {i === 6 && <AdSlot 형태="가로" 이름="작가" className="col-span-full hidden sm:block md:hidden" />}
                  {i === 8 && <AdSlot 형태="가로" 이름="작가" className="col-span-full hidden md:block" />}
                  <button
                    type="button"
                    onClick={() => onPickCard(한장)}
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
                    {/* ⚠️ 번호가 없으면 같은 이름 카드가 여럿일 때 어느 것인지 알 수 없다.
                        도감·세트 목록은 보여 주는데 작가 목록만 빠져 있었다(점검 중 발견
                        2026-08-06). 세트 이름과 한 줄에 두면 잘리므로 아래에 따로 적는다. */}
                    {c.number && <p className="text-[10px] text-neutral-300">{c.number}</p>}
                  </button>
                  </div>
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
                  더 보기 ({filtered.length - shown}종)
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
          {/* ⚠️ 설명 줄을 없앴다(사장님 지시 2026-08-27) — 제목이 곧 설명이고, 화면에
              작가 이름이 죽 깔려 있어 무엇을 하는 곳인지 바로 보인다. */}
          <h2 className="text-lg font-bold text-black">작가별 카드</h2>
        </div>
        {index && index.length > 0 && (
          <SearchInput
            value={query}
            onChange={setQuery}
            /* ⚠️ 작가 388명 중 68명은 한글 이름이 없다(회사·활동명이 대부분이라 옮길
               한글이 없다). 그래서 "아네사키"로는 못 찾고 "Anesaki"로만 찾힌다
               (2026-08-07 점검 중 확인). 영문으로도 된다는 것을 예시로 알린다. */
            placeholder="작가 이름 또는 포켓몬 (아리타, Anesaki, 피카츄)"
            className="w-full flex-shrink-0 sm:w-60 md:w-72"
          />
        )}
      </div>

      {index === null ? (
        <p className="py-16 text-center text-sm text-neutral-400">불러오는 중…</p>
      ) : loadFailed ? (
        <div className="py-16 text-center">
          <p className="text-sm font-semibold text-neutral-600">작가 목록을 불러오지 못했습니다</p>
          <p className="mt-1 text-xs text-neutral-400">연결을 확인하고 다시 눌러 주세요.</p>
          <button
            type="button"
            onClick={loadIndex}
            className="mt-3 rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white"
          >
            다시 시도
          </button>
        </div>
      ) : index.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-400">작가 데이터를 준비 중입니다.</p>
      ) : (
        <ArtistList index={index} query={query} byCard={byCard} onOpen={openArtist} />
      )}
    </div>
  );
}

// 작가 목록 + 검색. 작가 이름(영·한)뿐 아니라 포켓몬 이름으로도 찾는다.
//
// ⚠️ 작가 이름으로 먼저 찾고, 하나도 안 걸릴 때만 포켓몬으로 본다. 반대로 하면
//    "미츠히로 아리타"를 치는 사람이 엉뚱한 카드 목록을 보게 된다.
function ArtistList({
  index,
  query,
  byCard,
  onOpen,
}: {
  index: ArtistIndexEntry[];
  query: string;
  byCard: ByCard | null;
  onOpen: (a: ArtistIndexEntry) => void;
}) {
  const q = query.trim().toLowerCase();
  const byName = q ? index.filter((a) => a.en.toLowerCase().includes(q) || a.ko.toLowerCase().includes(q)) : index;
  // 작가 이름으로 못 찾았을 때만 "이 포켓몬을 그린 사람"으로 넘어간다.
  const pokemonHit = q && byName.length === 0 && byCard ? artistsWhoDrew(byCard, index, query) : null;
  const filtered = pokemonHit ? pokemonHit.artists : byName;
  // ⚠️ 388명을 한 번에 펴면 폰에서 22화면(17,968px)이 된다(운영자 지적 2026-08-05).
  //    처음엔 40명만 보이고 눌러서 늘린다. 찾는 사람은 위 검색칸을 쓰고, 훑는 사람은
  //    필요한 만큼만 늘린다. 검색 중일 때는 결과를 자르지 않는다 — 찾으려던 사람이
  //    "없다"고 오해한다.
  const 한번에 = 40;
  const [보임, set보임] = useState(한번에);
  useEffect(() => set보임(한번에), [query]);
  const 볼목록 = query.trim() ? filtered : filtered.slice(0, 보임);
  const 더있음 = 볼목록.length < filtered.length;

  // 포켓몬으로 찾아 결과가 나온 검색만 센다. 이 기능을 실제로 쓰는지 봐야 유지할지
  // 판단할 수 있다. 타이핑 도중에 여러 번 세지 않도록 검색어가 바뀔 때 한 번만 센다.
  const countedRef = useRef('');
  useEffect(() => {
    if (!pokemonHit || pokemonHit.artists.length === 0) return;
    if (countedRef.current === q) return;
    countedRef.current = q;
    trackEvent('artist_by_pokemon');
  }, [q, pokemonHit]);

  return (
    <>
      {pokemonHit && pokemonHit.artists.length > 0 && (
        <p className="mb-3 text-sm text-neutral-600">
          <span className="font-bold text-black">{pokemonHit.label}</span>
          {을를(pokemonHit.label)} 그린 작가 {pokemonHit.artists.length}명입니다.
        </p>
      )}
      {filtered.length === 0 ? (
        // 작가 이름으로도, 포켓몬으로도 못 찾았을 때. 둘 다 되는 칸이므로 둘 다 알려 준다.
        <p className="py-16 text-center text-sm text-neutral-400">
          '{query}'에 맞는 작가가 없습니다. 포켓몬 이름으로도 찾을 수 있습니다.
        </p>
      ) : (
        // ⚠️ 폰에서 1열이라 388명이 58.9화면(47,840px)으로 늘어섰고, 한 칸 341px 중
        //    글자가 쓰는 건 140px뿐이라 오른쪽 200px이 비었다(실측 2026-08-04).
        //    2열로 바꾸면 줄 수가 반으로 줄고 빈칸도 없어진다. 그림은 조금 줄여
        //    좁아진 칸에 이름이 들어갈 자리를 남긴다.
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {볼목록.map((a) => (
            <button
              key={a.slug}
              type="button"
              onClick={() => onOpen(a)}
              className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white p-2 text-left hover:shadow-md sm:gap-3 sm:p-3"
            >
              <img
                src={a.cover ? thumb(a.cover, 140) : CARD_BACK}
                alt={a.en}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const t = e.currentTarget;
                  if (a.cover && t.src !== a.cover) t.src = a.cover;
                  else if (!t.src.endsWith(CARD_BACK)) t.src = CARD_BACK;
                }}
                className="h-[64px] w-[46px] flex-shrink-0 rounded object-cover sm:h-[84px] sm:w-[60px]"
              />
              <div className="min-w-0 flex-1">
                {/* ⚠️ **한글을 크게, 영문을 작게.** 포켓몬 화면이 그렇게 하고 있는데
                    작가만 반대라 같은 성격의 화면인데 눈이 가는 곳이 달랐다(2026-08-08).
                    ⚠️ 작가 388명 중 68명은 한글 이름이 없다(회사·활동명). 그때는 영문을
                       큰 자리에 그대로 두어 빈 줄이 생기지 않게 한다. */}
                <p className="line-clamp-1 text-xs font-bold text-black sm:text-sm">{a.ko || a.en}</p>
                {a.ko && a.ko !== a.en && <p className="line-clamp-1 text-[11px] text-neutral-500 sm:text-xs">{a.en}</p>}
                {/* 종수는 폰에서 자기 줄로 내린다 — 옆에 두면 이름 자리를 40px 먹는다. */}
                <p className="mt-0.5 text-[11px] font-semibold text-neutral-400 sm:hidden">
                  {a.count.toLocaleString()}종
                </p>
              </div>
              <span className="hidden flex-shrink-0 self-start rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-500 sm:inline">
                {a.count.toLocaleString()}종
              </span>
            </button>
          ))}
        </div>
      )}
      {더있음 && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => set보임((n) => n + 한번에)}
            className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            더 보기 <span className="text-neutral-400">({볼목록.length} / {filtered.length}명)</span>
          </button>
        </div>
      )}
    </>
  );
}
