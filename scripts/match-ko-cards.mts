// 한글판 카드(scripts/ko-cards/*.json)를 우리 카탈로그(public/sets/ja-*.json)에 붙인다.
//
// ⚠️ 번호로 그냥 이으면 안 된다. 한국판은 서포트·굿즈 블록을 한글 가나다순으로 다시
// 매기기 때문이다. 실제로 M5는 일본판 073~078과 한글판 073~078이 통째로 어긋나 있다.
// 그래서 "이름으로" 맞춘다.
//
// 짝을 못 지은 카드는 그냥 비워 둔다 — 사장님 원칙이 "틀린 것보다 빈칸"이다.
//
// 붙는 값:
//   koImg  한글판 카드 이미지 주소(포켓몬코리아, 워터마크 있음)
//   koNo   한글판 카드 번호(일본판과 다를 수 있다)
//   koName 공식 한글 카드명
//
// 사용법:
//   npx tsx scripts/match-ko-cards.mts              무엇이 어떻게 붙는지 보기만
//   npx tsx scripts/match-ko-cards.mts --write      실제로 public/sets에 쓴다

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { koreanizeTitle } from '../src/lib/koreanizeTitle'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle'

const KO_DIR = path.resolve('scripts/ko-cards')
const SETS_DIR = path.resolve('public/sets')
const WRITE = process.argv.includes('--write')

interface KoCard {
  n: string
  name: string
  img: string
}
interface OurCard {
  n: string
  name: string
  img: string
  koImg?: string
  koNo?: string
  koName?: string
  [k: string]: unknown
}

// 비교할 때만 쓰는 형태. 띄어쓰기·가운뎃점 차이로 어긋나는 걸 막는다.
const norm = (s: string) => s.replace(/[\s·・.]/g, '').toLowerCase()
const ourKoreanName = (name: string) => koreanizeEnglishCardName(koreanizeTitle(name))

async function main() {
  // _prefixes.json 같은 살림 파일은 세트가 아니다.
  const koFiles = (await readdir(KO_DIR).catch(() => [])).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  if (koFiles.length === 0) {
    console.log('scripts/ko-cards 가 비어 있습니다. 먼저 fetch-ko-cards.mjs 로 받으세요.')
    return
  }

  let totalMatched = 0
  let totalMissed = 0
  const koSlugs: string[] = []

  for (const file of koFiles) {
    const ko = JSON.parse(await readFile(path.join(KO_DIR, file), 'utf-8')) as {
      code: string
      cards: KoCard[]
    }
    // 한국은 일본판 세트를 그대로 낸다 — 세트 코드가 같다(M5·SV3 …).
    const slug = `ja-${ko.code}`
    const setPath = path.join(SETS_DIR, `${slug}.json`)
    const raw = await readFile(setPath, 'utf-8').catch(() => null)
    if (!raw) {
      console.log(`✗ ${ko.code}: 우리 카탈로그에 ${slug}.json 이 없습니다.`)
      continue
    }
    const set = JSON.parse(raw) as { cards: OurCard[] }

    // 이름이 같은 카드가 여러 장인 세트가 있다(개굴닌자 ex ×3 등).
    // 이름별로 줄을 세워 두고 앞에서부터 하나씩 짝지어 준다 — 번호 순서는 양쪽 다 유지되므로
    // 같은 이름끼리는 순서대로 대응된다.
    const koByName = new Map<string, KoCard[]>()
    for (const c of ko.cards) {
      const k = norm(c.name)
      const list = koByName.get(k)
      if (list) list.push(c)
      else koByName.set(k, [c])
    }

    const missed: string[] = []
    let matched = 0
    for (const card of set.cards) {
      const mine = norm(ourKoreanName(card.name))
      const queue = koByName.get(mine)
      const hit = queue?.shift()
      if (!hit) {
        // 한국 미발매 구간(시크릿 레어 등)이거나 우리 한글명이 공식과 다른 경우.
        missed.push(`${card.n} ${card.name} → ${ourKoreanName(card.name)}`)
        delete card.koImg
        delete card.koNo
        delete card.koName
        continue
      }
      matched++
      card.koImg = hit.img
      card.koNo = hit.n
      card.koName = hit.name
    }

    totalMatched += matched
    totalMissed += missed.length
    const renumbered = set.cards.filter((c) => c.koNo && c.koNo !== c.n).length
    console.log(
      `${matched === ko.cards.length ? '✓' : '·'} ${ko.code} — ` +
        `${matched}/${ko.cards.length}장 붙음, 번호 다른 카드 ${renumbered}장, 못 붙인 우리 카드 ${missed.length}장`,
    )
    if (missed.length && missed.length <= 20) for (const m of missed) console.log(`    · ${m}`)
    else if (missed.length) console.log(`    · (${missed.length}장 — 대부분 한국 미발매 시크릿 구간)`)

    if (matched > 0) koSlugs.push(slug)
    if (WRITE) await writeFile(setPath, JSON.stringify(set))
  }

  // 한글판 그림이 있는 세트 목록. 화면에서 "한글판" 탭에 무엇을 보여줄지 정하는 데 쓴다
  // (세트 파일 284개를 다 열어 보지 않아도 되게).
  if (WRITE) {
    await writeFile(path.join(SETS_DIR, 'ko-index.json'), JSON.stringify(koSlugs.sort()))
    console.log(`\n한글판 있는 세트 ${koSlugs.length}개 → public/sets/ko-index.json`)
  }

  console.log(`\n합계: ${totalMatched}장 붙음 / 못 붙인 우리 카드 ${totalMissed}장`)
  if (!WRITE) console.log('(보기만 했습니다. 실제로 쓰려면 --write)')
}

await main()
