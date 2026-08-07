import { formatGradeLabel, 대표등급, mainPrice, type EbayCard } from '../api/ebayPrices';
import { Price } from './KrwHint';
import { CardImg } from './CardImg';


export function EbayCardTile({
  card,
  selected,
  onSelect,
  onCompare,
  inCompare,
  variant = 'ebay',
}: {
  card: EbayCard;
  selected: boolean;
  onSelect: (id: string) => void;
  // 비교 담기(운영자 베타). onCompare가 있을 때만 버튼이 뜬다.
  onCompare?: (card: EbayCard) => void;
  inCompare?: boolean;
  // 'ebay'면 등급별 대표가, 'tcgplayer'면 TCGplayer 마켓가를 대표가로 보여준다.
  variant?: 'ebay' | 'tcgplayer';
}) {
  // 목록 대표가도 상세와 같은 기준(현재 적정가, 없으면 중앙값)으로 맞춘다.
  const topGrade = 대표등급(card.grades);
  const top = topGrade ? mainPrice(topGrade) : null;
  const tcg = card.tcgplayer;

  return (
    <button
      type="button"
      onClick={() => onSelect(card.tcgPlayerId)}
      className={`text-left rounded-xl border border-neutral-200 bg-white p-3 transition hover:shadow-md focus:outline-none ${
        selected ? 'ring-2 ring-black ring-offset-2' : ''
      }`}
    >
      <div className="h-36 w-full rounded-lg mb-3 overflow-hidden bg-neutral-100">
        {/* TCGplayer 이미지는 원본이 이미 400px로 작아서 축소(wsrv)를 거치지 않는다.
            거치면 wsrv가 tcgplayer CDN을 못 불러와 이미지가 깨진다. */}
        {card.imageUrl && (
          <CardImg src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" />
        )}
      </div>
      <p className="font-semibold text-sm text-black line-clamp-2 mb-1">{card.name}</p>
      <p className="text-xs text-neutral-400 mb-1 line-clamp-1">{card.setName}</p>
      {variant === 'tcgplayer'
        ? tcg && (
            <>
              <Price amount={tcg.market} currency="usd" />
            </>
          )
        : topGrade &&
          top && (
            <>
              <p className="text-[11px] font-semibold text-neutral-500">{formatGradeLabel(topGrade.grade)}</p>
              <Price amount={top.price} currency="usd" />
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
