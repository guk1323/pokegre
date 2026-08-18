import { useEffect, useState } from 'react';
import { livePacks, packBySlug } from '../lib/packSets';
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
// ⚠️ TOP 5에는 등급이 낮아도 **값이 $30을 넘으면** 오른다(서버의 HIGHLIGHT_USD).
//    그래서 등급이 높은 것만 적어 두면 나머지는 등급 칸이 빈 채로 나간다.
//    실제로 ACE SPEC·레어·언커먼·커먼이 빠져 있었다(2026-08-06). 순위표(RARITY_RANK)에
//    있는 등급은 여기 다 있어야 한다 — 하나라도 빠지면 조용히 빈칸이 된다.
const TIER_KO: Record<string, [string, string]> = {
  // [일본판, 영문판]
  'Mega Ultra Rare': ['MUR', 'MUR'],
  'Mega Hyper Rare': ['MHR', 'MHR'],
  'Hyper rare': ['UR', 'HR'],
  'Special illustration rare': ['SAR', 'SIR'],
  'Ultra Rare': ['SR', 'UR'],
  'Illustration rare': ['AR', 'IR'],
  'ACE SPEC Rare': ['ACE', 'ACE'],
  'Double rare': ['RR', 'RR'],
  Rare: ['레어', '레어'],
  Uncommon: ['언커먼', '언커먼'],
  Common: ['커먼', '커먼'],
};

// 1·2·3등 메달 색. 숫자만으로는 눈에 안 들어온다(사용자 지적 2026-08-04).
// 이모지는 안 쓴다(사이트 지침) — 배경색으로만 구분한다.
//
// ⚠️⚠️ **은메달만 `neutral`을 쓰면 다크모드에서 죽는다**(사장님 지적 2026-08-16:
//    "2등이 은메달인데 4,5등이랑 차이가 없는거같아"). 이 리포는 다크모드를 **색 변수만
//    뒤집어** 만드는데, `neutral`은 그 뒤집히는 무리라 `neutral-300`이 어두운 회색이 된다.
//    실측(다크모드): 은 RGB(58,58,58) ↔ 4·5등 RGB(44,44,44) — **색 차이 24**로 눈에
//    구분이 안 갔다. 금(255,185,0)과 은의 차이가 241인 것과 견주면 사실상 같은 색이다.
//    금·동이 멀쩡했던 건 `amber`·`orange`가 **안 뒤집히는 무리**라서다.
//    → 은도 **고정 은색**을 박아 넣는다. 메달은 「금·은·동」이라는 뜻이 곧 색이라,
//      화면 밝기에 따라 변하면 안 된다(마켓 색을 안 뒤집는 것과 같은 판단).
// ⚠️ Tailwind v4는 안 쓴 색을 아예 안 내보낸다 — `slate`·`zinc`·`gray`는 이 빌드에
//    없어서(실측 0,0,0) 쓸 수 없다. 그래서 대괄호로 값을 직접 적는다.
const MEDAL = [
  'bg-amber-400 text-amber-900', // 금
  'bg-[#C3CAD2] text-[#39414A]', // 은 — 고정값(다크모드에서도 그대로)
  'bg-orange-300 text-orange-900', // 동
];

// ⚠️ 4·5등은 **메달이 아니다.** 예전엔 `bg-neutral-200`으로 은메달과 한 단계 차이라
//    같은 것으로 보였다. 바탕을 화면색(`bg-white`)에 맞춰 **안 채운 것처럼** 보이게 하고
//    테두리로만 동그라미를 그린다 — 「메달권 셋」과 「나머지」가 한눈에 갈린다.
//    ⚠️ 투명으로 두면 안 된다. 이 표는 카드 그림 위에 얹히므로 숫자가 안 읽힌다.
const NO_MEDAL = 'bg-white text-neutral-500 ring-1 ring-neutral-300';

