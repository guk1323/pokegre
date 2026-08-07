import { useEffect, useState } from 'react';
import { trackEvent } from '../api/localStats';

// 감정 수량. "이 카드가 전 세계에 감정된 게 몇 장인가"를 보여준다.
//
// 왜 넣었나: 옛 카드는 **감정 안 된 값이 아무 뜻이 없다**. 미감정 2천원짜리가 PSA 10에선
// 14만원에 팔린다(2003 나무돌이 004/019, 2026-04-03 이베이 낙찰). 표본 1,836장을 재 보니
// "미감정 5달러 이하인데 PSA 10은 50달러 이상"이 128장(7%)이었다. 시세만 보여 주면
// 이런 카드를 싸구려로 오해하게 된다.
//
// 감정 수량은 그 이유를 값이 아니라 **희소성**으로 설명해 준다 — 나무돌이 005는 전
// 세계에 감정된 게 7장뿐이고 그중 PSA 10은 2장이다. 그래서 낙찰 기록이 하나도 없는
// 카드에도 붙일 수 있다(이게 이베이 시세로는 못 메우던 구멍이다).
//
// ⚠️ 크레딧을 쓰지 않는다. 하루 한 번 통째로 받아 둔 것을 그대로 읽는다.

interface Population {
  psa10?: number;
  psa9?: number;
  psaAll?: number;
  all: number;
  gem?: number;
}

interface Extra {
  population: Population | null;
  받은날: string | null;
}

// 감정된 게 이보다 적으면 "아주 적다"고 알린다. 이 아래에선 미감정 시세를 그대로
// 믿으면 안 된다 — 감정품이 몇 장 없으니 값이 훨씬 높게 잡히는 일이 잦다.
const 적음 = 50;

export function GradedPopulation({ tcgPlayerId }: { tcgPlayerId: string }) {
  const [것, set것] = useState<Extra | null>(null);

  useEffect(() => {
    if (!tcgPlayerId) return;
    let 살아있음 = true;
    set것(null);
    fetch(`/api/local/card-extra?id=${encodeURIComponent(tcgPlayerId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Extra | null) => {
        if (!살아있음 || !j?.population) return;
        set것(j);
        trackEvent('population');
      })
      .catch(() => undefined);
    return () => {
      살아있음 = false;
    };
  }, [tcgPlayerId]);

  const p = 것?.population;
  if (!p || !(p.all > 0)) return null;

  const 줄: { 이름: string; 값: string }[] = [];
  if (p.psa10 != null) 줄.push({ 이름: 'PSA 10', 값: `${p.psa10.toLocaleString()}장` });
  if (p.psa9 != null) 줄.push({ 이름: 'PSA 9', 값: `${p.psa9.toLocaleString()}장` });
  줄.push({ 이름: '전체', 값: `${p.all.toLocaleString()}장` });

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-700">감정 수량</p>
        {p.gem != null && <p className="text-[11px] text-neutral-400">10등급 비율 {p.gem}%</p>}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {줄.map((r) => (
          <div key={r.이름} className="flex items-baseline gap-1.5">
            <span className="text-xs text-neutral-500">{r.이름}</span>
            <span className="text-sm font-semibold text-black">{r.값}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-neutral-400">
        {p.all < 적음
          ? '감정된 카드가 매우 적습니다. 감정품 시세는 위 미감정 시세와 크게 다를 수 있습니다.'
          : '지금까지 감정 기관(PSA·BGS·CGC·SGC)이 매긴 등급의 장수입니다.'}
      </p>
    </div>
  );
}
