import { useEffect, useState } from 'react';
import { 힛카드기준글 } from '../lib/cardImg';
import { trackEvent } from '../api/localStats';
import { fetchExchangeRates, formatKrwApprox } from '../api/exchangeRate';
// ⚠️ cardCatalog가 아니라 cardImg에서 가져온다 — cardCatalog는 이름 사전을 통째로
//    끌고 와서 첫 화면이 109KB 무거워진다(PackShelfPromo와 같은 이유).
import { CARD_BACK, cardImg, thumb } from '../lib/cardImg';

// 홈(인기 검색어 ↓ 오늘의 상점 ↑ 사이)에 놓는 "신팩 힛카드".
//
// 왜 여기인가: 시세를 보러 온 사람이 검색을 한 번도 안 해도 지금 제일 비싼 카드가
// 얼마인지 바로 보게 하려는 것이다(운영자 지시 2026-08-05). 검색창 바로 아래가
// 인기 검색어이고, 그다음이 이 자리다.
//
// ⚠️ 어느 세트를 보여줄지는 **서버가 고른다**(/api/local/latest-hit-set). 발매일이
//    제일 최근이면서 시세가 있는 세트다. 여기에 세트를 박아 두면 새 팩이 나올 때마다
//    사람이 고쳐야 하고, 안 고치면 "신팩" 자리에 몇 달 된 세트가 걸린다.
// ⚠️ 카드 이름(ko)도 서버가 한글로 바꿔 준다. 화면에서 바꾸려면 이름 사전을 받아야
//    하는데 그게 홈에서 제일 무거운 짐이다.

interface HitCard {
  n: string;
  usd: number;
  name: string;
  ko: string;
  img: string;
}

interface Latest {
  slug: string;
  ed: 'ja' | 'en';
  name: string;
  /** 화면에 적을 **한글 세트 이름**. 서버가 이름 사전을 태워서 보낸다.
   *  ⚠️ 옛 서버는 이걸 안 보낸다 — 없으면 `name`(원어)으로 되돌아간다. */
  nameKo?: string;
  releaseDate: string;
  src: 'snkrdunk' | 'tcgplayer';
  grade?: 'psa10' | 'a';
  // 이 값을 **언제 받아 뒀는지**. 실시간이 아니라 미리 받아 둔 것이라 며칠 묵는다.
  pricedAt?: number;
  cards: HitCard[];
}

