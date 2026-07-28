export function SearchSuggestions({
  items,
  active,
  onSelect,
}: {
  items: string[];
  // 방향키로 고른 항목. -1이면 아무것도 안 고른 상태(직접 친 검색어 그대로).
  active?: number;
  onSelect: (term: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ul
      id="search-suggestions"
      role="listbox"
      className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl border border-neutral-200 bg-white shadow-lg overflow-hidden"
    >
      {items.map((term, i) => (
        <li key={term}>
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            // 방향키로 고른 줄에 색을 준다. 마우스를 올린 줄과 같은 색이라 따로 배울 게 없다.
            className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-black ${
              i === active ? 'bg-neutral-100' : 'hover:bg-neutral-50'
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(term)}
          >
            <svg className="h-3.5 w-3.5 text-neutral-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="truncate">{term}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
