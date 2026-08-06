// 도감(포켓몬·트레이너별 카드)에서 카드 한 장을 눌렀을 때, 그 카드를 **어느 마켓에서
// 어떤 검색어로** 찾을지 정한다.
//
// 왜 필요한가: 마켓마다 갖고 있는 카드가 다르다(실측 2026-08-06).
//   · 스니커덩크 — 일본판. 매물이 있어야 상품이 생겨서, 신상·인기 카드는 강하고
//     옛 세트(1996~2006)·프로모는 아예 없다.
//   · PPT 이베이 낙찰 — 일본판·북미판 둘 다 있지만 **등급 낙찰이 있는 카드만** 잡힌다.
//     흔한 카드나 최신 세트는 대부분 0건이다.
//   · PPT TCGplayer 마켓가 — 위 둘이 놓친 카드를 많이 갖고 있다. 이베이 낙찰이 0건이던
//     북미판 5장이 전부 TCGplayer에는 값이 있었고, 스니커덩크가 못 찾은 일본판 8장 중
//     3장도 여기서 나왔다.
// 그래서 "일본판이면 무조건 스니커덩크"가 아니라, 값이 있는 곳을 차례로 찾아간다
// (운영자 지시 2026-08-06).
//
// ⚠️ 검색어 꼴도 마켓마다 다르다. 한 꼴을 다른 마켓에 그대로 넣으면 0건이 된다.
//   · 스니커덩크: "세트코드 번호"(M6 113). 제목에 [M6 113/076]으로 적혀 있다.
//   · PPT: 영문 카드 이름. **일본판 DB도 영문 이름으로 색인돼 있다.**
//     세트는 검색어에 붙이면 0건이고, setName 파라미터로 따로 보내야 걸러진다.
import pptSetNames from '../data/pptSetNames.json';

export interface 도감카드정보 {
  ko: string;
  en: string;
  raw: string;
  speciesEn: string;
  slug: string;
  setCode: string;
  setName: string;
  num: string;
  jp: boolean;
}

/** 마켓 한 칸. source·edition은 앱의 탭 상태 그대로다. */
export interface 마켓 {
  source: 'snkrdunk' | 'ebay' | 'tcgplayer';
  edition: 'japanese' | 'english';
  label: string;
}

/**
 * 찾아갈 순서. 앞에서 못 찾으면 다음으로 넘어간다.
 *
 * 일본판을 스니커덩크부터 보는 이유는 하나뿐이다 — **공짜이고 실거래가라서**다.
 * PPT는 부를 때마다 크레딧을 쓴다. 그래서 무료인 곳을 먼저 두드린다.
 */
export const 마켓순서 = (jp: boolean): 마켓[] =>
  jp
    ? [
        { source: 'snkrdunk', edition: 'japanese', label: '스니커덩크' },
        { source: 'ebay', edition: 'japanese', label: '이베이 낙찰(일본판)' },
        { source: 'tcgplayer', edition: 'japanese', label: 'TCGplayer(일본판)' },
      ]
    : [
        { source: 'ebay', edition: 'english', label: '이베이 낙찰(북미판)' },
        { source: 'tcgplayer', edition: 'english', label: 'TCGplayer(북미판)' },
      ];

/** 그 마켓에서 쓸 검색어. 빈 문자열이면 그 마켓은 건너뛴다. */
export function 도감검색어(c: 도감카드정보, m: 마켓): string {
  if (m.source === 'snkrdunk') return [c.setCode, c.num].filter(Boolean).join(' ') || c.ko;
  // PPT는 영문 이름으로 찾는다. 북미판 카드면 카드 이름이 곧 영문이고, 일본판이면
  // 그 포켓몬·트레이너의 영문 이름을 쓴다(카드 이름은 일본어라 안 걸린다).
  return c.en || c.speciesEn || c.ko;
}

/** 지금 검색어가 이 카드를 가리키는지 판단할 때 쓰는, 마켓별 검색어 전부. */
export function 도감검색어들(c: 도감카드정보): string[] {
  const 목록 = 마켓순서(c.jp).map((m) => 도감검색어(c, m));
  // 스니커덩크 2차 꼴("원문이름 번호")도 같은 카드를 가리킨다.
  if (c.raw && c.num) 목록.push(`${c.raw} ${c.num}`);
  return [...new Set(목록.filter(Boolean))];
}

/**
 * PPT에 보낼 세트 이름. 우리 세트 이름과 PPT 것이 달라서 대응표를 쓴다
 * (ja-PMCG1 → "Expansion Pack", en-sv03 → "SV03: Obsidian Flames").
 * 대응표에 없으면 우리 이름을 그대로 써 본다 — 맞을 때도 있다.
 */
export const pptSetName = (c: 도감카드정보): string =>
  (pptSetNames as Record<string, string>)[c.slug] || c.setName || '';
