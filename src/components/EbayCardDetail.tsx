import { useState } from 'react';
import { AdSlot } from './AdSlot';
import { CardImg } from './CardImg';
// ⚠️ `ebaySoldUrl`은 더 안 쓴다 — 「이베이 낙찰내역」 링크를 뺐다(사장님 지시 2026-08-19).
//    낱개 줄이 저마다 그 매물로 바로 가므로 따로 둘 자리가 없다. 함수는 다른 곳이 쓴다.
import { formatGradeLabel, mainPrice, 등급확인안됨, type EbayCard } from '../api/ebayPrices';
import { 제목회사표기 } from '../lib/listingTitle';
import { 제목언어이름 } from '../lib/listingJudge';
import { Price, KrwRateNote, useKrw } from './KrwHint';
import { EbayPriceChart } from './EbayPriceChart';
import { CardNameReport } from './CardNameReport';
import { ShareButton } from './ShareButton';
import { GradedPopulation } from './GradedPopulation';


function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

// ⚠️⚠️ **이베이 매물 링크에는 `?nordt=true`(넘김 금지)를 붙인다**(2026-08-20 실측).
//    카탈로그 연동형 매물은 팔린 지 **사흘 만에도** `/p/` 비슷한 상품 페이지로 튕겨서
//    딴 판매자의 값이 보인다 — $310 낙찰을 눌렀는데 $160 판매글이 뜬 것을 사장님이
//    잡으셨다. 이 꼬리를 붙이면 같은 주소가 원래 낙찰 페이지(「판매됨 US $310.00」)에
//    그대로 멈춘다. 저쪽(PPT)이 주소에 이 꼬리를 붙여 보내는 까닭이 이것이었다.
//    ⚠️ 저장은 꼬리 없이 한다(주소가 겹침 열쇠라서) — 붙이는 것은 그릴 때뿐이다.
const 이베이링크 = (u?: string): string | undefined =>
  u && /ebay\.[a-z.]+\/itm\//i.test(u) ? `${u.split('?')[0]}?nordt=true` : u;

