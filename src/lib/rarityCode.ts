// 카드 이름 뒤에 붙은 레어도 코드("리자몽 SAR")를 다루는 한 벌.
//
// ⚠️ 팝수 화면과 시세 화면이 **둘 다 이걸 쓴다.** 처음엔 팝수 화면 안에만 두었는데,
//    시세 쪽(이베이·TCGplayer)에도 같은 문제가 있어 옮겼다(2026-08-08). 베껴 두면
//    언젠가 한쪽만 고쳐 같은 말이 화면마다 다르게 동작한다.

// 저쪽(PPT)의 `search`는 **카드 이름만** 본다. 그래서 "리자몽 MUR"을 그대로 보내면
// 0장이 온다. 하지만 저쪽이 주는 카드마다 레어도가 이미 붙어 있고(화면에도 이미
// "Mega Ultra Rare"라고 찍고 있었다), 사람들이 치는 코드와 그대로 대응한다.
// → **이름으로 받아서 레어도는 우리가 거른다.**
// ⚠️ 덤으로 크레딧이 안 든다 — "리자몽"·"리자몽 SAR"·"리자몽 MUR"이 모두 같은
//    "Charizard" 한 번으로 처리되어 6시간 담아 둔 것을 다시 쓴다.
// ⚠️ ex·V·VMAX·GX는 **여기 넣으면 안 된다.** 그건 레어도가 아니라 카드 이름의
//    일부이고 저쪽이 알아듣는다.
// ⚠️ **일본판과 영문판이 같은 레어도를 다르게 부른다.** 한 코드에 양쪽 표기를 다 적는다.
//    일본판 "Special Art Rare" ↔ 영문판 "Special Illustration Rare" (2026-08-08 실측).
//    한쪽만 적으면 영문판에서 "Charizard SAR"이 안 걸린다 — 실제로 그랬다.
// ⚠️⚠️ **이 표가 하나뿐인 원본이다.** 예전엔 같은 표가 세 군데 있었다 — 여기, 서버의
//    RARITY_CODE, 그리고 gen-rarity-from-dump. 서로 어긋나 두 가지 사고가 났다
//    (2026-08-08 점검에서 잡음):
//      ① 서버가 "디안시 PR"·"○○ ACE"를 자동완성으로 권하는데 여기 없어서 **눌러 보면
//         0장**이 나왔다(68가지). 레어도로 못 알아들으면 이름째 저쪽에 물어보는데,
//         저쪽 search는 카드 이름만 보기 때문이다.
//      ② 서버는 'Secret Rare'·'Shiny Holo Rare'도 SR·S로 만드는데 여기엔 그 글자가
//         없어서, **권한 대로 눌러도 그 카드들이 걸러져 빠졌다.**
//    이제 서버와 스크립트가 아래 `PPT레어도별코드`를 가져다 쓴다. **여기만 고치면 된다.**
//
// ⚠️ **줄 순서가 곧 "만들 때 고를 코드"다.** 아래 뒤집기는 먼저 나온 것을 쓴다.
//    같은 글자를 여러 코드가 가리킬 때(Radiant Rare → 찬란 / RADIANT) **먼저 적힌 쪽**이
//    자동완성에 뜬다. 뒤쪽은 "사람이 그렇게 칠 수도 있는 딴이름"일 뿐이다.
export const 레어도표 = new Map<string, string[]>([
  ['SAR', ['Special Art Rare', 'Special Illustration Rare']],
  ['AR', ['Art Rare', 'Illustration Rare']],
  ['MUR', ['Mega Ultra Rare']],
  ['MAR', ['Mega Attack Rare']],
  ['MHR', ['Mega Hyper Rare']],
  ['CSR', ['Character Super Rare']],
  ['CHR', ['Character Rare']],
  ['SSR', ['Shiny Secret Rare']],
  // 'Secret Rare'는 영문판 표기, 'Super Rare Holo'는 옛 일본판 표기다(뮤·빛나는 잉어킹).
  ['SR', ['Super Rare', 'Secret Rare', 'Super Rare Holo']],
  ['RRR', ['Triple Rare']],
  ['RR', ['Double Rare']],
  ['UR', ['Ultra Rare']],
  ['HR', ['Hyper Rare']],
  ['S', ['Shiny Rare', 'Shiny Holo Rare']],
  // ACE SPEC. 일본판은 'ACE Rare', 옛 영문판은 'Rare Ace'로 적는다
  // (마스터볼·컴퓨터 서치·언페어 스탬프).
  ['ACE', ['ACE SPEC Rare', 'ACE Rare', 'Rare Ace']],
  ['PR', ['Prism Rare']],
  // 트레이너즈 레어(릴리에·글라디오·네스트볼). 일본판에서 흔히 TR이라 부른다.
  ['TR', ['Trainer Rare']],
  // 무지개 시크릿(리자몽 GX Secret 같은 것).
  ['RAINBOW', ['Rainbow Rare']],
  ['찬란', ['Radiant Rare', 'Kagayaku']],
  ['프로모', ['Promo']],
  // ── 아래는 **딴이름**이다. 사람이 이렇게 칠 수 있어 알아듣기는 하되,
  //    자동완성이 만들 때는 위의 대표 코드를 쓴다(뒤집기가 먼저 나온 것을 쓴다).
  ['RADIANT', ['Radiant Rare']],
  ['찬란한', ['Kagayaku']],
  ['PROMO', ['Promo']],
  // ── 여기부터는 **알아듣기만 하고 자동완성에는 안 내는** 코드다(아래 `자동완성안함`).
  //    ⚠️ 왜 갈라 뒀나: 방문자 검색 기록을 다 재 보니 「플러시 C :1ED」가 **19번**으로
  //       0건 2등이었다(2026-08-16). 스니커덩크·장터에서는 커먼을 「C」, 언커먼을 「U」로
  //       적는데 우리는 그 글자를 몰라 이름의 일부로 보고 0건을 냈다.
  //    ⚠️ **그렇다고 자동완성에 내면 안 된다.** 커먼만 14,000장이라 「○○ C」가 목록을
  //       통째로 덮는다. 위 대표 코드들과 달리 이건 좁히는 데 도움이 안 되는 등급이다
  //       (이 파일 첫머리에 적힌 「Common·Rare 같은 건 안 만든다」가 그 뜻이다).
  ['C', ['Common', 'Common Holo']],
  ['U', ['Uncommon']],
  ['R', ['Rare', 'Holo Rare', 'Rare Holo']],
]);

