import { useState } from 'react';

// 홈 상단 공지 배너. 운영자 인사말을 그대로 보여준다(항목 나열이 아니라 편지 형식).
//
// 한 번 닫으면 다시 안 뜬다. 새 공지를 올릴 땐 아래 제목·날짜·본문을 바꾸고 DISMISS_KEY
// 뒤 날짜도 함께 바꾸면(예: _v20260726 → _v20260810) 닫았던 사람에게도 다시 뜬다.
const DISMISS_KEY = 'pokegre_notice_dismissed_v20260818';
const TITLE = '업데이트 내역';
const NOTICE_DATE = '2026년 8월 18일';
// ⚠️⚠️ **내가 무엇을 고쳤나가 아니라, 오시는 분이 무엇을 할 수 있게 됐나로 쓴다.**
//    사장님께 열 번 넘게 지적받은 자리다. 「도감을 PPT로 다시 만들었습니다」·「크레딧을
//    0으로 줄였습니다」 같은 말은 안쪽 사정이라 여기 안 적는다.
// ⚠️ 앞일을 못 박는 말(무료·광고 없음·앞으로 계속)은 쓰지 않는다.
// ⚠️ **세 토막으로 나눠 둔다.** 예전엔 한 문자열이었는데, 게임 줄 **옆에** 단추를
//    붙이려면 그 줄만 따로 잡을 수 있어야 한다.
const HELLO = '안녕하세요. pokegre 운영자입니다.';
// ⚠️ 인쇄판 이야기는 뺐다(사장님 2026-08-18: 「설명이 너무 길다」). 한 번에 하나만 알린다.
const NEWS = '도구 ▸ 미니게임에 포켓몬 디펜스를 열었습니다.';
const OUTRO = `부족한 부분이나 필요한 기능은 게시판에 편하게 남겨주세요.

pokegre 올림.`;

// 고개 숙여 인사하는 그림. 사이트가 흑백 톤이라 선 하나로 그리고 색은 글자색을 따른다.
// 포켓몬 캐릭터는 저작권이 있어 쓸 수 없으므로 직접 그린 그림이다.
function BowingFigure({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className} fill="none">
      {/* 다리 — 바닥에 붙어 있다 */}
      <path d="M21 58 L21 46" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      {/* 허리에서 앞으로 굽힌 몸통 */}
      <path d="M21 46 C22 38 28 33 36 31" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      {/* 아래로 늘어뜨린 팔 */}
      <path d="M30 36 C31 42 32 46 33 49" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      {/* 머리 — 몸보다 크게 그려야 귀엽다 */}
      <circle cx="45" cy="28" r="11" fill="currentColor" />
      {/* 인사 표시 */}
      <path d="M54 12 L57 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <path d="M50 10 L51 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function alreadyDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** `onOpenGame`을 주면 공지 안에 「열어 보기」 단추가 뜬다. 안 주면 글만 나온다. */
export function OnboardingBanner({ onOpenGame }: { onOpenGame?: () => void }) {
  const [shown, setShown] = useState(() => !alreadyDismissed());

  if (!shown) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // 시크릿 모드 등에서 저장이 막혀도 이번 세션에서는 닫히게 둔다.
    }
    setShown(false);
  }

  return (
    <div className="relative rounded-xl border border-neutral-200 bg-neutral-50 p-4 pr-10 sm:p-5 sm:pr-12">
      <button
        type="button"
        aria-label="공지 닫기"
        onClick={dismiss}
        className="absolute right-2 top-2 p-1.5 text-neutral-400 hover:text-black"
      >
        ✕
      </button>
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-bold text-black">{TITLE}</p>
        <span className="text-[11px] font-semibold text-neutral-400">{NOTICE_DATE}</span>
      </div>
      <div className="mt-2.5 flex items-end gap-3">
        <div className="min-w-0 flex-1 text-sm leading-relaxed text-neutral-600">
          <p>{HELLO}</p>
          {/* ⚠️ **폰에서는 단추를 아랫줄로 내린다.** 방문자 넷 중 셋이 폰이라(2026-08-18
              서치콘솔) 배너 폭이 좁다. 글과 단추를 한 줄에 우겨넣으면 글이 잘린다.
              넓은 화면에서만 같은 줄에 세운다. */}
          <p className="mt-3">{NEWS}</p>
          {onOpenGame && (
            <button
              type="button"
              onClick={onOpenGame}
              /* ⚠️ 눌리는 자리를 **44px 이상**으로 잡는다(py-3 + text-sm = 44px).
                 손가락으로 누르는 자리라 이보다 작으면 헛누름이 는다. */
              className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-neutral-900 px-4 py-3 text-sm font-bold text-white hover:bg-neutral-700"
            >
              열어 보기
            </button>
          )}
          <p className="mt-3 whitespace-pre-line">{OUTRO}</p>
        </div>
        {/* 인사말 옆에 세워 둔다. 좁은 화면에서는 글이 밀리므로 숨긴다. */}
        <BowingFigure className="hidden h-16 w-16 flex-shrink-0 text-neutral-300 sm:block sm:h-20 sm:w-20" />
      </div>
      {/* 폰에서는 글 아래 가운데에 작게 놓는다. */}
      <BowingFigure className="mx-auto mt-1 block h-14 w-14 text-neutral-300 sm:hidden" />
    </div>
  );
}
