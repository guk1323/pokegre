import pokemonNames from '../data/pokemonNames.json';
import packNames from '../data/packNames.json';
import cardNameKoEn from '../data/cardNameKoEn.json';
import cardNamesKo from '../data/cardNamesKo.json';
import cardNamesEn from '../data/cardNamesEn.json';
import { CARD_NAME_KO_TO_EN, STRUCTURAL_EN_TO_KO } from './koreanizeEnglishTitle';

// ── 📏 고치기 전 기준값 (2026-08-08, 배포 직전) ──────────────────────────────
// 오늘 사전을 크게 넓혔다(영문 이름 4,584가지 추가 · 서버가 매일 주는 낱말 17,684가지 ·
// 겹치는 이름 정리). **효과가 있었는지는 배포 뒤에 이 값과 견줘야 안다.**
//
//   방문자가 검색을 확정한 방법 (운영 집계 783번 기준)
//     그냥 치다 멈춰서   377번  48.1%
//     엔터를 눌러서      271번  34.6%
//     **자동완성에서 골라서  58번   7.4%**   ← 이게 오르면 사전이 좋아진 것이다
//     인기 검색어를 눌러서 35번   4.5%
//     사진으로            42번   5.4%
//
//   같은 날 잰 사전 상태(방문자가 친 말 952가지의 모든 타이핑 단계 기준)
//     빈 목록 40.9% → **22.1%** · 영문 입력 16.1% → **5.1%**
//     우리 사전만으로 열 줄이 차는 비율 **74.7%**
//
// ⚠️ 통계는 `search_pick`으로 쌓인다(VisitStats의 "└ 자동완성에서 골라서").
//    **새로 재려면 배포 뒤 최소 며칠은 지나야 한다** — 하루치로는 흔들린다.

// 같은 이름을 자료마다 다르게 적어 둔 것을 하나로 보기 위한 열쇠.
// "썬더-EX"·"썬더 EX"·"썬더EX"가 모두 같은 열쇠가 된다.
const 붙임열쇠 = (s: string) => s.replace(/[\s-]/g, '');

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

// ⚠️ **띄어쓰기·붙임표만 다른 짝을 여기서 한 번 더 합친다.**
//    카드명 목록(cardNamesKo)은 만들 때 이미 합쳐서 오지만, **재료가 그것만이 아니다** —
//    번역 사전(cardNameKoEn)·굿즈 대조표(STRUCTURAL_EN_TO_KO)가 같은 것을 다르게 적어
//    둬서 합친 뒤에 다시 갈라졌다. "별의 조각 ↔ 별의조각", "핸드 스코프 ↔ 핸드스코프",
//    "송호 오 ↔ 송호오" 같은 7가지가 목록에 나란히 떴다(2026-08-08 점검에서 잡음).
//    ⚠️ **대소문자는 합치지 않는다** — "블래키 ex"(요즘)와 "블래키 EX"(2000년대)는
//       진짜 다른 카드다.
//    남길 쪽은 **띄어쓰기가 있는 것**을 고른다(사람이 읽기 쉽고 검색도 잘 된다).
//    자리는 처음 나온 자리를 지킨다 — 앞쪽 재료(포켓몬·팩 이름)가 먼저 잡혀야 한다.
{
  const 자리 = new Map<string, number>();
  const 띈수 = (t: string) => (t.match(/\s/g) ?? []).length;
  const 남길것: string[] = [];
  for (const t of koTerms) {
    const k = 붙임열쇠(t);
    const i = 자리.get(k);
    if (i === undefined) {
      자리.set(k, 남길것.length);
      남길것.push(t);
    } else {
      const 이전 = 남길것[i];
      if (띈수(t) > 띈수(이전) || (띈수(t) === 띈수(이전) && t.length < 이전.length)) 남길것[i] = t;
    }
  }
  koTerms.length = 0;
  koTerms.push(...남길것);
}

// ⚠️ **레어도 낱말("리자몽 MUR")은 서버에서 한 번 더 받는다.** 위 cardNamesKo.json에도
//    들어 있지만 그건 **빌드한 날에 멈춰 있다** — 새 세트가 새 레어도를 들고 나와도
//    안 따라온다. 서버는 시세 덤프를 어차피 매일 받으므로 거기서 같이 뽑아 둔다
//    (크레딧 0 · 통째 받기 몫 0). 못 받으면 그냥 빌드 시점 목록으로 간다.
// ⚠️ **맨 뒤에 붙인다.** 사람이 먼저 찾는 건 카드 이름이지 레어도가 아니다.
//    이 파일은 검색창을 누를 때 처음 불러오므로, 그 순간이 받기 시작하기 좋은 때다.
// 영문판 세트의 원래 카드 이름(4,651가지). 소문자로 미리 만들어 두고 견준다 —
// 칠 때마다 4,651개를 소문자로 바꾸면 글자마다 그 일을 다시 하게 된다.
const enTerms: string[] = (cardNamesEn as string[]).filter((s) => !!s && s === s.trim());
const enLower: string[] = enTerms.map((s) => s.toLowerCase());

