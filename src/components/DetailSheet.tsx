import { useEffect, useRef } from 'react';

// 좁은 화면(폰)에서 상세를 아래에서 올라오는 시트로 덮어 보여준다. 큰 화면은 오른쪽
// 2단이 자연스럽지만, 폰에서 상세가 목록 맨 아래에 붙으면 눌러도 화면이 안 바뀌어
// "아무 일도 안 일어난" 것처럼 느껴진다.
//
// 목록은 시트 뒤에 그대로 남는다. 닫고 바로 옆 카드를 눌러 비교하는 게 시세 보는
// 핵심 동작이라, 목록 위치를 잃지 않는 게 중요하다.
export function DetailSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  // 시트가 열리면 뒤 목록이 스크롤되지 않게 막는다. 안 막으면 시트 안에서 스크롤하다
  // 끝에 닿는 순간 뒤 목록이 밀려 올라가 위치를 잃는다.
  // onClose는 부모가 렌더할 때마다 새 함수라, 의존성에 넣으면 effect가 매 렌더
  // 정리·재실행된다. 정리에서 history.back()을 부르므로, 열자마자 스스로 popstate를
  // 일으켜 닫혀 버린다("번쩍이다 사라짐"). ref로 최신 onClose를 참조하고 effect는
  // open에만 반응하게 한다.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // 시트는 lg 이상에서 CSS(lg:hidden)로 감춰지지만 open은 그대로 true라, 이 effect는
    // 넓은 화면에서도 실행된다. 그때 body를 잠그면 화면엔 시트가 없는데 목록 스크롤만
    // 죽는다("PC 전체화면에서 스크롤 안 됨"). 시트가 실제로 뜨는 좁은 화면에서만 잠근다.
    const narrow = window.matchMedia('(max-width: 1023px)');
    if (!narrow.matches) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 뒤로가기(안드로이드 물리 버튼 포함)로 닫히게 한다. 폰에서 X를 찾는 것보다
    // 뒤로가기가 자연스럽다.
    const onPop = () => onCloseRef.current();
    window.history.pushState({ sheet: true }, '');
    window.addEventListener('popstate', onPop);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      // 우리가 쌓은 history 항목을 정리한다. 이미 뒤로가기로 닫혔으면 건너뛴다.
      if (window.history.state?.sheet) window.history.back();
    };
  }, [open]);

  if (!open) return null;

  return (
    // lg 이상에서는 오른쪽 2단을 쓰므로 시트를 감춘다.
    <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true">
      {/* 바깥(어두운 곳)을 누르면 닫힌다. */}
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white px-4 pb-8 shadow-xl">
        {/* 손잡이를 눌러도 닫힌다. 회색 바만 두면 눌리는지 알 수 없어서, 위아래 여백까지
            품은 버튼으로 만들어 손가락으로 누를 영역을 넉넉히 준다. sticky로 위에 고정해
            시트를 스크롤해도 손잡이가 늘 손에 닿는다. */}
        {/* z-10: sticky만으로는 스크롤되는 콘텐츠(카드 이미지·등급 카드)가 손잡이 위를
            지나가 가려진다. 손잡이가 늘 맨 앞에 있어야 한다.
            아래 옅은 경계선은 스크롤된 콘텐츠와 손잡이 영역을 구분해준다. */}
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="sticky top-0 z-10 -mx-4 flex w-[calc(100%+2rem)] justify-center border-b border-neutral-100 bg-white py-3"
        >
          <span className="h-1.5 w-12 rounded-full bg-neutral-300" />
        </button>
        {children}
      </div>
    </div>
  );
}
