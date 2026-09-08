import { useEffect, useState } from 'react';
import { CardImg } from './CardImg';
import { EbayCardDetail } from './EbayCardDetail';
import { EbayCardTile } from './EbayCardTile';
import { DetailSheet } from './DetailSheet';
import type { EbayCard } from '../api/ebayPrices';

// 【이베이 검수】 운영자 전용. 새 판정기로 다시 분류한 카드를 보는 자리인데, 보기가 둘이다.
//
// ① **실제 모습**(기본) — 배포하면 사용자에게 보일 **그대로**(사장님 지시 2026-08-20:
//    「실제랑 똑같은 환경으로」). 실서비스 이베이 검색과 같은 구성 — 검색바만 있고,
//    검색해야 결과가 나오고, 타일도 상세도 실서비스 부품(EbayCardTile·EbayCardDetail)
//    그대로다. 받음/든/뺀 같은 검수 정보는 하나도 안 보인다.
// ② **검수** — 검수한 카드 전부를 성적표(받음/든/뺀)와 함께 늘어놓고, 낱개를 펼치면
//    뺀 낙찰까지 전부 취소선+까닭으로 나온다. 낱개 메모칸도 여기만 있다.
//
// ⚠️⚠️ **여기 뜨는 것은 검수 저장소(`/data/ebay-check/`)뿐이다.** 실제 사용자 화면과
//    완전히 분리돼 있어서, 검사를 통과하기 전에는 방문자에게 아무것도 안 나간다.

type 줄 = {
  id: string;
  name: string;
  no: string;
  setEn: string;
  img: string;
  at: number;
  판?: 'japanese' | 'english' | 'other';
  요약: { 받음: number; 든수: number; 뺀수: number; 애매수: number };
};

