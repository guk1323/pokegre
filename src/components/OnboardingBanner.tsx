import { useState } from 'react';
import { PokegreFrog } from './PokegreFrog';

// 홈 상단 공지 배너. 운영자 인사말을 그대로 보여준다(항목 나열이 아니라 편지 형식).
//
// 한 번 닫으면 다시 안 뜬다. 새 공지를 올릴 땐 아래 제목·날짜·본문을 바꾸고 DISMISS_KEY
// 뒤 날짜도 함께 바꾸면(예: _v20260726 → _v20260810) 닫았던 사람에게도 다시 뜬다.
const DISMISS_KEY = 'pokegre_notice_dismissed_v20260726';
const TITLE = '오늘의 상점 업데이트';
const NOTICE_DATE = '2026년 7월 26일';
const BODY = `안녕하세요. pokegre 운영자입니다.

문을 연 지 열흘이 지났습니다. 그동안 서비스를 더 단단하게 다듬느라 점검이 길어졌습니다. 이용에 불편을 드려 죄송합니다.

오늘의 상점이 새로 생겼습니다. 출석하고 받은 GP로 원하는 팩을 사서 열고, 마음에 드는 카드는 앨범에 모을 수 있습니다.

꾸준히 찾아주시는 분들께 감사드립니다.

pokegre 올림`;

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
    <div className="relative mb-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4 pr-10 sm:p-5 sm:pr-12">
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
        <PokegreFrog className="hidden h-20 w-20 flex-shrink-0 sm:block sm:h-24 sm:w-24" />
      </div>
      {/* 폰에서는 글 아래 가운데에 작게 놓는다. */}
      <PokegreFrog className="mx-auto mt-2 block h-20 w-20 sm:hidden" />
    </div>
  );
}
