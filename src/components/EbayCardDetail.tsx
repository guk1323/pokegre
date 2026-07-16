import { ebaySoldUrl, formatGradeLabel, type EbayCard } from '../api/ebayPrices';
import { KrwHint, KrwRateNote } from './KrwHint';
import { EbayPriceChart } from './EbayPriceChart';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

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
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-xs font-semibold text-neutral-500">등급별 이베이 낙찰가 (중앙값)</p>
          <span className="text-[11px] text-neutral-400">누르면 이베이 낙찰내역 ↗</span>
        </div>
        {/* 등급마다 큰 상자를 쌓으면 9개 등급에 한없이 길어진다. 한 줄짜리 행으로 눕혀
            등급·중앙값·원화·마지막 낙찰일을 한눈에 훑게 한다(범위는 그래프의 최저/최고로 갈음).
            행을 누르면 이베이의 그 등급 "낙찰 완료" 목록으로 간다 — PPT엔 없는 개별 낙찰
            건(날짜·가격·상품 링크)을 거기서 직접 볼 수 있다. */}
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {card.grades.map((g) => {
            const sold = shortDate(g.lastSaleDate);
            return (
              <li key={g.grade}>
                <a
                  href={ebaySoldUrl(card.nameEn, card.cardNumber, g.grade)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-neutral-700">{formatGradeLabel(g.grade)}</span>
                    <span className="ml-1.5 text-[11px] text-neutral-400">
                      {g.count.toLocaleString()}건{sold ? ` · 마지막 ${sold}` : ''}
                    </span>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-sm font-bold text-black leading-tight">{usd.format(g.medianPrice)}</p>
                    <KrwHint amount={g.medianPrice} currency="usd" />
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
        <KrwRateNote />
      </div>
    </div>
  );
}
