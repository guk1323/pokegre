import { formatGradeLabel, type EbayCard } from '../api/ebayPrices';
import { KrwHint, KrwRateNote } from './KrwHint';
import { EbayPriceChart } from './EbayPriceChart';

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

      {/* 낙찰 기록이 충분한 등급이 있으면 추이 그래프를 먼저 보여준다. 없으면 스스로
          아무것도 안 그린다. */}
      <EbayPriceChart grades={card.grades} />

      <div>
        <p className="text-xs font-semibold text-neutral-500 mb-2">등급별 이베이 낙찰가</p>
        {/* 등급마다 큰 상자를 쌓으면 9개 등급에 한없이 길어진다. 한 줄짜리 행으로 눕혀
            등급·중앙값·원화·건수를 한눈에 훑게 한다(범위는 그래프의 최저/최고로 갈음). */}
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {card.grades.map((g) => (
            <li key={g.grade} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-neutral-700">{formatGradeLabel(g.grade)}</span>
                <span className="ml-1.5 text-[11px] text-neutral-400">
                  {g.count.toLocaleString()}건{g.marketTrend ? ` · ${TREND_LABEL[g.marketTrend] ?? g.marketTrend}` : ''}
                </span>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-bold text-black leading-tight">{usd.format(g.medianPrice)}</p>
                <KrwHint amount={g.medianPrice} currency="usd" />
              </div>
            </li>
          ))}
        </ul>
        <KrwRateNote />
      </div>
    </div>
  );
}
