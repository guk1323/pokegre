import pokemonNames from '../data/pokemonNames.json';
import pokemonNameAliases from '../data/pokemonNameAliases.json';
import packNames from '../data/packNames.json';
import setNameKoJa from '../data/setNameKoJa.json';
import cardNameKoJa from '../data/cardNameKoJa.json';
import { MANUAL_PACK_OVERRIDES } from './manualPackOverrides';
import { koreanizeTitle, STRUCTURAL_TERMS, COMPOUND_TERMS, EXACT_TRAINER_NAMES, EXACT_TITLES } from './koreanizeTitle';
import { 전각부호펴기 } from './punct';

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

// 모습이 다른 포켓몬(백마 버드렉스·히트로토무·리자몽 ★)은 기본 이름 사전이 아니라
// 별칭 사전에만 있다. 여기 빼먹으면 "백마 버드렉스"가 「白馬」+「バドレックス」로 갈라져
// 검색이 0건이 된다(실측: 白馬バドレックスV 0건 / はくばバドレックスV 24건).
// ⚠️ 원본이 깨진 별칭이 섞여 있다(안농 7종의 일본어가 "未作外"·"ZなしZ"). 일본어가
//    가나로만 돼 있는 것만 쓴다.
const aliasPairs = (pokemonNameAliases as { ko?: string; ja?: string }[])
  .filter((e) => e.ko && e.ja && /^[ぁ-んァ-ヶー]+$/.test(e.ja))
  .map((e) => ({ ko: e.ko as string, ja: e.ja as string }));

// "메가디안시"처럼 메가 진화 이름이 붙어 오면 통째로 바꿔야 한다. 그냥 두면 안쪽의
// "가디안"(サーナイト)이 먼저 걸려 "메サーナイト시"가 된다(방문자가 실제로 친 검색어에서
// 나왔다). 반대로 메가자리(トロピウス)·메가니움(メガニウム)은 이름 자체가 메가로
// 시작하므로, 원래 이름을 먼저 놓고 긴 것부터 맞춘다.
// ⚠️ 한글→영어 쪽(translateQueryToEnglish)에는 진작 있던 처리인데 이쪽에만 빠져 있었다.
//    두 방향은 따로 돌아가므로 한쪽을 고치면 다른 쪽도 봐야 한다.
const withMega = (list: { ko: string; ja: string }[]) =>
  [...list, ...list.map((e) => ({ ko: `메가${e.ko}`, ja: `メガ${e.ja}` }))].sort(
    (a, b) => b.ko.length - a.ko.length,
  );

