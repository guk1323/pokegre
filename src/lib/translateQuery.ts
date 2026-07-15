import pokemonNames from '../data/pokemonNames.json';
import packNames from '../data/packNames.json';
import { MANUAL_PACK_OVERRIDES } from './manualPackOverrides';
import { koreanizeTitle, STRUCTURAL_TERMS } from './koreanizeTitle';

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
const sortedPokemonKo = (pokemonNames as PokemonName[])
  .filter((entry) => entry.ko && entry.ja)
  .sort((a, b) => b.ko.length - a.ko.length);

const sortedPackKo = [
  ...(packNames as PackName[]).filter((entry) => entry.ko && entry.ja).map((entry) => ({ ko: entry.ko, ja: entry.ja })),
  ...MANUAL_PACK_OVERRIDES.map(([ja, ko]) => ({ ko, ja })),
].sort((a, b) => b.ko.length - a.ko.length);

// koreanizeTitle의 STRUCTURAL_TERMS(일본어→한글)를 뒤집어서 재사용한다. "메가"처럼
// 카드명 접두사로 자주 붙는 말은 검색어 번역에서도 빠지면 안 되기 때문.
const reverseStructuralTerms = new Map<string, string>();
for (const [ja, ko] of STRUCTURAL_TERMS) {
  if (!reverseStructuralTerms.has(ko)) reverseStructuralTerms.set(ko, ja);
}
const sortedStructuralKo = [...reverseStructuralTerms.entries()].sort((a, b) => b[0].length - a[0].length);

// SNKRDUNK 검색은 일본어/영어 카드명만 인식하므로, 한글 포켓몬/팩 이름이 섞인 검색어를
// 대응하는 일본어(가타카나) 이름으로 치환해서 보낸다. "개굴닌자ex"처럼 이름과 접미사가
// 공백 없이 붙어 있는 경우가 많아서(자동완성 제안이 이런 형태로 옴) 토큰 단위 완전
// 일치가 아니라 koreanizeTitle과 동일하게 부분 문자열 치환을 쓴다.
export function translateSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  let result = trimmed;
  for (const [ko, ja] of sortedStructuralKo) {
    if (result.includes(ko)) {
      result = result.split(ko).join(ja);
    }
  }
  for (const entry of sortedPackKo) {
    if (result.includes(entry.ko)) {
      result = result.split(entry.ko).join(entry.ja);
    }
  }
  for (const entry of sortedPokemonKo) {
    if (result.includes(entry.ko)) {
      result = result.split(entry.ko).join(entry.ja);
    }
  }
  return result;
}

// 같은 검색 의도라도 한글로 쳤는지 일본어로 쳤는지에 따라 문자열이 달라지면
// "인기 검색어" 집계가 갈라진다. 검색어를 일본어로 번역했다가 다시 카드명
// 한글화 파이프라인을 태워서, 입력 방식과 무관하게 항상 같은 표기로 모은다.
export function canonicalizeSearchTerm(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  return koreanizeTitle(translateSearchQuery(trimmed));
}
