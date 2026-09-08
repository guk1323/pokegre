/**
 * **미개봉 시세** — 전 세트의 부스터 박스·팩·엘리트 트레이너 박스 시세를 한 화면에 모아 본다.
 *
 * 왜 따로 화면인가 — 처음엔 세트 상세마다 한 줄씩 붙였는데, 사장님 지시(2026-08-11)로
 * "한곳에 모아서 보는" 화면으로 바꿨다. "이 박스 지금 얼마"는 세트를 하나씩 열어 보는
 * 정보가 아니라 **줄 세워 비교하는** 정보라는 뜻이다.
 *
 * 재료는 sealed 덤프(크레딧 0)를 서버가 세트별로 접어 둔 것(/api/local/sealed-prices).
 * 값은 TCGplayer(미국) 마켓 기준이고, 갱신은 sealed를 다시 받을 때마다 저절로 된다.
 */
import { useEffect, useMemo, useState } from 'react';
import { AdSlot } from './AdSlot';
import { fetchExchangeRates, formatKrwApprox } from '../api/exchangeRate';
import { koSet } from '../lib/koCardName';
import { trackEvent } from '../api/localStats';
import { 일본쪽세트 } from '../lib/cardNo';
import { cardImg, thumb } from '../lib/cardImg';

type 값 = { name: string; usd: number };
type 세트값 = { box?: 값; pack?: 값; etb?: 값 };
type 줄 = { slug: string; ko: string; ed: 'ja' | 'en'; date: string; cover: string } & 세트값;

