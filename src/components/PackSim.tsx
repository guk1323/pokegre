import { useEffect, useState } from 'react';
import { trackEvent } from '../api/localStats';
import { koreanizeEnglishCardName } from '../lib/koreanizeEnglishTitle';
import { koreanizeTitle } from '../lib/koreanizeTitle';

// 운영자 전용 카드 뽑기 시뮬레이션(실험). 세트 카드를 레어도별로 나눠, 세트마다 다른
// "봉입 확률 프로필"로 한 팩을 뽑는다. 확률은 커뮤니티 실측 집계(공식 발표는 없음)라
// 재미용 근사치다. 레어도(r)가 채워진 세트만 대상으로 한다.
//
// 슬롯 = 팩 안의 "한 자리". rolls=[등급, 팩당확률]을 순서대로 판정하고 다 빗나가면
// fb 풀(cu=커먼·언커먼 / rare=일반 레어)에서 뽑는다.
type Slot = { rolls: [string, number][]; fb: 'cu' | 'rare' };
type RateProfile = { commons: number; uncommons: number; slots: Slot[] };

// 북미판 일반 부스터(10장) — 최신 SV 세트 실측(pullrates.com, TCGplayer 8,000팩+):
// DR 1/6 · UR 1/15 · AR 1/13 · ACE 1/20 · SAR ~1/88 · HR ~1/180. 세트 불문 거의 동일.
const NA_REGULAR: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Hyper rare', 0.0055], ['Special illustration rare', 0.0114], ['Illustration rare', 0.0769]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.0667], ['Double rare', 0.1667], ['ACE SPEC Rare', 0.05]], fb: 'rare' },
  ],
};
// 북미판 특별세트(프리즈매틱·151 등, 10장) — SAR가 일반의 2배가량 후함(1/45).
const NA_SPECIAL: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Hyper rare', 0.011], ['Special illustration rare', 0.0222], ['Illustration rare', 0.1]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.08], ['Double rare', 0.1667], ['ACE SPEC Rare', 0.05]], fb: 'rare' },
  ],
};
// 일본판 일반 부스터(5장) — 박스(30팩) 보장 구조를 팩당으로 환산(Samurai Sword·일본 개봉 집계):
// AR 3/박스=10% · RR ~4/박스=13% · SR ~1/박스=2.8% · SAR ~1/6박스=0.56% · UR(HR) ~1/12박스=0.28%.
// (SR=풀아트 = 우리 'Ultra Rare'. limitless 실측 등급을 반영해 SR 슬롯이 새로 생김)
const JP_REGULAR: RateProfile = {
  commons: 3,
  uncommons: 1,
  slots: [
    {
      rolls: [
        ['Hyper rare', 0.0028],
        ['Special illustration rare', 0.0056],
        ['Ultra Rare', 0.0277],
        ['Illustration rare', 0.1],
        ['Double rare', 0.13],
      ],
      fb: 'rare',
    },
  ],
};

// jp=true면 일본판(카드명 일본어·5장) · false면 북미판. profile은 세트별 봉입 확률.
const SETS: { slug: string; label: string; src: string; jp: boolean; profile: RateProfile }[] = [
  { slug: 'ja-SV8', label: '[일본판] 초전브레이커', src: '/packsim/ja-SV8.json', jp: true, profile: JP_REGULAR },
  { slug: 'ja-SV3', label: '[일본판] 흑염의 지배자', src: '/packsim/ja-SV3.json', jp: true, profile: JP_REGULAR },
  { slug: 'ja-SV2a', label: '[일본판] 포켓몬 카드 151', src: '/packsim/ja-SV2a.json', jp: true, profile: JP_REGULAR },
  { slug: 'en-sv08', label: '[북미판] Surging Sparks', src: '/sets/en-sv08.json', jp: false, profile: NA_REGULAR },
  { slug: 'en-sv08.5', label: '[북미판] Prismatic Evolutions', src: '/sets/en-sv08.5.json', jp: false, profile: NA_SPECIAL },
  { slug: 'en-sv03.5', label: '[북미판] 151', src: '/sets/en-sv03.5.json', jp: false, profile: NA_SPECIAL },
  { slug: 'en-sv03', label: '[북미판] Obsidian Flames', src: '/sets/en-sv03.json', jp: false, profile: NA_REGULAR },
];

type Card = { n: string; name: string; img?: string; r?: string };

