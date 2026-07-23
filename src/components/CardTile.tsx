import type { SnkrdunkCard } from '../api/snkrdunk';
import { FavoriteButton } from './FavoriteButton';
import { KrwHint } from './KrwHint';

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function CardTile({
  card,
  selected,
  onSelect,
  isFavorite,
  onToggleFavorite,
  onCompare,
  inCompare,
}: {
  card: SnkrdunkCard;
  selected: boolean;
  onSelect: (id: number) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (card: SnkrdunkCard) => void;
  // 비교 담기(운영자 베타). onCompare가 있을 때만 버튼이 뜬다.
  onCompare?: (card: SnkrdunkCard) => void;
  inCompare?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(card.apparelId)}
      className={`text-left rounded-xl border border-neutral-200 bg-white p-3 transition hover:shadow-md focus:outline-none ${
        selected ? 'ring-2 ring-black ring-offset-2' : ''
      }`}
    >
      <div className="relative h-36 w-full rounded-lg mb-3 overflow-hidden bg-neutral-100">
        {/* 스니덩크 이미지는 배경제거된 가벼운 webp이고 CDN이 한국에서 빠르다(≈95ms).
            우리 프록시나 유럽 CDN을 거치면 오히려 첫 로딩이 느려져서 원본을 그대로 쓴다. */}
        <img src={card.imageUrl} alt={card.title} className="h-full w-full object-contain" loading="lazy" />
        {onToggleFavorite && <FavoriteButton active={!!isFavorite} onToggle={() => onToggleFavorite(card)} />}
      </div>
      <p className="font-semibold text-sm text-black line-clamp-2 mb-1">{card.title}</p>
      {/* 찜 수는 검색 결과에만 있다. 저장해둔 카드를 ID로 복원한 경우엔 값이 없어서
          "매물 N개"만 보여준다. */}
      <p className="text-xs text-neutral-400 mb-1">
        매물 {card.stock.toLocaleString()}개
        {card.favoriteCount !== undefined && ` · 찜 ${card.favoriteCount.toLocaleString()}`}
      </p>
      {/* 매물이 없으면 가격이 0/NaN으로 와서 "￥NaN"처럼 깨져 보인다. 그럴 땐 시세를
          숨기고 안내만 남긴다. */}
      {Number.isFinite(card.price) && card.price > 0 ? (
        <>
          <p className="text-base font-bold text-black">{yen.format(card.price)}</p>
          <KrwHint amount={card.price} currency="jpy" />
        </>
      ) : (
        <p className="text-sm font-semibold text-neutral-400">시세 없음</p>
      )}
      {onCompare && (
        // 카드 전체가 button이라, 여기선 실제 button 대신 클릭 가로채는 span으로 둔다
        // (button 중첩 방지). 선택(onSelect)과 겹치지 않게 이벤트 전파를 막는다.
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
