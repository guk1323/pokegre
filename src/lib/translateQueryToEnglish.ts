import pokemonNames from '../data/pokemonNames.json';

interface PokemonName {
  id: number;
  ko: string;
  ja: string;
  en: string;
}

// 긴 이름부터 치환해야 "리자드"가 "리자몽" 안에서 먼저 걸려 이름이 깨지는 걸 막을 수 있다.
const sortedPokemonKoEn = (pokemonNames as PokemonName[])
  .filter((entry) => entry.ko && entry.en)
  .sort((a, b) => b.ko.length - a.ko.length);

const STRUCTURAL_EN_TERMS: [string, string][] = [['메가', 'Mega ']];

// PokemonPriceTracker API의 search 파라미터는 TCGPlayer 표기(영문) 기준이라, 한글
// 검색어를 영문 포켓몬 이름으로 치환해서 보낸다. translateQuery.ts(한글→일본어)와
// 동일한 부분 문자열 치환 방식을 쓴다.
export function translateSearchQueryToEnglish(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  let result = trimmed;
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
