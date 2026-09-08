import { useEffect, useState } from 'react';
import { useKrw } from './KrwHint';
import { trackEvent } from '../api/localStats';
// ⚠️ cardCatalog가 아니라 cardImg에서 가져온다 — cardCatalog는 이름 사전을 통째로
//    끌고 와서 첫 화면이 무거워진다(PackShelfPromo·NewSetHitCards와 같은 이유).
import { thumb, CARD_BACK } from '../lib/cardImg';

// 홈의 「최신 발매 박스 시세」 — 신팩 힛카드 자리를 대신한다(사장님 지시 2026-09-03:
// "요즘 사람들이 박스시세에 관심이 많거든", "힛카드 자리에 박스시세 대체").
//
// ⚠️ **값은 서버가 하루 한 번 받아 둔 것**이다(`/api/local/box-prices`). 사람이 들어올
//    때마다 스니커덩크를 부르면 막힌다 — 예전에 조사하던 컴퓨터가 차단당한 적이 있다.
// ⚠️ **어느 날 값인지 반드시 같이 적는다.** 하루 한 번이라 오늘 시세와 다를 수 있는데,
//    날짜가 없으면 지금 이 순간 값으로 읽힌다(환율 표기와 같은 생각이다).

interface 박스 {
  slug: string;
  ko: string;
  /** 눌렀을 때 검색창에 넣을 말. 서버가 **세트코드를 뗀 꼴**로 담아 둔다 —
   *  「M6 스톰 에메랄다」로 물으면 스니커덩크에 박스가 0개다. */
  q: string;
  yen: number;
  sellers: number;
  likes: number;
  img: string;
  releaseDate: string;
}

/** "9.3" — 어느 날 받은 값인지. 연도는 안 붙인다(하루 한 번이라 늘 올해다). */
function 받은날(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

/** 아직 안 나온 팩인가. 발매 전 박스는 예약분이라 값이 크게 뛴다 — 딱지를 붙여 알린다. */
function 발매전인가(releaseDate: string): boolean {
  if (!releaseDate) return false;
  const 오늘 = new Date();
  const 날 = new Date(`${releaseDate}T00:00:00+09:00`);
  return 날.getTime() > 오늘.getTime();
}

export function BoxPrices({ onOpenPack }: { onOpenPack: (q: string) => void }) {
  const [data, setData] = useState<{ asOf: number; items: 박스[] } | null>(null);
  const krw = useKrw();

  useEffect(() => {
    void fetch('/api/local/box-prices')
      .then((r) => r.json())
      .then((d: { asOf?: number; items?: 박스[] }) => {
        if (d.items?.length) setData({ asOf: d.asOf ?? 0, items: d.items });
      })
      // 못 받아도 화면은 그대로 돈다 — 이 칸만 안 보일 뿐이다.
      .catch(() => undefined);
  }, []);

  if (!data) return null;

  return (
    <section className="mt-6">
      {/* ⚠️⚠️ **홈 구역 제목은 셋이 똑같아야 한다**(사장님 지시 2026-08-12 "굵기랑 크기 다 다르잖아").
          인기 검색어 · 오늘의 상점 TOP 5 · 최신 발매 박스 시세 — 셋 다 text-lg + extrabold + 검정. */}
      <h2 className="text-lg font-extrabold tracking-tight text-black">최신 발매 박스 시세</h2>
      {/* 값의 기준을 안 적으면 "왜 다른 데와 값이 다르냐"는 오해가 그대로 남는다.
          어느 마켓인지 · 어떤 물건인지 · 언제 값인지 셋 다 적는다. */}
      {/* ⚠️ 곁글씨는 `neutral-400`이 아니라 **`neutral-500`**이다. 밝은 화면에서
          400은 대비 2.58로 홍보팀 기준(4.5)에 못 미친다 — 500은 4.74로 넘긴다
          (2026-09-04 실측). 사이트 다른 곳도 400을 쓰고 있어 **거기까지는 안 건드렸다**;
          이 칸만 먼저 맞춘다. */}
      <p className="mt-0.5 mb-2 text-xs text-neutral-500">
        SNKRDUNK 실거래 · 슈링크 있는 미개봉 박스{data.asOf ? ` · ${받은날(data.asOf)} 기준` : ''}
      </p>
      {/* ⚠️ **칸 수가 힛카드(모바일 4 · PC 8)와 다르다.** 박스 사진은 가로가 넓어서(4:3)
          같은 칸에 넣으면 글자가 안 보인다. 모바일 3칸 두 줄 · PC 6칸 한 줄로 여섯 개
          (사장님과 맞춤 2026-09-03). 늘리려면 서버 `boxSets.json`의 팩 수도 같이 본다. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
        {data.items.slice(0, 6).map((b) => {
          const 발매전 = 발매전인가(b.releaseDate);
          return (
            <button
              key={b.slug}
              type="button"
              className="group text-left"
              aria-label={`${b.ko} 박스 시세 보기`}
              onClick={() => {
                // 이 줄이 실제로 쓰이는지 봐야 자리를 지킬지 판단할 수 있다.
                trackEvent('home_box', b.ko);
                onOpenPack(b.q);
              }}
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200/70 transition group-hover:shadow-lg group-hover:ring-neutral-300">
                {/* ⚠️ **우리 그림 창구(`thumb`)를 태운다.** 스니커덩크 주소를 그대로 걸면
                    빈칸이 된다 — 남의 서버에 바로 붙는 길은 막혀 있다(2026-09-04 실측).
                    창구는 도쿄에서 줄여 보내 주고, 허용 목록에 `cdn.snkrdunk.com`이 이미 있다. */}
                <img
                  src={thumb(b.img, 320) || CARD_BACK}
                  alt={b.ko}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain p-1.5 transition-transform duration-200 group-hover:scale-[1.04]"
                />
                {발매전 && (
                  // ⚠️⚠️ 글자색을 **검정 그대로 박아 둔다**(`text-black`이 아니다).
                  //    어두운 화면은 색 변수를 뒤집어 `text-black`이 흰색이 되는데,
                  //    딱지 바탕(노랑)은 안 뒤집혀 **흰 글씨가 노란 바탕에** 얹힌다 —
                  //    대비 2.2로 홍보팀 기준(4.5)에 한참 못 미쳤다(2026-09-04 실측).
                  //    사진 위에 얹는 글자와 같은 규칙이다.
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-[#1a1a1a]">
                    발매 예정
                  </span>
                )}
              </div>
              <p className="mt-1.5 truncate text-xs font-bold text-black">{b.ko}</p>
              <p className="text-sm font-extrabold text-black">{krw(b.yen, 'jpy')}</p>
              <p className="text-[11px] text-neutral-500">매물 {b.sellers.toLocaleString()}개</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
