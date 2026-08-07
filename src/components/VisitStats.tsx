import { useEffect, useState } from 'react';
import {
  fetchEventStats,
  fetchVisitStats,
  type VisitStatsResponse,
  type ArtistStat,
  type EventDayBuckets,
  type VisitStat,
} from '../api/localStats';
import { kstDateStr } from '../lib/kstDay';

// 화면에 보여줄 최근 일수. 그보다 오래된 날은 합계에만 들어간다.
const RECENT_DAYS = 30;

function formatDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}.${d.getDate()}(${wd})`;
}

// 서버가 한국시간(KST) 기준으로 날짜 칸을 만들므로 여기도 똑같이 맞춘다. UTC로 하면
// 아침 9시 전에는 "오늘"이 서버의 어제를 가리켜 숫자가 어긋난다.
function dayKey(offset: number): string {
  return kstDateStr(Date.now() - offset * 24 * 60 * 60 * 1000);
}

// 기능 사용 표에 보여줄 항목과 순서.
// hint는 "무슨 행동일 때 1 올라가는지". 나중에 숫자를 해석할 때 기준을 몰라
// 다시 코드를 뒤지는 일이 없도록 화면에 같이 적어둔다.
// group이 붙은 줄은 숫자 없는 소제목이다. 그냥 `└`만 붙이면 바로 위 줄에 딸린 것처럼
// 보이는데, 검색 확정 경로 다섯은 위의 검색 세 줄을 통째로 쪼갠 것이라 오해를 부른다
// (2026-08-04 통계 점검에서 확인).
const EVENT_ROWS: { key: string; label: string; hint: string; group?: true }[] = [
  { key: 'snkrdunk_search', label: '스니커덩크 검색', hint: '검색 실행(자동완성 선택 포함)' },
  { key: 'ebay_search', label: '이베이 검색(북미/일본판)', hint: '이베이 소스로 검색 실행' },
  { key: 'ebay_korean', label: '이베이 한글판 조회', hint: '판 토글에서 한글판 조회' },
  { key: 'tcgplayer', label: 'TCGplayer 조회', hint: '카드 상세에서 TCGplayer 시세 열람' },
  { key: 'scan', label: '사진 검색', hint: '사진을 넣어 카드 인식 실행' },
  { key: 'centering', label: '센터링 측정', hint: '사진으로 측정 실행' },
  { key: 'artist', label: '작가별 조회', hint: '작가 한 명을 열 때(누구인지도 아래 순위에 집계)' },
  { key: 'artist_by_pokemon', label: '└ 포켓몬으로 작가 찾기', hint: '작가 화면에서 포켓몬 이름을 쳐서 그린 작가를 찾음' },
  { key: 'home_hit_card', label: '홈 신팩 힛카드 클릭', hint: '홈의 신팩 힛카드에서 카드를 눌러 시세로 감' },
  { key: 'home_hit_set', label: '└ 전체 보기', hint: '그 줄의 "전체 보기"를 눌러 세트 화면으로 감' },
  { key: 'pokedex', label: '포켓몬·트레이너별 카드', hint: '이름 하나를 열어 그 카드를 발매 순으로 볼 때(무엇을 열었는지도 아래 순위에 집계)' },
  { key: 'centering_open', label: '센터링 — 화면 열기', hint: '센터링 화면에 들어온 횟수. 아래 "센터링 측정"은 사진을 실제로 올린 횟수라, 둘 차이가 크면 사진 올리기가 번거로운 것입니다' },
  { key: 'card_found', label: '카드 한 장 시세 찾음', hint: '도감·세트·작가에서 카드를 눌러 값을 찾았을 때. 어느 마켓에서 찾았는지가 아래 순위에 집계' },
  { key: 'card_miss', label: '카드 한 장 시세 못 찾음', hint: '어느 마켓에도 값이 없던 카드. 여기 자주 오르는 카드는 손볼 곳이 있다는 뜻' },
  { key: 'population_search', label: '팝수 조회 — 카드 찾기', hint: '팝수 조회 화면에서 카드를 찾은 횟수' },
  { key: 'population_detail', label: '팝수 조회 — 등급표 봄', hint: '등급표(감정기관별 전 등급)를 실제로 연 횟수. 여기가 낮으면 요약만으로 충분하다는 뜻' },
  { key: 'population', label: '감정 수량 보임', hint: '카드 화면에 "PSA 10 몇 장"이 실제로 뜬 횟수. 미감정 시세가 싸도 감정품은 비싼 카드를 알아보게 해 준다' },
  { key: 'sets', label: '세트별 목록 조회', hint: '세트 하나를 열 때(어느 세트인지도 아래 순위에 집계)' },
  { key: 'series', label: '시리즈 목록 조회', hint: '검색으로 시리즈 주소(/series/…)에 바로 들어올 때' },
  { key: 'packsim', label: '오늘의 상점', hint: '팩·박스 구매와 개봉' },
  { key: 'packsim_banner', label: '뽑기 결과 줄 클릭', hint: '홈의 "이런 게 나왔습니다" 줄을 눌러 상점으로 들어옴' },
  { key: 'packsim_checkin', label: '개봉 출석', hint: '출석 보상 받기' },
  { key: 'packsim_godpack', label: '갓팩', hint: '전부 AR 이상으로 나온 팩' },
  { key: 'packsim_value', label: '앨범 시세', hint: '앨범 탭에서 예상 가치 조회' },
  { key: 'packsim_share', label: '개봉 자랑', hint: '팩 결과를 커뮤니티에 공유' },
  { key: 'share', label: '카드 공유', hint: '카드 상세에서 공유 버튼을 누를 때' },
  { key: 'scantest', label: '스캔 테스트', hint: '실험실에서 사진 넣기(운영자 전용이라 지금은 늘 0)' },
  {
    key: '_search_group',
    label: '검색어를 어떻게 확정했나',
    hint: '위 검색 세 줄(스니커덩크·이베이·TCGplayer)을 다시 나눈 것입니다. 합계가 같아야 정상입니다.',
    group: true,
  },
  { key: 'search_scan', label: '└ 사진으로 찾아서', hint: '사진으로 카드를 찾아 그 검색어가 인기 검색어에 반영됨' },
  { key: 'search_pick', label: '└ 자동완성에서 골라서', hint: '자동완성 목록에서 고른 검색어' },
  { key: 'search_popular', label: '└ 인기 검색어를 눌러서', hint: '인기 검색어 목록을 눌러 검색' },
  { key: 'search_enter', label: '└ 엔터를 눌러서', hint: '엔터(폰 키보드의 "검색")로 확정' },
  { key: 'search_typed', label: '└ 그냥 치다 멈춰서', hint: '확정 없이 1.5초 멈춰 집계된 것. 이 비중이 낮으면 그 경로를 떼도 된다' },
];

// 조회 순위 목록(작가별·세트별 공용): 상위 5개만 보여주고 "더보기"로 5개씩 늘린다.
function RankList({ items, emptyText }: { items: { name: string; count: number }[]; emptyText: string }) {
  const [shown, setShown] = useState(5);
  if (items.length === 0) {
    return (
      <p className="text-sm text-neutral-400 py-6 text-center rounded-xl border border-dashed border-neutral-200">
        {emptyText}
      </p>
    );
  }
  const max = Math.max(1, ...items.map((a) => a.count));
  return (
    <>
      <ol className="space-y-1.5">
        {items.slice(0, shown).map((a, i) => (
          <li key={a.name} className="flex items-center gap-2">
            <span className="w-6 flex-shrink-0 text-right text-xs font-semibold text-neutral-400">{i + 1}</span>
            <span className="w-40 flex-shrink-0 truncate text-xs text-neutral-700">{a.name}</span>
            <div className="h-5 flex-1 rounded bg-neutral-100">
              <div className="h-5 rounded bg-[#2a78d6]" style={{ width: `${Math.max(2, (a.count / max) * 100)}%` }} />
            </div>
            <span className="w-10 flex-shrink-0 text-right text-xs font-semibold text-neutral-700">
              {a.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>
      {shown < items.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + 5)}
          className="mt-2 w-full rounded-lg border border-neutral-200 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          {Math.min(5, items.length - shown)}개 더보기 ({shown}/{items.length})
        </button>
      )}
    </>
  );
}

// 가로 막대 목록(방문·검색 공용).
function BarList({ items, max }: { items: { date: string; count: number }[]; max: number }) {
  return (
    <ul className="space-y-1.5">
      {items.map((d) => (
        <li key={d.date} className="flex items-center gap-2">
          <span className="w-16 flex-shrink-0 text-xs text-neutral-500">{formatDay(d.date)}</span>
          <div className="h-5 flex-1 rounded bg-neutral-100">
            <div className="h-5 rounded bg-[#2a78d6]" style={{ width: `${Math.max(2, (d.count / max) * 100)}%` }} />
          </div>
          <span className="w-10 flex-shrink-0 text-right text-xs font-semibold text-neutral-700">
            {d.count.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function VisitStats() {
  const [items, setItems] = useState<VisitStat[]>([]);
  const [total, setTotal] = useState(0);
  const [memberCount, setMemberCount] = useState(0);
  const [credits, setCredits] = useState<VisitStatsResponse['credits']>(undefined);
  const [events, setEvents] = useState<EventDayBuckets>({});
  const [artists, setArtists] = useState<ArtistStat[]>([]);
  const [sets, setSets] = useState<ArtistStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchVisitStats()
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setMemberCount(r.memberCount);
        setCredits(r.credits);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // 기능 통계는 별도 — 실패해도 방문 통계는 보이게 둔다.
    fetchEventStats()
      .then((r) => {
        setEvents(r.days);
        setArtists(r.artists);
        setSets(r.sets);
      })
      .catch(() => undefined);
  }, []);

  if (loading) return <p className="text-sm text-neutral-400 py-12 text-center">불러오는 중...</p>;
  if (error) return <p className="text-sm text-neutral-400 py-12 text-center">방문 통계를 불러오지 못했습니다.</p>;

  // ── 방문 ──
  const recent = items.slice(-RECENT_DAYS).reverse();
  const max = Math.max(1, ...recent.map((d) => d.count));
  const today = dayKey(0);
  const todayCount = items.find((d) => d.date === today)?.count ?? 0;
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayKey(i)));
  const weekCount = items.filter((d) => week.has(d.date)).reduce((a, b) => a + b.count, 0);

  // ── 기능 사용: 오늘 / 최근 7일 / 전체 ──
  const evToday: Record<string, number> = { ...(events[today] ?? {}) };
  const evWeek: Record<string, number> = {};
  const evTotal: Record<string, number> = {};
  for (const [day, counts] of Object.entries(events)) {
    for (const [ev, n] of Object.entries(counts)) {
      evTotal[ev] = (evTotal[ev] ?? 0) + (n ?? 0);
      if (week.has(day)) evWeek[ev] = (evWeek[ev] ?? 0) + (n ?? 0);
    }
  }

  // ── 시세 조회 크레딧 ──
  // 이게 0이 되면 방문자에게 이베이·TCGplayer 시세가 통째로 안 보인다. 전에는 서버
  // 로그를 봐야 알 수 있어서 바닥난 걸 한참 뒤에 알았다(2026-08-03).
  const cr = credits;
  const crLeft = cr?.left ?? null;
  const crPct = cr && crLeft !== null ? Math.round((crLeft / cr.daily) * 100) : null;
  const crTone =
    crLeft === null ? 'text-neutral-400'
      : crLeft <= 0 ? 'text-rose-600'
        : crLeft < (cr?.keepForVisitors ?? 8000) ? 'text-amber-600'
          : 'text-black';

  return (
    <div>
      <h2 className="text-base font-bold text-black mb-4">방문 통계</h2>

      {cr && (
        <div className="mb-6 rounded-xl border border-neutral-200 p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-xs text-neutral-500">오늘 남은 시세 조회 크레딧</p>
            <p className="text-[11px] text-neutral-400">
              {new Date(cr.resetAt).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' })}에 다시 찹니다
            </p>
          </div>
          <p className={`mt-1 text-2xl font-bold ${crTone}`}>
            {crLeft === null ? '아직 모름' : crLeft.toLocaleString()}
            <span className="ml-1 text-sm font-normal text-neutral-400">/ {cr.daily.toLocaleString()}</span>
          </p>
          {crPct !== null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full ${(crLeft ?? 0) <= 0 ? 'bg-rose-500' : (crLeft ?? 0) < cr.keepForVisitors ? 'bg-amber-500' : 'bg-black'}`}
                style={{ width: `${Math.max(0, Math.min(100, crPct))}%` }}
              />
            </div>
          )}
          <p className="mt-2 text-xs text-neutral-500">
            세트 시세 채우기에 오늘 {cr.fillSpent.toLocaleString()} / {cr.fillBudget.toLocaleString()} 썼습니다 ·
            방문자 몫 {cr.keepForVisitors.toLocaleString()}은 채우기가 건드리지 않습니다
          </p>
          {/* ⚠️ 남은 숫자만 믿으면 안 된다. 그 값은 우리 서버가 마지막으로 PPT를 부른
              때의 것이라, 밖에서 크레딧을 쓰면 남았다고 적힌 채로 조회가 막힌다
              (2026-08-07에 실제로 그랬다). "다 썼다"는 429를 받아 본 dailyOut이 정확하다. */}
          {(cr.dailyOut || (crLeft !== null && crLeft <= 0)) && (
            <p className="mt-2 text-xs text-rose-600">
              다 썼습니다. 방문자에게는 사흘 안에 받아 둔 시세를 대신 보여줍니다.
              {cr.dailyOut && crLeft !== null && crLeft > 0 && (
                <> 위 숫자({crLeft.toLocaleString()})는 마지막으로 확인한 값이라 실제와 다릅니다.</>
              )}
            </p>
          )}
          {cr.blocked && !cr.dailyOut && crLeft !== null && crLeft > 0 && (
            <p className="mt-2 text-xs text-amber-600">지금 잠시 쉬는 중입니다(분당 한도).</p>
          )}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-xs text-neutral-500">오늘 방문</p>
          <p className="text-2xl font-bold text-black mt-1">{todayCount.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-xs text-neutral-500">최근 7일</p>
          <p className="text-2xl font-bold text-black mt-1">{weekCount.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-xs text-neutral-500">전체 누적</p>
          <p className="text-2xl font-bold text-black mt-1">{total.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4">
          <p className="text-xs text-neutral-500">가입 회원</p>
          <p className="text-2xl font-bold text-black mt-1">{memberCount.toLocaleString()}</p>
        </div>
      </div>

      {recent.length === 0 ? (
        <p className="text-sm text-neutral-400 py-8 text-center rounded-xl border border-dashed border-neutral-200">
          아직 방문 기록이 없습니다.
        </p>
      ) : (
        <BarList items={recent} max={max} />
      )}

      <p className="mt-4 text-xs text-neutral-400">
        같은 브라우저는 하루 한 번만 집계됩니다. IP·기기·회원 정보는 저장하지 않습니다.
      </p>

      <h2 className="text-base font-bold text-black mt-8 mb-1">기능 사용</h2>
      <p className="text-xs text-neutral-400 mb-4">기능별 사용 횟수만 셉니다. 누가 썼는지·개인정보는 남기지 않습니다.</p>
      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-xs text-neutral-500">
              <th className="px-4 py-2.5 text-left font-semibold">기능</th>
              <th className="px-4 py-2.5 text-right font-semibold">오늘</th>
              <th className="px-4 py-2.5 text-right font-semibold">최근 7일</th>
              <th className="px-4 py-2.5 text-right font-semibold">전체</th>
            </tr>
          </thead>
          <tbody>
            {EVENT_ROWS.map((row) =>
              row.group ? (
                <tr key={row.key} className="border-b border-neutral-100 bg-neutral-50">
                  <td className="px-4 py-2" colSpan={4}>
                    <span className="text-xs font-bold text-neutral-600">{row.label}</span>
                    <span className="block text-[11px] font-normal text-neutral-400">{row.hint}</span>
                  </td>
                </tr>
              ) : (
                <tr key={row.key} className="border-b border-neutral-50 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-neutral-700">{row.label}</span>
                    <span className="block text-[11px] font-normal text-neutral-400">{row.hint}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-black">{(evToday[row.key] ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-black">{(evWeek[row.key] ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-black">{(evTotal[row.key] ?? 0).toLocaleString()}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        전체에는 날짜별 집계를 시작하기 전의 누적치도 포함됩니다.
      </p>

      <h2 className="text-base font-bold text-black mt-8 mb-1">작가별 조회 순위</h2>
      <p className="text-xs text-neutral-400 mb-4">일러스트레이터를 눌러 카드 목록을 연 횟수입니다. 많이 본 순.</p>
      <RankList items={artists} emptyText="아직 작가 조회 기록이 없습니다." />

      <h2 className="text-base font-bold text-black mt-8 mb-1">세트별 조회 순위</h2>
      <p className="text-xs text-neutral-400 mb-4">세트별 목록에서 세트를 눌러 수록 카드를 연 횟수입니다. 많이 본 순.</p>
      <RankList items={sets} emptyText="아직 세트 조회 기록이 없습니다." />
    </div>
  );
}
