// 세트 목록 썸네일을 "첫 카드"가 아니라 "팩(패키지) 로고"로 쓰기 위해,
// 각 세트에 logo URL을 붙인다.
//  - 영문판(en): TCGdex 로고. 카드 이미지 base(.../en/sv/sv08.5/001)에서 번호를 logo로 치환.
//  - 일본판(ja): TCGdex엔 로고가 없어 LimitlessTCG 팩 로고(s3.limitlesstcg.com/sets/jp/<id>.png).
// 실제로 존재하는(HEAD 200) 것만 저장한다. 없으면 화면에서 첫 카드로 대체된다.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')

async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'pokegre' } })
    return r.status
  } catch {
    return 0
  }
}

// 동시 실행 제한(서버에 부담 안 주게)
async function pool(items, size, fn) {
  const out = []
  let i = 0
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

async function candidate(entry) {
  if (entry.ed === 'ja') {
    return `https://s3.limitlesstcg.com/sets/jp/${entry.id}.png`
  }
  // en: 세트 파일에서 첫 카드 이미지 base를 읽어 logo로 치환
  try {
    const f = JSON.parse(await readFile(path.join(OUT, `${entry.slug}.json`), 'utf8'))
    const first = (f.cards || []).find((c) => c.img)?.img
    if (!first) return ''
    return first.replace(/\/[^/]+$/, '/logo') + '.png'
  } catch {
    return ''
  }
}

async function main() {
  const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))
  let hit = 0
  await pool(index, 8, async (entry) => {
    const url = await candidate(entry)
    if (url && (await head(url)) === 200) {
      entry.logo = url
      hit++
    } else {
      entry.logo = ''
    }
  })
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  const ja = index.filter((x) => x.ed === 'ja' && x.logo).length
  const en = index.filter((x) => x.ed === 'en' && x.logo).length
  console.log(`로고 붙임: ${hit}/${index.length} (ja ${ja} · en ${en})`)
}

main()
