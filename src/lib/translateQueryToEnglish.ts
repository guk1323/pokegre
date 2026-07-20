import pokemonNames from '../data/pokemonNames.json';
import packNames from '../data/packNames.json';

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

const STRUCTURAL_EN_TERMS: [string, string][] = [['메가', 'Mega ']];

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
  .sort((a, b) => b.ko.length - a.ko.length)
  .map(({ ko, en }) => ({ re: spaceInsensitivePattern(ko), en }));

// PokemonPriceTracker API의 search 파라미터는 TCGPlayer 표기(영문) 기준이라, 한글
// 검색어를 영문 포켓몬 이름으로 치환해서 보낸다. translateQuery.ts(한글→일본어)와
// 동일한 부분 문자열 치환 방식을 쓴다.
export function translateSearchQueryToEnglish(query: string, edition: 'japanese' | 'english' = 'japanese'): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

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
  for (const [ko, en] of STRUCTURAL_EN_TERMS) {
    if (result.includes(ko)) {
      result = result.split(ko).join(en);
    }
  }
  for (const entry of sortedPokemonKoEn) {
    if (result.includes(entry.ko)) {
      result = result.split(entry.ko).join(entry.en);
    }
  }
  return result.trim();
}
