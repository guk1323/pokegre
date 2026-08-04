import { loadNameDict } from '../lib/nameDict';

interface SuggestResponse {
  suggestions?: { keyword: string }[];
}

// 이 아래로 짧은 입력은 안 부른다. 한 글자로는 후보가 너무 넓어 목록이 무의미하고,
// 글자마다 밖으로 나가면 SNKRDUNK가 IP를 막는다(아래 ⚠️ 참고).
const MIN_LEN = 2;

// SNKRDUNK 자동완성은 일본어 기준이다.
//
// ⚠️ 예전 조건: `translated === trimmed || 한글이 남음` → 안 부름.
//    앞쪽 조건이 문제였다. "번역할 것이 아예 없는 입력"까지 "번역 실패"로 보고 막아서,
//    Charizard · リザードン · sv2a · 151 같은 걸 치면 목록이 통째로 비었다.
//    정작 SNKRDUNK는 그런 입력에 10개씩 잘 준다(2026-08-04 실측).
//    이제는 "한글을 쳤는데 번역 뒤에도 한글이 남을 때"만 막는다 — 그게 원래 막으려던
//    "피카"처럼 덜 친 말이다. 한글이 아예 없는 입력은 그대로 보낸다.
export async function fetchRemoteSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_LEN) return [];

  const dict = await loadNameDict();
  const translated = dict.translateSearchQuery(trimmed);
  // 한글이 섞인 입력만 "다 번역됐는지"를 따진다.
  if (/[가-힣]/.test(trimmed) && /[가-힣]/.test(translated)) return [];

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
