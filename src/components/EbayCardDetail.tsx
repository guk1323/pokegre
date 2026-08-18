import { useEffect, useState } from 'react';
import { CardImg } from './CardImg';
import { ebaySoldUrl, formatGradeLabel, mainPrice, 등급확인안됨, type EbayCard } from '../api/ebayPrices';
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
      className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-5"
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
        <ShareButton path={`/e/${card.tcgPlayerId}`} name={card.name} />
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
      {/* ⚠️ 제목에 「그날그날 낙찰 평균」을 붙였다가 뺐다(사장님 2026-08-12: "굳이 그런거라면
          안 써도 될거같아"). 점 하나가 그날 팔린 값들의 평균이라 위 큰 숫자(최근 30일 기준)와
          끝점이 다른데, 실측해 보니 그 차이(중앙 9.2%)가 **그래프가 하루 사이에 저절로 튀는
          폭(중앙 12.1%)보다 작다** — 굳이 짚어 줄 만큼 어긋나는 게 아니다. */}
      <EbayPriceChart grades={card.grades} />

      {/* 낙찰 기록이 없는 카드에도 붙는다 — 감정된 게 몇 장인지는 거래와 무관하게 안다. */}
      {/* ⚠️ `population`을 그대로 넘긴다. 새 시세 길은 카드를 열 때 추이·낱개와 **한 번에**
          받아 오므로 여기서 또 부를 이유가 없다. 옛 길 카드에는 그 칸이 아예 없어서
          undefined가 넘어가고, 그러면 예전처럼 스스로 받아 온다. */}
      <GradedPopulation
        tcgPlayerId={card.tcgPlayerId}
        edition={edition}
        population={(card as { population?: Parameters<typeof GradedPopulation>[0]['population'] }).population}
      />

      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold text-neutral-500">등급별 이베이 시세</p>
          <span className="text-[11px] text-neutral-400">누르면 이베이 낙찰내역 ↗</span>
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
        {card.grades.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 py-4 text-center text-xs text-neutral-400">
            거래 내역이 없습니다.
          </p>
        ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {card.grades.map((g) => {
            const sold = shortDate(g.lastSaleDate);
            const { price, isSmart } = mainPrice(g);
            // ⚠️⚠️ **이 칸은 값을 안 보여 준다.** 저쪽이 등급을 못 알아본 낙찰 모음이라
            //    평균도 중앙값도 「생카드 값」이 아니다(자세한 근거는 `등급확인안됨` 주석).
            //    낱개는 그대로 둔다 — 「그 값에 팔렸다」는 사실은 참이다.
            const 값숨김 = 등급확인안됨(g.grade);
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
                      {/* ⚠️ **「낮음」일 때만 붙인다.** 「높음·보통」은 굳이 알릴 것이 아니고,
                          붙이면 그것도 글이 된다. 말도 「신뢰도 낮음」이 아니라 **뜻 그대로**
                          적는다 — 처음 온 사람도 따로 설명 없이 읽힌다. */}
                      {!값숨김 && g.confidence === 'low' && <span className="text-amber-600">거래 적음 · </span>}
                      {g.count.toLocaleString()}건{sold ? ` · 마지막 ${sold}` : ''}
                    </p>
                  </div>
                  {값숨김 ? (
                    <p className="flex-shrink-0 text-right text-[11px] leading-tight text-neutral-400">
                      값 없음
                    </p>
                  ) : (
                    <div className="flex-shrink-0 text-right">
                      <Price amount={price} currency="usd" className="text-sm font-bold text-black leading-tight" />
                      {isSmart && (
                        <p className="text-[11px] text-neutral-400 leading-tight">중앙값 {krw(g.medianPrice, 'usd')}</p>
                      )}
                    </div>
                  )}
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
                          className="block py-1 text-[11px] hover:bg-neutral-100/70"
                        >
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-neutral-500">
                              {s.date.slice(2).replace(/-/g, '.')}
                              <span className="ml-1 text-neutral-400">{s.auction ? '경매' : '즉시구매'}</span>
                            </span>
                            <span className="flex-shrink-0 font-semibold text-neutral-700">
                              {/* ⚠️ 셈에 안 들어간 기록은 흐리게 하고 까닭을 붙인다. 표시가 없으면
                                  "$3이 보이는데 중앙값은 $318"이라 사람이 우리를 못 믿는다. */}
                              {s.뺀까닭 && (
                                <span className="mr-1 rounded bg-neutral-200 px-1 py-px text-[9px] font-normal text-neutral-500">
                                  셈 제외 · {s.뺀까닭}
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
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        )}
        {/* ⚠️⚠️ **「등급 확인 안 됨」 줄이 있을 때만** 한 줄 붙인다. 값이 비어 있는 까닭을
            안 적으면 「고장인가?」로 읽힌다. 늘 깔면 글이 많아 다른 줄이 묻히므로
            (2026-08-13에 설명 줄을 통째로 뺐던 까닭이 그것이다) 있을 때만 낸다. */}
        {card.grades.some((g) => 등급확인안됨(g.grade)) && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-400">
            「등급 확인 안 됨」은 매물 제목에 감정 등급이 안 적혀 있어 <strong>분류가 끝나지 않은 낙찰</strong>입니다.
            감정된 카드가 섞여 있어 값을 내지 않습니다. 낱개를 눌러 매물에서 직접 확인해 보실 수 있습니다.
          </p>
        )}
        <KrwRateNote />
      </div>
    </div>
  );
}
