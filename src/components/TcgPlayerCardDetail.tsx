import { useEffect, useState } from 'react';
import { CardImg } from './CardImg';
import type { EbayCard, EbayGradeStat } from '../api/ebayPrices';
import { Price, KrwRateNote } from './KrwHint';
import { EbayPriceChart } from './EbayPriceChart';
import { reportCardTitleMiss } from '../api/localStats';
import { ShareButton } from './ShareButton';
import { GradedPopulation } from './GradedPopulation';


// 마켓가가 잡힌 매물의 상태를 한글로. **민트면 null**(굳이 알릴 게 없다).
// 저쪽 값은 "Moderately Played 1st Edition - Japanese"처럼 인쇄·판까지 붙어서 온다.
function 상태글(cond: string | null): string | null {
  if (!cond) return null;
  if (/Near Mint/i.test(cond)) return null;
  if (/Lightly Played/i.test(cond)) return '조금 사용된';
  if (/Moderately Played/i.test(cond)) return '보통 사용된';
  if (/Heavily Played/i.test(cond)) return '많이 사용된';
  if (/Damaged/i.test(cond)) return '손상된';
  return null; // 모르는 표기는 조용히 넘긴다 — 틀리게 말하느니 안 하는 게 낫다
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

// TCGplayer(미국 마켓) 시세 상세. 이베이가 "등급별 낙찰가"라면 이쪽은 미감정 카드의
// 시장가(마켓가)와 현재 최저가를 보여준다. 데이터는 이베이와 같은 PPT 응답에서 온다.
export function TcgPlayerCardDetail({ card, edition }: { card: EbayCard; edition?: string }) {
  const t = card.tcgplayer;
  const updated = shortDate(t?.lastUpdated ?? null);
  // 카드 이름 한글화가 이상하면 사용자가 알려준다(스니덩크 상세와 같은 방식).
  const [titleReported, setTitleReported] = useState(false);
  useEffect(() => setTitleReported(false), [card.tcgPlayerId]);
  // 시세 추이 그래프. 이베이 차트 컴포넌트를 재사용한다 — 등급 하나("RAW"=미감정)짜리
  // 목록으로 감싸면 등급 선택칩 하나 + 추이선이 그려진다.
  const history = t?.history ?? [];
  const chartGrades: EbayGradeStat[] =
    history.length >= 2
      ? [
          {
            grade: 'raw',
            count: 0,
            averagePrice: 0,
            medianPrice: 0,
            minPrice: 0,
            maxPrice: 0,
            marketTrend: null,
            lastSaleDate: null,
            smartPrice: null,
            confidence: null,
            history,
          },
        ]
      : [];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 sticky top-4">
      <div className="h-40 w-full rounded-lg mb-4 overflow-hidden bg-neutral-100">
        {card.imageUrl && <CardImg src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" lazy={false} />}
      </div>

      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="text-base font-bold text-black">{card.name}</h2>
        <ShareButton path={`/t/${card.tcgPlayerId}`} name={card.name} />
      </div>
      <p className="text-xs text-neutral-400 mb-1">
        {card.setName}
        {card.cardNumber ? ` · ${card.cardNumber}` : ''}
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

      {t ? (
        <a
          href={t.url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-neutral-200 hover:bg-neutral-50"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-700">마켓 시세{t.printing ? ` · ${t.printing}` : ''}</p>
              <p className="text-[11px] text-neutral-400">미감정(로우) 기준 · 눌러서 TCGplayer ↗</p>
              {상태글(t.condition) && (
                // ⚠️ 민트가 아닌 매물로 값이 잡힌 카드가 생각보다 많다 — 옛 일본판
                //    121장 중 72장(60%)이 그랬고, "손상됨" $0.25짜리도 있었다
                //    (2026-08-07 실측). 그냥 "시세"로 보여 주면 상태 좋은 카드를 가진
                //    사람이 자기 카드 값을 그만큼으로 오해한다. 민트일 때는 안 띄운다.
                <p className="mt-0.5 text-[11px] font-semibold text-amber-600">
                  {상태글(t.condition)} 매물 기준입니다. 상태가 좋으면 값이 더 높습니다.
                </p>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <Price amount={t.market} currency="usd" className="text-lg font-bold text-black leading-tight" />
            </div>
          </div>
          {t.low > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-4 py-2">
              <p className="text-xs text-neutral-500">현재 최저가</p>
              <div className="text-right">
                <Price amount={t.low} currency="usd" className="text-sm font-semibold text-neutral-700 leading-tight" />
              </div>
            </div>
          )}
        </a>
      ) : (
        <p className="text-sm text-neutral-400 py-8 text-center">시세 데이터가 없습니다.</p>
      )}

      <GradedPopulation tcgPlayerId={card.tcgPlayerId} edition={edition} />

      {chartGrades.length > 0 && (
        <div className="mt-3">
          <EbayPriceChart grades={chartGrades} title="마켓 시세 추이" />
        </div>
      )}

      <p className="mt-2 text-[11px] leading-snug text-neutral-400">
        판매자 {t?.sellers?.toLocaleString() ?? 0}명{updated ? ` · ${updated} 기준` : ''}. 실제 팔린 값을 반영한
        시세입니다. 감정(PSA·BGS 등) 카드는 값이 다르니 등급 시세는 eBay에서 확인해 주세요.
      </p>
      <KrwRateNote />
    </div>
  );
}
