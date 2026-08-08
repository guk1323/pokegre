/**
 * 자동 사전(cardNameKoEn)과 손으로 적은 표(koreanizeEnglishTitle)가 **같은 영문 카드에
 * 다른 한글 이름**을 갖고 있는 곳을 찾는다.
 *
 * 왜 중요한가 — 화면이 영문 카드를 한글로 보여줄 때 `lookupExact`는 **자동 사전을 제일
 * 먼저** 본다. 그래서 어긋나면 **자동 쪽이 이기고 손으로 적어 둔 값은 안 쓰인다.**
 * 자동 쪽은 일본어 이름을 옮긴 것이라, 일본판 탭과 북미판 탭이 같은 이름을 보여주려면
 * 이 순서가 맞다. 대신 자동 쪽이 틀리면 **양쪽이 같이 틀린다** — 그래서 세어 둔다.
 *
 * 2026-08-08에 이 검사로 두 가지를 잡았다:
 *   · "Team Rocket's Archer"가 "Team 로켓단의 Archer"로 나갔다(반쪽 번역이 정답을 덮었다)
 *   · 레쿠쟈·테라파고스 등 17장이 변형판 이름에 묶여 검색이 0~1장만 나왔다
 *
 * 남은 어긋남은 어느 쪽이 공식 표기인지 **사람이 확인해야** 정할 수 있다.
 * 그래서 카드 장수가 많은(=화면에 자주 보이는) 순서로 보여준다.
 *
 * 실행: node --experimental-strip-types scripts/check-name-conflicts.mts [cards.csv 경로]
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const koen: Record<string, string> = JSON.parse(readFileSync(join(ROOT, 'src/data/cardNameKoEn.json'), 'utf8'))
const src = readFileSync(join(ROOT, 'src/lib/koreanizeEnglishTitle.ts'), 'utf8')

// 손으로 적은 표를 소스에서 읽어 낸다. import하면 브라우저용 모듈이 딸려 와 무겁다.
const 표이름 = ['TRAINER_EN_TO_KO', 'ITEM_EN_TO_KO', 'USER_CONFIRMED_EN_TO_KO', 'UNVERIFIED_EN_TO_KO', 'ENGLISH_CARD_EN_TO_KO']
const 손표: Record<string, Record<string, string>> = {}
for (const 이름 of 표이름) {
  const i = src.indexOf(`const ${이름}: Record<string, string> = {`)
  if (i < 0) continue
  const 몸통 = src.slice(i, src.indexOf('\n}', i))
  const t: Record<string, string> = {}
  for (const m of 몸통.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*'((?:[^'\\]|\\.)*)'/gm)) {
    t[(m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'")] = m[4].replace(/\\'/g, "'")
  }
  손표[이름] = t
}

// ⚠️ 진짜 코드(AUTO_EN_TO_KO)와 **똑같이** 만든다 — 한 영문에 한글이 여럿이면 애매해서
//    아예 안 넣는다. 그걸 안 맞추면 없는 문제를 보고하게 된다(처음에 그랬다).
const 셈 = new Map<string, number>()
for (const en of Object.values(koen)) 셈.set(en, (셈.get(en) ?? 0) + 1)
const auto = new Map<string, string>()
for (const [ko, en] of Object.entries(koen)) if (셈.get(en) === 1) auto.set(en, ko)

const 어긋: { en: string; autoKo: string; 손: string; 표: string }[] = []
for (const [en, autoKo] of auto) {
  for (const 이름 of 표이름) {
    const 손 = 손표[이름]?.[en]
    if (손 && 손 !== autoKo) {
      어긋.push({ en, autoKo, 손, 표: 이름 })
      break
    }
  }
}

const 띄기 = (s: string) => s.replace(/\s+/g, '')
const 띄어쓰기만 = 어긋.filter((x) => 띄기(x.autoKo) === 띄기(x.손))
const 진짜 = 어긋.filter((x) => 띄기(x.autoKo) !== 띄기(x.손))

// 카드 장수로 순서를 매긴다(덤프가 있을 때만).
const CSV = process.argv[2]
const 셈장수 = new Map<string, number>()
if (CSV && existsSync(CSV)) {
  const 쪼개기 = (line: string) => {
    const r: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (q && line[i + 1] === '"') { cur += c; i++ } else q = !q
      } else if (c === ',' && !q) { r.push(cur); cur = '' } else cur += c
    }
    r.push(cur)
    return r
  }
  const 줄 = readFileSync(CSV, 'utf8').split('\n')
  const iN = 줄[0].split(',').indexOf('name')
  for (let i = 1; i < 줄.length; i++) {
    if (!줄[i].trim()) continue
    const n = 쪼개기(줄[i])[iN]?.trim()
    if (n) 셈장수.set(n, (셈장수.get(n) ?? 0) + 1)
  }
}

console.log(`자동 사전 ${auto.size}개 · 어긋남 ${어긋.length}개 (어긋나면 자동이 이긴다)`)
console.log(`  띄어쓰기만 다름 ${띄어쓰기만.length}개 · 낱말이 다름 ${진짜.length}개\n`)
for (const x of 진짜
  .map((x) => ({ ...x, 장수: 셈장수.get(x.en) ?? 0 }))
  .sort((a, b) => b.장수 - a.장수 || a.en.localeCompare(b.en))) {
  console.log(`  ${String(x.장수).padStart(3)}장  ${x.en.padEnd(32)} 화면 "${x.autoKo}"   ↔   ${x.표.replace('_EN_TO_KO', '')} "${x.손}"`)
}