export function EbayCheckView() {
  // 보기 두 갈래 — 「실제 모습」이 기본(사장님이 보러 오는 것이 그것이라서).
  const [보기, set보기] = useState<'실제' | '검수'>('실제');
  const [목록, set목록] = useState<줄[] | null>(null);
  const [고른것, set고른것] = useState<string | null>(null);
  // 실제 시세 화면의 판 토글과 같은 것 + 「기타 언어판」(사장님 지시 2026-08-19).
  const [판탭, set판탭] = useState<'japanese' | 'english' | 'other'>('english');
  // 검색바(사장님 지시 2026-08-20) — 실제 모습에서는 이게 유일한 입구다(실서비스와 같게).
  const [검색어, set검색어] = useState('');
  // 실제 모습의 검색 결과 — 서버가 실서비스 부품이 그대로 그릴 수 있는 카드 통째로 준다.
  const [결과, set결과] = useState<{ rows: (EbayCard & { 판?: string })[]; 총수: number } | null>(null);
  const [찾는중, set찾는중] = useState(false);
  const [카드, set카드] = useState<(EbayCard & { 요약?: 줄['요약']; 검사시각?: number }) | null>(null);
  const [오류, set오류] = useState('');
  // 승격 진행 상황 — 단추를 누르면 서버가 배경에서 굽고, 2초마다 들여다본다.
  const [승격, set승격] = useState<{ 돌고있나?: boolean; 함?: number; 전체?: number; 오류?: string } | null>(null);

  const 승격실행 = async () => {
    if (!window.confirm('검수 자료 전체를 실제 화면 저장소로 굽습니다(사용자 화면 값이 바뀝니다). 진행할까요?')) return;
    try {
      const r = await fetch('/api/local/ebay-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 씨앗덮기: 배포 이미지에 실린 검수 자료로 갈아 끼우고 굽는다 — 「검수한 대로 내보내기」.
        body: JSON.stringify({ 승격: 1, 씨앗덮기: 1 }),
      });
      if (!r.ok) {
        set승격({ 오류: `실행 실패(${r.status})` });
        return;
      }
      set승격(await r.json());
      const 재기 = setInterval(async () => {
        try {
          // ⚠️ 한글 매개변수는 미리 인코딩한다 — 날것으로 보내면 개발 서버가 빈 답을 준다(실측).
          const s = await (await fetch(`/api/local/ebay-check?${encodeURIComponent('승격')}=1`)).json();
          set승격(s);
          if (s && s.돌고있나 === false) clearInterval(재기);
        } catch {
          /* 다음 틱에 다시 */
        }
      }, 2000);
    } catch {
      set승격({ 오류: '실행 실패(연결)' });
    }
  };

  // 그림 예열 — 전 카드 그림(5만 5천 장)을 서버가 미리 받아 디스크에 담는다(사장님 지시 2026-08-21
  // 「언제 사라질지 모르니 다 저장」). 3~4시간 걸리고, 다시 누르면 새로 생긴 것만 받는다.
  const [예열, set예열] = useState<{ 돌고있나?: boolean; 함?: number; 건너뜀?: number; 실패?: number; 전체?: number; 오류?: string } | null>(null);
  const 예열실행 = async () => {
    if (!window.confirm('도감의 모든 카드 그림을 서버에 미리 저장합니다(3~4시간, 크레딧 0). 진행할까요?')) return;
    try {
      const r = await fetch('/api/local/ebay-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 예열: 1 }),
      });
      if (!r.ok) { set예열({ 오류: `실행 실패(${r.status})` }); return; }
      set예열(await r.json());
      const 재기 = setInterval(async () => {
        try {
          const s = await (await fetch(`/api/local/ebay-check?${encodeURIComponent('예열')}=1`)).json();
          set예열(s);
          if (s && s.돌고있나 === false) clearInterval(재기);
        } catch { /* 다음 틱 */ }
      }, 3000);
    } catch {
      set예열({ 오류: '실행 실패(연결)' });
    }
  };

  // ⚠️ 화면을 떠났다 돌아오면 진행 숫자가 사라진다 — 숫자는 이 화면의 기억일 뿐이고 서버는
  //    계속 돈다(사장님 질문 2026-08-22 「초기화된 거야?」). 열릴 때 서버에 물어 돌고 있으면
  //    숫자를 되살리고 다시 3초마다 들여다본다. 승격·예열 둘 다.
  useEffect(() => {
    let 멈춤 = false;
    const 살피기 = async () => {
      for (const [이름, 적기] of [['승격', set승격], ['예열', set예열]] as const) {
        try {
          const s = await (await fetch(`/api/local/ebay-check?${encodeURIComponent(이름)}=1`)).json();
          // 돌고 있든 막 끝났든 서버 말이 맞다(끝난 결과도 보여 준다). 한 번도 안 돈 것({아직})만 건너뜀.
          if (!멈춤 && s && typeof s.돌고있나 === 'boolean') 적기(s);
        } catch { /* 다음에 */ }
      }
    };
    void 살피기();
    const 재기 = setInterval(살피기, 3000);
    return () => { 멈춤 = true; clearInterval(재기); };
  }, []);

  // 검수 보기용 전체 목록 — 실제 모습만 쓸 때는 없어도 되지만, 보기 전환이 잦아 미리 받는다.
  useEffect(() => {
    fetch('/api/local/ebay-check')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => set목록(j.rows ?? []))
      .catch(() => set오류('목록을 못 불러왔습니다'));
  }, []);

  // 실제 모습의 검색 — 타자를 멈추고 300ms 뒤에 묻는다(글자마다 2만 파일을 읽지 않게).
  useEffect(() => {
    if (보기 !== '실제') return;
    const 소 = 검색어.trim();
    if (!소) {
      set결과(null);
      return;
    }
    set찾는중(true);
    const t = setTimeout(() => {
      fetch(`/api/local/ebay-check?q=${encodeURIComponent(소)}&pan=${판탭}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => {
          set결과(j);
          set찾는중(false);
        })
        .catch(() => {
          set오류('검색을 못 했습니다');
          set찾는중(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [보기, 검색어, 판탭]);

  useEffect(() => {
    if (!고른것) return;
    set카드(null);
    fetch(`/api/local/ebay-check?id=${encodeURIComponent(고른것)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(set카드)
      .catch(() => set오류('카드를 못 불러왔습니다'));
  }, [고른것]);

  if (오류) return <p className="py-10 text-center text-sm text-rose-600">{오류}</p>;

  const 상세 =
    고른것 == null ? null : !카드 ? (
      <p className="py-6 text-center text-sm text-neutral-500">불러오는 중…</p>
    ) : (
      <div>
        {/* 받음/든/뺀 성적표는 검수 볼 때만 — 실제 화면에는 안 나가는 정보다(사장님 확인 2026-08-20). */}
        {보기 === '검수' && 카드.요약 && (
          <p className="mb-2 rounded-lg bg-neutral-100 px-3 py-2 text-[11px] text-neutral-600">
            받은 낙찰 {카드.요약.받음}건 → 셈에 든 것 {카드.요약.든수}건 · 뺀 것 {카드.요약.뺀수}건 · 확인 대기{' '}
            {카드.요약.애매수}건
          </p>
        )}
        <EbayCardDetail card={카드} 검수={보기 === '검수'} />
      </div>
    );

  // 판 토글 — 실제 시세 화면과 같은 둥근 알약. 두 보기가 같이 쓴다.
  const 판토글 = (
    <div className="inline-flex rounded-full border border-neutral-300 p-1">
      {([
        ['japanese', '일본어판'],
        ['english', '영문판'],
        ['other', '기타 언어판'],
      ] as const).map(([v, 이름]) => (
        <button
          key={v}
          type="button"
          onClick={() => {
            set판탭(v);
            set고른것(null);
          }}
          className={`rounded-full px-3.5 py-2 text-xs font-semibold ${
            판탭 === v ? 'bg-black text-white' : 'text-neutral-600'
          }`}
        >
          {이름}
        </button>
      ))}
    </div>
  );

  // ── 실제 모습 — 실서비스 이베이 검색 화면과 같은 구성·같은 부품·같은 문구 ──────────
  const 실제본문 = (
    <div className="space-y-4">
      <input
        type="text"
        value={검색어}
        onChange={(e) => set검색어(e.target.value)}
        placeholder="카드 이름 검색"
        className="w-full max-w-md rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
      />
      <div>{판토글}</div>
      {/* 검색 전에는 검색바만 — 실서비스가 그렇다(사장님 확인 2026-08-20: 「검색바만 있는거 맞지?」). */}
      {검색어.trim() && (
        <>
          <p className="text-sm text-neutral-500">
            {찾는중 || !결과 ? '찾는 중...' : `우리 도감에서 ${결과.총수.toLocaleString()}장 찾았습니다.`}
          </p>
          {!찾는중 && 결과 && 결과.rows.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-neutral-500">우리 도감에 그 이름의 카드가 없습니다.</p>
              <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-neutral-400">
                {/* ⚠️ 마디로 묶는다 — 안 묶으면 좁은 화면에서 괄호 안이 갈린다. */}
                <span className="inline-block">카드 이름의 일부만 쳐 보시거나,</span>{' '}
                <span className="inline-block">위에서 판(일본어판·영문판)을 바꿔 보세요.</span>
              </p>
            </div>
          )}
          {!찾는중 && 결과 && 결과.rows.length > 0 && (
            <>
              {/* 실서비스와 같은 격자·같은 타일. 비교 담기(⇄)만 없다 — 비교표는 App 쪽 배선이라
                  여기 붙이면 눌러도 아무 일도 안 나는 가짜 단추가 된다. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {결과.rows.map((c) => (
                  <EbayCardTile key={c.tcgPlayerId} card={c} selected={고른것 === c.tcgPlayerId} onSelect={set고른것} />
                ))}
              </div>
              {결과.총수 > 결과.rows.length && (
                <p className="mt-4 rounded-lg bg-neutral-50 px-3 py-3 text-center text-xs leading-relaxed text-neutral-500">
                  걸린 카드가 너무 많아 {결과.rows.length.toLocaleString()}장까지만 보여 드립니다. 카드 이름을 더
                  붙이면 원하는 카드가 나옵니다.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );

  // ── 검수 — 검수한 카드 전부 + 성적표 ────────────────────────────────────────────
  const 검수본문 = (
    <div className="space-y-4">
      <input
        type="text"
        value={검색어}
        onChange={(e) => set검색어(e.target.value)}
        placeholder="카드 이름 검색"
        className="w-full max-w-md rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
      />
      <div>{판토글}</div>
      {목록 === null && <p className="py-8 text-center text-sm text-neutral-500">불러오는 중…</p>}
      {목록 !== null && 목록.length === 0 && (
        <p className="py-8 text-center text-sm text-neutral-500">아직 검수한 카드가 없습니다.</p>
      )}
      {목록 !== null &&
        (() => {
          const 소 = 검색어.trim().toLowerCase();
          const 걸러진 = 목록.filter(
            (c) =>
              (c.판 ?? 'english') === 판탭 &&
              (!소 || `${c.name} ${c.no} ${c.setEn} ${c.id}`.toLowerCase().includes(소)),
          );
          return (
            <>
              {목록.length > 0 && 걸러진.length === 0 && (
                <p className="py-8 text-center text-sm text-neutral-500">
                  {소 ? '검색과 맞는 카드가 없습니다.' : '이 판에는 검수한 카드가 없습니다.'}
                </p>
              )}
              {/* ⚠️ 전종을 돌리면 2만 장이다 — 다 그리면 브라우저가 멎는다. 60장까지만 그리고
                  나머지는 검색으로 좁히게 한다. */}
              {걸러진.length > 60 && (
                <p className="text-xs text-neutral-500">
                  {걸러진.length.toLocaleString()}장 중 앞 60장만 보입니다 — 검색으로 좁혀 주세요.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {걸러진.slice(0, 60).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => set고른것(c.id)}
                    className={`rounded-xl border p-2 text-left transition ${
                      고른것 === c.id
                        ? 'border-neutral-900 ring-1 ring-neutral-900'
                        : 'border-neutral-200 hover:border-neutral-400'
                    }`}
                  >
                    <CardImg src={c.img} alt={c.name} className="mx-auto h-32 w-auto rounded object-contain" />
                    <p className="mt-2 truncate text-xs font-semibold">{c.name}</p>
                    <p className="truncate text-[10px] text-neutral-500">
                      {/* ⚠️ 판 표기는 뺐다(사장님 지시 2026-08-20: 「어차피 토글에서 분리해서
                          검색하는데 당연히 토글쪽 언어겠지」) — 판 토글이 생겨 겹말이 됐다. */}
                      {c.setEn} · {c.no}
                    </p>
                    {/* 한눈 요약 — 몇 건을 받아서 몇 건이 들었고 몇 건을 뺐나. 검수의 성적표다. */}
                    <p className="mt-1 text-[10px] text-neutral-600">
                      받음 {c.요약.받음} · <span className="text-emerald-700">든 것 {c.요약.든수}</span> ·{' '}
                      <span className="text-rose-600">뺀 것 {c.요약.뺀수}</span> · 애매 {c.요약.애매수}
                    </p>
                  </button>
                ))}
              </div>
            </>
          );
        })()}
    </div>
  );

  const 본문 = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">이베이 검수</h2>
          <p className="mt-1 text-xs text-neutral-500">
            실제 화면에는 아직 안 나갑니다. <strong>실제 모습</strong>은 배포하면 사용자에게 보일 그대로,{' '}
            <strong>검수</strong>는 성적표와 뺀 낙찰(취소선+까닭)까지 전부입니다.
          </p>
        </div>
        {/* 보기 전환·승격 — 운영자용 손잡이라 실서비스 영역(아래) 밖, 머리글 옆에 둔다. */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full border border-neutral-300 p-0.5">
            {([
              ['실제', '실제 모습'],
              ['검수', '검수'],
            ] as const).map(([v, 이름]) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  set보기(v);
                  set고른것(null);
                }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  보기 === v ? 'bg-black text-white' : 'text-neutral-600'
                }`}
              >
                {이름}
              </button>
            ))}
          </div>
          {/* 승격 — 검수 자료를 실제 화면 저장소로 굽는다. 배포 뒤 여기서 한 번 누른다. */}
          <button
            type="button"
            onClick={승격실행}
            className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
          >
            승격 실행
          </button>
          {승격 && (
            <span className="text-[11px] text-neutral-500">
              {승격.오류
                ? 승격.오류
                : 승격.돌고있나 !== false
                  ? `굽는 중 ${(승격.함 ?? 0).toLocaleString()}/${(승격.전체 ?? 0).toLocaleString()}`
                  : `끝 — ${(승격.함 ?? 0).toLocaleString()}장`}
            </span>
          )}
          {/* 그림 예열 — 전 카드 그림을 서버 디스크에 미리 저장. 신팩 뒤에 한 번씩 다시 누른다. */}
          <button
            type="button"
            onClick={예열실행}
            className="rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
          >
            그림 미리 저장
          </button>
          {예열 && (
            <span className="text-[11px] text-neutral-500">
              {예열.오류
                ? 예열.오류
                : 예열.돌고있나 !== false
                  ? `저장 중 ${((예열.함 ?? 0) + (예열.건너뜀 ?? 0) + (예열.실패 ?? 0)).toLocaleString()}/${(예열.전체 ?? 0).toLocaleString()}`
                  : `끝 — 새로 ${(예열.함 ?? 0).toLocaleString()} · 있던 것 ${(예열.건너뜀 ?? 0).toLocaleString()} · 실패 ${(예열.실패 ?? 0).toLocaleString()}`}
            </span>
          )}
        </div>
      </div>
      {보기 === '실제' ? 실제본문 : 검수본문}
    </div>
  );

  // 실제 시세 화면(DetailLayout)과 같은 틀 — 큰 화면은 오른쪽 2단, 좁은 화면은 아래 시트.
  return (
    <>
      {상세 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">{본문}</div>
          <div className="hidden lg:block">{상세}</div>
        </div>
      ) : (
        본문
      )}
      <DetailSheet open={상세 != null} onClose={() => set고른것(null)}>
        {상세}
      </DetailSheet>
    </>
  );
}
