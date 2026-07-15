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
      className="w-full flex items-center gap-3 rounded-lg bg-neutral-50 hover:bg-neutral-100 px-4 py-3 text-left"
    >
      <span className="w-4 flex-shrink-0 text-sm font-bold text-neutral-900">{item.rank}</span>
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
        아직 쌓인 검색 기록이 없어요. 카드를 검색하면 여기에 순위가 쌓입니다.
      </p>
    );
  }

  const left = items.slice(0, 5);
  const right = items.slice(5, 10);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-base font-bold text-neutral-900">인기 검색어</p>
        {asOf && <p className="text-xs text-neutral-400">{formatAsOf(asOf)}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