interface Highlight {
  /** 뽑은 시각. 화면에 "오늘"·"어제"·"8.3"처럼 날짜를 적는 데 쓴다. */
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

// 홈에 띄우는 "이번 주 TOP 5" — 이번 주에 뽑힌 카드 중 시세가 높은 순.
//
// ⚠️ 처음엔 한 장을 4.5초마다 돌렸는데, 큰 화면에서 띠가 텅 비었다. 오른쪽에 시세를
//    붙이고 세 토막으로 펴 봤지만 둘 다 실패했다 — 빈칸은 벌려서 없앨 수 없고
//    채울 것을 넣어야 없어진다(사용자 지적 2026-08-04). 그래서 다섯 장을 한꺼번에
//    편다. 자리가 실제 카드로 차고, "누가 뭘 뽑았나"를 한눈에 훑을 수 있다.
// ⚠️ 이번 주 것만 쓴다. 다섯 개가 안 되면 안 되는 대로 비운다(2026-08-05 운영자 지시).
//    예전엔 자리가 남으면 지난 기록으로 채웠는데, "이번 주 TOP 5"라면서 20일 전 기록이
//    섞였다. 없는 걸 채워 넣느니 칸이 적은 게 낫다.
// 뽑은 날짜. 오늘·어제는 글자로, 그 앞은 "8.3"처럼 적는다.
// 이번 주(7일) 안의 것만 오므로 연도는 안 붙인다.
// (날짜로 통일하는 안도 봤지만 지금 꼴로 두기로 했다 — 2026-08-05 운영자 판단.)
function pulledOn(at: number): string {
  const d = new Date(at);
  const day = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const 지난날 = Math.round((day(new Date()) - day(d)) / 86400000);
  if (지난날 <= 0) return '오늘';
  if (지난날 === 1) return '어제';
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

/**
 * 「이번 주 TOP 5」 — 이번 주에 뽑힌 카드 중 시세가 높은 순.
 *
 * ⚠️ 홈에서도 쓰라고 **밖으로 내보낸다**(사장님 지시 2026-08-12). 오늘의 상점을 홈에서
 *    「도구 ▾」로 옮기면서 이 칸까지 같이 사라졌는데, 이건 남기라고 하셨다 —
 *    "다른 사람이 뭘 뽑았나"는 뽑기를 안 하는 사람도 재미있어 하는 자리다.
 */
export function PullBanner({ onEnter }: { onEnter: () => void }) {
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
  // ⚠️ 팩 이름은 **전체 목록(packBySlug)**에서 찾아야 한다. livePacks()는 오늘 진열된
  //    6개뿐이라, 자정에 진열이 바뀌면 어제 뽑은 카드의 팩 이름이 빈칸이 됐다.
  //    TOP 5는 "이번 주" 기록이라 대부분 오늘 진열에 없는 팩이다 — 실제로 5개 중 4개가
  //    빈칸이었다(운영자 지적 2026-08-06). 뽑기 화면은 원래부터 packBySlug를 쓴다.
  const packName = (slug: string) => packBySlug.get(slug)?.label.replace(/^\[.+?\]\s*/, '') ?? '';

  return (
    <section className="mt-3">
      {/* ⚠️⚠️ **홈 구역 제목은 셋이 똑같아야 한다**(사장님 지시 2026-08-12 "굵기랑 크기 다 다르잖아").
          인기 검색어 · 이번 주 TOP 5 · 힛카드 목록 — 셋 다 text-lg + font-extrabold + 검정.
          예전엔 "시세 쪽은 크게, 곁다리는 작게"로 두 단을 뒀는데(2026-08-08), 오늘의 상점을
          「도구 ▾」로 옮기면서 TOP 5가 홈의 주요 구역이 됐다. 크기가 갈리면 어긋나 보인다. */}
      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-lg font-extrabold tracking-tight text-black">이번 주 TOP 5</p>
        <p className="text-[11px] text-neutral-400">시세가 높은 순</p>
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
              // ⚠️ **다섯 줄을 다 보여준다.** 한때 핸드폰에서 3줄만 보이게 했다가 되돌렸다 —
              //    이름이 "TOP 5"인데 세 개만 나오면 말이 안 된다(2026-08-08 지적).
              //    대신 **줄 높이를 낮춰서** 다섯을 넣는다(아래 세트 이름 줄 참고).
              className="flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-neutral-50 p-1.5 text-left sm:p-2 transition hover:border-neutral-300 sm:flex-col sm:items-stretch sm:gap-2"
            >
              {/* 메달은 카드 왼쪽 위 모서리에 살짝 걸치게 둔다(사용자 지시 2026-08-04 —
                  글자 쪽으로 뺐다가 되돌렸다). 모서리라 그림을 거의 안 가린다. */}
              <div className="relative shrink-0 sm:self-center">
                {/* ⚠️ cardImg를 꼭 거친다. 카드 주소(TCGdex)는 확장자가 없는 베이스라
                    그대로 쓰면 그림이 안 나온다(2026-08-04에 빈칸으로 뜨는 걸 확인). */}
                {h.img && (
                  <picture>
                    {/* ⚠️ 큰 화면 그림을 144px에서 96px로 줄였다 — 진열 위에 있을 때 크기가
                        부담스러웠다(사용자 지적 2026-08-04). 받는 크기도 같이 내린다. */}
                    <source media="(min-width: 640px)" srcSet={thumb(cardImg(h.img), 160)} />
                    <img src={thumb(cardImg(h.img), 112)} alt="" className="h-12 w-auto rounded object-contain sm:h-24" />
                  </picture>
                )}
                {/* 1·2·3등은 금·은·동으로 나눈다. 숫자만으로는 눈에 안 들어온다.
                    이모지는 안 쓴다(사이트 지침) — 배경색으로만 구분한다. */}
                <span
                  className={`absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full text-[10px] font-black shadow-sm ${MEDAL[i] ?? NO_MEDAL}`}
                >
                  {i + 1}
                </span>
              </div>
              <div className="min-w-0 flex-1 sm:flex-none">
                <p className="line-clamp-1 text-sm font-bold text-neutral-900">
                  {h.god ? '갓팩! ' : ''}
                  {h.name || '카드'} {tier}
                </p>
                {/* ⚠️ 세트 이름이 잘렸다(사용자 지적 2026-08-04). 큰 화면에서 한 칸이
                    214px인데 "트와일라잇 마스커레이드"만 그 폭을 넘는다. 닉네임과 한 줄에
                    붙이지 말고 줄을 나눠 각자 한 줄씩 쓰게 한다. */}
                <p className="line-clamp-1 text-xs text-neutral-500">
                  {h.nick}님
                  {/* 언제 뽑은 것인지. 이번 주 안에서도 오늘 것과 엿새 전 것은 다르다. */}
                  {h.at ? <span className="ml-1 text-neutral-400">{pulledOn(h.at)}</span> : null}
                </p>
                {/* ⚠️ 핸드폰에서는 이 줄을 접는다. 한 줄에 세 줄씩 쌓으면 다섯 줄이
                    412px을 먹었다. 팩 이름은 넓은 화면에서만 보인다 — 좁은 화면에서
                    꼭 필요한 것은 카드 이름·뽑은 사람·값이다. */}
                {pn && <p className="hidden line-clamp-1 text-[11px] text-neutral-400 sm:block">{pn}</p>}
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
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-neutral-500">오늘의 상점</p>
        <button
          type="button"
          onClick={onEnter}
          className="ml-auto rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-white"
        >
          상점 열기 →
        </button>
      </div>
      {/* ⚠️ 상점 화면과 문구를 맞춘다. 한쪽만 고치고 홈을 빼먹은 적이 있다
          (사용자 지적 2026-08-04). */}
      <p className="mb-2 text-xs text-neutral-400">상품은 매일 자정에 새롭게 갱신됩니다.</p>
      <button
        type="button"
        onClick={onEnter}
        // 안쪽이 전부 그림·짧은 글자라 화면 읽기 프로그램에는 그냥 "버튼"으로 읽힌다.
        // 무엇을 하는 버튼인지 이름을 붙인다.
        aria-label="오늘의 상점 열기"
        className="group block w-full rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:border-neutral-300 hover:shadow"
      >
        {/* ⚠️ **핸드폰은 가로로 밀어 보고, 넓은 화면은 그대로 편다.**
            핸드폰은 세로로 쌓이니 같은 내용이 PC의 두 배로 길어진다 —
            홈 2,026px 중 상점이 548px(27%)이었고, 뽑기 전체로는 47%였다.
            PC는 한 줄에 6칸이 들어가 저절로 34%다(2026-08-08 실측. 서로 다른 문제다).
            가로 밀기로 바꾸면 여섯 팩을 다 볼 수 있으면서 세로만 줄어든다.
            ⚠️ 밀 수 있다는 걸 알려야 한다 — 오른쪽 끝을 일부러 조금 걸치게 둔다
               (마지막 칸이 화면 밖으로 살짝 나가도록 폭을 잡았다). */}
        <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
          {packs.map((p) => {
            const img = art[p.slug]?.boxImg || art[p.slug]?.logo;
            return (
              <div key={p.slug} className="w-[28%] shrink-0 snap-start px-1 text-center sm:w-auto">
                {/* ⚠️ 칸 높이를 **핸드폰에서 낮춘다.** 가로로 밀게 바꾸면서 한 칸이 좁아져
                    그림이 작아졌는데, 높이는 144px 그대로라 **그림 위가 휑하게 비었다**
                    (2026-08-08 지적). 그림 크기에 맞춰 96px로 낮춘다.
                    넓은 화면은 한 칸이 넓어 그림도 크므로 그대로 둔다. */}
                <div className="flex h-24 items-end justify-center rounded-xl bg-gradient-to-b from-neutral-50 to-neutral-100 px-2 pb-2 pt-2 sm:h-32 sm:pt-3">
                  {img && (
                    <img
                      src={thumb(img, 320)}
                      alt=""
                      loading="lazy"
                      className="max-h-20 object-contain transition group-hover:-translate-y-0.5 sm:max-h-32"
                    />
                  )}
                </div>
                {/* ⚠️ **두 줄까지 보여 준다.** 3열로 줄이면서 한 줄로 자르니 "프리즈매틱…",
                    "옵시디언…"처럼 무슨 팩인지 알 수 없게 됐다(2026-08-08). 자리를 아끼려고
                    이름을 못 읽게 만들면 아낀 뜻이 없다. 두 줄 높이를 미리 잡아 두어
                    이름 길이가 달라도 아래 GP 줄이 들쭉날쭉하지 않게 한다. */}
                <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-[13px] font-semibold leading-tight text-neutral-700 sm:min-h-0 sm:text-xs">
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
      {/* ⚠️ TOP 5는 진열 아래에 둔다(사용자 지시 2026-08-04). 위에 뒀더니 "이런 게
          나온다"가 "여기서 산다"보다 먼저 와서 순서가 뒤집혔고, 크기도 부담스러웠다.
          진열을 보고 나서 "다른 사람은 뭘 뽑았나"를 보는 순서가 맞다.
          나올 게 없으면 아무것도 안 그린다(빈 자리를 남기지 않는다). */}
      <PullBanner onEnter={onEnter} />
    </section>
  );
}
