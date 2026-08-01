import pokemonNames from '../data/pokemonNames.json';
import packNames from '../data/packNames.json';
import { MANUAL_PACK_OVERRIDES } from './manualPackOverrides';
import { koreanizeTitle, STRUCTURAL_TERMS } from './koreanizeTitle';

interface PokemonName {
  id: number;
  ko: string;
  ja: string;
  en: string;
}

interface PackName {
  code: string;
  ja: string;
  ko: string;
}

// 긴 이름부터 치환해야 "리자드"가 "리자몽" 안에서 먼저 걸려 이름이 깨지는 걸 막을 수 있다.
const sortedPokemonKo = (pokemonNames as PokemonName[])
  .filter((entry) => entry.ko && entry.ja)
  .sort((a, b) => b.ko.length - a.ko.length);

// 팩 이름은 사전에 "스칼렛&바이올렛 : 흑염의 지배자"처럼 시리즈 접두사까지 붙어 있지만,
// 사람들은 "흑염의 지배자"만 친다. ':' 뒤 뒷부분도 따로 등록해 둘 다 걸리게 한다.
function withShortPackNames(entries: { ko: string; ja: string }[]): { ko: string; ja: string }[] {
  const out = [...entries];
  const seen = new Set(entries.map((e) => e.ko));
  for (const e of entries) {
    const tail = e.ko.split(/\s*:\s*/).pop()?.trim();
    // 너무 짧은 꼬리(예: "ex")는 아무 검색어에나 걸려서 제외한다.
    if (tail && tail.length >= 3 && tail !== e.ko && !seen.has(tail)) {
      seen.add(tail);
      out.push({ ko: tail, ja: e.ja });
    }
  }
  return out;
}

// 팩 사전은 "썬&문 → 強化拡張パック サン&ムーン"처럼 한글 쪽이 짧고 일본어 쪽에만
// 팩 종류가 붙어 있는 항목이 있다. 그대로 되돌리면 "썬&문 확장팩 태그볼트"가
// "強化拡張パック サン&ムーン 拡張パック タッグボルト"가 되어 아무것도 안 나온다
// (2026-08-01 실측 50건). 한글에 그 종류 이름이 없으면 일본어에서도 뗀다.
const PACK_KIND: [string, string][] = [
  ['強化拡張パック', '강화확장팩'],
  ['ハイクラスパック', '하이클래스팩'],
  ['拡張パック', '확장팩'],
];
const dropPackKind = (ja: string, ko: string) => {
  for (const [jaKind, koKind] of PACK_KIND) {
    if (ja.startsWith(jaKind) && !ko.includes(koKind)) return ja.slice(jaKind.length).trim() || ja;
  }
  return ja;
};

const sortedPackKo = withShortPackNames([
  ...(packNames as PackName[])
    .filter((entry) => entry.ko && entry.ja)
    .map((entry) => ({ ko: entry.ko, ja: dropPackKind(entry.ja, entry.ko) })),
  ...MANUAL_PACK_OVERRIDES.map(([ja, ko]) => ({ ko, ja: dropPackKind(ja, ko) })),
]).sort((a, b) => b.ko.length - a.ko.length);

// "샤이니트레저 ex"로 등록돼 있어도 "샤이니 트레저ex"라고 치는 사람이 더 많다. 글자
// 사이 공백을 무시하고 맞추도록, 이름의 각 글자 사이에 \s* 를 끼운 정규식을 만든다.
function spaceInsensitivePattern(name: string): RegExp {
  const body = [...name.replace(/\s+/g, '')].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp(body, 'g');
}

const packPatterns = sortedPackKo.map((e) => ({ re: spaceInsensitivePattern(e.ko), ja: e.ja }));

// koreanizeTitle의 STRUCTURAL_TERMS(일본어→한글)를 뒤집어서 재사용한다. "메가"처럼
// 카드명 접두사로 자주 붙는 말은 검색어 번역에서도 빠지면 안 되기 때문.
// 같은 한글에 일본어가 여럿 붙어 있을 때 검색에 쓸 쪽을 고른다(실측으로 정했다).
// ① 한자가 없는 쪽을 먼저 쓴다. 스니커덩크는 가나와 한자를 같은 것으로 보지만
//    반대는 아니다 — "ひかるリザードン" 66건인데 "光るリザードン"은 0건이다.
// ② 그다음은 짧은 쪽. 넓게 걸리는 게 낫고, 긴 쪽은 대개 그 말이 든 특정 이름이다
//    ("闘ルガルガン" 1건 / "激闘ルガルガン" 0건).
const hasKanji = (s: string) => /[一-鿿]/.test(s);
const betterForSearch = (next: string, prev: string) => {
  if (hasKanji(next) !== hasKanji(prev)) return !hasKanji(next);
  return next.length < prev.length;
};

