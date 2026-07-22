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

// 긴 이름부터 치환해야 "Mew"가 "Mewtwo" 안에서 먼저 걸려 이름이 깨지는 걸 막을 수 있다.
// (koreanizeTitle의 일본어 처리, translateQueryToEnglish의 한글 처리와 같은 방식)
const sortedPokemonEnKo = (pokemonNames as PokemonName[])
  .filter((entry) => entry.en && entry.ko)
  .sort((a, b) => b.en.length - a.en.length);

const packKoByCode = new Map(
  (packNames as PackName[]).filter((entry) => entry.code && entry.ko).map((entry) => [entry.code.toLowerCase(), entry.ko]),
);

// 포켓몬 이름 앞에 붙는 수식어. "ex"/"V"/"VMAX"/"GX" 같은 접미사는 한국 공식 표기에서도
// 영문 그대로 쓰기 때문에 건드리지 않는다.
const STRUCTURAL_EN_TO_KO: [string, string][] = [
  ['Mega ', '메가'],
  ['Radiant ', '찬란한 '], // かがやく/輝く의 영문판. koreanizeTitle과 같은 표기로 맞춘다.
];

// 트레이너·인물 서포트 카드 이름(영어 → 한글). 포켓몬이 아니라 pokemonNames 사전에 없어
// 그동안 영문으로 남았다. 한글은 공식 한국 포켓몬 표기(koreanizeTitle의 일본어쪽과 동일).
// ⚠️ "N"·"Red"처럼 짧은 이름이 다른 단어 안에 끼지 않도록, 카드명 "전체"가 정확히
// 일치할 때만 바꾼다(부분 치환 안 함).
const TRAINER_EN_TO_KO: Record<string, string> = {
  Serena: '세레나',
  Cynthia: '시로나',
  Marnie: '마리',
  Lillie: '릴리에',
  Sabrina: '나츠메',
  Iono: '난자모',
  Nemona: '네모',
  Arven: '페퍼',
  Penny: '보탄',
  Clavell: '청목',
  Bianca: '벨',
  Cheren: '체렌',
  Hop: '호프',
  Leon: '단델',
  Sonia: '소니아',
  Nessa: '무희',
  Piers: '네즈',
  Roxie: '보미카',
  Rosa: '명희',
  Grusha: '블래리',
  Acerola: '아세로라',
  Wally: '민진',
  Lance: '목호',
  Blaine: '강연',
  Misty: '이슬',
  Ash: '지우',
  "Professor's Research": '박사의 연구',
  "Boss's Orders": '보스의 지령',
};

// PokemonPriceTracker는 일본판 DB도 TCGPlayer 영문 표기로 내려준다("Charizard ex").
// SNKRDUNK 쪽 koreanizeTitle이 일본어 전용이라 여기엔 못 쓰므로, 영문 카드명을
// 한글 포켓몬 이름으로 치환하는 별도 경로를 둔다.
export function koreanizeEnglishCardName(name: string): string {
  // 트레이너·인물 카드는 이름 전체가 일치할 때만 통째로 바꾼다(부분 치환 사고 방지).
  const trainer = TRAINER_EN_TO_KO[name.trim()];
  if (trainer) return trainer;

  let result = name;

  for (const [en, ko] of STRUCTURAL_EN_TO_KO) {
    if (result.includes(en)) {
      result = result.split(en).join(ko);
    }
  }
  for (const entry of sortedPokemonEnKo) {
    if (result.includes(entry.en)) {
      result = result.split(entry.en).join(entry.ko);
    }
  }

  return result;
}

// 일본판 세트명은 "SV4a: Shiny Treasure ex"처럼 팩 코드가 앞에 붙어 오므로, 그 코드로
// 한글 팩 이름을 찾는다. 북미판 세트("Obsidian Flames" 등)는 코드가 없어 원문을 유지한다.
export function koreanizeEnglishSetName(setName: string): string {
  const match = setName.match(/^([A-Za-z0-9-]+):\s*/);
  if (!match) return setName;
  return packKoByCode.get(match[1].toLowerCase()) ?? setName;
}
