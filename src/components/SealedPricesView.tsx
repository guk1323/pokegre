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

type 값 = { name: string; usd: number };
type 세트값 = { box?: 값; pack?: 값; etb?: 값 };
type 줄 = { slug: string; ko: string; ed: 'ja' | 'en'; date: string } & 세트값;

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
      .then(([시세, 색인]: [Record<string, 세트값>, { slug: string; ed?: string; name?: string; releaseDate?: string }[]]) => {
        const 세트로 = new Map(색인.map((s) => [s.slug, s]));
        const out: 줄[] = [];
        for (const [slug, v] of Object.entries(시세)) {
          const s = 세트로.get(slug);
          if (!s || (!v.box && !v.pack && !v.etb)) continue;
          const ed = 일본쪽세트(slug) ? 'ja' : 'en';
          out.push({ slug, ko: koSet(ed, String(s.name ?? '')), ed, date: String(s.releaseDate ?? ''), ...v });
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
    <div className="mx-auto max-w-4xl">
      <h1 className="text-lg font-bold text-black">미개봉 박스·팩</h1>
      <p className="mt-1 text-sm text-neutral-500">
        세트별 부스터 박스·부스터 팩·엘리트 트레이너 박스의 현재 시세입니다. TCGplayer(미국) 마켓 기준이며, 세트
        이름을 누르면 그 세트의 카드 목록으로 이동합니다.
      </p>

      {/* 판·정렬·검색 — 세트 화면과 같은 뼈대(검색칸 전체 폭, 토글은 아래). */}
      <div className="mt-4">
        <input
          value={찾을말}
          onChange={(e) => set찾을말(e.target.value)}
          placeholder="세트 이름 찾기. 예: 이볼빙, 태그올스타즈"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
                  <td className="max-w-[240px] py-2 pr-2">
                    <button
                      type="button"
                      onClick={() => onOpenSet(r.slug)}
                      className="flex items-center gap-1.5 text-left font-semibold text-neutral-800 hover:underline"
                    >
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