const reverseStructuralTerms = new Map<string, string>();
for (const [ja, ko] of STRUCTURAL_TERMS) {
  // 왼쪽이 알파벳뿐인 항목은 건너뛴다. 그런 항목은 옛 세트의 깨진 원본 데이터를
  // 고치려고 넣은 것이지(원본에 'Bugsy'가 영어로 들어 있다) 검색어가 아니다.
  // 그대로 뒤집으면 "호일"로 검색할 때 스니커덩크에 'Bugsy'를 보내게 되는데,
  // 거긴 일본어로 찾는 곳이라 아무것도 안 나온다. 제대로 된 짝(ツクシ)이 뒤쪽에 있다.
  if (!/[ぁ-んァ-ヶ一-鿿]/.test(ja)) continue;
  // ヴ로 적힌 외래음 보조 규칙(ヴァ→바, ヴォ→보 …)은 읽기용이지 검색어가 아니다.
  // 되돌리면 일본어 이름을 소리대로 적은 한글 안에 끼어든다(실측):
  //   보우켄 → ヴォ우켄   코쿠바 → 코쿠ヴァ
  // 한글 "바"의 짝은 バ이지 ヴァ가 아니다.
  if (/^ヴ/.test(ja)) continue;
  const prev = reverseStructuralTerms.get(ko);
  if (prev === undefined || betterForSearch(ja, prev)) reverseStructuralTerms.set(ko, ja);
  // 지역폼 접두사처럼 한글 쪽에 띄어쓰기가 붙은 말("가라르 ")은 붙여 쓴 검색어
  // ("가라르야도란")에 안 걸린다. 그러면 남은 "가"가 엉뚱한 한자 규칙에 잡혀
  // "家라르ヤドラン"이 되어 검색이 통째로 망가진다. 공백 뺀 형태도 같이 등록한다.
  const tight = ko.trim();
  const prevTight = reverseStructuralTerms.get(tight);
  if (tight !== ko && tight && (prevTight === undefined || betterForSearch(ja, prevTight))) reverseStructuralTerms.set(tight, ja);
}
const sortedStructuralKo = [...reverseStructuralTerms.entries()].sort((a, b) => b[0].length - a[0].length);

