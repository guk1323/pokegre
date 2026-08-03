import { useState } from 'react';

// 홈 상단 공지 배너. 운영자 인사말을 그대로 보여준다(항목 나열이 아니라 편지 형식).
//
// 한 번 닫으면 다시 안 뜬다. 새 공지를 올릴 땐 아래 제목·날짜·본문을 바꾸고 DISMISS_KEY
// 뒤 날짜도 함께 바꾸면(예: _v20260726 → _v20260810) 닫았던 사람에게도 다시 뜬다.
const DISMISS_KEY = 'pokegre_notice_dismissed_v20260803';
const TITLE = '검색과 카드 뽑기를 손봤습니다';
const NOTICE_DATE = '2026년 8월 3일';
const BODY = `안녕하세요. pokegre 운영자입니다.

찾아주시는 분들이 실제로 치신 검색어를 하나하나 확인해, 결과가 빗나가던 것들을 고쳤습니다. 이제 「이슬이」나 「메가디안시」처럼 치셔도 잘 찾습니다.

세트 이름도 정리했습니다. 「Pokémon GO」처럼 영어로만 보이던 세트가 한글로 나오고, 이베이·TCGplayer에서도 세트 이름으로 찾을 수 있습니다.

카드 뽑기에서 SR·SAR이 아예 안 나오던 팩이 다섯 개 있었습니다. 이제 정상으로 나옵니다. 박스에서 「SR 이상 1장」 보장이 가끔 빈손이던 것도 고쳤습니다.

세트별 목록에 값이 높은 카드를 62개 세트까지 넣었고, 카드 그림과 세트 표지도 채웠습니다. 깨져 보이던 그림은 정리했습니다.

부족한 부분이 보이시면 커뮤니티에 편하게 남겨주세요.

pokegre 올림`;

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

export function OnboardingBanner() {
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
        <p className="min-w-0 flex-1 whitespace-pre-line text-sm leading-relaxed text-neutral-600">{BODY}</p>
        {/* 인사말 옆에 세워 둔다. 좁은 화면에서는 글이 밀리므로 숨긴다. */}
        <BowingFigure className="hidden h-16 w-16 flex-shrink-0 text-neutral-300 sm:block sm:h-20 sm:w-20" />
      </div>
      {/* 폰에서는 글 아래 가운데에 작게 놓는다. */}
      <BowingFigure className="mx-auto mt-1 block h-14 w-14 text-neutral-300 sm:hidden" />
    </div>
  );
}
