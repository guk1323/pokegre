import { useCallback, useEffect, useState } from 'react';
import { 까닭모으기, 난이도별모으기, 판별모으기 } from '../lib/battleStats';
import {
  fetchEventStats,
  fetchVisitStats,
  type VisitStatsResponse,
  type ArtistStat,
  type EventDayBuckets,
  type VisitStat,
  type MemberStat,
} from '../api/localStats';
import { kstDateStr } from '../lib/kstDay';
import { StatsCalendar } from './StatsCalendar';

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
const EVENT_ROWS: { key: string; label: string; hint: string; group?: true; dead?: true; 과정?: true }[] = [
  { key: 'snkrdunk_search', label: '스니커덩크 검색', hint: '검색 실행(자동완성 선택 포함)' },
  { key: 'feedback', label: '의견 보내기', hint: '홈 배너에서 의견을 보내기까지 한 횟수. 글 자체는 신고함 화면에 있습니다' },
  { key: 'packsim_log', label: 'GP 내역 열기', hint: '오늘의 상점에서 「내 GP 내역」을 펼친 횟수. 자기 GP가 어디 갔는지 궁금해하는 사람이 얼마나 되는지 봅니다' },
  { key: 'cardboard_search', label: '해외 시세 검색', hint: '해외 시세 탭에서 검색 실행' },
  {
    key: 'cardboard_tcg',
    label: '└ TCGplayer 눈으로 바꿈',
    hint: '해외 시세 안에서 마켓 칩을 TCGplayer로 바꾼 횟수. 검색 자체는 위 줄로만 세므로, 두 마켓 중 어느 쪽을 보는지는 이 줄로만 알 수 있습니다',
  },
  // ⚠️⚠️ 아래 셋은 **더 안 늘어나는 옛 줄**이다(2026-08-10·13에 그 기능을 뗐다).
  //    **자료는 지우지 않는다** — 지우면 그때까지 쌓인 기록이 사라져 옛 길이 얼마나
  //    쓰였는지 되짚을 수가 없다(사장님 지시 2026-08-13). 다만 **화면에서는 감춘다**
  //    (사장님 지시 2026-08-16: "지금 쌓이지 않는 기능은 그냥 보이지않게").
  //    늘 0인 줄이 셋이나 표 위쪽을 먹고 있었다. `dead`가 붙은 줄은 표에서 빠진다.
  { key: 'ebay_search', label: '└ (옛) 이베이 검색', hint: '2026-08-13에 뗀 옛 해외 시세 탭이 세던 것', dead: true },
  { key: 'tcgplayer', label: '└ (옛) TCGplayer 조회', hint: '2026-08-13에 뗀 옛 해외 시세 탭이 세던 것', dead: true },
  { key: 'ebay_korean', label: '└ (옛) 이베이 한글판 조회', hint: '2026-08-10에 뺀 한글판 토글이 세던 것', dead: true },
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
  { key: 'population_miss', label: '팝수 조회 — 자료 없음', hint: '팝수를 열었는데 감정 기록이 없던 카드. 여기 자주 오르는 카드부터 PSA에서 값을 채우면 된다' },
  // ⚠️⚠️ **「감정 수량 보임」(`population`)은 뺐다**(사장님 지시 2026-08-19). 사람이 한
  //    행동이 아니라 **화면이 그려질 때 저절로** 세던 것이라(`GradedPopulation.tsx`),
  //    사실상 「팝수 있는 카드를 열었다」였고 카드 여는 수와 겹쳤다. 32일에 1,734회로
  //    표에서 3등을 차지해 **사람이 실제로 한 일들을 가렸다.**
  //    ⚠️ **바로 아래 `population_detail`은 남긴다** — 사람이 눌러서 등급표를 연 것이라
  //       뜻이 있다(0에 가까우면 그 기능을 접을 근거가 된다).
  //    ⚠️ **쌓인 자료는 안 지웠다.** 서버 허용목록에서도 뺐으므로 이제 더 안 쌓인다.
  { key: 'sets', label: '세트별 목록 조회', hint: '세트 하나를 열 때(어느 세트인지도 아래 순위에 집계)' },
  { key: 'sealed', label: '미개봉 시세 화면 열기', hint: '미개봉 시세 화면(도감▾ → 미개봉)에 들어온 횟수' },
  { key: 'series', label: '시리즈 목록 조회', hint: '검색으로 시리즈 주소(/series/…)에 바로 들어올 때' },
  { key: 'packsim', label: '오늘의 상점', hint: '팩·박스 구매와 개봉' },
  { key: 'packsim_banner', label: '뽑기 결과 줄 클릭', hint: '홈의 "이런 게 나왔습니다" 줄을 눌러 상점으로 들어옴' },
  { key: 'home_box', label: '박스 시세 클릭', hint: '홈의 「최신 발매 박스 시세」에서 박스를 눌러 그 팩 시세를 본 횟수' },
  { key: 'home_notice', label: '홈 공지 클릭', hint: '홈 맨 위 공지의 단추를 눌러 공식 안내로 나간 횟수' },
  { key: 'packsim_checkin', label: '개봉 출석', hint: '출석 보상 받기' },
  { key: 'packsim_godpack', label: '갓팩', hint: '전부 AR 이상으로 나온 팩' },
  { key: 'packsim_value', label: '앨범 시세', hint: '앨범 탭에서 예상 가치 조회' },
  { key: 'packsim_share', label: '개봉 자랑', hint: '팩 결과를 게시판에 공유' },
  { key: 'share', label: '카드 공유', hint: '카드 상세에서 공유 버튼을 누를 때' },
  { key: 'scantest', label: '스캔 테스트', hint: '실험실에서 사진 넣기(운영자 전용이라 지금은 늘 0)' },
  // ⚠️ 셋을 붙여 둔다 — 「시작 대비 깬 비율」이 곧 그 스테이지의 난이도다.
  //    어느 스테이지인지는 아래 라벨 순위에 쌓인다.
  { key: 'battle_start', label: '디펜스 시작', hint: '한 판을 시작할 때(운영자 전용 · 어느 스테이지인지 아래 순위)' },
  { key: 'battle_clear', label: '디펜스 클리어', hint: '적 성을 부쉈을 때. 시작 대비 비율이 그 스테이지의 난이도입니다' },
  { key: 'battle_lose', label: '디펜스 짐', hint: '내 성이 부서졌을 때. 여기가 몰리는 스테이지가 너무 어려운 판입니다' },
  // ⚠️ 짐과 따로 센다 — 짐 라벨에 까닭까지 붙이면 하루 칸(150)을 넘어 조용히 잘린다.
  { key: 'battle_why', label: '디펜스 진 까닭', hint: '질 때마다 그 판 기록에서 고른 한 줄(벽 없음·상성 밀림 등 · 아래 「왜 지나」 표)' },
  // ⚠️ 한 판에 한 번만 온다 — 「시작」과 나눠 보면 몇 판에서 숫자키를 썼는지가 된다.
  { key: 'battle_key', label: '디펜스 숫자키 사용', hint: '숫자키 1~8로 포켓몬을 낸 판(한 판에 한 번). 시작 대비 비율이 낮으면 아무도 모르고 있다는 뜻입니다' },
  // ⚠️ 둘을 붙여 둔다 — 「뜬 수 대비 끝낸 수」가 곧 첫 판 안내의 성적이다.
  { key: 'battle_guide', label: '디펜스 첫 판 안내 뜸', hint: '이 게임이 처음인 사람에게만 한 번 뜨는 안내(브라우저당 한 번). 이 수가 곧 처음 온 사람 수입니다' },
  { key: 'battle_quit', label: '디펜스 도중에 그만둠', hint: '시작해 놓고 이기지도 지지도 않고 나간 횟수. 여기가 몰리는 판은 어려운 게 아니라 지겨운 판입니다' },
  { key: 'battle_card_detail', label: '디펜스 카드 자세히', hint: '카드를 길게 눌러 능력치를 펴 본 횟수. 0에 가까우면 아무도 안 쓰는 기능이니 떼는 게 낫습니다' },
  { key: 'battle_guide_done', label: '디펜스 첫 판 안내 따라옴', hint: '안내를 따라 첫 포켓몬까지 낸 사람. 위 줄 대비 비율이 낮으면 안내를 보고도 무엇을 누를지 모른다는 뜻입니다' },
  // ⚠️⚠️ **아래 다섯은 「무슨 기능을 썼나」 그래프에서 뺐다**(사장님 지시 2026-08-19).
  //    「엔터를 눌러서」·「그냥 치다 멈춰서」는 **사람이 한 일이 아니라 검색 한 번의 과정**이라
  //    같은 그래프에 섞이면 실제로 무엇을 썼는지를 가린다. `과정`이 붙은 줄은 그래프에서
  //    빠지고, 아래 접힌 칸(「검색을 어떻게 확정했나」)에서만 보인다.
  //    ⚠️ **자료는 그대로 쌓는다** — 검색 경로 중 무엇을 떼도 되는지 볼 때 쓰는 숫자다.
  {
    key: '_search_group',
    label: '검색어를 어떻게 확정했나',
    hint: '위 검색 두 줄(스니커덩크·해외 시세)을 다시 나눈 것입니다. 합계가 같아야 정상입니다.',
    group: true,
    과정: true,
  },
  { key: 'search_scan', label: '└ 사진으로 찾아서', hint: '사진으로 카드를 찾아 그 검색어가 인기 검색어에 반영됨' , 과정: true },
  { key: 'search_pick', label: '└ 자동완성에서 골라서', hint: '자동완성 목록에서 고른 검색어' , 과정: true },
  { key: 'search_popular', label: '└ 인기 검색어를 눌러서', hint: '인기 검색어 목록을 눌러 검색' , 과정: true },
  { key: 'search_enter', label: '└ 엔터를 눌러서', hint: '엔터(폰 키보드의 "검색")로 확정' , 과정: true },
  { key: 'search_typed', label: '└ 그냥 치다 멈춰서', hint: '확정 없이 1.5초 멈춰 집계된 것. 이 비중이 낮으면 그 경로를 떼도 된다' , 과정: true },
];

