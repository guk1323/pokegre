// TCGdex에 카드 이미지가 없는 북미판 세트를 pokemontcg.io(정식 API, 키 보유)로 채운다.
// 세트 이름으로 맞는 세트를 찾고(카드 수·발매연도로 확인), 카드 번호로 매칭한다.
// TG01 같은 문자 번호도 있어서 번호는 문자열 그대로(대문자) 비교하고 숫자 비교로 보완한다.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve(process.cwd(), 'public/sets')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ⚠️ pokemontcg.io는 멀쩡한 요청에도 500·502를 자주 낸다(2026-08-03 실측: 같은 주소를
//    연달아 불러도 절반쯤 실패). 한 번 실패했다고 포기하면 "세트 0개 로드"가 되어
//    아무것도 못 채우면서 "대응 세트 못 찾음"이라고 잘못 보고한다. 몇 번 다시 해 본다.
async function api(pathq, key, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`https://api.pokemontcg.io/v2${pathq}`, { headers: { 'X-Api-Key': key } })
      if (r.ok) return await r.json()
      // 4xx는 다시 해도 같다(잘못된 질의). 5xx만 재시도한다.
      if (r.status < 500) return null
    } catch {
      /* 그물 문제 — 재시도 */
    }
    await sleep(1200 + i * 1200)
  }
  return null
}

// "001"→"1", "H01"→"H1", "TG01"→"TG1" — 글자 접두어 뒤 앞자리 0을 뗀다
const normNum = (s) => String(s).toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1')

async function main() {
  const env = await readFile(path.resolve(process.cwd(), '.env'), 'utf8')
  const key = (env.match(/POKEMONTCG_API_KEY=(.+)/) || [])[1]?.trim() ?? ''
  const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'))
  let setsFilled = 0
  let cardsFilled = 0
  const report = []

  for (const s of index.filter((x) => x.ed === 'en')) {
    const file = path.join(OUT, `${s.slug}.json`)
    const d = JSON.parse(await readFile(file, 'utf8'))
    const missing = d.cards.filter((c) => !c.img).length
    if (!missing) continue

    // 전체 세트 목록에서 로컬로 매칭한다. 이름 검색은 아포스트로피("McDonald's")나
    // 대소문자("BREAKthrough")에 잘 깨져서, 이름을 정규화해 직접 비교하는 게 안전하다.
    if (!main.allSets) {
      const all = await api('/sets?pageSize=250', key)
      await sleep(400)
      main.allSets = all?.data ?? []
      console.log(`pokemontcg.io 세트 ${main.allSets.length}개 로드`)
    }
    const nrm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
    const year = (s.releaseDate || '').slice(0, 4)
    const byName = main.allSets.filter((x) => nrm(x.name) === nrm(s.name))
    const pick =
      byName.find((x) => (x.releaseDate || '').slice(0, 4).replace(/\//g, '-') === year) ||
      byName.sort((a, b) => Math.abs((a.total ?? 0) - d.cards.length) - Math.abs((b.total ?? 0) - d.cards.length))[0] ||
      null
    if (!pick) {
      report.push(`${s.id}(${s.name}): 대응 세트 못 찾음`)
      continue
    }

    // 카드 검색 API(/cards)가 500을 자주 뱉어서 못 믿는다. 대신 이미지 CDN 주소가
    // 규칙적이라(images.pokemontcg.io/<세트id>/<번호>.png) 직접 조립하고,
    // 카드마다 실제로 있는지(HEAD 200) 확인한 것만 채운다.
    const missCards = d.cards.filter((c) => !c.img)
    let filled = 0
    const headOk = async (u) => {
      try {
        const r = await fetch(u, { method: 'HEAD' })
        return r.status === 200
      } catch {
        return false
      }
    }
    let i = 0
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (i < missCards.length) {
          const c = missCards[i++]
          const url = `https://images.pokemontcg.io/${pick.id}/${normNum(c.n)}.png`
          if (await headOk(url)) {
            c.img = url
            filled++
          }
        }
      }),
    )
    if (filled) {
      await writeFile(file, JSON.stringify(d))
      // 세트 목록 표지가 비어 있으면 첫 카드로 채운다
      if (!s.cover && !s.logo && !s.boxImg) {
        const first = d.cards.find((c) => c.img)
        if (first) s.cover = first.img
      }
      setsFilled++
      cardsFilled += filled
      console.log(`${s.id}: ${filled}/${missing} 채움 (${pick.id})`)
    } else {
      report.push(`${s.id}: 번호 매칭 실패 (${pick.id})`)
    }
  }

  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index))
  console.log(`\n완료 — 세트 ${setsFilled}개, 카드 ${cardsFilled}장 채움`)
  if (report.length) console.log('못 채움:\n  ' + report.join('\n  '))
}

main()
