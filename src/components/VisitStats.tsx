import { useEffect, useState } from 'react';
import { fetchVisitStats, type VisitStat } from '../api/localStats';

// 화면에 보여줄 최근 일수. 그보다 오래된 날은 합계에만 들어간다.
const RECENT_DAYS = 30;

function formatDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}.${d.getDate()}(${wd})`;
}

export function VisitStats() {
  const [items, setItems] = useState<VisitStat[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchVisitStats()
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-neutral-400 py-12 text-center">불러오는 중...</p>;
  if (error) return <p className="text-sm text-neutral-400 py-12 text-center">방문 통계를 불러오지 못했습니다.</p>;

  // 최근 것부터 위로. 막대 길이는 최근 구간의 최댓값 기준으로 맞춘다.
  const recent = items.slice(-RECENT_DAYS).reverse();
  const max = Math.max(1, ...recent.map((d) => d.count));
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = items.find((d) => d.date === today)?.count ?? 0;

  return (
    <div>
      <h2 className="text-base font-bold text-black mb-4">방문 통계</h2>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-xs text-neutral-500">오늘 방문</p>
          <p className="text-2xl font-bold text-black mt-1">{todayCount.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-xs text-neutral-500">전체 누적</p>
          <p className="text-2xl font-bold text-black mt-1">{total.toLocaleString()}</p>
        </div>
      </div>

      {recent.length === 0 ? (
        <p className="text-sm text-neutral-400 py-8 text-center rounded-xl border border-dashed border-neutral-200">
          아직 방문 기록이 없어요.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {recent.map((d) => (
            <li key={d.date} className="flex items-center gap-2">
              <span className="w-16 flex-shrink-0 text-xs text-neutral-500">{formatDay(d.date)}</span>
              <div className="h-5 flex-1 rounded bg-neutral-100">
                <div
                  className="h-5 rounded bg-[#2a78d6]"
                  style={{ width: `${Math.max(2, (d.count / max) * 100)}%` }}
                />
              </div>
              <span className="w-10 flex-shrink-0 text-right text-xs font-semibold text-neutral-700">
                {d.count.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-neutral-400">
        같은 브라우저는 하루 한 번만 집계됩니다. IP·기기·회원 정보는 저장하지 않아요.
      </p>
    </div>
  );
}
