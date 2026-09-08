import { useMemo, useState } from 'react';
import { kstDateStr } from '../lib/kstDay';

/**
 * 날짜별 방문 달력. **고르는 자리일 뿐, 내용은 여기서 안 그린다.**
 *
 * ⚠️⚠️ 처음엔 이 부품이 그날 유입·기능·작가·세트를 **직접 펼쳤다**(2026-08-16). 그런데
 *    같은 네 가지를 위쪽에서도 「최근 14일」·「전체」로 보여 주고 있어서 **한 화면에 같은
 *    것이 두 벌**이었다(사장님 지적: "달력에 있는 내용은 중복 없게").
 *    → 달력은 **날짜를 고르는 일만** 하고, 내용은 화면 아래 한 자리에서만 그린다.
 *      기간 단추(오늘·7일·30일·전체)와 달력이 **같은 자리를 바꿔 그린다.**
 *
 * ⚠️ **날짜는 한국시간으로 끊는다.** 서버가 그렇게 담으므로 화면도 같아야 한다
 *    (예전에 여기만 UTC였다가 오전 9시까지 하루가 어긋난 적이 있다).
 */

const 요일 = ['일', '월', '화', '수', '목', '금', '토'];

export function StatsCalendar({
  방문,
  고른날,
  고르기,
}: {
  방문: { date: string; count: number }[];
  /** 지금 고른 날. 기간 단추를 누르면 null이 되어 아무 칸도 안 켜진다. */
  고른날: string | null;
  고르기: (날: string) => void;
}) {
  const 방문표 = useMemo(() => Object.fromEntries(방문.map((d) => [d.date, d.count])), [방문]);
  const 오늘 = kstDateStr();

  // 자료가 있는 달만 보여 준다. 없는 달을 넘겨 봐야 빈 칸만 나온다.
  const 달들 = useMemo(() => {
    const s = new Set<string>();
    for (const d of 방문) s.add(d.date.slice(0, 7));
    if (!s.size) s.add(오늘.slice(0, 7));
    return [...s].sort();
  }, [방문, 오늘]);

  const [달, set달] = useState(() => 달들[달들.length - 1]);

  const 칸들 = useMemo(() => {
    const [y, m] = 달.split('-').map(Number);
    const 앞빈칸 = new Date(y, m - 1, 1).getDay();
    const 끝날 = new Date(y, m, 0).getDate();
    const out: (string | null)[] = [];
    for (let i = 0; i < 앞빈칸; i++) out.push(null);
    for (let d = 1; d <= 끝날; d++) out.push(`${달}-${String(d).padStart(2, '0')}`);
    return out;
  }, [달]);

  const 최대방문 = useMemo(() => Math.max(1, ...방문.map((d) => d.count)), [방문]);
  const 달자리 = 달들.indexOf(달);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={달자리 <= 0}
            onClick={() => set달(달들[달자리 - 1])}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-600 disabled:opacity-30"
          >
            ←
          </button>
          <span className="text-sm font-bold text-black">
            {달.split('-')[0]}년 {Number(달.split('-')[1])}월
          </span>
          <button
            type="button"
            disabled={달자리 >= 달들.length - 1}
            onClick={() => set달(달들[달자리 + 1])}
            className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-600 disabled:opacity-30"
          >
            →
          </button>
        </div>
        <span className="text-[11px] text-neutral-500">진할수록 방문 많음 · 날짜를 누르면 그날만 봅니다</span>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {요일.map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] text-neutral-500">
            {w}
          </div>
        ))}
        {칸들.map((iso, i) => {
          if (!iso) return <div key={`b${i}`} />;
          const 수 = 방문표[iso] ?? 0;
          // ⚠️⚠️ **제일 진한 칸에서 0.9까지 가면 안 된다.** 그러면 칸 색이 너무 진해져
          //    그 위의 날짜·숫자가 밝은 화면에서 4.4, 어두운 화면에서 2.5까지 떨어진다
          //    (2026-08-27 실측). 0.55에서 멈추면 두 화면 다 5를 넘고, 옅은 칸과 진한 칸의
          //    차이는 그대로 보인다.
          const 진하기 = 수 ? 0.12 + 0.43 * (수 / 최대방문) : 0;
          const 고름 = iso === 고른날;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => 고르기(iso)}
              className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border text-xs ${
                고름 ? 'border-black ring-1 ring-black' : 'border-neutral-200'
              }`}
              /* ⚠️ 초록 농도는 인라인으로 준다 — Tailwind는 안 쓴 색을 안 내보내서
                 `bg-emerald-500/37` 같은 동적 클래스는 빌드에 안 들어간다. */
              style={{ background: 수 ? `rgba(16,150,110,${진하기})` : undefined }}
            >
              <span className="text-neutral-800">{Number(iso.slice(8))}</span>
              {!!수 && <span className="text-[10px] text-neutral-700">{수}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
