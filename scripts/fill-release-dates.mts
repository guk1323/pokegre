/**
 * 세트 **발매일**을 채운다. (크레딧 0 — PPT를 안 쓴다)
 *
 * 왜 — PPT 덤프에는 발매일 칸이 아예 없다. 그래서 도감을 PPT로 갈아엎은 뒤 세트 682개 중
 * 312개가 발매일 없이 남았고(카드 17,478장), 세트 목록의 **출시순 정렬이 그 세트들에는
 * 안 먹는다**(2026-08-09).
 *
 * 어디서 가져오나
 *   일본판  TCGdex `https://api.tcgdex.net/v2/ja/sets/<id>` — 우리 옛 주소가
 *           `ja-<TCGdex 아이디>` 꼴이라 그대로 짝지어진다(도감이 원래 거기서 왔다).
 *   영문판  pokemontcg.io `/v2/sets` — 한 번에 다 주고 이름으로 짝짓는다.
 *
 * ⚠️ 이미 발매일이 있는 세트는 건드리지 않는다.
 * ⚠️ **짐작으로 넣지 않는다.** 못 찾으면 비워 둔다 — 가짜 날짜가 들어가면
 *    출시순이 조용히 어긋난다(en-miscp의 `1996-01-01`이 그랬다).
 *
 * 실행: npx tsx scripts/fill-release-dates.mts [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')
const dir = join(ROOT, 'public/sets')
const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Record<string, unknown>[]
const 없는것 = idx.filter((s) => !s.releaseDate)
console.log(`발매일 없는 세트 ${없는것.length}개부터 시작합니다`)

const 자기 = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const 잠깐 = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── ① 영문판: pokemontcg.io ──────────────────────────────────────────────────
const 영문날짜 = new Map<string, string>()
try {
  const key = (readFileSync(join(ROOT, '.env'), 'utf8').match(/POKEMONTCG_API_KEY=(.+)/)?.[1] ?? '').trim()
  const r = await fetch('https://api.pokemontcg.io/v2/sets?pageSize=250', { headers: key ? { 'X-Api-Key': key } : {} })
  const j = (await r.json()) as { data?: { name?: string; releaseDate?: string }[] }
  for (const s of j.data ?? []) if (s.name && s.releaseDate) 영문날짜.set(자기(s.name), s.releaseDate.replace(/\//g, '-'))
  console.log(`   pokemontcg.io 세트 ${영문날짜.size}개의 발매일을 받았습니다`)
} catch (e) {
  console.log(`   ⚠️ pokemontcg.io를 못 받았습니다 — 영문판은 건너뜁니다 (${e})`)
}

// ── ② 일본판: TCGdex ────────────────────────────────────────────────────────
// 우리 주소 `ja-XXX` → TCGdex 아이디 `XXX`. 낱개로 물어야 발매일을 준다(목록엔 없다).
const 일본후보 = 없는것.filter((s) => String(s.slug).startsWith('ja-')).map((s) => String(s.slug).slice(3))
const 일본날짜 = new Map<string, string>()
let 물어본 = 0
for (let i = 0; i < 일본후보.length; i += 4) {
  await Promise.all(
    일본후보.slice(i, i + 4).map(async (id) => {
      물어본++
      try {
        const r = await fetch(`https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(id)}`)
        if (!r.ok) return
        const j = (await r.json()) as { releaseDate?: string }
        if (j.releaseDate) 일본날짜.set(id, j.releaseDate)
      } catch {
        /* 못 받으면 그냥 넘어간다 — 비워 두는 게 가짜 날짜보다 낫다 */
      }
    }),
  )
  await 잠깐(120)
  if (물어본 % 40 === 0) console.log(`   TCGdex ${물어본}/${일본후보.length}개 물어봤습니다 (찾은 것 ${일본날짜.size})`)
}
console.log(`   TCGdex에서 일본판 ${일본날짜.size}개의 발매일을 찾았습니다`)

// ── ③ 채우기 ────────────────────────────────────────────────────────────────
let 채움 = 0
const 예: string[] = []
for (const s of 없는것) {
  const slug = String(s.slug)
  const d = slug.startsWith('ja-') ? 일본날짜.get(slug.slice(3)) : 영문날짜.get(자기(String(s.name ?? '')))
  if (!d) continue
  // ⚠️ 있을 수 없는 날짜는 안 받는다. 포켓몬 카드는 1996년 10월부터다.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '1996-10-01') continue
  s.releaseDate = d
  채움++
  if (예.length < 10) 예.push(`   ${d}  ${String(s.count).padStart(4)}장  ${String(s.name).slice(0, 40)}`)
}
console.log(`\n발매일을 채운 세트 **${채움}개**`)
for (const x of 예) console.log(x)
const 남 = idx.filter((s) => !s.releaseDate)
console.log(`   아직 없는 세트 ${남.length}개 (카드 ${남.reduce((a, s) => a + Number(s.count ?? 0), 0).toLocaleString()}장)`)
if (WRITE) {
  writeFileSync(join(dir, 'index.json'), JSON.stringify(idx) + '\n')
  console.log('\npublic/sets/index.json 을 갱신했습니다.')
} else console.log('\n(미리보기입니다. 실제로 넣으려면 --write)')
