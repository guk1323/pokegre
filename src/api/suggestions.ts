import { loadNameDict } from '../lib/nameDict';

interface SuggestResponse {
  suggestions?: { keyword: string }[];
}

// SNKRDUNK 자동완성은 일본어 기준이라, 입력을 완전히 일본어로 번역할 수 있을 때만
// (한글이 하나도 안 남을 때만) 호출한다. 그래야 "피카"처럼 아직 덜 친 한글로
// 의미 없는 일본어 조각을 검색하는 걸 막을 수 있다.
export async function fetchRemoteSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const dict = await loadNameDict();
  const translated = dict.translateSearchQuery(trimmed);
  if (translated === trimmed || /[가-힣]/.test(translated)) return [];

  const params = new URLSearchParams({ keyword: translated, limit: '10' });
  const res = await fetch(`/api/snkrdunk/v3/search/suggestions?${params.toString()}`);
  if (!res.ok) return [];

  const data: SuggestResponse = await res.json();
  return (data.suggestions ?? []).map((s) => tidyRarity(dict.koreanizeTitle(s.keyword)));
}

// 자동완성 키워드는 사람들이 실제로 친 검색어라 레어도가 소문자로 붙어 온다
// ("리자몽vstar", "피카츄 ar"). 정작 카드 목록에는 대문자로 보이므로(SAR·VSTAR)
// 나란히 놓으면 어긋나 보인다. 목록 쪽 표기에 맞춰 준다.
// ex는 공식 표기가 소문자라 건드리지 않는다("리자몽 ex").
// 뒤쪽 x·y는 레어도가 아니라 메가진화 형태 구분이다(메가리자몽 X / Y). 역시 대문자로 쓴다.
const RARITY_WORDS = [
  'vstar', 'vmax', 'csr', 'ssr', 'sar', 'chr', 'mur', 'ace', 'ar', 'sr', 'hr', 'ur', 'rr', 'se', 'gx', 'v',
  'x', 'y',
];

function tidyRarity(name: string): string {
  for (const w of RARITY_WORDS) {
    const re = new RegExp(`([가-힣0-9])\\s*${w}$`, 'i');
    if (re.test(name)) return name.replace(re, (_m, before: string) => `${before} ${w.toUpperCase()}`);
  }
  return name;
}
