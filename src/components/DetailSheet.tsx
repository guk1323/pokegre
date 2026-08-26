import { useEffect, useRef, useState } from 'react';
import { 시트가스스로닫힘 } from '../lib/sheetHistory';

// 좁은 화면(폰)에서 상세를 아래에서 올라오는 시트로 덮어 보여준다. 큰 화면은 오른쪽
// 2단이 자연스럽지만, 폰에서 상세가 목록 맨 아래에 붙으면 눌러도 화면이 안 바뀌어
// "아무 일도 안 일어난" 것처럼 느껴진다.
//
// 목록은 시트 뒤에 그대로 남는다. 닫고 바로 옆 카드를 눌러 비교하는 게 시세 보는
// 핵심 동작이라, 목록 위치를 잃지 않는 게 중요하다.
//
// ── 2026-08-19 「부자연스럽다」(사장님)를 세 가지로 고쳤다 ──────────────────
// ① **손잡이·내용을 끌어내려 닫는다.** 회색 막대는 어느 앱에서나 「끌 수 있다」는
//    표시인데 탭만 됐다. 이제 손가락을 따라 내려오고, 많이 내리거나 빠르게 튕기면
//    닫히고, 어중간하면 제자리로 돌아온다. 내용을 맨 위까지 올린 상태에서 더
//    끌어내려도 같다(여느 앱의 시트와 같은 규칙).
// ② **닫힐 때도 스르륵 내려간다.** 열릴 때만 움직이고 닫힐 땐 툭 사라졌다 —
//    open이 false가 되는 순간 DOM이 없어지므로, 먼저 내려가는 모습을 보여 주고
//    190ms 뒤에 onClose를 부른다. 어느 길로 닫아도(끌기·탭·바깥·뒤로가기·Esc) 같다.
// ③ **시트 위로 뒤 목록이 한 뼘 보인다.** 머리말 밑까지 꽉 채우니 「창」이 아니라
//    「페이지가 통째로 바뀐 것」처럼 보였다. 24px을 비워 어두워진 목록이 보이면
//    "잠깐 덮어 놓은 것"이라는 느낌이 살고, 돌아갈 곳이 있다는 것도 보인다.
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
  // ⚠️ 닫힘 타이머(190ms)가 도는 사이 App이 먼저 닫고(뒤로가기) 사람이 **다른 카드를
  //    열면**, 타이머가 그 새 카드를 닫아 버린다 — open을 ref로 들고 타이머에서
  //    「아직 열려 있을 때만」 onClose를 부른다.
  const openRef = useRef(open);
  openRef.current = open;

  const 판넬ref = useRef<HTMLDivElement | null>(null);
  const 배경ref = useRef<HTMLButtonElement | null>(null);

  // ── 닫힘 애니메이션 ──────────────────────────────────────────────
  // open이 false면 바로 null을 돌려주므로, **부모에 알리기 전에** 내려가는 모습을
  // 먼저 그린다. 닫는중이 true인 190ms 동안 .sheet-panel-out(index.css)이 내려보내고,
  // 끝나면 onClose를 불러 진짜로 닫는다.
  // ⚠️ 끌어서 닫을 때는 이 클래스를 안 쓴다 — 이미 손가락 위치까지 내려가 있어서,
  //    0에서 다시 내려보내면 위로 튀었다 내려간다. 그 길은 inline transform으로 잇는다.
  const [닫는중, set닫는중] = useState(false);
  const 닫는중ref = useRef(false);
  const 스르륵닫기ref = useRef(() => {});
  스르륵닫기ref.current = () => {
    if (닫는중ref.current) return;
    닫는중ref.current = true;
    set닫는중(true);
    window.setTimeout(() => {
      닫는중ref.current = false;
      set닫는중(false);
      if (openRef.current) onCloseRef.current();
    }, 190);
  };

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
    // ⚠️ 이 길만 애니메이션 없이 **즉시** 닫는다 — popstate가 오면 App의 방문기록
    //    복원도 같이 돌아서 시트를 그 자리에서 걷어낸다. 여기서 190ms을 끌어 봐야
    //    App이 먼저 닫아 헛돈다(시험으로 확인). OS 뒤로가기는 즉시가 자연스럽기도 하다.
    const onPop = () => onCloseRef.current();
    window.history.pushState({ sheet: true }, '');
    window.addEventListener('popstate', onPop);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && 스르륵닫기ref.current();
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

  // ── 끌어서 닫기 ──────────────────────────────────────────────────
  // 규칙은 여느 앱의 시트와 같다:
  //  · 손잡이 줄에서는 **언제나** 끌린다.
  //  · 내용에서는 **맨 위로 스크롤돼 있을 때 아래로 끌면** 끌리기 시작한다.
  //    (그밖에는 그냥 내용 스크롤이다 — 둘이 싸우면 안 된다.)
  //  · 놓을 때: 시트 높이의 ¼ 넘게 내렸거나, 빠르게 아래로 튕겼으면 닫는다.
  //    아니면 제자리로 스르륵 돌아온다.
  // ⚠️ setState로 좌표를 옮기면 손가락마다 렌더가 돌아 뚝뚝 끊긴다. 움직임은 전부
  //    inline style로 직접 만지고, React 상태는 안 쓴다.
  // ⚠️ touchmove에서 preventDefault를 부르려면 passive:false로 직접 달아야 한다 —
  //    React의 onTouchMove는 passive라 막아지지 않는다.
  const 끌던손 = useRef({ 무시클릭: false });
  useEffect(() => {
    if (!open) return;
    const p = 판넬ref.current;
    if (!p) return;
    const s = { y0: 0, 손잡이: false, 끄는중: false, 이동: 0, y1: 0, t1: 0, 속도: 0 };

    const 시작 = (e: TouchEvent) => {
      if (닫는중ref.current) return;
      const t = e.touches[0];
      s.y0 = t.clientY;
      s.y1 = t.clientY;
      s.t1 = e.timeStamp;
      s.끄는중 = false;
      s.이동 = 0;
      s.속도 = 0;
      끌던손.current.무시클릭 = false;
      s.손잡이 = !!(e.target as HTMLElement).closest('[data-시트손잡이]');
    };

    const 이동중 = (e: TouchEvent) => {
      if (닫는중ref.current) return;
      const t = e.touches[0];
      const dy = t.clientY - s.y0;
      if (!s.끄는중) {
        // 손잡이는 무조건, 내용은 「맨 위 + 아래로」일 때만 끌기로 들어간다.
        // 6px 문턱: 탭이 끌기로 오인되지 않게.
        if (!(s.손잡이 ? Math.abs(dy) > 2 : p.scrollTop <= 0 && dy > 6)) return;
        s.끄는중 = true;
        p.style.transition = 'none';
        if (배경ref.current) 배경ref.current.style.transition = 'none';
      }
      e.preventDefault();
      s.이동 = Math.max(0, dy);
      if (s.이동 > 8) 끌던손.current.무시클릭 = true;
      p.style.transform = `translateY(${s.이동}px)`;
      // 시트가 내려간 만큼 뒤가 밝아진다 — 「닫히는 중」이라는 것이 손에서 보인다.
      if (배경ref.current)
        배경ref.current.style.opacity = String(Math.max(0.15, 1 - s.이동 / p.offsetHeight));
      const dt = e.timeStamp - s.t1;
      if (dt > 0) s.속도 = (t.clientY - s.y1) / dt;
      s.y1 = t.clientY;
      s.t1 = e.timeStamp;
    };

    const 놓음 = () => {
      if (!s.끄는중 || 닫는중ref.current) {
        s.끄는중 = false;
        return;
      }
      s.끄는중 = false;
      // 속도는 px/ms — 0.55면 손가락으로 가볍게 튕긴 정도다.
      const 닫을까 = s.이동 > p.offsetHeight * 0.25 || (s.속도 > 0.55 && s.이동 > 30);
      if (닫을까) {
        닫는중ref.current = true;
        p.style.transition = 'transform 0.2s ease-in';
        p.style.transform = 'translateY(105%)';
        if (배경ref.current) {
          배경ref.current.style.transition = 'opacity 0.2s ease-in';
          배경ref.current.style.opacity = '0';
        }
        window.setTimeout(() => {
          닫는중ref.current = false;
          if (openRef.current) onCloseRef.current();
        }, 190);
      } else {
        // 제자리로 — 열릴 때와 같은 곡선이라 한 동작처럼 느껴진다.
        p.style.transition = 'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)';
        p.style.transform = '';
        if (배경ref.current) {
          배경ref.current.style.transition = 'opacity 0.24s ease-out';
          배경ref.current.style.opacity = '';
        }
      }
    };

    p.addEventListener('touchstart', 시작, { passive: true });
    p.addEventListener('touchmove', 이동중, { passive: false });
    p.addEventListener('touchend', 놓음);
    p.addEventListener('touchcancel', 놓음);
    return () => {
      p.removeEventListener('touchstart', 시작);
      p.removeEventListener('touchmove', 이동중);
      p.removeEventListener('touchend', 놓음);
      p.removeEventListener('touchcancel', 놓음);
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
        ref={배경ref}
        type="button"
        aria-label="닫기"
        onClick={() => 스르륵닫기ref.current()}
        className={`sheet-backdrop absolute inset-x-0 bg-black/40 ${닫는중 ? 'sheet-backdrop-out' : ''}`}
        // ⚠️ 어두운 막도 띠 **위에서** 끝낸다. 막이 띠를 덮으면 「비교하기」가 안 눌린다.
        style={{ top: topGap, bottom: 아래막힘 }}
      />
      {/* 폰에서는 화면 폭을 꽉 채우고, 태블릿·좁은 PC(768~1023px)에서는 가운데로 모아
          너무 옆으로 늘어지지 않게 한다 — 아래에서 올라오는 시트의 보편적인 모양이다.
          sm 이상에서는 아래쪽 모서리도 둥글리고 살짝 띄운다. */}
      <div
        ref={판넬ref}
        className={`sheet-panel relative mx-auto w-full overflow-y-auto rounded-t-2xl bg-white px-4 pb-8 shadow-xl sm:mb-3 sm:max-w-lg sm:rounded-2xl ${닫는중 ? 'sheet-panel-out' : ''}`}
        // ⚠️⚠️ **아래에 깔린 띠(비교 담기 바)만큼 짧게 하고 그만큼 띄운다.**
        //    처음엔 CSS로 `padding-bottom`만 더했는데, 그러면 **패널이 길어져 화면 밖으로
        //    내려갈 뿐**이라 가려지는 양이 오히려 31px → 46px로 늘었다(실측).
        //    높이를 줄이고(`max-height`) 위로 밀어야(`margin-bottom`) 실제로 자리가 난다.
        // ⚠️ topGap에 24를 더한다(위 ③) — 그만큼 시트가 낮아져 어두워진 목록이 위로
        //    한 뼘 보인다. 머리말과 겹칠 일은 없다(더 짧아질 뿐이다).
        style={{ maxHeight: `calc(100dvh - ${topGap + 24}px - ${아래막힘}px)`, marginBottom: 아래막힘 || undefined }}
      >
        {/* 손잡이 — 끌어내려 닫거나(위 「끌어서 닫기」), 탭해도 닫힌다(배경 탭·뒤로가기로도
            닫힘). 회색 바만 두면 눌리는지 알 수 없어서, 위아래 여백까지 품은 버튼으로
            만들어 손가락으로 누를 영역을 넉넉히 준다. sticky로 위에 고정해 시트를
            스크롤해도 손잡이가 늘 손에 닿는다.
            z-10: sticky만으로는 스크롤되는 콘텐츠(카드 이미지·등급 카드)가 손잡이 위를
            지나가 가려진다. 손잡이가 늘 맨 앞에 있어야 한다.
            아래 옅은 경계선은 스크롤된 콘텐츠와 손잡이 영역을 구분해준다. */}
        <div data-시트손잡이 className="sticky top-0 z-10 -mx-4 flex items-center justify-center border-b border-neutral-100 bg-white py-3">
          {/* ⚠️ 누를 자리를 py-1(14px)에서 py-4(44px)로 넓혔다. 보이는 회색 막대는
              그대로다 — 시트를 닫는 유일한 손잡이인데 손가락으로 놓치기 쉬웠다
              (운영자 지시 2026-08-06). 바깥 div의 py-3은 그대로라 시트 높이는 안 변한다.
              ⚠️ 끌다 놓은 손이 클릭으로 이어지면 「제자리로 돌아왔는데 닫힘」이 된다 —
              8px 넘게 움직였으면 클릭은 무시한다(끌던손.무시클릭). */}
          <button
            type="button"
            aria-label="닫기"
            onClick={() => {
              // ⚠️ 표식은 **한 번 쓰고 바로 지운다.** 안 지우면(끌기 뒤 click이 안 온
              //    경우 등) 다음 진짜 탭까지 잡아먹는다 — 시험에서 실제로 걸렸다.
              //    진짜 탭은 touchstart가 먼저 와서 표식을 새로 지우므로 안 걸린다.
              if (끌던손.current.무시클릭) {
                끌던손.current.무시클릭 = false;
                return;
              }
              스르륵닫기ref.current();
            }}
            className="-my-3 px-10 py-[1.15rem]"
          >
            <span className="block h-1.5 w-12 rounded-full bg-neutral-300" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
