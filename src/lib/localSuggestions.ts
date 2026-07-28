import pokemonNames from '../data/pokemonNames.json';
import packNames from '../data/packNames.json';

const koTerms: string[] = [
  ...(pokemonNames as { ko: string }[]).map((e) => e.ko),
  ...(packNames as { ko: string }[]).map((e) => e.ko),
].filter(Boolean);

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
