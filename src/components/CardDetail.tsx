import { useEffect, useState } from 'react';
import {
  fetchConditionPrices,
  fetchPriceHistory,
  RAW_GRADE_DESCRIPTION,
  type ConditionGroup,
  type PriceHistory,
  type PriceRange,
  type SnkrdunkCard,
} from '../api/snkrdunk';
import { PriceChart } from './PriceChart';

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function CardDetail({ card }: { card: SnkrdunkCard }) {
  const isBox = card.category === 'box';
  const [groups, setGroups] = useState<ConditionGroup[]>([]);
  const [loading, setLoading] = useState(!isBox);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [range, setRange] = useState<PriceRange>('all');
  // '' = 아직 등급 목록을 못 받았거나(첫 조회) 등급이 없는 상품(박스)
  const [condition, setCondition] = useState('');

  // 박스는 등급(PSA/BGS 등) 개념 자체가 없어서 조회할 필요가 없다 — 등급별
  // 최저가 섹션도 통째로 숨긴다.
  useEffect(() => {
    if (isBox) return;
    setLoading(true);
    setError(null);
    setGroups([]);
    fetchConditionPrices(card.apparelId)
      .then(setGroups)
      .catch(() => setError('등급별 시세를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [card.apparelId, isBox]);

  // 카드를 바꾸면 기간/등급 선택을 되돌린다. 직전 카드에서 "1주"나 "PSA10"을 보다가
  // 넘어왔는데 새 카드엔 그 데이터가 없으면 빈 그래프가 뜨기 때문.
  useEffect(() => {
    setRange('all');
    setCondition('');
  }, [card.apparelId]);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistory(null);
    fetchPriceHistory(card.apparelId, range, condition || undefined)
      .then((result) => {
        if (cancelled || !result) return;
        setHistory(result);
        // 등급이 있는 상품(싱글카드)인데 아직 못 골랐으면 첫 등급으로 자동 선택해서
        // 다시 조회한다. 등급을 안 주면 PSA10과 생카가 한 줄에 섞여 나오기 때문.
        // 박스는 conditions가 빈 배열로 와서 이 분기를 타지 않는다(등급 코드를 넘기면
        // 오히려 실거래 목록이 0건이 된다).
        if (condition === '' && result.conditions.length > 0) {
          setCondition(result.conditions[0].code);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [card.apparelId, range, condition]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 sticky top-4">
      <div className="h-40 w-full rounded-lg mb-4 overflow-hidden bg-neutral-100">
        <img src={card.imageUrl} alt={card.title} className="h-full w-full object-contain" />
      </div>

      <h2 className="text-base font-bold text-black mb-1">{card.title}</h2>
      <p className="text-xs text-neutral-400 mb-4">
        매물 {card.stock.toLocaleString()}개 · 찜 {card.favoriteCount.toLocaleString()}
      </p>

      <div className="rounded-lg bg-neutral-50 p-4 mb-4">
        <p className="text-xs text-neutral-400 mb-1">현재 최저가 (SNKRDUNK)</p>
        <span className="text-2xl font-extrabold text-black">{yen.format(card.price)}</span>
      </div>

      <div className="mb-4">
        <PriceChart
          points={history?.points ?? []}
          ranges={history?.ranges ?? []}
          range={range}
          onRangeChange={setRange}
          conditions={history?.conditions ?? []}
          condition={condition}
          onConditionChange={setCondition}
          loading={historyLoading}
        />
      </div>

      <a
        href={card.link}
        target="_blank"
        rel="noreferrer"
        className="block text-center rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-black hover:bg-neutral-50 mb-4"
      >
        SNKRDUNK에서 원본 보기
      </a>

      {!isBox && (
      <div>
        <p className="text-xs font-semibold text-neutral-500 mb-2">등급별 최저가</p>

        {loading ? (
          <p className="text-xs text-neutral-400 py-4 text-center">불러오는 중...</p>
        ) : error ? (
          <p className="text-xs text-rose-500 py-4 text-center">{error}</p>
        ) : groups.length === 0 ? (
          <p className="text-xs text-neutral-400 py-4 text-center">등급별 매물이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="text-[11px] font-semibold text-neutral-400 mb-1">{group.label}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {group.chips.map((chip) => (
                    <div
                      key={chip.conditionId}
                      title={RAW_GRADE_DESCRIPTION[chip.filterConditionId]}
                      className={`rounded-lg border p-2 text-center ${
                        chip.hasListing ? 'border-neutral-200' : 'border-neutral-100 opacity-50'
                      }`}
                    >
                      <p className="text-[11px] font-semibold text-neutral-600">{chip.text}</p>
                      {chip.hasListing ? (
                        <p className="text-xs font-bold text-black">{yen.format(chip.usedMinPrice ?? 0)}</p>
                      ) : (
                        <p className="text-[11px] text-neutral-400">매물없음</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