/**
 * **알아듣기만 하고 자동완성 낱말로는 안 만드는 코드.**
 * `PPT레어도별코드`(자동완성 재료)가 이걸 건너뛴다. `레어도떼기`·`레어도맞나`는 그대로 쓴다.
 */
export const 자동완성안함 = new Set(['C', 'U', 'R']);

/**
 * 저쪽(PPT) 표기 → 우리 코드. 위 표를 뒤집은 것이다.
 * **자동완성 낱말을 만드는 쪽(서버·스크립트)이 이걸 쓴다** — 표를 두 벌 두지 않으려는 것이다.
 * ⚠️ 같은 글자가 여러 코드에 있으면 **먼저 적힌 코드**를 쓴다.
 * ⚠️ 여기에 없는 레어도는 안 만든다. "Common"·"Rare" 같은 건 좁히는 데 도움이 안 된다.
 */
export const PPT레어도별코드: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [코드, 글자들] of 레어도표) {
    // ⚠️ 알아듣기 전용 코드(C·U·R)는 자동완성 재료에서 뺀다. 넣으면 커먼 14,000장에
    //    「○○ C」가 붙어 목록이 통째로 덮인다.
    if (자동완성안함.has(코드)) continue;
    for (const 글자 of 글자들) if (!m.has(글자)) m.set(글자, 코드);
  }
  return m;
})();
/**
 * **스니커덩크에서만 통하는 꼬리말을 떼어낸다.** ":1ED"(초판) 같은 것이다.
 *
 * ⚠️ 저쪽(PPT)에 그대로 보내면 **0장**이 온다 — 카드 이름으로만 찾기 때문이다
 *    ("제크로무 :1ED" → 이베이 0장 / 스니커덩크 8장, 2026-08-08 실측).
 *    방문자 검색 2,214번 중 **46번**이 이 꼴이었다.
 * ⚠️ **콜론이 든 말을 다 떼면 안 된다.** 우리 팩 이름에 콜론이 들어 있다 —
 *    "스칼렛&바이올렛 : 배틀파트너즈"·"메가진화 : 니힐제로"가 25번 검색됐다.
 *    그래서 **":글자"가 통째로 한 낱말일 때만** 뗀다(팩 이름은 콜론 앞뒤가 띄어져 있어
 *    ":" 혼자 한 낱말이 되므로 안 걸린다. "VSTAR:"처럼 앞에 붙은 것도 안 걸린다).
 */
