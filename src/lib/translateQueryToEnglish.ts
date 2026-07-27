import { CARD_NAME_KO_TO_EN, CARD_NAME_KO_TO_EN_LONG, CARD_NAME_KO_TO_EN_NOSPACE } from './koreanizeEnglishTitle';
import pokemonNames from '../data/pokemonNames.json';
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

// 긴 이름부터 치환해야 "리자드"가 "리자몽" 안에서 먼저 걸려 이름이 깨지는 걸 막을 수 있다.
const sortedPokemonKoEn = (pokemonNames as PokemonName[])
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
];

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
function spaceInsensitivePattern(name: string): RegExp {
  const body = [...name.replace(/\s+/g, '')].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp(body, 'gi');
}

const packEnPatterns = [...PACK_KO_EN]
  .filter(([ko]) => !pokemonKoSet.has(ko))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([ko, en]) => ({ re: spaceInsensitivePattern(ko), en }));

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
  .map(({ ko, en }) => ({ re: spaceInsensitivePattern(ko), en }));

// PokemonPriceTracker API의 search 파라미터는 TCGPlayer 표기(영문) 기준이라, 한글
// 검색어를 영문 포켓몬 이름으로 치환해서 보낸다. translateQuery.ts(한글→일본어)와
// 동일한 부분 문자열 치환 방식을 쓴다.
// edition='korean'은 이베이 한글판(Browse API) 경로라 이 PPT용 번역엔 안 오지만, 타입
// 호환을 위해 받아만 두고 영문판과 같게 처리한다(실제로는 호출되지 않음).
export function translateSearchQueryToEnglish(
  query: string,
  edition: 'japanese' | 'english' | 'korean' = 'japanese',
): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  // 검색어가 포켓몬 이름과 정확히 같으면 팩 매칭을 건너뛰고 바로 그 포켓몬으로 보낸다.
  // (팩 이름과 같은 이름이어도 포켓몬 카드 검색이 우선이다.)
  const exact = sortedPokemonKoEn.find((e) => e.ko === trimmed);
  if (exact) return exact.en;
  // 트레이너·굿즈·스타디움 한글 카드명이 통째로 들어오면 그대로 영문명으로 바꾼다.
  // 짧은 이름(추명·이슬 등)도 여기서는 안전하다 — 전체가 일치할 때만이라서.
  // 띄어쓰기가 달라도 같은 카드로 본다("테라스탈오브" = "테라스탈 오브").
  const noSpace = trimmed.replace(/[\s·]/g, '');
  const exactCard =
    CARD_NAME_KO_TO_EN.get(trimmed) ??
    CARD_NAME_KO_TO_EN_NOSPACE.get(noSpace) ??
    AUTO_KO_TO_EN.get(trimmed) ??
    AUTO_KO_TO_EN_NOSPACE.get(noSpace);
  if (exactCard) return exactCard;

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
  // 포켓몬 이름이 구조어보다 먼저다. "메가"를 먼저 떼면 메가자리(Yanmega)·메가니움
  // (Meganium)이 "Mega 자리"처럼 반쪽이 나서 검색이 안 된다.
  for (const entry of pokemonWithMega) {
    if (result.includes(entry.ko)) {
      result = result.split(entry.ko).join(entry.en);
    }
  }
  for (const [ko, en] of STRUCTURAL_EN_TERMS) {
    if (result.includes(ko)) {
      result = result.split(ko).join(en);
    }
  }
  // 남은 소유격 "의"를 영문식으로 바꾼다. "N의 조로아크", "모야모의 찌리비"처럼 이름만
  // 영문으로 바뀌고 "의"가 남으면 검색이 빗나간다(N의 Zoroark → N's Zoroark).
  result = result.replace(/([A-Za-z][A-Za-z0-9.&'-]*(?: [A-Za-z0-9.&'-]+)*)의(?=\s|$)/g, "$1's");
  // 접두어를 바꾸면 "Team Rocket's  Mewtwo"처럼 공백이 겹칠 수 있다(한글 쪽 띄어쓰기가
  // 그대로 남아서). 검색어에 겹친 공백은 매칭을 방해하므로 한 칸으로 줄인다.
  return result.replace(/\s+/g, ' ').trim();
}
