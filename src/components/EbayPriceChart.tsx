import { useMemo, useRef, useState } from 'react';
import { formatGradeLabel, 대표등급, type EbayGradeStat } from '../api/ebayPrices';
import { useKrw } from './KrwHint';

// 이베이 등급별 낙찰 평균가의 날짜별 추이를 그린다. 스니덩크 차트(PriceChart)는 엔화·
// 스니덩크 타입에 묶여 있어서, 달러·등급 선택·날짜 기반인 이베이용은 따로 둔다.
const SERIES = '#2a78d6';
const VIEW_W = 280;
const VIEW_H = 96;
const PAD_Y = 12;

function compactDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function EbayPriceChart({ grades, title = '이베이 낙찰가 추이' }: { grades: EbayGradeStat[]; title?: string }) {
  // 그래프 눈금도 원화로 적는다(화면 전체를 원화로 통일).
  const krw = useKrw();
  // 그래프를 그리려면 점이 최소 2개는 있어야 한다. 낙찰이 뜸한 등급은 히스토리가 짧아
  // 선이 안 그려지므로, 그릴 수 있는 등급만 선택지에 올린다.
  const chartable = useMemo(() => grades.filter((g) => g.history.length >= 2), [grades]);
  const [grade, setGrade] = useState<string | null>(null);

  // 기본 등급: **가장 많이 팔린** 그릴 수 있는 등급. 거래가 많을수록 선이 믿을 만하다.
  // 타일·비교표와 같은 함수를 쓴다(대표등급). 따로 두면 한쪽만 고쳐서 또 어긋난다.
  const 기본 = useMemo(() => 대표등급(chartable), [chartable]);
  const active = chartable.find((g) => g.grade === grade) ?? 기본;

  const geom = useMemo(() => {
    if (!active) return null;
    const points = active.history;
    const prices = points.map((p) => p.price);
    const times = points.map((p) => new Date(p.date).getTime());
    const pMin = Math.min(...prices);
    const pMax = Math.max(...prices);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const x = (t: number) => (tMax === tMin ? VIEW_W / 2 : ((t - tMin) / (tMax - tMin)) * VIEW_W);
    const y = (p: number) =>
      pMax === pMin ? VIEW_H / 2 : PAD_Y + (1 - (p - pMin) / (pMax - pMin)) * (VIEW_H - PAD_Y * 2);
    const coords = points.map((p) => ({ cx: x(new Date(p.date).getTime()), cy: y(p.price), ...p }));
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' ');
    const area = `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;
    // ⚠️⚠️ **오름폭을 첫 점·끝 점 하나씩으로 세면 안 된다.** 그 하루에 싸게 팔린 한 건이
    //    그대로 전체 오름폭이 된다 — 베이스셋 리자몽 psa10이 "▲4525%"($400 → $18,500)로
    //    나가고 있었다(2026-08-08 실측). 등급칸 486개 중 18개(3.7%)가 300%를 넘었다.
    //    **앞 세 점의 중앙값과 뒤 세 점의 중앙값**으로 견주면 7개로 줄고 최악이 사라진다.
    // ⚠️ 점이 적으면 아예 안 보여준다. 넉 점짜리로 "▲2300%"라고 적는 건 아는 척이다.
    const 중앙 = (v: number[]) => {
      const a2 = [...v].sort((x, y) => x - y);
      return a2.length % 2 ? a2[(a2.length - 1) / 2] : (a2[a2.length / 2 - 1] + a2[a2.length / 2]) / 2;
    };
    const 앞 = 중앙(prices.slice(0, 3));
    const 뒤 = 중앙(prices.slice(-3));
    const changePct = prices.length < 6 || 앞 === 0 ? null : ((뒤 - 앞) / 앞) * 100;
    return { coords, line, area, pMin, pMax, changePct, points };
  }, [active]);

  // 그래프에 실제로 담긴 기간. 예전엔 '최근 6개월'이라고 글자로 박혀 있었는데,
  // 2026-08-07에 이력을 6개월 → 1년 6개월로 늘리면서 사실과 어긋나게 됐다.
  // 카드마다 낙찰 기록이 있는 기간이 달라서(뜸한 등급은 몇 달뿐) 실제 점으로 센다.
  const 기간글 = useMemo(() => {
    const pts = geom?.points ?? [];
    if (pts.length < 2) return '';
    const 첫 = new Date(pts[0].date).getTime();
    const 끝 = new Date(pts[pts.length - 1].date).getTime();
    const 달 = Math.round((끝 - 첫) / (30 * 24 * 60 * 60 * 1000));
    if (달 < 1) return '최근 한 달 안';
    if (달 < 12) return `최근 ${달}개월`;
    const 년 = Math.floor(달 / 12);
    const 남은달 = 달 % 12;
    return 남은달 ? `최근 ${년}년 ${남은달}개월` : `최근 ${년}년`;
  }, [geom]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!geom || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (geom.coords.length - 1));
    setHover(Math.min(Math.max(idx, 0), geom.coords.length - 1));
  }

  // 그릴 수 있는 등급이 없으면(낙찰 기록이 너무 적으면) 차트 자체를 띄우지 않는다.
  if (!active || !geom) return null;

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold text-neutral-500">{title}</p>
        <span className="text-xs font-semibold text-neutral-400">
          {기간글 && <span className="mr-1 font-normal">{기간글}</span>}
          {geom.changePct != null && (
            <span className={geom.changePct >= 0 ? 'text-rose-500' : 'text-emerald-600'}>
              <span aria-hidden>{geom.changePct >= 0 ? '▲' : '▼'}</span> {Math.abs(geom.changePct).toFixed(1)}%
            </span>
          )}
        </span>
      </div>

      {chartable.length > 1 && (
        <select
          value={active.grade}
          onChange={(e) => setGrade(e.target.value)}
          className="mb-2 w-full rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-700 focus:outline-none focus:ring-1 focus:ring-black"
        >
          {chartable.map((g) => (
            <option key={g.grade} value={g.grade}>
              {formatGradeLabel(g.grade)}
            </option>
          ))}
        </select>
      )}

      <div ref={wrapRef} className="relative" onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="w-full h-24">
          <defs>
            <linearGradient id="ebayFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity="0.16" />
              <stop offset="100%" stopColor={SERIES} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geom.area} fill="url(#ebayFill)" />
          <path
            d={geom.line}
            fill="none"
            stroke={SERIES}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {hover !== null && (
            <line
              x1={geom.coords[hover].cx}
              y1={0}
              x2={geom.coords[hover].cx}
              y2={VIEW_H}
              stroke="#d4d4d4"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
            style={{
              background: SERIES,
              left: `${(geom.coords[hover].cx / VIEW_W) * 100}%`,
              top: `${(geom.coords[hover].cy / VIEW_H) * 100}%`,
            }}
          />
        )}

        {hover !== null && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-black px-2 py-1 text-[11px] font-semibold text-white"
            style={{ left: `${Math.min(Math.max((geom.coords[hover].cx / VIEW_W) * 100, 12), 88)}%` }}
          >
            {krw(geom.coords[hover].price, 'usd')}
            <span className="ml-1 font-normal text-neutral-400">{compactDate(geom.coords[hover].date)}</span>
          </div>
        )}
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
        <span>
          최저 <span className="font-semibold text-neutral-600">{krw(geom.pMin, 'usd')}</span>
        </span>
        <span>
          {compactDate(geom.points[0].date)} ~ {compactDate(geom.points[geom.points.length - 1].date)}
        </span>
        <span>
          최고 <span className="font-semibold text-neutral-600">{krw(geom.pMax, 'usd')}</span>
        </span>
      </div>
    </div>
  );
}
