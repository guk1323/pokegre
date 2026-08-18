import { useEffect, useRef, useState } from 'react';
import { 시트가스스로닫힘 } from '../lib/sheetHistory';

// 좁은 화면(폰)에서 상세를 아래에서 올라오는 시트로 덮어 보여준다. 큰 화면은 오른쪽
// 2단이 자연스럽지만, 폰에서 상세가 목록 맨 아래에 붙으면 눌러도 화면이 안 바뀌어
// "아무 일도 안 일어난" 것처럼 느껴진다.
//
// 목록은 시트 뒤에 그대로 남는다. 닫고 바로 옆 카드를 눌러 비교하는 게 시세 보는
// 핵심 동작이라, 목록 위치를 잃지 않는 게 중요하다.
export function DetailSheet({
  open,
  onClose,
  아래막힘 = 0,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** 화면 아래에 깔린 고정 띠의 높이(px). 그만큼 시트를 짧게 하고 위로 띄운다. */
  아래막힘?: number;
  children: React.ReactNode;
}) {
  // 시트가 열리면 뒤 목록이 스크롤되지 않게 막는다. 안 막으면 시트 안에서 스크롤하다
  // 끝에 닿는 순간 뒤 목록이 밀려 올라가 위치를 잃는다.
  // onClose는 부모가 렌더할 때마다 새 함수라, 의존성에 넣으면 effect가 매 렌더
  // 정리·재실행된다. 정리에서 history.back()을 부르므로, 열자마자 스스로 popstate를
  // 일으켜 닫혀 버린다("번쩍이다 사라짐"). ref로 최신 onClose를 참조하고 effect는
  // open에만 반응하게 한다.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 시트가 상단 메뉴를 덮지 않게, 머리말 높이만큼 자리를 비워 둔다.
  // 예전엔 높이를 85dvh로 못 박아 뒀는데, 폰에서 스크롤하면 주소창이 숨으면서 dvh가
  // 커져 시트가 그만큼 더 올라와 메뉴를 파고들었다("카테고리랑 겹쳐서 페이지가 안 넘어감").
  // 머리말은 글자 줄바꿈에 따라 높이가 달라지므로 열 때 재서 쓴다.
  const [topGap, setTopGap] = useState(160);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      // ⚠️ 높이(height)가 아니라 화면에서 머리말이 "끝나는 자리"(bottom)를 쓴다.
      //    높이로 재면 페이지가 스크롤돼 머리말이 위로 밀려 나갔을 때도 그 높이만큼
      //    비워 버려서, 시트 위에 검색창 같은 뒷 내용이 어중간하게 남는다(지적받음).
      //    스크롤로 머리말이 다 지나갔으면 bottom이 음수가 되므로 0으로 붙잡아,
      //    시트가 화면을 거의 꽉 채우게 한다.
      const bottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      // 머리말 아래로 조금 더 띄워 메뉴가 온전히 보이고 눌리게 한다.
      setTopGap(Math.max(0, Math.round(bottom)) + 8);
    };
    measure();
    // 머리말은 글꼴이 늦게 오거나 글자가 줄바꿈되면 높이가 뒤늦게 바뀐다. 열 때 한 번만
    // 재면 그 전 높이로 굳어 시트가 메뉴를 파고든다(실제로 101px로 재서 그랬다).
    // 크기가 바뀔 때마다 다시 잰다.
    const header = document.querySelector('header');
    const ro = header ? new ResizeObserver(measure) : null;
    if (header && ro) ro.observe(header);
    window.addEventListener('resize', measure);
    // 시트를 여는 순간의 스크롤 위치에 따라 머리말이 얼마나 보이는지가 달라진다.
    // 열린 뒤에는 뒤 목록이 잠기므로 한 번 더 재는 것으로 충분하지만, 주소창이
    // 접히거나 펴지면 위치가 밀리므로 스크롤도 같이 듣는다.
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // 시트는 lg 이상에서 CSS(lg:hidden)로 감춰지지만 open은 그대로 true라, 이 effect는
    // 넓은 화면에서도 실행된다. 그때 body를 잠그면 화면엔 시트가 없는데 목록 스크롤만
    // 죽는다("PC 전체화면에서 스크롤 안 됨"). 시트가 실제로 뜨는 좁은 화면에서만 잠근다.
    // ⚠️⚠️ **창이 넓어지면 잠금을 풀어야 한다.** 예전엔 열 때 한 번만 재고 끝이라,
    //    좁은 화면에서 카드를 열어 잠근 뒤 창을 넓히면(또는 폰을 돌리면) **시트는
    //    사라지는데 잠금만 남았다.** 화면엔 아무것도 안 뜬 채 스크롤만 죽는다
    //    (사장님 지적 2026-08-15: "스크롤하기 너무 어려워" · 실측: 폭 1280 · 시트 안
    //    보임 · body overflow hidden · 내용 3,160px 중 720px만 보임).
    //    그래서 `change`를 듣고 넓어지면 바로 되돌린다.
    const narrow = window.matchMedia('(max-width: 1023px)');
    const prev = document.body.style.overflow;
    const 잠그기 = () => {
      if (narrow.matches) {
        document.body.style.overflow = 'hidden';
        document.documentElement.dataset.sheet = 'open';
      } else {
        document.body.style.overflow = prev;
        delete document.documentElement.dataset.sheet;
      }
    };
    narrow.addEventListener('change', 잠그기);
    if (!narrow.matches) {
      // 넓은 화면에서는 잠그지 않지만, **넓어졌을 때 풀 수 있게** 듣기는 계속한다.
      return () => narrow.removeEventListener('change', 잠그기);
    }

    document.body.style.overflow = 'hidden';
    // 시트가 열린 동안 머리말의 로고·소개글을 접는다(index.css). 폰에서 머리말이
    // 812px 중 310px를 차지한 채 굳어 있어 "위가 통째로 멈춘" 것처럼 보였다.
    // 접으면 메뉴 줄만 남아 시트가 그만큼 더 올라온다. 메뉴는 그대로 눌린다.
    // 접히면 머리말 높이가 줄고, 위 ResizeObserver가 그걸 보고 topGap을 다시 잰다.
    document.documentElement.dataset.sheet = 'open';
    // 뒤로가기(안드로이드 물리 버튼 포함)로 닫히게 한다. 폰에서 X를 찾는 것보다
    // 뒤로가기가 자연스럽다.
    const onPop = () => onCloseRef.current();
    window.history.pushState({ sheet: true }, '');
    window.addEventListener('popstate', onPop);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      narrow.removeEventListener('change', 잠그기);
      document.body.style.overflow = prev;
      delete document.documentElement.dataset.sheet;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      // 우리가 쌓은 history 항목을 정리한다. 이미 뒤로가기로 닫혔으면 건너뛴다.
      // ⚠️ 이 back()으로 돌아가는 칸에는 **시트를 열기 전** 화면 상태가 적혀 있다.
      //    그대로 두면 App이 그걸 복원해, 시트가 열려 있는 동안 바뀐 것(마켓·검색어)이
      //    통째로 되돌아간다. 표식을 세워 그 복원만 건너뛰게 한다(lib/sheetHistory.ts).
      if (window.history.state?.sheet) {
        시트가스스로닫힘.on = true;
        window.history.back();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    // lg 이상에서는 오른쪽 2단을 쓰므로 시트를 감춘다.
    <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true">
      {/* 바깥(어두운 곳)을 누르면 닫힌다. */}
      {/* 어두운 막도 머리말 아래에서 시작한다. 화면을 통째로 덮으면 메뉴가 흐려 보이고,
          메뉴를 눌러도 막이 먼저 먹어서 시트만 닫힌다 — 한 번에 안 넘어간다. */}
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="sheet-backdrop absolute inset-x-0 bg-black/40"
        // ⚠️ 어두운 막도 띠 **위에서** 끝낸다. 막이 띠를 덮으면 「비교하기」가 안 눌린다.
        style={{ top: topGap, bottom: 아래막힘 }}
      />
      {/* 폰에서는 화면 폭을 꽉 채우고, 태블릿·좁은 PC(768~1023px)에서는 가운데로 모아
          너무 옆으로 늘어지지 않게 한다 — 아래에서 올라오는 시트의 보편적인 모양이다.
          sm 이상에서는 아래쪽 모서리도 둥글리고 살짝 띄운다. */}
      <div
        className="sheet-panel relative mx-auto w-full overflow-y-auto rounded-t-2xl bg-white px-4 pb-8 shadow-xl sm:mb-3 sm:max-w-lg sm:rounded-2xl"
        // ⚠️⚠️ **아래에 깔린 띠(비교 담기 바)만큼 짧게 하고 그만큼 띄운다.**
        //    처음엔 CSS로 `padding-bottom`만 더했는데, 그러면 **패널이 길어져 화면 밖으로
        //    내려갈 뿐**이라 가려지는 양이 오히려 31px → 46px로 늘었다(실측).
        //    높이를 줄이고(`max-height`) 위로 밀어야(`margin-bottom`) 실제로 자리가 난다.
        style={{ maxHeight: `calc(100dvh - ${topGap}px - ${아래막힘}px)`, marginBottom: 아래막힘 || undefined }}
      >
        {/* 손잡이를 눌러 닫는다(배경 어두운 곳 탭·뒤로가기로도 닫힘). 회색 바만 두면
            눌리는지 알 수 없어서, 위아래 여백까지 품은 버튼으로 만들어 손가락으로 누를
            영역을 넉넉히 준다. sticky로 위에 고정해 시트를 스크롤해도 손잡이가 늘 손에
            닿는다. 시트는 아래에서 올라오는 형태라 코너 X 대신 손잡이가 표준 닫기 표시다.
            z-10: sticky만으로는 스크롤되는 콘텐츠(카드 이미지·등급 카드)가 손잡이 위를
            지나가 가려진다. 손잡이가 늘 맨 앞에 있어야 한다.
            아래 옅은 경계선은 스크롤된 콘텐츠와 손잡이 영역을 구분해준다. */}
        <div className="sticky top-0 z-10 -mx-4 flex items-center justify-center border-b border-neutral-100 bg-white py-3">
          {/* ⚠️ 누를 자리를 py-1(14px)에서 py-4(44px)로 넓혔다. 보이는 회색 막대는
              그대로다 — 시트를 닫는 유일한 손잡이인데 손가락으로 놓치기 쉬웠다
              (운영자 지시 2026-08-06). 바깥 div의 py-3은 그대로라 시트 높이는 안 변한다. */}
          <button type="button" aria-label="닫기" onClick={onClose} className="-my-3 px-10 py-[1.15rem]">
            <span className="block h-1.5 w-12 rounded-full bg-neutral-300" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