export const 마켓전용말떼기 = (말: string): { 이름: string; 뗀말: string } => {
  const 조각 = 말.trim().split(/\s+/);
  const 남길것 = 조각.filter((t) => !/^:[A-Za-z0-9]+$/.test(t));
  if (남길것.length === 조각.length || !남길것.length) return { 이름: 말.trim(), 뗀말: '' };
  return {
    이름: 남길것.join(' '),
    뗀말: 조각.filter((t) => /^:[A-Za-z0-9]+$/.test(t)).join(' '),
  };
};

/** "리자몽 MUR" → { 이름: "리자몽", 코드: "MUR" }. 뒤에 레어도가 없으면 코드는 빈 값. */
export const 레어도떼기 = (말: string): { 이름: string; 코드: string } => {
  const 조각 = 말.trim().split(/\s+/);
  // ⚠️ **레어도만 친 경우**("MUR"). 저쪽에는 레어도로 물어보는 방법이 없어서 그대로
  //    보내면 이름에 그 글자가 든 카드가 잔뜩 온다("MUR" → Whismur·Murkrow 76장,
  //    2026-08-08 확인). 이름을 빈 값으로 돌려주어 부르는 쪽이 안내하게 한다.
  if (조각.length === 1) {
    const 하나 = 레어도표.has(조각[0].toUpperCase()) ? 조각[0].toUpperCase() : 레어도표.has(조각[0]) ? 조각[0] : '';
    return 하나 ? { 이름: '', 코드: 하나 } : { 이름: 말.trim(), 코드: '' };
  }
  const 끝 = 조각[조각.length - 1];
  const 코드 = 레어도표.has(끝.toUpperCase()) ? 끝.toUpperCase() : 레어도표.has(끝) ? 끝 : '';
  if (!코드) return { 이름: 말.trim(), 코드: '' };
  // ⚠️ **한 글자 코드(S)는 영문 이름 뒤에서 떼지 않는다.** "Unown S"는 진짜 카드 이름이다
  //    (en-dp3 39번·ja-neo4 51번. 같은 카드를 다른 세트는 "Unown [S]"로 적어 놨다).
  //    그대로 떼면 "Unown"을 Shiny Rare로 걸러 엉뚱한 답이 나간다(2026-08-08 점검에서 잡음).
  //    레어도 코드는 일본·한국 장터 말이라 **영문으로 치는 사람은 "Charizard S"라고
  //    안 친다.** 우리 자동완성도 영문 이름에는 코드를 안 붙인다(한글 이름에만 붙인다).
  //    사전 낱말 13,334가지를 전수로 대조해 이 한 가지만 걸렸다.
  if (코드.length === 1 && !/[가-힣]/.test(조각.slice(0, -1).join(' '))) {
    return { 이름: 말.trim(), 코드: '' };
  }
  return { 이름: 조각.slice(0, -1).join(' '), 코드 };
};


