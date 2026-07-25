import { useState } from 'react';

// 홈 상단 "업데이트 소식" 배너. 새로 추가된 기능을 알린다(예전엔 "처음이신가요?" 안내였음).
// 사용법 상세는 커뮤니티 이용안내 공지가 대신한다.
//
// 한 번 닫으면 다시 안 뜬다. 새 업데이트를 올릴 땐 DATE와 항목을 바꾸고 DISMISS_KEY 뒤
// 날짜를 함께 바꾸면(예: _v20260724 → _v20260810) 닫았던 사람에게도 새 소식이 다시 뜬다.
const DISMISS_KEY = 'pokegre_update_dismissed_v20260724';
const UPDATE_DATE = '2026년 7월 24일';
// 이번 업데이트 항목(위가 최신 강조). 다음 릴리스 땐 이 배열만 갈아끼우면 된다.
const UPDATES: { title: string; desc: string }[] = [
  {
    title: '세트별 목록 추가',
    desc: '카드 도구 ▾ → 세트별 목록에서 팩별 수록 카드를 확인할 수 있습니다. 일본판·북미판·모바일 포켓으로 구분했습니다.',
  },
  {
    title: '이베이 한글판 시세 추가',
    desc: '카드 검색 후 eBay → 한글판에서 이베이에 올라온 한글판 매물가(호가)를 확인할 수 있습니다.',
  },
  {
    title: '세트·카드 한글 이름 정리',
    desc: '일본판·북미판·포켓 세트 이름을 공식 한글명으로 정리했습니다.',
  },
];

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
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-bold text-black">📢 새로워진 기능</p>
        <span className="text-[11px] font-semibold text-neutral-400">{UPDATE_DATE}</span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {UPDATES.map((u) => (
          <li key={u.title} className="flex gap-2 text-sm">
            <span className="mt-0.5 select-none text-neutral-300">•</span>
            <span className="text-neutral-600">
              <b className="text-neutral-900">{u.title}</b> — {u.desc}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-400">
        시세는 참고용이며 실제 거래가와 다를 수 있습니다. 자세한 이용법은 커뮤니티 이용안내를 참고해 주세요.
      </p>
    </div>
  );
}
