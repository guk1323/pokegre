import type { SnkrdunkCard } from '../api/snkrdunk';
import { thumb } from '../lib/cardImg';
import { FavoriteButton } from './FavoriteButton';
import { Price } from './KrwHint';


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
      // 선택 표시는 타일 "안쪽"에 그린다. 바깥으로 그리면(ring-offset) 가로로 늘어놓은
      // 줄에서 옆 카드를 침범한다 — 최근 본 카드·즐겨찾기 줄에서 선택된 카드만
      // 옆 카드를 파고든다는 제보가 있었다. 안쪽이면 어떤 간격에서도 절대 안 겹친다.
      // w-full이 없으면 button은 제 내용만큼 넓어진다(inline-block). 제목에 띄어쓸 수
      // 없는 긴 덩어리가 있으면("개굴닌자 프로모[PROMO339 S-P]") 자리(176px)를 넘어
      // 198px까지 커져서 옆 카드를 침범한다. 딱 그 카드만 그래서 찾기 어려웠다.
      className={`w-full text-left rounded-xl bg-white p-3 transition hover:shadow-md focus:outline-none ${
        selected ? 'ring-2 ring-inset ring-black' : 'ring-1 ring-inset ring-neutral-200'
      }`}
    >
      <div className="card-dim relative h-36 w-full rounded-lg mb-3 overflow-hidden bg-neutral-100">
        {/* 스니덩크 원본은 1000x730 가로 캔버스 한가운데에 카드가 가로 44%·세로 84%만
            차지하도록 들어 있다(카드 6장 실측, 여백은 늘 같다). 그대로 두면 카드가 작게
            떠 있어서 예전에는 CSS로 1.55배 키웠는데, 그러면 이베이 탭보다 8% 작게 나오고
            (스니덩크 96x133 / 이베이 104x144) 이미지가 틀을 넘어 잘렸다.
            프록시가 투명한 여백을 잘라 주므로(trim) 카드만 남고, 확대 없이 이베이와
            같은 크기가 된다. 파일도 절반이라(94KB→51KB) 폰에서 더 빠르다. */}
        <img
          src={thumb(card.imageUrl, 320)}
          alt={card.title}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            // 프록시가 실패하면 원본을 그대로 쓴다(빈칸 방지).
            const img = e.currentTarget;
            if (img.src !== card.imageUrl) img.src = card.imageUrl;
          }}
        />
        {onToggleFavorite && <FavoriteButton active={!!isFavorite} onToggle={() => onToggleFavorite(card)} />}
      </div>
      {/* 카드 이름은 "이름 [세트 번호](팩 이름)" 한 덩어리로 온다. 그대로 두 줄로 자르면
          팩 이름이 "(하…"에서 끊겨 어느 팩인지 알 수 없었다. 이름과 팩을 나눠 놓는다.
          ⚠️ 이름 두 줄·팩 한 줄 자리를 **미리 잡아 둔다**(min-h). 안 그러면 이름이 짧은
             카드는 타일이 그만큼 짧아져서, 나란히 놓인 카드들의 키가 제각각이 된다
             (운영자 지적 2026-08-05 — "피카츄 P"는 한 줄, "토호쿠의 피카츄 P"는 두 줄).
             팩 이름이 없는 카드도 줄은 남겨 둔다 — 있는 카드와 키를 맞추려는 것이다. */}
      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-black">
        {cardTitleMain(card.title)}
      </p>
      <p className="mb-1 line-clamp-1 min-h-[1rem] text-[11px] text-neutral-400">
        {cardTitlePack(card.title) || '\u00a0'}
      </p>
      {/* 찜 수는 검색 결과에만 있다. 저장해둔 카드를 ID로 복원한 경우엔 값이 없어서
          "매물 N개"만 보여준다. */}
      <p className="mt-0.5 text-xs text-neutral-400 mb-1">
        매물 {card.stock.toLocaleString()}개
        {card.favoriteCount !== undefined && ` · 찜 ${card.favoriteCount.toLocaleString()}`}
      </p>
      {/* 매물이 없으면 가격이 0/NaN으로 와서 "￥NaN"처럼 깨져 보인다. 그럴 땐 시세를
          숨기고 안내만 남긴다. */}
      {Number.isFinite(card.price) && card.price > 0 ? (
        <>
          <Price amount={card.price} currency="jpy" />
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

// "메가리자몽 X ex MA [M2a 223/193](확장팩「메가진화」)" 를 둘로 나눈다.
// 앞: 카드 이름과 세트·번호  /  뒤: 팩 이름(괄호 안)
function cardTitleMain(title: string): string {
  return title.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

function cardTitlePack(title: string): string {
  const m = title.match(/\(([^()]*)\)\s*$/);
  return m ? m[1].trim() : '';
}
