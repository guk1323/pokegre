// pokecardmon.com 스크래핑 사전에 없거나 결과가 부자연스러운 팩 이름을 직접 보정한다.
// [일본어, 한글] 쌍이며 양방향(검색어 번역·카드명 한글화)에서 같이 쓴다.
export const MANUAL_PACK_OVERRIDES: [string, string][] = [
  ['ストームエメラルダ', '스톰에메랄드'],
  ['神秘なる山', '신비로운 산'],
];
