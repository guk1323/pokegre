import type { EbayCard } from '../api/ebayPrices';
import { KrwHint, KrwRateNote } from './KrwHint';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

// TCGplayer(미국 마켓) 시세 상세. 이베이가 "등급별 낙찰가"라면 이쪽은 미감정 카드의
// 시장가(마켓가)와 현재 최저가를 보여준다. 데이터는 이베이와 같은 PPT 응답에서 온다.
export function TcgPlayerCardDetail({ card }: { card: EbayCard }) {
  const t = card.tcgplayer;
  const updated = shortDate(t?.lastUpdated ?? null);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 sticky top-4">
      <div className="h-40 w-full rounded-lg mb-4 overflow-hidden bg-neutral-100">
        {card.imageUrl && <img src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" />}
      </div>

      <h2 className="text-base font-bold text-black mb-1">{card.name}</h2>
      <p className="text-xs text-neutral-400 mb-4">
        {card.setName}
        {card.cardNumber ? ` · ${card.cardNumber}` : ''}
      </p>

      {t ? (
        <a
          href={t.url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-neutral-200 hover:bg-neutral-50"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-700">마켓 시세{t.printing ? ` · ${t.printing}` : ''}</p>
              <p className="text-[11px] text-neutral-400">미감정(로우) 기준 · 눌러서 TCGplayer ↗</p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-lg font-bold text-black leading-tight">{usd.format(t.market)}</p>
              <KrwHint amount={t.market} currency="usd" />
            </div>
          </div>
          {t.low > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-4 py-2">
              <p className="text-xs text-neutral-500">현재 최저가</p>
              <div className="text-right">
                <p className="text-sm font-semibold text-neutral-700 leading-tight">{usd.format(t.low)}</p>
                <KrwHint amount={t.low} currency="usd" />
              </div>
            </div>
          )}
        </a>
      ) : (
        <p className="text-sm text-neutral-400 py-8 text-center">TCGplayer 시세가 없어요.</p>
      )}

      <p className="mt-2 text-[11px] leading-snug text-neutral-400">
        판매자 {t?.sellers?.toLocaleString() ?? 0}명{updated ? ` · ${updated} 기준` : ''}. 실제 팔린 값을 반영한
        시세예요. 감정(PSA·BGS 등) 카드는 값이 다르니 등급 시세는 eBay에서 보세요.
      </p>
      <KrwRateNote />
    </div>
  );
}
