// 카드 뽑기(PackSim)의 팩 목록·봉입 확률·가격. 화면(PackSim.tsx)과 서버(server/api.ts)가
// 같은 표를 쓴다 — 가격을 클라이언트가 보내는 대로 믿으면 GP를 얼마든지 속일 수 있어서,
// 서버도 여기서 값을 읽어 차감한다.

// 슬롯 = 팩 안의 "한 자리". rolls=[등급, 팩당확률]을 순서대로 판정하고 다 빗나가면
// fb 풀(cu=커먼·언커먼 / rare=일반 레어)에서 뽑는다.
export type Slot = { rolls: [string, number][]; fb: 'cu' | 'rare' };
export type RateProfile = { commons: number; uncommons: number; slots: Slot[] };

// 영문판 메인 부스터(10장·박스 36팩, 박스 보장 없음) — 사용자 제공 최종 확률표(2026-07-26).
// HR 1/140 · SIR 1/86 · UR 1/15 · IR 1/13 · ACE 1/20 · RR 1/6.
// HR·SIR은 예전 값(1/60·1/40)보다 실측이 훨씬 짜서 낮췄다.
export const NA_REGULAR: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Hyper rare', 0.007], ['Special illustration rare', 0.0115], ['Illustration rare', 0.077]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.066], ['Double rare', 0.169], ['ACE SPEC Rare', 0.05]], fb: 'rare' },
  ],
};
// 영문판 메가 시리즈(Mega Evolution) 전용 — 세트 데이터로 직접 확인(2026-07-26):
// 금색 HR·ACE가 없고, 대신 일본판 MUR에 해당하는 MHR(메가 하이퍼레어) 2장이 최상위다.
// MHR 0.07%(약 1,430팩당 1장)는 사용자 검증 완료(2026-07-26) — 해외 실측 집계가
// 1,200~1,500팩당 1장(0.067~0.083%)이라 이 값이 그 한가운데다.
export const NA_MEGA: RateProfile = {
  commons: 5,
  uncommons: 3,
  slots: [
    { rolls: [['Mega Hyper Rare', 0.0007], ['Special illustration rare', 0.0115], ['Illustration rare', 0.077]], fb: 'cu' },
    { rolls: [['Ultra Rare', 0.066], ['Double rare', 0.169]], fb: 'rare' },
  ],
};

