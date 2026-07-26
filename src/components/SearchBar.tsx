import type { ReactNode } from 'react';

export function SearchBar({
  value,
  onChange,
  onFocus,
  onBlur,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      {/* 안내문구는 짧게. 폰 화면(375px)에서는 20자 남짓만 보이는데 예전 문구는 55자라
          "팩 이릅"에서 잘려 무슨 말인지 알 수 없었다. */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="카드명 또는 팩 이름 검색"
        className="w-full rounded-xl border border-neutral-300 bg-white py-3 pl-10 pr-10 text-sm text-black placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
      />
      {/* 검색어가 있을 때만 오른쪽 끝에 지우기(X). onMouseDown로 blur를 막아 눌러도
          자동완성이 먼저 닫혀 클릭이 씹히는 일이 없게 한다. */}
      {value && (
        <button
          type="button"
          aria-label="검색어 지우기"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {children}
    </div>
  );
}
