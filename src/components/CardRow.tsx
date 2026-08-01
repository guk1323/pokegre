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
  onClear,
}: {
  title: string;
  items: SnkrdunkCard[];
  emptyText: string;
  selectedId: number | null;
  onSelect: (id: number) => void;
  isFavorite: (apparelId: number) => boolean;
  onToggleFavorite: (card: SnkrdunkCard) => void;
  // 전달하면 제목 옆에 전체 삭제 버튼이 붙는다. 검색 결과처럼 지울 게 없는
  // 목록에서는 생략한다.
  onClear?: () => void;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-neutral-500">{title}</p>
        {onClear && items.length > 0 && (
          <button type="button" onClick={onClear} className="text-xs text-neutral-400 hover:text-rose-500">
            전체 삭제
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400 py-6 text-center rounded-xl border border-dashed border-neutral-200">
          {emptyText}
        </p>
      ) : (
        // overflow-x-auto는 세로축까지 클리핑으로 승격시켜서, 선택된 카드의
        // ring-offset(타일 바깥 4px)이 위/좌/우에서 잘린다. 여백을 4px 이상 주되
        // 음수 마진으로 상쇄해 제목과의 정렬은 그대로 둔다.
        <div className="scroll-hint flex gap-4 overflow-x-auto -mx-1 px-1 pt-1 pb-2">
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
