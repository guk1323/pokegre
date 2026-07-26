import { useCallback, useEffect, useRef, useState } from 'react';
import { trackEvent } from '../api/localStats';
import { fetchExchangeRates, formatKrwApprox, type ExchangeRates } from '../api/exchangeRate';
import { koreanizeEnglishCardName } from '../lib/koreanizeEnglishTitle';
import { koreanizeTitle } from '../lib/koreanizeTitle';
import { rankOf, type MirrorFlag, type PackCard } from '../lib/packDraw';

// 화면에서 다루는 카드: 서버 응답 순서(i)를 기억한다 — 앨범 골라담기가 인덱스 기준이라
// (미러와 일반판이 같은 번호일 수 있어 번호로는 구분이 안 된다).
type UiCard = PackCard & { i: number };
const M_LABEL: Record<MirrorFlag, { t: string; cls: string }> = {
  master: { t: '마스터볼 미러', cls: 'text-amber-600 font-bold' },
  poke: { t: '몬스터볼 미러', cls: 'text-neutral-500' },
  rev: { t: '리버스', cls: 'text-neutral-500' },
};
import {
  DAILY_BUDGET,
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
  last?: { slug: string; cards: { n: string; r?: string; m?: MirrorFlag }[]; god: boolean; shared?: boolean; kept?: boolean };
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

// ⚠️ 같은 카드라도 판마다 등급 이름이 다르다. 데이터 키(위 RARITY)는 북미판 이름을
// 쓰고 있으므로, 일본판은 아래 표로 바꿔 부른다:
//   풀아트 = 일본판 SR(슈퍼레어) / 북미판 UR  ·  금색 = 일본판 UR(울트라레어) / 북미판 HR
//   일러스트 = 일본판 AR·SAR / 북미판 IR·SIR
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
const hintOf = (r?: string) => {
  const k = rankOf(r);
  return k >= 7 ? 'hint-strong' : k >= 4 ? 'hint-soft' : '';
};

const groupKeyOf = (c: PackCard) => (c.m ? `m:${c.m}` : `r:${c.r ?? 'Common'}`);
const groupRank = (k: string) =>
  k === 'm:master' ? 8.5 : k === 'm:poke' ? 2.6 : k === 'm:rev' ? 2.5 : rankOf(k.slice(2));
const groupLabel = (k: string, jp: boolean) =>
  k.startsWith('m:') ? M_LABEL[k.slice(2) as MirrorFlag].t : rarityKo(k.slice(2), jp);

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
const LIVE_TODAY: PackSet[] = livePacks();
const PROFILE_GROUPS = [...new Set(LIVE_TODAY.map((p) => p.profile))].map((profile) => {
  const packs = LIVE_TODAY.filter((p) => p.profile === profile);
  const first = packs[0];
  const kind = first.jp
    ? profile === JP_MEGA
      ? '일본판 메가 시리즈 (5장)'
      : '일본판 확장팩 (5장)'
    : profile === NA_MEGA
      ? '북미판 메가 시리즈 (10장)'
      : profile === NA_PRISMATIC || profile === NA_151
        ? '북미판 특별세트 (10장)'
        : '북미판 일반 부스터 (10장)';
  return {
    name: `${kind} — ${packs.length}종`,
    packs: packs.map((p) => p.label.replace(/^\[.+?\]\s*/, '')),
    rates: ratesOf(first),
    godRate: first.godRate ?? 0,
  };
});

// "시세 보기"가 넘기는 목표. 앨범에 보여주는 값이 TCGplayer 마켓가이므로 눌렀을 때도
// TCGplayer 화면으로 간다(보여준 숫자와 다른 시장으로 보내면 헷갈린다). 검색어는
// "이름 번호"라 그 카드 한 장으로 좁혀진다(039처럼 0 붙은 그대로 — 39는 239에도 걸린다).
export type PickTarget = { query: string; source: 'snkrdunk' | 'ebay' | 'tcgplayer'; edition: 'japanese' | 'english' };

export function PackSim({
  onPickCard,
  onOpenSet,
}: {
  onPickCard?: (target: PickTarget) => void;
  // 진열 팩의 "수록 카드 보기" → 세트 목록 화면으로 이동.
  onOpenSet?: (slug: string) => void;
}) {
  const [tab, setTab] = useState<'open' | 'stash' | 'album' | 'rates'>('open');
  const [sim, setSim] = useState<SimState | null>(null);
  const [slug, setSlug] = useState(LIVE_TODAY[0].slug);
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
  // 방금 연 팩에서 앨범에 넣을 카드. 커먼까지 다 넣으면 앨범이 지저분해져서 골라 담는다.
  const [keep, setKeep] = useState<Set<number>>(new Set());
  // 구매 완료 알림. 구매 탭 맨 위에 눈에 띄게 띄우고 보관함으로 바로 갈 수 있게 한다
  // (작은 초록 글씨가 진열대 아래에 떠서 안 보인다는 피드백).
  const [buyMsg, setBuyMsg] = useState('');
  // 결과 정리에서 펼쳐 둔 등급 묶음(커먼류는 기본으로 접혀 있다).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // 앨범에 넣기와 자랑하기는 서로 독립 — 넣었다고 자랑 기회가 사라지면 안 된다.
  const [keptDone, setKeptDone] = useState(false);
  // 실제로 앨범에 넣은 장수(0이면 "넘김"). 버튼 문구를 결과에 맞게 쓰려고 따로 둔다.
  const [keptCount, setKeptCount] = useState<number | null>(null);
  // 지난번에 열어 두고 안 고른 결과를 되살렸을 때 띄우는 안내.
  const [restoredMsg, setRestoredMsg] = useState('');
  const [share, setShare] = useState<ShareState>({ shared: false, msg: '' });
  // 자랑 작성 폼(바로 올리지 않고 글을 쓴 뒤 직접 등록한다).
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [shareTitle, setShareTitle] = useState('');
  // 겹쳐 놓인 카드 개봉: 덮개를 위로 드래그하면 아래 카드가 슬쩍 보이다가, 충분히
  // 밀면 넘어간다("쫄리는 맛"). phase: covered=덮개 있음, leaving=덮개 날아가는 중,
  // shown=카드 공개(누르면 다음).
  const [phase, setPhase] = useState<'covered' | 'leaving' | 'shown'>('covered');
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  // 운영자는 점검하려고 아무 때나 열어야 해서 기본이 무제한이다. 끄면 평소처럼
  // GP가 깎이고 모자라면 못 연다(그 흐름도 확인해야 하니 스위치로 뒀다).
  const [spend, setSpend] = useState(false);

  const cfg = packBySlug.get(slug) ?? LIVE_TODAY[0];

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/local/auth/packsim', { credentials: 'include' });
      if (!r.ok) return setErr('로그인하면 출석 보상 GP로 팩을 열 수 있습니다.');
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
          i,
        }));
        const sorted = [...cards].sort((a, b) => rankOf(a.r) - rankOf(b.r));
        const size = cfg2.profile.commons + cfg2.profile.uncommons + cfg2.profile.slots.length;
        setSlug(last.slug);
        setPack(sorted);
        setRevealed(sorted.length); // 이미 본 결과라 정리 화면으로 바로 보낸다
        setBoxInfo(cards.length > size ? Math.round(cards.length / size) : null);
        setBoxQueue(null);
        setGod(last.god);
        setOpenGroups(new Set());
        setKeep(new Set(sorted.filter((c) => rankOf(c.r) >= 5 || c.m === 'master').map((c) => c.i)));
        setKeptDone(false);
        setKeptCount(null);
        setShare({ shared: !!last.shared, msg: '' });
        setRestoredMsg('지난번에 연 결과입니다. 앨범에 넣을지 고르지 않아 그대로 두었습니다.');
        setTab('stash');
      })
      .catch(() => undefined);
  }, [sim]);

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
      setBuyMsg(`${target.label.replace(/^\[.+?\]\s*/, '')} 1팩을 구매했습니다. ${gp(target.price)}이 차감되었습니다.`);
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
      setBuyMsg(`${target.label.replace(/^\[.+?\]\s*/, '')} 1박스(${target.boxPacks}팩)를 구매했습니다. ${gp(price)}이 차감되었습니다.`);
      trackEvent('packsim', `${target.label} 박스 구매`);
    } finally {
      setBusy(false);
    }
  }

  async function open(slug2: string, from?: 'stash') {
    if (!sim) return;
    setErr('');
    setBusy(true);
    setPack(null);
    setRevealed(0);
    setPhase('covered');
    setDragY(0);
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
      const d = (await r.json()) as { cards?: PackCard[]; god?: boolean; balance?: number; packs?: Record<string, number>; error?: string };
      if (!r.ok || !d.cards) {
        setErr(d.error === 'not enough' ? 'GP가 부족합니다.' : '팩을 열지 못했습니다.');
        return;
      }
      setSim((s2) => (s2 ? { ...s2, balance: d.balance ?? s2.balance, packs: d.packs ?? s2.packs } : s2));
      if (d.god) trackEvent('packsim_godpack', cfg.label);
      // 등급 낮은 카드가 앞, 제일 좋은 카드가 맨 뒤로 오게 정렬해 마지막 한 장에서 터지게 한다.
      const withI: UiCard[] = d.cards.map((c, i) => ({ ...c, i }));
      const sorted = [...withI].sort((a, b) => rankOf(a.r) - rankOf(b.r));
      setPack(sorted);
      setBoxInfo(null);
      setBoxQueue(null);
      // 아트레어(AR) 이상은 기본으로 담아둔다 — 대부분 남기고 싶어 하는 등급이다.
      setKeep(new Set(sorted.filter((c) => rankOf(c.r) >= 5).map((c) => c.i)));
      setOpenGroups(new Set());
      setKeptDone(false);
      setKeptCount(null);
      setRestoredMsg('');
      setShare({ shared: false, msg: '' });
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

  // 박스 개봉: 일본판은 보장 봉입, 북미판은 독립시행. 결과는 한 팩씩 넘겨 가며 공개한다.
  async function openBox(slug2: string, from?: 'stash') {
    const target = packBySlug.get(slug2);
    if (!sim || !target?.boxPacks) return;
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
      };
      if (!r.ok || !d.packs) {
        setErr(d.error === 'not enough' ? 'GP가 부족합니다.' : '박스를 열지 못했습니다.');
        return;
      }
      if (d.godCount) trackEvent('packsim_godpack', `${target.label} 박스`);
      // i는 서버가 기억하는 순서(팩 순서 그대로) — 앨범 골라 담기가 이 번호를 쓴다.
      // 팩 안에서만 등급 낮은 순으로 정렬해, 팩마다 마지막 장에서 터지게 한다.
      let k = 0;
      const groups: UiCard[][] = d.packs.map((p) =>
        p.cards.map((c) => ({ ...c, i: k++ })).sort((a, b) => rankOf(a.r) - rankOf(b.r)),
      );
      const sorted = groups.flat().sort((a, b) => rankOf(a.r) - rankOf(b.r));
      setPack(sorted);
      setRevealed(0);
      setBoxQueue({ groups, gods: d.packs.map((p) => p.god), idx: 0 });
      setBoxInfo(d.boxPacks ?? d.packs.length);
      setGod(!!d.god);
      setKeep(new Set(sorted.filter((c) => rankOf(c.r) >= 5 || c.m === 'master').map((c) => c.i)));
      setOpenGroups(new Set());
      setKeptDone(false);
      setKeptCount(null);
      setRestoredMsg('');
      setShare({ shared: false, msg: '' });
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
      const d = (await r.json()) as { kept?: number; album?: AlbumCard[] };
      if (d.album) setSim((s2) => (s2 ? { ...s2, album: d.album! } : s2));
      setKeptCount(d.kept ?? 0);
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
        setShare({ shared: false, msg: d.error === 'already shared' ? '이미 자랑한 팩입니다.' : '올리지 못했습니다.' });
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
  //   북미판: 원본 이름이 이미 영문이라 그대로 쓴다.
  //   일본판: 원본이 일본어라, 시세를 받을 때 함께 저장해 둔 영문 이름을 쓴다.
  //           (아직 못 받았으면 한글→영문 번역으로 최선을 다한다)
  const pickTarget = (slug2: string, n: string, rawName: string): PickTarget => {
    const jp = !!packBySlug.get(slug2)?.jp;
    const en = value?.names?.[slug2]?.[n.replace(/^0+/, '') || '0'];
    const name = en || (jp ? koName(true, rawName) : rawName);
    return { query: `${name} ${n}`, source: 'tcgplayer', edition: jp ? 'japanese' : 'english' };
  };

    const usdOf = (a: AlbumCard) => {
    const base = a.n.replace(/^0+/, '') || '0';
    const vk = a.m === 'master' ? '~m' : a.m === 'poke' ? '~p' : a.m === 'rev' ? '~r' : '';
    const map = value?.prices[a.s];
    return (vk ? map?.[base + vk] : undefined) ?? map?.[base] ?? 0;
  };
  const koName = (jp: boolean, name: string) =>
    !name ? '' : jp ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name);
  const revealNext = () => setRevealed((n) => (pack ? Math.min(n + 1, pack.length) : n));
  const allDone = !!pack && revealed >= pack.length;
  // 지금 덮개 아래에 있는 카드의 등급 힌트(뒷면을 빛나게 할지).
  const nextHint = pack && !allDone ? hintOf(pack[revealed]?.r) : '';

  // 결과 정리용 등급 묶음(좋은 등급이 위로).
  const resultGroups = (() => {
    if (!pack) return [] as { k: string; cards: UiCard[] }[];
    const by = new Map<string, UiCard[]>();
    for (const c of pack) {
      const k = groupKeyOf(c);
      const list = by.get(k);
      if (list) list.push(c);
      else by.set(k, [c]);
    }
    return [...by.entries()]
      .map(([k, cards]) => ({ k, cards }))
      .sort((a, b) => groupRank(b.k) - groupRank(a.k));
  })();

  return (
    <div>
      <h2 className="text-base font-bold text-black">
        카드 개봉
      </h2>

      {/* 현황판: 보유 GP·연속 출석·개봉한 팩을 나란히, 출석 버튼은 오른쪽.
          좁은 화면에서는 셋을 한 줄에 두고 버튼을 아래 줄 전체 폭으로 내린다 —
          한 줄에 다 넣으면 칸이 눌려 숫자가 겹쳐 보였다. */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-y-3">
          <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:max-w-md sm:flex-1">
            <div className="min-w-0">
              <p className="text-xs text-neutral-400">보유 GP</p>
              <p className="mt-0.5 truncate text-lg font-bold text-black sm:text-xl">{(sim?.balance ?? 0).toLocaleString()}</p>
            </div>
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
          </div>
          <button
            type="button"
            onClick={checkIn}
            disabled={busy || !sim?.canCheckIn}
            className="w-full rounded-lg bg-black px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40 sm:ml-auto sm:w-auto"
          >
            {sim?.canCheckIn ? `출석하고 ${gp(DAILY_BUDGET)} 받기` : '오늘 출석 완료'}
          </button>
        </div>
        {sim?.admin && (
          <label className="mt-3 flex items-center justify-end gap-1.5 text-xs text-neutral-400">
            <input type="checkbox" checked={spend} onChange={(e) => setSpend(e.target.checked)} />
            GP 차감 (끄면 운영자 무제한)
          </label>
        )}
      </div>
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
          {buyMsg && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-900 bg-neutral-900 p-3">
              <p className="text-sm font-bold text-white">{buyMsg}</p>
              <button
                type="button"
                onClick={() => {
                  setBuyMsg('');
                  setTab('stash');
                }}
                className="ml-auto rounded-lg bg-white px-4 py-1.5 text-sm font-bold text-black"
              >
                보관함에서 개봉하기 →
              </button>
              <button type="button" onClick={() => setBuyMsg('')} className="text-xs text-neutral-400 underline">
                닫기
              </button>
            </div>
          )}

          {/* 팩 진열장 — 사이트 기본 톤. 팩을 고르면 그 타일 안에 "열기" 버튼이 바로 나타난다
              (버튼이 멀리 떨어져 있으면 고르고 나서 시선이 한 번 더 이동해야 해 불편하다). */}
          {[
            { label: '일본판', dot: 'bg-rose-500', packs: LIVE_TODAY.filter((p) => p.jp) },
            { label: '북미판', dot: 'bg-blue-500', packs: LIVE_TODAY.filter((p) => !p.jp) },
          ].map((row) => (
            <div key={row.label} className="mt-5">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-neutral-600">
                <span className={`inline-block h-2 w-2 rounded-full ${row.dot}`} />
                {row.label}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                          {/* 낱팩·박스 모두 "GP 주고 사서 보관함에 담기"로 똑같으므로 버튼도 같은 크기·같은 모양이다 */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void buy(s2.slug);
                            }}
                            disabled={busy || !can}
                            className="w-full rounded-lg bg-black py-2 text-sm font-bold text-white disabled:opacity-40"
                          >
                            {busy ? '구매 중…' : can ? `1팩 구매 · ${gp(s2.price)} 차감` : 'GP가 부족합니다'}
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
                                  className="w-full rounded-lg bg-black py-2 text-sm font-bold text-white disabled:opacity-40"
                                >
                                  {busy
                                    ? '구매 중…'
                                    : canBox
                                      ? `1박스(${s2.boxPacks}팩) 구매 · ${gp(boxPrice)} 차감`
                                      : 'GP가 부족합니다'}
                                </button>
                              );
                            })()}
                          <p className="text-[11px] text-neutral-400">구매하면 보관함에 담기고, 개봉은 보관함에서 합니다.</p>
                        </div>
                      ) : (
                        <p className="mt-2 py-1.5">
                          <span className="inline-block rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-bold text-white">
                            {gp(s2.price)}
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
                          className="mt-1.5 w-full rounded-lg border border-neutral-300 py-1.5 text-xs font-semibold text-neutral-600"
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
          <p className="mt-3 text-xs text-neutral-400">매일 자정에 진열이 바뀝니다. (전체 22종)</p>

          <p className="mt-2 text-xs text-neutral-400">
            비공식 팬 시뮬레이션입니다. 실제 카드나 금전적 가치와는 아무 관계가 없고, GP는 pokegre 안에서만
            쓰이는 포인트로 현금 가치가 없습니다. 확률은 재미용 근사치라 실제 봉입률과 다릅니다.
          </p>
        </>
      )}

      {/* 개봉 연출·결과·앨범 담기·자랑 — 개봉은 보관함에서 하므로 보관함 탭에 그린다
          (구매 탭은 구매만). 아래 보관함 목록 위에 결과가 뜬다. */}
      {tab === 'stash' && !!pack && (
        <>
          {restoredMsg && (
            <p className="mt-3 rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm font-semibold text-neutral-700">
              {restoredMsg}
            </p>
          )}

          {boxInfo && pack && !boxQueue && (
            <p className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm font-semibold text-neutral-700">
              박스 개봉 결과 — {boxInfo}팩 · {pack.length}장{cfg.jp ? ' (박스 보장 봉입 적용)' : ' (북미판은 보장 없음)'}
            </p>
          )}
          {god && !boxQueue && (
            <div className="mt-4 animate-pulse rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 p-3 text-center text-base font-black text-black">
              갓팩 — 전부 AR 이상입니다
            </div>
          )}

          {/* 겹쳐 놓인 팩. 덮개를 위로 드래그하면 아래 카드가 조금씩 드러난다 —
              색·이름을 슬쩍 보다가 충분히 밀면 덮개가 날아가고 카드가 공개된다. */}
          {/* 박스: 한 팩씩 촤르륵 공개하고 "다음 팩"으로 넘긴다 */}
          {boxQueue && pack && (
            <div className="mt-6">
              <p className="text-center text-sm font-semibold text-neutral-600">
                팩 {boxQueue.idx + 1} / {boxQueue.groups.length}
              </p>
              {boxQueue.gods[boxQueue.idx] && (
                <div className="mx-auto mt-2 max-w-md animate-pulse rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 p-2 text-center text-sm font-black text-black">
                  갓팩 — 전부 AR 이상입니다
                </div>
              )}
              <div key={boxQueue.idx} className="mx-auto mt-3 grid max-w-2xl grid-cols-5 gap-2 sm:gap-3">
                {boxQueue.groups[boxQueue.idx].map((c, i2) => {
                  const meta = RARITY[c.r ?? ''] ?? RARITY.Common;
                  const hit = rankOf(c.r) >= 5 || c.m === 'master';
                  return (
                    <div key={c.i} className="deal" style={{ animationDelay: `${i2 * 90}ms` }}>
                      <div
                        className={`overflow-hidden rounded-lg bg-neutral-100 ring-1 ${meta.cls} ${hit ? 'card-hit card-shine' : ''}`}
                        style={{ aspectRatio: '5 / 7' }}
                      >
                        {c.img && <img src={thumb(c.img, 240)} alt="" className="h-full w-full object-contain" />}
                      </div>
                      <p className={`mt-0.5 truncate text-center text-[10px] font-semibold ${meta.cls.split(' ')[0]}`}>
                        {rarityKo(c.r, cfg.jp).split(' ').pop()}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    if (boxQueue.idx >= boxQueue.groups.length - 1) {
                      setRevealed(pack.length);
                      setBoxQueue(null);
                    } else {
                      setBoxQueue({ ...boxQueue, idx: boxQueue.idx + 1 });
                    }
                  }}
                  className="rounded-lg bg-black px-5 py-2 text-sm font-bold text-white"
                >
                  {boxQueue.idx >= boxQueue.groups.length - 1
                    ? '결과 정리하기'
                    : `다음 팩 (${boxQueue.idx + 2}/${boxQueue.groups.length})`}
                </button>
                {boxQueue.idx < boxQueue.groups.length - 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setRevealed(pack.length);
                      setBoxQueue(null);
                    }}
                    className="text-xs text-neutral-400 underline"
                  >
                    남은 팩 전부 공개
                  </button>
                )}
              </div>
              {(() => {
                const tops = boxQueue.groups
                  .slice(0, boxQueue.idx + 1)
                  .flat()
                  .filter((c) => rankOf(c.r) >= 5 || c.m === 'master');
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

          {pack && !allDone && !boxQueue && (
            <div className="mt-6 select-none">
              <div className="relative mx-auto h-72 w-52 touch-none sm:h-80 sm:w-56">
                {pack.length - revealed > 2 && (
                  <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-xl border border-neutral-300 bg-neutral-200" />
                )}
                {pack.length - revealed > 1 && (
                  <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-xl border border-neutral-300 bg-neutral-100" />
                )}

                {/* 현재 카드(덮개 아래) */}
                <div
                  className={`absolute inset-0 ${phase === 'shown' ? 'cursor-pointer' : ''}`}
                  onClick={() => {
                    if (phase !== 'shown') return;
                    revealNext();
                    setPhase('covered');
                    setDragY(0);
                  }}
                  role={phase === 'shown' ? 'button' : undefined}
                  aria-label={phase === 'shown' ? '다음 카드' : undefined}
                >
                  <div
                    className={`h-full overflow-hidden rounded-xl bg-neutral-100 ring-1 ${(RARITY[pack[revealed]?.r ?? ''] ?? RARITY.Common).cls} ${
                      phase === 'shown' && rankOf(pack[revealed]?.r) >= 5 ? 'card-hit card-shine' : ''
                    }`}
                  >
                    {pack[revealed]?.img && (
                      <img src={thumb(pack[revealed].img!, 480)} alt="" draggable={false} className="h-full w-full object-contain" />
                    )}
                  </div>
                </div>

                {/* 덮개: 드래그하면 위로 밀리며 아래가 드러난다 */}
                {phase !== 'shown' && (
                  <div
                    onPointerDown={(e) => {
                      if (phase !== 'covered') return;
                      dragStartY.current = e.clientY;
                      setDragging(true);
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!dragging || phase !== 'covered') return;
                      setDragY(Math.max(0, Math.min(340, dragStartY.current - e.clientY)));
                    }}
                    onPointerUp={() => {
                      if (phase !== 'covered') return;
                      setDragging(false);
                      // 충분히 밀었거나 살짝 탭했으면 공개, 아니면 제자리로.
                      if (dragY > 130 || dragY < 8) {
                        setPhase('leaving');
                        setTimeout(() => {
                          setPhase('shown');
                          setDragY(0);
                        }, 220);
                      } else {
                        setDragY(0);
                      }
                    }}
                    className={`absolute inset-0 cursor-grab active:cursor-grabbing ${
                      !dragging && nextHint ? `${nextHint} rounded-xl` : ''
                    }`}
                    style={{
                      transform: phase === 'leaving' ? 'translateY(-460px)' : `translateY(${-dragY}px)`,
                      opacity: phase === 'leaving' ? 0 : 1,
                      transition: dragging ? 'none' : 'transform 0.22s ease, opacity 0.22s ease',
                    }}
                  >
                    <img src="/pack-card-back.svg" alt="" draggable={false} className="h-full w-full rounded-xl object-cover shadow-md" />
                  </div>
                )}
              </div>

              <p className="mt-3 h-5 text-center text-sm font-semibold text-neutral-600">
                {phase === 'shown'
                  ? `${koName(cfg.jp, pack[revealed]?.name ?? '')} · ${rarityKo(pack[revealed]?.r, cfg.jp)} — 카드를 누르면 다음`
                  : dragY > 40
                    ? '조금만 더…'
                    : `위로 밀어서 확인 (${revealed}/${pack.length})`}
              </p>
              <div className="mt-1 text-center">
                <button
                  type="button"
                  onClick={() => setRevealed(pack.length)}
                  className="text-xs text-neutral-400 underline"
                >
                  전체 한번에 공개
                </button>
              </div>
              {revealed > 0 && (
                <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-1">
                  {pack.slice(0, revealed).map((c, i) => (
                    <img key={i} src={thumb(c.img ?? '', 80)} alt="" className="h-14 rounded ring-1 ring-neutral-200" />
                  ))}
                </div>
              )}
            </div>
          )}

          {allDone && (
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:flex-wrap sm:items-center">
              <p className="text-sm font-semibold text-neutral-700">
                {keptDone ? '이 팩의 결과입니다' : <>앨범에 넣을 카드를 고르세요 <span className="text-neutral-500">({keep.size}장 선택됨)</span></>}
              </p>
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
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                disabled={busy || share.shared}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40 sm:ml-auto sm:w-auto"
              >
                {share.shared ? '자랑 완료' : sim?.canShareBonus ? `커뮤니티에 자랑하기 +${gp(SHARE_BONUS)}` : '커뮤니티에 자랑하기'}
              </button>
              <button
                type="button"
                onClick={keepCards}
                disabled={busy || keptDone}
                className="w-full rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40 sm:w-auto"
              >
                {keptDone
                  ? keptCount
                    ? `${keptCount}장 넣었습니다`
                    : '넘겼습니다'
                  : keep.size
                    ? `${keep.size}장 앨범에 넣기`
                    : '넣지 않고 넘기기'}
              </button>
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

          {/* 아직 다 안 뒤집은 낱팩: 한 장씩 뒤집는 그대로.
              실물 팩처럼 한 줄에 5장씩, 가운데 정렬(10장이면 5+5 두 줄). */}
          {pack && !boxQueue && !allDone && (
            <div className="mx-auto mt-4 grid max-w-2xl grid-cols-5 gap-2 sm:gap-3">
              {pack.map((c, i) => (
                <CardSlot
                  key={i}
                  card={c}
                  jp={cfg.jp}
                  index={i}
                  flipped={i < revealed}
                  isNext={i === revealed}
                  onFlip={revealNext}
                  name={koName(cfg.jp, c.name)}
                />
              ))}
            </div>
          )}

          {/* 결과 정리: 등급별로 묶어서 고른다. 박스(150장)도 여기서 앨범에 담고 자랑할 수 있다 */}
          {pack && !boxQueue && allDone && (
            <div className="mt-4 space-y-5">
              {resultGroups.map(({ k, cards }) => {
                const big = groupRank(k) >= 3;
                // 커먼·언커먼·레어·리버스는 장수가 많아 기본으로 접어 둔다(박스일 때만).
                const foldable = !big && pack.length > 20;
                const opened = !foldable || openGroups.has(k);
                const allPicked = cards.every((c) => keep.has(c.i));
                return (
                  <div key={k}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-neutral-800">
                        {groupLabel(k, cfg.jp)} <span className="font-normal text-neutral-400">{cards.length}장</span>
                      </p>
                      {!keptDone && (
                        <button
                          type="button"
                          onClick={() =>
                            setKeep((prev) => {
                              const next = new Set(prev);
                              for (const c of cards) {
                                if (allPicked) next.delete(c.i);
                                else next.add(c.i);
                              }
                              return next;
                            })
                          }
                          className="text-xs text-neutral-500 underline"
                        >
                          {allPicked ? '이 등급 전부 해제' : '이 등급 전부 선택'}
                        </button>
                      )}
                      {foldable && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(k)) next.delete(k);
                              else next.add(k);
                              return next;
                            })
                          }
                          className="ml-auto text-xs text-neutral-400 underline"
                        >
                          {opened ? '접기' : '펼쳐서 한 장씩 고르기'}
                        </button>
                      )}
                    </div>
                    {opened ? (
                      <div
                        className={`mt-2 grid ${
                          big ? 'max-w-2xl grid-cols-5 gap-2 sm:gap-3' : 'grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-12'
                        }`}
                      >
                        {cards.map((c, i) => (
                          <CardSlot
                            key={c.i}
                            card={c}
                            jp={cfg.jp}
                            index={i}
                            flipped
                            isNext={false}
                            onFlip={revealNext}
                            name={koName(cfg.jp, c.name)}
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
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-neutral-400">
                        접어 두었습니다. 펼쳐서 한 장씩 고르거나, 위 "이 등급 전부 선택"으로 한 번에 담을 수 있습니다.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'album' && (
        <div className="mt-4">
          {!sim?.album.length ? (
            <p className="text-sm text-neutral-400">아직 모은 카드가 없습니다. 팩을 열어보세요.</p>
          ) : (
            <>
              <div className="mb-4 rounded-2xl border border-neutral-200 p-4 sm:p-5">
                <div className="grid grid-cols-3 gap-x-2 gap-y-4">
                  <div>
                    <p className="text-xs text-neutral-400">모은 카드</p>
                    <p className="mt-0.5 text-xl font-bold text-black">
                      {sim.album.length}종
                      <span className="ml-1 text-sm font-semibold text-neutral-400">
                        {sim.album.reduce((a, b) => a + b.c, 0)}장
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-400">쓴 GP</p>
                    <p className="mt-0.5 text-xl font-bold text-black">{gp(sim.spent)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-400">예상 가치</p>
                    <p className="mt-0.5 text-xl font-bold text-black">
                      {value && value.totalUsd > 0 && rates
                        ? formatKrwApprox(value.totalUsd * rates.usdToKrw)
                        : value && value.totalUsd > 0
                          ? `$${value.totalUsd.toLocaleString()}`
                          : '—'}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-neutral-400">
                  예상 가치는 TCGplayer 마켓가 기준 참고용 추정치입니다
                  {value && value.totalUsd > 0 ? ` ($${value.totalUsd.toLocaleString()})` : ''}
                  {value && value.priced < sim.album.length ? ` · 시세 없는 ${sim.album.length - value.priced}종은 합계에서 제외` : ''}
                  {rates ? ` · ${rates.date} 환율` : ''}
                </p>
                {!!value?.pending?.length && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-600">
                    세트 {value.pending.length}개의 시세를 준비하고 있습니다. 잠시 뒤 자동으로 채워집니다.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
                  {['all', ...[...new Set(sim.album.map((a) => a.r))].sort((a, b) => rankOf(b) - rankOf(a))].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAlbumFilter(v)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        albumFilter === v ? 'bg-neutral-200 text-black' : 'text-neutral-500 hover:bg-neutral-100'
                      }`}
                    >
                      {v === 'all' ? '전체' : chipLabel(v)}
                    </button>
                  ))}
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
                {/* 정렬은 등급 칩과 한 줄에 두면 칸이 모자라 밀린다. 아래 줄로 뺀다. */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-neutral-400">정렬</span>
                  {([
                    ['rarity', '등급 높은순'],
                    ['rarityAsc', '등급 낮은순'],
                    ['price', '가격 높은순'],
                    ['priceAsc', '가격 낮은순'],
                    ['recent', '최근 획득순'],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAlbumSort(v)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        albumSort === v ? 'bg-black text-white' : 'text-neutral-500 hover:bg-neutral-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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
          )}
        </div>
      )}

      {tab === 'stash' && (
        <div className="mt-4">
          {Object.values(sim?.packs ?? {}).reduce((a, b) => a + b, 0) + Object.values(sim?.boxes ?? {}).reduce((a, b) => a + b, 0) ===
          0 ? (
            <p className="text-sm text-neutral-400">보관 중인 팩·박스가 없습니다. 구매 탭에서 사면 여기에 담깁니다.</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-neutral-400">
                구매한 팩·박스는 여기서 개봉합니다. 진열이 바뀐 뒤에도 열 수 있습니다. (팩 최대 {MAX_STASH}개 · 박스 최대{' '}
                {MAX_BOX_STASH}개)
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
                        className="mt-2 w-full rounded-lg bg-black py-2 text-sm font-bold text-white disabled:opacity-40"
                      >
                        박스 개봉
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
                        className="mt-2 w-full rounded-lg bg-black py-2 text-sm font-bold text-white disabled:opacity-40"
                      >
                        팩 개봉
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'rates' && (
        <div className="mt-4 text-sm">
          <p className="text-xs text-neutral-500">
            팩 한 개에서 그 등급이 나올 확률입니다. 확률은 팩 종류마다 다르고, 같은 종류면 세트가 달라도
            같습니다. 공식 발표가 없어 커뮤니티 실측 집계를 쓴 근사치라 실제 봉입률과는 다릅니다.
          </p>

          {PROFILE_GROUPS.map((g) => (
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
              실물과 같게 151류 특수팩에만 있습니다 — 일본판 151은 750팩에 1번, 북미판
              특별세트(Prismatic·151)는 1,000팩에 1번. 걸리면 팩 전체가 아트레어(AR) 이상으로
              나옵니다. 일반 확장팩에는 갓팩이 없습니다.
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
            <p className="text-sm font-bold text-yellow-700">메가 울트라레어 (MUR)</p>
            <p className="mt-1 text-xs text-neutral-600">
              메가 시리즈 전용 최상위 등급입니다. 카드 전체가 금색이고, 일본판은 MUR(세트당
              1장·약 3,000팩=박스 50개에 1장), 북미판은 MHR(세트당 2장)로 부릅니다. 메가
              시리즈에는 금색 UR·HR 대신 이 등급이 들어갑니다.
            </p>
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            표에 없는 자리는 커먼·언커먼·레어로 채웁니다. ACE SPEC은 수록된 세트에서만 나오고, 미수록
            세트는 그 확률만큼 레어가 나옵니다. GP는 출석하면 하루 {gp(DAILY_BUDGET)}, 다음 날로
            이월되고 최대 {gp(MAX_BALANCE)}까지 쌓입니다. {STREAK_DAYS}일 연속 출석하면 {gp(STREAK_BONUS)}을 더
            드립니다.
          </p>
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
        .card-picked { outline: 3px solid #059669; outline-offset: 2px; border-radius: 0.6rem; cursor: pointer; }
        /* 팩을 열면 카드가 한 장씩 깔린다 */
        .deal { animation: dealIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
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
  isNext,
  onFlip,
  name,
  picking,
  picked,
  onPick,
}: {
  card: PackCard;
  jp: boolean;
  index: number;
  flipped: boolean;
  isNext: boolean;
  onFlip: () => void;
  name: string;
  picking?: boolean;
  picked?: boolean;
  onPick?: () => void;
}) {
  const meta = RARITY[card.r ?? ''] ?? RARITY.Common;
  const hit = flipped && rankOf(card.r) >= 5; // AR 이상이면 공개 시 반짝
  return (
    <div>
      <div
        style={{ animationDelay: `${Math.min(index, 12) * 70}ms` }}
        className={`flip deal ${isNext ? `flip-next ${flipped ? '' : hintOf(card.r)}` : ''} ${picking && picked ? 'card-picked' : ''}`}
        onClick={isNext ? onFlip : picking ? onPick : undefined}
        role={isNext || picking ? 'button' : undefined}
        aria-label={isNext ? '카드 뒤집기' : picking ? '앨범에 넣기 선택' : undefined}
      >
        <div className="flip-inner" data-flipped={flipped}>
          <div className="flip-face flip-back">
            <img src="/pack-card-back.svg" alt="" className="h-full w-full rounded-lg object-cover" />
          </div>
          <div className={`flip-face flip-front ${hit ? 'card-hit' : ''}`}>
            <div className={`h-full overflow-hidden rounded-lg bg-neutral-100 ring-1 ${meta.cls} ${hit ? 'card-shine' : ''}`}>
              {card.img && (
                <img src={thumb(card.img, 240)} alt="" loading="lazy" className="h-full w-full object-contain" />
              )}
            </div>
          </div>
        </div>
      </div>
      {picking && (
        <p className={`mt-1 text-center text-[11px] font-bold ${picked ? 'text-emerald-600' : 'text-neutral-300'}`}>
          {picked ? '✓ 담음' : '안 담음'}
        </p>
      )}
      <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-700">{flipped ? name : ' '}</p>
      <p className={`text-[10px] font-bold ${meta.cls.split(' ')[0]}`}>{flipped ? rarityKo(card.r, jp) : ' '}</p>
      {flipped && card.m && <p className={`text-[10px] ${M_LABEL[card.m].cls}`}>{M_LABEL[card.m].t}</p>}
    </div>
  );
}
