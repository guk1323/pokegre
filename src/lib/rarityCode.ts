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
// ⚠️ **일본판과 북미판이 같은 레어도를 다르게 부른다.** 한 코드에 양쪽 표기를 다 적는다.
//    일본판 "Special Art Rare" ↔ 북미판 "Special Illustration Rare" (2026-08-08 실측).
//    한쪽만 적으면 북미판에서 "Charizard SAR"이 안 걸린다 — 실제로 그랬다.
export const 레어도표 = new Map<string, string[]>([
  ['SAR', ['Special Art Rare', 'Special Illustration Rare']],
  ['AR', ['Art Rare', 'Illustration Rare']],
  ['MUR', ['Mega Ultra Rare']],
  ['MAR', ['Mega Attack Rare']],
  ['MHR', ['Mega Hyper Rare']],
  ['CSR', ['Character Super Rare']],
  ['CHR', ['Character Rare']],
  ['SSR', ['Shiny Secret Rare']],
  ['SR', ['Super Rare']],
  ['RRR', ['Triple Rare']],
  ['RR', ['Double Rare']],
  ['UR', ['Ultra Rare']],
  ['RAINBOW', ['Rainbow Rare']],
  ['RADIANT', ['Radiant Rare']],
  ['찬란', ['Radiant Rare', 'Kagayaku']],
  ['HR', ['Hyper Rare']],
  ['S', ['Shiny Rare']],
  ['프로모', ['Promo']],
  ['PROMO', ['Promo']],
  ['찬란한', ['Kagayaku']],
]);
/** "리자몽 MUR" → { 이름: "리자몽", 코드: "MUR" }. 뒤에 레어도가 없으면 코드는 빈 값. */
export const 레어도떼기 = (말: string): { 이름: string; 코드: string } => {
  const 조각 = 말.trim().split(/\s+/);
  if (조각.length < 2) return { 이름: 말.trim(), 코드: '' };
  const 끝 = 조각[조각.length - 1];
  const 코드 = 레어도표.has(끝.toUpperCase()) ? 끝.toUpperCase() : 레어도표.has(끝) ? 끝 : '';
  if (!코드) return { 이름: 말.trim(), 코드: '' };
  return { 이름: 조각.slice(0, -1).join(' '), 코드 };
};


/** 그 카드가 이 레어도 코드에 맞나. */
export const 레어도맞나 = (코드: string, 카드레어도: string): boolean =>
  (레어도표.get(코드) ?? []).some((r) => r.toLowerCase() === String(카드레어도).trim().toLowerCase());
