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
    // 36팩 박스 기대치(사용자 제공 실측): IR 2~3장, SIR 1장(32~48팩당), HR 1장(50~70팩당)
    { rolls: [['Hyper rare', 0.0167], ['Special illustration rare', 0.025], ['Illustration rare', 0.0694]], fb: 'cu' },
    // UR(풀아트) 2장/박스, RR(ex) 6~7장/박스
    { rolls: [['Ultra Rare', 0.0556], ['Double rare', 0.1806], ['ACE SPEC Rare', 0.0333]], fb: 'rare' },
  ],
};
// 북미판 메가 시리즈(Mega Evolution) 전용 — 세트 데이터로 직접 확인(2026-07-26):
// 금색 HR·ACE가 없고, 대신 일본판 MUR에 해당하는 MHR(메가 하이퍼레어) 2장이 최상위다.
// MHR 확률은 일본판 MUR과 같은 희소성(약 40박스당 1장)으로 잡은 추정치 — 실측 자료가
// 생기면 이 숫자만 바꾸면 된다.
export const NA_MEGA: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Mega Hyper Rare', 0.0007], ['Special illustration rare', 0.025], ['Illustration rare', 0.0694]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.0556], ['Double rare', 0.1806]], fb: 'rare' },
  ],
};

// 북미판 특별세트는 둘이 구성이 달라 프로필을 나눈다(세트 데이터로 직접 확인, 2026-07-26):
// Prismatic은 IR이 아예 없고(0장) ACE 6장 수록, 북미 151은 IR 16장 수록·ACE 없음.
// 확률은 사용자 조사 자료(2026-07, TCGplayer 실측 집계) 기준.
// Prismatic Evolutions: SIR 1/45, HR 1/180, UR 1/13, ACE 1/21. 리버스 대신
// 몬스터볼 포일 1/3팩·마스터볼 포일 1/20팩(mirror 'prismatic'으로 처리).
export const NA_PRISMATIC: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Hyper rare', 0.00556], ['Special illustration rare', 0.0222]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.0769], ['Double rare', 0.1667], ['ACE SPEC Rare', 0.0476]], fb: 'rare' },
  ],
};
// 북미판 151: IR 1/12, SIR 1/32, HR 1/51, UR 1/16. ACE 수록 없음, 리버스 2장은 일반과 같다.
export const NA_151: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Hyper rare', 0.0196], ['Special illustration rare', 0.03125], ['Illustration rare', 0.0833]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.0625], ['Double rare', 0.1667]], fb: 'rare' },
  ],
};
// 일본판 일반 부스터(5장) — 박스(30팩) 보장 스펙(사용자 제공, 2026-07)을 팩당으로 환산:
// 박스 보장(사용자 검증 실측): AR 3장 · RR 4~5장 · SR이상 1장 · ACE 1장(수록 세트만).
// SR이상 내부 배분: SAR ≈4.8박스당 1장(카톤당 2.5~3장), 금UR = 12박스(1카톤)당 1장.
export const JP_REGULAR: RateProfile = {
  commons: 3,
  uncommons: 1,
  slots: [
    {
      rolls: [
        ['Hyper rare', 0.00278],
        ['Special illustration rare', 0.007],
        ['Ultra Rare', 0.02355],
        ['Illustration rare', 0.1],
        ['ACE SPEC Rare', 0.0333],
        ['Double rare', 0.15],
      ],
      fb: 'rare',
    },
  ],
};

// 일본판 메가 시리즈(M1~M4) 전용 — SV 일반팩과 같지만 최상위가 다르다:
// 금색 UR 대신 신등급 MUR(메가 울트라레어, 카드 전체 금색·세트당 1장)이 들어간다.
// MUR 봉입률: 사용자 조사 자료(2026-07) 기준 50~60박스당 1장, 전 세트 동일 →
// 팩당 0.00033으로 박스 환산 약 1/50(박스 SR+ 보장 배분 포함, 시뮬레이션 검증).
// ACE는 메가 세트에 수록이 없어 뺐다.
export const JP_MEGA: RateProfile = {
  commons: 3,
  uncommons: 1,
  slots: [
    {
      rolls: [
        ['Mega Ultra Rare', 0.00033],
        ['Special illustration rare', 0.007],
        ['Ultra Rare', 0.02355],
        ['Illustration rare', 0.1],
        ['Double rare', 0.15],
      ],
      fb: 'rare',
    },
  ],
};

