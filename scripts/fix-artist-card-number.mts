// 작가 데이터에서 **번호가 틀린 카드**를 바로잡는다.
//
// 왜: Black Bolt 60번에 "Escavalier"와 "Antique Cover Fossil"이 함께 들어 있었다.
// 뒤엣것은 사진이 80번짜리(zsv10pt5/80.png)이고, 우리 세트 데이터도 80번이라 한다.
// 원본(pokemontcg.io)만 60번이라 하는데 사진과 어긋나므로 원본이 틀렸다
// (2026-08-07 확인). 번호가 틀리면 눌렀을 때 남의 카드로 좁혀 엉뚱한 시세가 나온다.
//
// ⚠️ 사진 파일명의 번호와 카드 번호가 어긋난 것만 고친다. 전수로 훑어 이 한 장뿐이었다.
//
// 쓰는 법: npx tsx scripts/fix-artist-card-number.mts [--write]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')
const 번호열쇠 = (n: string) => String(n).replace(/^0+(?=[0-9])/, '').toLowerCase()

const sidx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as any[]
const 세트카드 = new Map<string, Map<string, string>>()
for (const s of sidx) {
  let d: any
  try {
    d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', `${s.slug}.json`), 'utf-8'))
  } catch {
    continue
  }
  세트카드.set(s.slug, new Map((d.cards ?? []).map((c: any) => [번호열쇠(c.n), String(c.name)])))
}

let 고침 = 0
for (const f of readdirSync(path.join(ROOT, 'public/artists'))) {
  if (!f.endsWith('.json') || f === 'index.json' || f === 'by-card.json') continue
  const p = path.join(ROOT, 'public/artists', f)
  const d = JSON.parse(readFileSync(p, 'utf-8')) as any
  let 바뀜 = false
  for (const c of d.cards ?? []) {
    const 사진번호 = String(c.img ?? '').match(/\/([0-9]+[a-z]?)\.(png|jpg|jpeg|webp)$/i)?.[1]
    if (!사진번호 || 번호열쇠(사진번호) === 번호열쇠(c.number)) continue
    // 사진 번호 자리에 정말 그 카드가 있는지 세트 데이터로 확인한 뒤에만 고친다.
    const 세트쪽 = c.s ? 세트카드.get(c.s)?.get(번호열쇠(사진번호)) : undefined
    if (!세트쪽 || 세트쪽.replace(/\s/g, '').toLowerCase() !== String(c.name).replace(/\s/g, '').toLowerCase()) {
      console.log(`  ⚠️ ${c.set} ${c.number} "${c.name}" — 사진은 ${사진번호}번인데 세트 데이터가 맞장구치지 않아 그냥 둔다`)
      continue
    }
    console.log(`  ${f.replace('.json', '')}: "${c.name}" ${c.number}번 → ${사진번호}번 (세트 데이터도 그렇다)`)
    c.number = 사진번호
    바뀜 = true
    고침++
  }
  if (WRITE && 바뀜) writeFileSync(p, JSON.stringify(d))
}
console.log(`\n  ${고침}장${WRITE ? ' 고쳐 저장했다' : ' (미리보기 — --write 로 저장)'}\n`)
