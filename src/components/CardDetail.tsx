import { useEffect, useState } from 'react';
import {
  fetchConditionPrices,
  RAW_GRADE_DESCRIPTION,
  type ConditionGroup,
  type SnkrdunkCard,
} from '../api/snkrdunk';

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function CardDetail({ card }: { card: SnkrdunkCard }) {
  const isBox = card.category === 'box';
  const [groups, setGroups] = useState<ConditionGroup[]>([]);
  const [loading, setLoading] = useState(!isBox);
  const [error, setError] = useState<string | null>(null);

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