// 영문판 특별세트는 둘이 구성이 달라 프로필을 나눈다(세트 데이터로 직접 확인, 2026-07-26):
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
// 영문판 151: IR 1/12, SIR 1/32, HR 1/51, UR 1/16. ACE 수록 없음, 리버스 2장은 일반과 같다.
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
        ['Hyper rare', 0.0028],
        ['Special illustration rare', 0.007],
        ['Ultra Rare', 0.0235],
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
// MUR 0.03%(약 3,333팩 = 박스 111개당 1장)는 사용자 검증 완료(2026-07-26).
// 실물은 세트에 따라 50~60박스~100박스당 1장 수준이라 그 하한(가장 드문 쪽)을 쓴다.
export const JP_MEGA: RateProfile = {
  commons: 3,
  uncommons: 1,
  slots: [
    {
      rolls: [
        ['Mega Ultra Rare', 0.0003],
        ['Special illustration rare', 0.007],
        ['Ultra Rare', 0.0235],
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

// jp=true면 일본판(카드명 일본어·5장) · false면 영문판.
// ACE SPEC은 시대에 따라 수록되지 않은 세트가 있다(북미 옵시디언 플레임처럼 부활 전,
// 블랙볼트·화이트플레어처럼 종료 후). 그런 세트에도 ACE를 확률표에 두면 절대 나올 수
// 없는 등급을 광고하게 된다 — 실제 뽑기에서는 그 등급 풀이 비어 fallback으로 빠진다.
// ACE 자리를 빼도 나머지 등급의 확률은 그대로고(각 등급이 자기 몫만 차지한다) 빠진
// 몫은 fallback으로 가므로, 뽑기 결과는 한 치도 안 바뀌고 표시만 정직해진다.
//
// ⚠️ 빠진 몫을 "일반 레어"로 채우는 것이 맞다는 것은 사용자 검증 완료(2026-07-26).
// 실물 팩에서 ACE 자리는 트레이너스·일반 레어 슬롯을 대체해 들어가는 구조라,
// ACE가 없는 세트라고 RR·AR 같은 상위 등급이 반사이익으로 늘지는 않는다.
const withoutAce = (p: RateProfile): RateProfile => ({
  ...p,
  slots: p.slots.map((s) => ({ ...s, rolls: s.rolls.filter(([tier]) => tier !== 'ACE SPEC Rare') })),
});
export const JP_REGULAR_NO_ACE = withoutAce(JP_REGULAR);
export const NA_REGULAR_NO_ACE = withoutAce(NA_REGULAR);

// price는 한 팩 정가(원). "비싼 팩 하나 vs 싼 팩 여러 개"를 고르는 기준이라 실제 정가를 쓴다.
// 기준: 포켓몬센터 공식 정가(사용자 확인, 2026-07) —
//   일본판 일반팩 180엔(2026-04까지 출시작)·200엔(2026-05부터) ≈ 1,600원·1,800원
//   일본판 하이클래스팩 550엔(10장) ≈ 4,900원 (전용 확률 프로필 만들 때 쓸 것)
//   영문판 부스터 $4.49 ≈ 6,500원 (특별세트도 정가는 같다)
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
  // 일본판 박스는 보장 봉입(drawBox), 영문판 박스는 순수 독립시행이다.
  boxPacks?: number;
  // 원본 세트 파일의 등급 이름을 뽑기 표준 이름으로 바꾼다.
  // 원본(TCGdex)이 같은 자리를 세트마다 다르게 적어 둔 곳이 있다 — 북미 메가 시리즈의
  // 최상위가 me01만 'Mega Hyper Rare'이고 me02~05는 'Secret Rare',
  // 블랙볼트는 'Black White Rare'인데 자매편 화이트플레어는 'Secret Rare'다.
  // 그대로 두면 RARITY_RANK에 없는 이름이라 그 카드가 뽑기에서 아예 안 나온다.
  // ⚠️ 'Secret Rare'는 옛 세트에서는 그냥 시크릿을 뜻하므로 전역 치환하면 안 된다.
  //    반드시 세트별로 지정한다.
  rarityAlias?: Record<string, string>;
};
// 일본판 세트 데이터의 등급 이름이 확률표와 한 칸씩 어긋나 있다.
//
// 일본판은 카드 번호가 곧 등급 순서다 — 기본 세트 뒤에 AR → SR → SAR → UR(금색)이
// 붙는다. 실제 데이터를 번호순으로 보면(ja-SV2P 기준):
//   72~83번  Illustration rare          12장  = AR
//   84~91번  Secret Rare                 8장  = SR      ← 확률표는 이걸 'Ultra Rare'라 부른다
//   92~96번  Special illustration rare   5장  = SAR
//   97~99번  Ultra Rare                  3장  = UR(금색) ← 확률표는 이걸 'Hyper rare'라 부른다
// 세트 25개 전부 같은 모양이고, 'Ultra Rare' 3장은 언제나 맨 끝 번호다.
//
// 그대로 두면 이런 일이 벌어졌다(2026-08-03 실측):
//   · Secret Rare 8~17장이 순위표에 없어 **한 장도 안 뽑혔다**
//   · 제일 귀한 금색 UR이 SR 확률(1/43팩)로 나왔다 — 실물은 1/350팩
// ⚠️ 확률 숫자는 하나도 안 바꾼다(사용자가 조사·검증한 값이다). 그 확률이 어느 카드에
//    걸리는지만 바로잡는다. 카드마다 c.r을 한 번만 찾아 바꾸므로 맞바꿈이 안전하다.
// ⚠️ 2026-08-03: 이 맞바꿈을 걷어냈다. 원본 데이터가 바뀌었기 때문이다.
//    위 설명은 세트 파일에 'Secret Rare'가 있던 시절 이야기인데, 지금은 21개 세트
//    **전부** 'Secret Rare'가 0장이고 그 자리가 'Ultra Rare'로 적혀 있다.
//    (M5·SV11B처럼 처음부터 표준 이름이던 세트와 이제 똑같아졌다.)
//    그대로 두면 반대로 망가진다 — 원본 Ultra Rare 8~17장이 통째로 Hyper rare로
//    올라가서, 확률표의 Ultra Rare 자리(2.35%)가 텅 비고 그 몫이 일반 레어로 샜다.
//    실측(ja-SV3 2만 팩): Ultra Rare 확률표 2.35% → 실제 0장.
//    빈 것이 있는지는 `npx tsx scripts/check-packsets.mts`가 알려준다.
const JP_RARITY_ALIAS: Record<string, string> | undefined = undefined;

// ⚠️ 블랙볼트·화이트플레어는 이 어긋남이 없다. 'Secret Rare'가 아예 없고 번호도 다르다:
//   159~166번 Ultra Rare 8장(= SR) · 167~173번 SAR 7장 · 174번 Black White Rare 1장(= 최상위)
// 여기에 위 맞바꿈을 쓰면 SR 8장이 금색 UR 자리로 올라가 버린다. 최상위 이름만 바꾼다
// (영문판 자매편 en-sv10.5b도 같은 처리를 하고 있다).
const JP_BW_RARITY_ALIAS: Record<string, string> = { 'Black White Rare': 'Hyper rare' };

// 일본판 메가 시리즈. 최상위 MUR이 데이터에는 'Mega Hyper Rare'로 적혀 있는데
// (번호 맨 끝 1장 — M5 118번·M4 120번·M3 117번 등으로 확인) 확률표는
// 'Mega Ultra Rare'를 찾는다. 이름이 달라 그 한 장이 아예 안 뽑혔다.
// SR·UR 어긋남은 SV 세트와 같으므로 위 맞바꿈을 그대로 이어 쓴다.
// ⚠️ M2(인페르노X)만 최상위가 'Ultra Rare'로 적혀 있어, 위 맞바꿈이 그걸
//    'Hyper rare'로 올린다. 그 세트는 확률표에 Hyper rare가 없으므로 따로 지정한다.
// M5·M4·M3·M1L은 SR 자리가 이미 'Ultra Rare'다(18장, 번호 94~). 맞바꾸면 그게 최상위로
// 올라가 버리므로 최상위 이름만 바꾼다.
const JP_MEGA_TOP_ONLY: Record<string, string> = { 'Mega Hyper Rare': 'Mega Ultra Rare' };
// M1S도 이제 SR 자리가 'Ultra Rare'다(11장). 최상위 이름만 바꾸면 된다.
const JP_MEGA_RARITY_ALIAS: Record<string, string> = { 'Mega Hyper Rare': 'Mega Ultra Rare' };
// M2(인페르노X)는 최상위가 이미 'Mega Ultra Rare' 1장으로 적혀 있어 바꿀 게 없다.
const JP_M2_RARITY_ALIAS: Record<string, string> | undefined = undefined;

const JP = (id: string, name: string, price = 1600, extra: Partial<PackSet> = {}): PackSet => ({
  slug: `ja-${id}`,
  label: `[일본판] ${name}`,
  src: `/packsim/ja-${id}.json`,
  jp: true,
  // ⚠️ 일본판은 대부분 ACE SPEC 카드가 없다(27개 중 21개). ACE를 확률표에 두면 절대
  //    안 나오는 등급을 광고하는 셈이라 기본값에서 뺀다(위 withoutAce 설명 — 빠진 몫은
  //    일반 레어로 가므로 다른 등급 확률은 그대로다).
  //    ⚠️ 다만 SV5K·SV5a·SV6·SV7·SV7a·SV8 여섯 세트는 ACE가 2~3장 들어 있다. 그 여섯만
  //       JP_REGULAR(ACE 포함)를 따로 준다 — 안 그러면 그 카드들이 영영 안 나온다.
  profile: JP_REGULAR_NO_ACE,
  price,
  boxPacks: 30,
  rarityAlias: JP_RARITY_ALIAS,
  ...extra,
});
const NA = (id: string, name: string, profile = NA_REGULAR, price = 6500, extra: Partial<PackSet> = {}): PackSet => ({
  slug: `en-${id}`,
  label: `[영문판] ${name}`,
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
  JP('M5', '어비스아이', 1800, { profile: JP_MEGA, rarityAlias: JP_MEGA_TOP_ONLY }),
  JP('M4', '닌자스피너', 1800, { profile: JP_MEGA, rarityAlias: JP_MEGA_TOP_ONLY }), // 2026-05 세대부터 200엔
  JP('M3', '니힐제로', 1600, { profile: JP_MEGA, rarityAlias: JP_MEGA_TOP_ONLY }),
  JP('M1L', '메가브레이브', 1600, { profile: JP_MEGA, rarityAlias: JP_MEGA_TOP_ONLY }),
  JP('M1S', '메가심포니아', 1600, { profile: JP_MEGA, rarityAlias: JP_MEGA_RARITY_ALIAS }),
  JP('SV11B', '블랙볼트', 1600, { profile: JP_REGULAR_NO_ACE, rarityAlias: JP_BW_RARITY_ALIAS }), // ACE 수록 없음(세트 데이터 확인)
  JP('SV11W', '화이트플레어', 1600, { profile: JP_REGULAR_NO_ACE, rarityAlias: JP_BW_RARITY_ALIAS }),
  JP('SV10', '로켓단의 영광', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV9', '배틀파트너즈', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV8', '초전브레이커', 1600, { profile: JP_REGULAR }), // ACE SPEC 2장 수록 — 확률표에 ACE를 둬야 나온다
  JP('SV7', '스텔라미라클', 1600, { profile: JP_REGULAR }), // ACE SPEC 3장 수록 — 확률표에 ACE를 둬야 나온다
  JP('SV6', '변환의 가면', 1600, { profile: JP_REGULAR }), // ACE SPEC 2장 수록 — 확률표에 ACE를 둬야 나온다
  JP('SV3', '흑염의 지배자', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV2a', '포켓몬 카드 151', 2600, { profile: JP_151, godRate: 1 / 750, mirror: 'jp151', boxPacks: 20 }), // 특수팩: 290엔·7장·20팩 박스·갓팩 존재
  // ── SV 시대 5장팩(2023~2025) ─────────────────────────────────────────────
  // 등급 구성이 초전브레이커·스텔라미라클과 같아(AR 12 · SR 9~10 · SAR 5 · UR 2~3 · RR 6)
  // 같은 확률표를 쓴다 — 사용자 확인 완료(2026-08-02). ACE 수록 여부만 세트별로 갈린다
  // (세트 데이터로 직접 확인). 전부 2026-04 이전 발매라 정가 180엔 ≈ 1,600원.
  JP('SV9a', '열풍의 아레나', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV7a', '낙원드래고나', 1600, { profile: JP_REGULAR }), // ACE SPEC 2장 수록 — 확률표에 ACE를 둬야 나온다
  JP('SV5a', '크림슨헤이즈', 1600, { profile: JP_REGULAR }), // ACE SPEC 3장 수록 — 확률표에 ACE를 둬야 나온다
  JP('SV5K', '와일드포스', 1600, { profile: JP_REGULAR }), // ACE SPEC 2장 수록 — 확률표에 ACE를 둬야 나온다
  JP('SV4M', '미래의 일섬', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV4K', '고대의 포효', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV3a', '레이징서프', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV2P', '스노해저드', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV2D', '클레이버스트', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV1a', '트리플렛비트', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV1V', '바이올렛 ex', 1600, { profile: JP_REGULAR_NO_ACE }),
  JP('SV1S', '스칼렛 ex', 1600, { profile: JP_REGULAR_NO_ACE }),
  // 일본판 메가 시리즈. 어비스아이와 등급 구성이 같아 같은 표(사용자 확인, 2026-08-02).
  JP('M2', '인페르노X', 1600, { profile: JP_MEGA, rarityAlias: JP_M2_RARITY_ALIAS }),
  // 영문판 10장 부스터팩 — public/sets에 레어도를 채워 둔다. scripts/fill-rarity.mjs
  // 이름은 정식 한글명이 따로 없어(한국판은 일본판 이름 체계) 영어명 음역을 쓴다.
  NA('me01', '메가 에볼루션', NA_MEGA),
  NA('sv10', '데스틴드 라이벌즈', NA_REGULAR_NO_ACE), // ACE 수록 없음(세트 데이터 확인)
  NA('sv09', '저니 투게더', NA_REGULAR_NO_ACE),
  NA('sv08.5', '프리즈매틱 이볼루션즈', NA_PRISMATIC, 6500, { godRate: 1 / 1000, boxPacks: 0, mirror: 'prismatic' }), // 특별세트(36팩 박스 없음), 갓팩 존재
  NA('sv08', '서징 스파크스'),
  NA('sv07', '스텔라 크라운'),
  NA('sv06', '트와일라잇 마스커레이드'),
  NA('sv03.5', '151', NA_151, 6500, { godRate: 1 / 1000, boxPacks: 0 }), // 특별세트, 갓팩 존재
  NA('sv03', '옵시디언 플레임즈', NA_REGULAR_NO_ACE), // ACE 부활 이전 세트
  // 영문판 메가 시리즈 — me01과 등급 구성이 같아 같은 표(사용자 확인, 2026-08-02).
  // 최상위가 원본에 'Secret Rare'로 적혀 있어 me01의 MHR 자리로 바꿔 준다(세트당 1장).
  NA('me05', '피치 블랙', NA_MEGA, 6500, { rarityAlias: { 'Secret Rare': 'Mega Hyper Rare' } }),
  NA('me04', '카오스 라이징', NA_MEGA, 6500, { rarityAlias: { 'Secret Rare': 'Mega Hyper Rare' } }),
  NA('me03', '퍼펙트 오더', NA_MEGA, 6500, { rarityAlias: { 'Secret Rare': 'Mega Hyper Rare' } }),
  NA('me02', '팬타스말 플레임즈', NA_MEGA, 6500, { rarityAlias: { 'Secret Rare': 'Mega Hyper Rare' } }),
  // 영문판 블랙볼트·화이트플레어 — 일본판(SV11B·SV11W)의 북미 발매판. ACE 수록 없음.
  // 최상위(일본판 금색 UR 자리)가 세트당 2장이고, 원본이 자매편끼리도 이름을 다르게
  // 적어 뒀다. 확률은 그대로 두고 풀에 2장이 있으니 둘이 그 확률을 나눠 갖는다.
  NA('sv10.5b', '블랙 볼트', NA_REGULAR_NO_ACE, 6500, { rarityAlias: { 'Black White Rare': 'Hyper rare' } }),
  NA('sv10.5w', '화이트 플레어', NA_REGULAR_NO_ACE, 6500, { rarityAlias: { 'Secret Rare': 'Hyper rare' } }),
  // 샤이니 특별세트(일본판 샤이니트레저 ex·테라스탈 페스타, 영문판 Paldean Fates)는
  // 카드 대부분이 '샤이니' 등급이라 위 확률 프로필이 안 맞는다. 전용 프로필을 만든 뒤에 넣는다.
];

// PPT(PokemonPriceTracker)에서 각 세트를 부르는 이름. 앨범 시세 수집(warm)에 쓴다.
// ⚠️ 전부 PPT API로 직접 확인한 문자열만 적는다(추측 금지). m1L·m1S는 소문자 m이 맞다.
export const PPT_SET_NAMES: Record<string, string> = {
  // 일본판
  // 2026-07-31 발매. 빠져 있어서 시세를 아예 못 받고 있었다(2026-08-04 확인).
  'ja-M6': 'M6: Storm Emeralda',
  'ja-M5': 'M5: Abyss Eye',
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
  'ja-M2': 'M2: Inferno X',
  'ja-SV9a': 'SV9a: Heat Wave Arena',
  'ja-SV7a': 'SV7a: Paradise Dragona',
  'ja-SV6a': 'SV6a: Night Wanderer',
  'ja-SV5a': 'SV5a: Crimson Haze',
  'ja-SV5M': 'SV5M: Cyber Judge',
  'ja-SV5K': 'SV5K: Wild Force',
  'ja-SV4M': 'SV4M: Future Flash',
  'ja-SV4K': 'SV4K: Ancient Roar',
  'ja-SV3a': 'SV3a: Raging Surf',
  'ja-SV2P': 'SV2P: Snow Hazard',
  'ja-SV2D': 'SV2D: Clay Burst',
  'ja-SV1a': 'SV1a: Triplet Beat',
  'ja-SV1V': 'SV1V: Violet ex',
  'ja-SV1S': 'SV1S: Scarlet ex',
  // 영문판
  'en-me01': 'ME01: Mega Evolution',
  'en-sv10': 'SV10: Destined Rivals',
  'en-sv09': 'SV09: Journey Together',
  'en-sv08.5': 'SV: Prismatic Evolutions',
  'en-sv08': 'SV08: Surging Sparks',
  'en-sv07': 'SV07: Stellar Crown',
  'en-sv06': 'SV06: Twilight Masquerade',
  'en-sv03.5': 'SV: Scarlet & Violet 151',
  'en-sv03': 'SV03: Obsidian Flames',
  'en-me05': 'ME05: Pitch Black',
  'en-me04': 'ME04: Chaos Rising',
  'en-me03': 'ME03: Perfect Order',
  'en-me02': 'ME02: Phantasmal Flames',
  'en-sv10.5b': 'SV: Black Bolt',
  'en-sv10.5w': 'SV: White Flare',
};

// ── 오늘의 진열대 ─────────────────────────────────────────────────────────
// 매일 일본판 3팩 + 영문판 3팩을 랜덤으로 진열한다. 날짜(한국시간)를 시드로 쓰는
// 결정적 셔플이라 서버와 화면이 따로 맞출 필요 없이 같은 답을 얻고, 자정에 바뀐다.
// 22팩 전부 시세를 미리 받아두므로(PPT_SET_NAMES) 어떤 팩이 떠도 시세는 바로 뜬다.
// 규칙은 src/lib/kstDay.ts 한 벌뿐이다. 여기서는 이어서 내보내기만 한다.
export { kstDateStr } from './kstDay.ts';
import { kstDateStr } from './kstDay.ts';

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
// GP는 pokegre 안에서만 쓰는 포인트(1GP=정가 1원 기준 숫자). 하루치로 일본판 18팩 / 영문판 4팩쯤
// 살 수 있게 잡았다 — "뭘 살지" 고민이 생기는 선. 더 적으면 선택이 없고, 더 많으면
// 아무거나 다 살 수 있어서 역시 선택이 사라진다.
export const DAILY_BUDGET = 30000;
export const FIRST_BONUS = 50000; // 처음 출석하면 바로 여러 팩을 까볼 수 있게
export const STREAK_DAYS = 7; // 연속 출석 보너스 주기
export const STREAK_BONUS = 30000;
// 안 들어온 날짜만큼 무한정 쌓이면 어느 날 한 번에 털고 다시 안 온다. 상한을 두면
// "모았으니 이제 쓰자"가 되고, 그래도 영문판 부스터 46개를 한 번에 지를 수 있다.
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
