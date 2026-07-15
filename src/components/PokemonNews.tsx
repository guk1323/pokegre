import { useState } from 'react';
import type { KoreanNewsItem } from '../api/koreanNews';

// 한 페이지에 20건이 통째로 깔리면 홈이 뉴스로만 채워져서, 기본은 5건만 보여주고
// 나머지는 접어둔다.
const COLLAPSED_COUNT = 5;

export function PokemonNews({ items, loading }: { items: KoreanNewsItem[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return <p className="text-sm text-neutral-400 py-6 text-center">불러오는 중...</p>;
  }

  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  const hiddenCount = items.length - COLLAPSED_COUNT;

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-neutral-500 mb-3">포켓몬 뉴스 (출처: 포켓몬코리아)</p>
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {visible.map((item) => (
          <li key={item.url}>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 px-2 py-3 hover:bg-neutral-50"
            >
              <p className="text-sm font-medium text-black line-clamp-2">{item.title}</p>
              <p className="text-xs text-neutral-400 flex-shrink-0">{item.date}</p>
            </a>
          </li>
        ))}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-2 w-full rounded-lg py-2 text-xs font-semibold text-neutral-500 hover:bg-neutral-50"
        >
          {expanded ? '접기' : `뉴스 ${hiddenCount}건 더보기`}
        </button>
      )}
    </div>
  );
}
