import { useEffect, useState } from 'react';
import { livePacks } from '../lib/packSets';
import { trackEvent } from '../api/localStats';
import { useKrw } from './KrwHint';
// ⚠️ cardCatalog가 아니라 cardImg에서 가져온다 — cardCatalog는 이름 사전을 통째로
//    끌고 와서 첫 화면이 109KB 무거워진다(cardImg.ts 첫머리 설명 참고).
import { cardImg } from '../lib/cardImg';

// 홈(인기 검색어 ↓ 포켓몬 뉴스 ↑ 사이)에 놓는 "오늘의 상점" — 카드 개봉 입구.
// 다른 섹션(인기 검색어·뉴스)과 같은 기본 톤(흰 바탕·neutral 테두리)을 따른다.
// 튀는 색·이모지·라벨은 쓰지 않는다(사용자 지침). 진열은 개봉 화면과 같은 계산이라
// 매일 자정(KST)에 함께 바뀐다.

const thumb = (url: string, w: number) => `/api/img?u=${encodeURIComponent(url)}&w=${w}`;
const won = (n: number) => `${n.toLocaleString()} GP`;

// 배너에 쓸 등급 표기. 여기만 쓰는 몇 줄이라 따로 두지 않는다.
// ⚠️ 카드 "이름"은 서버가 준 것을 그대로 쓴다. 여기서 번역하려면 이름 사전을 받아야
//    하는데, 사전이 내려받는 양의 절반이라 첫 화면이 다시 무거워진다(91KB로 줄여 뒀다).
//    이름은 개봉한 사람의 화면이 서버에 알려 준다(PackSim의 sendHighlightName).
const TIER_KO: Record<string, [string, string]> = {
  // [일본판, 북미판]
  'Illustration rare': ['AR', 'IR'],
  'Ultra Rare': ['SR', 'UR'],
  'Special illustration rare': ['SAR', 'SIR'],
  'Hyper rare': ['UR', 'HR'],
  'Mega Ultra Rare': ['MUR', 'MUR'],
  'Mega Hyper Rare': ['MHR', 'MHR'],
  'Double rare': ['RR', 'RR'],
};

interface Highlight {
  at: number;
  nick: string;
  slug: string;
  n: string;
  r?: string;
  img?: string;
  usd?: number;
  god?: boolean;
  name?: string;
  /** 최근 7일에 나온 것인가. 아니면 역대 기록에서 끌어온 것이다. */
  recent?: boolean;
}

// 배너가 한 장에 머무는 시간. 읽고 그림을 볼 만큼은 되고, 지루하지 않을 만큼 짧게.
// 좁은 화면에서만 쓴다 — 큰 화면은 여러 장을 한꺼번에 편다(아래 설명).
const ROTATE_MS = 4500;

