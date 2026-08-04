import type { ReactNode } from 'react';
import { CardImg } from './CardImg';
import { CONFIDENCE_LABEL, ebaySoldUrl, formatGradeLabel, mainPrice, type EbayCard, type EbayGradeStat } from '../api/ebayPrices';
import { KrwHint } from './KrwHint';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// 두 카드에 등장하는 등급을 (카드 순서대로) 합쳐 정렬한다. 등급 배열은 이미 대표 등급이
// 앞에 오도록 정렬돼 있다.
function gradeOrder(cards: EbayCard[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cards) for (const g of c.grades) if (!seen.has(g.grade)) { seen.add(g.grade); out.push(g.grade); }
  return out;
}

function statOf(card: EbayCard, grade: string): EbayGradeStat | null {
  return card.grades.find((x) => x.grade === grade) ?? null;
}

function priceOf(card: EbayCard, grade: string): number | null {
  const g = statOf(card, grade);
  return g ? mainPrice(g).price : null;
}

function Row({ label, cards, render }: { label: string; cards: EbayCard[]; render: (c: EbayCard) => ReactNode }) {
  return (
    <tr className="border-t border-neutral-100">
      <th className="py-2.5 pr-3 text-left align-middle text-xs font-semibold text-neutral-500 whitespace-nowrap">{label}</th>
      {cards.map((c) => (
        <td key={c.tcgPlayerId} className="py-2.5 px-2 text-center align-middle">
          {render(c)}
        </td>
      ))}
    </tr>
  );
}

// 운영자 전용(베타) 이베이 카드 비교. 담아둔 2장의 등급별 낙찰가를 나란히 본다.
export function EbayCompareView({
  cards,
  onClose,
  onRemove,
}: {
  cards: EbayCard[];
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const grades = gradeOrder(cards);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full overflow-auto rounded-t-2xl bg-white p-5 sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-black">
            카드 비교 · 이베이 <span className="ml-1 text-[10px] font-semibold text-amber-500">베타</span>
          </h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-black" aria-label="닫기">
            ✕
          </button>
        </div>

        <table className="w-full text-sm">
          <tbody>
            <tr>
              <th className="w-14" />
              {cards.map((c) => (
                <td key={c.tcgPlayerId} className="px-2 pb-2 text-center align-top">
                  <div className="relative mx-auto h-32 w-24">
                    {c.imageUrl && <CardImg src={c.imageUrl} alt={c.name} className="h-32 w-24 object-contain" />}
                    <button
                      type="button"
                      onClick={() => onRemove(c.tcgPlayerId)}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-white"
                      aria-label="비교에서 빼기"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs font-semibold text-black">{c.name}</p>
                  <p className="line-clamp-1 text-[11px] text-neutral-400">{c.setName}</p>
                  <a
                    href={ebaySoldUrl(c.nameEn, c.cardNumber, c.grades[0]?.grade ?? '')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-[11px] font-semibold text-[#2a78d6] hover:underline"
                  >
                    이베이 낙찰 보기 ↗
                  </a>
                </td>
              ))}
            </tr>

            <Row label="총 낙찰" cards={cards} render={(c) => <span className="text-neutral-700">{c.totalSales.toLocaleString()}건</span>} />

            {/* 등급별 낙찰가(현재 적정가, 없으면 중앙값) */}
            <tr className="border-t border-neutral-200">
              <th colSpan={cards.length + 1} className="pt-4 pb-1 text-left text-xs font-bold text-neutral-500">
                등급별 낙찰가
              </th>
            </tr>
            {grades.length === 0 ? (
              <tr>
                <td colSpan={cards.length + 1} className="py-3 text-center text-xs text-neutral-400">등급별 낙찰 데이터가 없습니다.</td>
              </tr>
            ) : (
              grades.map((grade) => {
                const prices = cards.map((c) => priceOf(c, grade));
                const valid = prices.filter((p): p is number => p != null);
                const cheapest = valid.length === cards.length && valid.length > 1 ? Math.min(...valid) : null;
                return (
                  <tr key={grade} className="border-t border-neutral-50">
                    <th className="py-2 pr-3 text-left align-middle text-xs font-medium text-neutral-500 whitespace-nowrap">{formatGradeLabel(grade)}</th>
                    {cards.map((c) => {
                      const g = statOf(c, grade);
                      const p = priceOf(c, grade);
                      // 낙찰이 몇 건 안 되는 등급은 한 건만 튀어도 값이 크게 흔들린다.
                      // 상세 화면과 똑같이 신뢰도·건수를 같이 보여줘, 비교표에서 그 값이
                      // 확정된 시세처럼 읽히지 않게 한다.
                      const conf = g?.confidence ? (CONFIDENCE_LABEL[g.confidence] ?? g.confidence) : null;
                      return (
                        <td key={c.tcgPlayerId} className="py-2 px-2 text-center align-middle">
                          {p != null && g ? (
                            <>
                              <span className={`font-semibold ${cheapest !== null && p === cheapest ? 'text-emerald-600' : 'text-black'}`}>{usd.format(p)}</span>
                              <KrwHint amount={p} currency="usd" />
                              <span className={`block text-[10px] ${g.confidence === 'low' ? 'text-amber-600' : 'text-neutral-400'}`}>
                                {conf ? `신뢰도 ${conf} · ` : ''}
                                {g.count}건
                              </span>
                            </>
                          ) : (
                            <span className="text-neutral-300">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <p className="mt-3 text-[11px] text-neutral-400">
          같은 등급에서 더 싼 쪽을 초록으로 표시합니다. 주황색 <span className="text-amber-600">신뢰도 낮음</span>은 낙찰이 적어 값이
          불확실하니 참고만 하세요. 이베이 낙찰가는 현재 적정가(없으면 중앙값) 기준이며 참고용입니다.
        </p>
      </div>
    </div>
  );
}
