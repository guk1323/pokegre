// 그림이 통째로 없는 세트를 pokemontcg.io에서 찾아본다.
//
// 왜: "어느 소스에도 없어서 못 채운다"고 적어 뒀는데, 운영자가 "찾으면 있잖아"라고
// 지적했고 실제로 McDonald's Collection 2018은 pokemontcg.io에 그림이 있었다
// (2026-08-06). 어디까지 채울 수 있는지 먼저 세어 본다.
//
// ⚠️ 매칭은 **번호와 이름이 둘 다 맞을 때만**. 엉뚱한 그림이 붙는 것보다 빈칸이 낫다.
//
// 쓰는 법: npx tsx scripts/find-missing-set-imgs.mts [--write]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SETS = path.join(ROOT, 'public', 'sets')
const WRITE = process.argv.includes('--write')
const KEY = process.env.POKEMONTCG_API_KEY ?? ''
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ⚠️ pokemontcg.io는 멀쩡한 요청에도 가끔 500을 뱉는다(CLAUDE.md에 적힌 알려진 버릇).
//    한 번 실패로 "그림이 없다"고 결론 내리면 안 된다 — 몇 번 다시 물어본다.
async function 받기(url: string, 시도 = 4): Promise<any> {
  for (let i = 0; i < 시도; i++) {
    try {
      const r = await fetch(url, { headers: KEY ? { 'X-Api-Key': KEY, 'User-Agent': 'pokegre' } : { 'User-Agent': 'pokegre' } })
      if (r.ok) return await r.json()
      if (r.status < 500) return null
    } catch {
      /* 통신 실패도 재시도 */
    }
    await nap(800 * (i + 1))
  }
  return null
}

type SetMeta = { slug: string; ed: 'ja' | 'en'; id: string; name: string }
const index = JSON.parse(readFileSync(path.join(SETS, 'index.json'), 'utf-8')) as SetMeta[]
const meta = new Map(index.map((s) => [s.slug, s]))

/** 그림이 한 장도 없는 세트를 모은다. */
const 빈세트: { slug: string; name: string; cards: { n: string; name: string; img?: string }[]; file: string }[] = []
for (const f of readdirSync(SETS)) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const m = meta.get(f.replace('.json', ''))
  if (!m) continue
  const d = JSON.parse(readFileSync(path.join(SETS, f), 'utf-8')) as { cards?: { n: string; name: string; img?: string }[] }
  const cs = d.cards ?? []
  if (cs.length && cs.every((c) => !(c.img ?? '').trim())) 빈세트.push({ slug: m.slug, name: m.name, cards: cs, file: f })
}

const 이름열쇠 = (s: string) =>
  s
    .toLowerCase()
    .replace(/[-–—'’.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const 번호열쇠 = (s: string) => String(s).split('/')[0].trim().toUpperCase().replace(/^0+(?=[0-9])/, '')

// 저쪽 세트 목록(이름 → id). 이름이 같은 세트를 찾는 데 쓴다.
const 저쪽세트 = new Map<string, string>()
{
  // ⚠️ sets 엔드포인트는 select를 붙이면 빈 응답이 온다. 그냥 통째로 받는다.
  const j = (await 받기('https://api.pokemontcg.io/v2/sets?pageSize=250')) as { data?: { id: string; name: string }[] } | null
  for (const s of j?.data ?? []) 저쪽세트.set(s.name, s.id)
  console.log(`  저쪽 세트 목록 ${저쪽세트.size}개 받음\n`)
}

let 채울수있음 = 0
let 총빈칸 = 0
for (const s of 빈세트) {
  총빈칸 += s.cards.length
  // ⚠️ 세트 **이름**으로 물으면 어퍼스트로피(McDonald's) 때문에 어떤 세트는 0건이
  //    돌아온다(2015·2017이 그랬다). 저쪽 세트 목록에서 id를 찾아 id로 묻는다.
  const 저쪽id = 저쪽세트.get(s.name)
  let 남 = [] as { name: string; number: string; images?: { small?: string; large?: string } }[]
  if (저쪽id) {
    const j = await 받기(
      `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`set.id:${저쪽id}`)}&pageSize=250&select=name,number,images`,
    )
    남 = j?.data ?? []
  }
  // ⚠️ URL을 받았다고 그림이 있는 게 아니다. pokemontcg.io는 맥도날드 세트처럼
  //    **API에는 데이터가 있는데 이미지 파일이 404**인 세트가 있다(실측 2026-08-06).
  //    그대로 넣으면 "그림 있음"으로 기록되고 화면엔 뒷면이 뜬다 — 빈칸만 못하다.
  //    실제로 열리는지 확인하고 넣는다.
  const 살아있나 = async (u: string) => {
    if (!u) return false
    try {
      const r = await fetch(u, { method: 'HEAD' })
      return r.ok
    } catch {
      return false
    }
  }
  const 표 = new Map<string, string>()
  for (const c of 남) {
    const u = c.images?.large || c.images?.small || ''
    if (await 살아있나(u)) 표.set(`${번호열쇠(c.number)}|${이름열쇠(c.name)}`, u)
  }
  let 맞음 = 0
  const d = JSON.parse(readFileSync(path.join(SETS, s.file), 'utf-8')) as { cards: { n: string; name: string; img?: string }[] }
  for (const c of d.cards) {
    const img = 표.get(`${번호열쇠(c.n)}|${이름열쇠(c.name)}`)
    if (img) {
      맞음++
      c.img = img
    }
  }
  채울수있음 += 맞음
  console.log(
    `  ${s.slug.padEnd(14)} ${s.name.slice(0, 32).padEnd(34)} 빈칸 ${String(s.cards.length).padStart(3)}장 · ` +
      `저쪽 ${저쪽id ? `${저쪽id}(${남.length}건)` : '없음'} · 맞음 ${맞음}`,
  )
  if (WRITE && 맞음) writeFileSync(path.join(SETS, s.file), JSON.stringify(d))
  await nap(KEY ? 400 : 7000)
}
console.log(`\n  그림 없는 세트 ${빈세트.length}개 · 빈칸 ${총빈칸}장 중 ${채울수있음}장 채울 수 있음${WRITE ? ' · 저장함' : ' (미리보기 — --write)'}`)
