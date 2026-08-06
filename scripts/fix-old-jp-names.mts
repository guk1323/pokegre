// 옛 일본판 세트의 **오염된 카드 이름**을 도감 번호로 바로잡는다.
//
// 왜: 원본(TCGdex)의 옛 세트는 이름 칸이 망가져 있다. 포켓몬 영어 이름이 일반 단어로
// 번역되거나(`大声で`=Loudred=노공룡), 영어 이름이 가타카나로 음차돼 있다
// (`ミロティック`=Milotic, 정식은 `ミロカロス`). 그래서 화면에 "큰 소리데", "미로티쿠"
// 같은 글자가 뜬다. 더 나쁜 것은 **다른 포켓몬 이름**이 뜨는 경우다 — `ラルト`(랄토스)가
// "꼬렛"으로, `カクネア`(선인왕)가 "딱충이"로 나온다(2026-08-07 전수 확인).
//
// 어떻게: 원본이 이름은 틀려도 **도감 번호는 정확히** 들고 있다. 번호로 정식 일본명을
// 찾아 원문을 바로잡으면, 우리 번역기가 알아서 옳은 한글을 낸다. 화면 코드를 여기저기
// 고칠 필요가 없고, 도감·작가 목록도 다시 만들면 저절로 따라온다.
//
// ⚠️ **이미 맞는 이름은 건드리지 않는다.** "오리진펄기아 VSTAR"는 도감 번호가 펄기아와
//    같아서, 번호대로 밀어붙이면 멀쩡한 이름을 "펄기아"로 망친다. 지금 이름에 그 포켓몬이
//    들어 있으면 그냥 둔다.
// ⚠️ 괄호 뒤(델타종 등)는 그대로 남긴다. `ミロティック（デルタ種）` → `ミロカロス（デルタ種）`.
// ⚠️ **수식어나 소유자가 붙은 이름은 손대지 않는다.** `フォークナーのファーフェッチ`는
//    "비상의 파오리"인데 정식명으로 밀면 그냥 "파오리"가 돼 누구 카드인지 사라진다.
//    `暗い金星`(다크 이상해꽃)도 마찬가지로 "이상해꽃"이 된다. 이름을 바로잡으려다
//    정보를 지우면 고친 게 아니다 — 그런 것은 표에 적어만 두고 그냥 둔다.
// ⚠️ 돌린 뒤에는 반드시 **전체 카드 이름을 다시 떠서 diff**한다. 48장만 바뀌어야 한다.
//
// 쓰는 법: npx tsx scripts/fix-old-jp-names.mts [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { koName } from '../src/lib/cardCatalog.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const WRITE = process.argv.includes('--write')

const dex = JSON.parse(readFileSync(path.join(ROOT, 'src/data/oldJpDex.json'), 'utf-8')) as Record<
  string,
  { d?: number; c?: string; n?: string }
>
const pn = JSON.parse(readFileSync(path.join(ROOT, 'src/data/pokemonNames.json'), 'utf-8')) as {
  id: number
  ko: string
  ja: string
}[]
const 번호정보 = new Map(pn.map((p) => [p.id, p]))
const index = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as {
  slug: string
  ed: 'ja' | 'en'
  id: string
}[]

let 검사 = 0
let 고침 = 0
const 표: string[] = []
const 못고침: string[] = []
const 손대지않음: string[] = []

for (const s of index) {
  if (s.ed !== 'ja') continue
  const p = path.join(ROOT, 'public/sets', `${s.slug}.json`)
  let d: { cards?: { n: string; name: string }[] }
  try {
    d = JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    continue
  }
  let 바뀜 = false
  for (const c of d.cards ?? []) {
    const f = dex[`${s.id}-${c.n}`]
    if (!f?.d || f.c !== 'p') continue
    const 정보 = 번호정보.get(f.d)
    if (!정보?.ja || !정보.ko) continue
    검사++
    const 지금 = koName('ja', c.name)
    if (지금.includes(정보.ko)) continue // 이미 맞다 — 건드리지 않는다
    // 수식어·소유자가 붙었으면 손대지 않는다(정보를 지우게 된다).
    const 몸통 = c.name.replace(/[（(].*$/, '')
    if (/の/.test(몸통) || /^(暗い|軽い|悪い|わるい|やさしい|光る|ひかる|ダーク|Dark)/i.test(몸통)) {
      손대지않음.push(`${s.id} ${c.n} "${c.name}" → 화면 "${지금}"   (도감 ${f.d}번 "${정보.ko}")`)
      continue
    }
    // 괄호 앞부분만 정식 일본명으로 갈고, 괄호와 그 뒤는 그대로 둔다.
    // ⚠️ `スター`로 끝나는 것은 ★(스타) 카드다 — 이름만 갈면 등급 표시가 사라진다.
    const 꼬리 = (c.name.match(/[（(].*$/)?.[0] ?? '') || (/スター$/.test(몸통) ? '★' : '')
    const 새이름 = 정보.ja + 꼬리
    const 새한글 = koName('ja', 새이름)
    if (!새한글.includes(정보.ko)) {
      // 번역기가 정식 일본명도 못 읽으면 손대지 않는다(틀린 것보다 빈칸).
      못고침.push(`${s.id} ${c.n} "${c.name}" → "${새이름}" 인데 화면은 "${새한글}"`)
      continue
    }
    표.push(`${s.id} ${String(c.n).padEnd(4)} "${c.name}" → "${새이름}"    화면: "${지금}" → "${새한글}"`)
    c.name = 새이름
    바뀜 = true
    고침++
  }
  if (WRITE && 바뀜) writeFileSync(p, JSON.stringify(d))
}

console.log(`\n  도감 번호를 아는 옛 일본판 포켓몬 카드 ${검사.toLocaleString()}장`)
console.log(`  고칠 것 ${고침}장 · 번역기가 못 읽어 둔 것 ${못고침.length}장 · 수식어가 붙어 둔 것 ${손대지않음.length}장\n`)
for (const e of 표) console.log(`      ${e}`)
if (손대지않음.length) {
  console.log(`\n  [수식어·소유자가 붙어 손대지 않은 것 — 이름은 여전히 이상하다]`)
  for (const e of 손대지않음) console.log(`      ${e}`)
}
if (못고침.length) {
  console.log(`\n  [번역기가 정식 이름도 못 읽어 그냥 둔 것]`)
  for (const e of 못고침) console.log(`      ${e}`)
}
console.log(WRITE ? '\n  저장했다. 이제 전체 카드 이름을 다시 떠서 diff할 것.\n' : '\n  (미리보기 — --write 로 저장)\n')