let 레어도받는중 = false;
function ensureRarityTerms(): void {
  if (레어도받는중) return;
  레어도받는중 = true;
  void fetch('/api/local/rarity-terms')
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { terms?: unknown } | null) => {
      const 낱말 = Array.isArray(j?.terms) ? (j.terms as unknown[]) : [];
      const 있는것 = new Set([...koTerms, ...enTerms].map(붙임열쇠));
      for (const t of 낱말) {
        if (typeof t !== 'string' || !t) continue;
        const k = 붙임열쇠(t);
        if (있는것.has(k)) continue;
        있는것.add(k);
        // ⚠️ **한글과 영문을 갈라 담는다.** 영문은 대소문자를 안 가리고 견주므로
        //    소문자 짝(enLower)이 있어야 한다. 한꺼번에 koTerms에 넣으면 서버가 준
        //    영문 이름만 "pikachu"로 쳤을 때 안 걸린다.
        if (/[가-힣]/.test(t)) koTerms.push(t);
        else {
          enTerms.push(t);
          enLower.push(t.toLowerCase());
        }
      }
    })
    .catch(() => undefined);
}
ensureRarityTerms();

// 포켓몬/팩 한글 이름 사전에서 접두 일치를 우선하고, 부분 일치를 뒤에 붙여서
// 타이핑 중에도 즉시(네트워크 요청 없이) 유사 검색어를 보여준다.
export function getLocalSuggestions(query: string, limit = 8): string[] {
  const q = query.trim();
  if (!q) return [];

  // ⚠️ **앞이 같아도 두 갈래로 나눈다.**
  //    ① 친 말 뒤가 끊기는 것: "잠만보 V" · "잠만보 ex"  ← 그 카드다
  //    ② 친 말이 더 긴 낱말에 묻힌 것: "잠만보도루"      ← 다른 카드다
  //    길이순으로만 세우면 ②가 먼저 와서, "잠만보"를 친 사람이 첫 줄에서
  //    "잠만보도루"를 본다(2026-08-08 확인. "썬더"→"썬더라이", "고래왕"→"고래왕자"도
  //    같았다). 목적은 **덜 알아도 우리가 가진 걸 보여주는 것**이지 엉뚱한 걸
  //    먼저 보여주는 게 아니다.
  // ⚠️⚠️ **무리 안에서 "짧은 것부터"로 다시 세우지 말 것.** "썬더"를 치면 경기장 카드
  //    ("썬더 마운틴 ◇")가 "썬더 ex"보다 먼저 떠서 고치고 싶어지는데, 실제 검색어
  //    952가지로 재 보니 그렇게 하면 **첫 줄의 52.1%가 바뀌고 거의 다 나빠진다**
  //    (2026-08-08 실측): 피카츄 ex → 피카츄 ★ · 뮤 ex → **뮤츠**(다른 포켓몬) ·
  //    파이어 ex → **파이어로**(다른 포켓몬). 지금 순서(재료 순 = 포켓몬·팩 이름이 먼저,
  //    그다음 카드명)가 낫다.
  const startsExact: string[] = [];
  const starts: string[] = [];
  const includes: string[] = [];
  const 담기 = (term: string, 견줄것: string, 친것: string) => {
    if (견줄것 === 친것) return;
    if (견줄것.startsWith(친것)) {
      // 뒤가 한글·영문·숫자로 이어지면 다른 낱말에 묻힌 것이다.
      const 뒤 = 견줄것.slice(친것.length);
      (뒤 === '' || !/^[가-힣A-Za-z0-9]/.test(뒤) ? startsExact : starts).push(term);
    } else if (wordStart.test(견줄것)) includes.push(term);
  };
  // 부분 일치는 "단어 시작"에서만 본다. 아무 데나 걸리게 두면 "이브"에 "드닐레이브",
  // "뮤"에 "줄뮤마"처럼 관계없는 이름이 올라와 목록이 미덥지 않아 보인다.
  const wordStart = new RegExp(`(^|[\\s:·-])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  for (const term of koTerms) 담기(term, term, q);

  // ⚠️ **영문으로 치면 목록이 통째로 비어 있었다.** 위 한글 사전에는 영문 이름이
  //    없어서다("Charizard"·"pikachu"·"Mega" → 0줄). 그 자리를 스니커덩크가 메우고
  //    있었는데, 실제 인기 검색어 2~5위가 Pikachu XY95·Pikachu·Charizard 136·
  //    Charizard다. 방문자가 친 말로 재 보니 **치는 도중 16.1%가 영문**이었다
  //    (2026-08-08 실측).
  // ⚠️ **대소문자를 가리지 않는다.** 사람들은 "pikachu"·"gym"처럼 소문자로 친다.
  //    카드 이름은 "Pikachu"라서, 그대로 견주면 하나도 안 걸린다.
  // ⚠️ 한글이 섞인 말에는 안 돌린다 — 걸릴 리가 없는데 4,651가지를 훑을 이유가 없다.
  if (/[A-Za-z]/.test(q) && !/[가-힣]/.test(q)) {
    const 소문자 = q.toLowerCase();
    for (let i = 0; i < enTerms.length; i++) 담기(enTerms[i], enLower[i], 소문자);
  }

  return [...new Set([...startsExact, ...starts, ...includes])].slice(0, limit);
}
