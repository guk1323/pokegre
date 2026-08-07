import type { PopularSearch } from '../api/localStats';

function formatAsOf(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${min} 기준`;
}

function ChangeIndicator({ item }: { item: PopularSearch }) {
  if (item.change === 'new') {
    return <span className="text-xs font-bold text-rose-500">NEW</span>;
  }
  if (item.change === 'flat') {
    return <span className="text-xs text-neutral-400">-</span>;
  }
  if (item.change === 'up') {
    return (
      <span className="text-xs font-semibold text-rose-500">
        <span aria-hidden>▲</span> {item.delta}
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold text-emerald-600">
      <span aria-hidden>▼</span> {item.delta}
    </span>
  );
}

function Row({ item, onSelect }: { item: PopularSearch; onSelect: (term: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.term)}
      className="w-full flex items-center gap-1.5 rounded-lg bg-neutral-50 hover:bg-neutral-100 px-2 py-2.5 text-left sm:gap-3 sm:px-4 sm:py-3"
    >
      {/* 10위는 두 자리라 칸(w-4=16px)을 넘겼고, 넘친 글자를 끊는 규칙 때문에 "1 / 0"으로
          갈라져 보였다. 두 자리가 들어갈 폭을 주고 줄바꿈을 막는다. */}
      <span className="w-6 flex-shrink-0 whitespace-nowrap text-right text-sm font-bold tabular-nums text-neutral-900">
        {item.rank}
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-neutral-900 truncate">{item.term}</span>
      <ChangeIndicator item={item} />
    </button>
  );
}

export function PopularSearches({
  items,
  asOf,
  loading,
  onSelect,
}: {
  items: PopularSearch[];
  asOf: number | null;
  loading: boolean;
  onSelect: (term: string) => void;
}) {
  if (loading) {
    return <p className="text-sm text-neutral-400 py-12 text-center">불러오는 중...</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-neutral-400 py-12 text-center">
        아직 쌓인 검색 기록이 없습니다. 카드를 검색하면 여기에 순위가 쌓입니다.
      </p>
    );
  }

  const left = items.slice(0, 5);
  const right = items.slice(5, 10);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        {/* ⚠️ **구역마다 무게를 다르게 준다.** 예전엔 다섯 구역 제목이 전부 16px 굵게라
            무엇이 중요하고 무엇이 곁다리인지 화면이 말해 주지 않았다 — 스크롤해도 계속
            같은 것이 나오는 느낌이었다(2026-08-08 지적).
            기준은 **실제 쓰임**이다: 시세 검색 2,885회(79%) ↔ 뽑기 424회(12%).
            시세 쪽(인기 검색어·힛카드)을 크게, 나머지(상점·TOP 5·뉴스)를 작게 둔다. */}
        <p className="text-lg font-extrabold tracking-tight text-black">인기 검색어</p>
        {asOf && <p className="text-xs text-neutral-400">{formatAsOf(asOf)}</p>}
      </div>
      {/* ⚠️ 폰에서도 두 줄(5+5)로 세운다. 한 줄로 쌓으면 10칸이 516px이라 첫 화면을
          통째로 먹었다(실측 2026-08-04). 두 줄이면 272px이다.
          줄 안쪽 여백을 같이 줄여야 "리자몽 VSTAR" 같은 긴 이름이 안 잘린다 —
          여백을 그대로 두면 열 개 중 네 개가 잘렸다. */}
      {/* ⚠️ 폰에서도 두 줄(5+5)로 세운다. 한 줄로 쌓으면 10칸이 516px이라 첫 화면을
          통째로 먹었다(실측 2026-08-04). 두 줄이면 272px이다.
          ⚠️ 넓은 화면에서 5열로 펴 봤다가 **되돌렸다** — 자리는 줄지만 두 열로 세운
             지금이 더 낫다는 판단(2026-08-08 운영자). 바꾸지 말 것. */}
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
        <div className="space-y-1">
          {left.map((item) => (
            <Row key={item.term} item={item} onSelect={onSelect} />
          ))}
        </div>
        <div className="space-y-1">
          {right.map((item) => (
            <Row key={item.term} item={item} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}
