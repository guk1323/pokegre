import { useCallback, useEffect, useRef, useState } from 'react';
import { CardImg } from './CardImg';
import { trackEvent } from '../api/localStats';
import { loadNameDict, warmNameDict } from '../lib/nameDict';
import { koName } from '../lib/koCardName';
import { pptSetKoMany } from '../lib/pptSetKo';

// 팝수(감정 수량) 조회.
//
// 왜 따로 만들었나: 카드 상세에 붙는 요약은 PSA 10·9·전체 셋뿐이라, 전체가 4,000장인데
// 10등급 2,000·9등급 1,000이면 **나머지 1,000장이 어디 갔는지 알 수 없다**(사장님 지적
// 2026-08-07). 여기서는 감정기관 넷(PSA·BGS·CGC·SGC)의 등급을 반칸까지 하나도 빠짐없이
// 보여 준다.
//
// ⚠️ 등급표는 카드 상세와 달리 **볼 때 받아 온다**. 기계가 512MB뿐이라 카드 58,000장의
//    등급표를 통째로 들고 있을 수 없다. 한 장에 2크레딧이고, 일부러 찾아본 카드에만
//    나가므로 낭비가 없다.

interface 찾은카드 {
  tcgPlayerId: string;
  name: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  imageUrl: string;
}
interface 기관자료 {
  total: number;
  gem?: number;
  g: Record<string, number>;
}
interface 상세 {
  all: number;
  gems?: number;
  byGrader: Record<string, 기관자료>;
  updatedAt?: string;
}

// 보여 줄 순서. 높은 등급부터 내려간다 — 사람이 궁금한 건 10등급이 몇 장인지다.
// 반칸(9.5·8.5…)까지 넣는 이유는 BGS·CGC가 반칸을 실제로 쓰기 때문이다.
const 등급순서 = [
  'perfect', 'pristine', 'g10', 'g9_5', 'g9', 'g8_5', 'g8', 'g7_5', 'g7', 'g6_5', 'g6',
  'g5_5', 'g5', 'g4_5', 'g4', 'g3_5', 'g3', 'g2_5', 'g2', 'g1_5', 'g1', 'auth', 'qualifiers',
];
const 등급이름 = (k: string): string => {
  if (k === 'perfect') return '10 퍼펙트';
  if (k === 'pristine') return '10 프리스틴';
  if (k === 'auth') return '진품만';
  if (k === 'qualifiers') return '조건부';
  const m = k.match(/^g(\d+)(_5)?$/);
  if (!m) return k;
  return m[2] ? `${m[1]}.5` : m[1];
};
// 감정기관 표시 순서. PSA가 가장 많이 쓰이니 먼저 둔다.
const 기관순서 = ['PSA', 'BGS', 'CGC', 'SGC'];