// ⚠️ `검수`는 운영자 검수 화면(EbayCheckView)용이다 — **뺀 낙찰까지 전부** 취소선+까닭으로
//    보여준다. 사장님이 "왜 뺐는지"를 낱낱이 보고 판정하는 자리라 숨기면 검수가 안 된다.
//    실제 사용자 화면은 이 표시 없이 그대로(뺀 것 숨김)다.
export function EbayCardDetail({ card, edition, 검수 = false }: { card: EbayCard; edition?: string; 검수?: boolean }) {
  // 중앙값도 원화로 적는다(가격 표시를 원화로 통일).
  const krw = useKrw();
  // ⚠️⚠️ **세트 화면과 같은 방식이다** — 등급 줄을 누르면 그 아래로 낱개가 펴지고,
  //    다시 누르면 접힌다. **정렬도 화살표도 없다**(사장님 지시 2026-08-19:
  //    「큼지막한 것만 두고, 누르면 아래로 개별 낙찰 5개」). 새 방식을 만들지 않는다.
  const [펼침, set펼침] = useState<Record<string, boolean>>({});
  // ⚠️⚠️ **카드가 바뀌면 펼친 것을 접는다**(사장님 지시 2026-09-02).
  //    이 부품은 카드를 바꿔 눌러도 같은 자리에 그대로 남아서, 앞 카드에서 PSA 10을
  //    펴 두면 **다음 카드도 PSA 10이 펴진 채로** 열렸다. 카드마다 값이 있는 등급이
  //    달라서, 새 카드를 열면 다 접힌 채로 시작하는 편이 읽기 쉽다.
  //    ⚠️ 부르는 쪽에 `key`를 붙이는 방법도 있으나 자리가 둘이라(카드 화면·검수 화면)
  //       한쪽을 빠뜨리기 쉽다. 부품 안에서 스스로 접게 두는 편이 안전하다.
  const [이전카드, set이전카드] = useState(card.tcgPlayerId);
  if (이전카드 !== card.tcgPlayerId) {
    set이전카드(card.tcgPlayerId);
    set펼침({});
  }
  // ⚠️ 사용자 화면에서는 「등급 확인 안 됨」 줄을 아예 안 낸다(사장님 결정 2026-08-20) —
  //    값도 안 내는 칸이라, 낱개 링크가 죽고 나면 방문자에게 남는 쓸모가 없다.
  //    검수 화면에는 그대로 낸다(분류가 안 끝난 것이 몇 건인지는 우리가 봐야 한다).
  const 보일등급 = 검수 ? card.grades : card.grades.filter((g) => g.grade !== 'ungraded');
  // 「기타 언어」 곁 카드는 여러 언어가 한데 담긴다 — 낱개 줄마다 무슨 언어인지 붙인다.
  // ⚠️ 열쇠 꼴이 둘이다: 검수 저장소는 `-lang`, 실서비스(도감 갈래)는 `~lang`. 둘 다 받는다.
  const 기타언어카드 = /[-~]lang$/.test(String(card.tcgPlayerId ?? ''));
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
        {card.imageUrl ? (
          <CardImg src={card.imageUrl} alt={card.name} className="h-full w-full object-contain" lazy={false} 일반판그림={card.imgBase} />
        ) : (
          // ⚠️ 갈라 담은 카드에는 사진을 안 붙인다(저쪽 사진은 묶인 칸 하나의 것이라
          //    그대로 쓰면 갈라 놓은 카드가 전부 같은 사진이 된다). 왜 없는지 밝힌다.
          <p className="flex h-full items-center justify-center px-4 text-center text-xs leading-snug text-neutral-400">
            이 카드의 사진은 아직 없습니다.
            <br />
            같은 이름으로 묶여 있던 카드를 번호로 나눈 것이라, 사진을 붙이면 다른 카드 것이 됩니다.
          </p>
        )}
      </div>

      <div className="mb-1 flex items-start justify-between gap-2">
        <h2 className="text-base font-bold text-black">{card.name}</h2>
        {/* ⚠️ **대표 주소(/card/)를 준다.** 주소창도 이 꼴로 바뀌므로(App.tsx), 단추가
            옛 주소를 주면 같은 카드가 두 주소로 퍼진다. 옛 링크는 그대로 살아 있다. */}
        {/* ⚠️ `?m=e` — 받는 사람도 **이베이 탭**으로 열리게 한다(사장님 지시 2026-09-02).
            대표 주소는 `?m` 없는 `/card/<번호>`라 검색에는 한 쪽으로만 잡힌다. */}
        <ShareButton path={`/card/${card.tcgPlayerId}?m=e`} name={card.name} />
      </div>
      <p className="text-xs text-neutral-400 mb-1">
        {card.setName}
        {/* ⚠️ **카드에 찍힌 번호가 있으면 그걸 보여 준다.** 옛 일본 세트는 우리 번호(정렬
            순번)와 실물이 다르다 — 파이리가 우리는 012인데 카드엔 No.004다. 손에 든 카드와
            화면이 달라 보이면 안 된다(사장님 지시 2026-08-17). */}
        {card.printNo ? ` · No.${card.printNo}` : card.cardNumber ? ` · ${card.cardNumber}` : ''} · 낙찰 {card.totalSales.toLocaleString()}건
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
      {/* ⚠️ **빼기만 하지 않고 제자리로 옮겨 온 것도 밝힌다**(사장님 지시 2026-08-09:
          "옮겨 쌓는거 해줘"). 저쪽이 다른 카드 칸에 담아 둔 낙찰 중 **제목으로 이 카드임이
          또렷한 것**만 옮겨 온다. 말없이 섞으면 그것도 속이는 것이라 건수를 적고,
          아래 낱개 목록에도 한 건씩 "옮겨 옴" 표를 붙인다. */}
      {card.movedIn ? (
        <p className="mb-1 text-[11px] text-emerald-600">
          다른 카드에 잘못 담겨 있던 {card.movedIn.toLocaleString()}건을 이 카드로 옮겨 왔습니다.
        </p>
      ) : null}
      <CardNameReport
        title={card.name}
        raw={card.nameEn}
        link={`https://www.tcgplayer.com/product/${card.tcgPlayerId}`}
        className="mb-1"
      />

      {/* 낙찰 기록이 충분한 등급이 있으면 추이 그래프를 먼저 보여준다. 없으면 스스로
          아무것도 안 그린다. */}
      {/* ⚠️ 제목에 「그날그날 낙찰 평균」을 붙였다가 뺐다(사장님 2026-08-12: "굳이 그런거라면
          안 써도 될거같아"). 점 하나가 그날 팔린 값들의 평균이라 위 큰 숫자(최근 30일 기준)와
          끝점이 다른데, 실측해 보니 그 차이(중앙 9.2%)가 **그래프가 하루 사이에 저절로 튀는
          폭(중앙 12.1%)보다 작다** — 굳이 짚어 줄 만큼 어긋나는 게 아니다. */}
      <EbayPriceChart grades={보일등급} />

      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold text-neutral-500">등급별 이베이 시세</p>
        </div>
        {/* ⚠️ **가릴 수 없는 낙찰만 모인 칸이면 먼저 밝힌다.** 저쪽이 이름만으로 묶어 둔 것을
            번호·세트로 갈랐는데 제목에 단서가 없어 어디에도 못 넣은 것들이다. 수십 년에 걸친
            다른 카드가 섞여 있어 대표 시세가 뜻이 없다. 기록은 그대로 보여 주되 값은 믿지
            말라고 말한다 — 숨기지도, 아는 척하지도 않는다. */}
        {card.가릴수없음 && (
          <p className="mb-2 mt-0.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            아래 낙찰은 <b>어느 카드인지 가릴 수 없는 것들</b>입니다. 매물 제목에 번호도 세트도
            적혀 있지 않아, 서로 다른 카드가 섞여 있습니다. <b>값은 믿지 마시고</b> 아래 제목을
            직접 보고 판단해 주세요.
          </p>
        )}
        {/* ⚠️⚠️ **설명 줄을 통째로 뺐다**(2026-08-13). 예전엔 카드마다 「신뢰도 낮음은 거래가
            적어…」 두 줄이 늘 깔렸는데, 감정 수량 줄이 그 사이에 묻혀 안 보였다(사장님 지적:
            "저렇게 글 많은데 쑤셔넣으면 어떻게 알아").
            「낮음이 있을 때만」으로 바꿔 볼까 했으나 재 보니 **대표 등급이 낮음인 카드가 66%**라
            조건을 걸어도 결국 늘 뜬다(낙찰 1~4건인 등급칸의 97%가 낮음이다).
            → 설명 대신 **줄에 붙는 말 자체를 뜻이 통하게** 바꿨다(「신뢰도 낮음」 → 「거래 적음」).
              그러면 따로 풀어 줄 말이 없다. */}
        {/* 메인 값은 PPT의 "현재 적정가"(최근 30일 가중)로, 옛 거래에 안 눌린 지금 시세다.
            없는 등급은 중앙값으로 대체한다. 아래 작은 줄에 중앙값을 참고로 곁들이고, 신뢰도가
            낮으면(거래가 적으면) 눈에 띄게 알린다. 행을 누르면 이베이의 그 등급 "낙찰 완료"
            목록으로 가, PPT엔 없는 개별 낙찰 건(날짜·가격·상품 링크)을 직접 볼 수 있다. */}
        {/* ⚠️ 비면 테두리만 있는 빈 네모가 떴다. 카드는 찾았는데 아무도 안 판 것이라
            "값이 없다"가 아니라 "거래 내역이 없다"가 맞다(2026-08-07 지적). */}
        {보일등급.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 py-4 text-center text-xs text-neutral-400">
            거래 내역이 없습니다.
          </p>
        ) : (
        // ⚠️ 머리글과 표가 붙어 답답했다 — `mt-2`로 사이를 조금 벌린다(사장님 지시 2026-08-19).
        <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {보일등급.map((g) => {
            // ⚠️ **`lastSaleDate`는 우리가 다시 센 칸에서 비어 있다**(저쪽 덤프에만 있는 값이다).
            //    그러면 「마지막 언제 팔렸나」가 화면에서 통째로 사라진다 — 대표값이 얼마나
            //    싱싱한지 가릴 단서가 없어진다. 낱개의 제일 최근 날짜로 메운다(같은 뜻이다).
            const sold = shortDate(g.lastSaleDate) || shortDate(g.sales?.find((x) => !x.뺀까닭)?.date ?? null);
            const { price, isSmart } = mainPrice(g);
            // ⚠️⚠️ **이 칸은 값을 안 보여 준다.** 저쪽이 등급을 못 알아본 낙찰 모음이라
            //    평균도 중앙값도 「생카드 값」이 아니다(자세한 근거는 `등급확인안됨` 주석).
            //    낱개는 그대로 둔다 — 「그 값에 팔렸다」는 사실은 참이다.
            const 값숨김 = 등급확인안됨(g.grade);
            // ⚠️⚠️ **대표값은 「최근 5건의 한가운데」다**(2026-08-29에 바꿈 · 신고 접수).
            //    `기준건수`는 실제로 몇 건으로 셌는지, `기준일수`는 그 건들이 걸친 날수다.
            //    둘 다 서버가 다시 센 칸에만 온다 — 없으면 옛 꼴 그대로 둔다.
            const 기준건수 = g.기준건수;
            // ⚠️ **딱지 둘의 잣대를 실측으로 바꿨다.** 예전엔 저쪽(PPT)이 준 `confidence`로
            //    「거래 적음」을 붙였는데, 값을 우리가 다시 세면 그 신호는 우리 값과 무관하다.
            //    · 거래 적음  = 한가운데를 셀 다섯이 안 됨
            //    · 오래된 거래 = 그 다섯이 6개월 넘게 걸쳐 있음. 실측에서 **여기서만**
            //      최근 5건이 옛 방식보다 못했다(270칸 · 33.3% vs 32.1%).
            const 거래적음 = 기준건수 != null ? 기준건수 < 5 : g.confidence === 'low';
            const 오래된거래 = (g.기준일수 ?? 0) > 180;
            return (
              <li key={g.grade}>
                {/* ⚠️ 줄 전체가 「펴기」 단추다. 이베이로 가는 길은 오른쪽 작은 ↗로 옮겼다 —
                    줄을 누르면 밖으로 나가 버리면 낱개를 볼 수가 없다. */}
                <button
                  type="button"
                  onClick={() => set펼침((p) => ({ ...p, [g.grade]: !p[g.grade] }))}
                  aria-expanded={!!펼침[g.grade]}
                  className="flex w-full min-h-11 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                >
                  {/* ⚠️⚠️ **값이 주인공이다**(사장님이 고른 안 · 2026-08-19). 등급 이름과 건수는
                      한 단계 작게, 값은 크게. 예전엔 셋이 다 같은 크기라 **무엇이 중요한지**가
                      안 보였다 — 「뭉툭하고 안 이쁘다」고 하신 게 그 뜻이다. */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-tight text-neutral-700">{formatGradeLabel(g.grade)}</p>
                    <p className="text-[11px] leading-tight text-neutral-500">
                      {/* ⚠️ **「낮음」일 때만 붙인다.** 「높음·보통」은 굳이 알릴 것이 아니고,
                          붙이면 그것도 글이 된다. 말도 「신뢰도 낮음」이 아니라 **뜻 그대로**
                          적는다 — 처음 온 사람도 따로 설명 없이 읽힌다. */}
                      {!값숨김 && 거래적음 && <span className="text-amber-600">거래 적음 · </span>}
                      {!값숨김 && 오래된거래 && <span className="text-amber-600">오래된 거래 · </span>}
                      {/* ⚠️⚠️ **무엇으로 매긴 값인지 여기서 밝힌다**(2026-08-29). 예전엔
                          「647건」이라 적혀 있어 **647건으로 매긴 값**처럼 읽혔는데, 실제로는
                          펼치면 최근 5건이 전부 딴 값이라 화면이 스스로 모순됐다.
                          ⚠️ 총 건수는 안 잃는다 — 펼친 칸이 「낙찰 647건 중 최근 5건」이라고
                             그대로 말한다. 줄도 안 늘고 정보도 안 준다.
                          ⚠️ 옛 응답(굽기 전)에는 `기준건수`가 없다 — 그때는 예전처럼 건수를 적는다. */}
                      {/* ⚠️ 낙찰이 다섯이 안 되면 **있는 것을 전부** 쓴 것이라 「최근」이 뜻이 없다.
                          「최근 1건 기준」이 아니라 「낙찰 1건 기준」이라야 말이 맞는다. */}
                      {기준건수
                        ? 기준건수 < g.count
                          ? `최근 ${기준건수}건 기준`
                          : `낙찰 ${기준건수}건 기준`
                        : `${g.count.toLocaleString()}건`}
                      {sold ? ` · 마지막 ${sold}` : ''}
                    </p>
                  </div>
                  {값숨김 ? (
                    <p className="flex-shrink-0 text-right text-[11px] leading-tight text-neutral-400">
                      값 없음
                    </p>
                  ) : (
                    <div className="flex-shrink-0 text-right">
                      <Price amount={price} currency="usd" className="text-[17px] font-bold tracking-tight text-black leading-tight" />
                      {isSmart && (
                        <p className="text-[11px] leading-tight text-neutral-500">중앙값 {krw(g.medianPrice, 'usd')}</p>
                      )}
                    </div>
                  )}
                  {/* 펴짐/접힘 표시. 낱개가 있을 때만 뜻이 있다.
                      ⚠️ 값과 딱 붙지 않게 왼쪽 여백을 둔다(사장님 지시 2026-08-19:
                         「값은 오른쪽 끝 가까이, 화살표랑 너무 가깝지는 않게」). */}
                  {g.sales && g.sales.some((x) => 검수 || !x.뺀까닭) && (
                    <span className="ml-1 flex-shrink-0 text-[11px] text-neutral-600">{펼침[g.grade] ? '▲' : '▼'}</span>
                  )}
                </button>
                {/* 실제 낙찰 낱개. "28건"이라는 숫자보다 "1월 18일에 $160에 팔렸다"가
                    훨씬 와닿는다. 이 값은 예전부터 응답에 들어 있었는데 안 쓰고 있었다
                    (2026-08-07 발견). 누르면 그 매물로 바로 간다. */}
                {/* ⚠️⚠️ **셈에서 뺀 낙찰은 아예 안 보여 준다**(사장님 지시 2026-08-19).
                    예전엔 회색 취소선으로 남겨 뒀는데, 「왜 이게 여기 있지」만 남고
                    도움이 안 됐다. **자료는 안 지운다** — 왜 뺐는지는
                    `/data/card-history/<번호>.json`에 그대로 남아 있다. */}
                {/* ⚠️⚠️ **접힌 채로 시작한다.** 평소엔 등급 줄만 큼지막하게 보이고,
                    누른 줄만 그 아래로 낱개가 편다(세트 화면과 같은 방식). */}
                {펼침[g.grade] && g.sales && g.sales.some((s) => 검수 || !s.뺀까닭) && (() => {
                  // 검수 화면에서는 뺀 것까지 전부 — 그게 검사할 대상이다.
                  // ⚠️ 사용자 화면은 **최신 5건만**(사장님 정책) — 중앙값은 전체로 셈하고,
                  //    낱개는 최근 것만 보인다. 줄은 서버가 이미 최신순으로 준다.
                  const 보일것 = 검수 ? g.sales : g.sales.filter((s) => !s.뺀까닭).slice(0, 5);
                  return (
                  <div className="border-t border-neutral-50 bg-neutral-50/60 px-3 pb-1.5">
                    {/* ⚠️ **「5건뿐」임을 밝힌다.** 21건 중 5건을 보는 것인데 그게 전부인 줄
                        알면 안 된다. ⚠️ `neutral-500`이면 밝은 화면 대비가 4.54로 기준에
                        붙어서 한 단계 진하게 뒀다(실측 2026-08-19). */}
                    <p className="py-1 text-[10px] text-neutral-600">
                      {검수
                        ? `받은 ${보일것.length}건 전부 · 셈에 든 것 ${g.count.toLocaleString()}건`
                        : `낙찰 ${g.count.toLocaleString()}건 중 최근 ${보일것.length}건`}
                    </p>
                    {/* ⚠️⚠️ 이베이는 팔린 매물 쪽을 (90일 전에도) 지우고, 죽은 링크는 「비슷한
                        상품」 카탈로그(/p/…)로 넘긴다 — 그 화면의 사진·값은 남의 것이다.
                        사장님이 이 착시로 세 번 헛짚으셨다(2026-08-19~20). 검수 중 사진 검증은
                        주소가 /itm/으로 남아 있는 페이지에서만 유효하다는 상시 안내. */}
                    {검수 && (
                      <p className="pb-1 text-[10px] leading-snug text-neutral-400">
                        눌렀을 때 주소가 <span className="font-semibold">/p/</span>로 바뀌면 이베이가 지운 매물입니다 —
                        그 화면의 사진·값은 딴 매물 것이니 믿지 마세요. <span className="font-semibold">/itm/</span> 그대로인
                        페이지만 사진 검증이 됩니다.
                      </p>
                    )}
                  <ul>
                    {보일것.map((s) => {
                      // ⚠️⚠️ 사용자 화면은 **88일 지난 줄의 링크를 뗀다**(사장님 결정 2026-08-20).
                      //    처음엔 2주였는데, `?nordt=true`(이베이링크 참고)를 붙이니 나이별 40건
                      //    실측에서 **88일까지 32/32 전부 살고**(85일짜리를 실제 항해로도 확인),
                      //    90일 넘으면 404로 깨끗이 죽었다(속이는 카탈로그행 0건) — 그래서 이베이
                      //    보관 한도(약 90일) 바로 안쪽까지 늘렸다. 지난 줄은 글자만 남는다.
                      //    검수 화면은 그대로 다 건다 — 죽은 링크도 검사 대상이다.
                      const 링크됨 = !!s.url && (검수 || Date.now() - Date.parse(s.date) <= 88 * 86400000);
                      const 회사표기 = g.grade === '기타' ? 제목회사표기(s.title ?? '') : '';
                      const 언어표기 = 기타언어카드 ? 제목언어이름(s.title ?? '') : '';
                      return (
                      <li key={s.url || `${s.date}-${s.price}`}>
                        <a
                          href={링크됨 ? 이베이링크(s.url) : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`block py-1 text-[11px] ${링크됨 ? 'hover:bg-neutral-100/70' : ''}`}
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-neutral-500">
                              {s.date.slice(2).replace(/-/g, '.')}
                              <span className="ml-1 text-neutral-400">{s.auction ? '경매' : '즉시구매'}</span>
                              {/* ⚠️ 이베이는 팔린 매물 쪽을 90일쯤 뒤에 지우고, 죽은 링크는
                                  「비슷한 상품」으로 넘어가 **딴 판매자의 딴 카드**가 보인다.
                                  사장님이 두 번이나 이 함정에 빠졌다(값이 다르다 · PSA 9가
                                  보인다 — 2026-08-19·20). 넘어간 화면을 믿지 말라는 표시다. */}
                              {검수 && Date.now() - Date.parse(s.date) > 88 * 86400000 && (
                                <span className="ml-1 rounded bg-neutral-100 px-1 py-px text-[9px] text-neutral-400">
                                  링크 만료
                                </span>
                              )}
                              {/* 「기타 감정 회사」 칸은 회사·등급이 섞인다 — 줄마다 어느
                                  회사의 몇 점인지 밝힌다(사장님 지시 2026-08-20). */}
                              {회사표기 && (
                                <span className="ml-1 rounded bg-neutral-100 px-1 py-px text-[9px] text-neutral-500">
                                  {회사표기}
                                </span>
                              )}
                              {/* 「기타 언어」 곁 카드는 여러 언어가 한데 담긴다 — 줄마다
                                  무슨 언어판인지 밝힌다(사장님 지시 2026-08-20). */}
                              {언어표기 && (
                                <span className="ml-1 rounded bg-neutral-100 px-1 py-px text-[9px] text-neutral-500">
                                  {언어표기}
                                </span>
                              )}
                            </span>
                            <span className="flex-shrink-0 font-semibold text-neutral-700">
                              {/* ⚠️ 셈에 안 들어간 기록은 흐리게 하고 까닭을 붙인다. 표시가 없으면
                                  "$3이 보이는데 중앙값은 $318"이라 사람이 우리를 못 믿는다. */}
                              {s.뺀까닭 && (
                                <span className="mr-1 rounded bg-neutral-200 px-1 py-px text-[9px] font-normal text-neutral-500">
                                  셈 제외 · {s.뺀까닭}
                                </span>
                              )}
                              {/* 깎아 판(Best Offer) 낙찰. 셈에는 들어가되 표시만 한다 —
                                  적힌 값은 부른 값이고 실제론 그보다 싸게 팔렸을 수 있다
                                  (사장님 결정 2026-08-19: 「어차피 큰 차이 안 날 것 같으니
                                  작게만 써 주고 가격은 그대로」). */}
                              {s.베스트오퍼 && (
                                <span className="mr-1 rounded bg-neutral-100 px-1 py-px text-[9px] font-normal text-neutral-500">
                                  베스트 오퍼
                                </span>
                              )}
                              {/* 검수 화면에서만: 이 줄을 이베이에서 직접 읽었는지(러너), 저쪽 자료인지. */}
                              {검수 && s.출처 === '러너' && (
                                <span className="mr-1 rounded bg-sky-100 px-1 py-px text-[9px] font-normal text-sky-700">
                                  러너
                                </span>
                              )}
                              {/* 같은 매물을 저쪽도 갖고 있었는데 값이 달라 러너 값으로 고친 것.
                                  저쪽이 적었던 값을 같이 밝힌다(사장님 지시 2026-08-19). */}
                              {검수 && s.고친값 != null && (
                                <span className="mr-1 rounded bg-amber-100 px-1 py-px text-[9px] font-normal text-amber-700">
                                  가격 고침 · 전 {krw(s.고친값, 'usd')}
                                </span>
                              )}
                              {/* 다른 카드 칸에서 제자리로 옮겨 온 기록. 어디서 왔는지까지 밝힌다. */}
                              {!s.뺀까닭 && s.옮겨온곳 && (
                                <span className="mr-1 rounded bg-emerald-100 px-1 py-px text-[9px] font-normal text-emerald-700">
                                  옮겨 옴 · {s.옮겨온곳}
                                </span>
                              )}
                              <span className={s.뺀까닭 ? 'text-neutral-400 line-through' : undefined}>
                                {krw(s.price, 'usd')}
                              </span>
                            </span>
                          </span>
                          {/* ⚠️ **매물 제목을 같이 보여준다.** 날짜와 값만 있으면 "이 낙찰이 정말
                              그 카드인가"를 확인하려고 매물을 하나씩 눌러 봐야 한다. 사장님이
                              실제로 그렇게 찾아내셨다(2026-08-08) — 사진은 다른 카드였다.
                              제목은 판매자가 쓴 원문 그대로 둔다. 그게 증거다. */}
                          {s.title && (
                            <span className="mt-0.5 block truncate text-[10px] leading-tight text-neutral-400">
                              {s.title}
                            </span>
                          )}
                        </a>
                        {/* ⚠️ 검수 화면에서만: 낱개마다 사장님이 한 줄 적는 메모칸(지시 2026-08-19).
                            링크(<a>) 밖에 둔다 — 안에 넣으면 칸을 누를 때 매물이 열린다.
                            엔터나 칸을 벗어나면 저장되고, 지우고 벗어나면 메모가 삭제된다. */}
                        {검수 && (
                          <input
                            type="text"
                            defaultValue={s.메모 ?? ''}
                            placeholder="메모"
                            maxLength={300}
                            className="mb-1 w-full rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] text-neutral-700 placeholder:text-neutral-300 focus:border-neutral-400 focus:outline-none"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                            onBlur={(e) => {
                              const 글 = e.target.value.trim();
                              if (글 === (s.메모 ?? '')) return;
                              const itm = s.itm ?? (s.url.match(/\/itm\/(\d+)/) ?? [])[1];
                              if (!itm) return;
                              fetch('/api/local/ebay-check', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ itm, 메모: 글, id: card.tcgPlayerId }),
                              }).catch(() => {});
                            }}
                          />
                        )}
                      </li>
                      );
                    })}
                  </ul>
                  {/* ⚠️⚠️ **이베이는 팔린 매물 쪽을 지운다**(사장님 지시 2026-08-29: 방문자에게도
                      알려 달라). 지워진 뒤 누르면 이베이가 「비슷한 상품」 카탈로그로 넘기는데,
                      그 화면의 **사진도 값도 딴 매물 것**이다. 사장님도 이 착시로 세 번 헛짚으셨다
                      (2026-08-19~20) — 값이 다르다·PSA 9가 보인다.
                      ⚠️ 우리는 88일 지난 줄의 링크를 이미 떼지만, 그 전에 지워지는 매물도 있다.
                         그래서 **가리는 법**을 짧게 알려 준다 — 주소만 보면 되기 때문이다.
                      ⚠️ 한 줄로 끝낸다. 자세한 안내는 검수 화면에 따로 있다(그건 운영자용이다). */}
                  {/* ⚠️⚠️ **뜻이 붙어 있어야 할 마디로 묶는다**(사장님 지적 2026-08-29).
                      이 칸은 237px뿐이라 그냥 두면 브라우저가 아무 데서나 끊는다 — 실측으로
                      「…이베이가 / 기록을 지워…」가 되어 **주어와 서술어가 갈라졌다.**
                      마디로 묶으면 갈리더라도 **마디와 마디 사이**에서만 갈린다.
                      ⚠️ 화면 문구를 손댈 때는 **폰과 좁은 칸에서 어디서 갈리는지 먼저 재라.**
                         넓은 화면에서는 한 줄로 나와 눈에 안 띈다. */}
                  {!검수 && 보일것.some((s) => !!s.url) && (
                    // ⚠️ **낱개 목록과 눈으로 갈라 놓는다**(사장님 지적 2026-08-29: 「너무 링크랑
                    //    구분이 없이 배열되어서 안내문처럼 안 보여」). 색도 크기도 낱개 제목과
                    //    같아서 **목록의 한 줄처럼** 읽혔다. 위에 실선을 긋고 사이를 띄운다 —
                    //    「여기서부터는 매물이 아니라 안내」라는 표시다.
                    <p className="mt-1.5 border-t border-neutral-200/70 pt-1.5 pb-1.5 text-[10px] leading-snug text-neutral-400">
                      <span className="inline-block">
                        링크 접속 시 주소가 <span className="font-semibold text-neutral-500">/itm/</span>이 아니라{' '}
                        <span className="font-semibold text-neutral-500">/p/</span>이면
                      </span>{' '}
                      <span className="inline-block">이베이가 기록을 지워 다른 매물로 연결됩니다.</span>
                    </p>
                  )}
                  </div>
                  );
                })()}
              </li>
            );
          })}
        </ul>
        )}
        {/* ⚠️ **설명 줄을 통째로 뺐다**(사장님 지시 2026-08-27: 「쓸데없는 문장은 좀 지우려고」).
            TCGplayer 쪽과 **같은 꼴 한 줄**로 맞춘다 — 두 탭이 같은 자리에 다른 길이의 글을
            내면 탭을 옮길 때마다 화면이 들썩인다.
            ⚠️ 뺀 것 중 「낱개를 눌러 매물에서 확인」 같은 **조작 안내는 되살리지 말 것.**
               누를 사람은 안 읽어도 누른다. 2026-08-13에도 같은 까닭으로 설명을 빼고
               **줄 이름 자체를 뜻이 통하게** 고쳤다(「신뢰도 낮음」 → 「거래 적음」).
               설명이 필요하면 글을 붙이지 말고 **이름을 고치는** 쪽이 맞다. */}
        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-400">등급별 판매완료 가격입니다.</p>
        <KrwRateNote />
      </div>

      {/* ⚠️⚠️ **감정 수량은 시세 아래로 내렸다**(사장님 지시 2026-08-19: 「시세 나오는 곳
          중간에 껴 가지고 짜증나네」). 예전엔 추이 그래프와 등급별 시세 **사이**에 있어
          시세를 읽다 말고 끊겼다. **시세는 시세끼리 모으고** 이건 그 뒤에 둔다.
          ⚠️ 낙찰 기록이 없는 카드에도 붙는다 — 감정된 게 몇 장인지는 거래와 무관하게 안다.
          ⚠️ `population`을 그대로 넘긴다. 새 시세 길은 카드를 열 때 추이·낱개와 **한 번에**
             받아 오므로 여기서 또 부를 이유가 없다. */}
      <GradedPopulation
        tcgPlayerId={card.tcgPlayerId}
        edition={edition}
        population={(card as { population?: Parameters<typeof GradedPopulation>[0]['population'] }).population}
      />
      <AdSlot 형태="네모" 이름="카드상세" />
    </div>
  );
}
