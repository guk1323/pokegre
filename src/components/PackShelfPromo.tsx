import { useEffect, useState } from 'react';
import { livePacks } from '../lib/packSets';
import { trackEvent } from '../api/localStats';
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
}

// 홈에 띄우는 "이런 게 나왔습니다" 한 줄.
//
// ⚠️ 왜 최근 것만 안 쓰나: 아직 뽑는 사람이 적어서 최근 것만 띄우면 며칠씩 빈다.
//    서버가 최근 7일에 나온 게 있으면 그걸, 없으면 역대 최고를 준다. 사람이 늘면
//    최근 것이 자연히 앞을 차지한다.
function PullBanner({ onEnter }: { onEnter: () => void }) {
  const [hit, setHit] = useState<{ item: Highlight | null; recent: boolean } | null>(null);

  useEffect(() => {
    void fetch('/api/local/pack-highlights')
      .then((r) => r.json())
      .then((d: { item: Highlight | null; recent: boolean }) => setHit(d))
      .catch(() => undefined);
  }, []);

  const item = hit?.item;
  if (!item) return null;
  const jp = item.slug.startsWith('ja-');
  const tier = TIER_KO[item.r ?? '']?.[jp ? 0 : 1] ?? '';
  const packName = livePacks().find((p) => p.slug === item.slug)?.label.replace(/^\[.+?\]\s*/, '') ?? '';

  return (
    <button
      type="button"
      onClick={() => {
        // 이 줄이 실제로 사람을 상점으로 보내는지 봐야 유지할지 판단할 수 있다.
        trackEvent('packsim_banner');
        onEnter();
      }}
      aria-label="오늘의 상점 열기"
      className="mb-2 flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 text-left transition hover:border-neutral-300"
    >
      {/* ⚠️ cardImg를 꼭 거친다. 카드 주소(TCGdex)는 확장자가 없는 베이스라 그대로
          쓰면 그림이 안 나온다 — 실제로 빈칸으로 뜨는 걸 확인했다(2026-08-04). */}
      {item.img && (
        <img src={thumb(cardImg(item.img), 112)} alt="" loading="lazy" className="h-14 w-auto shrink-0 rounded object-contain" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-neutral-400">
          {hit?.recent ? '이번 주에 나온 카드' : '지금까지 나온 최고 카드'}
        </p>
        <p className="mt-0.5 line-clamp-1 text-sm font-bold text-neutral-900">
          {item.god ? '갓팩! ' : ''}
          {item.name || '카드'} {tier}
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500">
          {item.nick}님{packName ? ` · ${packName}` : ''}
        </p>
      </div>
    </button>
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