// TCGdex 레어도 → 화면 표기(한글·약칭)와 등급 순위·색. 순위가 높을수록 귀한 카드.
const RARITY: Record<string, { ko: string; rank: number; cls: string }> = {
  Common: { ko: '커먼', rank: 0, cls: 'text-neutral-400 ring-neutral-200' },
  Uncommon: { ko: '언커먼', rank: 1, cls: 'text-neutral-500 ring-neutral-300' },
  Rare: { ko: '레어', rank: 2, cls: 'text-sky-600 ring-sky-300' },
  'Double rare': { ko: '더블레어 RR', rank: 3, cls: 'text-indigo-600 ring-indigo-300' },
  'ACE SPEC Rare': { ko: 'ACE', rank: 4, cls: 'text-rose-600 ring-rose-300' },
  'Illustration rare': { ko: '일러레어 AR', rank: 5, cls: 'text-amber-600 ring-amber-300' },
  'Ultra Rare': { ko: '울트라레어 UR', rank: 6, cls: 'text-fuchsia-600 ring-fuchsia-300' },
  'Special illustration rare': { ko: '스페셜 AR (SAR)', rank: 7, cls: 'text-amber-500 ring-amber-400' },
  'Hyper rare': { ko: '하이퍼레어 HR', rank: 8, cls: 'text-yellow-500 ring-yellow-400' },
};
const rankOf = (r?: string) => RARITY[r ?? '']?.rank ?? 0;

