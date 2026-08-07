import { useState } from 'react';
import type { KoreanNewsItem } from '../api/koreanNews';

// 한 페이지에 20건이 통째로 깔리면 홈이 뉴스로만 채워져서, 기본은 5건만 보여주고
// "더보기"를 누를 때마다 5건씩 늘린다. 한 번에 다 펼치면 목록이 갑자기 길어져서
// 어디까지 봤는지 놓치기 쉽다.
const PAGE_SIZE = 5;

export function PokemonNews({ items, loading }: { items: KoreanNewsItem[]; loading: boolean }) {
  const [shown, setShown] = useState(PAGE_SIZE);

  if (loading) {
    return <p className="text-sm text-neutral-400 py-6 text-center">불러오는 중...</p>;
  }

  if (items.length === 0) return null;

  const visible = items.slice(0, shown);
  const remaining = items.length - shown;
  const nextCount = Math.min(PAGE_SIZE, remaining);

  return (
    <div className="">
      <p className="mb-3 text-sm font-bold text-neutral-500">
        포켓몬 뉴스 <span className="align-middle text-xs font-normal text-neutral-400">출처: 포켓몬코리아</span>
      </p>
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

      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setShown((prev) => prev + PAGE_SIZE)}
          className="mt-2 w-full rounded-lg py-2 text-xs font-semibold text-neutral-500 hover:bg-neutral-50"
        >
          뉴스 {nextCount}건 더보기
        </button>
      ) : (
        shown > PAGE_SIZE && (
          <button
            type="button"
            onClick={() => setShown(PAGE_SIZE)}
            className="mt-2 w-full rounded-lg py-2 text-xs font-semibold text-neutral-500 hover:bg-neutral-50"
          >
            접기
          </button>
        )
      )}
    </div>
  );
}