// 저쪽(PPT)이 주는 이름은 **영문에 번호 꼬리가 붙어** 온다("M Charizard EX - 091/087").
// 그대로 쓰면 ① 사이트 다른 화면은 한글인데 여기만 영어이고 ② 바로 아래 줄에 번호를
// 또 적으므로 **같은 번호가 두 번** 나온다(2026-08-07 화면 확인).
// koName이 번호 꼬리를 떼고 한글로 바꿔 준다 — 사이트 전체가 쓰는 그 한 벌이다.
const 보일이름 = (판: 'japanese' | 'english', name: string) => koName(판 === 'japanese' ? 'ja' : 'en', name);
export function PopulationView({ 처음카드 }: { 처음카드?: { id: string; lang?: string } | null }) {
  const [말, set말] = useState('');
  const [판, set판] = useState<'japanese' | 'english'>('japanese');
  const [찾는중, set찾는중] = useState(false);
  const [결과, set결과] = useState<찾은카드[] | null>(null);
  // 저쪽이 주는 최대치에 걸려 잘렸나(잘리면 값이 낮은 카드가 안 온다).
  const [잘림, set잘림] = useState(false);
  // 저쪽 세트 이름 → 우리 한글 이름. 결과가 오면 그때 한 번 만든다(공용 대조표).
  const [세트한글, set세트한글] = useState<Map<string, string>>(new Map());
  const [고른것, set고른것] = useState<찾은카드 | null>(null);
  const [자료, set자료] = useState<상세 | null>(null);
  const [자료받는중, set자료받는중] = useState(false);
  const [오류, set오류] = useState<string | null>(null);
  const 마지막요청 = useRef(0);

  const 등급표받기 = useCallback((id: string, lang?: string) => {
    const 표 = ++마지막요청.current;
    set자료(null);
    set자료받는중(true);
    set오류(null);
    fetch(`/api/local/population-detail?id=${encodeURIComponent(id)}${lang ? `&lang=${lang}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { detail: 상세 | null } | null) => {
        if (표 !== 마지막요청.current) return;
        set자료(j?.detail ?? null);
        set자료받는중(false);
        if (j?.detail) trackEvent('population_detail');
      })
      .catch(() => {
        if (표 !== 마지막요청.current) return;
        set자료받는중(false);
        set오류('등급표를 불러오지 못했습니다.');
      });
  }, []);

  // 카드 상세에서 "전체 등급 보기"로 들어온 경우, 그 카드를 바로 연다.
  useEffect(() => {
    if (!처음카드?.id) return;
    if (처음카드.lang === 'english' || 처음카드.lang === 'japanese') set판(처음카드.lang);
    등급표받기(처음카드.id, 처음카드.lang);
  }, [처음카드, 등급표받기]);

  const 찾기 = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const 친것 = 말.trim();
    if (친것.length < 2) return;
    set찾는중(true);
    set오류(null);
    set결과(null);
    set잘림(false);
    set고른것(null);
    set자료(null);
    // ⚠️ 저쪽(PPT)은 **영문 이름만 알아듣는다**. 한글로 치면 0건이 된다
    //    (2026-08-07 사장님이 발견). 검색창과 똑같이 사전으로 영문으로 바꿔 보낸다.
    //    한글이 없으면 손대지 않는다 — "Charizard 4/102"처럼 이미 영문인 것을
    //    번역기에 넣으면 오히려 망가진다.
    let q = 친것;
    if (/[가-힣]/.test(친것)) {
      try {
        q = (await loadNameDict()).translateSearchQueryToEnglish(친것, 판);
      } catch {
        set찾는중(false);
        set오류('이름 사전을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        return;
      }
      // ⚠️ 사전에 없는 한글은 **그대로 남는다**. 그걸 보내면 저쪽이 0장을 주고,
      //    화면엔 "찾은 카드가 없습니다"가 떠서 우리가 그 카드를 안 다루는 것처럼
      //    보인다. 무엇이 문제인지 밝혀 준다.
      if (/[가-힣]/.test(q)) {
        set찾는중(false);
        set오류(`'${친것}'의 영문 이름을 몰라 찾지 못했습니다. 영문으로 쳐 보시겠어요?`);
        return;
      }
    }
    fetch(`/api/local/card-find?search=${encodeURIComponent(q)}&lang=${판}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 429 ? '오늘 조회량을 다 썼습니다.' : '찾지 못했습니다.');
        return r.json();
      })
      .then((j: { cards: 찾은카드[]; capped?: boolean }) => {
        set결과(j.cards ?? []);
        set잘림(Boolean(j.capped));
        // 세트 이름은 **공용 대조표** 한 벌로 바꾼다(api/ebayPrices.ts와 같은 것).
        void pptSetKoMany((j.cards ?? []).map((c) => c.setName)).then(set세트한글).catch(() => undefined);
        set찾는중(false);
        trackEvent('population_search');
      })
      .catch((err: Error) => {
        set찾는중(false);
        set오류(err.message);
      });
  };

  const 카드고르기 = (c: 찾은카드) => {
    set고른것(c);
    등급표받기(c.tcgPlayerId, 판);
  };

  const 기관들 = 자료 ? 기관순서.filter((g) => 자료.byGrader[g]) : [];
  // 문서에 없는 기관이 오면 뒤에 붙인다(빠뜨리는 것보다 낫다).
  const 나머지기관 = 자료 ? Object.keys(자료.byGrader).filter((g) => !기관순서.includes(g)) : [];
  const 볼기관 = [...기관들, ...나머지기관];
  // 실제로 값이 있는 등급만 줄로 만든다. 20여 칸이 다 뜨면 빈칸이 표를 뒤덮는다.
  const 쓸등급 = 자료
    ? 등급순서.filter((k) => 볼기관.some((g) => (자료.byGrader[g]?.g[k] ?? 0) > 0))
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg font-bold text-black">팝수 조회</h1>
      <p className="mt-1 text-sm text-neutral-500">
        감정 기관이 이 카드에 매긴 등급이 각각 몇 장인지 전부 보여 드립니다. 10등급이 적을수록 구하기 어려운 카드입니다.
      </p>

      <form onSubmit={찾기} className="mt-4 flex flex-wrap gap-2">
        <div className="flex overflow-hidden rounded-lg border border-neutral-300">
          {(['japanese', 'english'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set판(p)}
              className={`px-3 py-2 text-sm font-semibold ${
                판 === p ? 'bg-black text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {p === 'japanese' ? '일본판' : '북미판'}
            </button>
          ))}
        </div>
        <input
          value={말}
          onChange={(e) => set말(e.target.value)}
          onFocus={() => warmNameDict()}
          placeholder="카드 이름. 예: 리자몽, Charizard"
          aria-label="카드 이름으로 찾기"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={찾는중 || 말.trim().length < 2}
          className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          {찾는중 ? '찾는 중…' : '찾기'}
        </button>
      </form>

      {오류 && <p className="mt-3 text-sm text-amber-600">{오류}</p>}

      {결과 && !고른것 && (
        <div className="mt-4">
          {결과.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-400">'{말.trim()}'로 찾은 카드가 없습니다.</p>
          ) : (
            <>
            {/* ⚠️ 저쪽이 한 번에 주는 최대치(200장)에 걸리면 **그게 전부가 아니다.**
                값이 높은 순으로 받으므로 잘린 쪽은 싼 카드다. "N장을 찾았습니다"라고만
                적으면 그게 전종인 줄 알게 된다(2026-08-07 점검에서 확인 — 피카츄가
                딱 100장으로 잘려 있었다). */}
            <p className="mb-1.5 text-xs text-neutral-500">
              {잘림
                ? `이름에 맞는 카드가 많아 값이 높은 ${결과.length}장만 보여 드립니다. 이름을 더 자세히 치면 좁혀집니다.`
                : `카드 ${결과.length}장을 찾았습니다. 누르면 등급표를 봅니다.`}
            </p>
            <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
              {결과.map((c) => (
                <li key={c.tcgPlayerId}>
                  <button
                    type="button"
                    onClick={() => 카드고르기(c)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-neutral-50"
                  >
                    <div className="h-12 w-9 flex-shrink-0 overflow-hidden rounded bg-neutral-100">
                      {c.imageUrl && <CardImg src={c.imageUrl} alt={c.name} className="h-full w-full object-contain" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-800">{보일이름(판, c.name)}</p>
                      <p className="truncate text-[11px] text-neutral-400">
                        {세트한글.get(c.setName) ?? c.setName}
                        {c.cardNumber ? ` · ${c.cardNumber}` : ''}
                        {c.rarity ? ` · ${c.rarity}` : ''}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
      )}

      {고른것 && (
        <button
          type="button"
          onClick={() => {
            set고른것(null);
            set자료(null);
          }}
          className="mt-4 text-sm font-semibold text-neutral-500 hover:text-neutral-800"
        >
          ← 찾은 목록으로
        </button>
      )}

      {(고른것 || 처음카드) && (
        <div className="mt-3">
          {고른것 && (
            <div className="mb-3 flex items-center gap-3">
              <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-neutral-100">
                {고른것.imageUrl && (
                  <CardImg src={고른것.imageUrl} alt={고른것.name} className="h-full w-full object-contain" lazy={false} />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-black">{보일이름(판, 고른것.name)}</p>
                <p className="truncate text-xs text-neutral-400">
                  {세트한글.get(고른것.setName) ?? 고른것.setName}
                  {고른것.cardNumber ? ` · ${고른것.cardNumber}` : ''}
                </p>
              </div>
            </div>
          )}

          {자료받는중 && <p className="py-10 text-center text-sm text-neutral-400">등급표를 불러오는 중…</p>}

          {!자료받는중 && !자료 && (
            <p className="py-10 text-center text-sm text-neutral-400">
              이 카드는 감정 기록이 없습니다. 아직 아무도 감정을 안 맡겼거나, 자료에 안 잡힌 카드입니다.
            </p>
          )}

          {자료 && (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-neutral-200 px-4 py-3">
                <div>
                  <span className="text-xs text-neutral-500">전체 </span>
                  <span className="text-base font-bold text-black">{자료.all.toLocaleString()}장</span>
                </div>
                {자료.gems != null && (
                  <div>
                    <span className="text-xs text-neutral-500">10등급 </span>
                    <span className="text-base font-bold text-black">{자료.gems.toLocaleString()}장</span>
                    <span className="ml-1 text-xs text-neutral-400">
                      ({Math.round((자료.gems / 자료.all) * 1000) / 10}%)
                    </span>
                  </div>
                )}
              </div>

              {/* 표가 좁은 화면에서 넘칠 수 있어 가로로만 밀리게 한다(본문은 안 밀린다). */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[320px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-neutral-500">
                      <th className="py-2 pr-2 text-left text-xs font-semibold">등급</th>
                      {볼기관.map((g) => (
                        <th key={g} className="px-2 py-2 text-right text-xs font-semibold">
                          {g}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {쓸등급.map((k) => {
                      const 최고 = k === 'g10' || k === 'pristine' || k === 'perfect';
                      return (
                        <tr key={k} className="border-b border-neutral-50">
                          <td className={`py-1.5 pr-2 text-left ${최고 ? 'font-bold text-black' : 'text-neutral-600'}`}>
                            {등급이름(k)}
                          </td>
                          {볼기관.map((g) => {
                            const n = 자료.byGrader[g]?.g[k] ?? 0;
                            return (
                              <td
                                key={g}
                                className={`px-2 py-1.5 text-right tabular-nums ${
                                  n === 0 ? 'text-neutral-300' : 최고 ? 'font-bold text-black' : 'text-neutral-700'
                                }`}
                              >
                                {n === 0 ? '—' : n.toLocaleString()}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-neutral-300">
                      <td className="py-2 pr-2 text-left text-xs font-semibold text-neutral-500">합계</td>
                      {볼기관.map((g) => (
                        <td key={g} className="px-2 py-2 text-right text-sm font-bold tabular-nums text-black">
                          {(자료.byGrader[g]?.total ?? 0).toLocaleString()}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-1 pr-2 text-left text-xs text-neutral-500">10등급 비율</td>
                      {볼기관.map((g) => (
                        <td key={g} className="px-2 py-1 text-right text-xs tabular-nums text-neutral-500">
                          {자료.byGrader[g]?.gem != null ? `${자료.byGrader[g].gem}%` : '—'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-[11px] leading-snug text-neutral-400">
                PSA·BGS·CGC·SGC가 지금까지 매긴 등급의 장수입니다. 반칸(9.5 등)은 BGS·CGC가 씁니다.
                “진품만”은 등급 없이 진품 확인만 받은 것, “조건부”는 흠이 적혀 등급이 따로 표시된 것입니다.
                {자료.updatedAt ? ` 자료 기준 ${자료.updatedAt.slice(0, 10)}.` : ''}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
