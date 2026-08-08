import { 앨범값 } from '../lib/cardNo.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { koName as koCardName } from '../lib/koCardName.ts';
import { trackEvent } from '../api/localStats';
import { fetchExchangeRates, formatKrwApprox, type ExchangeRates } from '../api/exchangeRate';
import { rankOf, type MirrorFlag, type PackCard } from '../lib/packDraw';

// 화면에서 다루는 카드: 서버 응답 순서(i)를 기억한다 — 앨범 골라담기가 인덱스 기준이라
// (미러와 일반판이 같은 번호일 수 있어 번호로는 구분이 안 된다).
type UiCard = PackCard & { i: number; usd?: number };
const M_LABEL: Record<MirrorFlag, { t: string; cls: string }> = {
  master: { t: '마스터볼 미러', cls: 'text-amber-600 font-bold' },
  poke: { t: '몬스터볼 미러', cls: 'text-neutral-500' },
  rev: { t: '리버스', cls: 'text-neutral-500' },
};
import {
  DAILY_BUDGET,
  JP_151,
  JP_MEGA,
  livePacks,
  MAX_BOX_STASH,
  MAX_STASH,
  NA_151,
  NA_MEGA,
  NA_PRISMATIC,
  MAX_BALANCE,
  STREAK_BONUS,
  STREAK_DAYS,
  packBySlug,
  SHARE_BONUS,
  type PackSet,
} from '../lib/packSets';
import { kstDateStr } from '../lib/kstDay';

// 카드 개봉. 출석으로 받은 GP(그레포인트)로 팩·박스를 사서 열고, 나온 카드를
// 앨범에 모은다. 개봉·GP 계산은 전부 서버가 한다(화면에서 하면 얼마든지 조작 가능).
// 확률은 커뮤니티 실측 집계(공식 발표는 없음)라 재미용 근사치다.

type AlbumCard = { s: string; n: string; r: string; c: number; g?: 1; m?: MirrorFlag };
type ShareState = { shared: boolean; msg: string };
type SimState = {
  balance: number;
  lastCheckIn: string;
  streak: number;
  opened: number;
  spent: number;
  god: number;
  album: AlbumCard[];
  today: string;
  canCheckIn: boolean;
  gained?: number; // 실제로 늘어난 GP(잔액 상한에 걸리면 reward보다 적다)
  reward?: number; // 원래 주기로 한 금액
  capped?: boolean; // 상한에 걸려 일부만 들어갔는지
  admin?: boolean; // 무제한 스위치는 운영자에게만 보인다
  canShareBonus?: boolean; // 오늘 첫 자랑 보상(+5,000GP)이 남아 있는지
  packs?: Record<string, number>; // 사서 아직 안 연 팩(보관함)
  boxes?: Record<string, number>; // 사서 아직 안 연 박스(보관함)
  // 마지막으로 연 결과. kept=false면 아직 "앨범에 넣기/넘기기"를 안 고른 것이라
  // 화면을 다시 열 때 그대로 되살린다.
  // 서버는 되살릴 때도 값(usd)을 실어 준다 — 여기 안 적어 두면 받고도 못 쓴다.
  last?: {
    slug: string;
    cards: { n: string; r?: string; m?: MirrorFlag; usd?: number }[];
    god: boolean;
    shared?: boolean;
    kept?: boolean;
  };
};

// 등급 표기(한글·약칭)와 색.
const RARITY: Record<string, { ko: string; cls: string }> = {
  Common: { ko: '커먼', cls: 'text-neutral-400 ring-neutral-200' },
  Uncommon: { ko: '언커먼', cls: 'text-neutral-500 ring-neutral-300' },
  Rare: { ko: '레어', cls: 'text-sky-600 ring-sky-300' },
  'Double rare': { ko: '더블레어 RR', cls: 'text-indigo-600 ring-indigo-300' },
  'ACE SPEC Rare': { ko: 'ACE', cls: 'text-rose-600 ring-rose-300' },
  'Illustration rare': { ko: '아트레어 AR', cls: 'text-amber-600 ring-amber-300' },
  'Ultra Rare': { ko: '울트라레어 UR', cls: 'text-fuchsia-600 ring-fuchsia-300' },
  'Special illustration rare': { ko: '스페셜아트레어 SAR', cls: 'text-amber-500 ring-amber-400' },
  'Hyper rare': { ko: '하이퍼레어 HR', cls: 'text-yellow-500 ring-yellow-400' },
  'Mega Ultra Rare': { ko: '메가 울트라레어 MUR', cls: 'text-yellow-600 ring-yellow-500' },
  'Mega Hyper Rare': { ko: '메가 하이퍼레어 MHR', cls: 'text-yellow-600 ring-yellow-500' },
};

// ⚠️ 같은 카드라도 판마다 등급 이름이 다르다. 데이터 키(위 RARITY)는 영문판 이름을
// 쓰고 있으므로, 일본판은 아래 표로 바꿔 부른다:
//   풀아트 = 일본판 SR(슈퍼레어) / 영문판 UR  ·  금색 = 일본판 UR(울트라레어) / 영문판 HR
//   일러스트 = 일본판 AR·SAR / 영문판 IR·SIR
const JP_KO: Record<string, string> = {
  'Ultra Rare': '슈퍼레어 SR',
  'Hyper rare': '울트라레어 UR',
};
const NA_KO: Record<string, string> = {
  'Illustration rare': '일러스트레어 IR',
  'Special illustration rare': '스페셜일러스트레어 SIR',
};
const rarityKo = (r: string | undefined, jp: boolean) =>
  (jp ? JP_KO[r ?? ''] : NA_KO[r ?? '']) ?? (RARITY[r ?? ''] ?? RARITY.Common).ko;
// 앨범에는 두 판의 카드가 섞이므로 필터 칩은 두 이름을 같이 쓴다.
const CHIP_KO: Record<string, string> = {
  'Illustration rare': 'AR·IR',
  'Special illustration rare': 'SAR·SIR',
  'Ultra Rare': '풀아트 SR·UR',
  'Hyper rare': '금색 UR·HR',
};
const chipLabel = (r: string) => CHIP_KO[r] ?? (RARITY[r]?.ko ?? r).split(' ').pop();

// 개봉 결과를 정리할 때 쓰는 묶음. 박스는 150장이라 한 줄로 늘어놓으면 고를 수가 없어서
// 등급별로 묶고, 미러·리버스는 등급이 커먼이어도 따로 뗀다(마스터볼이 커먼 더미에
// 섞이면 찾지 못한다).
// 뒤집기 전 "오, 좋은 카드인가?" 하는 맛. 덮개 아래 카드가 좋은 등급이면 뒷면이
// 은은하게 빛난다. 예전에는 등급과 상관없이 "마지막 장"이면 무조건 빛나서 신호가
// 아니라 장식이었다 — 이제 빛나면 실제로 ACE·AR 이상이다.
// 값나가는 카드일수록 세게 빛낸다. 등급이 아니라 "지금 시세"로 나눈다 —
// 등급이 높아도 값이 안 나가는 카드가 있고 그 반대도 있어서, 사람이 반가운 건 결국 값이다
// (사용자 지시 2026-08-04).
// 기준선은 실제 시세 분포로 정했다: 세트 대부분이 $1 미만이고(중앙값 $0.15~0.70),
// 팩에서 가끔 나오는 상위 카드가 $10~50, 세트 최상위가 $100~600대다.
const HIT_MID_USD = 10;
const HIT_BIG_USD = 50;
const HIT_MIN_USD = 1;
/** 시세로 정한 빛남 세기. 0=안 빛남 1=은은 2=세게 3=제일 화려 */
export const glowOf = (usd?: number) => {
  const v = usd ?? 0;
  if (v >= HIT_BIG_USD) return 3;
  if (v >= HIT_MID_USD) return 2;
  if (v >= HIT_MIN_USD) return 1;
  return 0;
};
const glowCls = (g: number) => (g >= 3 ? 'glow-big' : g === 2 ? 'glow-mid' : g === 1 ? 'glow-soft' : '');
// 뒷면에 주는 힌트. "뭔가 좋은 게 있다"는 쫄리는 맛이라 일부러 남긴다 —
// 어느 카드인지는 알려주되 뭔지는 안 알려주므로 스포일러가 아니다(사용자 확인 2026-08-04).
// 등급이 아니라 시세로 정하는 건 앞면과 같다.
const hintCls = (g: number) => (g >= 2 ? 'hint-strong' : g === 1 ? 'hint-soft' : '');

// 앨범에 기본으로 담아둘 카드 · "상위 카드"에 띄울 카드의 공통 기준.
// 시세가 나가거나(후광과 같은 기준) 등급이 높으면 해당한다. 둘 중 하나만 봐서는
// 놓치는 게 생긴다 — 시세만 보면 아직 시세를 못 받은 세트가 통째로 비고,
// 등급만 보면 값은 비싼데 등급이 낮은 카드가 빠진다(2026-08-04 실측 471장).
const keepByDefault = (c: { r?: string; m?: string; usd?: number }) =>
  glowOf(c.usd) > 0 || rankOf(c.r) >= 5 || c.m === 'master';

// 앨범 위 요약 숫자(모은 카드·사용 GP·예상 가치)의 글씨 크기.
// 폰에서 한 칸이 97px뿐이라, 긴 숫자를 한 크기로 쓰면 숫자 중간에서 잘려 두 줄이 된다.
// 글자 수에 맞춰 줄여 어떤 값이 와도 한 줄에 들어가게 한다.
// (넓은 화면은 칸이 넉넉하므로 sm: 이상에서는 늘 큰 글씨를 쓴다.)
const fitNum = (s: string) =>
  s.length >= 12 ? 'text-xs sm:text-xl' : s.length >= 10 ? 'text-sm sm:text-xl' : 'text-base sm:text-xl';

// 박스 개봉 한 줄 안내. 개봉 중에는 따로 띄우고, 다 뒤집은 뒤에는 결과 머리띠 안에
// 들어간다 — 두 군데서 쓰므로 문구를 한 곳에 둔다.
const boxLine = (packs: number, cards: number, jp: boolean) =>
  `박스 개봉 결과 — ${packs}팩 · ${cards}장${jp ? ' (박스 보장 봉입 적용)' : ' (영문판은 보장 없음)'}`;

// 카드 몇 장을 한 줄에 놓을지. 5장·7장짜리 팩은 한 줄로, 10장짜리는 5개씩 두 줄로
// 놓는다(운영자 지시 2026-08-05).
// ⚠️ 폰에서는 무조건 5칸이다. 375px에 7칸을 넣으면 한 장이 50px이라 뭐가 뭔지 모른다.
//    큰 화면에서만 장수대로 편다(아래 .pack-grid CSS).
const packCols = (n: number) => (n <= 7 ? n : 5);
// 칸이 몇 개든 카드 한 장의 크기가 비슷하게 보이도록 폭을 칸 수에 맞춰 준다.
// 안 그러면 5장 팩은 큼직한데 7장 팩만 작아 보인다.
const packWidth = (n: number) => `${packCols(n) * 168}px`;

const groupKeyOf = (c: PackCard) => (c.m ? `m:${c.m}` : `r:${c.r ?? 'Common'}`);
const groupRank = (k: string) =>
  k === 'm:master' ? 8.5 : k === 'm:poke' ? 2.6 : k === 'm:rev' ? 2.5 : rankOf(k.slice(2));
