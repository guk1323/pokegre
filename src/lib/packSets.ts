// 카드 뽑기(PackSim)의 팩 목록·봉입 확률·가격. 화면(PackSim.tsx)과 서버(server/api.ts)가
// 같은 표를 쓴다 — 가격을 클라이언트가 보내는 대로 믿으면 GP를 얼마든지 속일 수 있어서,
// 서버도 여기서 값을 읽어 차감한다.

// 슬롯 = 팩 안의 "한 자리". rolls=[등급, 팩당확률]을 순서대로 판정하고 다 빗나가면
// fb 풀(cu=커먼·언커먼 / rare=일반 레어)에서 뽑는다.
export type Slot = { rolls: [string, number][]; fb: 'cu' | 'rare' };
export type RateProfile = { commons: number; uncommons: number; slots: Slot[] };

// 북미판 일반 부스터(10장) — 최신 SV 세트 실측(pullrates.com, TCGplayer 8,000팩+):
// DR 1/6 · UR 1/15 · AR 1/13 · ACE 1/20 · SAR ~1/88 · HR ~1/180. 세트 불문 거의 동일.
export const NA_REGULAR: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Hyper rare', 0.0055], ['Special illustration rare', 0.0114], ['Illustration rare', 0.0769]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.0667], ['Double rare', 0.1667], ['ACE SPEC Rare', 0.05]], fb: 'rare' },
  ],
};
// 북미판 특별세트(프리즈매틱·151 등, 10장) — SAR가 일반의 2배가량 후함(1/45).
export const NA_SPECIAL: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Hyper rare', 0.011], ['Special illustration rare', 0.0222], ['Illustration rare', 0.1]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.08], ['Double rare', 0.1667], ['ACE SPEC Rare', 0.05]], fb: 'rare' },
  ],
};
// 일본판 일반 부스터(5장) — 박스(30팩) 보장 구조를 팩당으로 환산:
// AR 3/박스=10% · RR ~4/박스=13% · SR ~1/박스=2.8% · SAR ~1/6박스=0.56% · UR(HR) ~1/12박스=0.28%.
export const JP_REGULAR: RateProfile = {
  commons: 3,
  uncommons: 1,
  slots: [
    {
      rolls: [
        ['Hyper rare', 0.0028],
        ['Special illustration rare', 0.0056],
        ['Ultra Rare', 0.0277],
        ['Illustration rare', 0.1],
        ['Double rare', 0.13],
      ],
      fb: 'rare',
    },
  ],
};

// jp=true면 일본판(카드명 일본어·5장) · false면 북미판.
// price는 한 팩 정가(원). "비싼 팩 하나 vs 싼 팩 여러 개"를 고르는 기준이라 실제 정가를 쓴다.
// 기준: 포켓몬센터 공식 정가(사용자 확인, 2026-07) —
//   일본판 일반팩 180엔(2026-04까지 출시작)·200엔(2026-05부터) ≈ 1,600원·1,800원
//   일본판 하이클래스팩 550엔(10장) ≈ 4,900원 (전용 확률 프로필 만들 때 쓸 것)
//   북미판 부스터 $4.49 ≈ 6,500원 (특별세트도 정가는 같다)
// ⚠️ 정가·환율이 바뀌면 이 표만 고치면 된다.
export type PackSet = {
  slug: string;
  label: string;
  src: string;
  jp: boolean;
  profile: RateProfile;
  price: number;
};
const JP = (id: string, name: string, price = 1600): PackSet => ({
  slug: `ja-${id}`,
  label: `[일본판] ${name}`,
  src: `/packsim/ja-${id}.json`,
  jp: true,
  profile: JP_REGULAR,
  price,
});
const NA = (id: string, name: string, profile = NA_REGULAR, price = 6500): PackSet => ({
  slug: `en-${id}`,
  label: `[북미판] ${name}`,
  src: `/sets/en-${id}.json`,
  jp: false,
  profile,
  price,
});

export const PACK_SETS: PackSet[] = [
  // 일본판 5장팩 — limitless에서 받은 데이터(시크릿 포함). scripts/gen-packsim.mjs
  JP('M4', '닌자스피너'),
  JP('M3', '니힐제로'),
  JP('M1L', '메가브레이브'),
  JP('M1S', '메가심포니아'),
  JP('SV11B', '블랙볼트'),
  JP('SV11W', '화이트플레어'),
  JP('SV10', '로켓단의 영광'),
  JP('SV9', '배틀파트너즈'),
  JP('SV8', '초전브레이커'),
  JP('SV7', '스텔라미라클'),
  JP('SV6', '변환의 가면'),
  JP('SV3', '흑염의 지배자'),
  JP('SV2a', '포켓몬 카드 151'), // 시장가는 정가보다 높지만, 표는 정가 기준으로 통일
  // 북미판 10장 부스터팩 — public/sets에 레어도를 채워 둔다. scripts/fill-rarity.mjs
  NA('me01', 'Mega Evolution'),
  NA('sv10', 'Destined Rivals'),
  NA('sv09', 'Journey Together'),
  NA('sv08.5', 'Prismatic Evolutions', NA_SPECIAL), // 확률만 특별(SAR 2배), 정가는 같다
  NA('sv08', 'Surging Sparks'),
  NA('sv07', 'Stellar Crown'),
  NA('sv06', 'Twilight Masquerade'),
  NA('sv03.5', '151', NA_SPECIAL),
  NA('sv03', 'Obsidian Flames'),
  // 샤이니 특별세트(일본판 샤이니트레저 ex·테라스탈 페스타, 북미판 Paldean Fates)는
  // 카드 대부분이 '샤이니' 등급이라 위 확률 프로필이 안 맞는다. 전용 프로필을 만든 뒤에 넣는다.
];