// 일본판 151(SV2a) 전용 — 특수팩이다: 팩당 7장, 박스 20팩(사용자 제공 공식 스펙).
// 박스 보장: AR 3장 = 15%/팩 · RR 4~5장 = 22.5%/팩 · SR이상 1장 = 5%/팩
// (그중 SAR은 5~6박스당 1장 = 0.9%/팩, 금색 UR은 더 드묾)
export const JP_151: RateProfile = {
  commons: 4,
  uncommons: 1,
  slots: [
    { rolls: [['Illustration rare', 0.15]], fb: 'cu' },
    {
      rolls: [
        ['Hyper rare', 0.004],
        ['Special illustration rare', 0.009],
        ['Ultra Rare', 0.037],
        ['Double rare', 0.225],
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
  // 갓팩 확률. 실물에서 갓팩은 151류 특수팩에만 있으므로(일본 151 약 1/700~800팩,
  // 북미 특별세트 약 1/1000팩) 해당 팩에만 넣는다. 없으면 0.
  godRate?: number;
  // 반짝이 변형판: jp151 = 팩당 미러 1장(박스당 마스터볼 1장), na = 팩당 리버스 홀로 2장,
  // prismatic = 몬스터볼 포일 1/3팩 + 마스터볼 포일 1/20팩(리버스 없음).
  mirror?: 'jp151' | 'na' | 'prismatic';
  // 박스 구성 팩 수. 0이면 박스 판매 없음(북미 특별세트 — 실물에도 36팩 박스가 없다).
  // 일본판 박스는 보장 봉입(drawBox), 북미판 박스는 순수 독립시행이다.
  boxPacks?: number;
};
const JP = (id: string, name: string, price = 1600, extra: Partial<PackSet> = {}): PackSet => ({
  slug: `ja-${id}`,
  label: `[일본판] ${name}`,
  src: `/packsim/ja-${id}.json`,
  jp: true,
  profile: JP_REGULAR,
  price,
  boxPacks: 30,
  ...extra,
});
const NA = (id: string, name: string, profile = NA_REGULAR, price = 6500, extra: Partial<PackSet> = {}): PackSet => ({
  slug: `en-${id}`,
  label: `[북미판] ${name}`,
  src: `/sets/en-${id}.json`,
  jp: false,
  profile,
  price,
  mirror: 'na',
  boxPacks: 36,
  ...extra,
});

export const PACK_SETS: PackSet[] = [
  // 일본판 5장팩 — limitless에서 받은 데이터(시크릿 포함). scripts/gen-packsim.mjs
  JP('M4', '닌자스피너', 1800, { profile: JP_MEGA }), // 2026-05 세대부터 200엔
  JP('M3', '니힐제로', 1600, { profile: JP_MEGA }),
  JP('M1L', '메가브레이브', 1600, { profile: JP_MEGA }),
  JP('M1S', '메가심포니아', 1600, { profile: JP_MEGA }),
  JP('SV11B', '블랙볼트'),
  JP('SV11W', '화이트플레어'),
  JP('SV10', '로켓단의 영광'),
  JP('SV9', '배틀파트너즈'),
  JP('SV8', '초전브레이커'),
  JP('SV7', '스텔라미라클'),
  JP('SV6', '변환의 가면'),
  JP('SV3', '흑염의 지배자'),
  JP('SV2a', '포켓몬 카드 151', 2600, { profile: JP_151, godRate: 1 / 750, mirror: 'jp151', boxPacks: 20 }), // 특수팩: 290엔·7장·20팩 박스·갓팩 존재
  // 북미판 10장 부스터팩 — public/sets에 레어도를 채워 둔다. scripts/fill-rarity.mjs
  // 이름은 정식 한글명이 따로 없어(한국판은 일본판 이름 체계) 영어명 음역을 쓴다.
  NA('me01', '메가 에볼루션', NA_MEGA),
  NA('sv10', '데스티니드 라이벌'),
  NA('sv09', '저니 투게더'),
  NA('sv08.5', '프리즈매틱 에볼루션', NA_PRISMATIC, 6500, { godRate: 1 / 1000, boxPacks: 0, mirror: 'prismatic' }), // 특별세트(36팩 박스 없음), 갓팩 존재
  NA('sv08', '서징 스파크'),
  NA('sv07', '스텔라 크라운'),
  NA('sv06', '트와일라잇 마스커레이드'),
  NA('sv03.5', '151', NA_151, 6500, { godRate: 1 / 1000, boxPacks: 0 }), // 특별세트, 갓팩 존재
  NA('sv03', '옵시디언 플레임'),
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
// 보관함의 박스 상한(팩과 별도로 센다).
export const MAX_BOX_STASH = 10;

// ── 갓팩 ──────────────────────────────────────────────────────────────────
// 갓팩에 들어가는 등급(높은 것부터). 세트에 없는 등급은 건너뛴다.
// 확률은 팩별 godRate(위 PACK_SETS)로 정한다 — 실물처럼 151류 특수팩에만 있다.
export const GOD_TIERS = [
  'Mega Ultra Rare',
  'Mega Hyper Rare',
  'Hyper rare',
  'Special illustration rare',
  'Ultra Rare',
  'Illustration rare',
  'ACE SPEC Rare',
] as const;
