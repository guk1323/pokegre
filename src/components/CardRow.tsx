import type { SnkrdunkCard } from '../api/snkrdunk';
import { CardTile } from './CardTile';

export function CardRow({
  title,
  items,
  emptyText,
  selectedId,
  onSelect,
  isFavorite,
  onToggleFavorite,
}: {
  title: string;
  items: SnkrdunkCard[];
  emptyText: string;
  selectedId: number | null;
  onSelect: (id: number) => void;
  isFavorite: (apparelId: number) => boolean;
  onToggleFavorite: (card: SnkrdunkCard) => void;
}) {
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-neutral-500 mb-3">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400 py-6 text-center rounded-xl border border-dashed border-neutral-200">
          {emptyText}
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {items.map((card) => (
            <div key={card.apparelId} className="w-44 flex-shrink-0">
              <CardTile
                card={card}
                selected={card.apparelId === selectedId}
                onSelect={onSelect}
                isFavorite={isFavorite(card.apparelId)}
                onToggleFavorite={onToggleFavorite}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
