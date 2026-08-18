import { useEffect, useState } from 'react';
import { CARD_BACK, cardImg, thumb } from '../lib/cardImg';

/**
 * 카드 그림. 못 불러오면 뒷면으로 바꾼다.
 *
 * ⚠️ onError 안에서 img.src를 직접 바꾸면 안 된다. 리액트가 다음에 다시 그릴 때
 *    props의 src로 되돌려 놓아서, 깨진 그림이 그대로 남는다(2026-08-04에 실제로
 *    그랬다 — 코드는 들어갔는데 화면은 안 바뀌었다). 상태로 들고 있어야 한다.
 *
 * ⚠️ 폭은 CardTile과 같은 320을 기본으로 둔다. 여기 나오는 카드는 대부분 방금
 *    검색 결과 타일에서 본 그 카드라, 주소가 같아야 브라우저가 받아 둔 걸 그대로
 *    쓴다(한 장도 더 안 받는다). 폭을 줄여 아끼려 들면 오히려 같은 카드를 두 번
 *    받게 된다. 예전엔 프록시를 아예 안 타서 카드를 누를 때마다 원본 94KB를
 *    새로 받고 있었다(2026-08-05 확인 · 프록시로는 51KB).
 */
export function CardImg({
  src,
  alt,
  className,
  lazy = true,
  w = 320,
  일반판그림,
}: {
  src: string;
  alt: string;
  className?: string;
  lazy?: boolean;
  w?: number;
  /**
   * **이 그림은 그 카드 것이 아니라 같은 번호의 일반판 것**일 때 켠다.
   * ⚠️ 저쪽 CDN에 무늬 변종 그림이 없어(403) 카드 뒷면이 나오던 자리를 메운 것이라,
   *    **반드시 밝혀야 한다** — 마스터볼 미러는 그림 자체가 값어치라 말없이 일반판을
   *    보여 주면 사는 사람이 헷갈린다(사장님 지시 2026-08-16).
   */
  일반판그림?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // 다른 카드로 바뀌면 다시 시도한다(앞 카드가 실패했다고 계속 뒷면일 이유가 없다).
  useEffect(() => setFailed(false), [src]);

  // ⚠️ 표시가 없을 때는 **감싸지 않고 <img>를 그대로** 돌려준다. 쓰는 쪽이 넘긴
  //    className으로 크기를 잡고 있어서, 늘 감싸면 지금 화면들의 배치가 어긋난다.
  if (일반판그림 && !failed) {
    return (
      <span className="relative block h-full w-full">
        {안쪽()}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-center text-[9px] font-bold leading-tight text-white">
          일반판 그림
        </span>
      </span>
    );
  }
  return 안쪽();

  function 안쪽() {
  return (
    <img
      // ⚠️⚠️ **`cardImg`를 꼭 거친다.** TCGdex 주소는 확장자가 없는 **베이스**라
      //    (`…/ja/SV/SV2a/152`) 그대로 프록시에 넣으면 그림이 아니라 302가 온다 —
      //    화면에는 카드 뒷면만 뜬다. `cardImg`가 `/high.webp`를 붙여 준다.
      //    2026-08-13에 도감 전수 점검에서 잡았다: **62개 세트 3,783장**이 이렇게
      //    뒷면으로 나가고 있었다(ja-SV2a·ja-SV8a·en-gym2·en-A1… 시세 화면 포함).
      //    ⚠️ 이미 완성된 주소(.png/.jpg/.webp)는 `cardImg`가 그대로 돌려주므로,
      //       여기서 한 번 더 걸어도 다른 소스는 안 다친다(스니커덩크·limitless 등).
      src={failed ? CARD_BACK : thumb(cardImg(src), w) || src}
      alt={alt}
      className={className}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
  }
}