// 사람들이 실제로 치는 표기를 공식 한글 표기로 먼저 고친다. 검색어를 받는 쪽에만 두고
// (일본어→한글 사전에 넣으면 카드 이름 자체가 이렇게 바뀐다), 일본어로 바로 바꾸지 않는다.
//
// 왜 한글→한글인가: 일본어로 바로 바꾸면 그 뒤에 이어지는 규칙이 안 걸린다. "이슬이"를
// カスミ로 바로 바꾸면 "이슬이의 기력"이 「カスミの기력」에서 멈춘다 — 사전에 통째로
// 등록된 이름이 「이슬의 기력」이라 그 모양이 되기 전에는 안 걸리기 때문이다.
// 공식 표기로 먼저 고쳐 두면 그다음은 기존 규칙이 알아서 다 한다.
//
// 왜 필요한가: 방문자가 남긴 검색어 578종을 훑어보니, 공식 한글명 대신 일본 발음을
// 그대로 적거나 이름 뒤에 '이'를 붙여 치는 경우가 있었다. 그대로 두면 한글이 남은 채
// 스니커덩크로 나가 결과가 0건이 된다.
//
// ⚠️ 한글→일본어(이 파일)와 한글→영어(translateQueryToEnglish)는 따로 도는 두 길이다.
//    이 목록은 "사람이 뭘 쳤나"를 고르는 것이라 두 길 모두에 필요하다. 그래서 여기서
//    내보내고 저쪽에서 가져다 쓴다 — 한쪽에만 넣어 두면 이베이 검색만 계속 빗나간다.
export const KO_SEARCH_ALIASES: [string, string][] = [
  ['이슬이', '이슬'], // 공식명은 "이슬"(カスミ). 사람 이름처럼 '이'를 붙여 치는 사람이 있다
  ['시로나', '난천'], // 공식명은 "난천"(シロナ)인데 일본 발음으로 치는 사람이 있다
  ['구레닌자', '개굴닌자'], // 공식명은 "개굴닌자"(ゲッコウガ)
  ['포케토몬스터', '포켓몬스터'],
  // 띄어쓰기 없이 치면 낱말 규칙이 조각내 「エナジー転送」이 된다(실제 카드는
  // 「エネルギー転送」이라 0건). 공식 표기로 먼저 고치면 그다음은 알아서 된다.
  ['에너지전송', '에너지 전송'],
  // ⚠️ **레어도를 뒤에 붙여 치는 말투를 앞머리 표기로 되돌린다.** 우리 자동완성이
  //    "이브이 찬란"처럼 권하는데(30가지), 일본판 카드 이름은 앞에 붙는 「かがやく」다.
  //    그대로 나가면 "イーブイ 찬란"이 되어 **0장**이 나왔다. 아래처럼 고치면
  //    "かがやくイーブイ"가 되어 787장이 나온다(2026-08-08 실측).
  //    ⚠️ 스니커덩크 검색은 **낱말 순서를 안 따진다** — "イーブイ かがやく"로도 787장이
  //       나온다. 그러니 자리만 맞춰 주면 되고 어순까지 손볼 필요는 없다.
  //    ⚠️ "찬란한"이 먼저 잡히도록 **긴 것을 위에** 둔다. 아래 치환은 적힌 순서대로 돈다.
  ['찬란한 ', 'かがやく'],
  ['찬란', 'かがやく'],
];

