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
  missing = 0,
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
  // 지금 못 받은 장수. 통신이 잠깐 끊겨도 목록이 줄어드는데, 아무 말이 없으면
  // 이용자는 찜이 날아간 줄 안다(운영자 지적 2026-08-06). 저장된 목록은 그대로다.
  missing?: number;
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
      {missing > 0 && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          {missing}장은 지금 불러오지 못했습니다. 지워진 것이 아니니 잠시 뒤 다시 열어 보세요.
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400 py-6 text-center rounded-xl border border-dashed border-neutral-200">
          {missing > 0 ? '지금은 불러올 수 없습니다.' : emptyText}
        </p>
      ) : (
        // snap-x/snap-start: 옆으로 밀면 카드 경계에 딱 멈춘다. 안 그러면 줄 끝에
        // 카드가 반쯤 잘려 "조각난 작은 카드"처럼 보인다("저렇게 작은 것도 있어").
        // overflow-x-auto는 세로축까지 클리핑으로 승격시켜서, 선택된 카드의
        // ring-offset(타일 바깥 4px)이 위/좌/우에서 잘린다. 여백을 4px 이상 주되
        // 음수 마진으로 상쇄해 제목과의 정렬은 그대로 둔다.
        <div className="scroll-hint flex snap-x snap-mandatory gap-4 overflow-x-auto -mx-1 px-1 pt-1 pb-2">
          {items.map((card) => (
            <div key={card.apparelId} className="w-44 flex-shrink-0 snap-start">
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
