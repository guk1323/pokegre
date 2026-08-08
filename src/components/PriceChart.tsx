import { 오름폭 } from '../lib/priceTrend';
import { useMemo, useRef, useState } from 'react';
import { koreanizeGrade } from '../api/snkrdunk';
import type { ConditionOption, PricePoint, PriceRange, RangeOption } from '../api/snkrdunk';
import { useKrw } from './KrwHint';


// 기간이 해를 넘기는 경우가 많아("25.11 ~ 26.7") 연도를 빼면 어느 시점인지 모호해진다.
// Intl의 ko-KR 표기는 "25. 11. 26."처럼 공백이 끼어 좁은 패널에서 지저분해서 직접 만든다.
function compactDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}

// 시리즈가 하나뿐이라 범례 없이 제목으로 식별한다. 색은 데이터비주얼 기본 팔레트의
// 카테고리 1번 슬롯(대비/채도/명도 검증 통과).
const SERIES = '#2a78d6';

const VIEW_W = 280;
const VIEW_H = 96;
const PAD_Y = 12;

function buildScales(points: PricePoint[]) {
  const prices = points.map((p) => p.price);
  const times = points.map((p) => p.timestamp);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);

  const x = (t: number) => (tMax === tMin ? VIEW_W / 2 : ((t - tMin) / (tMax - tMin)) * VIEW_W);
  // 값이 전부 같으면(가격 변동 없음) 0으로 나누지 않도록 가운데 고정.
  const y = (p: number) =>
    pMax === pMin ? VIEW_H / 2 : PAD_Y + (1 - (p - pMin) / (pMax - pMin)) * (VIEW_H - PAD_Y * 2);

  return { x, y, pMin, pMax };
}

