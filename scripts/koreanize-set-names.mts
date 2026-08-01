// public/sets의 세트 이름을 한글로 맞춘다.
//
// 기존 세트는 index.json과 세트 파일 둘 다 이름이 이미 한글이다(M5="어비스아이").
// 새로 받아 붙인 세트는 원본 그대로 일본어라 두 가지가 섞인다. 화면은 어느 쪽이든
// 한글로 보여주지만(koSet), 파일이 섞여 있으면 다음 사람이 어느 쪽이 맞는지
// 헷갈리고 검색·색인 같은 다른 쓰임에서 갈린다. 여기서 한 가지로 맞춘다.
//
// 쓰기: npx tsx scripts/koreanize-set-names.mts          (바뀔 것만 보여줌)
//       npx tsx scripts/koreanize-set-names.mts --write  (저장)
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { koSet } from '../src/lib/cardCatalog.ts'

const OUT = path.resolve(process.cwd(), 'public/sets')
const WRITE = process.argv.includes('--write')
const hasJa = (s: string) => /[ぁ-んァ-ヶ一-鿿]/.test(s)

const index: { slug: string; ed: string; id: string; name: string }[] = JSON.parse(
  await readFile(path.join(OUT, 'index.json'), 'utf8'),
)

let changed = 0
for (const s of index) {
  if (!hasJa(s.name)) continue
  const ko = koSet(s.ed as 'ja' | 'en', s.name)
  if (ko === s.name) {
    console.log(`  그대로  ${s.slug.padEnd(12)} ${s.name}`)
    continue
  }
  console.log(`  ${s.slug.padEnd(12)} ${s.name.padEnd(30)} → ${ko}`)
  changed++
  if (WRITE) {
    s.name = ko
    const file = path.join(OUT, `${s.slug}.json`)
    const d = JSON.parse(await readFile(file, 'utf8'))
    d.name = ko
    await writeFile(file, JSON.stringify(d))
  }
}

if (WRITE) await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
console.log(`\n한글로 바꾼 세트 ${changed}개 / 전체 ${index.length}개`)
if (!WRITE) console.log('저장하려면 --write')
