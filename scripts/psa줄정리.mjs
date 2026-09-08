/**
 * 줄파일 정리 — **같은 카드가 「121」과 「XY121」 두 꼴로 겹쳐 든 것을 지운다.**
 *
 * 왜: 예전 긁기는 앞글자(SM·XY)를 떼고 저장했다. 새로 긁은 것과 합치면 같은 줄이
 * 두 번 들어가 「줄을 하나로 못 좁혔다」가 된다(2026-08-31에 XY 프로모에서 10칸이 뒤집혔다).
 *
 *   node scripts/psa줄정리.mjs            → data/psa줄/*.txt 를 모두 정리한다
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const 방 = path.resolve(import.meta.dirname, '../data/psa줄')
let 지운수 = 0, 파일수 = 0
for (const f of readdirSync(방).filter((x) => x.endsWith('.txt'))) {
  const p = path.join(방, f)
  // ⚠️ 똑같은 줄이 두 번 든 것부터 지운다(파일에 덧붙이다 보면 겹친다).
  const 원줄 = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
  const 줄 = [...new Set(원줄)]
  if (줄.length !== 원줄.length) { 지운수 += 원줄.length - 줄.length; }
  const 있음 = new Set()
  for (const l of 줄) {
    const [n, 이름] = l.split('|')
    if (/^[A-Za-z]+\d/.test(n)) 있음.add(String(Number(n.replace(/\D/g, ''))) + '|' + 이름)
  }
  const 남길 = 줄.filter((l) => {
    const [n, 이름] = l.split('|')
    if (/^[A-Za-z]/.test(n)) return true
    return !있음.has(String(Number(n.replace(/\D/g, ''))) + '|' + 이름)
  })
  if (남길.length !== 원줄.length) { 지운수 += 줄.length - 남길.length; 파일수++; writeFileSync(p, 남길.join('\n') + '\n') }
}
console.log(`줄파일 ${파일수}개에서 겹친 줄 ${지운수}개를 지웠습니다`)

// ⚠️ **번호에 0을 붙인 것과 안 붙인 것**이 같은 줄인데 둘 다 남아 있으면, 짝짓기가 줄을
//    하나로 못 좁혀 그 카드가 통째로 보류된다(2026-08-31 SV8a에서 33장이 그랬다).
//    옛 줄파일은 「2|Leafeon」, 새로 받은 것은 「002|Leafeon」이라 생긴 일이다.
let 영지움 = 0, 영파일 = 0
for (const f of readdirSync(방).filter((x) => x.endsWith('.txt'))) {
  const p = path.join(방, f)
  const 줄 = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
  const 본 = new Set(); const 남길 = []
  for (const l of 줄) {
    const [n, 이름, v] = l.split('|')
    const 열쇠 = String(n).replace(/^0+/, '').toUpperCase() + '|' + 이름 + '|' + v
    if (본.has(열쇠)) { 영지움++; continue }
    본.add(열쇠); 남길.push(l)
  }
  if (남길.length !== 줄.length) { 영파일++; writeFileSync(p, 남길.join('\n') + '\n') }
}
if (영지움) console.log(`  0을 붙인 것과 안 붙인 것이 겹친 줄 ${영지움}개도 지웠습니다(줄파일 ${영파일}개)`)

// ⚠️ **같은 번호·같은 이름인데 값이 다른 줄**은 옮겨 적다 틀린 것이다.
//    (2026-08-31에 화면이 잘린 줄을 그대로 적어 「1/19/118」이 「1/1/1」로 들어갔다.)
//    사람이 PSA에서 다시 보고 하나를 지워야 한다.
//    ⚠️ 다만 **PSA 쪽에 정말로 같은 이름 줄이 둘 있는 때도 있다**
//       (2015 월드 49 Keldeo EX Honorstoise가 그렇다 — 실제로 두 줄이다).
//       경고가 뜨면 PSA 화면을 다시 보고 「내가 잘못 적은 것」일 때만 지운다.
let 수상 = 0
for (const f of readdirSync(방).filter((x) => x.endsWith('.txt'))) {
  const 본 = new Map()
  for (const l of readFileSync(path.join(방, f), 'utf8').trim().split('\n').filter(Boolean)) {
    const [n, 이름, v] = l.split('|')
    const k = String(Number(String(n).replace(/\D/g, ''))) + '|' + 이름
    if (본.has(k) && 본.get(k) !== v) { console.log(`  ⚠ ${f}: 「${n}|${이름}」 값이 둘입니다 — ${본.get(k)} vs ${v}`); 수상++ }
    본.set(k, v)
  }
}
console.log(`값이 엇갈리는 줄 ${수상}개`)
