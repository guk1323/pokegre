import pokemonNames from '../data/pokemonNames.json';
import packNames from '../data/packNames.json';
import cardNameKoEn from '../data/cardNameKoEn.json';
import cardNamesKo from '../data/cardNamesKo.json';
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
  // ⚠️ **우리가 가진 실제 카드 이름 전부**(public/sets에서 뽑아 둔 5,653가지).
  //    이게 없을 때 목록이 너무 얇았다 — "블래키"를 치면 **1가지**뿐이었고
  //    ("블래키 ex"), 그 자리를 스니커덩크 자동완성이 메우고 있었다. 그쪽은 사람들이
  //    친 검색어라 "MUR"·"구뒷면" 같은 그 마켓 말과 "블래키vmax sa" 같은 오타가
  //    섞인다(2026-08-07 실측). 우리 카드 이름을 쓰면 11가지가 나오고 전부 실제
  //    카드다. **맨 뒤에 붙인다** — 앞의 재료(포켓몬·팩 이름)가 먼저 잡히게 두려는 것이다.
  //    다시 만들기: scripts/gen-card-name-suggestions.mts
  ...(cardNamesKo as string[]),
]
  // ⚠️ **앞뒤에 공백이 붙은 것은 이름이 아니라 번역용 앞머리다**("로켓단의 ", "페퍼의 ",
  //    "찬란한 " 등 97가지). 그대로 두면 목록에 "페퍼의 "처럼 뒤가 잘린 줄이 뜬다
  //    (2026-08-07 확인). 눌러도 반쪽짜리 검색어가 들어간다.
  .filter((s) => !!s && s === s.trim() && /[가-힣]/.test(s));

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
