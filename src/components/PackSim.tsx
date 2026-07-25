import { useCallback, useEffect, useState } from 'react';
import { trackEvent } from '../api/localStats';
import { fetchExchangeRates, formatKrwApprox, type ExchangeRates } from '../api/exchangeRate';
import { koreanizeEnglishCardName } from '../lib/koreanizeEnglishTitle';
import { koreanizeTitle } from '../lib/koreanizeTitle';
import { rankOf, type PackCard } from '../lib/packDraw';
import {
  DAILY_BUDGET,
  GOD_PACK_RATE,
  livePacks,
  NA_SPECIAL,
  MAX_BALANCE,
  STREAK_BONUS,
  STREAK_DAYS,
  packBySlug,
  type PackSet,
} from '../lib/packSets';

// 운영자 전용 카드 뽑기(실험). 출석으로 받은 예산으로 팩을 사서 열고, 나온 카드를
// 앨범에 모은다. 뽑기·예산 계산은 전부 서버가 한다(화면에서 하면 얼마든지 조작 가능).
// 확률은 커뮤니티 실측 집계(공식 발표는 없음)라 재미용 근사치다.

type AlbumCard = { s: string; n: string; r: string; c: number; g?: 1 };
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
  gained?: number;
};

// 등급 표기(한글·약칭)와 색.
const RARITY: Record<string, { ko: string; cls: string }> = {
  Common: { ko: '커먼', cls: 'text-neutral-400 ring-neutral-200' },
  Uncommon: { ko: '언커먼', cls: 'text-neutral-500 ring-neutral-300' },
  Rare: { ko: '레어', cls: 'text-sky-600 ring-sky-300' },
  'Double rare': { ko: '더블레어 RR', cls: 'text-indigo-600 ring-indigo-300' },
  'ACE SPEC Rare': { ko: 'ACE', cls: 'text-rose-600 ring-rose-300' },
  'Illustration rare': { ko: '일러레어 AR', cls: 'text-amber-600 ring-amber-300' },
  'Ultra Rare': { ko: '울트라레어 UR', cls: 'text-fuchsia-600 ring-fuchsia-300' },
  'Special illustration rare': { ko: '스페셜 AR (SAR)', cls: 'text-amber-500 ring-amber-400' },
  'Hyper rare': { ko: '하이퍼레어 HR', cls: 'text-yellow-500 ring-yellow-400' },
};

// TCGdex는 확장자 없는 베이스 주소라 /high.webp를 붙여야 한다. limitless는 이미 .png다.
const cardImg = (base: string) => (!base ? '' : /\.(png|jpe?g|webp)(\?|$)/i.test(base) ? base : `${base}/high.webp`);
const thumb = (url: string, w: number) => {
  const src = cardImg(url);
  return src ? `/api/img?u=${encodeURIComponent(src)}&w=${w}` : '';
};
const won = (n: number) => `${n.toLocaleString()}원`;

// 팩 하나에서 그 등급이 나올 확률(%). 슬롯별 확률을 합쳐서 보여준다.
function ratesOf(pack: PackSet): { ko: string; pct: number; per: number }[] {
  const sum: Record<string, number> = {};
  for (const slot of pack.profile.slots) for (const [tier, p] of slot.rolls) sum[tier] = (sum[tier] ?? 0) + p;
  return Object.entries(sum)
    .sort((a, b) => rankOf(b[0]) - rankOf(a[0]))
    .map(([tier, p]) => ({ ko: RARITY[tier]?.ko ?? tier, pct: p * 100, per: Math.round(1 / p) }));
}

// 확률은 "팩 종류"마다 정해져 있고 같은 종류면 세트가 달라도 같다. 팩을 하나씩
// 바꿔가며 봐야 하면 불편하니, 종류별로 묶어 한 화면에 다 보여준다.
const LIVE_TODAY: PackSet[] = livePacks();
const PROFILE_GROUPS = [...new Set(LIVE_TODAY.map((p) => p.profile))].map((profile) => {
  const packs = LIVE_TODAY.filter((p) => p.profile === profile);
  const first = packs[0];
  const kind = first.jp ? '일본판 확장팩 (5장)' : profile === NA_SPECIAL ? '북미판 특별세트 (10장)' : '북미판 일반 부스터 (10장)';
  return {
    name: `${kind} — ${packs.length}종`,
    packs: packs.map((p) => p.label.replace(/^\[.+?\]\s*/, '')),
    rates: ratesOf(first),
  };
});

