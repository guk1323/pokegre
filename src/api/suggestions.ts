import { translateSearchQuery } from '../lib/translateQuery';
import { koreanizeTitle } from '../lib/koreanizeTitle';

interface SuggestResponse {
  suggestions?: { keyword: string }[];
}

// SNKRDUNK 자동완성은 일본어 기준이라, 입력을 완전히 일본어로 번역할 수 있을 때만
// (한글이 하나도 안 남을 때만) 호출한다. 그래야 "피카"처럼 아직 덜 친 한글로
// 의미 없는 일본어 조각을 검색하는 걸 막을 수 있다.
export async function fetchRemoteSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const translated = translateSearchQuery(trimmed);
  if (translated === trimmed || /[가-힣]/.test(translated)) return [];

  const params = new URLSearchParams({ keyword: translated, limit: '10' });
  const res = await fetch(`/api/snkrdunk/v3/search/suggestions?${params.toString()}`);
  if (!res.ok) return [];

  const data: SuggestResponse = await res.json();
  return (data.suggestions ?? []).map((s) => koreanizeTitle(s.keyword));
}
