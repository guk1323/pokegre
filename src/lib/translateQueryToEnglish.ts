import {
  CARD_NAME_KO_TO_EN,
  CARD_NAME_KO_TO_EN_LONG,
  CARD_NAME_KO_TO_EN_NOSPACE,
  STRUCTURAL_EN_TO_KO,
} from './koreanizeEnglishTitle';
// 사람들이 실제로 치는 표기 → 공식 한글 표기. 한글→일본어 쪽과 같은 목록을 쓴다
// (거기가 원본이다. 한쪽에만 넣어 두면 이베이 검색만 계속 빗나간다).
import { KO_SEARCH_ALIASES } from './translateQuery';
import pokemonNames from '../data/pokemonNames.json';
import pokemonNameAliases from '../data/pokemonNameAliases.json';
import packNames from '../data/packNames.json';
import cardNameKoEn from '../data/cardNameKoEn.json';

// 한글 카드명 → 영문 카드명. scripts/gen-ko-en-cards.mts가 자동으로 만든다(우리 일본어
// 카드명을 화면에 나오는 한글로 바꾼 뒤, 같은 카드의 영문명을 PPT 자료에서 번호로 찾아
// 짝지은 것). 손으로 넣은 사전(CARD_NAME_KO_TO_EN)에 없는 것만 여기서 메운다.
//
// 왜 필요한가: 한글로 검색할 때 스니커덩크는 결과가 나오는데 eBay·TCGplayer는 0건이던
// 카드가 674종 있었다. 사전 두 벌의 촘촘함이 달라서 생긴 차이다.
const AUTO_KO_TO_EN = new Map<string, string>(Object.entries(cardNameKoEn as Record<string, string>));
const AUTO_KO_TO_EN_NOSPACE = new Map<string, string>(
  [...AUTO_KO_TO_EN].map(([ko, en]) => [ko.replace(/[\s·]/g, ''), en]),
);
// ⚠️ 자동 사전은 "카드 이름 전체가 일치할 때"만 쓴다. 부분 치환에 올렸더니 '침바루'가
// '히스이 장침바루' 속에 끼어들어 "Hisuian 장Qwilfish"가 됐다. 손으로 넣고 검증한 사전과
// 달리 자동 생성물이라, 조각내 쓰는 건 위험 대비 얻는 게 적다.

interface PokemonName {
  id: number;
  ko: string;
  ja: string;
  en: string;
}

interface PackName {
  code: string;
  ja: string;
  ko: string;
}

