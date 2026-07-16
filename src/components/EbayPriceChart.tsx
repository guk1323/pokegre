import { useMemo, useRef, useState } from 'react';
import { formatGradeLabel, type EbayGradeStat } from '../api/ebayPrices';

// 이베이 등급별 낙찰 평균가의 날짜별 추이를 그린다. 스니덩크 차트(PriceChart)는 엔화·
// 스니덩크 타입에 묶여 있어서, 달러·등급 선택·날짜 기반인 이베이용은 따로 둔다.
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const SERIES = '#2a78d6';
const VIEW_W = 280;
const VIEW_H = 96;
const PAD_Y = 12;

function compactDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function EbayPriceChart({ grades }: { grades: EbayGradeStat[] }) {
  // 그래프를 그리려면 점이 최소 2개는 있어야 한다. 낙찰이 뜸한 등급은 히스토리가 짧아
  // 선이 안 그려지므로, 그릴 수 있는 등급만 선택지에 올린다.
  const chartable = useMemo(() => grades.filter((g) => g.history.length >= 2), [grades]);
  const [grade, setGrade] = useState<string | null>(null);

  // 기본 등급: 낙찰 건수가 가장 많은(=grades가 이미 그 순으로 정렬됨) 그릴 수 있는 등급.
  const active = chartable.find((g) => g.grade === grade) ?? chartable[0];

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
    const first = prices[0];
    const last = prices[prices.length - 1];
    const changePct = first === 0 ? 0 : ((last - first) / first) * 100;
    return { coords, line, area, pMin, pMax, changePct, points };
  }, [active]);

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
        <p className="text-xs font-semibold text-neutral-500">이베이 낙찰가 추이</p>
        <span className="text-xs font-semibold text-neutral-400">
          <span className="mr-1 font-normal">최근 6개월</span>
          <span className={geom.changePct >= 0 ? 'text-rose-500' : 'text-emerald-600'}>
            <span aria-hidden>{geom.changePct >= 0 ? '▲' : '▼'}</span> {Math.abs(geom.changePct).toFixed(1)}%
          </span>
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
            {usd.format(geom.coords[hover].price)}
            <span className="ml-1 font-normal text-neutral-400">{compactDate(geom.coords[hover].date)}</span>
          </div>
        )}
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
        <span>
          최저 <span className="font-semibold text-neutral-600">{usd.format(geom.pMin)}</span>
        </span>
        <span>
          {compactDate(geom.points[0].date)} ~ {compactDate(geom.points[geom.points.length - 1].date)}
        </span>
        <span>
          최고 <span className="font-semibold text-neutral-600">{usd.format(geom.pMax)}</span>
        </span>
      </div>
    </div>
  );
}