/** 그 카드가 이 레어도 코드에 맞나. */
export const 레어도맞나 = (코드: string, 카드레어도: string): boolean =>
  (레어도표.get(코드) ?? []).some((r) => r.toLowerCase() === String(카드레어도).trim().toLowerCase());

/**
 * 레어도를 **화면에 낼 한글**로. 카드 타일·상세가 이 한 벌만 쓴다.
 *
 * 왜 — 지금까지 레어도가 영문 그대로 나갔다("Holo Rare"·"Illustration rare").
 * 카드마다 보이는 것이라 눈에 제일 많이 띈다(2026-08-09 사장님 지적).
 *
 * ⚠️ 표기가 저쪽에서 제각각이다 — 대소문자도 다르고("Double rare"/"Double Rare"),
 *    같은 뜻을 다르게 적기도 한다("Secret Rare"/"Super Rare"). **소문자로 맞춰** 찾는다.
 * ⚠️ 모르는 표기는 **그대로 내보낸다.** 억지로 옮기면 없는 등급을 만든다.
 */
const 레어도한글표: Record<string, string> = {
  // ── 2026-08-09에 도감을 PPT로 갈아엎으며 새로 들어온 레어도 ──────────────────
  // ⚠️ `ACE SPEC`·`LEGEND`처럼 **카드에 영문으로 찍힌 것**은 한글로 바꾸지 않는다.
  'character rare': '캐릭터 레어',
  'character super rare': '캐릭터 슈퍼 레어',
  'code card': '코드 카드',
  'prism rare': '프리즘 레어',
  'rainbow rare': '레인보우 레어',
  shining: '샤이닝',
  'special art rare': '스페셜 아트 레어',
  'trainer rare': '트레이너 레어',
  'triple rare': '트리플 레어',
  'mega attack rare': '메가 어택 레어',
  'mega ultra rare': '메가 울트라 레어',
  special: '스페셜',
  common: '커먼',
  uncommon: '언커먼',
  none: '-',
  rare: '레어',
  'double rare': '더블 레어',
  'ultra rare': '울트라 레어',
  'illustration rare': '일러스트 레어',
  'art rare': '일러스트 레어',
  'special illustration rare': '스페셜 일러스트 레어',
  'secret rare': '시크릿 레어',
  'super rare': '시크릿 레어',
  promo: '프로모',
  'holo rare': '홀로 레어',
  'rare holo': '홀로 레어',
  'super rare holo': '홀로 레어',
  'common holo': '홀로 레어',
  'shiny rare': '샤이니 레어',
  'shiny ultra rare': '샤이니 울트라 레어',
  'hyper rare': '하이퍼 레어',
  'mega hyper rare': '하이퍼 레어',
  'rare holo lv.x': '홀로 레어 LV.X',
  'holo rare v': '홀로 레어 V',
  'holo rare vmax': '홀로 레어 VMAX',
  'classic collection': '클래식 컬렉션',
  'ace spec rare': 'ACE SPEC 레어',
  'ace rare': 'ACE SPEC 레어',
  'rare ace': 'ACE SPEC 레어',
  'one diamond': '1 다이아몬드',
  'three diamond': '3 다이아몬드',
  'four diamond': '4 다이아몬드',
  'full art trainer': '풀아트 트레이너',
  'one star': '1 스타',
  'two star': '2 스타',
  'black white rare': '블랙&화이트 레어',
  'rare holo legend': '홀로 레어 LEGEND',
  'amazing rare': '어메이징 레어',
  'futuristic rare': '미래 레어',
  'ultra-rare common': '울트라 레어',
  'ultra-rare uncommon': '울트라 레어',
  unconfirmed: '미확인',
}
export const 레어도한글 = (r: string | null | undefined): string => {
  const s = String(r ?? '').trim()
  if (!s) return ''
  return 레어도한글표[s.toLowerCase()] ?? s
}