export function SealedPricesView({ onOpenSet }: { onOpenSet: (slug: string) => void }) {
  const [줄들, set줄들] = useState<줄[] | null>(null);
  const [usdToKrw, setUsdToKrw] = useState<number | null>(null);
  const [판, set판] = useState<'all' | 'ja' | 'en'>('all');
  const [찾을말, set찾을말] = useState('');
  const [정렬, set정렬] = useState<'boxDesc' | 'boxAsc' | 'dateDesc'>('boxDesc');

  useEffect(() => {
    trackEvent('sealed');
    void fetchExchangeRates().then((r) => setUsdToKrw(r?.usdToKrw ?? null));
    void Promise.all([
      fetch('/api/local/sealed-prices').then((r) => (r.ok ? r.json() : {})),
      fetch('/sets/index.json').then((r) => r.json()),
    ])
      .then(([시세, 색인]: [Record<string, 세트값>, { slug: string; ed?: string; name?: string; releaseDate?: string; cover?: string }[]]) => {
        const 세트로 = new Map(색인.map((s) => [s.slug, s]));
        const out: 줄[] = [];
        for (const [slug, v] of Object.entries(시세)) {
          const s = 세트로.get(slug);
          if (!s || (!v.box && !v.pack && !v.etb)) continue;
          const ed = 일본쪽세트(slug) ? 'ja' : 'en';
          out.push({ slug, ko: koSet(ed, String(s.name ?? '')), ed, date: String(s.releaseDate ?? ''), cover: String(s.cover ?? ''), ...v });
        }
        set줄들(out);
      })
      .catch(() => set줄들([]));
  }, []);

  const 보일것 = useMemo(() => {
    if (!줄들) return [];
    const q = 찾을말.trim().toLowerCase().replace(/\s+/g, '');
    let r = 줄들.filter(
      (x) => (판 === 'all' || x.ed === 판) && (!q || x.ko.toLowerCase().replace(/\s+/g, '').includes(q)),
    );
    r = [...r].sort((a, b) =>
      정렬 === 'dateDesc'
        ? (b.date || '').localeCompare(a.date || '')
        : 정렬 === 'boxAsc'
          ? (a.box?.usd ?? Infinity) - (b.box?.usd ?? Infinity)
          : (b.box?.usd ?? -1) - (a.box?.usd ?? -1),
    );
    return r;
  }, [줄들, 판, 찾을말, 정렬]);

  const 돈 = (v?: 값) =>
    !v ? <span className="text-neutral-300">—</span> : (
      <span className="font-semibold text-neutral-800">
        {usdToKrw ? formatKrwApprox(v.usd * usdToKrw) : `$${v.usd.toLocaleString()}`}
      </span>
    );

  return (
    // ⚠️ **폭은 `max-w-6xl`** — 도감 세 화면(세트·포켓몬·작가)의 목록이 다 이 폭이다.
    //    혼자 `4xl`이라 양옆이 더 비어 보였다(사장님 지적 2026-08-27).
    <div className="mx-auto max-w-6xl">
      {/* ⚠️ **제목 줄을 도감 세 화면과 같은 뼈대로 맞췄다**(사장님 지시 2026-08-27).
          왼쪽에 제목, **오른쪽 위에 둥근 검색칸** — 세트·포켓몬·작가 화면이 다 이 꼴이다.
          예전엔 검색칸이 제목 아래 전체 폭이라 이 화면만 생김새가 달랐다.
          ⚠️ 「미개봉」을 뺐다 — 박스·팩은 뜯으면 카드가 되니 **안 뜯은 상태가 기본**이다.
             드롭다운도 「박스·팩」으로 줄여 옆 셋과 줄을 맞췄다.
          ⚠️ 다만 **브라우저 탭 제목은 「미개봉」을 그대로 둔다** — 검색어로 쓸모가 있다. */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-black">박스·팩 시세</h1>
          {/* ⚠️ **여기만 설명을 남긴다.** 도감 세 화면은 제목이 곧 설명이라 없앴지만, 여기는
              **값이 나가는 화면**이라 어디 값인지 안 밝히면 국내 시세로 오해한다 —
              박스는 한국·미국 값 차이가 크다. 조작 안내는 뺐다. */}
          <p className="mt-1 text-xs text-neutral-400">TCGplayer(미국) 마켓 시세입니다.</p>
        </div>
        <div className="relative w-full flex-shrink-0 sm:w-60 md:w-72">
          <input
            type="text"
            value={찾을말}
            onChange={(e) => set찾을말(e.target.value)}
            placeholder="세트 찾기"
            className="w-full rounded-full border border-neutral-200 bg-white py-2.5 pl-4 pr-9 text-sm outline-none focus:border-neutral-400"
          />
          {찾을말 && (
            <button
              type="button"
              aria-label="검색어 지우기"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => set찾을말('')}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-fit overflow-hidden rounded-lg border border-neutral-300">
            {(
              [
                ['all', '전체'],
                ['ja', '일본어판'],
                ['en', '영문판'],
              ] as const
            ).map(([v, 말]) => (
              <button
                key={v}
                type="button"
                onClick={() => set판(v)}
                className={`px-3 py-1.5 text-sm font-semibold ${판 === v ? 'bg-black text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
              >
                {말}
              </button>
            ))}
          </div>
          <select
            value={정렬}
            onChange={(e) => set정렬(e.target.value as typeof 정렬)}
            className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-700"
          >
            <option value="boxDesc">박스 비싼 순</option>
            <option value="boxAsc">박스 싼 순</option>
            <option value="dateDesc">최근 발매 순</option>
          </select>
          {줄들 && <span className="text-xs text-neutral-400">{보일것.length}세트</span>}
        </div>
      </div>

      {줄들 === null ? (
        <p className="mt-6 text-sm text-neutral-400">불러오는 중...</p>
      ) : 보일것.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">맞는 세트가 없습니다.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400">
                <th className="py-2 pr-2 font-semibold">세트</th>
                <th className="py-2 pr-2 font-semibold">발매</th>
                <th className="py-2 pr-2 text-right font-semibold">부스터 박스</th>
                <th className="py-2 pr-2 text-right font-semibold">부스터 팩</th>
                <th className="py-2 text-right font-semibold">엘리트 트레이너 박스</th>
              </tr>
            </thead>
            <tbody>
              {보일것.map((r) => (
                <tr key={r.slug} className="border-b border-neutral-100 hover:bg-neutral-50">
                  {/* ⚠️ **세트 표지를 붙였다**(사장님 지시 2026-08-27: 「다른 도감이랑 생긴 게
                      좀 달라서」). 도감 세 화면은 그림 타일인데 여기만 글자 표라 튀었다.
                      표는 그대로 둔다 — 이 화면은 **값을 견주는 곳**이라 한 눈에 여러 줄이
                      보여야 한다(타일로 바꾸면 15줄 → 7칸으로 줄어든다).
                      ⚠️ 판 구분 점(●)은 그대로 뒀다 — 표지만으로는 일본판·영문판이 안 갈린다.
                      ⚠️⚠️ **`cardImg()`를 반드시 거친다.** TCGdex 표지는 확장자가 없는 베이스
                         주소라(`.../bw/bw11/115`) 그냥 부르면 **404**다 — 만들 때 이걸 빠뜨려
                         표지가 다 깨졌다(2026-08-27). `cardImg()`가 `/high.webp`를 붙여 준다. */}
                  <td className="max-w-[260px] py-2 pr-2">
                    <button
                      type="button"
                      onClick={() => onOpenSet(r.slug)}
                      className="flex items-center gap-2 text-left font-semibold text-neutral-800 hover:underline"
                    >
                      {r.cover ? (
                        <img
                          src={thumb(cardImg(r.cover), 80)}
                          alt=""
                          loading="lazy"
                          className="card-dim h-9 w-7 shrink-0 rounded-sm object-cover"
                        />
                      ) : (
                        <span className="h-9 w-7 shrink-0 rounded-sm bg-neutral-100" />
                      )}
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${r.ed === 'ja' ? 'bg-rose-500' : 'bg-indigo-500'}`}
                        aria-label={r.ed === 'ja' ? '일본어판' : '영문판'}
                      />
                      <span className="truncate">{r.ko}</span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-2 text-xs text-neutral-400">
                    {r.date ? r.date.slice(0, 7).replace('-', '.') : '—'}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-2 text-right">{돈(r.box)}</td>
                  <td className="whitespace-nowrap py-2 pr-2 text-right">{돈(r.pack)}</td>
                  <td className="whitespace-nowrap py-2 text-right">{돈(r.etb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <AdSlot 형태="가로" 이름="미개봉" />
        </div>
      )}
    </div>
  );
}
