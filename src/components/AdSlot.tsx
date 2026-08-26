import { useEffect, useRef, useState } from 'react';
import { 광고켬, 광고시험중, 광고클라이언트, 광고슬롯, 광고스크립트달기 } from '../lib/ads';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * 광고 자리 하나. **꺼져 있으면(승인 전) null** — 화면에 흔적이 없다.
 *
 * 자리 규칙(애드센스 정책 · 2026-08-20 조사):
 * - 개수 제한은 없지만 **폰에서 광고가 본문 세로의 30%를 넘으면** 크롬이 광고를
 *   통째로 막는다. 우리 화면은 세로 4,000px대라 자리 14곳을 다 켜도 5% 안팎이다.
 * - **누르는 것(카드·단추) 바로 옆에 붙이지 않는다** — 잘못 눌림은 계정 정지 사유다.
 *   그래서 격자 안에서는 줄 전체(col-span-full)를 먹고 위아래 여백(my-4)을 둔다.
 * - 「광고」 딱지를 붙인다 — 카드 그림 사이에 끼므로 내용과 헷갈리면 안 된다.
 *
 * SPA에서 다시 채우기: 화면(view)이 바뀌면 이 부품이 새로 mount되므로 그때마다
 * push를 다시 부른다. **사용자가 눌러서 바뀐 화면**에서만 새 광고가 나가는 셈이라
 * 정책(사용자 행동 기반 새로고침)에 맞는다. 가만히 있는데 저절로 바꾸지 않는다.
 */
export function AdSlot({
  형태,
  이름,
  높이,
  className = '',
}: {
  형태: '네모' | '가로';
  이름: string;
  /** 자리 최소 높이(px). 안 주면 네모 250 · 가로 100. 예약해 둬야 광고가 늦게 와도 화면이 안 밀린다. */
  높이?: number;
  className?: string;
}) {
  // 시험 표시는 첫 그림에서 한 번만 판단한다 — 렌더마다 주소를 읽으면 낭비다.
  const [보임] = useState(() => 광고켬 || 광고시험중());
  const insRef = useRef<HTMLModElement | null>(null);
  const 넣었나 = useRef(false);

  useEffect(() => {
    if (!광고켬 || 넣었나.current || !insRef.current) return;
    // ⚠️ 화면 폭별 복제 자리(줄 경계 맞추기용 — 아래 격자들 참고)는 CSS로 숨는다.
    //    숨은 자리가 광고를 요청하면 「안 보이는 광고」로 정책 위반이라, 실제로
    //    보이는 것만 요청한다. 창 크기를 바꾸면 새로 고침해야 채워지는데, 그 정도는
    //    감수한다 — 폰↔PC를 오가며 창을 늘리는 사람은 거의 없다.
    if (insRef.current.offsetWidth === 0) return;
    넣었나.current = true;
    광고스크립트달기();
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* 광고 차단기 등 — 조용히 넘어간다. 사이트 기능과 무관하다. */
    }
  }, []);

  if (!보임) return null;

  const minHeight = 높이 ?? (형태 === '네모' ? 250 : 100);
  return (
    <div className={`my-4 w-full ${className}`} data-광고자리={이름}>
      <div className="mb-1 text-center text-[10px] tracking-widest text-neutral-400">광고</div>
      {광고켬 ? (
        <ins
          ref={insRef}
          className="adsbygoogle"
          style={{ display: 'block', minHeight }}
          data-ad-client={광고클라이언트}
          data-ad-slot={광고슬롯[형태]}
          data-ad-format={형태 === '네모' ? 'rectangle' : 'horizontal'}
          data-full-width-responsive="true"
        />
      ) : (
        <div
          style={{ minHeight }}
          className="grid place-items-center rounded-lg border border-dashed border-neutral-300 text-xs text-neutral-400"
        >
          광고 자리 · {이름}
        </div>
      )}
    </div>
  );
}

/**
 * PC 옆구리(양옆 빈 칸) 두 자리. 화면 1600px부터 나오고 좁으면 CSS가 감춘다
 * (index.css의 .ad-rail — 1600px에서 160 폭, 1840px부터 300 폭).
 * 본문(max-w-6xl=1152px) 바깥 죽는 자리만 쓰므로 내용은 안 가린다.
 */
export function AdRails() {
  if (!광고켬 && !광고시험중()) return null;
  return (
    <>
      <div className="ad-rail left">
        <AdSlot 형태="네모" 이름="옆구리-왼쪽" 높이={600} className="my-0" />
      </div>
      <div className="ad-rail right">
        <AdSlot 형태="네모" 이름="옆구리-오른쪽" 높이={600} className="my-0" />
      </div>
    </>
  );
}