// ⚠️ 서버가 유입경로를 담을 때 쓰는 **로봇 칸 이름**(server/api.ts의 `로봇들`).
//    사람과 로봇을 갈라 보여 주려고 여기서도 안다. **두 곳이 같아야 한다** — 서버에
//    칸을 더하면 여기도 더할 것.
const 로봇칸 = new Set([
  '구글봇', '빙봇', '네이버봇', '다음봇', 'AI 수집기', 'SEO 수집기',
  '링크 미리보기', '그밖 검색로봇', '그밖 로봇',
]);

/**
 * 「어느 블로그·카페인가」에서 **눌러서 가 볼 수 있는 주소**를 만든다(2026-08-27).
 * ⚠️ **맞는다고 확신하는 것만 건다.** 틀린 링크는 없느니만 못하다 —
 *    디시는 정식·마이너·미니 갤러리의 주소가 달라서 아이디만으로는 못 만든다.
 *    네이버 카페도 새 주소로 온 것은 카페 **번호**라 그대로는 못 연다(숫자면 안 건다).
 */
function 곳주소(낱말: string, 곳: string): string | null {
  // 「(어디인지 안 알려 줌)」 같은 칸에는 링크를 걸면 안 된다.
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(곳)) return null;
  if (낱말 === '네이버 블로그') return `https://blog.naver.com/${곳}`;
  if (낱말 === '네이버 카페') return /^\d+$/.test(곳) ? null : `https://cafe.naver.com/${곳}`;
  if (낱말 === '아카라이브') return `https://arca.live/b/${곳}`;
  return null;
}

