import { useEffect, useState } from 'react';
import { CARD_BACK } from '../lib/cardImg';

/**
 * 카드 그림. 못 불러오면 뒷면으로 바꾼다.
 *
 * ⚠️ onError 안에서 img.src를 직접 바꾸면 안 된다. 리액트가 다음에 다시 그릴 때
 *    props의 src로 되돌려 놓아서, 깨진 그림이 그대로 남는다(2026-08-04에 실제로
 *    그랬다 — 코드는 들어갔는데 화면은 안 바뀌었다). 상태로 들고 있어야 한다.
 */
export function CardImg({
  src,
  alt,
  className,
  lazy = true,
}: {
  src: string;
  alt: string;
  className?: string;
  lazy?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // 다른 카드로 바뀌면 다시 시도한다(앞 카드가 실패했다고 계속 뒷면일 이유가 없다).
  useEffect(() => setFailed(false), [src]);
  return (
    <img
      src={failed ? CARD_BACK : src}
      alt={alt}
      className={className}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