// TCGdex는 베이스 주소(확장자 없음)라 /high.webp를 붙여야 이미지가 나온다. 일본판 limitless는
// 이미 .png로 끝나므로 그대로 둔다. (SetsView의 cardImg와 동일한 규칙)
const cardImg = (base: string) =>
  !base ? '' : /\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base}/high.webp`;
const thumb = (url: string, w: number) => {
  const src = cardImg(url);
  return src ? `/api/img?u=${encodeURIComponent(src)}&w=${w}` : '';
};
const randOf = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

function groupByRarity(cards: Card[]) {
  const pools: Record<string, Card[]> = {};
  for (const c of cards) (pools[c.r ?? 'Common'] ??= []).push(c);
  return pools;
}

// 슬롯 하나를 실측 확률로 굴린다. rolls=[등급, 팩당확률]을 순서대로 판정하고, 다 빗나가면
// (=대부분의 경우) fallback 풀(일반 카드)에서 뽑는다. 그 등급 카드가 세트에 없으면 fallback.
function rollSlot(rolls: [string, number][], pools: Record<string, Card[]>, fallback: Card[]): Card {
  let x = Math.random();
  for (const [tier, p] of rolls) {
    if (x < p) return pools[tier]?.length ? randOf(pools[tier]) : randOf(fallback);
    x -= p;
  }
  return randOf(fallback.length ? fallback : cardsFlat(pools));
}
const cardsFlat = (pools: Record<string, Card[]>) => Object.values(pools).flat();

// 풀에서 서로 다른 카드 n장을 뽑는다(실제 팩처럼 한 팩에 같은 커먼이 겹치지 않게).
// 풀이 n보다 작으면 있는 만큼만.
function drawDistinct(pool: Card[], n: number): Card[] {
  if (pool.length <= n) return [...pool];
  const picked = new Set<number>();
  while (picked.size < n) picked.add(Math.floor(Math.random() * pool.length));
  return [...picked].map((i) => pool[i]);
}

// 세트 프로필대로 한 팩을 뽑는다. 커먼·언커먼을 채운 뒤 슬롯별로 실측확률을 굴린다.
function openPack(cards: Card[], profile: RateProfile): Card[] {
  const pools = groupByRarity(cards);
  const commons = pools['Common'] ?? cards;
  const uncommons = pools['Uncommon'] ?? commons;
  const cu = [...commons, ...uncommons];
  const out: Card[] = [...drawDistinct(commons, profile.commons), ...drawDistinct(uncommons, profile.uncommons)];
  for (const slot of profile.slots) {
    const fb = slot.fb === 'rare' ? pools['Rare'] ?? uncommons : cu;
    out.push(rollSlot(slot.rolls, pools, fb));
  }
  return out;
}

export function PackSim() {
  const [slug, setSlug] = useState(SETS[0].slug);
  const cfg = SETS.find((s) => s.slug === slug) ?? SETS[0];
  const [cards, setCards] = useState<Card[] | null>(null);
  const [pack, setPack] = useState<Card[] | null>(null);
  const [revealed, setRevealed] = useState(0); // 지금까지 뒤집은 카드 수(한 장씩 공개)
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCards(null);
    setErr('');
    setPack(null);
    const src = SETS.find((s) => s.slug === slug)?.src ?? `/sets/${slug}.json`;
    fetch(src)
      .then((r) => r.json())
      .then((d: { cards: Card[] }) => setCards(d.cards.filter((c) => c.r)))
      .catch(() => setErr('세트를 불러오지 못했어요.'));
  }, [slug]);

  function open() {
    if (!cards || cards.length === 0) return;
    // 어느 세트를 얼마나 뽑아보는지 집계한다(운영자 사용은 서버가 제외).
    trackEvent('packsim', cfg.label);
    setOpening(true);
    setPack(null);
    setRevealed(0);
    // 연출: 잠깐 뒤에 결과를 넣는다. 등급 낮은 카드가 앞, 제일 좋은 카드가 맨 뒤로 오게
    // 정렬해 "마지막 한 장"에서 터지는 쫄깃함을 만든다.
    setTimeout(() => {
      const drawn = openPack(cards, cfg.profile).sort((a, b) => rankOf(a.r) - rankOf(b.r));
      setPack(drawn);
      setOpening(false);
    }, 350);
  }

  const revealNext = () => setRevealed((n) => (pack ? Math.min(n + 1, pack.length) : n));
  const revealAll = () => pack && setRevealed(pack.length);
  const allDone = !!pack && revealed >= pack.length;
  const best = pack ? pack.reduce((a, b) => (rankOf(b.r) > rankOf(a.r) ? b : a)) : null;
  // 일본판 카드명은 일본어라 일본어 변환기를, 북미판은 영어 변환기를 태운다. 시크릿은 이름이 비어 있을 수 있다.
  const koName = (name: string) =>
    !name ? '' : cfg.jp ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name);

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-base font-bold text-black">
        카드 뽑기 <span className="align-middle text-[11px] font-semibold text-amber-600">운영자 · 실험</span>
      </h2>
      <p className="mt-1 text-xs text-neutral-400">
        {cfg.jp
          ? '일본판: 봉입 구조 기반으로 한 팩(5장)을 뽑아요.'
          : '북미판: 레어도 가중 랜덤으로 한 팩(10장)을 뽑아요.'}{' '}
        팩을 열고 카드를 한 장씩 넘겨보세요(제일 좋은 카드가 맨 뒤). 재미용 근사치라 실제 봉입률과는 다릅니다.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        >
          {SETS.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={open}
          disabled={!cards || opening}
          className="rounded-lg bg-black px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          {opening ? '여는 중…' : '📦 팩 열기'}
        </button>
        {cards && <span className="text-xs text-neutral-400">{cards.length}종 수록</span>}
      </div>

      {err && <p className="mt-3 text-sm text-rose-500">{err}</p>}

      {/* 진행 컨트롤: 한 장씩 넘기기 (다 넘기면 최고 등급 공개) */}
      {pack && !allDone && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={revealNext}
            className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-white shadow-sm"
          >
            카드 넘기기 <span className="opacity-80">({revealed}/{pack.length})</span>
          </button>
          <button type="button" onClick={revealAll} className="text-xs text-neutral-400 underline">
            전체 한번에 공개
          </button>
        </div>
      )}

      {allDone && best && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
          이번 팩 최고 등급:{' '}
          <b className={RARITY[best.r ?? '']?.cls.split(' ')[0]}>{RARITY[best.r ?? '']?.ko ?? best.r}</b>
          {' · '}
          {koName(best.name)}
        </div>
      )}

      {pack && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {pack.map((c, i) => {
            const meta = RARITY[c.r ?? ''] ?? RARITY.Common;
            const flipped = i < revealed;
            const isNext = i === revealed && !allDone;
            const hit = flipped && rankOf(c.r) >= 5; // AR 이상이면 공개 시 반짝
            return (
              <div key={i}>
                <div
                  className={`flip ${isNext ? 'flip-next' : ''}`}
                  onClick={isNext ? revealNext : undefined}
                  role={isNext ? 'button' : undefined}
                  aria-label={isNext ? '카드 뒤집기' : undefined}
                >
                  <div className="flip-inner" data-flipped={flipped}>
                    <div className="flip-face flip-back">
                      <img src="/card-back.svg" alt="" className="h-full w-full rounded-lg object-cover" />
                    </div>
                    <div className={`flip-face flip-front ${hit ? 'card-hit' : ''}`}>
                      <div className={`h-full overflow-hidden rounded-lg bg-neutral-100 ring-1 ${meta.cls}`}>
                        {c.img && (
                          <img
                            src={thumb(c.img, 240)}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-contain"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-700">
                  {flipped ? koName(c.name) : ' '}
                </p>
                <p className={`text-[10px] font-bold ${meta.cls.split(' ')[0]}`}>
                  {flipped ? meta.ko : ' '}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .flip { position: relative; aspect-ratio: 5 / 7; border-radius: 0.6rem; perspective: 900px; }
        .flip-next { cursor: pointer; animation: nextPulse 1.2s ease-in-out infinite; }
        .flip-inner {
          position: absolute; inset: 0; transform-style: preserve-3d;
          transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.2, 1);
        }
        .flip-inner[data-flipped="true"] { transform: rotateY(180deg); }
        .flip-face {
          position: absolute; inset: 0; border-radius: 0.5rem;
          backface-visibility: hidden; -webkit-backface-visibility: hidden;
        }
        .flip-front { transform: rotateY(180deg); }
        .card-hit { box-shadow: 0 0 14px 2px rgba(245, 158, 11, 0.65); border-radius: 0.5rem; }
        @keyframes nextPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55); }
          70% { box-shadow: 0 0 0 7px rgba(245, 158, 11, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .flip-inner { transition: none; }
          .flip-next { animation: none; }
        }
      `}</style>
    </div>
  );
}
