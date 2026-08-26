/**
 * 이베이 긁기 — **판단 두 가지가 맞는지** 실제 매물 제목으로 잰다.
 *
 * ⚠️ 여기가 통과해야 쌓아도 된다. 잘못 담으면 **남의 카드 값이 이 카드 값인 척** 나간다.
 * 실행: npx tsx scripts/check-ebay-scan.mts
 */
import { readFileSync } from 'node:fs'
import { 내낙찰인가, 날짜읽기 } from '../server/api.ts'
import { 제목등급칸, 제목에감정사있나 } from '../src/lib/listingTitle.ts'

let 실패 = 0
const 재기 = (이름: string, 됨: boolean) => { if (!됨) 실패++; console.log(`  ${됨 ? '✔' : '⚠️'} ${이름}`) }

console.log('■ 이베이 날짜 읽기')
for (const [s, want] of [['Aug 19, 2026', '2026-08-19'], ['Jul 3, 2026', '2026-07-03'], ['Dec 25, 2025', '2025-12-25'], ['이상한값', '']] as [string, string][])
  재기(`"${s}" → "${날짜읽기(s)}"`, 날짜읽기(s) === want)

console.log('\n■ 내 카드 가리기 — 실제 매물 제목')
// ⚠️ 「번호가 들어 있나」로 보면 `09/09`가 딴 카드 `0703/09`에 걸린다(2026-08-19에 겪음).
const 표: [string, string, string | undefined, boolean][] = [
  ['Pokemon PSA 10 Captain Pikachu Holo 2025 07 09/09 Gem Pack Vol.1 S.Chinese', '09/09', undefined, true],
  ['Pokemon Chinese exclusive Horizon Captain Pikachu CBB1C 07 09 Holo Card PSA 10', '09/09', undefined, true],
  ['Pokemon S-Chinese Captain Pikachu Holo 0703/09 CBB1C Gem Horizon PSA 9', '09/09', undefined, false],
  ['2025 Pokemon CBB1 Chinese Captain Pikachu Holographic Foil 0704/09 - PSA 9', '09/09', undefined, false],
  ['CAPTAIN PIKACHU 2026 GEM PACK VOL.5 AR HOLO 0107/07 CGC 10', '09/09', undefined, false],
  ['2005 POKEMON EX DEOXYS GOLD STAR #107 RAYQUAZA-HOLO PSA 10', '107', undefined, true],
  ['Pokemon Rayquaza 1107 something', '107', undefined, false],
  ['Darkrai Team Plasma BW73 Promo PSA 10', 'BW73', undefined, true],
  ['Vaporeon H31/H32 Aquapolis Holo', 'H31', undefined, true],
  ['Pokemon Base Set Charizard 4/102 PSA 10', '4', undefined, true],
  // ⚠️ 한 자리 번호는 제목에 흔해서 그 자체로는 못 믿는다 — 세트 코드가 있어야 받는다.
  ['Random lot 1 of 4 pokemon cards', '4', undefined, false],
  ['Ampharos Neo Genesis 1 Holo PSA 9', '1', 'neo genesis', true],
  ['Pokemon 1st edition something else', '1', 'neo genesis', false],
  // ⚠️⚠️ **등급 숫자를 카드 번호로 읽으면 안 된다.** 「PSA 9」의 9가 우리 번호 09/09의
  //    9로 읽혀 딴 카드(#01)가 우리 칸에 들어왔다(사장님이 화면에서 잡음 2026-08-19).
  ['2025 Pokemon Chinese CAPTAIN PIKACHU CBB1 C-Gem Pack #01 PSA 9', '09/09', undefined, false],
  ['2025 POKEMON SIMPLIFIED CHINESE CBB1 C-GEM PACK VOL 1 #09 CAPTAIN PIKACHU PSA 9', '09/09', undefined, true],
  ['Pokemon Captain Pikachu Gem Pk. Vol. 1 07 09 Art Rare CGC 10 Pristine', '09/09', undefined, true],
]
for (const [t, n, code, want] of 표) 재기(`번호 ${n.padEnd(6)} ← ${t.slice(0, 56)}`, 내낙찰인가(t, n, code) === want)

console.log('\n■ 캡틴피카츄 실제 낙찰 35건에 걸어 보기')
try {
  const SL = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-sonhunguk-Documents/293e398c-99ee-4677-8299-e5a2ca3308e2/scratchpad/pika-listings.json', 'utf8'))
  const all: { price: number; title: string }[] = []
  for (const g of Object.keys(SL)) for (const s of SL[g]) all.push(s)
  const 내것 = all.filter((x) => 내낙찰인가(x.title, '09/09'))
  const 오염 = 내것.filter((x) => /0703\/09|0704\/09|CBB5|VOL\.? ?5|0102\/07/i.test(x.title))
  재기(`35건 중 ${내것.length}건 고름 · 딴 카드 섞임 ${오염.length}건`, 오염.length === 0 && 내것.length >= 3)
} catch { console.log('  (실측 파일이 없어 건너뜀)') }

