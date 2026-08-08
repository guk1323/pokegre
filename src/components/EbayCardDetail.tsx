import { useEffect, useState } from 'react';
import { CardImg } from './CardImg';
import { CONFIDENCE_LABEL, ebaySoldUrl, formatGradeLabel, mainPrice, type EbayCard } from '../api/ebayPrices';
import { Price, KrwRateNote, useKrw } from './KrwHint';
import { EbayPriceChart } from './EbayPriceChart';
import { reportCardTitleMiss } from '../api/localStats';
import { ShareButton } from './ShareButton';
import { GradedPopulation } from './GradedPopulation';


function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

export function EbayCardDetail({ card, edition }: { card: EbayCard; edition?: string }) {
  // 중앙값도 원화로 적는다(가격 표시를 원화로 통일).
  const krw = useKrw();
  // 카드 이름 한글화가 이상하면 사용자가 알려준다(스니덩크 상세와 같은 방식).
  // 다른 카드를 열면 버튼이 되살아나도록 카드가 바뀔 때 초기화한다.
  const [titleReported, setTitleReported] = useState(false);
  useEffect(() => setTitleReported(false), [card.tcgPlayerId]);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 sticky top-4">
      <div className="h-40 w-full rounded-lg mb-4 overflow-hidden bg-neutral-100">
        {card.imageUrl && (
          <CardImg src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" lazy={false} />
        )}
      </div>

      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="text-base font-bold text-black">{card.name}</h2>
        <ShareButton path={`/e/${card.tcgPlayerId}`} name={card.name} />
      </div>
      <p className="text-xs text-neutral-400 mb-1">
        {card.setName}
        {card.cardNumber ? ` · ${card.cardNumber}` : ''} · 낙찰 {card.totalSales.toLocaleString()}건
        {/* ⚠️ 위 "낙찰 202건"은 다 합친 숫자다. 1년 전에 몰려 팔리고 지금은 안 나가는
            카드와, 지금도 꾸준한 카드가 똑같아 보인다. 최근 한 달을 같이 적으면
            "팔고 싶을 때 팔리는 카드인가"를 알 수 있다. 값이 없으면 안 띄운다. */}
        {card.monthlySales ? ` · 최근 한 달 ${card.monthlySales.toLocaleString()}건` : ''}
      </p>
      {/* ⚠️ **뺐다는 걸 밝힌다.** 저쪽(PPT)은 이름이 겹치는 세트를 한 카드로 묶어 놔서,
          1996년 카드 기록에 2016년 카드가 섞여 온다(사장님이 잡아 주심 2026-08-08).
          말없이 빼면 이베이에서 직접 세어 본 사람과 숫자가 달라 보여 우리가 틀린 줄 안다. */}
      {card.droppedOther ? (
        <p className="mb-1 text-[11px] text-amber-600">
          이름이 같은 다른 세트 카드 {card.droppedOther.toLocaleString()}건은 뺐습니다.
        </p>
      ) : null}
      {titleReported ? (
        <p className="mb-4 text-[11px] text-neutral-400">알려주셔서 감사합니다. 이름을 고치겠습니다.</p>
      ) : (
        <button
          type="button"
          onClick={() => {
            reportCardTitleMiss(card.name, card.nameEn, `https://www.tcgplayer.com/product/${card.tcgPlayerId}`);
            setTitleReported(true);
          }}
          // ⚠️ 글줄이 17px이라 누르기 어려웠다(운영자 지시 2026-08-06). 여백으로 40px까지
            //    넓히되 -my로 되돌려 줄 간격은 그대로 둔다.
            className="-my-3 mb-1 py-3 text-[11px] text-neutral-400 underline hover:text-neutral-600"
        >
          카드 이름이 이상한가요?
        </button>
      )}

      {/* 낙찰 기록이 충분한 등급이 있으면 추이 그래프를 먼저 보여준다. 없으면 스스로
          아무것도 안 그린다. */}
      <EbayPriceChart grades={card.grades} />

      {/* 낙찰 기록이 없는 카드에도 붙는다 — 감정된 게 몇 장인지는 거래와 무관하게 안다. */}
      <GradedPopulation tcgPlayerId={card.tcgPlayerId} edition={edition} />

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
        {/* ⚠️ 비면 테두리만 있는 빈 네모가 떴다. 카드는 찾았는데 아무도 안 판 것이라
            "값이 없다"가 아니라 "거래 내역이 없다"가 맞다(2026-08-07 지적). */}
        {card.grades.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 py-4 text-center text-xs text-neutral-400">
            거래 내역이 없습니다.
          </p>
        ) : (
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
                    <Price amount={price} currency="usd" className="text-sm font-bold text-black leading-tight" />
                    {isSmart && (
                      <p className="text-[11px] text-neutral-400 leading-tight">중앙값 {krw(g.medianPrice, 'usd')}</p>
                    )}
                  </div>
                </a>
                {/* 실제 낙찰 낱개. "28건"이라는 숫자보다 "1월 18일에 $160에 팔렸다"가
                    훨씬 와닿는다. 이 값은 예전부터 응답에 들어 있었는데 안 쓰고 있었다
                    (2026-08-07 발견). 누르면 그 매물로 바로 간다. */}
                {g.sales && g.sales.length > 0 && (
                  <ul className="border-t border-neutral-50 bg-neutral-50/60 px-3 py-1.5">
                    {g.sales.map((s) => (
                      <li key={s.url || `${s.date}-${s.price}`}>
                        <a
                          href={s.url || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-baseline justify-between gap-2 py-0.5 text-[11px] hover:underline"
                        >
                          <span className="text-neutral-500">
                            {s.date.slice(2).replace(/-/g, '.')}
                            <span className="ml-1 text-neutral-400">{s.auction ? '경매' : '즉시구매'}</span>
                          </span>
                          <span className="flex-shrink-0 font-semibold text-neutral-700">
                            {krw(s.price, 'usd')}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        )}
        <KrwRateNote />
      </div>
    </div>
  );
}
