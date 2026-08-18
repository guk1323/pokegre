// 카드 이름 사전을 "필요할 때" 받아 오는 창구.
//
// 사전은 크다 — 카드 이름·포켓몬 이름·팩 이름을 다 합치면 내려받는 자바스크립트의
// 절반쯤 된다. 그런데 첫 화면(공지·오늘의 상점·인기 검색어·뉴스)에는 카드 이름이
// 하나도 안 나온다. 인기 검색어까지 서버가 한글로 만들어 준다.
// 그래서 검색을 한 번도 안 하는 사람까지 사전을 다 받고 있었다.
//
// 사전을 쓰는 곳은 전부 서버에 뭔가 물어보는 자리(검색·시세 조회)라 이미 기다림이
// 있다. 그 김에 사전도 같이 받으면 화면이 늦어지는 느낌이 없다.
//
// ⚠️ 화면을 그리는 도중(동기)에 이걸 쓰면 안 된다. 아직 안 받았을 때 이름이 잠깐
// 원문으로 보였다가 한글로 바뀌는 깜빡임이 생긴다. 그리는 쪽에서 필요하면
// cardCatalog처럼 그 화면이 통째로 나중에 불려오는 곳에서 직접 가져다 쓴다.

type Dict = {
  koreanizeTitle: (title: string) => string;
  koreanizeEnglishCardName: (name: string) => string;
  // 화면에 그대로 적을 이름. 번호 꼬리('- 174/086')를 떼고 부호를 다듬는다.
  koName: (ed: 'ja' | 'en', name: string) => string;
  koreanizeEnglishSetName: (name: string) => string;
  translateSearchQuery: (q: string) => string;
  canonicalizeSearchTerm: (q: string) => string;
  translateSearchQueryToEnglish: (q: string, edition?: 'japanese' | 'english') => string;
};

let cached: Dict | null = null;
let loading: Promise<Dict> | null = null;

export function loadNameDict(): Promise<Dict> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = Promise.all([
      import('./koreanizeTitle'),
      import('./koreanizeEnglishTitle'),
      import('./translateQuery'),
      import('./translateQueryToEnglish'),
      // 자동완성이 쓰는 이름 목록도 같은 무리다. 같이 받아 둔다.
      import('./localSuggestions'),
      import('./koCardName'),
    ]).then(([ja, en, q, qe, , ko]) => {
      cached = {
        koreanizeTitle: ja.koreanizeTitle,
        koreanizeEnglishCardName: en.koreanizeEnglishCardName,
        koName: ko.koName,
        koreanizeEnglishSetName: en.koreanizeEnglishSetName,
        translateSearchQuery: q.translateSearchQuery,
        canonicalizeSearchTerm: q.canonicalizeSearchTerm,
        translateSearchQueryToEnglish: qe.translateSearchQueryToEnglish,
      };
      return cached;
    });
  }
  return loading;
}

// 검색창에 글자를 치기 시작하면 미리 받아 둔다. 실제로 검색을 누를 때쯤이면
// 이미 와 있어서 기다림이 0이 된다. 이미 받았거나 받는 중이면 아무 일도 안 한다.
export function warmNameDict(): void {
  void loadNameDict();
}