// 기간 고르개. 달력과 **같은 자리**를 바꿔 그린다.
type 기간 = { 종류: 'today' | 'week' | 'month' | 'all' } | { 종류: 'day'; 날: string };
const 기간이름 = (기: 기간, 오늘: string): string =>
  기.종류 === 'day'
    ? 기.날 === 오늘 ? '오늘' : `${Number(기.날.slice(5, 7))}월 ${Number(기.날.slice(8))}일`
    : 기.종류 === 'today' ? '오늘'
    : 기.종류 === 'week' ? '최근 7일'
    : 기.종류 === 'month' ? '최근 30일'
    : '전체';

// 막대 한 벌. 유입·기능·작가·세트가 모두 이 꼴이라 하나로 쓴다.
function 막대목록({ 제목, 설명, 자료, 색, 빈말, 접기 }: {
  제목: string; 설명?: string; 자료: { name: string; count: number }[];
  색: string; 빈말: string; 접기?: number;
}) {
  const [보임, set보임] = useState(접기 ?? 999);
  if (!자료.length) {
    return (
      <div>
        <p className="mb-2 text-sm font-bold text-black">{제목}</p>
        <p className="rounded-lg border border-dashed border-neutral-200 py-6 text-center text-xs text-neutral-500">{빈말}</p>
      </div>
    );
  }
  const 총 = 자료.reduce((a, b) => a + b.count, 0);
  const 최대 = Math.max(1, ...자료.map((x) => x.count));
  return (
    <div>
      <p className="mb-1 text-sm font-bold text-black">
        {제목} <span className="font-normal text-neutral-500">{총.toLocaleString()}</span>
      </p>
      {설명 && <p className="mb-2 text-[11px] text-neutral-500">{설명}</p>}
      <ul className="space-y-1">
        {자료.slice(0, 보임).map((x) => (
          <li key={x.name} className="flex items-center gap-2">
            <span className="w-28 flex-shrink-0 truncate text-xs text-neutral-500" title={x.name}>{x.name}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-neutral-100">
              <div className="h-4 rounded" style={{ width: `${Math.max(2, (x.count / 최대) * 100)}%`, background: 색 }} />
            </div>
            <span className="w-16 flex-shrink-0 text-right text-xs font-semibold text-neutral-700 tabular-nums">
              {x.count.toLocaleString()}
              <span className="ml-1 font-normal text-neutral-500">{Math.round((x.count / 총) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
      {보임 < 자료.length && (
        <button type="button" onClick={() => set보임((n) => n + 10)}
          className="mt-2 w-full rounded-lg border border-neutral-200 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
          더 보기 ({자료.length - 보임}개)
        </button>
      )}
    </div>
  );
}

export function VisitStats() {
  const [items, setItems] = useState<VisitStat[]>([]);
  const [total, setTotal] = useState(0);
  const [memberCount, setMemberCount] = useState(0);
  const [credits, setCredits] = useState<VisitStatsResponse['credits']>(undefined);
  const [members, setMembers] = useState<MemberStat[]>([]);
  const [from, setFrom] = useState<NonNullable<VisitStatsResponse['from']>>([]);
  const [places, setPlaces] = useState<NonNullable<VisitStatsResponse['places']>>([]);
  const [landings, setLandings] = useState<NonNullable<VisitStatsResponse['landings']>>([]);
  const [botAgents, setBotAgents] = useState<NonNullable<VisitStatsResponse['botAgents']>>({});
  const [events, setEvents] = useState<EventDayBuckets>({});
  const [artists, setArtists] = useState<ArtistStat[]>([]);
  const [sets, setSets] = useState<ArtistStat[]>([]);
  // 빈손 카드 — 방문자가 열었는데 보여 줄 게 없던 카드(2026-09-01부터 쌓인다).
  const [misses, setMisses] = useState<ArtistStat[]>([]);
  const [battles, setBattles] = useState<ArtistStat[]>([]);
  const [dayRanks, setDayRanks] = useState<Record<string, { artists: ArtistStat[]; sets: ArtistStat[]; battles?: ArtistStat[] }>>({});
  const [기간, set기간] = useState<기간>({ 종류: 'today' });
  // GP 선물을 보낼 대상(닉네임). null이면 창이 닫혀 있다.
  const [giftTo, setGiftTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 선물을 보낸 뒤 표의 GP를 새로 읽는다.
  const 회원다시읽기 = useCallback(() => {
    fetchVisitStats()
      .then((r) => setMembers(r.members ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchVisitStats()
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setMemberCount(r.memberCount);
        setCredits(r.credits);
        setMembers(r.members ?? []);
        setFrom(r.from ?? []);
        setPlaces(r.places ?? []);
        setLandings(r.landings ?? []);
        setBotAgents(r.botAgents ?? {});
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // 기능 통계는 별도 — 실패해도 방문 통계는 보이게 둔다.
    fetchEventStats()
      .then((r) => {
        setEvents(r.days);
        setArtists(r.artists);
        setSets(r.sets);
        setMisses(r.misses ?? []);
        setBattles(r.battles ?? []);
        setDayRanks(r.dayRanks ?? {});
      })
      .catch(() => undefined);
  }, []);

  if (loading) return <p className="text-sm text-neutral-500 py-12 text-center">불러오는 중...</p>;
  if (error) return <p className="text-sm text-neutral-500 py-12 text-center">방문 통계를 불러오지 못했습니다.</p>;

  // ── 방문 ──
  const today = dayKey(0);
  const todayCount = items.find((d) => d.date === today)?.count ?? 0;
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayKey(i)));
  const weekCount = items.filter((d) => week.has(d.date)).reduce((a, b) => a + b.count, 0);

  // ── 고른 기간에 드는 날짜들 ────────────────────────────────────────────────
  // ⚠️⚠️ **여기가 이 화면의 중심이다.** 예전엔 유입·기능·작가·세트를 위쪽에서 한 벌
  //    (「최근 14일」·「전체」), 달력 안에서 또 한 벌(그날) 보여 줬다 — 같은 것이 두 번
  //    나오고 기준도 서로 달라 견줄 수가 없었다(사장님 지적 2026-08-16).
  //    이제 **기간을 한 번 고르면 네 가지가 다 그 기간으로** 바뀐다.
  const 기간날짜 = ((): Set<string> | null => {
    if (기간.종류 === 'all') return null; // null = 전부(날짜로 안 거른다)
    if (기간.종류 === 'day') return new Set([기간.날]);
    if (기간.종류 === 'today') return new Set([today]);
    const n = 기간.종류 === 'week' ? 7 : 30;
    return new Set(Array.from({ length: n }, (_, i) => dayKey(i)));
  })();
  const 이날인가 = (날: string) => !기간날짜 || 기간날짜.has(날);

  // 유입경로 — 고른 기간만 합친다.
  const 유입합계 = Object.entries(
    from.reduce<Record<string, number>>((a, d) => {
      if (!이날인가(d.date)) return a;
      for (const [말, n] of Object.entries(d.counts ?? {})) a[말] = (a[말] ?? 0) + n;
      return a;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  // ⚠️ **사람과 로봇을 갈라 적는다.** 섞어 놓으면 「직접 77」 안에 무엇이 들었는지 알 수
  //    없다 — 실제로 방문이 두 배가 됐을 때 사람인지 로봇인지 못 밝힌 일이 있었다.
  const 사람유입 = 유입합계.filter(([말]) => !로봇칸.has(말)).map(([name, count]) => ({ name, count }));
  const 로봇유입 = 유입합계.filter(([말]) => 로봇칸.has(말)).map(([name, count]) => ({ name, count }));

  // 기능 사용 — 고른 기간만.
  const ev: Record<string, number> = {};
  for (const [day, counts] of Object.entries(events)) {
    if (!이날인가(day)) continue;
    for (const [k, n] of Object.entries(counts)) ev[k] = (ev[k] ?? 0) + (n ?? 0);
  }

  // 작가·세트 — 「전체」는 서버가 준 전체 순위를, 그 밖에는 날짜별 순위를 합친다.
  // ⚠️ 날짜별 순위는 **2026-08-16부터** 쌓인다. 그 전 날짜를 고르면 비어 있는 게 맞다.
  const 날짜순위합 = (뽑기: (v: { artists: ArtistStat[]; sets: ArtistStat[]; battles?: ArtistStat[] }) => ArtistStat[]) => {
    const m = new Map<string, number>();
    for (const [날, v] of Object.entries(dayRanks)) {
      if (!이날인가(날)) continue;
      for (const x of 뽑기(v)) m.set(x.name, (m.get(x.name) ?? 0) + x.count);
    }
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };
  const 기간작가 = 기간.종류 === 'all' ? artists : 날짜순위합((v) => v.artists);
  const 기간세트 = 기간.종류 === 'all' ? sets : 날짜순위합((v) => v.sets);
  /**
   * 대전쟁 — **스테이지마다 시작/깸/짐을 한 줄로 모은다.**
   * ⚠️ 「시작 대비 깬 비율」이 곧 그 판의 난이도다. 셋을 따로 늘어놓으면 그 비율이 안 보인다.
   */
  // ⚠️ 셈은 `src/lib/battleStats.ts`에 있다 — 이 화면은 **운영자로 로그인해야** 열려서
  //    눈으로 확인이 안 된다. 떼어 두면 `npm run 대전쟁통계검사`로 로그인 없이 검증된다.
  const 전투원본 = 기간.종류 === 'all' ? battles : 날짜순위합((v) => v.battles ?? []);
  const 기간전투 = 판별모으기(전투원본);
  const 기간난이도 = 난이도별모으기(전투원본);
  // ⚠️ 「어느 판이 어렵나」에서 **「무엇을 몰라서 지나」**로 넘어가는 표다.
  const 기간까닭 = 까닭모으기(전투원본);

  // 어느 블로그·카페·갤러리에서 왔나 — 고른 기간만 합친다(2026-08-27).
  // ⚠️ 이건 **우리에게 링크를 건 글이 있는 자리**다. 방문한 사람이 아니다.
  const 곳별 = (() => {
    const m = new Map<string, Map<string, number>>();
    for (const d of places) {
      if (!이날인가(d.date)) continue;
      for (const [낱말, 표] of Object.entries(d.counts ?? {})) {
        const 안 = m.get(낱말) ?? new Map<string, number>();
        for (const [곳, n] of Object.entries(표)) 안.set(곳, (안.get(곳) ?? 0) + n);
        m.set(낱말, 안);
      }
    }
    return [...m]
      .map(([낱말, 안]) => ({
        낱말,
        목록: [...안].sort((a, b) => b[1] - a[1]),
        합: [...안.values()].reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.합 - a.합);
  })();

  // 어느 화면으로 들어왔나 — 고른 기간만 합친다(2026-08-31).
  // ⚠️ 카드 한 장 주소(/card/<번호>)를 붙인 뒤 그게 사람을 데려오는지 보는 자리다.
  //    애드센스가 「가치가 별로 없는 콘텐츠」로 떨어뜨린 뒤 넣었다.
  const 첫화면별 = (() => {
    const m = new Map<string, number>();
    for (const d of landings) {
      if (!이날인가(d.date)) continue;
      for (const [이름, n] of Object.entries(d.counts ?? {})) m.set(이름, (m.get(이름) ?? 0) + n);
    }
    return [...m]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  })();
  const 첫화면합 = 첫화면별.reduce((a, b) => a + b.count, 0);
  const 카드로들어온수 = 첫화면별.find((x) => x.name === '카드 한 장')?.count ?? 0;

  // 「그밖 로봇」이 실제로 무슨 프로그램이었나 — 고른 기간만 합친다.
  // ⚠️ 칸을 미리 안 만들어도 여기서 바로 확인된다(사장님 2026-08-16).
  const 로봇이름 = (() => {
    const m = new Map<string, number>();
    for (const [날, 표] of Object.entries(botAgents)) {
      if (!이날인가(날)) continue;
      for (const [이름, n] of Object.entries(표)) m.set(이름, (m.get(이름) ?? 0) + n);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  })();

  // ── 시세 조회 크레딧 ──
  // 이게 0이 되면 방문자에게 이베이·TCGplayer 시세가 통째로 안 보인다. 전에는 서버
  // 로그를 봐야 알 수 있어서 바닥난 걸 한참 뒤에 알았다(2026-08-03).
  const cr = credits;
  const crLeft = cr?.left ?? null;
  const crPct = cr && crLeft !== null ? Math.round((crLeft / cr.daily) * 100) : null;
  const crTone =
    crLeft === null ? 'text-neutral-500'
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
            <p className="text-[11px] text-neutral-500">
              {new Date(cr.resetAt).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' })}에 다시 찹니다
            </p>
          </div>
          <p className={`mt-1 text-2xl font-bold ${crTone}`}>
            {crLeft === null ? '아직 모름' : crLeft.toLocaleString()}
            <span className="ml-1 text-sm font-normal text-neutral-500">/ {cr.daily.toLocaleString()}</span>
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

      {/* ── 달력 = 「언제」 · 아래 한 자리 = 「무엇을」 ─────────────────────────
          ⚠️⚠️ 예전엔 유입·기능·작가·세트를 **위쪽에 한 벌, 달력 안에 또 한 벌** 그렸다.
             같은 것이 두 번 나오는데 기준까지 달라(최근 14일 ↔ 그날) 견줄 수가 없었다
             (사장님 지적 2026-08-16: "달력에 있는 내용은 중복 없게").
             지금은 **기간을 한 번 고르면 아래 네 가지가 다 그 기간으로** 바뀐다. */}
      <StatsCalendar
        방문={items}
        고른날={기간.종류 === 'day' ? 기간.날 : null}
        고르기={(날) => set기간({ 종류: 'day', 날 })}
      />

      <p className="mt-3 text-xs text-neutral-500">
        같은 브라우저는 하루 한 번만 집계됩니다. IP·기기·회원 정보는 저장하지 않습니다.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-1.5">
        {([['today', '오늘'], ['week', '최근 7일'], ['month', '최근 30일'], ['all', '전체']] as const).map(([k, 이름]) => (
          <button
            key={k}
            type="button"
            onClick={() => set기간({ 종류: k })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              기간.종류 === k ? 'bg-black text-white' : 'border border-neutral-200 text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {이름}
          </button>
        ))}
        {기간.종류 === 'day' && (
          <span className="rounded-full bg-black px-3 py-1.5 text-xs font-semibold text-white">
            {기간이름(기간, today)}
          </span>
        )}
      </div>

      <h2 className="mt-4 mb-1 text-base font-bold text-black">{기간이름(기간, today)}에 무슨 일이 있었나</h2>
      <p className="mb-4 text-xs text-neutral-500">
        위 달력에서 날짜를 누르거나 기간 단추를 눌러 바꿉니다.
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* ⚠️ **사람과 로봇을 갈라 적는다.** 섞으면 「직접」 안에 무엇이 들었는지 알 수 없다.
            2026-08-16에 방문이 두 배가 됐을 때 사람인지 로봇인지 끝내 못 밝힌 일이 있었다. */}
        <div>
          <막대목록
            제목="사람이 어디서 들어왔나"
            설명="검색·SNS·직접 들어온 것. 로봇은 아래 칸으로 갈라 담습니다."
            색="#10966e"
            빈말="이 기간은 유입경로를 안 세고 있었습니다(2026-08-16부터 쌓입니다)."
            자료={사람유입}
            접기={12}
          />
          {/* ⚠️ 「네이버 블로그 5번」까지만 알고 **어느 블로그인지 알 길이 없었다**
              (사장님 물음 2026-08-27). 여기 담기는 것은 우리에게 링크를 건 **글이 있는
              자리**이고, 방문한 사람을 가리키는 값이 아니다. */}
          {곳별.length > 0 && (
            <div className="mt-3 rounded-lg border border-neutral-200 p-3">
              <p className="mb-2 text-xs font-bold text-black">어느 블로그·카페에서 왔나</p>
              <ul className="space-y-2">
                {곳별.map(({ 낱말, 목록 }) => (
                  <li key={낱말}>
                    <p className="text-[11px] font-semibold text-neutral-500">{낱말}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {목록.map(([곳, 수]) => {
                        const 주소 = 곳주소(낱말, 곳);
                        return (
                          <li key={곳} className="flex items-baseline gap-2">
                            <span className="w-8 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-700">
                              {수}
                            </span>
                            {주소 ? (
                              <a
                                href={주소}
                                target="_blank"
                                rel="noreferrer"
                                /* ⚠️ 막대 색(#10966e)을 글씨에 쓰면 흰 바탕에서 대비 3.74로 기준(4.5) 미달이다.
                                   막대는 면이라 괜찮지만 글씨는 아니다 — 사이트 기본 글씨색을 쓴다. */
                                className="break-all text-xs text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-black"
                              >
                                {곳}
                              </a>
                            ) : (
                              <span className="break-all text-xs text-neutral-600">{곳}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-neutral-500">
                2026-08-27부터 쌓입니다. 「어디인지 안 알려 줌」은 브라우저가 개인정보 보호로 집 이름까지만
                알려 준 것입니다 — 이 칸만 쌓이면 이 방법으로는 알 수 없다는 뜻입니다.
              </p>
            </div>
          )}
          {/* ⚠️⚠️ **카드 한 장 주소가 먹히는지 보는 자리다**(2026-08-31). 애드센스가
              「가치가 별로 없는 콘텐츠」로 떨어뜨린 뒤(2026-08-30) 카드마다 주소를
              붙였는데, 방문 수는 하루 총합 하나뿐이라 그게 사람을 데려오는지 볼 수가
              없었다. 「카드 한 장」 줄이 오르면 시범이 먹힌 것이다. */}
          <div className="mt-3">
            <막대목록
              제목="어느 화면으로 들어왔나"
              설명="사이트에 처음 닿은 화면입니다. 「카드 한 장」은 카드 주소로 바로 들어온 것입니다."
              색="#2563eb"
              빈말="이 기간은 안 세고 있었습니다(2026-08-31부터 쌓입니다)."
              자료={첫화면별}
              접기={12}
            />
            {첫화면합 > 0 && (
              <p className="mt-2 text-[11px] text-neutral-500">
                이 기간에 {첫화면합.toLocaleString()}명이 처음 닿았고, 그중 {카드로들어온수.toLocaleString()}명이
                카드 주소로 바로 들어왔습니다.
              </p>
            )}
          </div>
        </div>
        <div>
          <막대목록
            제목="로봇"
            설명="검색엔진·AI 수집기 등. 프로그램 이름으로 가린 것이라 참고용입니다."
            색="#9aa0a6"
            빈말="이 기간에 잡힌 로봇이 없습니다."
            자료={로봇유입}
            접기={12}
          />
          {/* ⚠️ 「그밖 로봇」은 이름이 안 붙은 것이라 그것만으로는 무엇인지 알 수 없다.
              칸을 미리 만들어 두지 않아도 여기서 바로 보이게 한다. */}
          {로봇이름.length > 0 && (
            <details className="mt-2 rounded-lg border border-neutral-200">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-neutral-600">
                어떤 로봇인지 보기 ({로봇이름.length}가지)
              </summary>
              <ul className="space-y-1.5 border-t border-neutral-100 px-3 py-2">
                {로봇이름.map(([이름, 수]) => (
                  <li key={이름} className="flex items-start gap-2">
                    <span className="w-8 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-700">{수}</span>
                    <span className="break-all text-[11px] leading-snug text-neutral-500">{이름}</span>
                  </li>
                ))}
              </ul>
              <p className="px-3 pb-2 text-[11px] text-neutral-500">
                프로그램이 스스로 밝힌 이름입니다. 2026-08-16 저녁부터 쌓입니다.
              </p>
            </details>
          )}
        </div>
        <막대목록
          제목="무슨 기능을 썼나"
          색="#2a78d6"
          빈말="이 기간은 기능 사용 기록이 없습니다."
          자료={EVENT_ROWS.filter((r) => !r.group && !r.dead && !r.과정 && (ev[r.key] ?? 0) > 0)
            .map((r) => ({ name: r.label.replace(/^└\s*/, ''), count: ev[r.key] ?? 0 }))
            .sort((a, b) => b.count - a.count)}
          접기={12}
        />
        {/* ⚠️ 검색 확정 경로는 **사람이 한 일이 아니라 검색 한 번의 과정**이라 위 그래프에서
            뺐다(사장님 지시 2026-08-19). 지우지는 않는다 — 「어느 경로를 떼도 되나」를
            판단할 때 쓰는 숫자여서, 여기에 접어 두고 볼 사람만 펴 보게 한다. */}
        <details className="rounded-xl border border-neutral-200">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-black">
            검색을 어떻게 확정했나
            <span className="ml-2 text-xs font-medium text-neutral-500">
              검색 한 번의 과정이라 위 그래프에서는 뺐습니다
            </span>
          </summary>
          <div className="border-t border-neutral-100 px-2 pb-2">
            <막대목록
              제목="경로별 횟수"
              색="#8a8a8a"
              빈말="이 기간은 검색 기록이 없습니다."
              자료={EVENT_ROWS.filter((r) => r.과정 && !r.group && (ev[r.key] ?? 0) > 0)
                .map((r) => ({ name: r.label.replace(/^└\s*/, ''), count: ev[r.key] ?? 0 }))
                .sort((a, b) => b.count - a.count)}
            />
          </div>
        </details>
        <div className="grid gap-6">
          <막대목록
            제목="많이 본 작가"
            색="#7c5cd6"
            빈말="날짜별 작가 순위는 2026-08-16부터 쌓입니다."
            자료={기간작가}
            접기={8}
          />
          <막대목록
            제목="많이 연 세트"
            색="#d67c2a"
            빈말="날짜별 세트 순위는 2026-08-16부터 쌓입니다."
            자료={기간세트}
            접기={8}
          />
        </div>

        {/* ⚠️ 빈손 카드는 **날짜별로 안 쌓는다** — 누적만 본다. 「어디부터 채울까」를
            고르려는 표라 하루치보다 쭉 모은 것이 쓸모 있다. 그래서 기간을 안 따른다. */}
        <div className="mt-6">
          <막대목록
            제목="빈손 카드 — 열었는데 보여 줄 게 없던 카드"
            색="#c2410c"
            빈말="2026-09-01부터 쌓입니다."
            자료={misses}
            접기={10}
          />
          <p className="mt-2 text-xs text-neutral-500">
            「시세없음」은 어느 마켓에도 값이 없던 카드, 「팝수없음」은 감정 기록이 없던 카드입니다.
            위쪽에 있는 카드부터 값을 채우면 가장 많은 사람이 덕을 봅니다. 기간과 무관한 누적 순위입니다.
          </p>
        </div>

        {기간난이도.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-bold text-black">디펜스 — 난이도마다 얼마나 깨나</h4>
            <p className="mt-0.5 text-xs text-neutral-500">
              별을 난이도가 줍니다(쉬움 ★ · 보통 ★★ · 어려움 ★★★). 어려움을 아무도 안 깨면 너무 어려운 것이고,
              셋이 다 비슷하면 난이도가 갈리지 않는 것입니다.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="py-1 pr-2 font-normal">난이도</th>
                    <th className="py-1 pr-2 text-right font-normal">시작</th>
                    <th className="py-1 pr-2 text-right font-normal">클리어</th>
                    <th className="py-1 pr-2 text-right font-normal">짐</th>
                    {/* ⚠️ **「그만둠」이 없으면 남은 수가 어디 갔는지 모른다.** 깬 비율만 보면
                        그게 「어려워서 진 것」처럼 읽히는데 실제로는 지겨워 나간 것일 수 있다. */}
                    <th className="py-1 pr-2 text-right font-normal">그만둠</th>
                    <th className="py-1 text-right font-normal">클리어 비율</th>
                  </tr>
                </thead>
                <tbody>
                  {기간난이도.map((r) => {
                    const 비율 = r.시작 ? Math.round((r.깸 / r.시작) * 100) : 0;
                    return (
                      <tr key={r.난} className="border-b border-neutral-100">
                        <td className="py-1 pr-2">{r.난}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{r.시작}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{r.깸}</td>
                        <td className="py-1 pr-2 text-right tabular-nums text-neutral-500">{r.짐}</td>
                        <td className="py-1 pr-2 text-right tabular-nums text-neutral-500">{r.그만둠}</td>
                        <td className={`py-1 text-right font-bold tabular-nums ${비율 < 40 ? 'text-rose-600' : ''}`}>
                          {r.시작 ? `${비율}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {기간전투.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-bold text-black">디펜스 — 판마다 얼마나 깨나</h4>
            <p className="mt-0.5 text-xs text-neutral-500">
              깬 비율이 낮은 판이 어려운 판입니다. 시작이 많은데 깬 게 적으면 거기서 그만둡니다.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="py-1 pr-2 font-normal">스테이지</th>
                    <th className="py-1 pr-2 text-right font-normal">시작</th>
                    <th className="py-1 pr-2 text-right font-normal">클리어</th>
                    <th className="py-1 pr-2 text-right font-normal">짐</th>
                    {/* ⚠️ **「그만둠」이 없으면 남은 수가 어디 갔는지 모른다.** 깬 비율만 보면
                        그게 「어려워서 진 것」처럼 읽히는데 실제로는 지겨워 나간 것일 수 있다. */}
                    <th className="py-1 pr-2 text-right font-normal">그만둠</th>
                    <th className="py-1 text-right font-normal">클리어 비율</th>
                  </tr>
                </thead>
                <tbody>
                  {기간전투.map((r) => {
                    const 비율 = r.시작 ? Math.round((r.깸 / r.시작) * 100) : 0;
                    return (
                      <tr key={r.판} className="border-b border-neutral-100">
                        <td className="py-1 pr-2">{r.판}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{r.시작}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{r.깸}</td>
                        <td className="py-1 pr-2 text-right tabular-nums text-neutral-500">{r.짐}</td>
                        <td className="py-1 pr-2 text-right tabular-nums text-neutral-500">{r.그만둠}</td>
                        <td className={`py-1 text-right font-bold tabular-nums ${비율 < 40 ? 'text-rose-600' : ''}`}>
                          {r.시작 ? `${비율}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {기간까닭.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-bold text-black">디펜스 — 왜 지나</h4>
            <p className="mt-0.5 text-xs text-neutral-500">
              진 판마다 그 판 기록에서 고른 까닭입니다. 한 가지가 몰리면 판이 어려운 것이 아니라
              하는 법이 안 전해진 것입니다.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[20rem] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="py-1 pr-2 font-normal">까닭</th>
                    <th className="py-1 pr-2 text-right font-normal">횟수</th>
                    <th className="py-1 text-right font-normal">몫</th>
                  </tr>
                </thead>
                <tbody>
                  {기간까닭.map((r) => {
                    const 전체 = 기간까닭.reduce((a, b) => a + b.수, 0);
                    return (
                      <tr key={r.까닭} className="border-b border-neutral-100">
                        <td className="py-1 pr-2">{r.까닭}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{r.수}</td>
                        <td className="py-1 text-right tabular-nums text-neutral-500">
                          {전체 ? `${Math.round((r.수 / 전체) * 100)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 기능 표는 **설명을 보는 자리**로만 남긴다. 숫자는 위 기간 칸이 맡는다 —
          여기까지 숫자를 또 적으면 그게 다시 중복이다. */}
      <details className="mt-8 rounded-xl border border-neutral-200">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-black">
          기능 하나하나가 무엇을 세는지
        </summary>
        <div className="border-t border-neutral-100 px-4 py-3">
          <p className="mb-3 text-xs text-neutral-500">
            숫자는 위에서 기간을 골라 보시고, 여기서는 각 줄이 **무슨 행동일 때 1 올라가는지**만 밝힙니다.
            기능별 사용 횟수만 셉니다. 누가 썼는지·개인정보는 남기지 않습니다.
          </p>
          <ul className="space-y-2">
            {EVENT_ROWS.filter((r) => !r.dead).map((r) => (
              <li key={r.key}>
                <span className={`text-xs font-semibold ${r.group ? 'text-neutral-600' : 'text-neutral-700'}`}>{r.label}</span>
                <span className="block text-[11px] text-neutral-500">{r.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <MemberTable members={members} onGift={setGiftTo} />
      <GiftBox 닉네임={giftTo} onClose={() => setGiftTo(null)} onDone={회원다시읽기} />
    </div>
  );
}

/**
 * 회원별 이용 현황.
 *
 * ⚠️ **회원번호(kakao:1234…)는 서버가 안 내려준다** — 로그인 식별자라서 화면에 올 이유가
 *    없다. 닉네임만 온다(본인이 우리 사이트에서 정한 이름. 아직 안 정했으면 빈 문자열).
 *    처음엔 닉네임도 뺐는데, 「일주일 넘게 안 온 8명」이 누구인지 알 수가 없어
 *    다시 넣었다(2026-08-11).
 */
// 운영자가 회원에게 GP를 보내는 작은 창(사장님 지시 2026-08-22).
// ⚠️ 서버는 **닉네임**으로 사람을 찾는다 — 회원번호는 화면으로 안 내려오기 때문이다.
//    같은 닉네임이 둘이면 서버가 거절한다(엉뚱한 사람에게 주느니 멈추는 쪽).
function GiftBox({ 닉네임, onClose, onDone }: { 닉네임: string | null; onClose: () => void; onDone: () => void }) {
  const [금액, set금액] = useState('100000');
  const [메시지, set메시지] = useState('매일 와 주셔서 감사합니다.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    // 대상이 바뀌면 창을 처음 상태로.
    setError(''); setDone(''); setBusy(false);
  }, [닉네임]);
  if (!닉네임) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-bold text-black">{닉네임}님께 GP 보내기</p>
        {done ? (
          <>
            <p className="mt-2 text-sm text-neutral-600">{done}</p>
            <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-bold text-white">
              닫기
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              보내면 그분 화면에 안내가 한 번 뜨고, GP 내역에 「운영자 선물」로 남습니다.
            </p>
            <label className="mt-3 block text-xs font-semibold text-neutral-600">금액 (GP)</label>
            <input
              inputMode="numeric"
              value={금액}
              onChange={(e) => set금액(e.target.value.replace(/[^0-9]/g, ''))}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <label className="mt-3 block text-xs font-semibold text-neutral-600">메시지 (안 써도 됩니다)</label>
            <input
              value={메시지}
              maxLength={100}
              onChange={(e) => set메시지(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-600">
                취소
              </button>
              <button
                type="button"
                disabled={busy || !금액}
                onClick={async () => {
                  setBusy(true); setError('');
                  try {
                    const res = await fetch('/api/local/auth/packsim/gift', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ 닉네임, 금액: Number(금액), 메시지 }),
                    });
                    const d = (await res.json()) as { 들어감?: number; 잔액?: number; 상한걸림?: boolean; error?: string };
                    if (!res.ok) throw new Error(d.error ?? '보내지 못했습니다.');
                    setDone(
                      `${(d.들어감 ?? 0).toLocaleString()} GP를 보냈습니다. ${닉네임}님 잔액은 ${(d.잔액 ?? 0).toLocaleString()} GP입니다.` +
                        (d.상한걸림 ? ' (잔액 상한에 걸려 일부만 들어갔습니다)' : ''),
                    );
                    onDone();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '보내지 못했습니다.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex-1 rounded-lg bg-neutral-900 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              >
                보내기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MemberTable({ members, onGift }: { members: MemberStat[]; onGift: (닉네임: string) => void }) {
  if (!members.length) return null;
  const 뽑은사람 = members.filter((m) => m.깐팩 > 0);
  const 안쓴사람 = members.filter((m) => m.깐팩 === 0 && !m.마지막출석);
  const 이레안온 = members.filter((m) => m.안온지 != null && m.안온지 >= 7);
  const 총깐팩 = members.reduce((a, b) => a + b.깐팩, 0);
  const 신규 = members.filter((m) => m.가입한지 != null && m.가입한지 <= 7).length;
  const 요약 = [
    { 이름: '가입 회원', 값: `${members.length}명` },
    { 이름: '최근 7일 가입', 값: `${신규}명` },
    { 이름: '뽑기를 해 본 사람', 값: `${뽑은사람.length}명` },
    { 이름: '가입만 하고 안 씀', 값: `${안쓴사람.length}명` },
    { 이름: '일주일 넘게 안 옴', 값: `${이레안온.length}명` },
    { 이름: '깐 팩 합계', 값: `${총깐팩.toLocaleString()}팩` },
  ];
  return (
    <>
      <h2 className="text-base font-bold text-black mt-8 mb-1">회원 이용 현황</h2>
      <p className="text-xs text-neutral-500 mb-4">
        가입한 지 얼마나 됐고 얼마나 쓰는지입니다. 닉네임은 본인이 정한 이름이고, 회원번호는 표시되지 않습니다.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {요약.map((x) => (
          <div key={x.이름} className="rounded-lg border border-neutral-200 px-3 py-2">
            <p className="text-[11px] text-neutral-500">{x.이름}</p>
            <p className="text-sm font-bold text-black">{x.값}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-xs">
          <thead className="text-neutral-500">
            <tr className="border-b border-neutral-200">
              <th className="py-2 pr-3 font-medium">닉네임</th>
              <th className="py-2 pr-3 font-medium">가입</th>
              <th className="py-2 pr-3 font-medium">마지막 출석</th>
              <th className="py-2 pr-3 font-medium text-right">연속</th>
              <th className="py-2 pr-3 font-medium text-right">깐 팩</th>
              <th className="py-2 pr-3 font-medium text-right">앨범</th>
              <th className="py-2 pr-3 font-medium text-right">GP</th>
              <th className="py-2 font-medium text-right">선물</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              <tr key={i} className="border-b border-neutral-100">
                {/* 닉네임을 아직 안 정한 사람이 있다(첫 로그인에서 건너뛰면 null).
                    ⚠️ td에는 max-width가 안 먹는다(표가 칸 너비를 스스로 정한다) —
                       대신 닉네임이 20자로 막혀 있어(서버 규칙) 줄바꿈만 막으면 된다. */}
                <td className="py-2 pr-3 whitespace-nowrap font-medium text-black">
                  {m.닉네임 || <span className="font-normal text-neutral-500">이름 없음</span>}
                </td>
                <td className="py-2 pr-3 text-neutral-700">
                  {m.가입한지 == null ? '-' : m.가입한지 === 0 ? '오늘' : `${m.가입한지}일째`}
                </td>
                <td className="py-2 pr-3 text-neutral-700">
                  {!m.마지막출석 ? <span className="text-neutral-500">없음</span>
                    : m.안온지 === 0 ? '오늘'
                    : `${m.안온지}일 전`}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{m.연속 || '-'}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-medium">{m.깐팩.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{m.앨범.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{m.GP.toLocaleString()}</td>
                <td className="py-2 text-right">
                  {/* 닉네임이 없으면 못 보낸다 — 서버가 닉네임으로 사람을 찾는다. */}
                  {m.닉네임 ? (
                    <button
                      type="button"
                      onClick={() => onGift(m.닉네임)}
                      className="rounded-lg border border-neutral-300 px-2 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      GP 주기
                    </button>
                  ) : (
                    <span className="text-neutral-300">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
