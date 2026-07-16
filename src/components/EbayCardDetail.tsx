import { formatGradeLabel, type EbayCard } from '../api/ebayPrices';
import { KrwHint, KrwRateNote } from './KrwHint';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const TREND_LABEL: Record<string, string> = {
  rising: '▲ 상승',
  falling: '▼ 하락',
  stable: '- 보합',
};

export function EbayCardDetail({ card }: { card: EbayCard }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 sticky top-4">
      <div className="h-40 w-full rounded-lg mb-4 overflow-hidden bg-neutral-100">
        {card.imageUrl && (
          <img src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" />
        )}
      </div>

      <h2 className="text-base font-bold text-black mb-1">{card.name}</h2>
      <p className="text-xs text-neutral-400 mb-4">
        {card.setName}
        {card.cardNumber ? ` · ${card.cardNumber}` : ''} · 낙찰 {card.totalSales.toLocaleString()}건
      </p>

      <div>
        <p className="text-xs font-semibold text-neutral-500 mb-2">등급별 이베이 낙찰가</p>
        <div className="space-y-2">
          {card.grades.map((g) => (
            <div key={g.grade} className="rounded-lg bg-neutral-50 p-3">
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-xs font-semibold text-neutral-600">{formatGradeLabel(g.grade)}</p>
                <p className="text-[11px] text-neutral-400">
                  {g.count.toLocaleString()}건{g.marketTrend ? ` · ${TREND_LABEL[g.marketTrend] ?? g.marketTrend}` : ''}
                </p>
              </div>
              <p className="text-lg font-bold text-black">{usd.format(g.medianPrice)}</p>
              <KrwHint amount={g.medianPrice} currency="usd" />
              <p className="text-[11px] text-neutral-400">
                범위 {usd.format(g.minPrice)} ~ {usd.format(g.maxPrice)}
              </p>
            </div>
          ))}
        </div>
        <KrwRateNote />
      </div>
    </div>
  );
}