// "시세 보기"가 넘기는 목표. 앨범에 보여주는 값이 TCGplayer 마켓가이므로 눌렀을 때도
// TCGplayer 화면으로 간다(보여준 숫자와 다른 시장으로 보내면 헷갈린다). 검색어는
// "이름 번호"라 그 카드 한 장으로 좁혀진다(039처럼 0 붙은 그대로 — 39는 239에도 걸린다).
export type PickTarget = { query: string; source: 'snkrdunk' | 'ebay' | 'tcgplayer'; edition: 'japanese' | 'english' };

export function PackSim({ onPickCard }: { onPickCard?: (target: PickTarget) => void }) {
  const [tab, setTab] = useState<'open' | 'album' | 'rates'>('open');
  const [sim, setSim] = useState<SimState | null>(null);
  const [slug, setSlug] = useState(LIVE_TODAY[0].slug);
  const [pack, setPack] = useState<PackCard[] | null>(null);
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
  const [value, setValue] = useState<{ prices: Record<string, Record<string, number>>; totalUsd: number; priced: number; pending?: string[] } | null>(null);
  // 앨범 선택 삭제 모드. 켜면 카드를 눌러 고르고, 한 번에 지운다.
  const [delMode, setDelMode] = useState(false);
  const [delPick, setDelPick] = useState<Set<string>>(new Set());
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  // 방금 연 팩에서 앨범에 넣을 카드. 커먼까지 다 넣으면 앨범이 지저분해져서 골라 담는다.
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [keptMsg, setKeptMsg] = useState('');
  // 운영자는 점검하려고 아무 때나 열어야 해서 기본이 무제한이다. 끄면 평소처럼
  // 예산이 깎이고 모자라면 못 연다(그 흐름도 확인해야 하니 스위치로 뒀다).
  const [spend, setSpend] = useState(false);

  const cfg = packBySlug.get(slug) ?? LIVE_TODAY[0];

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/local/auth/packsim', { credentials: 'include' });
      if (!r.ok) return setErr('아직 운영자만 쓸 수 있는 실험 기능이에요.');
      setSim((await r.json()) as SimState);
    } catch {
      setErr('불러오지 못했어요.');
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

  async function checkIn() {
    setBusy(true);
    try {
      const r = await fetch('/api/local/auth/packsim/checkin', { method: 'POST', credentials: 'include' });
      const d = (await r.json()) as SimState;
      setSim(d);
      if (d.gained) {
        trackEvent('packsim_checkin');
        setCheckinMsg(`오늘의 예산 ${won(d.gained)} 받았어요! (연속 ${d.streak}일)`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function open() {
    if (!sim || (spend && sim.balance < cfg.price)) return;
    setErr('');
    setBusy(true);
    setPack(null);
    setRevealed(0);
    setGod(false);
    trackEvent('packsim', cfg.label);
    try {
      const r = await fetch('/api/local/auth/packsim/open', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: cfg.slug, spend }),
      });
      const d = (await r.json()) as { cards?: PackCard[]; god?: boolean; balance?: number; error?: string };
      if (!r.ok || !d.cards) {
        setErr(d.error === 'not enough' ? '예산이 모자라요.' : '팩을 열지 못했어요.');
        return;
      }
      if (d.god) trackEvent('packsim_godpack', cfg.label);
      // 등급 낮은 카드가 앞, 제일 좋은 카드가 맨 뒤로 오게 정렬해 마지막 한 장에서 터지게 한다.
      const sorted = [...d.cards].sort((a, b) => rankOf(a.r) - rankOf(b.r));
      setPack(sorted);
      // 일러레어(AR) 이상은 기본으로 담아둔다 — 대부분 남기고 싶어 하는 등급이다.
      setKeep(new Set(sorted.filter((c) => rankOf(c.r) >= 5).map((c) => c.n)));
      setKeptMsg('');
      setGod(!!d.god);
      setSim((s) => (s ? { ...s, balance: d.balance ?? s.balance, opened: s.opened + 1 } : s));
      // 앨범 숫자도 같이 맞춘다. 정확한 값은 탭을 열 때 서버에서 다시 받는다.
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
        body: JSON.stringify({ ns: [...keep] }),
      });
      const d = (await r.json()) as { kept?: number; album?: AlbumCard[] };
      if (d.album) setSim((s2) => (s2 ? { ...s2, album: d.album! } : s2));
      setKeptMsg(d.kept ? `${d.kept}장을 앨범에 넣었어요.` : '앨범에 넣지 않고 넘겼어요.');
      setPack(null);
    } finally {
      setBusy(false);
    }
  }

  // 선택한 카드들을 앨범에서 지운다(중복 포함 통째로). 확인을 한 번 받는다.
  async function removeSelected() {
    if (delPick.size === 0) return;
    if (!window.confirm(`선택한 ${delPick.size}종을 앨범에서 삭제할까요? 중복으로 모은 것도 같이 빠져요.`)) return;
    setBusy(true);
    try {
      const items = [...delPick].map((k) => {
        const [s2, n] = k.split('|');
        return { s: s2, n };
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
  // 마켓가라 눌렀을 때도 TCGplayer 화면으로 간다. 검색어는 "이름 번호" — 한글 이름은
  // 기존 번역 파이프라인이 영문으로 바꿔 준다(번호는 039처럼 0 붙은 그대로가 정확).
  const pickTarget = (slug2: string, n: string, rawName: string): PickTarget => {
    const jp = !!packBySlug.get(slug2)?.jp;
    return { query: `${koName(jp, rawName)} ${n}`, source: 'tcgplayer', edition: jp ? 'japanese' : 'english' };
  };

  const usdOf = (a: AlbumCard) => value?.prices[a.s]?.[a.n.replace(/^0+/, '') || '0'] ?? 0;
  const koName = (jp: boolean, name: string) =>
    !name ? '' : jp ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name);
  const revealNext = () => setRevealed((n) => (pack ? Math.min(n + 1, pack.length) : n));
  const allDone = !!pack && revealed >= pack.length;
  const affordable = !!sim && (!spend || sim.balance >= cfg.price);

  return (
    <div>
      <h2 className="text-base font-bold text-black">
        카드 뽑기 <span className="align-middle text-[11px] font-semibold text-amber-600">운영자 · 실험</span>
      </h2>

      {/* 예산 바 */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <div>
          <p className="text-[11px] text-neutral-400">내 예산</p>
          <p className="text-lg font-bold text-black">{won(sim?.balance ?? 0)}</p>
        </div>
        <div className="text-[11px] text-neutral-500">
          연속 출석 {sim?.streak ?? 0}일 · 지금까지 {sim?.opened ?? 0}팩
          {sim?.god ? ` · 갓팩 ${sim.god}번` : ''}
        </div>
        <button
          type="button"
          onClick={checkIn}
          disabled={busy || !sim?.canCheckIn}
          className="ml-auto rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          {sim?.canCheckIn ? `출석하고 ${won(DAILY_BUDGET)} 받기` : '오늘 출석 완료'}
        </button>
      </div>
      {checkinMsg && <p className="mt-2 text-sm font-semibold text-emerald-600">{checkinMsg}</p>}
      {err && <p className="mt-2 text-sm text-rose-500">{err}</p>}

      {/* 탭 */}
      <div className="mt-4 flex gap-1">
        {([
          ['open', '팩 열기'],
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
          {/* 팩 진열장 — 카드샵 쇼케이스. 어두운 유리장 안에 상자들이 조명을 받고 서 있고,
              고르면 스포트라이트가 켜지며 살짝 떠오른다. 색은 금색 포인트 하나만 쓴다. */}
          <div className="mt-4 rounded-2xl bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-950 p-5 ring-1 ring-neutral-800">
            {[
              { label: '일본판 · 팩당 5장', packs: LIVE_TODAY.filter((p) => p.jp) },
              { label: '북미판 · 팩당 10장', packs: LIVE_TODAY.filter((p) => !p.jp) },
            ].map((row, ri) => (
              <div key={row.label} className={ri === 0 ? 'mb-6' : ''}>
                <p className="mb-1 text-[11px] font-semibold tracking-[0.2em] text-amber-200/50">{row.label}</p>
                <div className="grid grid-cols-3">
                  {row.packs.map((s2) => {
                    const on = s2.slug === slug;
                    const img = art[s2.slug]?.boxImg || art[s2.slug]?.logo;
                    return (
                      <button
                        key={s2.slug}
                        type="button"
                        onClick={() => {
                          setSlug(s2.slug);
                          setPack(null);
                          setKeptMsg('');
                        }}
                        className="group relative px-2 pt-3 text-center"
                      >
                        {/* 스포트라이트 — 선택하면 금빛, 아니면 호버에만 희미하게 */}
                        <div
                          className={`pointer-events-none absolute inset-x-6 top-0 h-32 rounded-full blur-2xl transition duration-300 ${
                            on ? 'bg-amber-300/25' : 'bg-transparent group-hover:bg-white/10'
                          }`}
                        />
                        <div className="relative flex h-28 items-end justify-center sm:h-36">
                          {img && (
                            <img
                              src={thumb(img, 280)}
                              alt=""
                              loading="lazy"
                              className={`max-h-28 object-contain drop-shadow-[0_12px_16px_rgba(0,0,0,0.7)] transition duration-300 sm:max-h-36 ${
                                on ? '-translate-y-2' : 'group-hover:-translate-y-1'
                              }`}
                            />
                          )}
                        </div>
                        {/* 유리 선반: 얇은 빛줄 */}
                        <div
                          className={`relative mt-1 h-[3px] rounded-full bg-gradient-to-r from-transparent to-transparent ${
                            on ? 'via-amber-300/80' : 'via-neutral-500/60'
                          }`}
                        />
                        <div className="pt-2">
                          <p
                            className={`line-clamp-1 text-[12px] leading-tight ${
                              on ? 'font-bold text-white' : 'font-medium text-neutral-300'
                            }`}
                          >
                            {s2.label.replace(/^\[.+?\]\s*/, '')}
                          </p>
                          <p
                            className={`mt-0.5 text-[11px] tracking-wide ${
                              on ? 'font-semibold text-amber-300' : 'text-neutral-500'
                            }`}
                          >
                            {won(s2.price)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="mt-3 text-center text-[10px] tracking-wide text-neutral-500">
              오늘의 진열 · 매일 자정에 다른 팩으로 바뀝니다 (전체 22종)
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={open}
              disabled={busy || !affordable}
              className="rounded-lg bg-black px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? '여는 중…' : `📦 ${cfg.label.replace(/^\[.+?\]\s*/, '')} 열기 (${won(cfg.price)})`}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-neutral-500">
              <input type="checkbox" checked={spend} onChange={(e) => setSpend(e.target.checked)} />
              예산 쓰기 (끄면 운영자 무제한)
            </label>
            {!affordable && <span className="text-xs text-rose-500">예산이 모자라요</span>}
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            비공식 팬 시뮬레이션입니다. 실제 카드나 금전적 가치와는 아무 관계가 없고, 예산은 서비스 안에서만
            쓰이는 숫자입니다. 확률은 재미용 근사치라 실제 봉입률과 다릅니다.
          </p>
          {keptMsg && <p className="mt-2 text-sm font-semibold text-emerald-600">{keptMsg}</p>}

          {god && (
            <div className="mt-4 animate-pulse rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 p-3 text-center text-base font-black text-black">
              ✨ 갓팩! 전부 AR 이상이에요 ✨
            </div>
          )}

          {pack && !allDone && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={revealNext}
                className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-white shadow-sm"
              >
                카드 넘기기 <span className="opacity-80">({revealed}/{pack.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setRevealed(pack.length)}
                className="text-xs text-neutral-400 underline"
              >
                전체 한번에 공개
              </button>
            </div>
          )}

          {allDone && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-neutral-700">
                앨범에 넣을 카드를 고르세요 <span className="text-neutral-500">({keep.size}장 선택됨)</span>
              </p>
              <button type="button" onClick={() => setKeep(new Set(pack!.map((c) => c.n)))} className="text-xs text-neutral-500 underline">
                전부 선택
              </button>
              <button type="button" onClick={() => setKeep(new Set())} className="text-xs text-neutral-500 underline">
                전부 해제
              </button>
              <button
                type="button"
                onClick={keepCards}
                disabled={busy}
                className="ml-auto rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                {keep.size ? `${keep.size}장 앨범에 넣기` : '넣지 않고 넘기기'}
              </button>
            </div>
          )}

          {pack && (
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
              {pack.map((c, i) => (
                <CardSlot
                  key={i}
                  card={c}
                  index={i}
                  isLast={i === pack.length - 1}
                  flipped={i < revealed}
                  isNext={i === revealed && !allDone}
                  onFlip={revealNext}
                  name={koName(cfg.jp, c.name)}
                  picking={allDone}
                  picked={keep.has(c.n)}
                  onPick={() =>
                    setKeep((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.n)) next.delete(c.n);
                      else next.add(c.n);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'album' && (
        <div className="mt-4">
          {!sim?.album.length ? (
            <p className="text-sm text-neutral-400">아직 모은 카드가 없어요. 팩을 열어보세요.</p>
          ) : (
            <>
              <div className="mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs text-neutral-400">
                  모은 카드 {sim.album.length}종 · 총 {sim.album.reduce((a, b) => a + b.c, 0)}장 · 쓴 돈{' '}
                  {won(sim.spent)}
                </p>
                {value && value.totalUsd > 0 && (
                  <p className="mt-1 text-sm font-bold text-black">
                    앨범 예상 가치{' '}
                    {rates ? `${formatKrwApprox(value.totalUsd * rates.usdToKrw)} ` : ''}
                    <span className="font-semibold text-neutral-500">(${value.totalUsd.toLocaleString()})</span>
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-neutral-400">
                  TCGplayer 마켓가 기준 참고용 추정치{value && value.priced < sim.album.length ? ` · 시세 없는 ${sim.album.length - value.priced}종은 합계에서 제외` : ''}
                  {rates ? ` · ${rates.date} 환율` : ''}
                </p>
                {!!value?.pending?.length && (
                  <p className="mt-0.5 text-[10px] font-semibold text-amber-600">
                    세트 {value.pending.length}개 시세를 준비하는 중이에요. 잠시 뒤 자동으로 채워져요(다음부터는 바로 떠요).
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
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
                        onClick={() => setDelPick(new Set(sim.album.map((a) => `${a.s}|${a.n}`)))}
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
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
                {[...sim.album]
                  .sort((a, b) => rankOf(b.r) - rankOf(a.r))
                  .map((a) => {
                    const cfgA = packBySlug.get(a.s);
                    const card = setCards[a.s]?.find((c) => c.n === a.n);
                    const name = card ? koName(!!cfgA?.jp, card.name) : '';
                    const meta = RARITY[a.r] ?? RARITY.Common;
                    const dk = `${a.s}|${a.n}`;
                    const picked = delPick.has(dk);
                    return (
                      <div
                        key={`${a.s}-${a.n}`}
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
                          {meta.ko}
                          {a.g ? ' ✨' : ''}
                        </p>
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
                </tbody>
              </table>
            </div>
          ))}

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-700">
              ✨ 갓팩 — {(GOD_PACK_RATE * 100).toFixed(2)}% ({Math.round(1 / GOD_PACK_RATE)}팩에 1번)
            </p>
            <p className="mt-1 text-xs text-neutral-600">팩 전체가 일러레어(AR) 이상으로 채워집니다. 팩 종류와 상관없이 같습니다.</p>
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            표에 없는 자리는 커먼·언커먼·레어로 채웁니다. 예산은 출석하면 하루 {won(DAILY_BUDGET)}, 다음 날로
            이월되고 최대 {won(MAX_BALANCE)}까지 쌓입니다. {STREAK_DAYS}일 연속 출석하면 {won(STREAK_BONUS)}을 더
            드려요.
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
        /* 마지막 한 장(제일 좋은 카드)은 금빛으로 더 세게 고동친다 */
        .flip-last { animation: lastPulse 0.9s ease-in-out infinite; }
        @keyframes lastPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.75); }
          60% { box-shadow: 0 0 0 10px rgba(245, 158, 11, 0), 0 0 26px 6px rgba(245, 158, 11, 0.55); }
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
          .flip-next, .flip-last, .deal { animation: none; }
          .card-shine::after { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function CardSlot({
  card,
  index,
  isLast,
  flipped,
  isNext,
  onFlip,
  name,
  picking,
  picked,
  onPick,
}: {
  card: PackCard;
  index: number;
  isLast: boolean;
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
        style={{ animationDelay: `${index * 70}ms` }}
        className={`flip deal ${isNext ? (isLast ? 'flip-next flip-last' : 'flip-next') : ''} ${picking && picked ? 'card-picked' : ''}`}
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
          {picked ? '✓ 앨범에 넣기' : '안 넣음'}
        </p>
      )}
      <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-700">{flipped ? name : ' '}</p>
      <p className={`text-[10px] font-bold ${meta.cls.split(' ')[0]}`}>{flipped ? meta.ko : ' '}</p>
    </div>
  );
}
