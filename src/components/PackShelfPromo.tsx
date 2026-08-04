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

// 홈에 띄우는 "이번 주 TOP 5" — 이번 주에 뽑힌 카드 중 시세가 높은 순.
//
// ⚠️ 처음엔 한 장을 4.5초마다 돌렸는데, 큰 화면에서 띠가 텅 비었다. 오른쪽에 시세를
//    붙이고 세 토막으로 펴 봤지만 둘 다 실패했다 — 빈칸은 벌려서 없앨 수 없고
//    채울 것을 넣어야 없어진다(사용자 지적 2026-08-04). 그래서 다섯 장을 한꺼번에
//    편다. 자리가 실제 카드로 차고, "누가 뭘 뽑았나"를 한눈에 훑을 수 있다.
// ⚠️ 이번 주 것이 5개가 안 되면 뒤를 역대 기록으로 채운다(서버가 recent로 알려 준다).
//    아직 뽑는 사람이 적어서, 이번 주 것만 쓰면 자리가 비는 날이 생긴다.
function PullBanner({ onEnter }: { onEnter: () => void }) {
  const [items, setItems] = useState<Highlight[]>([]);
  // 시세를 원화로 적는다(사이트 다른 곳과 같은 표기·같은 환율).
  const krw = useKrw();

  useEffect(() => {
    void fetch('/api/local/pack-highlights')
      .then((r) => r.json())
      .then((d: { items?: Highlight[] }) => setItems(d.items ?? []))
      .catch(() => undefined);
  }, []);

  if (!items.length) return null;
  const packName = (slug: string) => livePacks().find((p) => p.slug === slug)?.label.replace(/^\[.+?\]\s*/, '') ?? '';
  // 다섯 개가 다 이번 주 것일 때만 "이번 주"라고 한다. 아니면 그냥 최고 기록이다.
  const allRecent = items.every((h) => h.recent);

  return (
    <section className="mb-3">
      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-sm font-bold text-neutral-900">{allRecent ? '이번 주 TOP 5' : '최고 뽑기 TOP 5'}</p>
        <p className="text-xs text-neutral-400">시세가 높은 순</p>
      </div>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-5 sm:gap-3">
        {items.map((h, i) => {
          const jp = h.slug.startsWith('ja-');
          const tier = TIER_KO[h.r ?? ''] ?.[jp ? 0 : 1] ?? '';
          const pn = packName(h.slug);
          return (
            <button
              key={h.slug + h.n + h.at}
              type="button"
              onClick={() => {
                // 이 줄이 실제로 사람을 상점으로 보내는지 봐야 유지할지 판단할 수 있다.
                trackEvent('packsim_banner');
                onEnter();
              }}
              aria-label={`${h.name || '카드'} — 오늘의 상점 열기`}
              // 폰에서는 한 줄씩 눕히고(그림 왼쪽·글 오른쪽), 큰 화면에서는 세워서
              // 다섯 칸으로 편다. 어느 쪽이든 빈 자리가 안 생긴다.
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2 text-left transition hover:border-neutral-300 sm:flex-col sm:items-stretch sm:gap-2"
            >
              <div className="relative shrink-0 sm:self-center">
                {/* ⚠️ cardImg를 꼭 거친다. 카드 주소(TCGdex)는 확장자가 없는 베이스라
                    그대로 쓰면 그림이 안 나온다(2026-08-04에 빈칸으로 뜨는 걸 확인). */}
                {h.img && (
                  <picture>
                    <source media="(min-width: 640px)" srcSet={thumb(cardImg(h.img), 240)} />
                    <img src={thumb(cardImg(h.img), 112)} alt="" className="h-14 w-auto rounded object-contain sm:h-36" />
                  </picture>
                )}
                <span className="absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-neutral-900 text-[10px] font-black text-white">
                  {i + 1}
                </span>
              </div>
              <div className="min-w-0 flex-1 sm:flex-none">
                <p className="line-clamp-1 text-sm font-bold text-neutral-900">
                  {h.god ? '갓팩! ' : ''}
                  {h.name || '카드'} {tier}
                </p>
                <p className="line-clamp-1 text-xs text-neutral-500">
                  {h.nick}님{pn ? ` · ${pn}` : ''}
                </p>
              </div>
              <p className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900 sm:text-left">
                {h.usd ? krw(h.usd, 'usd') : ''}
              </p>
            </button>
          );
        })}
      </div>
    </section>
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
      {/* 이번 주 TOP 5. 나올 게 없으면 아무것도 안 그린다(빈 자리를 남기지 않는다). */}
      <PullBanner onEnter={onEnter} />
      {/* 진열은 그 아래. TOP 5가 "이런 게 나온다"를 보여주고, 이 줄이 "사는 곳"이다. */}
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