// 모습이 다른 포켓몬(오리진디아르가·오리진펄기아)은 기본 이름 사전에 없어 한글 그대로
// 나갔다. 별칭 사전으로 그 빈칸만 메운다.
// ⚠️ 빈칸만 메운다. 이름 사전이나 자동 사전이 이미 답을 갖고 있으면 그쪽이 이긴다.
//    별칭의 영어가 정식 카드명과 다를 때가 있다(스핀로토무: 별칭 "Spin Rotom" /
//    자동 사전 "Fan Rotom" — 정식은 Fan Rotom이다).
// ⚠️ "리자몽 ★"류는 지금 "Charizard ★"로 나가고 그대로 검색이 되므로 건드리지 않는다.
const aliasKoEn = (() => {
  const known = new Set((pokemonNames as PokemonName[]).map((e) => e.ko).filter(Boolean));
  const auto = cardNameKoEn as Record<string, string>;
  return (pokemonNameAliases as { ko?: string; en?: string }[])
    .filter(
      (e) =>
        e.ko &&
        e.en &&
        !known.has(e.ko) &&
        !auto[e.ko] &&
        !e.ko.includes('★') &&
        /^[A-Za-z0-9 '.-]+$/.test(e.en),
    )
    .map((e) => ({ ko: e.ko as string, en: e.en as string }));
})();

// 긴 이름부터 치환해야 "리자드"가 "리자몽" 안에서 먼저 걸려 이름이 깨지는 걸 막을 수 있다.
const sortedPokemonKoEn = [...(pokemonNames as PokemonName[]), ...aliasKoEn]
  .filter((entry) => entry.ko && entry.en)
  .sort((a, b) => b.ko.length - a.ko.length);

// 포켓몬 이름(한글) 집합. 팩 이름이 하필 포켓몬 이름과 똑같은 경우(WCS23="피카츄",
// 월드챔피언 프로모)를 팩 매칭에서 걸러내는 데 쓴다. 그런 팩은 검색 의도가 십중팔구
// "그 포켓몬 카드"라, 팩 코드로 보내면 엉뚱한 결과가 나온다.
const pokemonKoSet = new Set(sortedPokemonKoEn.map((e) => e.ko));

// "메가디안시"처럼 메가 진화 이름이 붙어 오면 통째로 바꿔야 한다. 그냥 두면 안쪽의
// "가디안"(Gardevoir)이 먼저 걸려 "메Gardevoir시"가 된다. 반대로 메가자리(Yanmega)·
// 메가니움(Meganium)은 이름 자체가 메가로 시작하므로, 원래 이름을 먼저 놓고
// 긴 것부터 맞춘다.
const pokemonWithMega = [
  ...sortedPokemonKoEn.map((e) => ({ ko: e.ko, en: e.en })),
  ...sortedPokemonKoEn.map((e) => ({ ko: `메가${e.ko}`, en: `Mega ${e.en}` })),
].sort((a, b) => b.ko.length - a.ko.length);

const STRUCTURAL_EN_TERMS: [string, string][] = [
  ['메가', 'Mega '],
  ['찬란한', 'Radiant '], // "찬란한 리자몽"으로 검색하면 Radiant Charizard가 잡히게.
  // 소유격 트레이너 접두어(로켓단의 영광 이후 세트). koreanizeEnglishTitle의 반대 방향이다 —
  // 이게 없으면 "로켓단의 뮤츠 ex"가 "로켓단의 Mewtwo ex"로 반만 번역돼 검색이 빗나간다.
  // 어포스트로피는 TCGplayer 표기대로 곧은 것(')을 쓴다.
  ['로켓단의', "Team Rocket's "],
  ['심향의', "Ethan's "],
  ['이슬의', "Misty's "],
  ['난천의', "Cynthia's "],
  ['성호의', "Steven's "],
  ['페퍼의', "Arven's "],
  ['마리의', "Marnie's "],
  ['릴리에의', "Lillie's "],
  ['모야모의', "Iono's "],
  ['호프의', "Hop's "],
  // 지역폼 접두사도 같은 이유로 되돌린다.
  ['가라르', 'Galarian '],
  ['알로라', 'Alolan '],
  ['히스이', 'Hisuian '],
  ['팔데아', 'Paldean '],
  // ── 2026-08-02: 이베이·TCGplayer 검색에서 한글로 남던 말들 ───────────────
  // 북미판 세트 데이터에서 실제 표기를 확인하고 넣었다(δ는 이름 뒤에 붙는다).
  ['(델타종)', 'δ'], // 독침붕 (델타종) → Beedrill δ. 150종
  ['나쁜 ', 'Dark '], // 나쁜 냄새꼬 → Dark Koffing. 옛 로켓단 세트
  ['상냥한 ', 'Light '], // 상냥한 해루미 → Light Sunflora
  ['기술머신', 'Technical Machine'],
  ['화석', 'Fossil'],
  // ── 2026-08-03: 방문자가 실제로 친 검색어 578종을 돌려 보고 찾은 것 ─────────
  // 흔한 낱말인데 통째로 빠져 있어 한글이 그대로 이베이·TCGplayer로 나갔다.
  // 카드 이름이 아니라 "어떤 카드를 찾는지" 좁히는 말이라, 우리 세트·카드 데이터에서
  // 실제 표기를 확인한 것만 넣는다(추측 금지).
  ['프로모', 'Promo'], // 세트 12개가 "…Promos". 9번 검색됨 — 이 목록에서 제일 많다
  ['맥도날드', "McDonald's"], // 세트 12개가 "McDonald's Collection …"
  ['체육관', 'Gym'], // 세트 "Gym Challenge"·카드 "Aspertia City Gym"
  ['에너지', 'Energy'], // 북미판 카드 이름에 646번
  ['트레이너', 'Trainer'], // 카드 이름에 11번("Coach Trainer")
  ['초판', '1st Edition'], // 카드 이름이 아니라 이베이 매물에 붙는 말
  // ⚠️ 긴 것을 먼저 놔야 한다. "포켓몬"만 넣었더니 "포켓몬스터"가 「Pokemon스터」로
  //    쪼개졌다(아래 STRUCTURAL_EN_TERMS는 적힌 순서대로 돈다).
  ['포켓몬스터', 'Pocket Monsters'], // 이베이 실측: 이 이름으로 매물이 잡힌다("…Pocket Monster Recover")
  ['포켓몬', 'Pokémon'], // 북미판 카드 이름에 81번("Pokémon Flute"). é까지 그대로 쓴다
  ['배틀', 'Battle'], // 카드·세트 이름에 15번("Battle City")
  // 트레이너 소유격. 우리 일본판 카드명과 북미판 카드명을 같은 포켓몬으로 짝지어
  // 확인한 것만 담았다(scripts로 뽑고 표가 갈리지 않는 것만 골랐다).
  ['웅의', "Brock's "],
  ['민화의', "Erika's "],
  ['독수의', "Koga's "],
  ['코가의', "Koga's "], // 같은 인물인데 옛 세트는 이름을 그대로 적어 뒀다
  ['초련의', "Sabrina's "],
  ['강연의', "Blaine's "],
  ['마티스의', "Lt. Surge's "],
  ['비주기의', "Giovanni's "],
  ['청목의', "Larry's "],
  ['N의', "N's "],
  ['호브의', "Hop's "],
  ['마그마단의', "Team Magma's "],
  ['아쿠아단의', "Team Aqua's "],
  ['홀론의', "Holon's "],
];

// 화면에 쓰는 구조어 표(koreanizeEnglishTitle)를 뒤집어 검색 쪽을 자동으로 채운다.
// 예전에는 양쪽을 따로 손으로 적었는데, 화면 쪽에만 낱말을 늘리면 그 이름으로는
// 검색이 안 됐다("다크 망나뇽"이 보이는데 쳐도 안 나오던 것). 한쪽만 고치는 실수를
// 구조적으로 막으려고 한 곳에서 가져온다. 위에 손으로 적은 것이 있으면 그게 이긴다
// (TCGplayer 표기에 맞춘 어포스트로피 같은 세부가 있어서다).
const handWritten = new Set(STRUCTURAL_EN_TERMS.map(([ko]) => ko));
for (const [en, ko] of STRUCTURAL_EN_TO_KO) {
  const k = ko.trim();
  if (!k || handWritten.has(k)) continue;
  handWritten.add(k);
  STRUCTURAL_EN_TERMS.push([k, en.trim() + ' '].map((v) => v.replace(/[’]/g, "'")) as [string, string]);
}

const longestFirstTerms = [
  ...pokemonWithMega,
  ...STRUCTURAL_EN_TERMS.map(([ko, en]) => ({ ko, en })),
].sort((a, b) => b.ko.length - a.ko.length);

// 북미판(english) 전용. 한글(일본판) 팩 이름 → 영문판 세트명. 일본판과 영문판은
// 발매 단위가 1:1로 안 맞아서(일본판 두 팩이 영문판 한 세트로 묶이고, 수록 카드도
// 다르다) 가장 가까운 세트로 잇는다. 팩 이름을 친 사람은 "그 시기 그 카드들"을 찾는
// 것이므로 이 정도면 목적에 닿는다.
const PACK_KO_EN: [string, string][] = [
  ['포켓몬카드 151', '151'],
  ['흑염의 지배자', 'Obsidian Flames'],
  ['클레이버스트', 'Paldea Evolved'],
  ['스노우해저드', 'Paldea Evolved'],
  ['스칼렛ex', 'Scarlet & Violet'],
  ['바이올렛ex', 'Scarlet & Violet'],
  ['고대의 포효', 'Paradox Rift'],
  ['미래의 일섬', 'Paradox Rift'],
  ['샤이니트레저 ex', 'Paldean Fates'],
  ['와일드포스', 'Temporal Forces'],
  ['사이버저지', 'Temporal Forces'],
  ['변환의 가면', 'Twilight Masquerade'],
  ['나이트원더러', 'Shrouded Fable'],
  ['스텔라미라클', 'Surging Sparks'],
  ['초전브레이커', 'Surging Sparks'],
  ['테라스탈 페스타 ex', 'Prismatic Evolutions'],
  ['배틀파트너즈', 'Journey Together'],
  ['로켓단의 영광', 'Destined Rivals'],
  ['블랙볼트', 'Black Bolt'],
  ['화이트플레어', 'White Flare'],
  ['VSTAR 유니버스', 'Crown Zenith'],
  ['로스트어비스', 'Lost Origin'],
  ['패러다임트리거', 'Silver Tempest'],
  ['스타버스', 'Brilliant Stars'],
  ['이브이 히어로즈', 'Evolving Skies'],
  ['창공의스트림', 'Evolving Skies'],
  ['샤이니스타V', 'Shining Fates'],
  ['백은의 랜스', 'Chilling Reign'],
  ['칠흑의 가이스트', 'Chilling Reign'],
  ['퓨전아츠', 'Fusion Strike'],
  ['일격마스터', 'Battle Styles'],
  ['연격마스터', 'Battle Styles'],
  ['태그볼트', 'Team Up'],
  ['미라클트윈', 'Unified Minds'],
  ['얼터제네시스', 'Cosmic Eclipse'],
  ['빛나는 전설', 'Shining Legends'],
  ['명탐정 피카츄', 'Detective Pikachu'],
];

// "샤이니트레저 ex"로 등록돼 있어도 "샤이니 트레저ex"라고 치는 사람이 더 많아서,
// 글자 사이 공백을 무시하고 맞춘다(translateQuery.ts와 같은 방식).
//
// 팩 이름 바로 뒤에 한글이 띄어쓰기 없이 이어지면 팩이 아니라 카드 이름이다.
// PMCG4의 팩 이름이 "로켓단"이라 "로켓단의 뮤츠 Ex"가 "PMCG4's Mewtwo Ex"로,
// "로켓단등장!"이 "PMCG4등장!"으로 나갔다(2026-08-02 실측 36건, 전부 로켓단 카드).
// "로켓단"만 치거나 "로켓단 뮤츠"처럼 띄어 치면 팩 검색이 그대로 살아난다.
function packPattern(name: string): RegExp {
  const body = [...name.replace(/\s+/g, '')].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp(`${body}(?![가-힣])`, 'gi');
}

const packEnPatterns = [...PACK_KO_EN]
  .filter(([ko]) => !pokemonKoSet.has(ko))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([ko, en]) => ({ re: packPattern(ko), en }));

