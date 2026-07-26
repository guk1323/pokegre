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

// 팩 이름은 사전에 "스칼렛&바이올렛 : 흑염의 지배자"처럼 시리즈 접두사까지 붙어 있지만,
// 사람들은 "흑염의 지배자"만 친다. ':' 뒤 뒷부분도 따로 등록해 둘 다 걸리게 한다.
function withShortPackNames(entries: { ko: string; ja: string }[]): { ko: string; ja: string }[] {
  const out = [...entries];
  const seen = new Set(entries.map((e) => e.ko));
  for (const e of entries) {
    const tail = e.ko.split(/\s*:\s*/).pop()?.trim();
    // 너무 짧은 꼬리(예: "ex")는 아무 검색어에나 걸려서 제외한다.
    if (tail && tail.length >= 3 && tail !== e.ko && !seen.has(tail)) {
      seen.add(tail);
      out.push({ ko: tail, ja: e.ja });
    }
  }
  return out;
}

const sortedPackKo = withShortPackNames([
  ...(packNames as PackName[]).filter((entry) => entry.ko && entry.ja).map((entry) => ({ ko: entry.ko, ja: entry.ja })),
  ...MANUAL_PACK_OVERRIDES.map(([ja, ko]) => ({ ko, ja })),
]).sort((a, b) => b.ko.length - a.ko.length);

// "샤이니트레저 ex"로 등록돼 있어도 "샤이니 트레저ex"라고 치는 사람이 더 많다. 글자
// 사이 공백을 무시하고 맞추도록, 이름의 각 글자 사이에 \s* 를 끼운 정규식을 만든다.
function spaceInsensitivePattern(name: string): RegExp {
  const body = [...name.replace(/\s+/g, '')].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp(body, 'g');
}

const packPatterns = sortedPackKo.map((e) => ({ re: spaceInsensitivePattern(e.ko), ja: e.ja }));

// koreanizeTitle의 STRUCTURAL_TERMS(일본어→한글)를 뒤집어서 재사용한다. "메가"처럼
// 카드명 접두사로 자주 붙는 말은 검색어 번역에서도 빠지면 안 되기 때문.
const reverseStructuralTerms = new Map<string, string>();
for (const [ja, ko] of STRUCTURAL_TERMS) {
  if (!reverseStructuralTerms.has(ko)) reverseStructuralTerms.set(ko, ja);
  // 지역폼 접두사처럼 한글 쪽에 띄어쓰기가 붙은 말("가라르 ")은 붙여 쓴 검색어
  // ("가라르야도란")에 안 걸린다. 그러면 남은 "가"가 엉뚱한 한자 규칙에 잡혀
  // "家라르ヤドラン"이 되어 검색이 통째로 망가진다. 공백 뺀 형태도 같이 등록한다.
  const tight = ko.trim();
  if (tight !== ko && tight && !reverseStructuralTerms.has(tight)) reverseStructuralTerms.set(tight, ja);
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
  // 팩 이름이 가장 구체적이라 제일 먼저 잡는다. "샤이니"·"포켓몬" 같은 짧은 일반어를
  // 먼저 바꾸면 "샤이니트레저 ex"·"포켓몬카드 151" 같은 팩 이름이 조각나 안 걸린다.
  for (const { re, ja } of packPatterns) {
    re.lastIndex = 0;
    if (re.test(result)) {
      re.lastIndex = 0;
      result = result.replace(re, ja);
    }
  }
  // 포켓몬 이름 사전을 구조 단어보다 먼저 돌린다. 반대로 하면 "이상해씨"의 "이상",
  // "단데기"의 "단"처럼 이름 속 조각이 먼저 한자로 바뀌어 이름 매칭이 깨진다
  // (실제로 "이상해씨→以上해씨"가 되던 버그).
  for (const entry of sortedPokemonKo) {
    if (result.includes(entry.ko)) {
      result = result.split(entry.ko).join(entry.ja);
    }
  }
  for (const [ko, ja] of sortedStructuralKo) {
    if (result.includes(ko)) {
      result = result.split(ko).join(ja);
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
