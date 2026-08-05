import { useEffect, useRef, useState, type ReactNode } from 'react';

export type SearchSource = 'snkrdunk' | 'ebay' | 'tcgplayer';
const SOURCE_LABEL: Record<SearchSource, string> = {
  snkrdunk: 'SNKRDUNK',
  ebay: 'eBay',
  tcgplayer: 'TCGplayer',
};

export function SearchBar({
  value,
  onChange,
  onFocus,
  onBlur,
  onSubmit,
  onKeyNav,
  source,
  onSourceChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  // 자동완성 목록을 방향키로 오르내리게 한다. 위/아래/Escape를 위쪽에서 처리하고,
  // 처리했으면 true를 돌려준다(그때는 기본 동작인 커서 이동을 막는다).
  onKeyNav?: (key: 'ArrowDown' | 'ArrowUp' | 'Escape' | 'Enter') => boolean;
  // 어느 마켓에서 찾을지. 검색창 안 왼쪽에 넣는다 — 예전엔 검색창 아래 한 줄을
  // 통째로 차지했다(2026-08-05 운영자 지시로 합침).
  source?: SearchSource;
  onSourceChange?: (s: SearchSource) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 바깥을 누르면 닫는다. 목록을 열어 둔 채 다른 데를 눌렀을 때 걸려 있으면 답답하다.
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);

  const hasSource = !!source && !!onSourceChange;
  return (
    <div className="relative">
      {hasSource ? (
        <div ref={wrapRef} className="absolute left-1.5 top-1/2 z-20 -translate-y-1/2">
          <button
            type="button"
            // ⚠️ onMouseDown으로 blur를 막는다. 안 막으면 검색창이 포커스를 잃으며
            //    자동완성이 닫히는 동작과 겹쳐 클릭이 씹힌다(지우기 버튼과 같은 이유).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((v) => !v)}
            aria-label={`검색할 마켓: ${SOURCE_LABEL[source]}`}
            className="flex items-center gap-1 rounded-lg bg-neutral-900 py-1.5 pl-2.5 pr-2 text-xs font-bold text-white"
          >
            {SOURCE_LABEL[source]}
            <span className="text-[10px] opacity-60">▾</span>
          </button>
          {open && (
            <div className="absolute left-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
              {(Object.keys(SOURCE_LABEL) as SearchSource[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSourceChange(s);
                    setOpen(false);
                  }}
                  className={`block w-full px-3 py-2 text-left text-xs font-semibold ${
                    s === source ? 'bg-neutral-100 text-black' : 'text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {SOURCE_LABEL[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      )}
      {/* 안내문구는 짧게. 폰 화면(375px)에서는 20자 남짓만 보이는데 예전 문구는 55자라
          "팩 이릅"에서 잘려 무슨 말인지 알 수 없었다. */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        // 엔터(폰 키보드의 "검색")를 누르면 자동완성을 닫고 키보드를 내린다. 예전에는
        // 검색창 밖을 따로 눌러야 닫혀서, 결과가 나와도 자동완성이 그 위를 덮고 있었다.
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape') {
            // 위/아래는 커서를 글자 끝으로 보내려 하므로, 목록을 움직였으면 막는다.
            if (onKeyNav?.(e.key)) e.preventDefault();
            return;
          }
          if (e.key !== 'Enter') return;
          // 목록에서 고른 항목이 있으면 그것으로 검색한다(키보드는 그대로 둔다 —
          // 고른 말이 검색창에 들어가는 게 보여야 한다).
          if (onKeyNav?.('Enter')) return;
          e.currentTarget.blur();
          onSubmit?.();
        }}
        enterKeyHint="search"
        // ⚠️ 소스 칩이 왼쪽 자리를 먹으므로 안내문구가 더 짧아야 한다. 폰(375)에서
        //    "카드 이름 검색 · 시세 확인"은 "· "에서 잘려 말이 끊겨 보였다(2026-08-05).
        placeholder={hasSource ? '카드 이름 검색' : '카드 이름 검색 · 시세 확인'}
        // ⚠️ 왼쪽 여백은 소스 칩이 있으면 그만큼 벌린다. 안 벌리면 글자가 칩 밑으로
        //    들어가 가려진다. 칩 글자 길이가 SNKRDUNK·TCGplayer로 달라서 넉넉히 잡는다.
        className={`w-full rounded-xl border border-neutral-300 bg-white py-3 pr-10 text-sm text-black placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black ${
          hasSource ? 'pl-[7.5rem]' : 'pl-10'
        }`}
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
