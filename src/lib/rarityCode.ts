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
]);

/**
 * 저쪽(PPT) 표기 → 우리 코드. 위 표를 뒤집은 것이다.
 * **자동완성 낱말을 만드는 쪽(서버·스크립트)이 이걸 쓴다** — 표를 두 벌 두지 않으려는 것이다.
 * ⚠️ 같은 글자가 여러 코드에 있으면 **먼저 적힌 코드**를 쓴다.
 * ⚠️ 여기에 없는 레어도는 안 만든다. "Common"·"Rare" 같은 건 좁히는 데 도움이 안 된다.
 */
export const PPT레어도별코드: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [코드, 글자들] of 레어도표) {
    for (const 글자 of 글자들) if (!m.has(글자)) m.set(글자, 코드);
  }
  return m;
})();
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
  return { 이름: 조각.slice(0, -1).join(' '), 코드 };
};


/** 그 카드가 이 레어도 코드에 맞나. */
export const 레어도맞나 = (코드: string, 카드레어도: string): boolean =>
  (레어도표.get(코드) ?? []).some((r) => r.toLowerCase() === String(카드레어도).trim().toLowerCase());