// "2026-07-31" → "2026.07 발매". 날짜까지 적으면 줄이 길어지고, 신상인지 아닌지만
// 알면 되는 자리라 달까지만 적는다.
function releasedOn(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}.${m[2]} 발매` : '';
}

export function NewSetHitCards({
  onOpenCard,
  onOpenSet,
}: {
  /**
   * 카드 한 장을 눌렀을 때. 이름만 넘기면 같은 이름 카드가 다 나온다 — 세트·번호까지
   * 넘겨 그 한 장으로 좁힌다(도감·세트·작가와 같은 규칙, lib/pokedexRoute.ts).
   */
  onOpenCard: (card: { ko: string; name: string; n: string; set: Latest }) => void;
  onOpenSet: (slug: string) => void;
}) {
  const [usdToKrw, setUsdToKrw] = useState<number | null>(null);
  const [data, setData] = useState<Latest | null>(null);
  const [loading, setLoading] = useState(true);

  // 값은 원화로 적는다(사이트 전체가 그렇다). 못 받으면 달러로 적는다.
  useEffect(() => {
    void fetchExchangeRates().then((r) => setUsdToKrw(r?.usdToKrw ?? null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/local/latest-hit-set')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Latest | null) => {
        if (cancelled) return;
        setData(d && d.slug && d.cards?.length ? d : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 받는 중에는 자리만 잡아 둔다. 아무것도 안 그리면 아래 내용이 올라왔다 내려가
  // 화면이 튄다(인기 검색어와 같은 방식).
  if (loading) {
    return (
      <div>
        <div className="mb-3 h-6 w-40 animate-pulse rounded bg-neutral-100" />
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="aspect-[63/88] animate-pulse rounded-lg bg-neutral-100" />
          ))}
        </div>
      </div>
    );
  }
  // 시세가 하나도 없으면 이 줄 자체를 안 그린다. 빈 상자를 남기면 "고장난 자리"로 보인다.
  if (!data) return null;

  const 이름 = data.nameKo || data.name;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        {/* ⚠️⚠️ **구역 제목은 두 단으로만 쓴다**(사장님 지시 2026-08-12 "제목 폰트랑 굵기 비율 맞춰").
              주요(시세): text-lg + font-extrabold + 검정  — 인기 검색어 · 힛카드 목록
              곁다리    : text-sm + font-bold + 회색      — 오늘의 상점 TOP 5 · 포켓몬 소식
            8월 12일에 이 제목만 한 단계 낮췄다가 인기 검색어와 어긋나 되돌렸다.
            구역을 작게 만들 일이 있으면 **제목이 아니라 카드 칸 수**로 줄인다. */}
        <h2 className="text-lg font-extrabold tracking-tight text-black">{이름} 힛카드 목록</h2>
        <button
          type="button"
          onClick={() => {
            trackEvent('home_hit_set', data.slug);
            onOpenSet(data.slug);
          }}
          className="shrink-0 text-xs font-semibold text-neutral-500 hover:text-black"
        >
          전체 보기 →
        </button>
      </div>
      {/* 값의 기준을 안 적으면 "왜 다른 데와 값이 다르냐"는 오해가 그대로 남는다.
          세트 화면과 같은 문구다. */}
      <p className="mb-3 text-xs text-neutral-400">
        {releasedOn(data.releaseDate)} · {힛카드기준글(data.src, data.grade, data.pricedAt)}
      </p>
      {/* ⚠️ 폰은 4장, 큰 화면은 8장. 폰에서 8장을 넣으면 한 칸이 80px이라 카드가
          뭔지 알아볼 수 없다(세트 화면에서 겪은 것과 같은 문제). */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {/* ⚠️ **넓은 화면은 8장 한 줄, 핸드폰은 4장 한 줄.** 8장을 6열에 넣었더니 두 줄이
            되어 이 구역만 674px(홈의 34%)이 됐다. 8열로 하면 한 줄이지만 카드가 133px로
            잘아 무슨 카드인지 안 보였다(2026-08-08). 6장·6열이면 한 줄이면서 180px다.
            ⚠️⚠️ **폰은 4열에서 더 늘리지 말 것.** 2026-08-12에 5열로 바꿔 봤다가 되돌렸다 —
               카드 한 장이 **63px**이 되어 무슨 카드인지 알아볼 수가 없었다.
               넓은 화면은 8열로 늘렸다(같은 날, 사장님이 "힛카드 목록을 작게" 하라고
               하셔서). 이 구역이 홈에서 제일 컸다(344px) — 8열이면 카드가 135px이라
               읽히면서 구역 높이가 줄어든다. 폰과 넓은 화면은 사정이 다르다. */}
        {data.cards.slice(0, 8).map((c, i) => (
          <button
            key={c.n}
            type="button"
            onClick={() => {
              trackEvent('home_hit_card', `${data.slug} ${c.n}`);
              onOpenCard({ ko: c.ko || c.name, name: c.name, n: c.n, set: data });
            }}
            className={`text-left ${i >= 4 ? 'hidden sm:block' : ''}`}
          >
            <div className="mb-1 overflow-hidden rounded-lg bg-neutral-100">
              {c.img ? (
                <img
                  src={thumb(cardImg(c.img), 320)}
                  alt={c.ko || c.name}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[63/88] w-full object-contain"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (img.src !== cardImg(c.img)) img.src = cardImg(c.img);
                    else if (!img.src.endsWith(CARD_BACK)) img.src = CARD_BACK;
                  }}
                />
              ) : (
                <div className="aspect-[63/88] w-full" />
              )}
            </div>
            <p className="truncate text-[11px] font-semibold text-neutral-800">{c.ko || c.name}</p>
            {/* ⚠️ **번호를 같이 적는다.** 힛카드는 값 높은 순이라 **같은 카드의 다른 인쇄가
                나란히 뜬다** — 스톰에메랄다는 "메가레쿠쟈 ex"가 113·110·095로 셋이 걸렸다
                (2026-08-07 확인). 이름만 적으면 똑같은 줄 셋이 값만 다르게 보여
                무엇이 무엇인지 알 수 없다. 그림은 다르지만 글자로도 구분이 돼야 한다. */}
            <div className="flex items-baseline justify-between gap-1">
              <p className="text-xs font-bold text-black">
                {usdToKrw ? formatKrwApprox(c.usd * usdToKrw) : `$${Math.round(c.usd).toLocaleString()}`}
              </p>
              <span className="shrink-0 text-[10px] text-neutral-400">{c.n}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
