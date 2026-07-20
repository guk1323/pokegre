import { formatGradeLabel, mainPrice, type EbayCard } from '../api/ebayPrices';
import { KrwHint } from './KrwHint';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function EbayCardTile({
  card,
  selected,
  onSelect,
  onCompare,
  inCompare,
}: {
  card: EbayCard;
  selected: boolean;
  onSelect: (id: string) => void;
  // 비교 담기(운영자 베타). onCompare가 있을 때만 버튼이 뜬다.
  onCompare?: (card: EbayCard) => void;
  inCompare?: boolean;
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
      {onCompare && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onCompare(card);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onCompare(card);
            }
          }}
          className={`mt-2 inline-block cursor-pointer rounded-lg border px-2 py-1 text-xs font-semibold ${
            inCompare ? 'border-[#2a78d6] bg-[#2a78d6] text-white' : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          {inCompare ? '비교 담김 ✓' : '⇄ 비교'}
        </span>
      )}
    </button>
  );
}
