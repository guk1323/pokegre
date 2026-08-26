import { formatGradeLabel, 대표등급, mainPrice, type EbayCard } from '../api/ebayPrices';
import { 상태글 } from '../lib/tcgCondition';
import { 레어도한글 } from '../lib/rarityCode';
import { Price } from './KrwHint';
import { CardImg } from './CardImg';


export function EbayCardTile({
  card,
  selected,
  onSelect,
  onCompare,
  inCompare,
  variant = 'ebay',
}: {
  card: EbayCard;
  selected: boolean;
  onSelect: (id: string) => void;
  // 비교 담기. onCompare가 있을 때만 버튼이 뜬다(등급표를 견주는 것이라 eBay 눈에서만 준다).
  onCompare?: (card: EbayCard) => void;
  inCompare?: boolean;
  // 'ebay'면 등급별 대표가, 'tcgplayer'면 TCGplayer 마켓가를 대표가로 보여준다.
  variant?: 'ebay' | 'tcgplayer';
}) {
  // 목록 대표가도 상세와 같은 기준(현재 적정가, 없으면 중앙값)으로 맞춘다.
  const topGrade = 대표등급(card.grades);
  const top = topGrade ? mainPrice(topGrade) : null;
  const tcg = card.tcgplayer;

  return (
    <button
      type="button"
      onClick={() => onSelect(card.tcgPlayerId)}
      /* ⚠️ `flex flex-col` — <button>은 안의 내용을 **세로 가운데**에 놓는다. 격자가 칸 높이를
         옆 칸에 맞춰 늘리면, 내용이 짧은 칸(시세 없음·이름 한 줄)은 그림이 가운데로 내려가
         옆 그림과 어긋났다(사장님 지적 2026-08-21). 위부터 쌓이게 한다. */
      className={`flex flex-col text-left rounded-xl border border-neutral-200 bg-white p-3 transition hover:shadow-md focus:outline-none ${
        selected ? 'ring-2 ring-black ring-offset-2' : ''
      }`}
    >
      {/* ⚠️ `card-dim` — **어두운 화면에서만** 사진 밝기를 살짝 낮춘다(index.css).
          바탕만 어둡게 하면 밝은 카드 사진이 어두운 판에 박혀 더 눈부시다. 마우스를
          올리면 원래 밝기로 돌아온다. 밝은 화면에서는 아무 일도 안 한다. */}
      <div className="card-dim h-36 w-full rounded-lg mb-3 overflow-hidden bg-neutral-100">
        {/* TCGplayer 이미지는 원본이 이미 400px로 작아서 축소(wsrv)를 거치지 않는다.
            거치면 wsrv가 tcgplayer CDN을 못 불러와 이미지가 깨진다. */}
        {card.imageUrl ? (
          <CardImg src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" 일반판그림={card.imgBase} />
        ) : (
          // ⚠️ 빈 회색 상자만 두면 고장난 것처럼 보인다. 왜 없는지 한 줄로 밝힌다.
          //    저쪽이 여러 카드를 한 칸에 묶어 둔 것을 우리가 번호로 갈랐는데, 그 사진은
          //    묶인 칸 하나의 것이라 갈라 놓은 카드에 붙이면 전부 같은 사진이 된다.
          //    이 리포의 원칙대로 **틀린 것보다 빈칸**이다.
          <p className="flex h-full items-center justify-center px-2 text-center text-[11px] leading-snug text-neutral-400">
            사진 없음
          </p>
        )}
      </div>
      {/* ⚠️ 이름 두 줄·세트 한 줄 자리를 **미리 잡아 둔다**(min-h) — CardTile과 같은 방식.
          안 그러면 이름이 짧은 카드와 긴 카드의 값 줄 높이가 달라 옆 칸과 어긋난다. */}
      <p className="font-semibold text-sm leading-snug text-black line-clamp-2 min-h-[2.5rem] mb-1">{card.name}</p>
      {/* ⚠️ 눌러 보기 전에 알아야 한다. 이 칸의 낙찰은 어느 카드인지 가릴 수 없어서
          값이 그 카드 시세가 아니다(상세에서 까닭을 자세히 밝힌다). */}
      {card.가릴수없음 && (
        <p className="mb-1 inline-block rounded bg-amber-50 px-1.5 py-px text-[10px] text-amber-700">
          값을 믿지 마세요 · 여러 카드가 섞임
        </p>
      )}
      {/* ⚠️ **레어도를 목록에서도 보여준다.** 같은 이름의 카드가 여러 장일 때(기본판·SR·SAR)
          레어도가 없으면 어느 것인지 못 가린다 — 값이 크게 갈리는 자리다(2026-08-09 지시).
          한글은 `레어도한글` 한 벌만 쓴다(팝수 화면과 같은 것). */}
      <p className="text-xs text-neutral-400 mb-1 line-clamp-1 min-h-[1rem]">
        {card.setName}
        {card.rarity ? ` · ${레어도한글(card.rarity)}` : ''}
      </p>
      {/* 값이 없는 카드도 그 자리를 비워 두지 않고 「시세 없음」으로 채운다 — 아래칸이
          없어 그림이 내려앉던 것을 막고, 왜 값이 안 보이는지도 알린다(CardTile과 같다). */}
      {(variant === 'tcgplayer' ? !tcg : !(topGrade && top)) && (
        <p className="text-sm font-semibold text-neutral-400">시세 없음</p>
      )}
      {variant === 'tcgplayer'
        ? tcg && (
            <>
              <Price amount={tcg.market} currency="usd" />
              {/* ⚠️ **어떤 상태의 매물로 잡힌 값인지 목록에서도 밝힌다.** 옛 일본판은
                  매물이 귀해 민트가 아닌 카드로 값이 잡히는 일이 흔하다 — 실측으로
                  TCGplayer 값이 있는 카드의 28%가 그랬다(2026-08-08). 상세에만 적어
                  두면, 목록을 훑는 사람은 민트 값인 줄 안다. */}
              {상태글(tcg.condition) && (
                <p className="text-[10px] leading-tight text-amber-700">{상태글(tcg.condition)} 매물 기준</p>
              )}
            </>
          )
        : topGrade &&
          top && (
            <>
              <p className="text-[11px] font-semibold text-neutral-500">{formatGradeLabel(topGrade.grade)}</p>
              <Price amount={top.price} currency="usd" />
            </>
          )}
      {/* 비교 단추는 칸 바닥에 붙인다(mt-auto) — 값 줄 높이가 달라도 옆 칸과 나란하다. */}
      {onCompare && (
        <div className="mt-auto pt-2">
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
          className={`inline-block cursor-pointer rounded-lg border px-2 py-1 text-xs font-semibold ${
            inCompare ? 'border-[#2a78d6] bg-[#2a78d6] text-white' : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          {inCompare ? '비교 담김 ✓' : '⇄ 비교'}
        </span>
        </div>
      )}
    </button>
  );
}
