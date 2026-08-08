/**
 * 번호 별칭표(src/data/setCardNumberAlias.json)가 **정말 같은 카드를 가리키는지** 본다.
 *
 * 이 표는 우리 번호 ↔ 저쪽 번호(또는 저쪽 이름)를 잇는다. 세트에 따라 번호 체계가
 * 아예 다르거나(셀레브레이션즈 CC001 ↔ 4/102), 저쪽에 번호가 없기 때문이다(옛 일본판).
 * 한 줄이라도 틀리면 그 카드에 **딴 카드 시세**가 붙는다 — 화면만 봐서는 못 찾는다.
 *
 * 재는 법: 같은 줄이 가리키는 두 카드의 **포켓몬이 같은가**. 이름 표기는 두 변환기가
 * 달라서 못 쓴다. 굿즈·트레이너는 포켓몬이 없어 이 잣대로 못 재므로 따로 센다.
 *
 * 실행: node --experimental-strip-types scripts/check-number-alias.mts <cards.csv>
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import pptSetNames from '../src/data/pptSetNames.json' with { type: 'json' }
import setCardNumberAlias from '../src/data/setCardNumberAlias.json' with { type: 'json' }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = process.argv[2] ?? '/data/export-cards.csv'
const KO = (pokemonNames as { ko: string }[]).map((p) => p.ko).filter((k) => k.length >= 2).sort((a, b) => b.length - a.length)
const 포켓 = (s: string) => KO.find((k) => s.includes(k)) ?? ''
const 번호맞추기 = (n: string) => n.replace(/^0+/, '') || '0'

function 칸쪼개기(줄: string): string[] {
  const 칸: string[] = []
  let 지금 = ''
  let 따옴표 = false
  for (let i = 0; i < 줄.length; i++) {
    const c = 줄[i]
    if (c === '"') { if (따옴표 && 줄[i + 1] === '"') { 지금 += c; i++ } else 따옴표 = !따옴표 }
    else if (c === ',' && !따옴표) { 칸.push(지금); 지금 = '' } else 지금 += c
  }
  칸.push(지금)
  return 칸
}

const 줄들 = readFileSync(CSV, 'utf-8').split('\n')
const 머리 = 칸쪼개기(줄들[0])
const I = { set: 머리.indexOf('setName'), num: 머리.indexOf('cardNumber'), name: 머리.indexOf('name') }
const 저쪽번호: Record<string, Record<string, string>> = {}
const 저쪽이름: Record<string, Set<string>> = {}
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const f = 칸쪼개기(줄들[i])
  const set = f[I.set]
  if (!set) continue
  const nm = String(f[I.name] ?? '').replace(/\s*-\s*[A-Za-z0-9/-]+\s*$/, '').trim()
  const n = String(f[I.num] ?? '').split('/')[0].trim()
  // ⚠️ **분모까지 열쇠로 쓴다.** 셀레브레이션즈 클래식 컬렉션은 저쪽이 원본 카드 번호를
  //    쓰는데(CC003=15/102 · CC007=15/132 · CC016=15/106), 앞자리만 보면 셋이 한 칸에
  //    겹쳐 엉뚱한 카드로 보인다. 실제 코드(번호되돌리기)도 전체 번호로 맞춘다.
  const 전체 = String(f[I.num] ?? '').trim()
  if (전체) (저쪽번호[set] ??= {})[전체.toUpperCase()] ??= nm
  if (n) (저쪽번호[set] ??= {})[번호맞추기(n)] ??= nm
  if (nm) (저쪽이름[set] ??= new Set()).add(nm.toLowerCase())
}

const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
let 봄 = 0, 맞음 = 0, 못잼 = 0, 없음 = 0
const 나쁨: string[] = []
for (const [slug, 표] of Object.entries(setCardNumberAlias as Record<string, Record<string, string>>)) {
  const f = join(dir, `${slug}.json`)
  const pptName = (pptSetNames as Record<string, string>)[slug]
  if (!existsSync(f) || !pptName) continue
  const cards: { n?: string; name?: string }[] = JSON.parse(readFileSync(f, 'utf8')).cards ?? []
  const 우리 = new Map(cards.map((c) => [String(c.n), String(c.name ?? '')]))
  for (const [내번호, 저쪽] of Object.entries(표)) {
    const 우리이름 = 우리.get(내번호)
    if (!우리이름) { 없음++; 나쁨.push(`  ${slug} ${내번호} — 우리 세트에 그 번호가 없다`); continue }
    let 저쪽이름값: string | undefined
    if (저쪽.startsWith('NAME:')) {
      // 저쪽 이름에 번호가 꼬리로 붙어 오므로 표에도 붙어 있다("Espeon ex - 175"). 뗀다.
      const 찾을 = 저쪽.slice(5).trim().replace(/\s*-\s*[A-Za-z0-9/-]+\s*$/, '').trim()
      저쪽이름값 = 저쪽이름[pptName]?.has(찾을.toLowerCase()) ? 찾을 : undefined
      if (!저쪽이름값) { 없음++; 나쁨.push(`  ${slug} ${내번호} — 저쪽에 "${찾을}"가 없다`); continue }
    } else {
      // 전체 번호로 먼저 찾고, 없으면 앞자리로 찾는다(저쪽이 0을 채워 줄 때가 있다).
      저쪽이름값 =
        저쪽번호[pptName]?.[저쪽.toUpperCase()] ?? 저쪽번호[pptName]?.[번호맞추기(저쪽.split('/')[0])]
      if (!저쪽이름값) { 없음++; 나쁨.push(`  ${slug} ${내번호} → ${저쪽} — 저쪽에 그 번호가 없다`); continue }
    }
    봄++
    const p1 = 포켓(koreanizeEnglishCardName(koreanizeTitle(우리이름)))
    const p2 = 포켓(koreanizeEnglishCardName(저쪽이름값))
    if (!p1 || !p2) { 못잼++; continue }
    if (p1 === p2) 맞음++
    else 나쁨.push(`  ${slug} ${내번호} → ${저쪽}   우리 "${우리이름}"(${p1})  ↔  저쪽 "${저쪽이름값}"(${p2})`)
  }
}
console.log(`별칭 ${봄 + 없음}줄 · 포켓몬으로 잰 것 ${봄 - 못잼}줄 · 맞음 ${맞음} · 못 잼(굿즈) ${못잼} · 짝이 없음 ${없음}`)
console.log(`어긋난 줄: ${나쁨.length}개\n`)
for (const b of 나쁨.slice(0, 30)) console.log(b)
