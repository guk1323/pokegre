import { useEffect, useState } from 'react';
import { livePacks } from '../lib/packSets';

// 카드 시세 홈(인기 검색어 ↓ 포켓몬 뉴스 ↑ 사이)에 놓는 "오늘의 팩" — 카드 뽑기 입구.
// 다른 섹션(인기 검색어·뉴스)과 같은 기본 톤(흰 바탕·neutral 테두리)을 따른다.
// 튀는 색·이모지·라벨은 쓰지 않는다(사용자 지침). 진열은 뽑기 화면과 같은 계산이라
// 매일 자정(KST)에 함께 바뀐다.

const thumb = (url: string, w: number) => `/api/img?u=${encodeURIComponent(url)}&w=${w}`;
const won = (n: number) => `${n.toLocaleString()}원`;

export function PackShelfPromo({ onEnter }: { onEnter: () => void }) {
  const [art, setArt] = useState<Record<string, { boxImg?: string; logo?: string }>>({});
  const packs = livePacks();

  useEffect(() => {
    void fetch('/sets/index.json')
      .then((r) => r.json())
      .then((list: { slug: string; boxImg?: string; logo?: string }[]) =>
        setArt(Object.fromEntries(list.map((s) => [s.slug, { boxImg: s.boxImg, logo: s.logo }]))),
      )
      .catch(() => undefined);
  }, []);

  return (
    <section className="mt-8">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-bold text-black">오늘의 팩</h2>
        <p className="text-xs text-neutral-400">매일 자정에 진열이 바뀝니다</p>
      </div>
      <button
        type="button"
        onClick={onEnter}
        className="group block w-full rounded-2xl border border-neutral-200 bg-white p-4 text-left transition hover:border-neutral-300 hover:bg-neutral-50"
      >
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
          {packs.map((p) => {
            const img = art[p.slug]?.boxImg || art[p.slug]?.logo;
            return (
              <div key={p.slug} className="px-1 text-center">
                <div className="flex h-16 items-end justify-center sm:h-20">
                  {img && (
                    <img
                      src={thumb(img, 160)}
                      alt=""
                      loading="lazy"
                      className="max-h-16 object-contain transition group-hover:-translate-y-0.5 sm:max-h-20"
                    />
                  )}
                </div>
                <p className="mt-1.5 line-clamp-1 text-[11px] font-semibold text-neutral-700">
                  {p.label.replace(/^\[.+?\]\s*/, '')}
                </p>
                <p className="text-[10px] text-neutral-400">{won(p.price)}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-center text-xs font-semibold text-neutral-500 group-hover:text-black">
          출석 예산으로 팩을 열 수 있습니다 →
        </p>
      </button>
    </section>
  );
}
