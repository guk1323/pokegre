import { useEffect, useState } from 'react';
import { fetchExchangeRates, formatKrwApprox, formatRateDate, type ExchangeRates } from '../api/exchangeRate';

// 환율은 앱 전체에서 하나뿐이고 하루에 한 번 바뀐다. 카드 타일마다 각자 받아오면
// 화면 하나 그리는 데 요청이 스무 번씩 나가므로, 모듈 바깥에 한 번만 받아 공유한다.
let cached: ExchangeRates | null = null;
let inFlight: Promise<ExchangeRates | null> | null = null;
// 실패했을 때 다시 받아 보는 횟수. 무한히 두드리지 않도록 상한을 둔다.
let retriesLeft = 3;

function useExchangeRates(): ExchangeRates | null {
  const [rates, setRates] = useState<ExchangeRates | null>(cached);

  useEffect(() => {
    if (cached) return;
    // 여러 타일이 동시에 그려져도 요청은 한 번만 나가게 묶는다.
    inFlight ??= fetchExchangeRates();
    let alive = true;
    inFlight.then((r) => {
      // ⚠️ 실패(null)는 캐시하지 않는다. 예전엔 실패도 그대로 담아 둬서, 배포 직후처럼
      //    서버가 뜨는 중(502)에 화면이 먼저 열리면 그 세션 내내 환율이 영영 안 붙었다.
      //    원화가 주 표시가 된 뒤로는 화면이 고장난 것처럼 보인다(실제로 겪음).
      //    실패하면 묶어 둔 요청을 풀어, 다음에 그려질 때 다시 받아 본다.
      if (r) cached = r;
      else inFlight = null;
      if (alive) setRates(r);
    });
    // 화면이 그대로면 다시 그려질 일이 없어 영영 안 받는다. 실패했으면 잠깐 뒤 한 번 더
    // 부른다(최대 3번). 서버가 뜨는 데 몇 초 걸리는 배포 직후를 넘기기 위한 것이다.
    const retry = setTimeout(() => {
      if (cached || retriesLeft <= 0) return;
      retriesLeft -= 1;
      inFlight = null;
      fetchExchangeRates().then((r) => {
        if (r) cached = r;
        if (alive && r) setRates(r);
      });
    }, 3000);
    return () => {
      alive = false;
      clearTimeout(retry);
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

const YEN = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// 가격 한 덩어리. 원화를 크게, 원본 화폐(엔·달러)를 작게 보여준다.
//
// 왜 원화가 위인가: 엔과 달러가 한 화면에 섞여 나오는데(스니커덩크는 엔, 이베이·
// TCGplayer는 달러), 원본만 크면 어느 게 비싼지 한눈에 안 들어온다.
// 왜 원본을 지우지 않나: 환율이 유럽중앙은행 하루 한 번 발표값이라 실시간이 아니고,
// 카드 결제에는 해외 수수료가 2~5% 더 붙는다. 원화만 남기면 그 금액을 그대로
// 내는 줄 알게 된다. 그래서 "약"을 붙이고 원본 금액을 함께 남긴다.
// ⚠️ 환율을 못 받아왔으면 원본을 크게 보여준다 — 원화 때문에 가격 자체를 못 보게
//    만들면 안 된다.
export function Price({
  amount,
  currency,
  className = 'text-base font-bold text-black',
  showDate = false,
}: {
  amount: number;
  currency: 'jpy' | 'usd';
  /** 큰 줄(원화)에 입힐 글자 크기·굵기. 쓰는 자리마다 다르다. */
  className?: string;
  showDate?: boolean;
}) {
  const rates = useExchangeRates();
  const orig = currency === 'jpy' ? YEN.format(amount) : USD.format(amount);
  if (!rates || amount <= 0) return <p className={className}>{orig}</p>;

  const krw = amount * (currency === 'jpy' ? rates.jpyToKrw : rates.usdToKrw);
  return (
    <>
      <p className={className}>{formatKrwApprox(krw)}</p>
      <p className="text-xs text-neutral-400">
        {orig}
        {showDate && ` · ${formatRateDate(rates.date)}`}
      </p>
    </>
  );
}

// 금액 하나를 원화 글자로 바꿔 준다. 등급 칸처럼 좁아서 <Price>를 통째로 넣기
// 어려운 자리에서 쓴다.
// ⚠️ 환율을 못 받았을 때만 원본 화폐로 적는다 — 그때도 금액은 보여야 한다.
export function useKrw(): (amount: number, currency: 'jpy' | 'usd') => string {
  const rates = useExchangeRates();
  return (amount, currency) => {
    if (!rates || !(amount > 0)) return currency === 'jpy' ? YEN.format(amount) : USD.format(amount);
    return formatKrwApprox(amount * (currency === 'jpy' ? rates.jpyToKrw : rates.usdToKrw));
  };
}
