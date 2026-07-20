import { useEffect, useState, type ReactNode } from 'react';
import { fetchConditionPrices, fetchPriceHistory, RAW_GRADE_DESCRIPTION, type ConditionGroup, type PricePoint, type SnkrdunkCard } from '../api/snkrdunk';
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

// 전체 기간 시세 변동률(첫 실거래가 대비 마지막). 상세 화면 차트와 같은 계산.
function trendPct(points: PricePoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].price;
  const last = points[points.length - 1].price;
  if (!first) return null;
  return ((last - first) / first) * 100;
}

// 상태·등급별 매물이 있는 것만 뽑아 {코드, 이름, 최저가}로 평탄화(그룹 순서 유지).
function condList(groups: ConditionGroup[]): { code: string; text: string; price: number }[] {
  const out: { code: string; text: string; price: number }[] = [];
  // 원본 등급표기(A/B/C/D)는 뜻이 안 통하니, 있으면 한글 설명(거의 미사용 등)으로. PSA·BGS
  // 같은 등급은 그대로 두되, "PSA8以下"의 以下(이하)·以上(이상)·"他鑑定品"(기타 감정) 같은
  // 한자 표기는 한글로 바꾼다.
  for (const g of groups)
    for (const c of g.chips)
      if (c.hasListing && c.usedMinPrice) {
        const label = (RAW_GRADE_DESCRIPTION[c.filterConditionId] ?? c.text)
          .replace(/他鑑定品/g, '기타 감정')
          .replace(/以下/g, ' 이하')
          .replace(/以上/g, ' 이상');
        out.push({ code: c.filterConditionId, text: label, price: c.usedMinPrice });
      }
  return out;
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

// 운영자 전용(베타) 카드 비교. 담아둔 2장을 나란히 놓고 최저가·시세추이·상태별 가격을 본다.
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

  // 카드별 시세 추이(%)와 상태·등급별 가격을 각각 한 번씩 불러온다. 스니덩크라 무료·캐시.
  const [trends, setTrends] = useState<Record<number, number | null>>({});
  const [conds, setConds] = useState<Record<number, { code: string; text: string; price: number }[]>>({});
  const [loading, setLoading] = useState(true);
  const ids = cards.map((c) => c.apparelId).join(',');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      cards.map(async (c) => {
        const [hist, groups] = await Promise.all([
          fetchPriceHistory(c.apparelId, 'all').catch(() => null),
          fetchConditionPrices(c.apparelId).catch(() => [] as ConditionGroup[]),
        ]);
        return { id: c.apparelId, trend: hist && hist.points.length ? trendPct(hist.points) : null, cond: condList(groups) };
      }),
    ).then((rows) => {
      if (cancelled) return;
      setTrends(Object.fromEntries(rows.map((r) => [r.id, r.trend])));
      setConds(Object.fromEntries(rows.map((r) => [r.id, r.cond])));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // 두 카드에 등장하는 상태·등급을 (그룹 순서대로) 합쳐 정렬한다.
  const orderedConds: { code: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const c of cards) for (const x of conds[c.apparelId] ?? []) if (!seen.has(x.code)) { seen.add(x.code); orderedConds.push({ code: x.code, text: x.text }); }

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
                  <a
                    href={c.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-[11px] font-semibold text-[#2a78d6] hover:underline"
                  >
                    스니덩크에서 보기 ↗
                  </a>
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
            <Row
              label="시세 추이"
              cards={cards}
              render={(c) => {
                if (loading) return <span className="text-neutral-300">…</span>;
                const t = trends[c.apparelId];
                if (t == null) return <span className="text-neutral-400">-</span>;
                const up = t >= 0;
                // 이 앱 관례: 오름=빨강(▲), 내림=초록(▼).
                return (
                  <span className={up ? 'font-semibold text-rose-500' : 'font-semibold text-emerald-600'}>
                    {up ? '▲' : '▼'} {Math.abs(t).toFixed(1)}%
                  </span>
                );
              }}
            />
            <Row label="매물" cards={cards} render={(c) => <span className="text-neutral-700">{c.stock.toLocaleString()}개</span>} />

            {/* 상태·등급별 최저가 */}
            <tr className="border-t border-neutral-200">
              <th colSpan={cards.length + 1} className="pt-4 pb-1 text-left text-xs font-bold text-neutral-500">
                상태·등급별 최저가
              </th>
            </tr>
            {loading ? (
              <tr>
                <td colSpan={cards.length + 1} className="py-3 text-center text-xs text-neutral-300">불러오는 중…</td>
              </tr>
            ) : orderedConds.length === 0 ? (
              <tr>
                <td colSpan={cards.length + 1} className="py-3 text-center text-xs text-neutral-400">상태·등급별 매물 정보가 없어요.</td>
              </tr>
            ) : (
              orderedConds.map(({ code, text }) => (
                <tr key={code} className="border-t border-neutral-50">
                  <th className="py-2 pr-3 text-left align-middle text-xs font-medium text-neutral-500 whitespace-nowrap">{text}</th>
                  {cards.map((c) => {
                    const found = (conds[c.apparelId] ?? []).find((x) => x.code === code);
                    return (
                      <td key={c.apparelId} className="py-2 px-2 text-center align-middle">
                        {found ? <span className="font-semibold text-black">{yen.format(found.price)}</span> : <span className="text-neutral-300">-</span>}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>

        <p className="mt-3 text-[11px] text-neutral-400">
          최저가가 더 싼 쪽을 초록으로, 시세 추이는 오름 ▲빨강 / 내림 ▼초록으로 표시했어요. 참고용이며 실제 거래가와 다를 수 있어요.
        </p>
      </div>
    </div>
  );
}
