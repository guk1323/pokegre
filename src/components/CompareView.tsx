import type { ReactNode } from 'react';
import type { SnkrdunkCard } from '../api/snkrdunk';
import { KrwHint } from './KrwHint';

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function hasPrice(card: SnkrdunkCard): boolean {
  return Number.isFinite(card.price) && card.price > 0;
}

// 두 카드 중 더 싼 쪽을 초록으로 표시하기 위한 최저가.
function cheapestPrice(cards: SnkrdunkCard[]): number | null {
  const prices = cards.filter(hasPrice).map((c) => c.price);
  return prices.length ? Math.min(...prices) : null;
}

function Row({ label, cards, render }: { label: string; cards: SnkrdunkCard[]; render: (c: SnkrdunkCard) => ReactNode }) {
  return (
    <tr className="border-t border-neutral-100">
      <th className="py-2.5 pr-3 text-left align-middle text-xs font-semibold text-neutral-500 whitespace-nowrap">{label}</th>
      {cards.map((c) => (
        <td key={c.apparelId} className="py-2.5 px-2 text-center align-middle">
          {render(c)}
        </td>
      ))}
    </tr>
  );
}

// 운영자 전용(베타) 카드 비교. 담아둔 2장을 나란히 놓고 최저가·원화·매물·찜을 표로 본다.
export function CompareView({
  cards,
  onClose,
  onRemove,
}: {
  cards: SnkrdunkCard[];
  onClose: () => void;
  onRemove: (id: number) => void;
}) {
  const cheapest = cheapestPrice(cards);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full overflow-auto rounded-t-2xl bg-white p-5 sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-black">카드 비교 <span className="ml-1 text-[10px] font-semibold text-amber-500">베타</span></h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-black" aria-label="닫기">
            ✕
          </button>
        </div>

        <table className="w-full text-sm">
          <tbody>
            <tr>
              <th className="w-14" />
              {cards.map((c) => (
                <td key={c.apparelId} className="px-2 pb-2 text-center align-top">
                  <div className="relative mx-auto h-32 w-24">
                    <img src={c.imageUrl} alt={c.title} className="h-32 w-24 object-contain" />
                    <button
                      type="button"
                      onClick={() => onRemove(c.apparelId)}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-white"
                      aria-label="비교에서 빼기"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs font-semibold text-black">{c.title}</p>
                </td>
              ))}
            </tr>

            <Row
              label="최저가"
              cards={cards}
              render={(c) =>
                hasPrice(c) ? (
                  <span className={`text-base font-bold ${cheapest !== null && c.price === cheapest ? 'text-emerald-600' : 'text-black'}`}>
                    {yen.format(c.price)}
                  </span>
                ) : (
                  <span className="text-neutral-400">시세 없음</span>
                )
              }
            />
            <Row label="원화" cards={cards} render={(c) => (hasPrice(c) ? <KrwHint amount={c.price} currency="jpy" /> : <span className="text-neutral-400">-</span>)} />
            <Row label="매물" cards={cards} render={(c) => <span className="text-neutral-700">{c.stock.toLocaleString()}개</span>} />
            <Row
              label="찜"
              cards={cards}
              render={(c) => <span className="text-neutral-700">{c.favoriteCount !== undefined ? c.favoriteCount.toLocaleString() : '-'}</span>}
            />
          </tbody>
        </table>

        <p className="mt-4 text-[11px] text-neutral-400">
          최저가가 더 싼 쪽을 초록으로 표시했어요. 시세는 참고용이며 실제 거래가와 다를 수 있어요.
        </p>
      </div>
    </div>
  );
}
