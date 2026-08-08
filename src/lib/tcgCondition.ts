/**
 * TCGplayer 마켓가가 **어떤 상태의 매물로 잡혔는지** 한글로 적는다.
 * **상세 화면과 목록이 이 한 벌만 쓴다.**
 *
 * 왜 밝혀야 하나 — 옛 일본판은 매물이 귀해서 민트가 아닌 카드로 값이 잡히는 일이 흔하다.
 * 실측(2026-08-08): TCGplayer 값이 있는 카드 60장 중 **17장(28%)**이 민트가 아니었다.
 *     리자몽 $10,000  ← "Moderately Played 1st Edition Holofoil"
 *     거북왕 $1,300   ← "Moderately Played 1st Edition Holofoil"
 * 상태를 안 밝히면 민트 카드를 가진 사람이 자기 카드 값을 그만큼으로 오해한다.
 *
 * ⚠️ **모르는 표기는 조용히 넘긴다.** 틀리게 말하느니 안 하는 게 낫다.
 * ⚠️ 규칙을 화면마다 따로 적지 않는다. 2026-08-08에 같은 실수를 여러 번 겪었다 —
 *    한쪽만 고치면 같은 카드가 목록과 상세에서 다르게 보인다.
 */
export function 상태글(cond: string | null | undefined): string | null {
  if (!cond) return null;
  if (/Near Mint/i.test(cond)) return null; // 민트면 굳이 안 적는다(대부분이 이것이다)
  if (/Lightly Played/i.test(cond)) return '조금 사용된';
  if (/Moderately Played/i.test(cond)) return '보통 사용된';
  if (/Heavily Played/i.test(cond)) return '많이 사용된';
  if (/Damaged/i.test(cond)) return '손상된';
  return null;
}
