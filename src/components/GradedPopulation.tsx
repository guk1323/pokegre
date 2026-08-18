import { useEffect, useRef } from 'react';
import { trackEvent } from '../api/localStats';

// 감정 수량. "이 카드가 전 세계에 감정된 게 몇 장인가"를 보여준다.
//
// 왜 넣었나: 옛 카드는 **감정 안 된 값이 아무 뜻이 없다**. 미감정 2천원짜리가 PSA 10에선
// 14만원에 팔린다(2003 나무돌이 004/019, 2026-04-03 이베이 낙찰). 표본 1,836장을 재 보니
// "미감정 5달러 이하인데 PSA 10은 50달러 이상"이 128장(7%)이었다. 시세만 보여 주면
// 이런 카드를 싸구려로 오해하게 된다.
//
// 감정 수량은 그 이유를 값이 아니라 **희소성**으로 설명해 준다 — 나무돌이 005는 전
// 세계에 감정된 게 7장뿐이고 그중 PSA 10은 2장이다. 그래서 낙찰 기록이 하나도 없는
// 카드에도 붙일 수 있다(이게 이베이 시세로는 못 메우던 구멍이다).
//
// ⚠️ 크레딧을 쓰지 않는다. 하루 한 번 통째로 받아 둔 것을 그대로 읽는다.

interface Population {
  psa10?: number;
  psa9?: number;
  psaAll?: number;
  all: number;
  gem?: number;
}

// 감정된 게 이보다 적으면 "아주 적다"고 알린다. 이 아래에선 미감정 시세를 그대로
// 믿으면 안 된다 — 감정품이 몇 장 없으니 값이 훨씬 높게 잡히는 일이 잦다.
const 적음 = 50;

// ⚠️ 판(edition)을 꼭 넘겨야 한다. 저쪽은 판을 안 주면 **영문판으로 찾아서**
//    일본판 카드가 전부 "감정 기록 없음"이 된다(2026-08-07에 이걸로 빈손이 났다).
export function GradedPopulation({
  tcgPlayerId,
  edition,
  population,
}: {
  tcgPlayerId: string;
  edition?: string;
  /**
   * **이미 받아 둔 감정 수량.**
   *
   * ⚠️⚠️ 예전에는 이걸 안 주면 스스로 `/api/local/card-extra`를 부르러 갔다. 그 자리가
   *    **옛 시세 길**이라 2026-08-13에 길과 함께 사라져서, 그 갈래도 지웠다. 지금은
   *    카드를 열 때 추이·낱개와 **한 번에** 받아 온 것을 여기로 넘긴다 —
   *    안 넘기면 감정 수량이 그냥 안 보인다(예전처럼 부르러 가지 않는다).
   */
  population?: Population | null;
}) {
  const p = population;
  // ⚠️ 넘겨받아 보여 줄 때도 **본 횟수는 센다.** 안 세면 통계에서 새 길 몫이 통째로 빠져
  //    「감정 수량을 아무도 안 본다」로 읽힌다(사장님이 새 기능은 통계에 넣으라고 하셨다).
  const 셌나 = useRef(false);
  useEffect(() => {
    if (!p || !(p.all > 0) || 셌나.current) return;
    셌나.current = true;
    trackEvent('population');
  }, [p]);
  useEffect(() => {
    셌나.current = false;
  }, [tcgPlayerId]);
  if (!p || !(p.all > 0)) return null;

  // 여기 요약은 PSA 10·9·전체 셋뿐이다. 전체가 4,000장인데 10등급 2,000·9등급 1,000이면
  // **나머지 1,000장이 어디 갔는지 알 수 없다**(사장님 지적 2026-08-07). 그래서 눌러서
  // 전 등급표로 갈 수 있게 한다. 등급표는 볼 때 받아 오므로 여기서는 크레딧이 안 든다.
  const 자세히 = `/population?id=${encodeURIComponent(tcgPlayerId)}${edition ? `&lang=${edition}` : ''}`;

  // ⚠️ **한 줄로 작게 둔다**(사장님 지시 2026-08-12: "감정 수량은 저렇게 크게 표시하지말고
  //    그냥 작게만 해주고 링크 연결해서 팝수쪽으로 가서 구체적으로 보게 해줘").
  //    예전엔 네 줄짜리 상자였다 — 큰 글씨 숫자 셋 + 설명 두 줄. 이 화면의 주인공은
  //    시세인데 감정 수량이 그만큼 자리를 먹으면 시세가 뒤로 밀린다.
  //    자세한 것(전 등급·기관별)은 **팝수 화면이 원래 그 일을 한다** — 거기로 보낸다.
  // ⚠️ 감정된 게 아주 적을 때는 그 한마디만 남긴다. 「PSA 10이 2장」인 카드의 감정품
  //    시세를 미감정 시세와 같은 것으로 보면 크게 어긋나서, 그건 짚어 줘야 한다.
  // ⚠️⚠️ **작게 두되 자기 자리는 줘야 한다.** 한 줄 11px 회색으로만 만들었더니 위의 그래프
  //    눈금·아래의 안내문과 글씨가 똑같아 **통째로 묻혔다**(사장님 지적 2026-08-13:
  //    "감정수량이 어딨는지 보이지도 않아. 저렇게 글 많은데 쑤셔넣으면 어떻게 알아").
  //    옅은 바탕 한 칸으로 감싸면 글씨를 안 키우고도 눈에 걸린다 — 예전 네 줄짜리 상자
  //    (약 100px)와 지금(약 34px)의 가운데다.
  return (
    <a
      href={자세히}
      className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 hover:bg-neutral-100"
    >
      <span className="min-w-0 truncate text-[11px] text-neutral-500">
        감정 수량 <span className="text-xs font-bold text-black">{p.all.toLocaleString()}장</span>
        {p.psa10 != null && <span> · PSA 10 {p.psa10.toLocaleString()}장</span>}
        {p.all < 적음 && <span className="text-amber-600"> · 감정된 게 적어 시세가 크게 다를 수 있습니다</span>}
      </span>
      <span className="flex-shrink-0 text-[11px] font-semibold text-neutral-600">자세히 →</span>
    </a>
  );
}