// 긴 이름부터 치환해야 "리자드"가 "리자몽" 안에서 먼저 걸려 이름이 깨지는 걸 막을 수 있다.
const sortedPokemonKo = withMega(
  [...(pokemonNames as PokemonName[]), ...aliasPairs]
    .filter((entry) => entry.ko && entry.ja)
    .map((e) => ({ ko: e.ko, ja: e.ja })),
);

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
  // 화면에 쓰는 세트 이름 → 일본어. 팩 사전은 한글 이름으로 짝을 짓는데 그 한글이
  // 화면 이름과 다른 세트가 있다("스노해저드" vs 팩 사전 "…스노우해저드", 우 한 글자).
  // 세트 코드로 이어 만든 것이라 표기가 어떻든 정확하다
  // (scripts/gen-set-names.mts가 만든다. 세트가 늘면 다시 돌린다).
  ...Object.entries(setNameKoJa as Record<string, string>).map(([ko, ja]) => ({
    ko,
    ja: dropPackKind(ja, ko),
  })),
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
// COMPOUND_TERMS(포켓몬 이름을 품은 낱말)도 같이 뒤집는다 — "샌드위치"로 검색할 때
// サンドウィッチ가 나가야지, 모래두지(サンド)로 나가면 안 된다.
for (const [ja, ko] of [...COMPOUND_TERMS, ...STRUCTURAL_TERMS]) {
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
  // 사람들이 치는 표기를 공식 표기로 먼저 고친다. 아무것도 바꾸기 전에 해야
  // 그다음 규칙들이 평소대로 걸린다(위 KO_SEARCH_ALIASES 설명).
  for (const [typed, official] of KO_SEARCH_ALIASES) {
    if (result.includes(typed)) result = result.split(typed).join(official);
  }
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
    // ⚠️ 한자 뒤에 붙는 히라가나(送り仮名)까지 한자뿐인 것으로 친다. ["入り", "입"]이
    //    り 때문에 이 검사를 빠져나가, "옷갈아입은 피카츄"가 "옷갈아入り銀 ピカチュウ"가
    //    됐다(→ 검색 0건). 가타카나로 시작하는 말(볼→ボール)은 그대로 두어야 한다.
    ...sortedStructuralKo.map(([ko, ja]) => ({
      ko,
      ja,
      short: ko.trim().length <= 2 && /^[一-鿿]+[ぁ-ん]*$/.test(ja.trim()),
    })),
    // 트레이너 이름은 카드명 전체가 그 이름일 때만 쓰는 것이라, 검색어에서도
    // 낱말로 홀로 섰을 때만 되돌린다(short). "이수"(アズサ)를 그냥 바꾸면
    // "이수재"(マサキ)가 "アズサ재"로 갈라진다.
    ...EXACT_TRAINER_NAMES.map(([ja, ko]) => ({ ko, ja, short: true })),
  ].sort((a, b) => b.ko.length - a.ko.length);

  for (const { ko, ja, short } of merged) {
    if (!result.includes(ko)) continue;
    if (short) {
      // 뒤에 조사 '의'가 붙는 건 낱말로 홀로 선 것으로 친다. 안 그러면 "강함의 매력"이
      // 강함(強さ)을 못 바꾸고 "강함의 魅力"로 남는다. '의'는 뒤에서 の로 바뀐다.
      // "이수재"(이수+재)처럼 진짜 다른 낱말은 여전히 막힌다.
      result = result.replace(new RegExp(`(^|[^가-힣0-9])${ko}(의)?(?![가-힣])`, 'g'), `$1${ja}$2`);
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

  // 이름은 일본어로 바뀌었는데 사이의 "의"만 한글로 남는 경우가 있다
  // ("페퍼의 샌드위치" → "ペパー의 サンドウィッチ", 실측 100종). 스니커덩크는 일본어로
  // 찾는 곳이라 이러면 0건이고, 자동완성은 한글이 남으면 아예 호출도 안 한다.
  // 앞이 일본어일 때만 の로 바꾼다 — 그 자리의 "의"는 조사가 확실하기 때문이다
  // ("의욕"·"의사"처럼 낱말 첫머리인 경우는 앞이 한글이라 안 걸린다).
  result = result.replace(/([ぁ-んァ-ヶー一-鿿])\s*의\s*/g, '$1の');

  // 골드스타는 화면에 ★로 보여주지만 스니커덩크 상품명엔 그 기호가 없다.
  // 검색어에서만 뗀다("리자몽 ★" → "リザードン").
  result = result.replace(/\s*★\s*/g, ' ').replace(/ {2,}/g, ' ').trim();

  // 남은 소유격 "의"를 일본어 の로 바꾼다. 이름만 일본어로 바뀌고 "의"가 남으면
  // 스니커덩크에서 안 잡힌다("ロケット団의 ミュウツー"). 앞이 일본어(또는 N 같은
  // 알파벳)일 때만 바꾸므로, 아직 한글로 남은 이름의 "의"는 건드리지 않는다.
  result = result.replace(/([ぁ-んァ-ヶ一-鿿A-Za-z0-9])의\s*/g, '$1の');

  // 마지막 그물. 여기까지 와도 한글이 남았다면 스니커덩크에서 0건이다. 그때만
  // EXACT_TITLES(카드명 전체가 그 이름일 때 쓰는 사전)를 통짜로 되돌려 본다.
  //
  // 왜 여기서만 하나: 이 사전에는 "네모"·"그리"처럼 두 글자짜리 이름이 있어서, 위쪽
  // 규칙들처럼 낱말 속까지 바꾸면 멀쩡한 검색어를 갈라 놓는다. 검색어 전체가 그
  // 이름과 똑같을 때만 바꾸면 그럴 일이 없다.
  // 왜 실패했을 때만 하나: 이미 되던 검색어는 손대지 않으므로 나빠질 수가 없다.
  // 이 그물이 없어서 "체렌"·"헤비볼"·"루어볼" 같은 39종이 스니커덩크에서 0건이었다
  // (같은 한글에 일본어가 둘 붙은 항목은 없어 어느 쪽인지 헷갈릴 일도 없다).
  if (/[가-힣]/.test(result)) {
    const whole = exactTitleByKo.get(trimmed);
    if (whole) return whole;
    // 같은 그물의 두 번째 겹. 우리 세트 파일에는 카드마다 일본어 원문이 그대로 있으니,
    // 규칙이 못 옮긴 이름은 그 원문을 바로 준다("스타단의 조무래기" → スター団のしたっぱ).
    // scripts/gen-ko-ja-cards.mts 가 "규칙이 못 옮기는 것만" 골라 만든 표라 190종뿐이다.
    const fromCards = cardKoToJa.get(trimmed);
    if (fromCards) return fromCards;
  }
  return result;
}

// 한글 카드명 → 일본어 원문(scripts/gen-ko-ja-cards.mts 가 만든다).
// 세트 파일을 고쳐 이름이 바뀌면 이 표도 다시 만들어야 한다.
const cardKoToJa = new Map<string, string>(Object.entries(cardNameKoJa as Record<string, string>));

// EXACT_TITLES를 한글→일본어로 뒤집은 것. 알파벳만인 왼쪽(옛 세트의 깨진 원본을
// 고치려고 넣은 것)은 스니커덩크에서 못 찾으므로 뺀다 — 위 reverseStructuralTerms와 같은 이유.
const exactTitleByKo = new Map<string, string>();
for (const [ja, ko] of EXACT_TITLES) {
  if (!/[ぁ-んァ-ヶ一-鿿]/.test(ja)) continue;
  if (!exactTitleByKo.has(ko)) exactTitleByKo.set(ko, ja);
}

// 같은 검색 의도라도 한글로 쳤는지 일본어로 쳤는지에 따라 문자열이 달라지면
// "인기 검색어" 집계가 갈라진다. 검색어를 일본어로 번역했다가 다시 카드명
// 한글화 파이프라인을 태워서, 입력 방식과 무관하게 항상 같은 표기로 모은다.
export function canonicalizeSearchTerm(query: string): string {
  // ⚠️ **전각 부호를 먼저 편다.** 안 그러면 "초련＆담죽"과 "초련&담죽"이 다른 말로
  //    세어져 **한 카드의 표가 두 줄로 갈린다**(2026-08-07 확인). 화면에 보이는
  //    이름을 복사해 붙여 넣는 사람과 직접 치는 사람이 갈리기 때문이다.
  const trimmed = 전각부호펴기(query.trim());
  if (!trimmed) return trimmed;
  const 바꾼것 = tidySearchTerm(koreanizeTitle(translateSearchQuery(trimmed)));
  // ⚠️ **한글이 안 남으면 원문을 쓴다.** translateSearchQuery는 마켓에 보낼 일본어를
  //    만드는 함수라 띄어쓰기를 없앤다("リザードンex"가 맞는 표기다). 한글 검색어는
  //    koreanizeTitle이 "리자몽 ex"로 되돌려 주지만, **영어로 친 검색어는 되돌릴 곳이
  //    없어 "Charizardex"인 채로 인기 검색어에 오른다.** 운영 자료에 실제로
  //    Jolteonex·landorusex·Gardevoirex가 올라 있었다(2026-08-07 확인).
  //    여기 값은 사람이 읽을 순위표 이름이므로, 번역이 안 됐으면 친 그대로가 낫다.
  if (/[가-힣]/.test(바꾼것)) return 바꾼것;
  return tidySearchTerm(trimmed) || 바꾼것;
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