// SNKRDUNK 검색은 일본어/영어 카드명만 인식하므로, 한글 포켓몬/팩 이름이 섞인 검색어를
// 대응하는 일본어(가타카나) 이름으로 치환해서 보낸다. "개굴닌자ex"처럼 이름과 접미사가
// 공백 없이 붙어 있는 경우가 많아서(자동완성 제안이 이런 형태로 옴) 토큰 단위 완전
// 일치가 아니라 koreanizeTitle과 동일하게 부분 문자열 치환을 쓴다.
export function translateSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  let result = trimmed;
  // 팩 이름이 가장 구체적이라 제일 먼저 잡는다. "샤이니"·"포켓몬" 같은 짧은 일반어를
  // 먼저 바꾸면 "샤이니트레저 ex"·"포켓몬카드 151" 같은 팩 이름이 조각나 안 걸린다.
  for (const { re, ja } of packPatterns) {
    re.lastIndex = 0;
    if (re.test(result)) {
      re.lastIndex = 0;
      result = result.replace(re, ja);
    }
  }
  // 포켓몬 이름과 구조 단어를 한 번에, 긴 것부터 돌린다.
  // 포켓몬을 먼저 다 돌리면 "마그마단"의 "마그마"가 포켓몬 마그마(ブーバー)로 먼저
  // 걸려 "ブーバー단"이 된다(실측). 반대로 구조 단어를 먼저 다 돌리면 "이상해씨"의
  // "이상"이 한자가 되어 이름이 깨진다. 섞어서 긴 것부터 보면 둘 다 안 깨진다
  // (한글→영어 쪽 translateQueryToEnglish도 같은 이유로 이렇게 고쳐 뒀다).
  const merged: { ko: string; ja: string; short: boolean }[] = [
    ...sortedPokemonKo.map((e) => ({ ko: e.ko, ja: e.ja, short: false })),
    // 한글이 두 글자 이하이고 일본어가 한자뿐이면 낱말로 홀로 섰을 때만 바꾼다.
    // 그냥 바꾸면 일본어 이름을 소리대로 적은 한글 안에 끼어들어 검색어를 망가뜨린다
    // (2026-08-01 실측 90건: 긴가→긴家, 루자미네→루者미네, 9장세트→9状세트).
    // "물 에너지"처럼 홀로 서는 짧은 말은 진짜 검색어라 그대로 살아난다.
    // ⚠️ 공백을 떼고 재야 한다. ["초 ", "超 "]처럼 꼬리 공백이 붙은 항목이 있어서
    //    그냥 재면 두 글자로 세어 이 검사를 빠져나가고 "망초 SR"이 "망超 SR"이 됐다.
    ...sortedStructuralKo.map(([ko, ja]) => ({
      ko,
      ja,
      short: ko.trim().length <= 2 && /^[一-鿿]+$/.test(ja.trim()),
    })),
  ].sort((a, b) => b.ko.length - a.ko.length);

  for (const { ko, ja, short } of merged) {
    if (!result.includes(ko)) continue;
    if (short) {
      result = result.replace(new RegExp(`(^|[^가-힣0-9])${ko}(?![가-힣])`, 'g'), `$1${ja}`);
      continue;
    }
    result = result.split(ko).join(ja);
  }
  // 화면에는 "마릴리 ex"처럼 띄어 보여주지만, 스니커덩크 상품명은 "マリルリex"로 붙어 있다.
  // 사람들은 본 대로 치므로 여기서 붙여 준다. 실측: "マリルリ ex" 0건 / "マリルリex" 13건.
  // (인기 카드는 띄어도 걸리지만 드문 카드는 통째로 0건이 된다.)
  // 레어도(SAR·SR·UR…)는 상품명에서도 띄어 있으니 건드리지 않는다.
  // "메가리자몽 X ex"처럼 두 번 붙여야 하는 것이 있어 두 번 돌린다(한 번 돌리면
  // 앞쪽만 붙고 "メガリザードンX ex"로 남는다).
  const glue = /([ぁ-んァ-ヶー一-鿿A-Za-z0-9])\s+(ex|EX|V|VMAX|VSTAR|GX|BREAK|LEGEND|X|Y)\b/g;
  result = result.replace(glue, '$1$2').replace(glue, '$1$2');

  // 화면에는 "독개굴 (델타종)"처럼 괄호로 갈래를 붙여 보여주지만, 스니커덩크 상품명에는
  // 그 표기가 없다. 실측: "ドクロッグ（デルタ種）" 0건 / "ドクロッグ" 50건.
  // 괄호 안이 갈래 표시일 때만 떼고, ex·V 같은 꼬리는 남긴다.
  result = result.replace(/\s*[（(][^）)]*[）)]/g, ' ').replace(/ {2,}/g, ' ').trim();

  // 골드스타는 화면에 ★로 보여주지만 스니커덩크 상품명엔 그 기호가 없다.
  // 검색어에서만 뗀다("리자몽 ★" → "リザードン").
  result = result.replace(/\s*★\s*/g, ' ').replace(/ {2,}/g, ' ').trim();

  // 남은 소유격 "의"를 일본어 の로 바꾼다. 이름만 일본어로 바뀌고 "의"가 남으면
  // 스니커덩크에서 안 잡힌다("ロケット団의 ミュウツー"). 앞이 일본어(또는 N 같은
  // 알파벳)일 때만 바꾸므로, 아직 한글로 남은 이름의 "의"는 건드리지 않는다.
  result = result.replace(/([ぁ-んァ-ヶ一-鿿A-Za-z0-9])의\s*/g, '$1の');
  return result;
}

// 같은 검색 의도라도 한글로 쳤는지 일본어로 쳤는지에 따라 문자열이 달라지면
// "인기 검색어" 집계가 갈라진다. 검색어를 일본어로 번역했다가 다시 카드명
// 한글화 파이프라인을 태워서, 입력 방식과 무관하게 항상 같은 표기로 모은다.
export function canonicalizeSearchTerm(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  return tidySearchTerm(koreanizeTitle(translateSearchQuery(trimmed)));
}

// 인기 검색어에 올릴 만한 꼴로 다듬는다.
//
// 사진으로 찾으면 검색어가 카드 번호가 된다("M4 114/083"). 그게 그대로 순위에 오르면
// 무슨 카드인지 아무도 모른다. 반대로 목록에서 고른 것을 그대로 두면 상품 제목이
// 통째로 올라간다("명희의 격려 SAR [M3 115/080](확장팩「메가진화 : 니힐제로」)").
// 사람이 읽을 수 있는 카드 이름만 남긴다.
//
// 이름이 하나도 안 남는 순수 번호는 빈 문자열로 돌려준다 — 부르는 쪽에서 집계를 건너뛴다.
export function tidySearchTerm(term: string): string {
  let t = term.trim();
  // 상품 제목 꼬리: "[M3 115/080]" 뒤와 "(확장팩「…」)" 같은 괄호 설명을 떼어낸다.
  t = t.replace(/\s*[[(（].*$/, '').trim();
  // 앞뒤에 붙은 세트코드·번호를 떼어낸다("M4 114/083", "114/083 리자몽").
  t = t.replace(/^\s*[A-Za-z0-9-]{1,8}\s+(?=\d)/, '');
  t = t.replace(/\s*\b\d{1,4}\/[A-Za-z0-9-]+\b\s*/g, ' ').trim();
  // 번호만 남은 것(또는 아무것도 안 남은 것)은 집계하지 않는다.
  if (!t || !/[가-힣A-Za-z]/.test(t)) return '';
  return t.replace(/\s+/g, ' ');
}
