/**
 * PPT 덤프(export-cards.csv)에서 **일본판 카드의 영문 이름**을 뽑아
 * scripts/en-card-names-dump.json에 적는다. gen-ko-en-cards.mts의 재료다.
 *
 * 왜 필요한가 — 재료를 지금까지는 fetch-en-card-names.mjs로 세트마다 받아 왔는데,
 * PPT 하루 한도 때문에 **36세트**밖에 못 모았다. 덤프에는 같은 것이 **157세트
 * 18,950장** 들어 있고 크레딧은 이미 쓴 것이라 공짜다(2026-08-08 실측).
 *
 * 이게 왜 중요한가 — 사전에 없는 이름은 검색이 안 된다. 화면에 보이는 한글 이름
 * 5,648가지 중 **705가지(12.5%)가 저쪽에 보낼 영어로 안 바뀌었다.** 방문자는 우리
 * 화면에 있는 이름을 그대로 치는데 0장이 나온다. 재료가 얇은 게 가장 큰 원인이었다.
 *
 * 실행: node --experimental-strip-types scripts/gen-en-card-names-from-dump.mts <cards.csv>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = process.argv[2] ?? '/data/export-cards.csv'
const OUT = join(ROOT, 'scripts/en-card-names-dump.json')

function 칸쪼개기(줄: string): string[] {
  const 칸: string[] = []
  let 지금 = ''
  let 따옴표 = false
  for (let i = 0; i < 줄.length; i++) {
    const c = 줄[i]
    if (c === '"') {
      if (따옴표 && 줄[i + 1] === '"') { 지금 += c; i++ } else 따옴표 = !따옴표
    } else if (c === ',' && !따옴표) { 칸.push(지금); 지금 = '' } else 지금 += c
  }
  칸.push(지금)
  return 칸
}

const 이름to슬러그 = new Map(
  Object.entries(pptSetNames as Record<string, string>).map(([slug, 이름]) => [이름, slug]),
)

const 줄들 = readFileSync(CSV, 'utf-8').split('\n')
const 머리 = 칸쪼개기(줄들[0])
const I = {
  set: 머리.indexOf('setName'),
  num: 머리.indexOf('cardNumber'),
  name: 머리.indexOf('name'),
  lang: 머리.indexOf('language'),
}
for (const [k, v] of Object.entries(I)) if (v < 0) throw new Error(`덤프에 "${k}" 칸이 없다`)

const 모음: Record<string, Record<string, string>> = {}
let 담음 = 0
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const f = 칸쪼개기(줄들[i])
  // ⚠️ **일본판 줄만** 쓴다. 북미판 줄을 섞으면 같은 번호에 딴 세트 카드가 들어간다.
  if (f[I.lang] !== 'japanese') continue
  const slug = 이름to슬러그.get(f[I.set])
  if (!slug || !slug.startsWith('ja-')) continue
  const 번호 = String(f[I.num] ?? '').split('/')[0].trim()
  if (!번호) continue
  // 저쪽은 이름 뒤에 번호를 붙여 주기도 한다("Power Tablet - 092/100"). 떼어 낸다.
  const 이름 = String(f[I.name] ?? '').replace(/\s*-\s*[A-Za-z0-9/-]+\s*$/, '').trim()
  if (!이름) continue
  const code = slug.replace(/^ja-/, '')
  ;(모음[code] ??= {})
  // 같은 번호가 여러 줄로 온다(변형 인쇄). 먼저 온 것을 쓴다 — 어느 쪽이든 이름은 같다.
  if (!모음[code][번호]) { 모음[code][번호] = 이름; 담음++ }
}

writeFileSync(OUT, JSON.stringify(모음, null, 0) + '\n')
console.log(`세트 ${Object.keys(모음).length}개 · 카드 ${담음.toLocaleString()}장 → scripts/en-card-names-dump.json`)
