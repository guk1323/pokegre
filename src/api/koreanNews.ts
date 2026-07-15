export interface KoreanNewsItem {
  url: string;
  title: string;
  date: string;
}

// 포켓몬코리아 공식 카드게임 사이트(pokemoncard.co.kr)의 "소식" — 완전한 한글
// 뉴스라 일본어 기반 소스보다 실사용자에게 더 유용하다.
export async function fetchPokemonNews(page = 1): Promise<KoreanNewsItem[]> {
  const res = await fetch(`/api/local/pokemon-news?page=${page}`);
  if (!res.ok) throw new Error('포켓몬 뉴스를 불러오지 못했습니다.');
  const data: { items?: KoreanNewsItem[] } = await res.json();
  return data.items ?? [];
}
