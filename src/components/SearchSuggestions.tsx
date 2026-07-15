export function SearchSuggestions({
  items,
  onSelect,
}: {
  items: string[];
  onSelect: (term: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ul className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl border border-neutral-200 bg-white shadow-lg overflow-hidden">
      {items.map((term) => (
        <li key={term}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(term)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-black hover:bg-neutral-50"
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
