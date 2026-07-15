import type { SnkrdunkCard } from '../api/snkrdunk';

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function CardTile({
  card,
  selected,
  onSelect,
  isFavorite,
  onToggleFavorite,
}: {
  card: SnkrdunkCard;
  selected: boolean;
  onSelect: (id: number) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (card: SnkrdunkCard) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(card.apparelId)}
      className={`text-left rounded-xl border border-neutral-200 bg-white p-3 transition hover:shadow-md focus:outline-none ${
        selected ? 'ring-2 ring-black ring-offset-2' : ''
      }`}
    >
      <div className="relative h-36 w-full rounded-lg mb-3 overflow-hidden bg-neutral-100">
        <img src={card.imageUrl} alt={card.title} className="h-full w-full object-contain" loading="lazy" />
        {onToggleFavorite && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(card);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                onToggleFavorite(card);
              }
            }}
            className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
          >
            {isFavorite ? '❤️' : '🤍'}
          </span>
        )}
      </div>
      <p className="font-semibold text-sm text-black line-clamp-2 mb-1">{card.title}</p>
      <p className="text-xs text-neutral-400 mb-1">매물 {card.stock.toLocaleString()}개 · 찜 {card.favoriteCount.toLocaleString()}</p>
      <p className="text-base font-bold text-black">{yen.format(card.price)}</p>
    </button>
  );
}