export function PriceChart({
  points,
  ranges,
  range,
  onRangeChange,
  conditions,
  condition,
  onConditionChange,
  unitLabel,
  loading,
}: {
  points: PricePoint[];
  ranges: RangeOption[];
  range: PriceRange;
  onRangeChange: (next: PriceRange) => void;
  conditions: ConditionOption[];
  condition: string;
  onConditionChange: (next: string) => void;
  unitLabel?: string;
  loading: boolean;
}) {
  // 그래프 눈금도 원화로 적는다(화면 전체를 원화로 통일).
  const krw = useKrw();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    // ⚠️ 점이 하나뿐이면 그래프를 그리지 않는다. 선(`M140,48`)은 잇는 곳이 없어 아무것도
    //    안 보이고, 밑칠만 화면 끝까지 삼각형으로 깔려 없는 흐름을 있는 것처럼 보인다.
    //    결과는 96px짜리 빈 칸이다 — "그래프 데이터 없는 건 없애 달라"던 그 화면이다
    //    (운영자 지적, 2026-08-05 배포 전 점검에서 다시 확인. 망나뇽 R [SM11 068/094]).
    //    한 건은 추이가 아니라 사실 한 줄이므로 아래에서 글로 적는다.
    if (points.length < 2) return null;
    const { x, y, pMin, pMax } = buildScales(points);
    const coords = points.map((p) => ({ cx: x(p.timestamp), cy: y(p.price), ...p }));
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' ');
    const area = `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;
    const minIdx = points.reduce((best, p, i) => (p.price < points[best].price ? i : best), 0);
    const maxIdx = points.reduce((best, p, i) => (p.price > points[best].price ? i : best), 0);
    const last = points[points.length - 1].price;
    // 오름폭은 이베이 그래프와 **같은 한 벌**을 쓴다(priceTrend.ts). 점이 적으면 null이다.
    const changePct = 오름폭(points.map((p) => p.price));
    return { coords, line, area, minIdx, maxIdx, pMin, pMax, last, changePct };
  }, [points]);

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!geom || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (geom.coords.length - 1));
    setHover(Math.min(Math.max(idx, 0), geom.coords.length - 1));
  }

  // API는 all을 맨 앞에 주는데, 기간 선택은 짧은 것부터 늘어놓는 게 읽기 자연스럽다.
  const activeRanges = ranges
    .filter((r) => r.hasData)
    .sort((a, b) => (RANGE_ORDER[a.key] ?? 99) - (RANGE_ORDER[b.key] ?? 99));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        {/* 수량은 1개(1장) 고정이라, 무슨 단위 시세인지 밝혀준다. */}
        <p className="text-xs font-semibold text-neutral-500">
          시세 추이 (실거래{unitLabel ? ` · ${koreanizeGrade(unitLabel)} 기준` : ''})
        </p>
        {/* 변동률은 "선택한 기간의 첫 거래 대비 마지막 거래"다. 기준을 안 밝히면
            무엇 대비 몇 %인지 알 수 없어서, 기간 라벨을 붙여 뜻을 분명히 한다.
            "전체" 기준일 땐 "전체 기준"이 어색해서 "전체 기간"으로 다듬는다. */}
        {geom && (
          <span className="text-xs font-semibold text-neutral-400">
            <span className="mr-1 font-normal">
              {range === 'all' ? '전체 기간' : `최근 ${RANGE_LABELS[range] ?? ''}`}
            </span>
            {/* 점이 여섯도 안 되면 오름폭을 안 적는다(priceTrend.ts 설명 참고). */}
            {geom.changePct != null && (
              <span className={geom.changePct >= 0 ? 'text-rose-500' : 'text-emerald-600'}>
                <span aria-hidden>{geom.changePct >= 0 ? '▲' : '▼'}</span>{' '}
                {Math.abs(geom.changePct).toFixed(1)}%
              </span>
            )}
          </span>
        )}
      </div>

      {/* 등급을 안 고르면 PSA10과 생카가 한 줄에 섞여 그려진다. 박스는 등급이 없어서
          API가 빈 배열을 주고, 그때는 선택기 자체를 띄우지 않는다. */}
      {/* 라벨 없이 "A"만 떠 있으면 무엇을 고르는 칸인지 알 수 없다(지적받음). A·B·C·D가
          각각 어느 정도 상태인지는 스니커덩크가 밝히지 않아 우리가 풀어 쓰지 않고,
          "무엇을 고르는 칸인지"만 적는다. */}
      {conditions.length > 0 && (
        // 화면 폭을 꽉 채운 회색 상자에 "A"만 덩그러니 떠 있어 어색했다(지적받음).
        // 이름표를 옆에 붙이고 칸은 내용에 맞게 줄여, 흔히 보는 작은 선택기로 만든다.
        // 화살표는 직접 그린다 — 기본 화살표는 기기마다 모양·위치가 제각각이다.
        <label className="mb-3 flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold text-neutral-400">등급</span>
          <span className="relative inline-flex">
            <select
              value={condition}
              onChange={(e) => onConditionChange(e.target.value)}
              // ⚠️ 폰에서 26px이라 누르기 어려웠다(운영자 지시 2026-08-06). 36px로 키운다.
              className="appearance-none rounded-full border border-neutral-200 bg-white py-[0.8rem] pl-3.5 pr-7 text-xs font-semibold text-neutral-700 focus:border-black focus:outline-none"
            >
              {conditions.map((c) => (
                <option key={c.code} value={c.code}>
                  {koreanizeGrade(c.name)}
                </option>
              ))}
            </select>
            <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-neutral-400">
              ▼
            </span>
          </span>
        </label>
      )}

      {loading ? (
        <p className="text-xs text-neutral-400 py-8 text-center">불러오는 중...</p>
      ) : points.length === 1 ? (
        // 한 건뿐이면 추이가 아니라 사실 한 줄이다. 언제 얼마에 팔렸는지만 적는다.
        <p className="py-8 text-center text-xs text-neutral-400">
          실거래가 {compactDate(points[0].timestamp)}에 있던{' '}
          <span className="font-semibold text-neutral-600">{krw(points[0].price, 'jpy')}</span> 한 건뿐이라
          <br />
          추이를 그릴 수 없습니다.
        </p>
      ) : !geom ? (
        // 고를 등급이 없으면 "이 등급의"가 말이 안 된다(어느 등급에도 기록이 없거나
        // 박스라 등급이 없는 경우다).
        <p className="text-xs text-neutral-400 py-8 text-center">
          {conditions.length > 0 ? '이 등급의 실거래 기록이 없습니다.' : '실거래 기록이 없습니다.'}
        </p>
      ) : (
        <>
          <div
            ref={wrapRef}
            className="relative"
            onMouseMove={handleMove}
            onMouseLeave={() => setHover(null)}
          >
            {/* preserveAspectRatio를 기본값으로 두면 viewBox가 높이에 맞춰 축소되면서
                패널이 넓을 때 그래프가 가운데에만 조그맣게 그려진다. none으로 가로를
                꽉 채우되, 선은 non-scaling-stroke라 굵기가 일그러지지 않는다. */}
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              className="w-full h-24"
            >
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES} stopOpacity="0.16" />
                  <stop offset="100%" stopColor={SERIES} stopOpacity="0" />
                </linearGradient>
              </defs>

              <path d={geom.area} fill="url(#priceFill)" />
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

            {/* 가로를 늘여 그리기 때문에 SVG <circle>은 타원으로 찌그러진다.
                호버 점만 HTML로 빼서 정원을 유지한다. */}
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
                style={{
                  left: `${Math.min(Math.max((geom.coords[hover].cx / VIEW_W) * 100, 12), 88)}%`,
                }}
              >
                {krw(geom.coords[hover].price, 'jpy')}
                <span className="ml-1 font-normal text-neutral-400">
                  {compactDate(geom.coords[hover].timestamp)}
                </span>
              </div>
            )}
          </div>

          {/* 모든 점에 숫자를 달지 않고 최고/최저만 직접 라벨링한다. */}
          <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
            <span>
              최저 <span className="font-semibold text-neutral-600">{krw(geom.pMin, 'jpy')}</span>
            </span>
            <span>
              {compactDate(points[0].timestamp)} ~ {compactDate(points[points.length - 1].timestamp)}
            </span>
            <span>
              최고 <span className="font-semibold text-neutral-600">{krw(geom.pMax, 'jpy')}</span>
            </span>
          </div>
        </>
      )}

      {activeRanges.length > 1 && (
        <div className="mt-2 inline-flex rounded-full border border-neutral-200 p-0.5">
          {activeRanges.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onRangeChange(r.key)}
              // ⚠️ 폰에서 21px밖에 안 돼 손가락으로 누르기 어려웠다(운영자 지시
              //    2026-08-06). 위아래 여백을 늘려 36px로 키운다. 알약이 조금 굵어지지만
              //    글자 크기는 그대로라 줄이 밀리지 않는다.
              className={`rounded-full px-3 py-[0.85rem] text-[11px] font-semibold ${
                range === r.key ? 'bg-black text-white' : 'text-neutral-500 hover:text-black'
              }`}
            >
              {RANGE_LABELS[r.key] ?? r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const RANGE_LABELS: Record<string, string> = {
  oneWeek: '1주',
  oneMonth: '1개월',
  threeMonths: '3개월',
  all: '전체',
};

const RANGE_ORDER: Record<string, number> = {
  oneWeek: 0,
  oneMonth: 1,
  threeMonths: 2,
  all: 3,
};
