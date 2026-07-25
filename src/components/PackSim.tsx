import { useCallback, useEffect, useState } from 'react';
import { trackEvent } from '../api/localStats';
import { koreanizeEnglishCardName } from '../lib/koreanizeEnglishTitle';
import { koreanizeTitle } from '../lib/koreanizeTitle';
import { rankOf, type PackCard } from '../lib/packDraw';
import {
  DAILY_BUDGET,
  GOD_PACK_RATE,
  MAX_BALANCE,
  PACK_SETS,
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

export function PackSim({ onPickCard }: { onPickCard?: (name: string) => void }) {
  const [tab, setTab] = useState<'open' | 'album' | 'rates'>('open');
  const [sim, setSim] = useState<SimState | null>(null);
  const [slug, setSlug] = useState(PACK_SETS[0].slug);
  const [pack, setPack] = useState<PackCard[] | null>(null);
  const [god, setGod] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [checkinMsg, setCheckinMsg] = useState('');
  // 앨범에 필요한 세트 카드 목록(이름·이미지). 앨범 탭을 열 때만 받아온다.
  const [setCards, setSetCards] = useState<Record<string, PackCard[]>>({});

  const cfg = packBySlug.get(slug) ?? PACK_SETS[0];

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
    if (!sim || sim.balance < cfg.price) return;
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
        body: JSON.stringify({ slug: cfg.slug }),
      });
      const d = (await r.json()) as { cards?: PackCard[]; god?: boolean; balance?: number; error?: string };
      if (!r.ok || !d.cards) {
        setErr(d.error === 'not enough' ? '예산이 모자라요.' : '팩을 열지 못했어요.');
        return;
      }
      if (d.god) trackEvent('packsim_godpack', cfg.label);
      // 등급 낮은 카드가 앞, 제일 좋은 카드가 맨 뒤로 오게 정렬해 마지막 한 장에서 터지게 한다.
      setPack([...d.cards].sort((a, b) => rankOf(a.r) - rankOf(b.r)));
      setGod(!!d.god);
      setSim((s) => (s ? { ...s, balance: d.balance ?? s.balance, opened: s.opened + 1 } : s));
      // 앨범 숫자도 같이 맞춘다. 정확한 값은 탭을 열 때 서버에서 다시 받는다.
    } finally {
      setBusy(false);
    }
  }

  // 앨범 탭: 앨범에 든 세트의 카드 목록을 받아 이름·이미지를 붙인다.
  useEffect(() => {
    if (tab !== 'album' || !sim) return;
    void load();
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

  const koName = (jp: boolean, name: string) =>
    !name ? '' : jp ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name);
  const revealNext = () => setRevealed((n) => (pack ? Math.min(n + 1, pack.length) : n));
  const allDone = !!pack && revealed >= pack.length;
  const best = pack ? pack.reduce((a, b) => (rankOf(b.r) > rankOf(a.r) ? b : a)) : null;
  const affordable = !!sim && sim.balance >= cfg.price;

  return (
    <div className="mx-auto max-w-3xl">
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setPack(null);
              }}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              {PACK_SETS.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.label} · {won(s.price)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={open}
              disabled={busy || !affordable}
              className="rounded-lg bg-black px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? '여는 중…' : `📦 ${won(cfg.price)} 주고 열기`}
            </button>
            {!affordable && <span className="text-xs text-rose-500">예산이 모자라요</span>}
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            {cfg.jp ? '일본판 5장' : '북미판 10장'} · 재미용 근사치라 실제 봉입률과는 다릅니다.
          </p>

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

          {allDone && best && (
            <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
              이번 팩 최고 등급: <b className={RARITY[best.r ?? '']?.cls.split(' ')[0]}>{RARITY[best.r ?? '']?.ko}</b>
              {' · '}
              {koName(cfg.jp, best.name)}
              {onPickCard && (
                <button
                  type="button"
                  onClick={() => onPickCard(koName(cfg.jp, best.name))}
                  className="ml-2 rounded-md bg-black px-2 py-1 text-[11px] font-bold text-white"
                >
                  시세 보기
                </button>
              )}
            </div>
          )}

          {pack && (
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
              {pack.map((c, i) => (
                <CardSlot
                  key={i}
                  card={c}
                  flipped={i < revealed}
                  isNext={i === revealed && !allDone}
                  onFlip={revealNext}
                  name={koName(cfg.jp, c.name)}
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
              <p className="mb-3 text-xs text-neutral-400">
                모은 카드 {sim.album.length}종 · 총 {sim.album.reduce((a, b) => a + b.c, 0)}장 · 쓴 돈{' '}
                {won(sim.spent)}
              </p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                {[...sim.album]
                  .sort((a, b) => rankOf(b.r) - rankOf(a.r))
                  .map((a) => {
                    const cfgA = packBySlug.get(a.s);
                    const card = setCards[a.s]?.find((c) => c.n === a.n);
                    const name = card ? koName(!!cfgA?.jp, card.name) : '';
                    const meta = RARITY[a.r] ?? RARITY.Common;
                    return (
                      <div key={`${a.s}-${a.n}`}>
                        <div className={`overflow-hidden rounded-lg bg-neutral-100 ring-1 ${meta.cls}`}>
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
                        {onPickCard && name && (
                          <button
                            type="button"
                            onClick={() => onPickCard(name)}
                            className="mt-0.5 text-[10px] text-neutral-500 underline"
                          >
                            시세 보기
                          </button>
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
            {cfg.label} 기준 · 팩 한 개에서 그 등급이 나올 확률입니다. 공식 발표가 없어 커뮤니티 실측 집계를 쓴
            근사치라, 실제 봉입률과는 다릅니다.
          </p>
          <table className="mt-3 w-full text-left">
            <thead className="text-xs text-neutral-400">
              <tr>
                <th className="py-1">등급</th>
                <th className="py-1">팩당 확률</th>
                <th className="py-1">대략</th>
              </tr>
            </thead>
            <tbody>
              {ratesOf(cfg).map((r) => (
                <tr key={r.ko} className="border-t border-neutral-100">
                  <td className="py-1.5 font-semibold">{r.ko}</td>
                  <td className="py-1.5">{r.pct.toFixed(2)}%</td>
                  <td className="py-1.5 text-neutral-500">{r.per}팩에 1장</td>
                </tr>
              ))}
              <tr className="border-t border-neutral-100">
                <td className="py-1.5 font-semibold text-amber-600">✨ 갓팩 (전부 AR 이상)</td>
                <td className="py-1.5">{(GOD_PACK_RATE * 100).toFixed(2)}%</td>
                <td className="py-1.5 text-neutral-500">{Math.round(1 / GOD_PACK_RATE)}팩에 1번</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4 text-xs text-neutral-500">
            남은 자리는 커먼·언커먼·레어로 채웁니다. 예산은 출석하면 하루 {won(DAILY_BUDGET)}, 다음 날로 이월되고
            최대 {won(MAX_BALANCE)}까지 쌓입니다. {STREAK_DAYS}일 연속 출석하면 {won(STREAK_BONUS)}을 더 드려요.
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

function CardSlot({
  card,
  flipped,
  isNext,
  onFlip,
  name,
}: {
  card: PackCard;
  flipped: boolean;
  isNext: boolean;
  onFlip: () => void;
  name: string;
}) {
  const meta = RARITY[card.r ?? ''] ?? RARITY.Common;
  const hit = flipped && rankOf(card.r) >= 5; // AR 이상이면 공개 시 반짝
  return (
    <div>
      <div
        className={`flip ${isNext ? 'flip-next' : ''}`}
        onClick={isNext ? onFlip : undefined}
        role={isNext ? 'button' : undefined}
        aria-label={isNext ? '카드 뒤집기' : undefined}
      >
        <div className="flip-inner" data-flipped={flipped}>
          <div className="flip-face flip-back">
            <img src="/card-back.svg" alt="" className="h-full w-full rounded-lg object-cover" />
          </div>
          <div className={`flip-face flip-front ${hit ? 'card-hit' : ''}`}>
            <div className={`h-full overflow-hidden rounded-lg bg-neutral-100 ring-1 ${meta.cls}`}>
              {card.img && (
                <img src={thumb(card.img, 240)} alt="" loading="lazy" className="h-full w-full object-contain" />
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-700">{flipped ? name : ' '}</p>
      <p className={`text-[10px] font-bold ${meta.cls.split(' ')[0]}`}>{flipped ? meta.ko : ' '}</p>
    </div>
  );
}