// TCGdex는 확장자 없는 베이스 주소라 /high.webp를 붙여야 한다. limitless는 이미 .png다.
const cardImg = (base: string) => (!base ? '' : /\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base}/high.webp`);
const thumb = (url: string, w: number) => {
  const src = cardImg(url);
  return src ? `/api/img?u=${encodeURIComponent(src)}&w=${w}` : '';
};
// pokegre 안에서만 쓰는 포인트 "GP(그레포인트)". 실제 돈 같아 보인다는 피드백으로
// 원화 대신 자체 재화 단위를 쓴다(숫자는 실제 정가 기준 그대로).
const gp = (n: number) => `${n.toLocaleString()} GP`;

// 팩 하나에서 그 등급이 나올 확률(%). 슬롯별 확률을 합쳐서 보여준다.
function ratesOf(pack: PackSet): { ko: string; pct: number; per: number }[] {
  const sum: Record<string, number> = {};
  for (const slot of pack.profile.slots) for (const [tier, p] of slot.rolls) sum[tier] = (sum[tier] ?? 0) + p;
  return Object.entries(sum)
    .sort((a, b) => rankOf(b[0]) - rankOf(a[0]))
    .map(([tier, p]) => ({ ko: rarityKo(tier, pack.jp), pct: p * 100, per: Math.round(1 / p) }));
}

// 확률은 "팩 종류"마다 정해져 있고 같은 종류면 세트가 달라도 같다. 팩을 하나씩
// 바꿔가며 봐야 하면 불편하니, 종류별로 묶어 한 화면에 다 보여준다.
// ⚠️ 진열은 한국시간 자정에 바뀐다. 예전에는 이 목록을 파일이 처음 읽힐 때 한 번만
// 계산해서, 화면을 열어 둔 채 자정을 넘기면 어제 진열이 그대로 보였다. 그 상태에서
// 사자마자 서버는 "오늘 진열이 아니다"라며 거절한다(서버는 매번 다시 계산한다).
// 그래서 날짜를 지켜보다가 바뀌면 다시 계산한다.
type RateGroup = { name: string; kind: string; noAce: boolean; packs: string[]; rates: ReturnType<typeof ratesOf>; godRate: number };
function buildGroups(live: PackSet[]): RateGroup[] {
  const raw = [...new Set(live.map((p) => p.profile))].map((profile) => {
  const packs = live.filter((p) => p.profile === profile);
  const first = packs[0];
  // 팩 장수는 프로필에서 계산한다 — 적어 두면 151(7장)처럼 다른 팩이 생겼을 때 틀린다.
  const size = profile.commons + profile.uncommons + profile.slots.length;
  const kind = first.jp
    ? profile === JP_MEGA
      ? `일본판 메가 시리즈 확장팩 (${size}장)`
      : profile === JP_151
        ? `일본판 강화 확장팩 (${size}장)`
        : `일본판 정규 확장팩 (${size}장)`
    : profile === NA_MEGA
      ? `영문판 메가 시리즈 부스터 (${size}장)`
      : profile === NA_PRISMATIC || profile === NA_151
        ? `영문판 특별세트 (${size}장)`
        : `영문판 메인 부스터 (${size}장)`;
  return {
    kind,
    // 같은 종류라도 ACE SPEC 수록 여부로 확률이 갈린다.
    noAce: !profile.slots.some((s) => s.rolls.some(([tier]) => tier === 'ACE SPEC Rare')),
    packs: packs.map((p) => p.label.replace(/^\[.+?\]\s*/, '')),
    rates: ratesOf(first),
    godRate: first.godRate ?? 0,
  };
  });
  // 제목이 똑같은 묶음이 둘로 갈릴 때만 "ACE SPEC 미수록"을 붙인다 — 안 그러면 왜 두 개인지 알 수 없다.
  return raw.map((g) => ({
    ...g,
    name: `${g.kind}${g.noAce && raw.some((o) => o.kind === g.kind && !o.noAce) ? ' · ACE SPEC 미수록' : ''} — ${g.packs.length}종`,
  }));
}

// 지금이 며칠인지(한국시간). 이 값이 바뀌면 진열도 바뀐다.
const todayKst = kstDateStr;

// "시세 보기"가 넘기는 목표. 앨범에 보여주는 값이 TCGplayer 마켓가이므로 눌렀을 때도
// TCGplayer 화면으로 간다(보여준 숫자와 다른 시장으로 보내면 헷갈린다). 검색어는
// "이름 번호"라 그 카드 한 장으로 좁혀진다(039처럼 0 붙은 그대로 — 39는 239에도 걸린다).
export type PickTarget = { query: string; source: 'snkrdunk' | 'ebay' | 'tcgplayer'; edition: 'japanese' | 'english' };

export function PackSim({
  onPickCard,
  onOpenSet,
  onRequestLogin,
}: {
  onPickCard?: (target: PickTarget) => void;
  // 진열 팩의 "수록 카드 보기" → 세트 목록 화면으로 이동.
  onOpenSet?: (slug: string) => void;
  // 로그인 안 한 사람이 출석 버튼을 눌렀을 때 로그인 창을 연다.
  onRequestLogin?: () => void;
}) {
  const [tab, setTab] = useState<'open' | 'stash' | 'album' | 'rates'>('open');
  // 방금 산 것. 사자마자 "바로 열기"로 열 수 있게 기억해 둔다 — 예전엔 보관함 탭으로
  // 옮긴 다음 "팩 개봉"을 또 눌러야 했다(사용자 지적 2026-08-04).
  // ⚠️ 보관함 자체는 그대로 둔다. 실제로 쟁여 두고 쓰는 사람이 있다(2026-08-04 기준 2명·33팩).
  const [justBought, setJustBought] = useState<{ slug: string; kind: 'pack' | 'box' } | null>(null);
  const [sim, setSim] = useState<SimState | null>(null);
  const [guest, setGuest] = useState(false);
  // 한국시간 날짜. 자정을 넘기면 바뀌고, 그때 진열을 다시 계산한다.
  const [dayKey, setDayKey] = useState(todayKst);
  useEffect(() => {
    // 30초마다 확인하고, 다른 화면에 다녀왔을 때도 확인한다(폰은 화면이 꺼져 있으면
    // 타이머가 안 돌아 자정을 놓친다).
    const check = () => setDayKey((prev) => (prev === todayKst() ? prev : todayKst()));
    const timer = setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  const liveToday = useMemo(() => livePacks(dayKey), [dayKey]);
  const profileGroups = useMemo(() => buildGroups(liveToday), [liveToday]);

  // 개봉 결과가 그려지는 자리. 열자마자 여기로 화면을 옮긴다.
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [slug, setSlug] = useState(liveToday[0].slug);
  // 진열이 바뀌었는데 고르고 있던 팩이 빠졌으면 오늘 것으로 옮긴다.
  useEffect(() => {
    if (!liveToday.some((p) => p.slug === slug)) setSlug(liveToday[0].slug);
  }, [liveToday, slug]);
  const [pack, setPack] = useState<UiCard[] | null>(null);
  const [boxInfo, setBoxInfo] = useState<number | null>(null); // 박스 개봉이면 팩 수
  // 박스는 실제 개봉처럼 한 팩씩 넘겨 가며 깐다. groups=팩별 카드, idx=지금 보는 팩.
  const [boxQueue, setBoxQueue] = useState<{ groups: UiCard[][]; gods: boolean[]; idx: number } | null>(null);
  const [god, setGod] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [checkinMsg, setCheckinMsg] = useState('');
  // 앨범에 필요한 세트 카드 목록(이름·이미지). 앨범 탭을 열 때만 받아온다.
  const [setCards, setSetCards] = useState<Record<string, PackCard[]>>({});
  // 팩 진열용 이미지(박스 사진·로고). public/sets/index.json에 이미 들어 있다.
  const [art, setArt] = useState<Record<string, { boxImg?: string; logo?: string }>>({});
  // 앨범 시세(세트→번호→USD). 합계와 카드별 표시에 쓴다.
  const [value, setValue] = useState<{
    prices: Record<string, Record<string, number>>;
    // 번호→영문 카드명. 일본판 "시세 보기"의 검색어로 쓴다(서버가 시세와 함께 받아 둔 것).
    names?: Record<string, Record<string, string>>;
    totalUsd: number;
    priced: number;
    pending?: string[];
  } | null>(null);
  // 앨범 선택 삭제 모드. 켜면 카드를 눌러 고르고, 한 번에 지운다.
  const [delMode, setDelMode] = useState(false);
  // 앨범 정렬: 등급·가격은 높은순/낮은순 각각(사용자 요청) + 최근 획득순
  const [albumSort, setAlbumSort] = useState<'rarity' | 'rarityAsc' | 'price' | 'priceAsc' | 'recent'>('rarity');
  // 앨범이 수백 종으로 커져도 보고 싶은 등급만 추릴 수 있게.
  const [albumFilter, setAlbumFilter] = useState<string>('all'); // 'all' 또는 등급 키
  const [delPick, setDelPick] = useState<Set<string>>(new Set());
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  // ⚠️ 환율은 화면을 열 때 한 번 받는다. 예전엔 **앨범 탭을 눌렀을 때만** 받았는데,
  //    개봉 결과에도 값을 원화로 적게 되면서(2026-08-05) 앨범을 한 번도 안 연 사람은
  //    결과에 값이 통째로 안 나왔다. 하루 한 번 바뀌는 값이라 미리 받아도 부담이 없다.
  useEffect(() => {
    void fetchExchangeRates().then(setRates).catch(() => undefined);
  }, []);
  // 방금 연 팩에서 앨범에 넣을 카드. 커먼까지 다 넣으면 앨범이 지저분해져서 골라 담는다.
  const [keep, setKeep] = useState<Set<number>>(new Set());
  // 구매 완료 알림. 구매 탭 맨 위에 눈에 띄게 띄우고 보관함으로 바로 갈 수 있게 한다
  // (작은 초록 글씨가 진열대 아래에 떠서 안 보인다는 피드백).
  const [buyMsg, setBuyMsg] = useState('');
  // 앨범에 넣기와 자랑하기는 서로 독립 — 넣었다고 자랑 기회가 사라지면 안 된다.
  const [keptDone, setKeptDone] = useState(false);
  // 실제로 앨범에 넣은 장수(0이면 "넘김"). 버튼 문구를 결과에 맞게 쓰려고 따로 둔다.
  const [keptCount, setKeptCount] = useState<number | null>(null);
  // 앨범이 가득 차 못 넣은 장수 안내.
  const [keepFullMsg, setKeepFullMsg] = useState('');
  // 박스 결과에서 "나머지 N장"을 펼쳤는지. 기본은 접힘.
  const [restOpen, setRestOpen] = useState(false);
  // 지난번에 열어 두고 안 고른 결과를 되살렸을 때 띄우는 안내.
  const [restoredMsg, setRestoredMsg] = useState('');
  const [share, setShare] = useState<ShareState>({ shared: false, msg: '' });
  // 자랑 작성 폼(바로 올리지 않고 글을 쓴 뒤 직접 등록한다).
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [shareTitle, setShareTitle] = useState('');
  // 겹쳐 놓인 카드 개봉: 덮개를 위로 드래그하면 아래 카드가 슬쩍 보이다가, 충분히
  // 운영자는 점검하려고 아무 때나 열어야 해서 기본이 무제한이다. 끄면 평소처럼
  // GP가 깎이고 모자라면 못 연다(그 흐름도 확인해야 하니 스위치로 뒀다).
  const [spend, setSpend] = useState(false);

  const cfg = packBySlug.get(slug) ?? liveToday[0];

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/local/auth/packsim', { credentials: 'include' });
      // ⚠️ 로그인 안 한 사람과 "아직 불러오는 중"을 구분해야 한다. 둘 다 sim이 null이라
      //    이 표시가 없으면 "오늘 출석 완료"·"1,600 GP 모자람"처럼 엉뚱한 안내가 나간다
      //    (2026-08-04 비로그인 점검에서 확인).
      if (!r.ok) {
        setGuest(true);
        return setErr('로그인하면 팩을 열 수 있습니다.');
      }
      const d = (await r.json()) as SimState;
      setSim(d);
      if (!d.admin) setSpend(true); // 일반 이용자는 항상 GP를 쓴다
    } catch {
      setErr('불러오지 못했습니다.');
    }
  }, []);
  useEffect(() => {
    void load();
    void fetch('/sets/index.json')
      .then((r) => r.json())
      .then((list: { slug: string; boxImg?: string; logo?: string }[]) =>
        setArt(Object.fromEntries(list.map((s2) => [s2.slug, { boxImg: s2.boxImg, logo: s2.logo }]))),
      )
      .catch(() => undefined);
  }, [load]);

  // 열어 놓고 "앨범에 넣기 / 넘기기"를 아직 안 고른 결과는 서버가 기억하고 있다(last.kept).
  // 새로고침하거나 다른 화면에 다녀와도 그대로 되살린다 — 실수로 창이 닫혔다고 결과가
  // 날아가면 억울하다. 서버는 번호·등급만 기억하므로 이름·이미지는 세트 파일에서 채운다.
  const restoredRef = useRef(false);
  useEffect(() => {
    const last = sim?.last;
    if (!last || last.kept || restoredRef.current) return;
    const cfg2 = packBySlug.get(last.slug);
    if (!cfg2) return;
    restoredRef.current = true;
    void fetch(cfg2.src)
      .then((r) => r.json())
      .then((d: { cards: PackCard[] }) => {
        const byNum = new Map(d.cards.map((c) => [c.n, c]));
        const cards: UiCard[] = last.cards.map((c, i) => ({
          n: c.n,
          name: byNum.get(c.n)?.name ?? '',
          img: byNum.get(c.n)?.img,
          r: c.r,
          m: c.m,
          // ⚠️ 값(usd)도 같이 옮겨야 한다. 서버는 되살릴 때도 값을 실어 보내는데
          //    여기서 카드를 새로 만들며 빠뜨리고 있었다. 그래서 갓 깠을 때는 값이
          //    보이다가, 새로고침하거나 다른 화면에 다녀오면 이름·등급만 남았다
          //    (2026-08-05 배포 전 점검에서 발견).
          usd: c.usd,
          i,
        }));
        const sorted = [...cards].sort((a, b) => rankOf(a.r) - rankOf(b.r));
        const size = cfg2.profile.commons + cfg2.profile.uncommons + cfg2.profile.slots.length;
        setSlug(last.slug);
        setPack(sorted);
        setRevealed(sorted.length); // 이미 본 결과라 정리 화면으로 바로 보낸다
        setFlippedSet(new Set(sorted.map((c) => c.i)));
        setBoxInfo(cards.length > size ? Math.round(cards.length / size) : null);
        setBoxQueue(null);
        setGod(last.god);
        setKeep(new Set(sorted.filter(keepByDefault).map((c) => c.i)));
        setRestOpen(false);
      setKeptDone(false);
        setKeptCount(null);
        setShare({ shared: !!last.shared, msg: '' });
        setRestoredMsg('지난번 개봉 결과입니다.');
        setTab('stash');
      })
      .catch(() => undefined);
  }, [sim]);

// 서버가 돌려준 사유를 사람 말로 바꾼다. 전부 "열지 못했습니다"로만 뜨면 로그인이
  // 풀린 것인지, 보관함이 빈 것인지, 진열이 바뀐 것인지 알 수가 없다.
  const openErrorText = (code: string | undefined, unit: '팩' | '박스') =>
    code === 'not enough'
      ? 'GP가 부족합니다.'
      : code === 'login required'
        ? '다시 로그인해 주세요.'
        : code === `no ${unit === '팩' ? 'pack' : 'box'} in stash`
          ? `보관함에 ${unit}이 없습니다.`
          : code === 'unknown pack'
            ? '보관함에서 열어 주세요.'
            : code === 'pack data missing'
              ? '카드 자료를 못 불러왔습니다.'
              : `${unit}을 열지 못했습니다.`;

  async function checkIn() {
    setBusy(true);
    try {
      const r = await fetch('/api/local/auth/packsim/checkin', { method: 'POST', credentials: 'include' });
      const d = (await r.json()) as SimState;
      setSim(d);
      // 잔액이 상한이면 실제로 들어간 금액이 준 금액보다 적다(서버가 capped로 알려준다).
      if (d.gained || d.capped) {
        trackEvent('packsim_checkin');
        setCheckinMsg(
          d.capped
            ? `출석했습니다. 보유 GP가 상한(${gp(MAX_BALANCE)})이라 ${gp(d.reward ?? 0)} 중 ${gp(d.gained ?? 0)}만 쌓였습니다. (연속 ${d.streak}일)`
            : `출석 보상 ${gp(d.gained ?? 0)}을 받았습니다. (연속 ${d.streak}일)`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  // 팩 구매: 보관함에 담기만 한다(모아뒀다 나중에 깔 수 있게).
  async function buy(slug2: string) {
    const target = packBySlug.get(slug2);
    if (!sim || !target || (spend && sim.balance < target.price)) return;
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/local/auth/packsim/buy', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug2, spend }),
      });
      const d = (await r.json()) as { balance?: number; packs?: Record<string, number>; boxes?: Record<string, number>; error?: string };
      if (!r.ok) {
        setErr(
          d.error === 'not enough'
            ? 'GP가 부족합니다.'
            : d.error === 'stash full'
              ? `보관함이 가득 찼습니다. (최대 ${MAX_STASH}팩)`
              : '구매하지 못했습니다.',
        );
        return;
      }
      setSim((s2) => (s2 ? { ...s2, balance: d.balance ?? s2.balance, packs: d.packs ?? s2.packs, boxes: d.boxes ?? s2.boxes } : s2));
      setBuyMsg(`${target.label.replace(/^\[.+?\]\s*/, '')} 1팩 구매 완료`);
      setJustBought({ slug: slug2, kind: 'pack' });
    } finally {
      setBusy(false);
    }
  }

  // 박스 구매: 팩과 같은 흐름 — 보관함에 담고, 개봉은 보관함에서 한다.
  async function buyBox(slug2: string) {
    const target = packBySlug.get(slug2);
    if (!sim || !target?.boxPacks) return;
    const price = target.price * target.boxPacks;
    if (spend && sim.balance < price) return;
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/local/auth/packsim/buy', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug2, spend, kind: 'box' }),
      });
      const d = (await r.json()) as { balance?: number; packs?: Record<string, number>; boxes?: Record<string, number>; error?: string };
      if (!r.ok) {
        setErr(
          d.error === 'not enough'
            ? 'GP가 부족합니다.'
            : d.error === 'stash full'
              ? `보관함의 박스가 가득 찼습니다. (최대 ${MAX_BOX_STASH}박스)`
              : '구매하지 못했습니다.',
        );
        return;
      }
      setSim((s2) => (s2 ? { ...s2, balance: d.balance ?? s2.balance, packs: d.packs ?? s2.packs, boxes: d.boxes ?? s2.boxes } : s2));
      setBuyMsg(`${target.label.replace(/^\[.+?\]\s*/, '')} 1박스 구매 완료`);
      setJustBought({ slug: slug2, kind: 'box' });
      trackEvent('packsim', `${target.label} 박스 구매`);
    } finally {
      setBusy(false);
    }
  }

  // 열어 둔 결과를 아직 처리 안 했으면(앨범에 넣기/넘기기) 새로 열 수 없다.
  // 예전엔 그냥 열려서, 고르지 않은 카드가 조용히 사라졌다.
  const mustDecide = !!pack && !keptDone;

  async function open(slug2: string, from?: 'stash') {
    if (!sim) return;
    if (mustDecide) {
      setErr('지난 카드를 먼저 정리해 주세요.');
      focusResult();
      return;
    }
    setErr('');
    setBusy(true);
    setPack(null);
    setRevealed(0);
    setFlippedSet(new Set());
    setGod(false);
    const target = packBySlug.get(slug2);
    setSlug(slug2);
    trackEvent('packsim', target?.label ?? slug2);
    try {
      const r = await fetch('/api/local/auth/packsim/open', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug2, spend, from }),
      });
      const d = (await r.json()) as { cards?: PackCard[]; god?: boolean; balance?: number; packs?: Record<string, number>; error?: string; highlight?: string };
      if (!r.ok || !d.cards) {
        setErr(openErrorText(d.error, '팩'));
        return;
      }
      setSim((s2) => (s2 ? { ...s2, balance: d.balance ?? s2.balance, packs: d.packs ?? s2.packs } : s2));
      if (d.god) trackEvent('packsim_godpack', cfg.label);
      sendHighlightName(d.highlight, d.cards, cfg.jp);
      // 등급 낮은 카드가 앞, 제일 좋은 카드가 맨 뒤로 오게 정렬해 마지막 한 장에서 터지게 한다.
      const withI: UiCard[] = d.cards.map((c, i) => ({ ...c, i }));
      const sorted = [...withI].sort((a, b) => rankOf(a.r) - rankOf(b.r));
      setPack(sorted);
      setBoxInfo(null);
      setBoxQueue(null);
      // 아트레어(AR) 이상은 기본으로 담아둔다 — 대부분 남기고 싶어 하는 등급이다.
      setKeep(new Set(sorted.filter(keepByDefault).map((c) => c.i)));
      setRestOpen(false);
      setKeptDone(false);
      setKeptCount(null);
      setRestoredMsg('');
      setShare({ shared: false, msg: '' });
      focusResult();
      setShareOpen(false);
      setShareText('');
      setShareTitle('');
      setGod(!!d.god);
      setSim((s) => (s ? { ...s, balance: d.balance ?? s.balance, opened: s.opened + 1 } : s));
      // 앨범 숫자도 같이 맞춘다. 정확한 값은 탭을 열 때 서버에서 다시 받는다.
    } finally {
      setBusy(false);
    }
  }

  // 박스 개봉: 일본판은 보장 봉입, 영문판은 독립시행. 결과는 한 팩씩 넘겨 가며 공개한다.
  async function openBox(slug2: string, from?: 'stash') {
    const target = packBySlug.get(slug2);
    if (!sim || !target?.boxPacks) return;
    if (mustDecide) {
      setErr('지난 카드를 먼저 정리해 주세요.');
      focusResult();
      return;
    }
    setErr('');
    setBusy(true);
    setPack(null);
    setSlug(slug2);
    trackEvent('packsim', `${target.label} 박스`);
    try {
      const r = await fetch('/api/local/auth/packsim/box', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug2, spend, from }),
      });
      const d = (await r.json()) as {
        packs?: { cards: PackCard[]; god: boolean }[];
        god?: boolean;
        godCount?: number;
        boxPacks?: number;
        balance?: number;
        boxes?: Record<string, number>;
        error?: string;
        highlight?: string;
      };
      if (!r.ok || !d.packs) {
        setErr(openErrorText(d.error, '박스'));
        return;
      }
      if (d.godCount) trackEvent('packsim_godpack', `${target.label} 박스`);
      sendHighlightName(d.highlight, d.packs.flatMap((p) => p.cards), target.jp);
      // i는 서버가 기억하는 순서(팩 순서 그대로) — 앨범 골라 담기가 이 번호를 쓴다.
      // 팩 안에서만 등급 낮은 순으로 정렬해, 팩마다 마지막 장에서 터지게 한다.
      let k = 0;
      const groups: UiCard[][] = d.packs.map((p) =>
        p.cards.map((c) => ({ ...c, i: k++ })).sort((a, b) => rankOf(a.r) - rankOf(b.r)),
      );
      const sorted = groups.flat().sort((a, b) => rankOf(a.r) - rankOf(b.r));
      setPack(sorted);
      setRevealed(0);
      setFlippedSet(new Set());
      setBoxQueue({ groups, gods: d.packs.map((p) => p.god), idx: 0 });
      setBoxInfo(d.boxPacks ?? d.packs.length);
      setGod(!!d.god);
      setKeep(new Set(sorted.filter(keepByDefault).map((c) => c.i)));
      setRestOpen(false);
      setKeptDone(false);
      setKeptCount(null);
      setRestoredMsg('');
      setShare({ shared: false, msg: '' });
      focusResult();
      setShareOpen(false);
      setShareText('');
      setSim((s2) =>
        s2 ? { ...s2, balance: d.balance ?? s2.balance, boxes: d.boxes ?? s2.boxes, opened: (s2.opened ?? 0) + (d.boxPacks ?? 0) } : s2,
      );
    } finally {
      setBusy(false);
    }
  }

  async function keepCards() {
    setBusy(true);
    try {
      const r = await fetch('/api/local/auth/packsim/keep', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idxs: [...keep] }),
      });
      const d = (await r.json()) as { kept?: number; dropped?: number; albumLimit?: number; album?: AlbumCard[] };
      if (d.album) setSim((s2) => (s2 ? { ...s2, album: d.album! } : s2));
      setKeptCount(d.kept ?? 0);
      // 앨범이 가득 차면 새 종류는 못 들어간다. 예전엔 말없이 버려서 들어간 줄 알았다.
      setKeepFullMsg(
        d.dropped
          ? `앨범이 가득 차서 ${d.dropped}장은 넣지 못했습니다. (최대 ${(d.albumLimit ?? 0).toLocaleString()}종) 앨범에서 카드를 지우면 자리가 생깁니다.`
          : '',
      );
      setKeptDone(true);
      setRestoredMsg('');
    } finally {
      setBusy(false);
    }
  }

  // 방금 연 팩을 커뮤니티 "gre 개봉" 게시판에 올린다. 카드·등급은 서버가 기억하는 값으로
  // 쓰고, 여기선 한글 이름 표기만 보내준다. 보상은 하루 1번.
  async function shareToCommunity() {
    if (!pack) return;
    setBusy(true);
    try {
      const names = Object.fromEntries(pack.map((c) => [c.n, koName(cfg.jp, c.name)]));
      const r = await fetch('/api/local/auth/packsim/share', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names, comment: shareText, title: shareTitle }),
      });
      const d = (await r.json()) as { postId?: number; gained?: number; balance?: number; error?: string };
      if (!r.ok || !d.postId) {
        // 서버가 왜 막았는지 그대로 알려 준다 — "올리지 못했습니다"만 뜨면
        // 닉네임을 정해야 하는 건지 뭔지 알 수가 없다.
        setShare({
          shared: false,
          msg:
            d.error === 'already shared'
              ? '이미 자랑한 팩입니다.'
              : d.error === 'nickname required'
                ? '닉네임을 먼저 정해 주세요.'
                : d.error === 'no pack'
                  ? '자랑할 개봉 결과가 없습니다.'
                  : '올리지 못했습니다.',
        });
        return;
      }
      trackEvent('packsim_share');
      if (typeof d.balance === 'number') setSim((s2) => (s2 ? { ...s2, balance: d.balance! } : s2));
      setShare({
        shared: true,
        msg: d.gained ? `커뮤니티에 올렸습니다. 자랑 보상 +${gp(d.gained)} (하루 1번)` : '커뮤니티에 올렸습니다.',
      });
      setShareOpen(false);
    } finally {
      setBusy(false);
    }
  }

  // 선택한 카드들을 앨범에서 지운다(중복 포함 통째로). 확인을 한 번 받는다.
  async function removeSelected() {
    if (delPick.size === 0) return;
    if (!window.confirm(`선택한 ${delPick.size}종에서 1장씩 삭제합니다. 삭제한 카드는 복구할 수 없습니다. 계속하시겠습니까?`)) return;
    setBusy(true);
    try {
      const items = [...delPick].map((k) => {
        const [s2, n, m] = k.split('|');
        return { s: s2, n, m };
      });
      const r = await fetch('/api/local/auth/packsim/album/remove', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const d = (await r.json()) as { album?: AlbumCard[] };
      if (d.album) setSim((s2) => (s2 ? { ...s2, album: d.album! } : s2));
      setDelPick(new Set());
      setDelMode(false);
      // 예상 가치는 따로 받아 오는 값이라, 여기서 다시 받지 않으면 지운 카드 값이
      // 그대로 남아 있다가 새로고침해야 줄어든다.
      void loadValue();
    } finally {
      setBusy(false);
    }
  }

  const loadValue = useCallback(async () => {
    try {
      const r = await fetch('/api/local/auth/packsim/value', { credentials: 'include' });
      if (r.ok) setValue((await r.json()) as typeof value);
    } catch {
      /* 시세는 참고용이라 실패해도 앨범은 그대로 보인다 */
    }
  }, []);

  // 앨범 탭: 앨범에 든 세트의 카드 목록을 받아 이름·이미지를 붙인다. 시세·환율도 같이.
  useEffect(() => {
    if (tab !== 'album' || !sim) return;
    void load();
    trackEvent('packsim_value');
    void loadValue();
    void fetchExchangeRates().then(setRates).catch(() => undefined);
    const need = [...new Set(sim.album.map((a) => a.s))].filter((s) => !setCards[s]);
    for (const s of need) {
      const src = packBySlug.get(s)?.src;
      if (!src) continue;
      void fetch(src)
        .then((r) => r.json())
        .then((d: { cards: PackCard[] }) => setSetCards((prev) => ({ ...prev, [s]: d.cards })))
        .catch(() => undefined);
    }
    // sim.album이 바뀔 때마다 다시 볼 필요는 없다(탭 진입 시 한 번).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 서버가 PPT 분당 한도(세트당 크레딧 250, 분당 500) 때문에 요청당 1세트만 받아온다.
  // 아직 못 받은 세트(pending)가 있으면 70초 뒤 다시 불러 하나씩 채운다.
  useEffect(() => {
    if (tab !== 'album' || !value?.pending?.length) return;
    const t = setTimeout(() => void loadValue(), 70_000);
    return () => clearTimeout(t);
  }, [tab, value, loadValue]);

  // 카드 한 장을 정확히 가리키는 검색 목표를 만든다. 앨범이 보여주는 값이 TCGplayer
  // 마켓가라 눌렀을 때도 TCGplayer 화면으로 간다. 검색어는 "이름 번호"(번호는 039처럼
  // 0 붙은 그대로가 정확).
  // ⚠️ 검색어는 반드시 영문(TCGplayer 표기)이어야 한다. 한글로 바꿨다 되돌리면
  // "Team Rocket's"가 "로켓단의"로 남거나 트레이너 이름이 아예 안 바뀌어 검색이
  // 빗나간다 — 실제로 231번 뮤츠가 "매물 없음"으로 나왔다.
  //   영문판: 원본 이름이 이미 영문이라 그대로 쓴다.
  //   일본판: 원본이 일본어라, 시세를 받을 때 함께 저장해 둔 영문 이름을 쓴다.
  //           (아직 못 받았으면 한글→영문 번역으로 최선을 다한다)
  const pickTarget = (slug2: string, n: string, rawName: string): PickTarget => {
    const jp = !!packBySlug.get(slug2)?.jp;
    const en = value?.names?.[slug2]?.[n.replace(/^0+/, '') || '0'];
    const name = en || (jp ? koName(true, rawName) : rawName);
    return { query: `${name} ${n}`, source: 'tcgplayer', edition: jp ? 'japanese' : 'english' };
  };

    const usdOf = (a: AlbumCard) => {
    return 앨범값(value?.prices[a.s], a.n, a.m);
  };
  // ⚠️ 여기 간소한 사본이 있었다. 정식 규칙(lib/koCardName.ts)과 31장이 달랐다 —
  //    "Team Rocket's Houndoom"이 "Team 로켓단의 헬가"로 영어가 남았다(2026-08-07 실측).
  //    화면·서버가 다 쓰는 그 함수를 그대로 쓴다.
  const koName = (jp: boolean, name: string) => (!name ? '' : koCardName(jp ? 'ja' : 'en', name));
  // 홈 배너에 오른 카드의 한글 이름을 서버에 알려 준다.
  // 서버엔 번역기가 없고 홈은 사전을 안 받는다(사전이 내려받는 양의 절반이라 첫 화면을
  // 무겁게 한다). 이 화면은 이미 사전을 들고 있으니 여기서 한 장만 보낸다.
  // 배너에 오르는 건 100팩에 한 번쯤이라 부담이 없다. 실패해도 그냥 넘어간다 —
  // 이름이 없으면 배너가 팩 이름과 등급만 보여준다.
  const sendHighlightName = (n: string | undefined, cards: PackCard[], jp: boolean) => {
    if (!n) return;
    const hit = cards.find((c) => c.n === n);
    const name = hit ? koName(jp, hit.name) : '';
    if (!name) return;
    void fetch('/api/local/auth/packsim/highlight-name', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ n, name }),
    }).catch(() => undefined);
  };
  // 개봉 직후 결과 자리로 화면을 옮긴다.
  //
  // 보관함을 스크롤해 내려가서 열면 결과는 위쪽에 생기는데 화면은 그대로라, 처음 쓰는
  // 사람은 뭐가 열렸는지 모르고 지나친다.
  //
  // ⚠️ useEffect로 하면 안 된다. 결과가 이미 떠 있는 상태에서 또 열면 효과가 다시 돌면서
  //    정리(cleanup)가 예약해둔 스크롤을 취소해 버린다(실제로 겪었다). 개봉이 성공한
  //    자리에서 직접 부른다.
  // 결과가 끼어들면 문서 길이가 확 바뀌고 브라우저가 보던 위치를 유지하려 스크롤을 되돌린다.
  // 그래서 다음 프레임과 잠시 뒤, 두 번 맞춘다.
  const focusResult = useCallback(() => {
    // 부드럽게(smooth) 옮기면 도중에 취소된다 — 결과가 그려지며 문서 길이가 계속 바뀌고
    // 브라우저가 스크롤을 되돌리는데, 그 과정에서 진행 중이던 부드러운 이동이 끊긴다
    // (실제로 재현했다). 즉시 옮기면 그런 일이 없다. 화면이 통째로 바뀌는 순간이라
    // 즉시 이동이 어색하지도 않다.
    const go = () => resultRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    requestAnimationFrame(() => requestAnimationFrame(go));
    window.setTimeout(go, 450);
  }, []);

  // 어느 자리를 뒤집었는지 따로 기억한다. 예전엔 "몇 장째"(revealed)만 세서 순서대로만
  // 뒤집을 수 있었는데, 이제 안 뒤집힌 카드는 아무거나 눌러도 된다(사용자 지시 2026-08-04).
  // revealed는 "몇 장 뒤집었나"로 계속 쓴다(진행 표시·다 됐는지 판단).
  const [flippedSet, setFlippedSet] = useState<Set<number>>(new Set());
  const flipOne = (i: number) =>
    setFlippedSet((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      setRevealed(next.size);
      return next;
    });
  /** 여러 자리를 한 번에 뒤집는다(박스의 "이 팩 한번에 공개"). */
  const flipMany = (idxs: number[]) =>
    setFlippedSet((prev) => {
      const next = new Set(prev);
      for (const i of idxs) next.add(i);
      setRevealed(next.size);
      return next;
    });
  const flipAll = () => {
    if (!pack) return;
    setFlippedSet(new Set(pack.map((c) => c.i)));
    setRevealed(pack.length);
  };
  const allDone = !!pack && revealed >= pack.length;
  // 개봉이 진행 중인가(아직 다 안 뒤집음). 이때는 화면을 카드에 양보한다.
  const revealing = (!!pack && !allDone) || !!boxQueue;

  // 결과 정리 순서 — **값 높은 순**. 값을 모르는 카드는 등급 높은 순으로 뒤에 붙인다.
  // ⚠️ 등급순으로 두면 값이 등급을 안 따라가는 카드가 묻힌다(같은 SAR인데 10배 차이).
  //    보러 온 사람이 제일 먼저 알고 싶은 건 "얼마짜리가 나왔나"다.
  // 한 팩(장수가 적은 것)은 **깐 순서 그대로** 둔다. 값 순으로 다시 세우면 방금 뒤집으며
  // 본 자리와 달라져서, 어느 게 뭐였는지 눈으로 못 따라간다(운영자 지적 2026-08-05).
  // 박스는 150장이라 사정이 다르다 — 그때는 값 높은 순으로 세워야 좋은 카드가 앞에 온다.
  const 접기기준 = 24; // 이보다 많으면 박스로 보고, 값 순 + 나머지 접기
  const resultCards = (() => {
    if (!pack) return [] as UiCard[];
    if (pack.length <= 접기기준) return [...pack];
    return [...pack].sort((a, b) => {
      const av = a.usd ?? 0;
      const bv = b.usd ?? 0;
      if (av !== bv) return bv - av;
      return groupRank(groupKeyOf(b)) - groupRank(groupKeyOf(a));
    });
  })();

  // 박스는 150장(영문판은 360장)이라 다 펴 놓으면 세로로 7,000px이 넘는다. 그런데
  // 실제로 볼 값어치가 있는 건 몇 장뿐이다 — 방금 연 박스는 150장 중 1만원 넘는 게
  // 3장, 후광이 걸린 게 4장이었고 나머지 145장을 합쳐 8,700원이었다.
  // 그래서 **값나가는 것만 펴고 나머지는 한 줄로 접는다**(운영자 지시 2026-08-05).
  //
  // ⚠️ 접는 건 하나뿐이다. 예전엔 등급마다 접기 버튼이 있어서 같은 버튼이 화면에 네다섯
  //    번 나왔고 그게 "난잡하다"는 지적의 원인이었다. 그 실수를 되풀이하지 않는다.
  // ⚠️ 팩(5~10장)은 접지 않는다. 접을 것도 없는데 버튼만 생기면 손해다.
  const 볼만한 = resultCards.filter((c) => glowOf(c.usd) > 0);
  // 후광이 하나도 없는 박스도 있다(값이 다 낮거나 시세를 아직 못 받은 세트). 그럴 때
  // 위가 텅 비면 "고장난 화면"으로 보이므로 값 높은 순으로 8장은 채운다.
  const 앞줄 = resultCards.length > 접기기준 ? (볼만한.length >= 8 ? 볼만한 : resultCards.slice(0, 8)) : resultCards;
  const 뒷줄 = resultCards.slice(앞줄.length);
  const 뒷줄값 = 뒷줄.reduce((n, c) => n + (c.usd ?? 0), 0);

  return (
    <div>
      <h2 className="text-base font-bold text-black">
        오늘의 상점
      </h2>

      {/* 현황판. 개봉 중에는 한 줄로 접는다 — 안 접으면 화면 위 1/3을 먹어서 카드가
          화면 61% 아래에서 시작했다(폰에서 카드를 보려면 스크롤해야 했다).
          출석·연속일수는 개봉이 끝난 뒤에 봐도 된다(사용자 지적 2026-08-04). */}
      {revealing ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-2 text-sm">
          <span className="text-neutral-400">보유 GP</span>
          <span className="font-bold text-black">{(sim?.balance ?? 0).toLocaleString()}</span>
        </div>
      ) : (
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-y-3">
          {/* ⚠️ 앨범 탭에서는 보여줄 숫자를 바꾼다(운영자 지시 2026-08-06).
              예전엔 이 현황판 아래에 앨범 전용 상자가 하나 더 쌓여, 같은 생김새의
              네모가 둘 겹치고 "보유 GP"가 두 번 나왔다. 앨범을 보는 사람에게
              연속 출석·개봉한 팩은 지금 궁금한 값이 아니므로, 그 두 칸을 모은 카드·
              예상 가치로 바꿔 끼운다. 상자 하나가 통째로 없어진다. */}
          <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:max-w-md sm:flex-1">
            <div className="min-w-0">
              <p className="text-xs text-neutral-400">보유 GP</p>
              <p className="mt-0.5 truncate text-lg font-bold text-black sm:text-xl">{(sim?.balance ?? 0).toLocaleString()}</p>
            </div>
            {tab === 'album' ? (
              <>
                <div className="min-w-0">
                  <p className="text-xs text-neutral-400">모은 카드</p>
                  <p className="mt-0.5 truncate text-lg font-bold text-black sm:text-xl">
                    {sim?.album.length ?? 0}종
                    <span className="ml-1 align-middle text-xs font-semibold text-neutral-400">
                      {(sim?.album ?? []).reduce((a, b) => a + b.c, 0)}장
                    </span>
                  </p>
                </div>
                {(() => {
                  const worth =
                    value && value.totalUsd > 0 && rates
                      ? formatKrwApprox(value.totalUsd * rates.usdToKrw)
                      : value && value.totalUsd > 0
                        ? `$${value.totalUsd.toLocaleString()}`
                        : '—';
                  return (
                    <div className="min-w-0">
                      <p className="text-xs text-neutral-400">예상 가치</p>
                      {/* ⚠️ truncate로 자르면 "약 1,234만…"처럼 값이 잘려 나간다. 값은
                          자르지 말고 글자를 줄여 한 줄에 넣는다(fitNum). */}
                      <p className={`mt-0.5 whitespace-nowrap font-bold text-black ${fitNum(worth)}`}>{worth}</p>
                    </div>
                  );
                })()}
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="text-xs text-neutral-400">연속 출석</p>
                  <p className="mt-0.5 truncate text-lg font-bold text-black sm:text-xl">{sim?.streak ?? 0}일</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-neutral-400">개봉한 팩</p>
                  <p className="mt-0.5 truncate text-lg font-bold text-black sm:text-xl">
                    {sim?.opened ?? 0}팩
                    {sim?.god ? <span className="ml-1 align-middle text-xs font-semibold text-amber-600">갓팩 {sim.god}</span> : null}
                  </p>
                </div>
              </>
            )}
          </div>
          {/* 잔액이 상한이면 눌러도 한 푼도 안 들어온다. 버튼을 그대로 열어 두면 눌러 보고
              아무 일도 안 일어나는 것처럼 보이므로, 미리 이유를 적어 준다. */}
          {(() => {
            const full = (sim?.balance ?? 0) >= MAX_BALANCE;
            const label = guest
              ? '로그인하고 시작하기'
              : !sim?.canCheckIn
                ? '오늘 출석 완료'
                : full
                  ? `GP가 가득 찼습니다`
                  : `출석하고 ${gp(DAILY_BUDGET)} 받기`;
            return (
              <div className="w-full sm:ml-auto sm:w-auto">
                <button
                  type="button"
                  onClick={guest ? onRequestLogin : checkIn}
                  disabled={guest ? false : busy || !sim?.canCheckIn || full}
                  className="w-full rounded-lg bg-black px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40 sm:w-auto"
                >
                  {label}
                </button>
                {sim?.canCheckIn && full && (
                  <p className="mt-1 text-[11px] text-neutral-400 sm:text-right">
                    GP가 상한이라 지금 받으면 사라집니다.
                  </p>
                )}
              </div>
            );
          })()}
        </div>
        {sim?.admin && (
          <label className="mt-3 flex items-center justify-end gap-1.5 text-xs text-neutral-400">
            <input type="checkbox" checked={spend} onChange={(e) => setSpend(e.target.checked)} />
            GP 차감 (끄면 운영자 무제한)
          </label>
        )}
      </div>
      )}
      {checkinMsg && <p className="mt-2 text-sm font-semibold text-emerald-600">{checkinMsg}</p>}
      {err && <p className="mt-2 text-sm text-rose-500">{err}</p>}

      {/* 탭 */}
      <div className="mt-4 flex gap-1">
        {([
          ['open', '구매'],
          [
            'stash',
            `보관함${(() => {
              const n =
                Object.values(sim?.packs ?? {}).reduce((a, b) => a + b, 0) +
                Object.values(sim?.boxes ?? {}).reduce((a, b) => a + b, 0);
              return n > 0 ? ` (${n})` : '';
            })()}`,
          ],
          ['album', `내 앨범${sim?.album.length ? ` (${sim.album.length})` : ''}`],
          ['rates', '확률표'],
        ] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              tab === v ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <>

          {/* 팩 진열장 — 사이트 기본 톤. 팩을 고르면 그 타일 안에 "열기" 버튼이 바로 나타난다
              (버튼이 멀리 떨어져 있으면 고르고 나서 시선이 한 번 더 이동해야 해 불편하다). */}
          {[
            { label: '일본판', dot: 'bg-rose-500', packs: liveToday.filter((p) => p.jp) },
            { label: '영문판', dot: 'bg-blue-500', packs: liveToday.filter((p) => !p.jp) },
          ].map((row) => (
            <div key={row.label} className="mt-5">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-neutral-600">
                <span className={`inline-block h-2 w-2 rounded-full ${row.dot}`} />
                {row.label}
              </p>
              {/* ⚠️ items-start가 없으면 한 줄의 타일이 서로 높이를 맞춘다. 고른 타일에만
                  버튼 두 개와 안내가 붙으므로, 나머지 타일은 가격표 아래가 통째로
                  비어 보였다(사용자 지적 2026-08-04). 각자 내용만큼만 차지하게 둔다. */}
              <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-3">
                {row.packs.map((s2) => {
                  const on = s2.slug === slug;
                  const img = art[s2.slug]?.boxImg || art[s2.slug]?.logo;
                  const can = !!sim && (!spend || sim.balance >= s2.price);
                  return (
                    <div
                      key={s2.slug}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSlug(s2.slug);
                        setPack(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setSlug(s2.slug);
                          setPack(null);
                        }
                      }}
                      className={`group cursor-pointer rounded-2xl border p-3 text-center shadow-sm transition ${
                        on ? 'border-black ring-1 ring-black' : 'border-neutral-200 hover:border-neutral-300 hover:shadow'
                      }`}
                    >
                      <div className="flex h-32 items-end justify-center rounded-xl bg-gradient-to-b from-neutral-50 to-neutral-100 px-2 pb-2 pt-3 sm:h-40">
                        {img && (
                          <img
                            src={thumb(img, 320)}
                            alt=""
                            loading="lazy"
                            className={`max-h-32 object-contain transition sm:max-h-40 ${
                              on ? '' : 'group-hover:-translate-y-1'
                            }`}
                          />
                        )}
                      </div>
                      <p className="mt-2 line-clamp-1 text-sm font-semibold text-neutral-800">
                        {s2.label.replace(/^\[.+?\]\s*/, '')}
                        <span className="ml-1 text-xs font-normal text-neutral-400">
                          {s2.profile.commons + s2.profile.uncommons + s2.profile.slots.length}장
                        </span>
                      </p>
                      {on ? (
                        <div className="mt-2 space-y-1.5">
                          {/* 팩·박스는 같은 "구매"라 같은 모양으로 나란히 둔다.
                              ⚠️ 예전엔 팩만 검정, 박스는 테두리였다. 30배 비싼 박스를 실수로
                                 누르지 말라는 뜻이었는데, 그러면 팩이 이미 선택된 것처럼 보였다
                                 (사용자 지적 2026-08-04). 지금은 값을 버튼에 그대로 적어
                                 ("1팩 1,600 GP" / "1박스 48,000 GP") 차이가 눈에 보이게 했다. */}
                          <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void buy(s2.slug);
                            }}
                            disabled={busy || !can}
                            className="flex-1 rounded-lg bg-black py-2.5 text-sm font-bold text-white disabled:opacity-40"
                          >
                            {/* ⚠️ 못 살 때도 무엇을 얼마에 사는지는 보여 준다. 예전엔 팩·박스
                                버튼이 둘 다 "GP가 부족합니다"로 똑같아져서, 뭘 사는 버튼인지도
                                얼마를 모아야 하는지도 알 수 없었다(사용자 지적 2026-08-04). */}
                            {/* ⚠️ 한 줄로 적으면 좁은 화면에서 "1박스 48,000 GP"가 잘린다
                                (사용자 지적 2026-08-04). 무엇을/얼마에를 줄로 나눈다. */}
                            {busy ? (
                              '구매 중…'
                            ) : (
                              <>
                                <span className="block text-[11px] font-semibold opacity-80">1팩</span>
                                <span className="block whitespace-nowrap">
                                  {can || guest ? gp(s2.price) : `${gp(s2.price - (sim?.balance ?? 0))} 모자람`}
                                </span>
                              </>
                            )}
                          </button>
                          {(s2.boxPacks ?? 0) > 0 &&
                            (() => {
                              const boxPrice = s2.price * (s2.boxPacks ?? 0);
                              const canBox = !!sim && (!spend || sim.balance >= boxPrice);
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void buyBox(s2.slug);
                                  }}
                                  disabled={busy || !canBox}
                                  className="flex-1 rounded-lg bg-black py-2.5 text-sm font-bold text-white disabled:opacity-40"
                                >
                                  {busy ? (
                                    '구매 중…'
                                  ) : (
                                    <>
                                      {/* ⚠️ 몇 팩짜리인지 버튼에 적는다(운영자 지시 2026-08-05).
                                          박스 값이 팩의 30~36배라, 팩 수를 모르면 왜 이만큼
                                          비싼지 알 수 없었다. 일본판 30팩·영문판 36팩으로 서로
                                          다르기도 하다. */}
                                      <span className="block text-[11px] font-semibold opacity-80">
                                        1박스 ({s2.boxPacks}팩)
                                      </span>
                                      <span className="block whitespace-nowrap">
                                        {canBox || guest ? gp(boxPrice) : `${gp(boxPrice - (sim?.balance ?? 0))} 모자람`}
                                      </span>
                                    </>
                                  )}
                                </button>
                              );
                            })()}
                          </div>
                          <p className="text-[11px] text-neutral-400">사서 바로 열거나 보관함에 둡니다.</p>
                        </div>
                      ) : (
                        // ⚠️ 고른 팩은 큰 검정 버튼 두 개인데 나머지는 작은 알약 하나뿐이라
                        //    무게가 너무 달랐고, 그 값이 "한 팩 값"이라는 것도 안 보였다
                        //    (사용자 지적 2026-08-04). 고른 쪽과 같은 크기·같은 말로 맞춘다.
                        <p className="mt-2">
                          <span className="block w-full rounded-lg bg-neutral-100 px-3 py-2 text-center text-sm font-bold text-neutral-700">
                            1팩 {gp(s2.price)}
                          </span>
                        </p>
                      )}
                      {on && onOpenSet && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSet(s2.slug);
                          }}
                          className="mt-1.5 w-full rounded-lg py-1.5 text-xs font-semibold text-neutral-500 underline underline-offset-2 hover:text-black"
                        >
                          수록 카드 전체 보기
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {/* ⚠️ 여기 설명이 너무 길었다(사용자 지적 2026-08-04). 진열 안내와 면책을
              합쳐 다섯 줄 가까이 됐다. 진열 안내는 한 줄로 줄인다.
              면책은 지우지 않는다 — "실제 카드가 아니고 GP는 현금 가치가 없다"는
              말이 없으면 진짜 결제로 읽힌다(오늘 홈에도 같은 이유로 한 줄 넣었다).
              대신 확률 관련은 확률표 탭이 따로 있으므로 여기서 뺐다. */}
          <p className="mt-3 text-xs text-neutral-400">상품은 매일 자정에 새롭게 갱신됩니다.</p>
          <p className="mt-1 text-xs text-neutral-400">
            비공식 팬 시뮬레이션입니다. 실제 카드 거래가 아니며 GP는 현금 가치가 없습니다.
          </p>
        </>
      )}

      {/* 개봉 연출·결과·앨범 담기·자랑 — 개봉은 보관함에서 하므로 보관함 탭에 그린다
          (구매 탭은 구매만). 아래 보관함 목록 위에 결과가 뜬다. */}
      {tab === 'stash' && !!pack && (
        <>
          {/* 개봉 결과가 시작되는 자리. 보관함을 스크롤해 내려가서 열면 결과가 위쪽에
              생기는데 화면은 그대로라, 처음 쓰는 사람은 뭔가 열렸는지 모른다.
              열자마자 이 자리로 화면을 옮긴다. */}
          <div ref={resultRef} className="scroll-mt-4" />
          {restoredMsg && (
            <p className="mt-3 rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm font-semibold text-neutral-700">
              {restoredMsg}
            </p>
          )}

          {/* ⚠️ 박스 개봉 안내를 여기 따로 두면 아래 머리띠와 정보 상자가 두 개 연달아 붙어
              화면이 난잡해진다(사용자 지적 2026-08-04). 다 뒤집기 전까지만 여기 두고,
              끝난 뒤에는 머리띠 안 첫 줄로 들어간다. */}
          {boxInfo && pack && !boxQueue && !allDone && (
            <p className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm font-semibold text-neutral-700">
              {boxLine(boxInfo, pack.length, cfg.jp)}
            </p>
          )}
          {/* 낱팩도 마찬가지 — 다 뒤집은 뒤에 알린다(스포일러 방지). */}
          {god && !boxQueue && allDone && (
            <div className="mt-4 animate-pulse rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 p-3 text-center text-base font-black text-black">
              갓팩 — 전부 AR 이상입니다
            </div>
          )}

          {/* 박스: 한 팩씩 낱팩과 똑같이 뒤집는다. 예전엔 5장이 자동으로 다 열리고
              "다음 팩"만 눌렀는데, 그러면 같은 게임인데 팩깡과 손놀림이 달랐다
              (사용자 지적 2026-08-04). */}
          {boxQueue && pack && (
            <div className="mt-6">
              <p className="text-center text-sm font-semibold text-neutral-600">
                팩 {boxQueue.idx + 1} / {boxQueue.groups.length}
              </p>
              {/* ⚠️ 갓팩 알림도 다 뒤집은 뒤에 띄운다. 미리 띄우면 뒤집기 전에
                  "이 팩은 대박"인 걸 알아 버린다(스포일러). */}
              {boxQueue.gods[boxQueue.idx] &&
                boxQueue.groups[boxQueue.idx].every((c) => flippedSet.has(c.i)) && (
                  <div className="mx-auto mt-2 max-w-md animate-pulse rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 p-2 text-center text-sm font-black text-black">
                    갓팩 — 전부 AR 이상입니다
                  </div>
                )}
              <p className="mt-2 text-center text-sm font-semibold text-neutral-600">
                카드를 눌러서 뒤집어 보세요 ({boxQueue.groups[boxQueue.idx].filter((c) => flippedSet.has(c.i)).length}/
                {boxQueue.groups[boxQueue.idx].length})
              </p>
              {/* ⚠️ 큰 화면에서 카드가 작았다(운영자 지적 2026-08-05). 폭이 672px에 5칸이라
                  한 장이 124px이었다. 넓은 화면에서만 896px까지 벌려 170px로 키운다 —
                  폰은 그대로다(칸 수를 바꾸면 한 줄에 5장이 안 나온다). */}
              <div
                key={boxQueue.idx}
                className="pack-grid mx-auto mt-2 grid w-full gap-2 sm:gap-3"
                style={{
                  ["--cols" as string]: packCols(boxQueue.groups[boxQueue.idx].length),
                  maxWidth: packWidth(boxQueue.groups[boxQueue.idx].length),
                }}
              >
                {boxQueue.groups[boxQueue.idx].map((c, i2) => (
                  <CardSlot
                    key={c.i}
                    card={c}
                    jp={cfg.jp}
                    index={i2}
                    flipped={flippedSet.has(c.i)}
                    canFlip
                    onFlip={() => flipOne(c.i)}
                    name={koName(cfg.jp, c.name)}
                    showTier
                    price={c.usd && rates ? formatKrwApprox(c.usd * rates.usdToKrw) : undefined}
                  />
                ))}
              </div>
              {/* 버튼 세 개가 세로로 쌓여 카드가 화면 아래로 밀렸다. 한 줄로 묶는다
                  (사용자 지적 2026-08-04). "남은 팩 전부 공개"는 되돌릴 수 없으니
                  작은 글씨로 따로 둔다 — 큰 버튼과 나란히 두면 잘못 누른다. */}
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => flipMany(boxQueue.groups[boxQueue.idx].map((c) => c.i))}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600"
                >
                  한번에 공개
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (boxQueue.idx >= boxQueue.groups.length - 1) {
                      flipAll();
                      setBoxQueue(null);
                    } else {
                      setBoxQueue({ ...boxQueue, idx: boxQueue.idx + 1 });
                    }
                  }}
                  className="rounded-lg bg-black px-5 py-2 text-sm font-bold text-white"
                >
                  {boxQueue.idx >= boxQueue.groups.length - 1
                    ? '결과 정리'
                    : `다음 팩 (${boxQueue.idx + 2}/${boxQueue.groups.length})`}
                </button>
              </div>
              <div className="mt-2 text-center">
                {boxQueue.idx < boxQueue.groups.length - 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      flipAll();
                      setBoxQueue(null);
                    }}
                    className="text-xs text-neutral-400 underline"
                  >
                    남은 팩 전부 공개
                  </button>
                )}
              </div>
              {(() => {
                // ⚠️ 반드시 "뒤집은 카드"만 센다. 예전엔 지금 열고 있는 팩까지 통째로
                //    넣어서, 아직 안 뒤집었는데 여기에 상위 카드가 미리 떴다 — 스포일러다
                //    (사용자 지적 2026-08-04).
                // "상위 카드" 기준 = 후광과 같은 시세 기준 **또는** 높은 등급.
                // 시세만 보면 아직 시세를 못 받은 세트가 통째로 비고, 등급만 보면
                // 값은 비싼데 등급이 낮은 카드가 빠진다 — 실제로 시세 $1 이상 2,103장 중
                // 471장(22%)이 등급이 낮아 빠지고 있었다(사용자 지적 2026-08-04).
                const tops = boxQueue.groups
                  .slice(0, boxQueue.idx + 1)
                  .flat()
                  .filter(
                    (c) => flippedSet.has(c.i) && (glowOf(c.usd) > 0 || rankOf(c.r) >= 5 || c.m === 'master'),
                  );
                if (!tops.length) return null;
                return (
                  <div className="mx-auto mt-4 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-2">
                    <p className="text-center text-xs font-semibold text-amber-700">지금까지 나온 상위 카드</p>
                    <div className="mt-1 flex flex-wrap justify-center gap-1">
                      {tops.map((c) => (
                        <img key={c.i} src={thumb(c.img ?? '', 80)} alt="" className="h-14 rounded ring-1 ring-amber-200" />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* 개봉: 카드를 전부 뒷면으로 깔아 두고 아무거나 눌러 뒤집는다.
              예전엔 큰 카드 하나를 "위로 밀어서" 열고 다시 "눌러서 다음"으로 넘겨야 해서
              5장에 열 번을 조작해야 했다. 게다가 박스는 5장씩 자동으로 넘어가 팩과 손놀림이
              달랐다 — 이제 둘 다 같다(사용자 지시 2026-08-04). 그리드는 아래에 있다. */}

          {/* ⚠️ 결과 머리띠에 노란 상자를 쓰지 않는다. 이 화면엔 이미 남색·검정 버튼,
              카드별 등급색, 값나가는 카드의 후광이 있어서 상자까지 색을 쓰면 정작
              후광이 묻힌다(사용자 지적 2026-08-04). 위와 선으로만 나눈다. */}
          {allDone && (
            <div className="mt-3 flex flex-col gap-3 border-t border-neutral-200 pt-3 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="min-w-0">
                {/* 박스 안내를 여기 넣어 정보 상자 두 개가 연달아 붙는 걸 없앤다. */}
                {boxInfo && <p className="text-[11px] text-neutral-400">{boxLine(boxInfo, pack!.length, cfg.jp)}</p>}
                <p className="text-sm font-semibold text-neutral-700">
                  {keptDone ? '이 팩의 결과입니다' : <>앨범에 넣을 카드를 고르세요 <span className="text-neutral-500">({keep.size}장 선택됨)</span></>}
                </p>
              </div>
              {!keptDone && (
                <div className="flex gap-3">
                  <button type="button" onClick={() => setKeep(new Set(pack!.map((c) => c.i)))} className="text-xs text-neutral-500 underline">
                    전부 선택
                  </button>
                  <button type="button" onClick={() => setKeep(new Set())} className="text-xs text-neutral-500 underline">
                    전부 해제
                  </button>
                </div>
              )}
              {/* 폰에서 두 버튼이 세로로 쌓여 화면을 많이 먹었다 → 나란히 둔다
                  (사용자 지적 2026-08-04). */}
              <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                disabled={busy || share.shared}
                className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40 sm:flex-none"
              >
                {share.shared ? '자랑 완료' : sim?.canShareBonus ? `자랑하기 +${gp(SHARE_BONUS)}` : '자랑하기'}
              </button>
              <button
                type="button"
                onClick={keepCards}
                disabled={busy || keptDone}
                className="flex-1 rounded-lg bg-black px-3 py-2 text-sm font-bold text-white disabled:opacity-40 sm:flex-none"
              >
                {keptDone
                  ? keptCount
                    ? `${keptCount}장 넣었습니다`
                    : '넘겼습니다'
                  : keep.size
                    ? `${keep.size}장 담기`
                    : '넘기기'}
              </button>
              </div>
              {keepFullMsg && <p className="mt-2 text-xs font-semibold text-rose-600">{keepFullMsg}</p>}
            </div>
          )}
          {shareOpen && !share.shared && (
            <div className="mt-3 rounded-xl border border-neutral-200 p-3">
              <p className="text-xs text-neutral-500">
                개봉 결과 카드 이미지가 글에 함께 올라갑니다. 하고 싶은 말을 적고 등록해 주세요.
                {sim?.canShareBonus ? ` 오늘 첫 자랑에는 ${gp(SHARE_BONUS)}를 드립니다.` : ''}
              </p>
              <input
                type="text"
                value={shareTitle}
                onChange={(e) => setShareTitle(e.target.value)}
                maxLength={80}
                placeholder="제목 (비우면 자동으로 지어 드립니다)"
                className="mt-2 w-full rounded-lg border border-neutral-300 p-2 text-sm"
              />
              <textarea
                value={shareText}
                onChange={(e) => setShareText(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="예: 오늘 운이 좋았습니다!"
                className="mt-2 w-full rounded-lg border border-neutral-300 p-2 text-sm"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={shareToCommunity}
                  disabled={busy}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  커뮤니티에 등록
                </button>
                <button
                  type="button"
                  onClick={() => setShareOpen(false)}
                  className="text-xs text-neutral-400 underline"
                >
                  취소
                </button>
              </div>
            </div>
          )}
          {share.msg && (
            <p className={`mt-2 text-sm font-semibold ${share.shared ? 'text-indigo-600' : 'text-rose-600'}`}>
              {share.msg}
            </p>
          )}

          {/* 개봉 중: 전부 뒷면으로 깔아 두고 아무거나 눌러 뒤집는다.
              실물 팩처럼 한 줄에 5장씩, 가운데 정렬(10장이면 5+5 두 줄). */}
          {pack && !boxQueue && !allDone && (
            <>
              <p className="mt-4 text-center text-sm font-semibold text-neutral-600">
                카드를 눌러서 뒤집어 보세요 ({revealed}/{pack.length})
              </p>
              <div
                className="pack-grid mx-auto mt-2 grid w-full gap-2 sm:gap-3"
                style={{ ["--cols" as string]: packCols(pack.length), maxWidth: packWidth(pack.length) }}
              >
                {pack.map((c, i) => (
                  // ⚠️ 키는 배열 순서(i)가 아니라 카드 자리 번호(c.i)다. 팩은 등급순으로
                  //    정렬돼 나오므로 둘이 다르고, 섞어 쓰면 엉뚱한 카드가 뒤집힌다.
                  //    앨범 골라 담기도 같은 c.i를 쓴다.
                  <CardSlot
                    key={c.i}
                    card={c}
                    jp={cfg.jp}
                    index={i}
                    flipped={flippedSet.has(c.i)}
                    canFlip
                    onFlip={() => flipOne(c.i)}
                    name={koName(cfg.jp, c.name)}
                    showTier
                    price={c.usd && rates ? formatKrwApprox(c.usd * rates.usdToKrw) : undefined}
                  />
                ))}
              </div>
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={flipAll}
                  className="rounded-lg border border-neutral-300 px-5 py-2 text-sm font-semibold text-neutral-600"
                >
                  한번에 공개
                </button>
              </div>
            </>
          )}

          {/* 결과 정리 — 한 격자에 다 편다.
              ⚠️ 예전엔 등급별로 묶고, 묶음마다 머리글·"이 등급 전부 선택"·접기 버튼을
                 달았다. 팩 하나에 묶음이 4~5개라 카드보다 글자와 버튼이 더 많았고,
                 운영자가 "난잡하다"고 지적했다(2026-08-05). 지금은 값 높은 순으로
                 한 줄에 늘어놓고, 카드마다 등급·이름·값을 적는다. 고르는 것도 여기서 한다.
              ⚠️ 정렬은 **값 높은 순**이다. 등급순으로 두면 값이 등급을 안 따라가는 카드
                 (같은 SAR인데 10배 차이)가 아래로 묻힌다. 값을 모르는 카드는 등급순으로
                 뒤에 붙인다. */}
          {pack && !boxQueue && allDone && (
            <>
              {(() => {
                const 칸 = (c: UiCard, i: number) => (
                  <CardSlot
                    key={c.i}
                    card={c}
                    jp={cfg.jp}
                    index={i}
                    flipped
                    canFlip={false}
                    onFlip={() => undefined}
                    name={koName(cfg.jp, c.name)}
                    showTier
                    eager={false}
                    price={c.usd && rates ? formatKrwApprox(c.usd * rates.usdToKrw) : undefined}
                    picking={!keptDone}
                    picked={keep.has(c.i)}
                    onPick={() =>
                      setKeep((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.i)) next.delete(c.i);
                        else next.add(c.i);
                        return next;
                      })
                    }
                  />
                );
                return (
                  <>
                    {/* ⚠️ 팩(10장 이하)은 개봉 중 화면과 **같은 크기**로 맞춘다. 8칸 격자에
                        5장을 넣으면 방금 크게 보던 카드가 결과에서 갑자기 작아진다
                        (운영자 지적 2026-08-05). 박스는 장수가 많아 8칸 그대로 둔다. */}
                    {앞줄.length <= 10 ? (
                      <div
                        className="pack-grid mx-auto mt-4 grid w-full gap-2 sm:gap-3"
                        style={{ ["--cols" as string]: packCols(앞줄.length), maxWidth: packWidth(앞줄.length) }}
                      >
                        {앞줄.map(칸)}
                      </div>
                    ) : (
                      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">{앞줄.map(칸)}</div>
                    )}
                    {뒷줄.length > 0 && (
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() => setRestOpen((v) => !v)}
                          className="flex w-full items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5 text-left hover:bg-neutral-50"
                        >
                          <span className="text-sm font-semibold text-neutral-700">
                            나머지 {뒷줄.length}장
                            {뒷줄값 > 0 && rates && (
                              <span className="ml-1.5 font-normal text-neutral-400">
                                합계 {formatKrwApprox(뒷줄값 * rates.usdToKrw)}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-neutral-500">
                            {restOpen ? '접기' : '펼치기'}
                          </span>
                        </button>
                        {restOpen && (
                          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                            {뒷줄.map(칸)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </>
      )}

      {tab === 'album' && (
        <div className="mt-4">
          {!sim?.album.length ? (
            <p className="text-sm text-neutral-400">아직 모은 카드가 없습니다.</p>
          ) : (
            (() => {
              // 예상 가치 밑에 붙는 각주.
              // ⚠️ 예전엔 "예상 가치는 … 참고용 추정치입니다"로 길게 적고, 큰 화면에서는
              //    요약 숫자와 드롭다운 사이 빈자리에 끼워 넣었다. 그 자리에서는 무엇에
              //    대한 말인지 알 수 없고 두 줄로 접혀 상자가 어수선했다(운영자 지적
              //    2026-08-06). 이제 값 바로 밑에 붙이므로 "예상 가치는"을 뺀다 —
              //    무엇에 대한 말인지는 자리가 말해 준다.
              const albumNote =
                'TCGplayer 마켓가 기준 추정' +
                (value && value.totalUsd > 0 ? ` · $${value.totalUsd.toLocaleString()}` : '') +
                (value && value.priced < sim.album.length
                  ? ` · 시세 없는 ${sim.album.length - value.priced}종 제외`
                  : '') +
                (rates ? ` · ${rates.date} 환율` : '');
              return (
            <>
              {/* ⚠️ 앨범 전용 상자를 없앴다(운영자 지시 2026-08-06 — "진짜 별로야").
                  위 현황판과 똑같이 생긴 네모가 하나 더 쌓여 "보유 GP"가 두 번 나오고,
                  숫자·조작·각주가 한 상자에 뒤엉켜 있었다. 모은 카드·예상 가치는 위
                  현황판의 연속 출석·개봉한 팩 자리로 옮겼고, 여기는 조작 줄만 남긴다.
                  테두리 없는 맨 줄이라 상자 하나만큼 화면이 짧아진다.
                  ⚠️ 등급·정렬은 둘 다 드롭다운으로 둔다. 칩으로 펴면 누를 것이 13개가 되고
                     조작이 폰 화면의 41%를 먹는다(실측 2026-08-04, 한 번 해보고 되돌림). */}
              <div className="mb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={albumFilter}
                    onChange={(e) => setAlbumFilter(e.target.value)}
                    aria-label="등급 고르기"
                    className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 sm:w-44 sm:flex-none"
                  >
                    <option value="all">전체 등급</option>
                    {[...new Set(sim.album.map((a) => a.r))]
                      .sort((a, b) => rankOf(b) - rankOf(a))
                      .map((v) => (
                        <option key={v} value={v}>
                          {chipLabel(v)}
                        </option>
                      ))}
                  </select>
                  <select
                    value={albumSort}
                    onChange={(e) => setAlbumSort(e.target.value as typeof albumSort)}
                    aria-label="정렬 고르기"
                    className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 sm:w-40 sm:flex-none"
                  >
                    <option value="rarity">등급 높은순</option>
                    <option value="rarityAsc">등급 낮은순</option>
                    <option value="price">가격 높은순</option>
                    <option value="priceAsc">가격 낮은순</option>
                    <option value="recent">최근 획득순</option>
                  </select>
                  <div className="ml-auto flex items-center gap-2">
                    {!delMode ? (
                      <button
                        type="button"
                        onClick={() => setDelMode(true)}
                        className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600"
                      >
                        선택 삭제
                      </button>
                    ) : (
                      <>
                        <span className="text-xs text-neutral-500">카드를 눌러 고르세요 ({delPick.size}종)</span>
                        <button
                          type="button"
                          onClick={() => setDelPick(new Set(sim.album.map((a) => `${a.s}|${a.n}|${a.m ?? ''}`)))}
                          className="text-xs text-neutral-500 underline"
                        >
                          전체 선택
                        </button>
                        <button
                          type="button"
                          onClick={() => setDelPick(new Set())}
                          className="text-xs text-neutral-500 underline"
                        >
                          전체 해제
                        </button>
                        <button
                          type="button"
                          onClick={removeSelected}
                          disabled={busy || delPick.size === 0}
                          className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
                        >
                          {delPick.size}종 삭제
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDelMode(false);
                            setDelPick(new Set());
                          }}
                          className="text-xs text-neutral-400 underline"
                        >
                          취소
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {/* 위 현황판의 "예상 가치"가 어디서 온 값인지 밝힌다. 조작 줄 아래에
                    옅게 두어, 눈이 카드로 가는 길을 막지 않게 한다. */}
                <p className="mt-2 text-[11px] leading-snug text-neutral-400">{albumNote}</p>
                {!!value?.pending?.length && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-600">
                    세트 {value.pending.length}개의 시세를 준비하고 있습니다. 잠시 뒤 자동으로 채워집니다.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
                {[...sim.album]
                  .filter((a) => albumFilter === 'all' || a.r === albumFilter)
                  .sort((a, b) => {
                    if (albumSort === 'price') return usdOf(b) - usdOf(a);
                    if (albumSort === 'priceAsc') return usdOf(a) - usdOf(b);
                    if (albumSort === 'recent') return sim.album.indexOf(b) - sim.album.indexOf(a);
                    if (albumSort === 'rarityAsc') return rankOf(a.r) - rankOf(b.r);
                    return rankOf(b.r) - rankOf(a.r);
                  })
                  .map((a) => {
                    const cfgA = packBySlug.get(a.s);
                    const card = setCards[a.s]?.find((c) => c.n === a.n);
                    // 세트 목록에서 빠진 팩(진열에서 뺀 세트)의 카드는 이름·이미지를 못 찾는다.
                    // 그때 빈 칸으로 두면 뭘 모았는지도 알 수 없으니 번호라도 보여준다.
                    // (아직 불러오는 중이면 잠깐 비워 둔다 — 번호가 깜빡이면 지저분하다.)
                    const name = card ? koName(!!cfgA?.jp, card.name) : cfgA ? '' : `#${a.n}`;
                    const meta = RARITY[a.r] ?? RARITY.Common;
                    const dk = `${a.s}|${a.n}|${a.m ?? ''}`;
                    const picked = delPick.has(dk);
                    return (
                      <div
                        key={`${a.s}-${a.n}-${a.m ?? ''}`}
                        onClick={
                          delMode
                            ? () =>
                                setDelPick((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(dk)) next.delete(dk);
                                  else next.add(dk);
                                  return next;
                                })
                            : undefined
                        }
                        role={delMode ? 'button' : undefined}
                        className={delMode ? 'cursor-pointer' : undefined}
                      >
                        <div
                          className={`overflow-hidden rounded-lg bg-neutral-100 ring-1 ${meta.cls} ${
                            delMode && picked ? 'outline outline-[3px] outline-rose-500' : ''
                          }`}
                        >
                          {card?.img && (
                            <img src={thumb(card.img, 240)} alt="" loading="lazy" className="w-full object-contain" />
                          )}
                        </div>
                        <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-700">
                          {name} {a.c > 1 && <span className="text-neutral-400">×{a.c}</span>}
                        </p>
                        <p className={`text-[10px] font-bold ${meta.cls.split(' ')[0]}`}>
                          {rarityKo(a.r, !!cfgA?.jp)}
                          {a.g ? <span className="ml-1 text-amber-600">갓팩</span> : null}
                        </p>
                        {a.m && <p className={`text-[10px] ${M_LABEL[a.m].cls}`}>{M_LABEL[a.m].t}</p>}
                        {usdOf(a) > 0 && (
                          <p className="text-[10px] font-semibold text-emerald-700">
                            {rates ? formatKrwApprox(usdOf(a) * rates.usdToKrw) : `$${usdOf(a)}`}
                            {a.c > 1 ? ` ×${a.c}` : ''}
                          </p>
                        )}
                        {delMode ? (
                          <p className={`mt-0.5 text-[10px] font-bold ${picked ? 'text-rose-600' : 'text-neutral-300'}`}>
                            {picked ? '✓ 삭제 선택됨' : '누르면 선택'}
                          </p>
                        ) : (
                          onPickCard &&
                          card && (
                            <button
                              type="button"
                              onClick={() => onPickCard(pickTarget(a.s, a.n, card.name))}
                              className="mt-0.5 text-[10px] text-neutral-500 underline"
                            >
                              시세 보기
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
              </div>
            </>
              );
            })()
          )}
        </div>
      )}

      {tab === 'stash' && (
        <div className="mt-4">
          {Object.values(sim?.packs ?? {}).reduce((a, b) => a + b, 0) + Object.values(sim?.boxes ?? {}).reduce((a, b) => a + b, 0) ===
          0 ? (
            <p className="text-sm text-neutral-400">보관 중인 팩·박스가 없습니다.</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-neutral-400">
                진열이 바뀌어도 열 수 있습니다. (팩 {MAX_STASH}개 · 박스 {MAX_BOX_STASH}개까지)
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {Object.entries(sim?.boxes ?? {}).map(([s3, cnt]) => {
                  const p3 = packBySlug.get(s3);
                  if (!p3 || cnt < 1) return null;
                  const img3 = art[s3]?.boxImg || art[s3]?.logo;
                  return (
                    <div key={`box-${s3}`} className="rounded-2xl border border-neutral-200 p-3 text-center shadow-sm">
                      <div className="flex h-28 items-end justify-center rounded-xl bg-gradient-to-b from-neutral-50 to-neutral-100 px-2 pb-2 pt-3">
                        {img3 && <img src={thumb(img3, 240)} alt="" className="max-h-24 object-contain" />}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-neutral-800">
                        {p3.label.replace(/^\[.+?\]\s*/, '')} <span className="text-xs text-neutral-500">박스({p3.boxPacks}팩)</span>{' '}
                        <span className="text-neutral-400">×{cnt}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => void openBox(s3, 'stash')}
                        disabled={busy}
                        className={`mt-2 w-full rounded-lg py-2 text-sm font-bold disabled:opacity-40 ${
                          mustDecide ? 'bg-neutral-200 text-neutral-600' : 'bg-black text-white'
                        }`}
                      >
                        {/* ⚠️ 막혔을 때도 눌리게 둔다. 못 누르게 하면 open() 안의 안내
                            ("먼저 앨범에 넣을지 정해 주세요")가 영영 안 뜨고, 사용자는
                            왜 막혔는지 모른 채 멈춘다(2026-08-04 실제로 겪음). */}
                        {mustDecide ? '지난 카드 정리 먼저 →' : '박스 개봉'}
                      </button>
                    </div>
                  );
                })}
                {Object.entries(sim?.packs ?? {}).map(([s3, cnt]) => {
                  const p3 = packBySlug.get(s3);
                  if (!p3 || cnt < 1) return null;
                  const img3 = art[s3]?.boxImg || art[s3]?.logo;
                  return (
                    <div key={s3} className="rounded-2xl border border-neutral-200 p-3 text-center shadow-sm">
                      <div className="flex h-28 items-end justify-center rounded-xl bg-gradient-to-b from-neutral-50 to-neutral-100 px-2 pb-2 pt-3">
                        {img3 && <img src={thumb(img3, 240)} alt="" className="max-h-24 object-contain" />}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-neutral-800">
                        {p3.label.replace(/^\[.+?\]\s*/, '')} <span className="text-neutral-400">×{cnt}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => void open(s3, 'stash')}
                        disabled={busy}
                        className={`mt-2 w-full rounded-lg py-2 text-sm font-bold disabled:opacity-40 ${
                          mustDecide ? 'bg-neutral-200 text-neutral-600' : 'bg-black text-white'
                        }`}
                      >
                        {/* ⚠️ 막혔을 때도 눌리게 둔다. 못 누르게 하면 open() 안의 안내
                            ("먼저 앨범에 넣을지 정해 주세요")가 영영 안 뜨고, 사용자는
                            왜 막혔는지 모른 채 멈춘다(2026-08-04 실제로 겪음). */}
                        {mustDecide ? '지난 카드 정리 먼저 →' : '팩 개봉'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* 구매 알림은 화면 아래 고정 띠로 띄운다.
          ⚠️ 예전엔 목록 맨 위에 뗬는데, 버튼은 한참 아래에 있다. 폰에서 세 번째 세트까지
             내려가서 사면 알림이 화면 밖이라 "산 게 맞나?" 싶었다(사용자 지적 2026-08-04).
             아래 고정이면 어디까지 스크롤했든 보인다. */}
      {buyMsg && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-lg items-center gap-2 rounded-xl bg-neutral-900 p-3 shadow-lg">
            <p className="min-w-0 flex-1 text-sm font-bold text-white">{buyMsg}</p>
            <button
              type="button"
              onClick={() => {
                setBuyMsg('');
                setTab('stash');
                // 탭만 옮기고 끝내지 않는다 — 거기서 "팩 개봉"을 또 눌러야 했다.
                if (justBought) {
                  const { slug: s4, kind } = justBought;
                  setJustBought(null);
                  void (kind === 'box' ? openBox(s4, 'stash') : open(s4, 'stash'));
                }
              }}
              className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-bold text-black"
            >
              바로 열기
            </button>
            <button
              type="button"
              onClick={() => setBuyMsg('')}
              aria-label="닫기"
              className="shrink-0 px-1 text-lg leading-none text-neutral-400"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {tab === 'rates' && (
        <div className="mt-4 text-sm">
          <p className="text-xs text-neutral-500">
            팩 하나에서 그 등급이 나올 확률입니다. 공식 발표가 아니라 커뮤니티 실측 추정치라 실제와 다를 수
            있습니다.
          </p>

          {profileGroups.map((g) => (
            <div key={g.name} className="mt-5">
              <h3 className="text-sm font-bold text-black">{g.name}</h3>
              <p className="mt-0.5 text-[11px] text-neutral-400">{g.packs.join(' · ')}</p>
              <table className="mt-2 w-full text-left">
                <thead className="text-xs text-neutral-400">
                  <tr>
                    <th className="py-1">등급</th>
                    <th className="py-1">팩당 확률</th>
                    <th className="py-1">대략</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rates.map((r) => (
                    <tr key={r.ko} className="border-t border-neutral-100">
                      <td className="py-1.5 font-semibold">{r.ko}</td>
                      <td className="py-1.5">{r.pct.toFixed(2)}%</td>
                      <td className="py-1.5 text-neutral-500">{r.per}팩에 1장</td>
                    </tr>
                  ))}
                  {g.godRate > 0 && (
                    <tr className="border-t border-neutral-100">
                      <td className="py-1.5 font-semibold text-amber-600">갓팩</td>
                      <td className="py-1.5">{(g.godRate * 100).toFixed(2)}%</td>
                      <td className="py-1.5 text-neutral-500">{Math.round(1 / g.godRate)}팩에 1번</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-700">갓팩</p>
            <p className="mt-1 text-xs text-neutral-600">
              실물과 같게 151류 강화 확장팩에 있습니다 — 일본판 151은 750팩에 1번, 영문판
              특별세트(Prismatic·151)는 1,000팩에 1번. 걸리면 팩 전체가 아트레어(AR) 이상으로
              나옵니다. 일반 확장팩에는 갓팩이 없습니다.
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-sm font-bold text-neutral-800">박스로 열면</p>
            <p className="mt-1 text-xs text-neutral-600">
              일본판 박스는 실물과 같은 보장 봉입이 있습니다 — <b>SR 이상 1장 · AR 3장 · RR 4~5장</b>
              (151은 마스터볼 미러 1장 추가)이 반드시 들어가고, 나머지 팩은
              커먼·언커먼·레어로 채웁니다. 보장이 있어도 박스 한 개의 기대값은 위 표와 같습니다.
              낱팩은 팩마다 위 표의 확률을 따로 굴립니다. 영문판 박스는 실물처럼 보장이 없어
              순수 확률입니다.
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
            <p className="text-sm font-bold text-yellow-700">메가 울트라레어 (MUR)</p>
            <p className="mt-1 text-xs text-neutral-600">
              메가 시리즈 전용 최상위 등급입니다. 카드 전체가 금색이고, 일본판은 MUR(세트당
              1종·약 3,000팩 = 박스 100개에 1장꼴), 영문판은 MHR(세트당 2종)로 부릅니다. 메가
              시리즈에는 일반 금색 UR 대신 이 등급이 들어갑니다.
            </p>
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            표에 없는 자리는 커먼·언커먼·레어로 채웁니다. ACE SPEC은 수록된 세트에서만 나오고, 미수록
            세트는 그 확률만큼 레어가 나옵니다. GP는 출석하면 하루 {gp(DAILY_BUDGET)}, 다음 날로
            이월되고 최대 {gp(MAX_BALANCE)}까지 쌓입니다. {STREAK_DAYS}일 연속 출석하면 {gp(STREAK_BONUS)}를 더
            드립니다.
          </p>
        </div>
      )}

      <style>{`
        .flip { position: relative; aspect-ratio: 5 / 7; border-radius: 0.6rem; perspective: 900px; }
        .flip-next { cursor: pointer; animation: nextPulse 1.2s ease-in-out infinite; }
        .flip-inner {
          position: absolute; inset: 0; transform-style: preserve-3d;
          transition: transform 0.34s cubic-bezier(0.2, 0.7, 0.2, 1);
        }
        .flip-inner[data-flipped="true"] { transform: rotateY(180deg); }
        .flip-face {
          position: absolute; inset: 0; border-radius: 0.5rem;
          backface-visibility: hidden; -webkit-backface-visibility: hidden;
        }
        .flip-front { transform: rotateY(180deg); }
        .card-hit { box-shadow: 0 0 14px 2px rgba(245, 158, 11, 0.65); border-radius: 0.5rem; }

        /* 값나가는 카드일수록 세게 빛난다(시세 기준 — glowOf 참고).
           ⚠️ 뒤집힌 뒤에만 붙는다. 뒷면에 붙으면 뒤집기 전에 값을 알아채 재미가 없다. */
        .glow-soft { box-shadow: 0 0 10px 1px rgba(56, 189, 248, 0.55); border-radius: 0.5rem; }
        .glow-mid  { box-shadow: 0 0 16px 3px rgba(168, 85, 247, 0.65); border-radius: 0.5rem; animation: glowPulse 1.8s ease-in-out infinite; }
        .glow-big  { box-shadow: 0 0 22px 5px rgba(245, 158, 11, 0.85); border-radius: 0.5rem; animation: glowPulse 1.1s ease-in-out infinite; }
        @keyframes glowPulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.12); }
        }
        @media (prefers-reduced-motion: reduce) {
          .glow-mid, .glow-big { animation: none; }
        }
        /* 카드 격자: 폰은 5칸 고정, 큰 화면은 장수대로(--cols). 위 packCols 설명 참고. */
        .pack-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        @media (min-width: 640px) {
          .pack-grid { grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); }
        }
        .card-picked { outline: 3px solid #059669; outline-offset: 2px; border-radius: 0.6rem; cursor: pointer; }
        /* ⚠️ 값나가는 카드는 초록 테두리를 **안쪽**에 그린다. 바깥에 그리면 그 자리가
           바로 후광이 퍼지는 자리라, 제일 좋은 카드일수록 후광이 초록 선에 덮인다
           (운영자 지적 2026-08-05 — 박스에서 좋은 카드는 기본으로 담기게 돼 있어서
           정작 빛나야 할 카드가 전부 가려졌다). 안쪽에 그리면 둘 다 보인다. */
        .card-picked-hit { outline: 3px solid #059669; outline-offset: -3px; border-radius: 0.6rem; cursor: pointer; }
        /* 팩을 열면 카드가 한 장씩 깔린다 */
        .deal { animation: dealIn 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
        @keyframes dealIn {
          from { opacity: 0; transform: translateY(16px) scale(0.92); }
          to { opacity: 1; transform: none; }
        }
        /* 덮개 아래가 좋은 등급이면 뒷면이 은은하게 빛난다("이거 좋은 카드인가?").
           ACE·AR·UR은 약하게, SAR 이상은 더 세고 빠르게 — 빛의 세기가 곧 기대치다. */
        .hint-soft { animation: hintSoft 1.7s ease-in-out infinite; }
        @keyframes hintSoft {
          0%, 100% { box-shadow: 0 0 6px 1px rgba(245, 158, 11, 0.18); }
          50% { box-shadow: 0 0 18px 4px rgba(245, 158, 11, 0.5); }
        }
        .hint-strong { animation: hintStrong 1s ease-in-out infinite; }
        @keyframes hintStrong {
          0%, 100% { box-shadow: 0 0 10px 2px rgba(245, 158, 11, 0.45); }
          50% { box-shadow: 0 0 30px 9px rgba(245, 158, 11, 0.9); }
        }
        /* AR 이상을 뒤집으면 빛이 한 번 쓸고 지나간다 */
        .card-shine { position: relative; }
        .card-shine::after {
          content: '';
          position: absolute; inset: -40%;
          background: linear-gradient(115deg, transparent 42%, rgba(255, 255, 255, 0.7) 50%, transparent 58%);
          transform: translateX(-130%);
          animation: shineSweep 0.9s 0.3s ease-out forwards;
        }
        @keyframes shineSweep { to { transform: translateX(130%); } }
        @keyframes nextPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55); }
          70% { box-shadow: 0 0 0 7px rgba(245, 158, 11, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .flip-inner { transition: none; }
          .flip-next, .hint-soft, .hint-strong, .deal { animation: none; }
          .card-shine::after { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function CardSlot({
  card,
  jp,
  index,
  flipped,
  canFlip,
  onFlip,
  name,
  picking,
  picked,
  onPick,
  showTier,
  price,
  eager,
}: {
  card: PackCard & { usd?: number };
  jp: boolean;
  index: number;
  flipped: boolean;
  /** 지금 뒤집을 수 있는가. 예전엔 "다음 차례"만 됐는데, 이제 안 뒤집힌 건 아무거나 된다. */
  canFlip: boolean;
  onFlip: () => void;
  name: string;
  picking?: boolean;
  picked?: boolean;
  onPick?: () => void;
  /**
   * 카드 밑에 등급을 적을지. 등급 묶음 안에서는 바로 위 묶음 머리가 이미 같은 말을 해서
   * 카드마다 또 적으면 한 화면에 등급 이름이 12번 나온다(팩 10장 기준 실측).
   * 그래서 묶음 안에서는 끈다. 개봉 중(등급이 섞여 있음)에는 켠다.
   */
  showTier?: boolean;
  /** 카드 밑에 적을 값(원화). 시세를 아직 못 받은 카드는 안 준다. */
  price?: string;
  /**
   * 그림을 지금 당장 받을지. 개봉 중에는 true — 뒤집는 순간 바로 떠야 한다.
   * ⚠️ 결과 정리에서는 false로 준다. 박스는 결과가 150~360장이라, 전부 지금 받으면
   *    폰에서 화면이 한참 멈춘다(2026-08-05 점검에서 잡음 — 등급별 접기를 없애면서
   *    예전엔 접혀 있던 커먼까지 한꺼번에 받게 됐다).
   */
  eager?: boolean;
}) {
  const meta = RARITY[card.r ?? ''] ?? RARITY.Common;
  // 빛남은 "지금 시세"로 정한다.
  // 뒷면에도 힌트를 준다 — 어느 자리가 좋은지는 알려주되 뭔지는 안 알려주므로
  // 뒤집는 재미가 살아 있다. 이게 원래 있던 "쫄리는 맛"이다.
  const tier = glowOf(card.usd);
  const glow = flipped ? tier : 0;
  const hit = glow > 0;
  return (
    <div>
      <div
        style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
        className={`flip deal ${canFlip && !flipped ? `flip-next ${hintCls(tier)}` : ''} ${
          picking && picked ? (hit ? 'card-picked-hit' : 'card-picked') : ''
        }`}
        onClick={canFlip && !flipped ? onFlip : picking ? onPick : undefined}
        role={(canFlip && !flipped) || picking ? 'button' : undefined}
        aria-label={canFlip && !flipped ? '카드 뒤집기' : picking ? '앨범에 넣기 선택' : undefined}
      >
        <div className="flip-inner" data-flipped={flipped}>
          <div className="flip-face flip-back">
            <img src="/pack-card-back.svg" alt="" className="h-full w-full rounded-lg object-cover" />
          </div>
          <div className={`flip-face flip-front ${glowCls(glow)}`}>
            <div className={`relative h-full overflow-hidden rounded-lg bg-neutral-100 ring-1 ${meta.cls} ${hit ? 'card-shine' : ''}`}>
              {card.img && (
                // ⚠️ lazy를 쓰면 안 된다. 뒤집는 순간에야 받기 시작해서 회색 칸이 잠깐 보인다
                //    (사용자 지적 2026-08-04). 뒷면을 보는 동안 미리 받아 두면 바로 뜬다.
                //    한 번에 5~10장뿐이라 미리 받아도 부담이 없다.
                <img
                  src={thumb(card.img, 240)}
                  alt=""
                  {...(eager === false
                    ? { loading: 'lazy' as const, decoding: 'async' as const }
                    : { fetchPriority: 'high' as const })}
                  className="h-full w-full object-contain"
                />
              )}
              {/* 담김 표시. 카드 밖에 "✓ 담음/안 담음" 글자를 두면 카드마다 한 줄씩,
                  팩 10장이면 10줄이 늘어난다(실측 2026-08-04). 카드 안 배지로 옮겨
                  줄을 없애고, 담긴 것만 표시한다(안 담긴 건 아무 표시도 안 하는 게 조용하다). */}
              {picking && picked && (
                <span className="absolute left-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-600 text-[9px] font-black leading-none text-white">
                  ✓
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-700">{flipped ? name : ' '}</p>
      {/* ⚠️ 등급은 묶음 안에서 안 적는다(showTier=false). 바로 위 묶음 머리가 이미
          "언커먼 4장"이라고 했는데 카드마다 또 "언커먼"을 달면 한 화면에 등급 이름이
          12번 나온다(팩 10장 기준 실측 2026-08-04). 개봉 중에는 등급이 섞여 있어 켠다. */}
      {showTier && (
        <p className={`text-[10px] font-bold ${meta.cls.split(' ')[0]}`}>{flipped ? rarityKo(card.r, jp) : ' '}</p>
      )}
      {showTier && flipped && card.m && <p className={`text-[10px] ${M_LABEL[card.m].cls}`}>{M_LABEL[card.m].t}</p>}
      {/* 값은 아는 카드만 적는다. 시세를 아직 못 받은 세트도 있어서, 모르는 걸 "0원"
          이라고 적으면 "값이 없는 카드"로 읽힌다(틀린 것보다 빈칸). */}
      {price && flipped && <p className="text-[10px] font-bold text-neutral-800">{price}</p>}
    </div>
  );
}
