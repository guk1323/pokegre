import { useState } from 'react';

// 처음 온 사람에게 "여기서 뭘 할 수 있는지"를 한눈에 알려주는 배너. 홍보로 들어온
// 사람이 검색창만 보고 뭘 해야 할지 몰라 나가지 않게 한다.
//
// 한 번 닫으면 다시 안 뜬다. 닫았다는 사실만 브라우저에 남기고(회원정보와 무관),
// 안내 문구를 바꿔 다시 보여주고 싶을 때를 위해 버전을 키에 붙인다.
const DISMISS_KEY = 'pokegre_onboarding_dismissed_v3';

function alreadyDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function OnboardingBanner() {
  const [open, setOpen] = useState(() => !alreadyDismissed());

  if (!open) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // 시크릿 모드 등에서 저장이 막혀도 이번 세션에서는 닫히게 둔다.
    }
    setOpen(false);
  }

  return (
    <div className="relative mb-6 rounded-xl border border-neutral-200 bg-neutral-50 p-5 pr-10">
      <button
        type="button"
        aria-label="안내 닫기"
        onClick={dismiss}
        className="absolute right-3 top-3 text-neutral-400 hover:text-black"
      >
        ✕
      </button>
      <p className="text-sm font-bold text-black">처음이신가요?</p>
      <ul className="mt-2 space-y-1.5 text-sm text-neutral-600">
        <li>
          <span className="font-semibold text-neutral-800">카드 이름</span>을 검색하면 일본 실거래가(스니덩크)와 이베이
          등급별 낙찰가를 한눈에 확인합니다. 한글·영어·일본어 모두 가능합니다.
        </li>
        <li>
          이름을 몰라도 됩니다. <span className="font-semibold text-neutral-800">📷 카드 사진</span>을 찍거나 앨범에서 골라 검색합니다.
        </li>
        <li>
          <span className="font-semibold text-neutral-800">카드 센터링</span>(중앙 정렬)은 사진으로 바로 측정합니다.
        </li>
        <li>
          마음에 드는 카드는 <span className="font-semibold text-neutral-800">북마크</span>로 저장하고,{' '}
          <span className="font-semibold text-neutral-800">커뮤니티</span>에서 질문·건의를 남기면 됩니다.
        </li>
        <li className="text-xs text-neutral-400">표시되는 시세는 참고용이며 실제 거래가와 다를 수 있습니다.</li>
      </ul>
    </div>
  );
}
