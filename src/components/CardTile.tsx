import type { SnkrdunkCard } from '../api/snkrdunk';
import { FavoriteButton } from './FavoriteButton';
import { KrwHint } from './KrwHint';

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
        {onToggleFavorite && <FavoriteButton active={!!isFavorite} onToggle={() => onToggleFavorite(card)} />}
      </div>
      <p className="font-semibold text-sm text-black line-clamp-2 mb-1">{card.title}</p>
      {/* 찜 수는 검색 결과에만 있다. 저장해둔 카드를 ID로 복원한 경우엔 값이 없어서
          "매물 N개"만 보여준다. */}
      <p className="text-xs text-neutral-400 mb-1">
        매물 {card.stock.toLocaleString()}개
        {card.favoriteCount !== undefined && ` · 찜 ${card.favoriteCount.toLocaleString()}`}
      </p>
      {/* 매물이 없으면 가격이 0/NaN으로 와서 "￥NaN"처럼 깨져 보인다. 그럴 땐 시세를
          숨기고 안내만 남긴다. */}
      {Number.isFinite(card.price) && card.price > 0 ? (
        <>
          <p className="text-base font-bold text-black">{yen.format(card.price)}</p>
          <KrwHint amount={card.price} currency="jpy" />
        </>
      ) : (
        <p className="text-sm font-semibold text-neutral-400">시세 없음</p>
      )}
    </button>
  );
}
