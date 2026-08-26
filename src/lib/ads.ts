/**
 * 애드센스 설정 — **여기 한 곳**이 켜고 끄는 스위치다.
 *
 * ⚠️ 승인 전에는 전부 빈 값이라 광고 자리(AdSlot)가 화면에 **아무것도 안 그린다.**
 *    이 상태로 배포돼도 방문자 화면은 그대로다 — 그래서 자리만 미리 깔아 둘 수 있다.
 * ⚠️ 애드센스 승인이 나면: ① 광고클라이언트에 ca-pub-… ② 광고 단위 두 개(네모·가로)를
 *    만들어 슬롯 번호를 채운다. 그러면 켜진다. 화면별 수익은 단위를 안 나눠도
 *    애드센스의 「페이지(주소)별 보고서」로 갈라 보인다(2026-08-20 결정).
 * ⚠️ 주소 뒤에 `?adtest=1`을 붙이면 승인 전에도 회색 자리표시가 떠서
 *    자리를 눈으로 확인할 수 있다(방문자는 볼 일 없는 표시다).
 */
export const 광고클라이언트: string = 'ca-pub-6821820286219469'; // 2026-08-21 발급
export const 광고슬롯: Record<'네모' | '가로', string> = { 네모: '', 가로: '' };

export const 광고켬 = 광고클라이언트 !== '' && 광고슬롯.네모 !== '' && 광고슬롯.가로 !== '';

/**
 * 자리 미리보기 스위치.
 * ⚠️ 주소의 ?adtest=1은 **한 번만 오면 세션에 눌러붙는다**(sessionStorage) —
 *    폰 사파리가 주소를 자동완성하며 물음표 뒤를 떼거나, 화면을 옮기며 주소가
 *    다시 쓰여도 미리보기가 안 끊기게. 탭을 닫으면 저절로 꺼지고,
 *    ?adtest=0 으로 바로 끌 수도 있다. (2026-08-21 — 사장님 폰에서 안 보여 보강)
 */
export const 광고시험중 = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('adtest');
    if (q === '0') sessionStorage.removeItem('pokegre_adtest');
    else if (q !== null) sessionStorage.setItem('pokegre_adtest', '1');
    return sessionStorage.getItem('pokegre_adtest') === '1';
  } catch {
    return new URLSearchParams(window.location.search).has('adtest');
  }
};

// 애드센스 스크립트는 **처음 광고가 그려질 때 한 번만** 단다. index.html에 박아 두면
// 승인 전(빈 client)에도 요청이 나가므로 여기서 조건부로 단다.
let 스크립트달았다 = false;
export function 광고스크립트달기(): void {
  if (스크립트달았다 || !광고켬) return;
  스크립트달았다 = true;
  // index.html이 이미 달아 뒀으면(심사용) 두 번 안 단다.
  if (document.querySelector('script[src*="adsbygoogle.js"]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${광고클라이언트}`;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
}