// PPT(PokemonPriceTracker)에서 각 세트를 부르는 이름. 앨범 시세 수집(warm)에 쓴다.
// ⚠️ 전부 PPT API로 직접 확인한 문자열만 적는다(추측 금지). m1L·m1S는 소문자 m이 맞다.
export const PPT_SET_NAMES: Record<string, string> = {
  // 일본판
  'ja-M4': 'M4: Ninja Spinner',
  'ja-M3': 'M3: Nihil Zero',
  'ja-M1L': 'm1L: Mega Brave',
  'ja-M1S': 'm1S: Mega Symphonia',
  'ja-SV11B': 'SV11B: Black Bolt',
  'ja-SV11W': 'SV11W: White Flare',
  'ja-SV10': 'SV10: The Glory of Team Rocket',
  'ja-SV9': 'SV9: Battle Partners',
  'ja-SV8': 'SV8: Super Electric Breaker',
  'ja-SV7': 'SV7: Stellar Miracle',
  'ja-SV6': 'SV6: Transformation Mask',
  'ja-SV3': 'SV3: Ruler of the Black Flame',
  'ja-SV2a': 'SV2a: Pokemon Card 151',
  // 북미판
  'en-me01': 'ME01: Mega Evolution',
  'en-sv10': 'SV10: Destined Rivals',
  'en-sv09': 'SV09: Journey Together',
  'en-sv08.5': 'SV: Prismatic Evolutions',
  'en-sv08': 'SV08: Surging Sparks',
  'en-sv07': 'SV07: Stellar Crown',
  'en-sv06': 'SV06: Twilight Masquerade',
  'en-sv03.5': 'SV: Scarlet & Violet 151',
  'en-sv03': 'SV03: Obsidian Flames',
};

// ── 오늘의 진열대 ─────────────────────────────────────────────────────────
// 매일 일본판 3팩 + 북미판 3팩을 랜덤으로 진열한다. 날짜(한국시간)를 시드로 쓰는
// 결정적 셔플이라 서버와 화면이 따로 맞출 필요 없이 같은 답을 얻고, 자정에 바뀐다.
// 22팩 전부 시세를 미리 받아두므로(PPT_SET_NAMES) 어떤 팩이 떠도 시세는 바로 뜬다.
export function kstDateStr(now = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

// mulberry32 — 시드 하나로 같은 순서를 재현하는 가벼운 난수.
function seededRng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededPick<T>(arr: T[], n: number, seed: number): T[] {
  const rnd = seededRng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export function livePacks(date = kstDateStr()): PackSet[] {
  let h = 0;
  for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const jp = PACK_SETS.filter((p) => p.jp);
  const na = PACK_SETS.filter((p) => !p.jp);
  return [...seededPick(jp, 3, h), ...seededPick(na, 3, h ^ 0x9e3779b9)];
}

// 앨범에는 오늘 진열에 없는 팩의 카드도 남아 있으므로, 이름·이미지 조회는 전체에서 한다.
export const packBySlug = new Map(PACK_SETS.map((p) => [p.slug, p]));
// "이 팩 열어도 되나" 검사는 오늘 진열 기준.
export const isLive = (slug: string) => livePacks().some((p) => p.slug === slug);

// ── GP(그레포인트·출석 보상) 규칙 ────────────────────────────────────────────────────────
// GP는 pokegre 안에서만 쓰는 포인트(1GP=정가 1원 기준 숫자). 하루치로 일본판 18팩 / 북미판 4팩쯤
// 살 수 있게 잡았다 — "뭘 살지" 고민이 생기는 선. 더 적으면 선택이 없고, 더 많으면
// 아무거나 다 살 수 있어서 역시 선택이 사라진다.
export const DAILY_BUDGET = 30000;
export const FIRST_BONUS = 50000; // 처음 출석하면 바로 여러 팩을 까볼 수 있게
export const STREAK_DAYS = 7; // 연속 출석 보너스 주기
export const STREAK_BONUS = 30000;
// 안 들어온 날짜만큼 무한정 쌓이면 어느 날 한 번에 털고 다시 안 온다. 상한을 두면
// "모았으니 이제 쓰자"가 되고, 그래도 북미판 부스터 46개를 한 번에 지를 수 있다.
export const MAX_BALANCE = 300000;

// 커뮤니티에 뽑기 자랑글을 올리면 주는 보상(하루 1번). 자랑 → 보상 → 팩 하나 더 →
// 또 자랑…으로 뽑기와 커뮤니티가 서로 돌게 하는 장치다.
export const SHARE_BONUS = 5000;

// 보관함(사놓고 안 연 팩) 상한. 데이터는 가벼워도 무한 사재기는 이상한 메타를 만든다.
export const MAX_STASH = 50;

// ── 갓팩 ──────────────────────────────────────────────────────────────────
// 아주 낮은 확률로 팩 전체가 AR 이상으로 채워진다. 1/500이면 하루치 GP(일본판 18팩)를
// 매일 다 써도 한 달에 한 번쯤 나온다 — 기다릴 만하면서 영영 못 보진 않는 선.
export const GOD_PACK_RATE = 0.002;
// 갓팩에 들어가는 등급(높은 것부터). 세트에 없는 등급은 건너뛴다.
export const GOD_TIERS = [
  'Hyper rare',
  'Special illustration rare',
  'Ultra Rare',
  'Illustration rare',
  'ACE SPEC Rare',
] as const;