// 홈에 띄우는 "이런 게 나왔습니다" 한 줄.
//
// ⚠️ 왜 최근 것만 안 쓰나: 아직 뽑는 사람이 적어서 최근 것만 띄우면 며칠씩 빈다.
//    서버가 최근 7일에 나온 게 있으면 그걸, 없으면 역대 최고를 준다. 사람이 늘면
//    최근 것이 자연히 앞을 차지한다.
function PullBanner({ onEnter }: { onEnter: () => void }) {
  const [items, setItems] = useState<Highlight[]>([]);
  const [at, setAt] = useState(0);
  // 사람이 손으로 넘기면 자동 넘김을 멈춘다. 읽는 중에 바뀌면 성가시다.
  const [held, setHeld] = useState(false);
  // 시세를 원화로 적는다(사이트 다른 곳과 같은 표기·같은 환율).
  const krw = useKrw();

  useEffect(() => {
    void fetch('/api/local/pack-highlights')
      .then((r) => r.json())
      .then((d: { items?: Highlight[] }) => setItems(d.items ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (held || items.length < 2) return;
    const t = setInterval(() => setAt((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [held, items.length]);

  if (!items.length) return null;
  const shown = at % items.length;
  const packName = (slug: string) => livePacks().find((p) => p.slug === slug)?.label.replace(/^\[.+?\]\s*/, '') ?? '';

  return (
    <div className="mb-2 rounded-xl border border-neutral-200 bg-neutral-50">
      <button
        type="button"
        onClick={() => {
          // 이 줄이 실제로 사람을 상점으로 보내는지 봐야 유지할지 판단할 수 있다.
          trackEvent('packsim_banner');
          onEnter();
        }}
        aria-label="오늘의 상점 열기"
        className="block w-full p-2.5 text-left"
      >
        {/* ⚠️ 다섯 장을 한 칸에 겹쳐 두고 보이는 것만 켠다. 넘어갈 때마다 <img>를 새로
            만들면 그때부터 그림을 받기 시작해서 매번 잠깐 빈칸이 된다(실제로 겪었다).
            겹쳐 두면 처음 한 번만 받고, 넘길 때는 바로 보인다.
            그리드 한 칸에 다 넣으면 제일 큰 것에 맞춰 높이가 잡혀 흔들리지 않는다. */}
        <div className="grid">
          {items.map((h, i) => {
            const jp = h.slug.startsWith('ja-');
            const tier = TIER_KO[h.r ?? '']?.[jp ? 0 : 1] ?? '';
            const pn = packName(h.slug);
            return (
              <div
                key={h.slug + h.n + h.at}
                aria-hidden={i !== shown}
                // ⚠️ 서서히 바꾸지 않는다(transition 금지). 겹쳐 둔 채로 흐려지면 두 카드의
                //    글자가 같은 자리에 겹쳐 보여 지저분하다(2026-08-04에 확인). 그림은
                //    이미 다 받아 뒀으니 바로 바꿔도 깜빡임이 없다.
                // ⚠️ 큰 화면에서 폭을 묶어 가운데로 모은다. 1,118px 띠에 이 내용을 그대로
                //    펴면 어디에 놓든 300~400px짜리 빈칸이 생긴다(실측 2026-08-04).
                //    내용에 맞는 폭으로 모아 두면 좌우 여백이 대칭이라 "덜 채운 것"이
                //    아니라 "여백을 둔 것"으로 보인다.
                className={`col-start-1 row-start-1 flex items-center gap-3 sm:mx-auto sm:w-full sm:max-w-2xl sm:gap-5 ${
                  i === shown ? '' : 'invisible'
                }`}
              >
                {/* ⚠️ cardImg를 꼭 거친다. 카드 주소(TCGdex)는 확장자가 없는 베이스라
                    그대로 쓰면 그림이 안 나온다(2026-08-04에 빈칸으로 뜨는 걸 확인). */}
                {/* ⚠️ 큰 화면에서는 카드를 키운다. 1,118px짜리 띠에 41×56px 카드가
                    놓여 있어 너무 작고 허전했다(사용자 지적 2026-08-04).
                    받는 크기도 같이 올려야 키웠을 때 뿌옇지 않다. */}
                {h.img && (
                  <picture className="shrink-0">
                    <source media="(min-width: 640px)" srcSet={thumb(cardImg(h.img), 240)} />
                    <img
                      src={thumb(cardImg(h.img), 112)}
                      alt=""
                      className="h-14 w-auto rounded object-contain sm:h-24"
                    />
                  </picture>
                )}
                {/* 큰 화면에서는 한 덩어리를 왼쪽에 몰지 않고, 세 토막으로 나눠 줄 전체에
                    고르게 편다(카드 이름 / 누가·어느 팩 / 시세). 폰에서는 자리가 없으니
                    예전처럼 한 덩어리로 쌓는다. */}
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-8">
                  <div className="min-w-0 sm:flex-1">
                    <p className="text-[11px] font-semibold text-neutral-400 sm:text-xs">
                      {h.recent ? '이번 주에 나온 카드' : '지금까지 나온 카드'}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-sm font-bold text-neutral-900 sm:mt-1 sm:text-lg">
                      {h.god ? '갓팩! ' : ''}
                      {h.name || '카드'} {tier}
                    </p>
                    {/* 누가·어느 팩은 폰에서만 여기 붙는다. 큰 화면에서는 가운데 토막으로 뺀다. */}
                    <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500 sm:hidden">
                      {h.nick}님{pn ? ` · ${pn}` : ''}
                    </p>
                  </div>
                  {/* 가운데 토막 — 큰 화면에서 여기가 비어 있었다(사용자 지적 2026-08-04). */}
                  <div className="hidden min-w-0 sm:block sm:flex-1">
                    <p className="text-xs text-neutral-400">뽑은 사람</p>
                    <p className="mt-1 line-clamp-1 text-sm font-semibold text-neutral-700">{h.nick}님</p>
                    {pn && <p className="line-clamp-1 text-xs text-neutral-400">{pn}</p>}
                  </div>
                  {/* 오른쪽 토막. "얼마짜리가 나왔나"가 이 줄에서 제일 궁금한 것이고,
                      상점으로 갈 이유도 된다. 시세를 아직 못 받은 카드면 안 그린다
                      (틀린 것보다 빈칸). */}
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="text-xs text-neutral-400">시세</p>
                    <p className="mt-1 whitespace-nowrap text-lg font-bold tabular-nums text-neutral-900">
                      {h.usd ? krw(h.usd, 'usd') : '—'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </button>
      {/* 몇 장 중 몇 번째인지. 누르면 그 카드로 바로 간다(자동 넘김은 멈춘다). */}
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-2">
          {items.map((h, i) => (
            <button
              key={h.slug + h.n + h.at}
              type="button"
              aria-label={`${i + 1}번째 카드 보기`}
              onClick={() => {
                setAt(i);
                setHeld(true);
              }}
              className={`h-1.5 rounded-full transition-all ${
                i === shown ? 'w-4 bg-neutral-500' : 'w-1.5 bg-neutral-300'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PackShelfPromo({ onEnter }: { onEnter: () => void }) {
  const [art, setArt] = useState<Record<string, { boxImg?: string; logo?: string }>>({});
  const packs = livePacks();

  useEffect(() => {
    void fetch('/sets/index.json')
      .then((r) => r.json())
      .then((list: { slug: string; boxImg?: string; logo?: string }[]) =>
        setArt(Object.fromEntries(list.map((s) => [s.slug, { boxImg: s.boxImg, logo: s.logo }]))),
      )
      .catch(() => undefined);
  }, []);

  return (
    <section className="">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-base font-bold text-neutral-900">오늘의 상점</p>
        <p className="text-xs text-neutral-400">매일 자정에 진열이 바뀝니다</p>
        <button
          type="button"
          onClick={onEnter}
          className="ml-auto rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-white"
        >
          구매하기 →
        </button>
      </div>
      {/* 뽑기 결과 한 줄. 나올 게 없으면 아무것도 안 그린다(빈 자리를 남기지 않는다). */}
      <PullBanner onEnter={onEnter} />
      <button
        type="button"
        onClick={onEnter}
        // 안쪽이 전부 그림·짧은 글자라 화면 읽기 프로그램에는 그냥 "버튼"으로 읽힌다.
        // 무엇을 하는 버튼인지 이름을 붙인다.
        aria-label="오늘의 상점 열기"
        className="group block w-full rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:border-neutral-300 hover:shadow"
      >
        {/* 좁은 화면에서는 6칸을 3열로 쪼개면 그림이 너무 작아진다. 2열로 줄여
            한 칸을 넓게 쓰고 그림 높이도 키운다. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-2 lg:grid-cols-6">
          {packs.map((p) => {
            const img = art[p.slug]?.boxImg || art[p.slug]?.logo;
            return (
              <div key={p.slug} className="px-1 text-center">
                <div className="flex h-36 items-end justify-center rounded-xl bg-gradient-to-b from-neutral-50 to-neutral-100 px-2 pb-2 pt-3 sm:h-32">
                  {img && (
                    <img
                      src={thumb(img, 320)}
                      alt=""
                      loading="lazy"
                      className="max-h-36 object-contain transition group-hover:-translate-y-0.5 sm:max-h-32"
                    />
                  )}
                </div>
                <p className="mt-2 line-clamp-1 text-sm font-semibold text-neutral-700 sm:text-xs">
                  {p.label.replace(/^\[.+?\]\s*/, '')}
                </p>
                <p className="mt-1">
                  <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${p.jp ? 'bg-rose-500' : 'bg-blue-500'}`} />
                  <span className="align-middle text-[11px] font-bold text-neutral-700">{won(p.price)}</span>
                </p>
              </div>
            );
          })}
        </div>
      </button>
    </section>
  );
}