console.log('\n■ 등급 읽기 — 짝퉁 감정사를 PSA 칸에 넣지 않는가')
for (const [t, want] of [
  ['... #09 CAPTAIN PIKACHU PSA 10', 'psa10'],
  ['... Captain Pikachu #09 Simplified Chinese PSA 9', 'psa9'],
  // ⚠️ 「PRI」는 프리스틴이라 CGC 10 위 등급이다 — 제 칸으로 간다(2026-08-19).
  ['Pokemon CGC 10 PRI Captain Pikachu Stars Holo', 'cgcp10'],
  // ⚠️ 「SAME AS PSA 9」라 적혀 있어도 **PSA가 아니다.** 제 칸(pgs9_5)으로 가야 맞다.
  // ⚠️ PGS는 큰 회사가 아니라 「기타 감정 회사」 한 칸으로 모은다(사장님 지시 2026-08-19).
  ['... Captain Pikachu 0704/09 PGS 9.5 (SAME AS PSA 9)', '기타'],
  ['Pokemon Captain Pikachu Gem Pack Vol 1 Chinese exclusive #09', ''],
] as [string, string][]) 재기(`"${(제목등급칸(t) || 'ungraded')}" ← ${t.slice(0, 52)}`, 제목등급칸(t) === want)

console.log('\n■ 등급 칸 가르기 — 큰 회사 넷만 따로, 나머지는 기타, 감정 표기 없으면 미감정')
// ⚠️ 캡틴피카츄 「등급 확인 안 됨」 10건을 사장님이 매물마다 열어 확인해 주신 결과가 잣대다.
for (const [t, want] of [
  ['Pokemon Captain Pikachu Gem Pk. Vol. 1 07 09 Art Rare S. Chinese CGC 10 Pristine', 'cgcp10'],
  ['Pokemon CGC 10 PRI Captain Pikachu Stars Holo', 'cgcp10'],
  ['CAPTAIN PIKACHU 2025 POKEMON CHINESE GEM PACK VOL. 1 ART RARE HOLO CGC 10 Q7285', 'cgc10'],
  ['Charizard BGS 10 Black Label', 'bgsbl10'],
  ['Pikachu BGS 10 Gem Mint', 'bgs10'],
  ['... #09 CAPTAIN PIKACHU PSA 10', 'psa10'],
  // 작은 회사는 전부 한 칸으로
  ['Pokemon Captain Pikachu PCG 10 Gem Pack Vol 1 07 09/09 Chinese 2025', '기타'],
  ['2025 Pokemon Cards CHN. Captain Pikachu 0704/09 PGS 9.5 (SAME AS PSA 9)', '기타'],
  ['2025 Pokemon Cards TCG CHN. Captain Pikachu CBB1C 07 03/09 MPG 10 CK1', '기타'],
  ['Captain Pikachu Star Holo Chinese Gem Pack Pokemon-Z gold 10', '기타'],
  ['Pokemon Charizard TAG 10 Pristine', '기타'],
  ['Pokemon Pikachu SGC 9.5', '기타'],
  // 감정 표기가 아예 없으면 미감정 — 사장님이 사진까지 보고 확인해 주신 것
  ['Captain Pikachu 0709/09 AR | Chinese Pokemon Gem Pack Volume 1 | NM', ''],
  ['Captain Pikachu Pokémon S-Chinese CBB1C 0709/09 Gem Pack Chinese Exclusive', ''],
] as [string, string][]) 재기(`"${제목등급칸(t) || '(미감정)'}" ← ${t.slice(0, 52)}`, 제목등급칸(t) === want)

console.log('\n■ 감정사 이름이 제목에 있나(미감정 가르기의 잣대)')
for (const [t, want] of [
  ['Captain Pikachu 0709/09 AR | Chinese Pokemon Gem Pack Volume 1 | NM', false],
  ['2024 Pokemon CSG Simplified Chinese #003 Vaporeon', true],
  ['Pokemon Captain Pikachu PCG 10', true],
] as [string, boolean][]) 재기(`감정사 ${제목에감정사있나(t) ? '있음' : '없음'} ← ${t.slice(0, 52)}`, 제목에감정사있나(t) === want)

console.log(실패 ? `\n⚠️ ${실패}개 틀림` : '\n전부 통과')
process.exit(실패 ? 1 : 0)
