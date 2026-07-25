import { useEffect, useState } from 'react';
import { livePacks } from '../lib/packSets';

// 카드 시세 홈(인기 검색어 ↓ 포켓몬 뉴스 ↑ 사이)에 놓는 "오늘의 팩" 미니 진열대.
// 카드 뽑기의 쇼케이스와 같은 톤(어두운 케이스 + 금색 포인트)으로, 눌러 들어가는 입구다.
// 매일 자정(KST) 진열이 바뀌는 것도 그대로 따라간다(livePacks가 같은 계산).

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
      <button
        type="button"
        onClick={onEnter}
        className="group block w-full rounded-2xl bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-950 p-4 text-left ring-1 ring-neutral-800 transition hover:ring-amber-400/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-white">
            🎴 오늘의 팩 <span className="align-middle text-[10px] font-semibold text-amber-400">베타</span>
          </h2>
          <p className="text-[11px] text-neutral-400">매일 자정에 진열이 바뀌어요</p>
          <span className="ml-auto rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-black transition group-hover:bg-amber-300">
            출석하고 뽑으러 가기 →
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 sm:grid-cols-6">
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
                      className="max-h-16 object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.6)] transition group-hover:-translate-y-0.5 sm:max-h-20"
                    />
                  )}
                </div>
                <div className="mt-1 h-[2px] rounded-full bg-gradient-to-r from-transparent via-neutral-500/60 to-transparent" />
                <p className="mt-1 line-clamp-1 text-[10px] font-medium text-neutral-300">
                  {p.label.replace(/^\[.+?\]\s*/, '')}
                </p>
                <p className="text-[10px] text-neutral-500">{won(p.price)}</p>
              </div>
            );
          })}
        </div>
      </button>
    </section>
  );
}
