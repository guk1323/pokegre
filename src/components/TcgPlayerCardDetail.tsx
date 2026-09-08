import { CardImg } from './CardImg';
import { AdSlot } from './AdSlot';
import type { EbayCard, EbayGradeStat } from '../api/ebayPrices';
import { Price, KrwRateNote } from './KrwHint';
import { EbayPriceChart } from './EbayPriceChart';
import { CardNameReport } from './CardNameReport';
import { ShareButton } from './ShareButton';
import { GradedPopulation } from './GradedPopulation';
import { 상태글 } from '../lib/tcgCondition';


// 마켓가가 잡힌 매물의 상태를 한글로. **민트면 null**(굳이 알릴 게 없다).
// 저쪽 값은 "Moderately Played 1st Edition - Japanese"처럼 인쇄·판까지 붙어서 온다.

// TCGplayer(미국 마켓) 시세 상세. 이베이가 "등급별 낙찰가"라면 이쪽은 미감정 카드의
// 시장가(마켓가)와 현재 최저가를 보여준다. 데이터는 이베이와 같은 PPT 응답에서 온다.
export function TcgPlayerCardDetail({ card, edition }: { card: EbayCard; edition?: string }) {
  const t = card.tcgplayer;
  /** 인쇄판이 둘 이상인가. 하나뿐이면(전체의 68%) 화면이 예전 그대로다. */
  const 여럿 = !!t?.printings && t.printings.length > 1;
  /**
   * 인쇄판 이름에서 **모두에게 똑같이 붙는 꼬리말**을 뗀다.
   *
   * ⚠️ 「1st Edition Holofoil」·「Unlimited Holofoil」에서 `Holofoil`은 둘 다 같아
   *    가르는 데 아무 몫이 없는데, 좁은 시트에서 **정작 다른 앞부분을 밀어내 잘리게** 한다
   *    (2026-08-18 화면에서 잡았다 — 「1st Edition Hol…」로 나왔다).
   * ⚠️ **모두가 공유할 때만** 뗀다. 하나라도 다르면 그 말이 뜻을 가지므로 그대로 둔다.
   * ⚠️ 다 떼서 빈 이름이 되면 원래 이름을 쓴다(꼬리말이 곧 이름인 카드가 있다).
   */
  const 짧은인쇄판 = (() => {
    const 것 = t?.printings ?? [];
    if (것.length < 2) return (p: string) => p;
    const 쪼갠 = 것.map((p) => p.printing.trim().split(/\s+/));
    let 뗄개수 = 0;
    while (true) {
      const 끝 = 쪼갠[0][쪼갠[0].length - 1 - 뗄개수];
      if (!끝) break;
      if (!쪼갠.every((w) => w.length - 1 - 뗄개수 > 0 && w[w.length - 1 - 뗄개수] === 끝)) break;
      뗄개수++;
    }
    if (!뗄개수) return (p: string) => p;
    return (p: string) => {
      const w = p.trim().split(/\s+/);
      const 남 = w.slice(0, Math.max(1, w.length - 뗄개수)).join(' ');
      return 남 || p;
    };
  })();
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
  // ⚠️ 추이가 큰 숫자와 **다른 상태**일 수 있다. 그 상태의 추이가 아예 없는 카드가
  //    있어서다(뮤츠 118/128은 큰 숫자가 "많이 사용된"인데 추이는 민트·조금·손상만
  //    있다). 그럴 땐 제목에 밝힌다 — 안 밝히면 큰 숫자와 그래프가 50달러씩 벌어져도
  //    왜인지 알 수 없다. 둘이 같은 상태면 굳이 안 적는다.
  const 큰숫자상태 = 상태글(t?.condition ?? null);
  const 추이상태 = 상태글(t?.historyCondition ?? null);
  const 추이제목 =
    (t?.historyCondition ?? null) === (t?.condition ?? null) || 추이상태 === 큰숫자상태
      ? '실거래가 추이'
      : `실거래가 추이 · ${추이상태 ?? '민트'} 기준`;
  return (
    <div
      // ⚠️⚠️ **붙여 두되(sticky) 안쪽이 스크롤되게 한다.**
      //    상세가 화면보다 길면(등급표+그래프+낱개가 쌓이면 1,100px을 넘는다) 붙어 있는 채로
      //    아래쪽이 화면 밖에 남는다. 그러면 **왼쪽 목록을 끝까지 내려야** 비로소 상세 밑이
      //    보인다 — 목록이 2,000px을 넘으니 사실상 못 본다
      //    (사장님 지적 2026-08-15: "어느정도 훨씬 더 내려야 상세보기도 내려가져").
      //    화면 높이에서 위 여백(top-4=16px)과 아래 숨 쉴 자리를 뺀 만큼으로 묶고,
      //    넘치면 **패널 안에서** 굴리게 한다.
      //    ⚠️ `100dvh`를 쓴다 — 폰 주소창이 접히고 펴져도 값이 따라 바뀐다(`vh`는 안 바뀐다).
      //    ⚠️ 이 칸은 `lg` 이상에서만 보인다(좁은 화면은 시트가 대신한다).
      className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain rounded-xl border border-neutral-200 bg-white p-5"
    >
      <div className="h-40 w-full rounded-lg mb-4 overflow-hidden bg-neutral-100">
        {card.imageUrl && <CardImg src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" lazy={false} />}
      </div>

      {/* ⚠️ 저쪽이 이름만으로 여러 카드를 묶어 둔 칸이면 마켓가도 그 뭉치의 값이다.
          이베이 화면과 같은 말로 밝힌다 — 한쪽만 밝히면 다른 쪽에서 그대로 믿는다. */}
      {card.가릴수없음 && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
          이 칸에는 <b>어느 카드인지 가릴 수 없는 매물</b>이 섞여 있습니다. 매물 제목에 번호도 세트도
          적혀 있지 않아 서로 다른 카드가 함께 잡힙니다. <b>값은 믿지 마세요.</b>
        </p>
      )}
      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="text-base font-bold text-black">{card.name}</h2>
        {/* ⚠️ 대표 주소(/card/)를 준다 — EbayCardDetail 설명 참고. */}
        <ShareButton path={`/card/${card.tcgPlayerId}`} name={card.name} />
      </div>
      <p className="text-xs text-neutral-400 mb-1">
        {card.setName}
        {card.cardNumber ? ` · ${card.cardNumber}` : ''}
      </p>
      <CardNameReport
        title={card.name}
        raw={card.nameEn}
        link={`https://www.tcgplayer.com/product/${card.tcgPlayerId}`}
        className="mb-4"
      />

      {t ? (
        <a
          href={t.url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-neutral-200 hover:bg-neutral-50"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              {/* ⚠️ 인쇄판이 여럿이면 머리글에 이름을 안 적는다 — 아래에 줄마다 적히므로
                  같은 말이 두 번 나오고, 머리글의 그 하나가 「대표」로 읽힌다. */}
              <p className="text-sm font-semibold text-neutral-700">마켓 시세{!여럿 && t.printing ? ` · ${t.printing}` : ''}</p>
              {/* ⚠️ **「눌러서 TCGplayer ↗」는 제 줄에 통째로 둔다**(사장님 지적 2026-08-27).
                  이 칸은 오른쪽 큰 값에 밀려 **146px**뿐인데 한 줄로 쓰면 186px이라 늘 갈린다.
                  그냥 두면 브라우저가 띄어쓰기마다 끊어 「…기준 · 눌러서」/「TCGplayer ↗」가
                  되어, **눌러야 할 것이 무엇인지가 두 줄로 찢어졌다.**
                  ⚠️ 가운뎃점(·)으로 이어 붙이고 안 끊기게만 묶어 봤더니, 이번엔 그 점이
                     **아랫줄 맨 앞에 홀로 남아** 점 하나가 떠 보였다. 두 말을 한 줄에
                     이으려고 있는 점이니, **줄을 가를 바엔 점을 뺀다.**
                  ⚠️ 안 끊기게(`whitespace-nowrap`) 묶는 것은 그대로 둔다 — 폰처럼 더 좁은
                     자리에서도 「눌러서」와 「TCGplayer ↗」가 갈라지면 안 된다. */}
              <p className="text-[11px] text-neutral-400">{여럿 ? '인쇄판마다 값이 다릅니다' : '미감정 싱글 기준'}</p>
              <p className="whitespace-nowrap text-[11px] text-neutral-400">눌러서 TCGplayer ↗</p>
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
            {/* ⚠️ 인쇄판이 여럿이면 큰 값을 여기 안 적는다 — 아래에서 인쇄판마다 적는다.
                한 값만 크게 두면 「그게 내 카드 값」으로 읽힌다. */}
            {!여럿 && (
              <div className="flex-shrink-0 text-right">
                <Price amount={t.market} currency="usd" className="text-lg font-bold text-black leading-tight" />
              </div>
            )}
          </div>
          {/* ⚠️⚠️ **인쇄판이 여럿이면 전부 보인다**(사장님 2026-08-18 결정).
              같은 카드라도 인쇄판이 다르면 값이 크게 갈린다 — 인쇄판 둘 이상인 카드
              16,818장 중 61%가 2배 넘게 다르다(리자몽 베이스셋 $10,000 ↔ $2,146).
              한 줄만 보이면 흔한 쪽을 가진 사람이 남의 값을 본다.
              ⚠️ 거의 전부가 정확히 둘이라(둘 16,742장 · 셋 76장) 접거나 탭을 둘 이유가 없다.
              ⚠️ 색은 `neutral` 사다리만 쓴다 — `dark:`를 붙이면 도로 어두워진다. */}
          {여럿 && t.printings!.map((p) => (
            <div key={p.printing} className="flex items-center justify-between gap-2 border-t border-neutral-100 px-4 py-2.5">
              <p className="min-w-0 truncate text-sm text-neutral-700">{짧은인쇄판(p.printing)}</p>
              <Price amount={p.market} currency="usd" className="flex-shrink-0 text-base font-bold text-black leading-tight" />
            </div>
          ))}
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

      {chartGrades.length > 0 && (
        <div className="mt-3">
          <EbayPriceChart grades={chartGrades} title={추이제목} />
        </div>
      )}

      {/* ⚠️ **한 줄로 줄였다**(사장님 지시 2026-08-27: 「쓸데없는 문장은 좀 지우려고」).
          뺀 것과 까닭:
          · **판매자 수** — 덤프에 그 값이 없어 **모르는데 「0명」으로 찍고 있었다.**
            파는 사람이 없는데 시세가 있다는 말이 되어 거짓이었다(「없음」과 「0」은 다르다).
          · **날짜** — 바로 아래 `KrwRateNote`가 「원화는 8월 26일 참고값입니다」를 내는데,
            날짜 둘이 나란히 서고 **심지어 서로 달라서** 무슨 날짜인지 못 가린다.
          · **「등급 시세는 eBay에서」** — 같은 화면에 이베이 탭이 바로 옆에 있다. */}
      <p className="mt-2 text-[11px] leading-snug text-neutral-400">미감정 싱글 판매완료 가격입니다.</p>
      <KrwRateNote />

      {/* ⚠️⚠️ **감정 수량은 시세·그래프 아래다 — 이베이 화면과 같은 차례로 맞춘다.**
          2026-08-19에 사장님이 이베이에서 「시세 나오는 곳 중간에 껴 가지고 짜증나네」라고
          하셔서 아래로 내렸는데, **이쪽은 같이 안 고쳐 혼자 그래프 위에 남아 있었다**
          (2026-08-27 지적). 같은 부품을 두 화면이 쓰면 **자리도 같아야** 한다.
      ⚠️ `population`을 그대로 넘긴다 — 카드를 열 때 추이·낱개와 한 번에 받아 오므로
         여기서 또 부를 이유가 없다. 옛 길 카드는 undefined가 넘어가 스스로 받아 온다. */}
      <GradedPopulation
        tcgPlayerId={card.tcgPlayerId}
        edition={edition}
        population={(card as { population?: Parameters<typeof GradedPopulation>[0]['population'] }).population}
      />
      <AdSlot 형태="네모" 이름="카드상세" />
    </div>
  );
}
