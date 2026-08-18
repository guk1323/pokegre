/**
 * 도감 세 화면(포켓몬·세트·작가)이 **같이 쓰는 검색창.**
 *
 * 왜 따로 뒀나 — 원래 작가 화면 안에만 있었고 포켓몬 화면은 자기 것을 따로 갖고 있었다.
 * 그래서 같은 성격의 화면인데 검색창 생김새가 달랐다(작가는 둥근 테두리에 지우기 X,
 * 포켓몬은 각진 테두리에 지우기 없음 — 2026-08-09 사장님 지적).
 * ⚠️ **베끼지 말고 이걸 쓴다.** 규칙이 둘이면 언젠가 반드시 어긋난다.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-full border border-neutral-200 bg-white py-2.5 pl-4 pr-9 text-sm outline-none focus:border-neutral-400"
      />
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
    </div>
  );
}
