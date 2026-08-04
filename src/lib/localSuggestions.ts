import pokemonNames from '../data/pokemonNames.json';
import packNames from '../data/packNames.json';
import cardNameKoEn from '../data/cardNameKoEn.json';
import { CARD_NAME_KO_TO_EN, STRUCTURAL_EN_TO_KO } from './koreanizeEnglishTitle';

// ⚠️ 예전엔 포켓몬 이름과 팩 이름만 재료로 썼다. 그래서 트레이너·굿즈 카드
//    (네모·페퍼·저지맨·개조해머·누룩스시티…)를 치면 목록이 통째로 비었다.
//    카드 이름을 한 글자씩 쳐 보는 6,460가지 중 1,450가지(22.4%)가 빈 목록이었다
//    (2026-08-04 실측). 이미 리포에 있는 한글 카드명을 재료로 더한다 — 새로 받을
//    파일은 없다.
// ⚠️ 이 파일은 검색창을 누를 때 따로 받아 온다(App.tsx의 동적 import). 첫 화면에는
//    안 실리므로 재료가 늘어도 처음 켤 때 무거워지지 않는다.
const koTerms: string[] = [
  ...(pokemonNames as { ko: string }[]).map((e) => e.ko),
  ...(packNames as { ko: string }[]).map((e) => e.ko),
  ...Object.keys(cardNameKoEn as Record<string, string>),
  ...CARD_NAME_KO_TO_EN.keys(),
  // 굿즈·스타디움처럼 카드명 사전에 없고 영문 대조표에만 있는 이름.
  ...STRUCTURAL_EN_TO_KO.map(([, ko]) => ko),
].filter((s) => !!s && /[가-힣]/.test(s));

// 포켓몬/팩 한글 이름 사전에서 접두 일치를 우선하고, 부분 일치를 뒤에 붙여서
// 타이핑 중에도 즉시(네트워크 요청 없이) 유사 검색어를 보여준다.
export function getLocalSuggestions(query: string, limit = 8): string[] {
  const q = query.trim();
  if (!q) return [];

  const starts: string[] = [];
  const includes: string[] = [];
  // 부분 일치는 "단어 시작"에서만 본다. 아무 데나 걸리게 두면 "이브"에 "드닐레이브",
  // "뮤"에 "줄뮤마"처럼 관계없는 이름이 올라와 목록이 미덥지 않아 보인다.
  const wordStart = new RegExp(`(^|[\\s:·-])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  for (const term of koTerms) {
    if (term === q) continue;
    if (term.startsWith(q)) starts.push(term);
    else if (wordStart.test(term)) includes.push(term);
  }

  return [...new Set([...starts, ...includes])].slice(0, limit);
}
