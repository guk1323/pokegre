// 카드 이름으로 전체에서 찾기 위한 색인을 만든다.
//
// 왜 미리 만드나: 화면에서 "개굴닌자"를 치면 세트를 가리지 않고 다 나와야 하는데,
// 세트 파일이 284개(카드 31,603장)라 그때그때 다 열 수가 없다. 그렇다고 색인을
// 통째로 내려주면 3MB라 사용자가 받기엔 무겁다. 그래서 파일로 만들어 두고 서버가
// 읽어 검색 결과만 내려준다.
//
// 한글 이름은 여기서 미리 변환해 둔다 — 서버가 변환기를 들고 있지 않아도 되게.
//
// 사용법: npx tsx scripts/gen-card-index.mts
// 세트 데이터나 이름 사전이 바뀌면 다시 돌린다.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { koreanizeTitle } from '../src/lib/koreanizeTitle'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle'
import { koSetName } from '../src/lib/setNameKo'

const SETS_DIR = path.resolve('public/sets')
const OUT = path.resolve('public/card-index.json')

interface SetIndexEntry {
  slug: string
  ed: 'ja' | 'en'
  name: string
  releaseDate: string
}

// 한 줄이 카드 한 장. 자리를 아끼려고 객체가 아니라 배열로 둔다(3MB → 서버만 읽는다).
// [0] 세트 slug · [1] 카드번호 · [2] 한글 이름 · [3] 이미지
// [4] 공식 한글명(없으면 '') · [5] 한글판 이미지 · [6] 한글판 번호
type Row = [string, string, string, string, string, string, string]

const koName = (ed: 'ja' | 'en', name: string) =>
  ed === 'ja' ? koreanizeEnglishCardName(koreanizeTitle(name)) : koreanizeEnglishCardName(name)

async function main() {
  const index = JSON.parse(await readFile(path.join(SETS_DIR, 'index.json'), 'utf-8')) as SetIndexEntry[]
  const setOf = new Map(index.map((s) => [s.slug, s]))

  const files = (await readdir(SETS_DIR)).filter(
    (f) => f.endsWith('.json') && !['index.json', 'ko-index.json'].includes(f),
  )

  const rows: Row[] = []
  const sets: Record<string, [string, string, string]> = {} // slug → [한글 세트명, ed, 발매일]

  for (const f of files) {
    const slug = f.replace('.json', '')
    let file: { ed?: 'ja' | 'en'; cards?: { n: string; name: string; img?: string; koName?: string; koImg?: string; koNo?: string }[] }
    try {
      file = JSON.parse(await readFile(path.join(SETS_DIR, f), 'utf-8'))
    } catch {
      continue
    }
    const meta = setOf.get(slug)
    const ed = file.ed ?? meta?.ed ?? (slug.startsWith('en-') ? 'en' : 'ja')
    // 모바일 포켓은 실물이 없어 플리마켓에서 팔 수 없다 — 색인에서 뺀다.
    if (slug.includes('pocket')) continue

    const setKo = meta ? (ed === 'ja' ? koreanizeTitle(meta.name) : koSetName(meta.name)) : slug
    sets[slug] = [setKo, ed, meta?.releaseDate ?? '']

    for (const c of file.cards ?? []) {
      rows.push([slug, c.n, koName(ed, c.name), c.img ?? '', c.koName ?? '', c.koImg ?? '', c.koNo ?? ''])
    }
  }

  // 최신 세트가 먼저 나오게 미리 정렬해 둔다. 검색할 때마다 정렬하지 않아도 된다.
  rows.sort((a, b) => (sets[b[0]]?.[2] ?? '').localeCompare(sets[a[0]]?.[2] ?? ''))

  await writeFile(OUT, JSON.stringify({ sets, rows }))
  const mb = (JSON.stringify({ sets, rows }).length / 1024 / 1024).toFixed(2)
  console.log(`카드 ${rows.length.toLocaleString()}장 · 세트 ${Object.keys(sets).length}개 → ${path.relative('.', OUT)} (${mb} MB)`)
}

await main()