// 일본판(japanese) 전용. PokemonPriceTracker의 일본판 세트명은 "SV3: Ruler of the
// Black Flame"처럼 항상 팩 코드로 시작하고, 그 코드로 검색하면 해당 팩만 정확히
// 걸린다. 코드는 packNames.json에 전부 있으니 영문 제목을 따로 추측할 필요가 없다.
// (영문판에서는 코드가 엉뚱한 세트에 걸리므로 일본판에만 쓴다.)
const packJpPatterns = (packNames as PackName[])
  .filter((entry) => entry.ko && entry.code)
  .flatMap((entry) => {
    const names = [entry.ko];
    const tail = entry.ko.split(/\s*:\s*/).pop()?.trim();
    if (tail && tail.length >= 3 && tail !== entry.ko) names.push(tail);
    return names.map((ko) => ({ ko, en: entry.code }));
  })
  // 이름이 통째로 포켓몬 이름인 팩(예: WCS23="피카츄")은 뺀다 — 포켓몬 검색을 가로챈다.
  .filter(({ ko }) => !pokemonKoSet.has(ko))
  .sort((a, b) => b.ko.length - a.ko.length)
  .map(({ ko, en }) => ({ re: packPattern(ko), en }));

// PokemonPriceTracker API의 search 파라미터는 TCGPlayer 표기(영문) 기준이라, 한글
// 검색어를 영문 포켓몬 이름으로 치환해서 보낸다. translateQuery.ts(한글→일본어)와
// 동일한 부분 문자열 치환 방식을 쓴다.
// edition='korean'은 이베이 한글판(Browse API) 경로라 이 PPT용 번역엔 안 오지만, 타입
// 호환을 위해 받아만 두고 영문판과 같게 처리한다(실제로는 호출되지 않음).
// 일본판을 찾을 때만 쓰는 사전. 화면 이름은 건드리지 않는다.
const JP_SEARCH_ONLY: Record<string, string> = {
  // 같은 카드인데 PPT가 다른 낱말로 적어 둔 것들. 세트 번호가 맞는 것만 담았다
  // (세트별로 일치율 70% 넘는 것만 믿는다). 화면 이름은 그대로 두고 검색만 맞춘다.
  // 영국 축구협회 프로모 5종. 화면에는 "공을 안은 피카츄"로 쓰지만 수집가들은
  // "피카츄 온 더 볼"로도 부른다. 그렇게 쳐도 찾게 검색어로만 받아 둔다.
  // 방문자가 자주 찾는데 우리 카드 데이터에는 아직 없는 것(사용자가 공식명 확인,
  // 2026-08-03). 데이터가 없으면 자동 사전이 못 만들어 주므로 여기 손으로 적는다.
  캡틴피카츄: 'Captain Pikachu', // SV 프로모. 6번 검색됨
  '붉은 섬광': 'Red Flash', // 세트 이름(ja-XY8b). 이베이 매물도 이 이름을 쓴다(실측)
  '푸른 충격': 'Blue Shock', // 같은 시기 짝 세트(ja-XY8a). 이베이 실측으로 확인
  '피카츄 온 더 볼': 'Pikachu on the Ball',
  '이브이 온 더 볼': 'Eevee on the Ball',
  '흥나숭 온 더 볼': 'Grookey on the Ball',
  '염버니 온 더 볼': 'Scorbunny on the Ball',
  '울머기 온 더 볼': 'Sobble on the Ball',
  '마티스의 거래': "Lt. Surge's Deal",
  로켓단의리시버: "Team Rocket's Transceiver",
  파이팅공: 'Fight Gong',
  로켓단에너지: "Team Rocket's Energy",
  '청목의 수완': "Larry's Efficiency",
  '아이언 디펜더': 'Iron X Defense',
  '활력의 숲': 'Vitality Forest',
  '괴상한 시계': 'Strange Timepiece',
  추리세트: 'Deduction Kit',
  느긋풀: 'Chill Teaser Toy',
  '용의 비약': 'Dragon Elixir',
  '로켓단의 깜짝봄': "Team Rocket's Venture Bomb",
  'N의 방안': "N's Plan",
  스파이크에너지: 'Spiky Energy',
  '리치 에너지': 'Enriching Energy',
  시간벌기터보: 'Wait and See Turbo',
  안전고글: 'Protective Goggles',
  타이트밴드: 'Rigid Band',
  '시트론의 재치': "Clemont's Wit",
  낚싯대MAX: 'Fishing Rod MAX',
  뉴트럴센터: 'Neutralization Zone',
  // ⚠️ 아래는 담지 않는다 — PPT 쪽 번호가 어긋나 딴 카드 이름이 붙어 있다.
  //   기본 물 에너지 → Basic Psychic Energy · 켄타로스 → Waitress · 버프론 ex → Herdier
  // 주리 → Fennel도 뺐다. 우리 사전은 Thorton이라 인물이 아예 다르다(확인 필요).
};

