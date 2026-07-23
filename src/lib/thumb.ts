// 우리(도쿄) 서버의 이미지 프록시로 축소본을 받는다. 서버가 처음 한 번만 축소 CDN을
// 부르고 그 뒤론 캐시에서 도쿄 속도로 쏴줘, 유럽 CDN을 매번 직접 부르던 지연(장당 0.4초)이
// 사라진다. 원본은 장당 수십 KB라 목록에 수십 장 깔리면 모바일에서 느린데, 이걸로 해결한다.
// w는 표시 폭의 약 2배(레티나 대비). 실패하면 화면 쪽 onError에서 원본으로 폴백한다.
export function thumb(url: string, w: number): string {
  if (!url) return url;
  return `/api/img?u=${encodeURIComponent(url)}&w=${w}`;
}

// <img>의 onError에서 쓰는 원본 폴백. 이미 원본이면 이미지를 숨긴다.
export function fallbackToOriginal(e: React.SyntheticEvent<HTMLImageElement>, original: string): void {
  const img = e.currentTarget;
  if (original && img.src !== original) img.src = original;
  else img.style.display = 'none';
}
