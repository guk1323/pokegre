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
import { serieSlug } from '../lib/setNameKo';
import { isPocketSet } from '../lib/pocketSets';
import type { 도감카드정보 } from '../lib/pokedexRoute';
import { useSubScreen } from '../lib/useSubScreen';
import { trackEvent } from '../api/localStats';
import { fetchExchangeRates, formatKrwApprox } from '../api/exchangeRate';

// 세트(발매 패키지)별 수록 카드. 데이터는 TCGdex에서 미리 긁어 public/sets/에 저장해둔 걸
// 읽는다. 일본판(ja)·북미판(en). 카드 이름은 원어로 저장돼 있어 화면에서 우리 변환기로
// 한글화한다. 공개 화면(더보기 ▾ 메뉴). 세트 데이터는 정적 public/sets JSON이라 서버 인증 불필요.
// 타입·이미지 규칙·한글화는 플리마켓 카드 고르기와 함께 쓰므로 lib/cardCatalog.ts에 있다.

const PAGE = 60;

// 시리즈(세트 묶음) 이름. 자동 번역에 맡기면 소리로만 옮겨지거나(ブラック＆ホワイト →
// "블랙＆호와이토") 일본판·북미판이 서로 다르게 나와서, 화면에 뜰 이름은 여기서 못 박는다.
//
// 규칙 세 가지 (2026-08-03 확정):
//  ① 일본판 앞에 붙는 "포켓몬카드게임"은 뗀다 — 어차피 전부 포켓몬 카드다.
//  ② & 앞뒤에 공백 한 칸. 일본판의 전각 ＆도 반각 &로 맞춘다.
//  ③ 같은 시리즈면 일본판·북미판 탭에서 글자가 똑같아야 한다.
// ⚠️ 주소(/series/<슬러그>)와 사이트맵은 원문으로 만든다(serieSlug). 여기를 바꿔도
//    주소는 그대로라 링크가 깨지지 않는다.
const SERIE_LABEL: Record<string, string> = {
  // 일본판
  'ポケットモンスターカードゲーム': '초기 시리즈 (1996~)',
  'ブラック＆ホワイト': '블랙 & 화이트',
  'サン＆ムーン': '썬 & 문',
  '剣と盾': '소드 & 실드',
  'ポケモンカードゲーム スカーレット&バイオレット': '스칼렛 & 바이올렛',
  'ポケモンカードゲーム MEGA': '메가 에볼루션',
  // 북미판
  Miscellaneous: '기타',
  Gym: '짐',
  Neo: '네오',
  'E-Card': 'e카드',
  'Trainer kits': '트레이너 키트',
  "McDonald's Collection": '맥도날드 컬렉션',
  'Black & White': '블랙 & 화이트',
  'Sun & Moon': '썬 & 문',
  'Sword & Shield': '소드 & 실드',
  'Scarlet & Violet': '스칼렛 & 바이올렛',
  // 포켓
  'Pokémon TCG Pocket': '포켓몬 TCG 포켓',
  // EX·POP·XY·VS·web·PCG·XY BREAK은 브랜드 이름이라 영문 그대로 둔다.
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
  initialSerie,
  onInitialSlugDone,
}: {
  /**
   * 카드 한 장을 눌렀을 때. 이름만 넘기면 같은 이름 카드가 다 나오므로, 세트·번호·판을
   * 통째로 넘겨 그 한 장으로 좁힌다(도감이 쓰는 것과 같은 규칙 — lib/pokedexRoute.ts).
   */
  onPickCard: (card: 도감카드정보) => void;
  // 팩 개봉 화면의 "수록 카드 보기"가 특정 세트를 바로 열 때 쓴다.
  initialSlug?: string | null;
  // /series/<슬러그>로 들어왔을 때 그 시리즈가 있는 탭을 열고 거기로 스크롤한다.
  // 안 해주면 "소드실드 카드 목록"으로 검색해 들어온 사람에게 엉뚱한 시리즈가 보인다.
  initialSerie?: string | null;
  // 위 이동을 한 번 적용한 뒤 App의 기억을 지운다 — 안 지우면 세트별 목록에
  // 들어올 때마다 그 세트로 강제 이동돼 목록을 볼 수 없게 된다(실제 겪은 버그).
  onInitialSlugDone?: () => void;
}) {
  const [index, setIndex] = useState<SetIndexEntry[] | null>(null);
  // 못 불러온 것과 "정말 비어 있는 것"은 다르다. 예전에는 실패해도 빈 목록으로 두어
  // "검색 결과가 없습니다 · 다른 이름으로 찾아보세요"가 떴다 — 검색한 적도 없는데
  // 사용자 잘못인 것처럼 보이고, 사이트에 세트가 없다고 오해하게 만든다.
  // 배포 중(7초)이나 지하철에서 신호가 끊길 때 실제로 이 화면이 뜬다.
  const [loadFailed, setLoadFailed] = useState(false);
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
      // 목록에서 누른 것과 똑같이 통계에 남긴다. 예전에는 여기서 안 남겨서
      // 검색·공유 링크(/set/<슬러그>)로 바로 들어온 방문이 통째로 안 세어졌다.
      // 사이트맵에 세트 366개를 올려 뒀으니 그 유입이 제일 큰 몫인데 안 보였다.
      trackEvent('sets', koSet(hit.ed, hit.name));
      showSet(hit);
    }
    onInitialSlugDone?.();
    // showSet은 렌더마다 새로 만들어지는 일반 함수라 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlug, index]);
  // /series/<슬러그>로 들어온 경우: 그 시리즈가 있는 탭으로 옮기고 그 자리로 스크롤한다.
  const serieApplied = useRef(false);
  useEffect(() => {
    if (!initialSerie || !index || serieApplied.current) return;
    const hit = index.find((e) => serieSlug(e.serie ?? '') === initialSerie);
    if (!hit) return;
    serieApplied.current = true;
    setTab(hit.slug.startsWith('ja-') ? 'ja' : /pocket/i.test(hit.serie ?? '') ? 'pocket' : 'en');
    // 사이트맵에 시리즈 33개를 올려 뒀는데 여기서 안 남겨서, 검색으로 들어온 방문이
    // 통째로 안 세어졌다(세트 쪽에서 똑같은 걸 한 번 고쳤다 — 위 initialSlug 주석).
    // 화면에 뜨는 이름 그대로 남긴다. koSet을 쓰면 통계에만 옛 이름("포켓몬카드게임 MEGA")이
    // 남아 같은 시리즈가 두 줄로 갈린다.
    trackEvent('series', koSerie(hit.ed, hit.serie ?? ''));
    // 탭이 바뀌고 목록이 그려진 뒤에 스크롤해야 자리를 찾는다.
    setTimeout(() => {
      document.getElementById(`serie-${initialSerie}`)?.scrollIntoView({ block: 'start' });
    }, 300);
  }, [initialSerie, index]);

  const [cards, setCards] = useState<SetCard[] | null>(null);
  // 값이 높은 순으로 고른 힛카드. 앨범 시세를 받아 둔 세트에서만 온다.
  // 없는 세트는 예전처럼 레어도로 고른다(그때는 "주요 카드"라고 부른다).
  const [hitCards, setHitCards] = useState<{ n: string; usd: number; name: string }[] | null>(null);
  // 어느 마켓 값인지. 일본판 신상은 스니커덩크(일본 실거래)가 더 정확해서 그쪽을 쓴다.
  const [hitSrc, setHitSrc] = useState<'snkrdunk' | 'tcgplayer'>('tcgplayer');
  // 스니커덩크는 같은 카드가 상태별로 갈려 거래되고 값이 두 배까지 벌어진다.
  // 어느 등급 값인지 밝히지 않으면 "내 카드도 이 값"이라고 오해한다.
  const [hitGrade, setHitGrade] = useState<'psa10' | 'a'>('a');
  // 힛카드 값을 원화로 보여주려고 환율을 한 번 받아 둔다. 못 받으면 달러로 적는다.
  const [usdToKrw, setUsdToKrw] = useState<number | null>(null);
  // 값이 제일 높은 카드를 세트 표지로 쓴다. 원본이 주는 표지는 그 세트의 1번 카드라
  // 대개 평범한 카드다 — 목록에서 어떤 세트인지 알아보기 어렵다.
  // 시세를 받아 둔 세트만 온다. 없으면 지금까지 쓰던 표지를 그대로 쓴다.
  const [bestCovers, setBestCovers] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch('/api/local/set-covers')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBestCovers(d?.covers ?? {}))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    void fetchExchangeRates().then((r) => setUsdToKrw(r?.usdToKrw ?? null));
  }, []);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(PAGE);
  // 목록에서 한 번에 보여 줄 세트 수("더 보기"로 늘린다). 자세한 이유는 아래 쓰는 자리에.
  //
  // ⚠️ 이 두 줄은 반드시 다른 훅들과 함께 **여기**, 즉 아래 `if (selected)`(세트 상세로
  //    빠지는 이른 return)보다 위에 있어야 한다. 아래에 두면 세트를 열 때만 훅이 두 개
  //    모자라게 실행돼 화면이 통째로 깨진다(React #300). 실제로 그렇게 짰다가 세트를
  //    누르면 "화면을 표시하지 못했습니다"가 떴다(2026-08-05 배포 전 점검에서 발견).
  //    쓰는 자리 가까이 두고 싶어도 훅은 조건·return보다 먼저여야 한다.
  const 세트한번에 = 30;
  const [세트보임, set세트보임] = useState(세트한번에);
  // 찾는 말이나 판(일본/북미/포켓)을 바꾸면 처음부터 다시 센다.
  useEffect(() => set세트보임(세트한번에), [query, tab]);

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
      .then((d) => {
        setHitCards(d?.priced && d.cards?.length ? d.cards : null);
        setHitSrc(d?.src === 'snkrdunk' ? 'snkrdunk' : 'tcgplayer');
        setHitGrade(d?.grade === 'psa10' ? 'psa10' : 'a');
      })
      .catch(() => setHitCards(null));
  }

  // 세트 상세를 방문기록 한 칸으로: 뒤로가기 = 세트 목록으로.
  const sub = useSubScreen<string>(
    'set',
    (slug) => {
      if (!slug) {
        setSelected(null);
        return;
      }
      const s = indexRef.current?.find((x) => x.slug === slug);
      if (s) showSet(s);
    },
    // 닫으면 주소·탭 제목을 목록으로. (App.tsx의 VIEW_PATH·VIEW_TITLE과 같은 값이어야 한다.)
    { path: '/sets', title: '포켓몬 카드 세트 목록 | pokegre' },
    // 열면 그 세트의 주소로. 서버가 이미 아는 주소라 복사해 붙여도 그대로 열린다.
    (slug) => `/set/${slug}`,
  );

  const loadIndex = () => {
    setLoadFailed(false);
    setIndex(null);
    loadSetIndex()
      .then((list: SetIndexEntry[]) => {
        setIndex(list);
        indexRef.current = list;
        // 다른 화면에 갔다가 돌아왔을 때: 기록에 남은 상세를 복원한다.
        const slug = (window.history.state as { sub?: { set?: string } } | null)?.sub?.set;
        const s = slug ? list.find((x) => x.slug === slug) : undefined;
        if (s) showSet(s);
      })
      .catch(() => {
        setIndex([]);
        setLoadFailed(true);
      });
  };
  useEffect(loadIndex, []);

  // 탭 제목도 지금 보는 세트로 바꾼다.
  // ⚠️ 서버(server/index.ts의 /set/:slug)가 붙이는 제목과 **글자까지 같아야** 한다.
  //    다르면 같은 화면인데 새로고침 전후로 탭 이름이 바뀐다. 서버는 값이 있는 세트면
  //    "힛카드 시세", 없으면 "카드 목록"이라고 적는다.
  useEffect(() => {
    if (!selected) {
      // 상세를 닫으면 목록 제목으로 되돌린다. 안 되돌리면 주소는 /sets인데 탭에는
      // 방금 본 세트가 남는다.
      document.title = '포켓몬 카드 세트 목록 | pokegre';
      return;
    }
    const 이름 = koSet(selected.ed, selected.name);
    document.title = hitCards?.length ? `${이름} 힛카드 시세 | pokegre` : `${이름} 카드 목록 | pokegre`;
  }, [selected, hitCards]);

  function openSet(s: SetIndexEntry) {
    // 어떤 세트를 열었는지 통계에 남긴다(운영자 방문 통계의 "세트별 조회" 랭킹). 라벨은 화면 한글명.
    trackEvent('sets', koSet(s.ed, s.name));
    showSet(s);
    sub.push(s.slug);
  }

  // ── 세트 한 개의 카드 그리드 ──────────────────────────────────────────────
  if (selected) {
    // 휴대폰 게임(Pokémon TCG Pocket) 세트. 목록은 그대로 보여 주되 카드를 눌러도
    // 시세로 보내지 않는다 — 실물이 없어 볼 값이 없다(운영자 결정 2026-08-06).
    const 포켓세트 = isPocketSet(selected.serie);
    // 눌린 카드를 "어느 세트 몇 번인지"까지 갖춘 한 장으로 만든다. 이게 있어야 마켓을
    // 옮겨 다니며 그 한 장을 찾을 수 있다.
    const 한장 = (c: SetCard): 도감카드정보 => ({
      ko: koName(selected.ed, c.name),
      // 북미판은 카드 원문이 곧 영문 이름이다. 일본판은 없으니 빈 값 — 부르는 쪽이
      // 한글 이름을 번역해 쓴다.
      en: selected.ed === 'en' ? c.name : '',
      raw: c.name,
      // 세트 화면은 어느 포켓몬인지 모른다. 비워 두면 한글 이름으로 물러선다.
      speciesEn: '',
      slug: selected.slug,
      setCode: selected.id,
      setName: selected.name,
      setNameKo: koSet(selected.ed, selected.name),
      num: c.n,
      jp: selected.ed !== 'en',
    });
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

        {/* 세트 헤더: 이름 + 정보 칩.
            ⚠️ 이름 옆 그림을 뺐다(2026-08-05, 운영자 지시). 뺀 이유가 셋이다.
            ① 원래 쓰던 selected.cover는 그 세트의 1번 카드인데, 1번은 대개 평범한
               커먼이라 세트를 알아보는 데 도움이 안 됐다(닌자스피너에 비드루가 떴다).
            ② 대신 쓸 만한 그림이 371개 중 227개뿐이다. 일본판 로고를 주는 limitless는
               로고가 아니라 "M6"·"s8b" 같은 까만 세트코드 글자판을 준다.
            ③ 팩(박스) 사진을 더 받아 채워 보려 했지만, 옛 세트는 미개봉 박스가 시장에
               없어서 PSA 슬랩 사진·남의 책상 사진 같은 엉뚱한 것이 붙었다(79개 중
               대부분). 되돌렸다.
            바로 아래 힛카드에 그 세트에서 제일 비싼 카드가 크게 나오므로, 머리에
            그림이 없어도 허전하지 않다. */}
        <div className="mb-5 flex items-center gap-4">
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
            <p className="mt-1.5 text-xs text-neutral-400">
              {isPocketSet(selected.serie)
                ? '휴대폰 게임 전용 카드입니다. 실물이 없어 시세는 없고, 그림과 이름만 보실 수 있습니다.'
                : '카드를 누르면 그 카드 시세를 검색합니다.'}
            </p>
            {/* ⚠️ 그림이 통째로 없는 세트가 18개 있다(트레이너 킷·맥도날드 프로모 등 270장,
                실측 2026-08-04). 열면 카드 뒷면만 죽 늘어서는데 왜인지 아무 말이 없어
                "고장인가" 싶게 된다. 이름과 번호는 맞으므로 카드를 눌러 시세는 볼 수 있다 —
                그걸 알려 준다. 그림은 어느 소스에도 없어서 채울 방법이 지금은 없다. */}
            {cards && cards.length > 0 && !isPocketSet(selected.serie) && cards.every((c) => !usable(c.img)) && (
              <p className="mt-1.5 text-xs text-neutral-500">
                이 세트는 카드 그림을 구하지 못했습니다. 이름과 번호는 맞으니 눌러서 시세는 보실 수 있습니다.
              </p>
            )}
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
              // 힛카드와 아래 전체 목록이 뭉개져 보인다는 제보. 힛카드만 옅은 판 위에 얹어
              // 한 덩어리로 묶고, 아래 목록에는 제목을 따로 달아 둘을 갈라 놓는다.
              <div className="mb-6 rounded-2xl bg-neutral-50 p-4 ring-1 ring-neutral-200/70">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
                  <p className="text-base font-bold text-black">
                    {pricedMode ? `힛카드 TOP ${highlights.length}` : '주요 카드'}
                  </p>
                  {/* 기준을 안 밝히면 "왜 스니커덩크 값과 다르냐"는 오해가 생긴다.
                      둘 다 등급 카드가 아니라 미감정 생카드 값이다.
                      ⚠️ 어느 마켓인지는 세트마다 다르다 — 일본판 신상은 TCGplayer(미국)에
                         낙찰가가 아직 없어서 스니커덩크(일본 실거래)를 쓴다. 값을 바꿔
                         보여주면서 라벨만 그대로 두면 오해가 더 커진다. */}
                  {pricedMode && (
                    <span className="text-[11px] text-neutral-400">
                      {hitSrc !== 'snkrdunk'
                        ? 'TCGplayer 마켓가 · 미감정 기준'
                        : hitGrade === 'psa10'
                          ? 'SNKRDUNK 실거래 · PSA10 기준'
                          : 'SNKRDUNK 실거래 · 미감정(A등급) 기준'}
                    </span>
                  )}
                </div>
                {/* ⚠️ 폰에서 4열이라 한 칸이 68px이었다. 바로 아래 "수록 카드" 목록은
                    3열 106px이라, 보여주려고 뽑아 올린 카드가 일반 목록보다 작았다
                    (실측 2026-08-04). 폰에서는 3열로 맞추고, 큰 화면은 4열 그대로 둔다. */}
                <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4">
                  {highlights.map((c) => {
                    const nm = koName(selected.ed, c.name);
                    return (
                      <button
                        key={`top-${c.n}`}
                        type="button"
                        onClick={포켓세트 ? undefined : () => onPickCard(한장(c))}
                        aria-disabled={포켓세트 || undefined}
                        className={`text-left ${포켓세트 ? 'cursor-default' : 'group'}`}
                      >
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
                        {/* 두 줄까지 보여준다. 한 줄로 자르면 "로켓단의 뮤츠 ex"처럼 접두사가
                            긴 카드가 폰에서 전부 "로켓단의…"로 나와 어느 카드인지 알 수 없다. */}
                        {/* ⚠️ 번호는 아래 "수록 카드" 목록과 같은 방식으로 붙인다. 한 세트에
                            같은 이름이 둘 이상인 카드가 전체의 34%다(샤이니트레저 ex는 330장).
                            여기만 번호가 없으면 같은 화면에서 규칙이 갈려, 위에서 고른 카드가
                            아래 목록의 어느 장인지 알 수 없다(2026-08-07 점검 중 발견). */}
                        <div className="mt-1.5 flex items-start justify-between gap-1.5">
                          <p className="line-clamp-2 min-h-[2rem] text-[11px] font-bold leading-snug text-black">
                            {nm}
                          </p>
                          <span className="flex-shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-500">
                            {c.n}
                          </span>
                        </div>
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

            <p className="mb-3 text-base font-bold text-black">
              수록 카드 <span className="text-neutral-400">{(cards ?? []).length}종</span>
            </p>
            <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
              {visible.map((c, i) => {
                const nm = koName(selected.ed, c.name);
                return (
                  // 휴대폰 게임 카드는 눌러도 볼 시세가 없다. 누르는 것처럼 보이지
                  // 않게 하고(확대 효과·손가락 커서 제거) 실제로도 아무 데도 안 보낸다.
                  <button
                    key={`${c.n}-${i}`}
                    type="button"
                    onClick={포켓세트 ? undefined : () => onPickCard(한장(c))}
                    aria-disabled={포켓세트 || undefined}
                    className={`text-left ${포켓세트 ? 'cursor-default' : 'group'}`}
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
                      <p className="line-clamp-2 text-xs font-bold leading-snug text-black">{nm}</p>
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

  // ⚠️ 세트 157개를 한 번에 펴면 폰에서 17.7화면(14,387px)이 된다(운영자 지적
  //    2026-08-05). 시리즈 묶음 단위로 잘라 처음엔 6묶음만 보이고, 눌러서 늘린다.
  //    ⚠️ 세트를 세지 않고 **시리즈를 센다**. 세트로 자르면 묶음 가운데가 잘려
  //       "이 시리즈는 세트가 3개뿐인가?" 하고 오해한다.
  //    ⚠️ 찾는 중일 때는 안 자른다 — 찾으려던 세트가 잘리면 "없다"고 오해한다.
  //    ⚠️ 묶음 개수로 자르면 안 된다. 시리즈마다 세트 수가 3개에서 30개까지 제각각이라,
  //       6묶음만 남겨도 14화면이었다(실측). **세트 수**로 세되 묶음은 안 쪼갠다.
  const 볼묶음 = (() => {
    if (q.trim()) return groups;
    const out: typeof groups = [];
    let n = 0;
    for (const g of groups) {
      if (out.length && n >= 세트보임) break;
      out.push(g);
      n += g.sets.length;
    }
    return out;
  })();
  const 남은묶음 = groups.length - 볼묶음.length;
  const 남은세트 = groups.slice(볼묶음.length).reduce((n, g) => n + g.sets.length, 0);

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
            // ⚠️ 폰에서 손가락으로 누르기엔 24px이 작았다(운영자 지적 2026-08-05).
            //    위아래 여백을 4px → 10px로 올려 40px로 만든다 — 상단 메뉴(홈·커뮤니티)와
            //    같은 크기다. 권장 최소가 44px이라 그 언저리다.
            className={`rounded-full px-3.5 py-2.5 text-xs font-semibold ${tab === e ? 'bg-black text-white' : 'text-neutral-600'}`}
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
      ) : loadFailed ? (
        <div className="py-20 text-center">
          <p className="text-sm font-semibold text-neutral-600">세트 목록을 불러오지 못했습니다</p>
          <p className="mt-1 text-xs text-neutral-400">연결을 확인하고 다시 눌러 주세요.</p>
          <button
            type="button"
            onClick={loadIndex}
            className="mt-3 rounded-full bg-black px-4 py-1.5 text-xs font-semibold text-white"
          >
            다시 시도
          </button>
        </div>
      ) : list.length === 0 ? (
        <div className="py-20 text-center">
          <p className="mt-2 text-sm font-semibold text-neutral-500">검색 결과가 없습니다</p>
          <p className="mt-1 text-xs text-neutral-400">다른 이름으로 찾아보세요.</p>
        </div>
      ) : (
        볼묶음.map((grp) => (
          <section key={grp.serie} id={`serie-${serieSlug(grp.serie)}`} className="mb-8 scroll-mt-24">
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
                      src={(() => {
                        const best = bestCovers[s.slug];
                        const pick = usable(best) ? best : s.cover;
                        return usable(pick) ? thumb(cardImg(pick), 200) : CARD_BACK;
                      })()}
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
                  {/* 이름 칸을 두 줄로 고정한다. 안 그러면 이름이 긴 세트만 날짜 줄이 내려가
                      옆 칸과 어긋난다(「스타트 덱 100 배틀컬렉션」). */}
                  <p className="mt-1.5 line-clamp-2 min-h-[2.25rem] text-xs font-bold leading-snug text-black">
                    {koSet(s.ed, s.name)}
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-neutral-400">
                    {s.count}종{s.releaseDate ? ` · ${shortDate(s.releaseDate)}` : ''}
                  </p>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
      {남은묶음 > 0 && (
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={() => set세트보임((n) => n + 세트한번에)}
            className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            더 보기 <span className="text-neutral-400">(세트 {남은세트}개 · 시리즈 {남은묶음}개 남음)</span>
          </button>
        </div>
      )}
    </div>
  );
}
