// 작가 카드 중 **세트 슬러그를 끝내 못 붙인 것**만 골라, 원본에 세트 id를 물어 채운다.
//
// 왜: fill-artist-slugs.mts는 번호+이름으로 짝짓고, 여러 세트에 같은 번호·이름이 있으면
// 세트 이름으로 가린다. 그런데 두 데이터가 같은 세트를 다르게 적는다 —
// pokemontcg.io는 "Base", 우리(TCGdex)는 "Base Set". 그래서 초판 카드 27장이 통째로
// 빈칸으로 남았다(2026-08-06 점검 중 발견). 눌러도 세트로 못 좁혀 이름으로만 찾게 된다.
//
// 어떻게: 남은 카드를 원본에 다시 물어 **세트 id와 총 장수**를 받는다. 그 둘은 이름과
// 달리 흔들리지 않는다. 우리 슬러그를 두 갈래로 찾는다.
//   ① `en-<id>` 가 실제로 있으면 그것            (base1 → en-base1)
//   ② 없으면, 그 번호·이름이 든 우리 세트 중 **장수가 총 장수와 같은 것**이 유일할 때만
//      (tk1a 10장 → en-tk-ex-latia 10장)
//
// ⚠️ 어느 쪽으로 골랐든 **그 세트 파일에 정말 그 번호·이름 카드가 있는지 되짚어 확인**한
//    뒤에만 적는다. 틀린 슬러그는 남의 카드 시세를 보여 주므로, 못 고르면 빈칸이 낫다.
//
// 쓰는 법: npx tsx scripts/fill-artist-slugs-rest.mts [--write]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SETS = path.join(ROOT, 'public', 'sets')
const ARTISTS = path.join(ROOT, 'public', 'artists')
const WRITE = process.argv.includes('--write')
const KEY = process.env.POKEMONTCG_API_KEY ?? ''
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ⚠️ 멀쩡한 요청에도 500/502가 섞여 온다. 한 번 실패를 "없음"으로 읽으면 조용히 빠진다.
async function 받기(url: string, 시도 = 6): Promise<any | null> {
  for (let i = 0; i < 시도; i++) {
    try {
      const r = await fetch(url, { headers: KEY ? { 'X-Api-Key': KEY } : {} })
      if (r.ok) return await r.json()
      if (r.status < 500) return null
    } catch {
      /* 다시 본다 */
    }
    await nap(1200 * (i + 1))
  }
  return null
}

const 이름열쇠 = (s: string) =>
  s
    .toLowerCase()
    // ⚠️ "Nidoran ♂" ↔ "Nidoran♂" — 성별 기호 앞 공백이 데이터마다 갈린다.
    .replace(/\s*([♂♀])/g, '$1')
    .replace(/[-–—'’.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const 열쇠 = (num: string, name: string) => `${String(num).replace(/^0+/, '').toLowerCase()}|${이름열쇠(name)}`

type SetMeta = { slug: string; ed: 'ja' | 'en'; name: string }
const index = (JSON.parse(readFileSync(path.join(SETS, 'index.json'), 'utf-8')) as SetMeta[]).filter(
  (s) => s.ed === 'en',
)
const 세트카드 = new Map<string, Set<string>>()
const 세트장수 = new Map<string, number>()
for (const s of index) {
  try {
    const d = JSON.parse(readFileSync(path.join(SETS, `${s.slug}.json`), 'utf-8')) as {
      cards?: { n: string; name: string }[]
    }
    세트카드.set(s.slug, new Set((d.cards ?? []).map((c) => 열쇠(c.n, c.name))))
    세트장수.set(s.slug, (d.cards ?? []).length)
  } catch {
    /* 파일이 없으면 건너뛴다 */
  }
}

type Card = { name: string; number: string; set: string; img: string; s?: string }
const 파일들 = readdirSync(ARTISTS).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'by-card.json')
const 남은: { f: string; c: Card }[] = []
const 담긴 = new Map<string, { cards?: Card[] }>()
for (const f of 파일들) {
  const d = JSON.parse(readFileSync(path.join(ARTISTS, f), 'utf-8')) as { cards?: Card[] }
  담긴.set(f, d)
  for (const c of d.cards ?? []) if (!c.s) 남은.push({ f, c })
}

console.log(`\n  슬러그가 빈 카드 ${남은.length}장\n`)

// 같은 세트 이름끼리 묶어 한 번만 물어본다(48장이 6세트뿐이라 호출이 몇 번 안 든다).
const 세트별 = new Map<string, { f: string; c: Card }[]>()
for (const x of 남은) 세트별.set(x.c.set, [...(세트별.get(x.c.set) ?? []), x])

let 채움 = 0
const 못함: string[] = []
for (const [세트이름, 목록] of 세트별) {
  // 대표 한 장으로 그 세트의 id·총장수를 알아낸다.
  const 대표 = 목록[0].c
  const q = encodeURIComponent(`name:"${대표.name}" number:${대표.number}`)
  const j = await 받기(`https://api.pokemontcg.io/v2/cards?q=${q}&select=name,number,set`)
  const 맞는 = (j?.data ?? []).find((c: any) => c.set?.name === 세트이름)
  if (!맞는) {
    못함.push(`${세트이름} — 원본에서 세트를 못 찾음 (${목록.length}장)`)
    continue
  }
  const id = String(맞는.set.id)
  const 총 = Number(맞는.set.total ?? 0)

  // ① en-<id> ② 장수가 같으면서 **이 세트의 카드를 전부 가진** 유일한 세트
  // ⚠️ 대표 한 장으로만 좁히면 흔한 카드(포션·에너지서치)가 대표일 때 후보가 안 갈린다.
  //    트레이너 킷 라티오스/라티아스가 실제로 그래서 못 골랐다 — 두 킷 다 8번 포션,
  //    9번 에너지서치를 갖고 있다. 목록 전체를 겹쳐야 6번 피카츄가 한쪽만 가려낸다.
  let slug = ''
  if (세트카드.has(`en-${id}`)) slug = `en-${id}`
  else {
    const 후보 = index
      .map((s) => s.slug)
      .filter((s) => 세트장수.get(s) === 총 && 목록.every(({ c }) => 세트카드.get(s)?.has(열쇠(c.number, c.name))))
    if (후보.length === 1) slug = 후보[0]
  }
  if (!slug) {
    못함.push(`${세트이름} (id ${id} · ${총}장) — 우리 세트에 대응이 없음 (${목록.length}장)`)
    continue
  }

  // 되짚어 확인: 그 세트에 정말 그 카드들이 있는가. 하나라도 없으면 그 장은 비워 둔다.
  let 이번 = 0
  let 검증실패 = 0
  for (const { c } of 목록) {
    if (!세트카드.get(slug)?.has(열쇠(c.number, c.name))) {
      검증실패++
      continue
    }
    c.s = slug
    이번++
    채움++
  }
  console.log(
    `  ${세트이름.slice(0, 34).padEnd(36)} → ${slug.padEnd(15)} ${이번}장 채움${검증실패 ? ` · ${검증실패}장은 그 세트에 없어 비워 둠` : ''}`,
  )
  await nap(500)
}

if (WRITE && 채움) for (const [f, d] of 담긴) writeFileSync(path.join(ARTISTS, f), JSON.stringify(d))

console.log(`\n  채움 ${채움}장 · 남김 ${남은.length - 채움}장`)
for (const e of 못함) console.log(`      ${e}`)
console.log(WRITE ? '  저장함.\n' : '  (미리보기 — --write 로 저장)\n')
