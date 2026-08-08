import { useEffect, useState } from 'react';
import { translateSearchQueryToEnglish } from '../lib/translateQueryToEnglish';
import { 마켓전용말떼기 } from '../lib/rarityCode';
import { trackEvent } from '../api/localStats';

// 이베이 한글판(Korean Version) 매물 시세. 서버(/api/local/ebay-korean)가 이베이 Browse
// API로 "카드명 Korean Version" 현재 매물가(호가)를 받아 준다. 체결가(낙찰가)를 주는
// Marketplace Insights는 이베이 별도 승인이 필요해, 지금은 "현재 매물가(호가)"로 명확히 표기한다.
type KItem = {
  title: string;
  price: number;
  currency: string;
  url: string;
  img: string;
  condition: string;
};

const thumb = (url: string, w: number) => (url ? `/api/img?u=${encodeURIComponent(url)}&w=${w}` : '');

export function KoreanEbayView({ query }: { query: string }) {
  const [items, setItems] = useState<KItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(false);

  // 이베이 매물 제목은 영어라, 한글로 검색해도 되도록 영문으로 바꿔 보낸다
  // (리자몽 → Charizard). 이미 영어면 그대로 통과한다. 화면 표시는 사용자가 친 원문 유지.
  //
  // ⚠️ **스니커덩크 전용 꼬리말(":1ED")은 떼고 보낸다.** 이베이 매물 제목에 그런 말이
  //    있을 리 없어서 그대로 보내면 **0건**이 온다("Charizard :1ED" 0건 · "Charizard" 44건,
  //    2026-08-08 실측). 시세·팝수 화면과 같은 방식이다.
  // ⚠️ **레어도(SAR·MUR)는 떼지 않는다.** 다른 화면과 다른 점이다 — 이베이는 판매자가
  //    제목에 직접 적어서 오히려 **잘 좁혀진다**("Charizard SAR" 12건, 실측).
  //    저쪽(PPT)은 카드 이름만 보기 때문에 떼야 했던 것이지, 여기까지 뗄 이유는 없다.
  const { 이름: 뗀뒤, 뗀말 } = 마켓전용말떼기(query);
  const enQuery = translateSearchQueryToEnglish(뗀뒤, 'english');

  useEffect(() => {
    if (!enQuery) return;
    let cancelled = false;
    setItems(null);
    setErr(false);
    // 이베이 한글판 시세를 조회한 횟수를 통계에 남긴다(검색어당 1회).
    trackEvent('ebay_korean');
    fetch(`/api/local/ebay-korean?q=${encodeURIComponent(enQuery)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then((j: { items?: KItem[]; total?: number }) => {
        if (cancelled) return;
        setItems(j.items ?? []);
        setTotal(j.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enQuery]);

  if (err) {
    return (
      <p className="py-16 text-center text-sm text-neutral-400">
        한글판 시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    );
  }
  if (items === null) {
    return <p className="py-16 text-center text-sm text-neutral-400">이베이 한글판 매물을 불러오는 중…</p>;
  }
  const 뗀말안내 = 뗀말 ? (
    <p className="mb-2 text-xs text-neutral-500">'{뗀말}'는 SNKRDUNK에서만 됩니다. 빼고 찾았습니다.</p>
  ) : null;
  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        {뗀말안내}
        <p className="text-sm font-semibold text-neutral-500">'{query}' 한글판 매물을 찾지 못했습니다.</p>
        {/* ⚠️ 이미 영문으로 찾고 있으면 "영어로 검색하라"는 권유가 말이 안 된다.
            도감·세트·작가에서 눌러 오면 영문 이름으로 오기 때문에 실제로 그런 화면이
            나왔다(점검 중 발견 2026-08-06). 한글이 섞였을 때만 권한다. */}
        {/[가-힣]/.test(query) ? (
          <p className="mt-1 text-xs text-neutral-400">
            영어 카드명으로 검색하면 더 잘 나옵니다 (예: Charizard, Pikachu ex).
          </p>
        ) : (
          <p className="mt-1 text-xs text-neutral-400">한글판으로 나온 적이 없거나, 지금 올라온 매물이 없습니다.</p>
        )}
      </div>
    );
  }

  const min = Math.min(...items.map((i) => i.price));
  return (
    <div>
      {뗀말안내}
      {/* 호가임을 분명히 — 영문판(체결가)과 헷갈리면 안 된다. */}
      <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-black">이베이 한글판</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            현재 매물가
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          지금 이베이에 올라온 한글판 매물의 <b>판매 요청가(호가)</b>입니다. 실제 체결가(낙찰가)와 다를 수 있습니다.
        </p>
        <p className="mt-2 text-sm text-neutral-700">
          최저 <b className="text-black">${min.toLocaleString()}</b> · 매물 {total.toLocaleString()}건
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((it, i) => (
          <a
            key={i}
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-neutral-200 p-2 transition hover:shadow-md"
          >
            <div className="aspect-square overflow-hidden rounded-lg bg-neutral-100">
              {it.img && (
                <img
                  src={thumb(it.img, 320)}
                  alt={it.title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
                />
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug text-black">{it.title}</p>
            <div className="mt-1 flex items-center justify-between gap-1">
              <span className="text-sm font-bold text-black">${it.price.toLocaleString()}</span>
              {it.condition && <span className="text-[10px] text-neutral-400">{it.condition}</span>}
            </div>
          </a>
        ))}
      </div>
      <p className="mt-4 text-center text-[11px] text-neutral-400">
        이베이(eBay.com) 매물 · 카드를 누르면 이베이로 이동합니다
      </p>
    </div>
  );
}
