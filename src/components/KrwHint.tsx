import { useEffect, useState } from 'react';
import { fetchExchangeRates, formatKrwApprox, formatRateDate, type ExchangeRates } from '../api/exchangeRate';

// 환율은 앱 전체에서 하나뿐이고 하루에 한 번 바뀐다. 카드 타일마다 각자 받아오면
// 화면 하나 그리는 데 요청이 스무 번씩 나가므로, 모듈 바깥에 한 번만 받아 공유한다.
let cached: ExchangeRates | null = null;
let inFlight: Promise<ExchangeRates | null> | null = null;

function useExchangeRates(): ExchangeRates | null {
  const [rates, setRates] = useState<ExchangeRates | null>(cached);

  useEffect(() => {
    if (cached) return;
    // 여러 타일이 동시에 그려져도 요청은 한 번만 나가게 묶는다.
    inFlight ??= fetchExchangeRates();
    let alive = true;
    inFlight.then((r) => {
      cached = r;
      if (alive) setRates(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  return rates;
}

// 엔·달러 가격 옆에 붙는 원화 참고값. 환율을 못 가져왔으면 아무것도 안 보여준다 —
// 원화는 어디까지나 참고라, 이것 때문에 카드 가격까지 못 보게 만들면 안 된다.
export function KrwHint({
  amount,
  currency,
  showDate = false,
}: {
  amount: number;
  currency: 'jpy' | 'usd';
  // 목록에서는 타일마다 "7.15 환율 기준"이 반복되면 시끄러워서 금액만 보여주고,
  // 자세히 들여다보는 상세 화면에서만 기준일을 밝힌다.
  showDate?: boolean;
}) {
  const rates = useExchangeRates();
  if (!rates || amount <= 0) return null;

  const krw = amount * (currency === 'jpy' ? rates.jpyToKrw : rates.usdToKrw);

  return (
    <p className="text-xs text-neutral-400">
      {formatKrwApprox(krw)}
      {showDate && ` · ${formatRateDate(rates.date)}`}
    </p>
  );
}

// 원화가 여러 개 나열되는 화면(이베이 등급별 낙찰가)에서 기준일을 한 번만 밝힐 때 쓴다.
// 항목마다 "7.15 환율 기준"을 반복하면 정작 읽어야 할 가격이 묻힌다.
export function KrwRateNote() {
  const rates = useExchangeRates();
  if (!rates) return null;
  return <p className="text-[11px] text-neutral-400 mt-2">원화는 {formatRateDate(rates.date)} 참고값입니다.</p>;
}
