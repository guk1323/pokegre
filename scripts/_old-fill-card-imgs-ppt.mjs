// 이미지가 빈 카드를 PPT에서 받아 채운다.
//
// ⚠️ 번호만 맞춰 넣으면 엉뚱한 그림이 붙는다. "틀린 것보다 빈칸"이 우리 원칙이라
// 번호와 이름이 둘 다 맞을 때만 채운다. 트레이너 킷은 PPT가 두 덱을 한 세트로 묶어
// 파는데 번호가 양쪽 다 1~30이라(9/30이 둘 있다) 이름까지 안 보면 반드시 어긋난다.
//
// ⚠️ 크레딧은 방문자와 같은 통을 쓴다. 12,000 아래로 내려가면 멈춘다.
// 한도(429)나 정지(403)를 만나면 그 자리에서 끝낸다 — 429를 쌓으면 키가 정지된다.
//
// 실행: node scripts/fill-card-imgs-ppt.mjs [--write]
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const WRITE = process.argv.includes('--write')
// 서버(server/api.ts)가 앨범 시세를 채울 때 쓰는 기준과 같은 숫자로 맞춘다.
const KEEP_FOR_VISITORS = 8000
const OUT = 'public/sets'
const key = (await readFile('.env', 'utf8')).match(/POKEMON_PRICE_TRACKER_API_KEY=(.+)/)[1].trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 우리 세트 → PPT가 부르는 이름. 이름이 그대로 맞는 세트는 여기 없어도 된다.
const ALIAS = {
  'en-svp': 'SV: Scarlet & Violet Promo Cards',
  'en-exu': 'EX Unseen Forces',
  'en-tk-xy-latia': 'XY Trainer Kit: Latias & Latios',
  'en-tk-xy-latio': 'XY Trainer Kit: Latias & Latios',
  'en-tk-xy-b': 'XY Trainer Kit: Bisharp & Wigglytuff',
  'en-tk-xy-w': 'XY Trainer Kit: Bisharp & Wigglytuff',
  'en-tk-xy-sy': 'XY Trainer Kit: Sylveon & Noivern',
  'en-tk-xy-n': 'XY Trainer Kit: Sylveon & Noivern',
  'en-tk-xy-p': 'XY Trainer Kit: Pikachu Libre & Suicune',
  'en-tk-xy-su': 'XY Trainer Kit: Pikachu Libre & Suicune',
  'en-tk-bw-e': 'BW Trainer Kit: Excadrill & Zoroark',
  'en-tk-bw-z': 'BW Trainer Kit: Excadrill & Zoroark',
  'en-tk-dp-m': 'DP Trainer Kit: Manaphy & Lucario',
  'en-tk-dp-l': 'DP Trainer Kit: Manaphy & Lucario',
}

// "001" → "1", "H32/H32" → "H32", "SVP193" → "SVP193"
const num = (s) => String(s ?? '').split('/')[0].trim().toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1')
// 이름 비교용. 괄호 안 꼬리표(#9 · Lucario · Mirror Holo)는 PPT가 붙인 것이라 뗀다.
const nm = (s) =>
  String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .replace(/\s*[-–]\s*[A-Z0-9]+$/i, '')
    .replace(/\s*\([^()]*\)/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')

let left = Infinity
let stopped = false
const setCache = new Map()

async function fetchSet(setName) {
  if (setCache.has(setName)) return setCache.get(setName)
  const rows = []
  for (let offset = 0; offset < 1000; offset += 250) {
    if (left < KEEP_FOR_VISITORS) { stopped = true; break }
    const url = `https://www.pokemonpricetracker.com/api/v2/cards?language=english&setName=${encodeURIComponent(setName)}&limit=250&offset=${offset}`
    // 429는 두 가지다. 하루치가 남아 있으면 분당 한도라 기다리면 풀린다. 250행짜리
    // 큰 요청은 연속으로 던지면 금방 걸려서(문서상 분당 60번인데 실제로는 더 빡빡하다)
    // PPT가 알려준 만큼 쉬며 몇 번 더 기다려 본다. 하루치가 바닥이면 기다려도 소용없다.
    let r = null
    for (let tries = 0; tries < 4; tries++) {
      r = await fetch(url, { headers: { accept: 'application/json', authorization: `Bearer ${key}` } })
      const n = Number(r.headers.get('x-ratelimit-daily-remaining'))
      if (Number.isFinite(n)) left = n
      if (r.status !== 429 || left < KEEP_FOR_VISITORS) break
      const wait = (Number(r.headers.get('retry-after')) || 30) + 5
      console.log(`  분당 한도 — ${wait}초 쉬고 다시(${tries + 1}/4)`)
      await sleep(wait * 1000)
    }
    if (r.status === 429 || r.status === 403) {
      console.log(`\n  한도/정지(${r.status}) — 여기서 멈춘다.`)
      stopped = true
      break
    }
    if (!r.ok) break
    const j = await r.json()
    const got = Array.isArray(j.data) ? j.data : []
    rows.push(...got)
    await sleep(6000)
    if (got.length < 250) break
  }
  setCache.set(setName, rows)
  return rows
}

const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))
let filledTotal = 0
const report = []

for (const s of index) {
  if (stopped) break
  const file = path.join(OUT, `${s.slug}.json`)
  const d = JSON.parse(await readFile(file, 'utf8'))
  const blanks = (d.cards ?? []).filter((c) => !c.img)
  if (!blanks.length) continue
  if (d.ed !== 'en') { report.push(`${s.slug}: 일본판이라 건너뜀(${blanks.length}장)`); continue }

  const setName = ALIAS[s.slug] ?? s.name
  const rows = await fetchSet(setName)
  await sleep(4000)
  if (!rows.length) { report.push(`${s.slug}: PPT에 없음 "${setName}" (${blanks.length}장)`); continue }

  // 번호+이름 → 그림. 같은 열쇠가 둘이면 어느 쪽인지 몰라 아예 안 쓴다.
  const byKey = new Map()
  const dup = new Set()
  for (const c of rows) {
    const img = c.imageCdnUrl400 || c.imageCdnUrl800 || c.imageCdnUrl200
    if (!img) continue
    const k = num(c.cardNumber) + '|' + nm(c.name)
    if (byKey.has(k) && byKey.get(k) !== img) dup.add(k)
    byKey.set(k, img)
  }

  let filled = 0
  for (const c of blanks) {
    const k = num(c.n) + '|' + nm(c.name)
    if (dup.has(k)) continue
    const img = byKey.get(k)
    if (!img) continue
    c.img = img
    filled++
  }
  if (filled && WRITE) {
    await writeFile(file, JSON.stringify(d))
    if (!s.cover && !s.logo) s.cover = (d.cards ?? []).find((c) => c.img)?.img ?? ''
  }
  filledTotal += filled
  console.log(`  ${s.slug.padEnd(16)}빈칸 ${String(blanks.length).padStart(3)} → 채움 ${String(filled).padStart(3)}   (PPT ${rows.length}행, 남은 크레딧 ${left})`)
}

if (WRITE) await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
console.log(`\n${WRITE ? '저장 완료' : '미리보기(저장 안 함)'} — 채운 카드 ${filledTotal}장 · 남은 크레딧 ${left}`)
if (report.length) console.log('\n못 채운 세트:\n  ' + report.join('\n  '))
if (!WRITE) console.log('\n실제로 저장하려면 --write')
