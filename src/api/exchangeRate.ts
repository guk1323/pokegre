export interface ExchangeRates {
  jpyToKrw: number;
  usdToKrw: number;
  // 환율의 기준 날짜(YYYY-MM-DD). 오늘이 아니다 — 유럽중앙은행이 평일 하루 한 번
  // 발표해서 보통 어제 것이고, 주말이 끼면 사흘 전 것일 수도 있다.
  date: string;
}

// 실패하면 null. 환율은 어디까지나 참고용이라, 못 가져왔다고 카드 가격까지
// 못 보게 만들면 안 된다.
export async function fetchExchangeRates(): Promise<ExchangeRates | null> {
  try {
    const res = await fetch('/api/local/exchange-rate');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// "약 115만원" 처럼 어림수로 보여준다. 1,148,612원이라고 적으면 그 금액에 살 수
// 있다는 뜻으로 읽히는데, 카드사 환율과 해외결제 수수료 때문에 실제 결제액은
// 2~5% 어긋난다. 어차피 정확할 수 없으면 정확한 척을 안 하는 게 낫다.
export function formatKrwApprox(krw: number): string {
  if (krw >= 10_000) {
    const man = krw / 10_000;
    // 100만원이 넘어가면 소수점이 의미 없다. 115.3만원보다 115만원이 읽기 쉽다.
    const rounded = man >= 100 ? Math.round(man) : Math.round(man * 10) / 10;
    return `약 ${rounded.toLocaleString('ko-KR')}만원`;
  }
  return `약 ${(Math.round(krw / 100) * 100).toLocaleString('ko-KR')}원`;
}

// "7.15 환율 기준" — 어느 시점 환율로 계산한 값인지 밝힌다. 이게 없으면 사용자는
// 지금 이 순간 환율인 줄 안다.
export function formatRateDate(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${Number(m)}.${Number(d)} 환율 기준`;
}