// PPT 표기에 맞춰 다듬는다. 사전에서 통째로 찾아 바로 돌려주는 길도 있어서,
// 마지막에 한 번만 하면 안 되고 나가는 모든 길에 걸어야 한다.
//  · 악센트를 뗀다 — PPT는 Flabébé를 "Flabebe", Pokémon Catcher를 "Pokemon Catcher"로 색인한다.
//  · 성별 기호를 글자로 바꾼다 — "Nidoran F" · "Nidoran M".
function forPpt(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // ⚠️ NFD는 한글도 자모로 쪼갠다("남" → ㄴ+ㅏ+ㅁ). 그대로 두면 아직 한글로 남은
      // 검색어가 깨진 채 나간다. 악센트를 뗀 뒤 반드시 도로 합친다.
      .normalize('NFC')
      .replace(/\s*♀/g, ' F')
      .replace(/\s*♂/g, ' M')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function translateSearchQueryToEnglish(
  query: string,
  edition: 'japanese' | 'english' | 'korean' = 'japanese',
): string {
  let trimmed = query.trim();
  if (!trimmed) return trimmed;
  // 사람들이 치는 표기를 공식 표기로 먼저 고친다. 아래 "이름이 통째로 일치하나" 검사보다
  // 앞이어야 한다 — "이슬이"를 고쳐 놔야 "이슬"로 통째 일치가 잡힌다.
  for (const [typed, official] of KO_SEARCH_ALIASES) {
    if (trimmed.includes(typed)) trimmed = trimmed.split(typed).join(official);
  }

  // 검색어가 포켓몬 이름과 정확히 같으면 팩 매칭을 건너뛰고 바로 그 포켓몬으로 보낸다.
  // (팩 이름과 같은 이름이어도 포켓몬 카드 검색이 우선이다.)
  const exact = sortedPokemonKoEn.find((e) => e.ko === trimmed);
  if (exact) return forPpt(exact.en);
  // 트레이너·굿즈·스타디움 한글 카드명이 통째로 들어오면 그대로 영문명으로 바꾼다.
  // 짧은 이름(추명·이슬 등)도 여기서는 안전하다 — 전체가 일치할 때만이라서.
  // 띄어쓰기가 달라도 같은 카드로 본다("테라스탈오브" = "테라스탈 오브").
  // 같은 한글 이름이라도 판에 따라 영문명이 다르다. PPT는 일본판 카드에 자기네 영문
  // 번역을 붙이는데, 그게 북미판 정식 이름과 다른 경우가 많다
  // ("아이언 디펜더"가 북미판은 Iron Defender, 일본판은 Iron X Defense).
  // 그래서 일본판을 찾을 때는 PPT에서 받아 만든 자동 사전을 먼저 본다.
  const lookup = (ko: string) => {
    const ns = ko.replace(/[\s·]/g, '');
    const a = JP_SEARCH_ONLY[ko] ?? AUTO_KO_TO_EN.get(ko) ?? AUTO_KO_TO_EN_NOSPACE.get(ns);
    const h = CARD_NAME_KO_TO_EN.get(ko) ?? CARD_NAME_KO_TO_EN_NOSPACE.get(ns);
    return edition === 'japanese' ? (a ?? h) : (h ?? a);
  };
  const exactCard = lookup(trimmed);
  if (exactCard) return forPpt(exactCard);
  // 뒤에 레어도를 붙여 치는 사람이 많다("보미카의 연주 sar"). 통이름 일치는 검색어가
  // 딱 맞을 때만 되므로 그대로 두면 사전에 있는 카드도 못 찾는다 — 실제로 "보미카의
  // 연주 sar"가 「Roxie's 연주 sar」로, "규리의 눈빛 sr"은 통째로 한글로 나갔다.
  // 레어도만 떼고 한 번 더 보고, 찾으면 레어도를 도로 붙여 준다(매물 제목에도 붙어 있다).
  // ⚠️ 사전이 변형판 표시를 달고 있는 이름이 있다("N's Reshiram (Energy Symbol
  //    Pattern)"). 레어도를 따로 친 사람은 기본판을 찾는 것이므로 괄호는 뗀다 —
  //    안 떼면 「… (Poke Ball Pattern) SAR」로 나가 매물이 하나도 안 걸린다(48건).
  const rarityTail = trimmed.match(/^(.+?)\s+((?:SAR|SR|UR|AR|HR|RR|RRR|CHR|CSR|SSR|K|A)(?:\s+\S+)?)$/i);
  if (rarityTail) {
    const found = lookup(rarityTail[1].trim())?.replace(/\s*\([^)]*\)\s*$/, '');
    if (found) return `${forPpt(found)} ${rarityTail[2].toUpperCase()}`;
  }

  let result = trimmed;
  // 팩 이름이 가장 구체적이라 제일 먼저 잡는다. 짧은 일반어를 먼저 바꾸면 팩 이름이
  // 조각나 안 걸린다. 일본판은 팩 코드로, 북미판은 영문 세트명으로 간다.
  for (const { re, en } of edition === 'japanese' ? packJpPatterns : packEnPatterns) {
    re.lastIndex = 0;
    if (re.test(result)) {
      re.lastIndex = 0;
      result = result.replace(re, en);
    }
  }
  // 카드명이 문장 일부로 들어온 경우("벽록의 가면 오거폰 SAR")도 바꿔 준다.
  // 긴 이름부터 처리해야 짧은 이름이 먼저 걸려 조각나지 않는다.
  for (const [ko, en] of CARD_NAME_KO_TO_EN_LONG) {
    if (result.includes(ko)) {
      result = result.split(ko).join(en);
    }
  }
  // 포켓몬 이름과 구조어를 한 줄에 세워 긴 것부터 바꾼다. 둘을 따로 돌리면 어느 쪽을
  // 먼저 하든 반쪽이 난다 — 포켓몬을 먼저 하면 "마그마단의"의 앞 세 글자가 마그마
  // (Magmar)로 먹히고, 구조어를 먼저 하면 "다크라이"가 "Dark 라이"가 된다.
  // 긴 것부터 바꾸면 둘 다 제 이름을 지킨다(다크라이 > 다크, 마그마단의 > 마그마).
  for (const { ko, en } of longestFirstTerms) {
    if (result.includes(ko)) {
      result = result.split(ko).join(en);
    }
  }
  // 남은 소유격 "의"를 영문식으로 바꾼다. "N의 조로아크", "모야모의 찌리비"처럼 이름만
  // 영문으로 바뀌고 "의"가 남으면 검색이 빗나간다(N의 Zoroark → N's Zoroark).
  result = result.replace(/([A-Za-z][A-Za-z0-9.&'-]*(?: [A-Za-z0-9.&'-]+)*)의(?=\s|$)/g, "$1's");
  // 접두어를 바꾸면 "Team Rocket's  Mewtwo"처럼 공백이 겹칠 수 있다(한글 쪽 띄어쓰기가
  // 그대로 남아서). 검색어에 겹친 공백은 매칭을 방해하므로 한 칸으로 줄인다.
  return forPpt(result);
}
