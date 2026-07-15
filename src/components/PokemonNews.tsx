import type { KoreanNewsItem } from '../api/koreanNews';

export function PokemonNews({ items, loading }: { items: KoreanNewsItem[]; loading: boolean }) {
  if (loading) {
    return <p className="text-sm text-neutral-400 py-6 text-center">불러오는 중...</p>;
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-neutral-500 mb-3">포켓몬 뉴스 (출처: 포켓몬코리아)</p>
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {items.map((item) => (
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
    </div>
  );
}
