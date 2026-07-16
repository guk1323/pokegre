import { formatGradeLabel, mainPrice, type EbayCard } from '../api/ebayPrices';
import { KrwHint } from './KrwHint';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function EbayCardTile({
  card,
  selected,
  onSelect,
}: {
  card: EbayCard;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  // 목록 대표가도 상세와 같은 기준(현재 적정가, 없으면 중앙값)으로 맞춘다.
  const topGrade = card.grades[0];
  const top = topGrade ? mainPrice(topGrade) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(card.tcgPlayerId)}
      className={`text-left rounded-xl border border-neutral-200 bg-white p-3 transition hover:shadow-md focus:outline-none ${
        selected ? 'ring-2 ring-black ring-offset-2' : ''
      }`}
    >
      <div className="h-36 w-full rounded-lg mb-3 overflow-hidden bg-neutral-100">
        {card.imageUrl && (
          <img src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" loading="lazy" />
        )}
      </div>
      <p className="font-semibold text-sm text-black line-clamp-2 mb-1">{card.name}</p>
      <p className="text-xs text-neutral-400 mb-1 line-clamp-1">{card.setName}</p>
      {topGrade && top && (
        <>
          <p className="text-base font-bold text-black">
            {formatGradeLabel(topGrade.grade)} {usd.format(top.price)}
          </p>
          <KrwHint amount={top.price} currency="usd" />
        </>
      )}
    </button>
  );
}
