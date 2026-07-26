import { useEffect, useState } from 'react';
import { CONFIDENCE_LABEL, ebaySoldUrl, formatGradeLabel, mainPrice, type EbayCard } from '../api/ebayPrices';
import { KrwHint, KrwRateNote } from './KrwHint';
import { EbayPriceChart } from './EbayPriceChart';
import { reportCardTitleMiss } from '../api/localStats';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

export function EbayCardDetail({ card }: { card: EbayCard }) {
  // 카드 이름 한글화가 이상하면 사용자가 알려준다(스니덩크 상세와 같은 방식).
  // 다른 카드를 열면 버튼이 되살아나도록 카드가 바뀔 때 초기화한다.
  const [titleReported, setTitleReported] = useState(false);
  useEffect(() => setTitleReported(false), [card.tcgPlayerId]);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 sticky top-4">
      <div className="h-40 w-full rounded-lg mb-4 overflow-hidden bg-neutral-100">
        {card.imageUrl && (
          <img src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" />
        )}
      </div>

      <h2 className="text-base font-bold text-black mb-1">{card.name}</h2>
      <p className="text-xs text-neutral-400 mb-1">
        {card.setName}
        {card.cardNumber ? ` · ${card.cardNumber}` : ''} · 낙찰 {card.totalSales.toLocaleString()}건
      </p>
      {titleReported ? (
        <p className="mb-4 text-[11px] text-neutral-400">알려주셔서 감사합니다. 이름을 고치겠습니다.</p>
      ) : (
        <button
          type="button"
          onClick={() => {
            reportCardTitleMiss(card.name, card.nameEn, `https://www.tcgplayer.com/product/${card.tcgPlayerId}`);
            setTitleReported(true);
          }}
          className="mb-4 text-[11px] text-neutral-400 underline hover:text-neutral-600"
        >
          카드 이름이 이상한가요?
        </button>
      )}

      {/* 낙찰 기록이 충분한 등급이 있으면 추이 그래프를 먼저 보여준다. 없으면 스스로
          아무것도 안 그린다. */}
      <EbayPriceChart grades={card.grades} />

      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold text-neutral-500">등급별 이베이 시세</p>
          <span className="text-[11px] text-neutral-400">누르면 이베이 낙찰내역 ↗</span>
        </div>
        {/* 처음 온 사람은 "시세"가 최근 기준인지, "신뢰도"가 뭔지 모른다. 한 줄로만 짚어준다. */}
        <p className="mb-2 mt-0.5 text-[11px] leading-snug text-neutral-400">
          최근 낙찰 기준 현재 시세입니다. 주황색 <span className="text-amber-600">신뢰도 낮음</span>은 거래가 적어
          값이 불확실하니 참고만 하세요.
        </p>
        {/* 메인 값은 PPT의 "현재 적정가"(최근 30일 가중)로, 옛 거래에 안 눌린 지금 시세다.
            없는 등급은 중앙값으로 대체한다. 아래 작은 줄에 중앙값을 참고로 곁들이고, 신뢰도가
            낮으면(거래가 적으면) 눈에 띄게 알린다. 행을 누르면 이베이의 그 등급 "낙찰 완료"
            목록으로 가, PPT엔 없는 개별 낙찰 건(날짜·가격·상품 링크)을 직접 볼 수 있다. */}
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {card.grades.map((g) => {
            const sold = shortDate(g.lastSaleDate);
            const { price, isSmart } = mainPrice(g);
            const conf = isSmart && g.confidence ? (CONFIDENCE_LABEL[g.confidence] ?? g.confidence) : null;
            return (
              <li key={g.grade}>
                <a
                  href={ebaySoldUrl(card.nameEn, card.cardNumber, g.grade)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-700">{formatGradeLabel(g.grade)}</p>
                    <p className="text-[11px] text-neutral-400">
                      {conf && (
                        <span className={g.confidence === 'low' ? 'text-amber-600' : undefined}>신뢰도 {conf} · </span>
                      )}
                      {g.count.toLocaleString()}건{sold ? ` · 마지막 ${sold}` : ''}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-sm font-bold text-black leading-tight">{usd.format(price)}</p>
                    <KrwHint amount={price} currency="usd" />
                    {isSmart && (
                      <p className="text-[11px] text-neutral-400 leading-tight">중앙값 {usd.format(g.medianPrice)}</p>
                    )}
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
