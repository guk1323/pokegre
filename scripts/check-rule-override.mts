/**
 * 자동 사전(cardNameKoEn)이 **손으로 정한 규칙을 덮고 있는 곳**을 찾는다.
 *
 * koreanizeEnglishTitle에는 "Dark " → "나쁜 " 같은 규칙(STRUCTURAL_EN_TO_KO)이 있는데,
 * 화면은 자동 사전을 **먼저** 보므로 사전에 다른 값이 들어 있으면 규칙이 안 먹는다.
 * 게다가 이 사전은 거꾸로도 쓰여서 **잘못 들어간 값이 스스로를 되살린다** —
 * 다음 생성 때 그 값이 다시 재료가 되기 때문이다.
 *
 * 2026-08-08에 이 문제로 "Dark ___"이 세 갈래로 갈려 있었다(나쁜 15 · 어둠의 7 · 다크 3).
 * 같은 카드가 일본판 탭에서는 "다크팬텀", 북미판 탭에서는 "나쁜 팬텀"으로 보였다.
 *
 * 재는 법: 영문에 규칙의 앞말이 들어 있는데 한글에 그 짝이 없으면 알린다.
 *
 * ⚠️ **줄이 보인다고 다 문제는 아니다.** 사전은 검색(한글 → 영문)에도 쓰이므로, 옛
 *    이름이 남아 있는 것 자체는 좋다("츠메의 화석"을 쳐도 찾아진다). 문제가 되는 건
 *    **화면 표시(영문 → 한글)까지 그 값이 이기는 것**뿐이다. 2026-08-08부터는
 *    koreanizeEnglishTitle의 `음역이굳은규칙`에 든 것들은 화면에서 규칙이 이긴다
 *    (화석·큐브·로켓단·독수·오리진폼). 여기 남는 줄은 검색용으로 남겨 둔 것이다.
 *
 * 실행: node --experimental-strip-types scripts/check-rule-override.mts
 */
import { STRUCTURAL_EN_TO_KO } from '../src/lib/koreanizeEnglishTitle.ts'
import cardNameKoEn from '../src/data/cardNameKoEn.json' with { type: 'json' }

const 사전 = cardNameKoEn as Record<string, string>
// ⚠️ **낱말 경계를 지켜야 한다.** 처음엔 공백·따옴표를 다 떼고 부분일치로 봤더니
//    "N's"가 "Stunfisk"(…ns…) 안에서 걸려 89개가 가짜로 잡혔다. "Dark"는 "Darkrai"에,
//    "Cool"은 "Tentacool"에 걸렸다. 앞뒤가 영문자면 다른 낱말의 일부다.
const 정규식막기 = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const 낱말로 = (x: string) =>
  new RegExp(
    (/^[A-Za-z]/.test(x) ? '(?<![A-Za-z])' : '') +
      정규식막기(x.trim()).replace(/['’]/g, "['’]") +
      (/[A-Za-z]$/.test(x.trim()) ? '(?![A-Za-z])' : ''),
    'i',
  )
const 벗기기 = (s: string) => s.replace(/[\s·’']/g, '').toLowerCase()

let 봄 = 0
const 나쁨 = new Map<string, string[]>()
for (const [en, ko] of STRUCTURAL_EN_TO_KO) {
  // 꼬리말 규칙(" Friends" 등)은 이름 뒤에 붙어 앞말 검사로는 못 잰다 — 앞말만 본다.
  if (!en.trim() || en.startsWith(' ')) continue
  봄++
  for (const [사전한글, 사전영문] of Object.entries(사전)) {
    if (!낱말로(en).test(사전영문)) continue
    if (벗기기(사전한글).includes(벗기기(ko))) continue
    const 열쇠 = `${en.trim()} → ${ko.trim()}`
    나쁨.set(열쇠, [...(나쁨.get(열쇠) ?? []), `${사전한글} → ${사전영문}`])
  }
}
const 합 = [...나쁨.values()].reduce((a, b) => a + b.length, 0)
console.log(`앞말 규칙 ${봄}개 대조 · 규칙을 덮는 사전 항목 ${합}개 (규칙 ${나쁨.size}종)\n`)
for (const [규칙, xs] of [...나쁨].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  [${규칙}] ${xs.length}개`)
  for (const x of xs.slice(0, 6)) console.log(`      ${x}`)
}
