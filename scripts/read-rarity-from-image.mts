// 카드 그림에 **찍힌 레어도**를 읽는다. (2026-08-13)
//
// 사장님이 짚어 주신 방법이다: "카드 왼쪽 아래 rr MUR 이런걸로 판단 못해?"
// 일본 카드는 왼쪽(옛 카드는 오른쪽) 아래에 레어도가 글자로 찍혀 있다 —
// **저쪽(PPT)도 TCGdex도 모르는 카드의 유일한 출처가 그림이다.**
//
// ⚠️⚠️⚠️ **`--check`가 100%여도 `--fill`은 틀린다. 둘은 다른 일이다.**
//    2026-08-13에 실제로 겪었다:
//      · `--check`(레어도가 **있는** 카드) — 55장 읽어 **어긋남 0**. 읽는 것 자체는 잘한다.
//      · `--fill`(레어도가 **없는** 카드) — 5장 채웠는데 **2장이 틀렸다.** 표기가 아예 없는
//        미러홀로 카드에 「Double Rare」·「Uncommon」을 **지어냈다**(눈으로 확인 후 되돌림).
//    까닭: check는 「있는 글자를 맞게 읽나」를 재고, fill이 진짜로 묻는 것은
//    **「없는데 없다고 말하나」**다. 그림이 흐리거나 무지개 반사가 있으면 지어낸다.
//    → **채운 것은 반드시 눈으로 확인할 것.** 그리고 아래 「두 번 물어 맞을 때만」을 켤 것.
//
// ⚠️⚠️ **먼저 재고 쓴다.** `--check`로 답을 아는 세트에 돌려 정확도를 낸 다음에만
//    `--fill`로 빈칸을 채운다. 좋아진 것만 세면 안 된다 — **틀리게 채운 것**을 세야 한다.
//
//   npx tsx scripts/read-rarity-from-image.mts --check ja-M2 --limit 30
//   npx tsx scripts/read-rarity-from-image.mts --fill  ja-SV3a --limit 50 --write
//
// 옵션
//   --check <slug>  레어도가 **있는** 카드로 맞춰 본다(안 고친다). 정확도 재기용.
//   --fill  <slug>  레어도가 **없는** 카드를 읽어 채운다. `--write` 없으면 보기만.
//   --limit N       몇 장까지. 기본 30.
//   --img ko|tcg800|tcg400   어느 그림을 쓸지. 기본은 있는 것 중 큰 쪽(ko→tcg800).
//   --write         실제로 파일에 적는다.
//   --once          한 번만 묻는다(기본은 **두 번 물어 같을 때만** 쓴다).
//   --model <이름>  기본 claude-sonnet-5. 바꾸려면 --check 로 정확도부터 잴 것.
//   --only a,b      그 번호 카드만. 전에 틀렸던 카드를 다시 재 볼 때 쓴다.
//
// ⚠️ 돈이 든다(Anthropic 종량제). 한 장에 그림 약 850토큰 + 물음 약 90토큰이다.
//    **한 번에 다 돌리지 말고 `--limit`으로 끊어서** 얼마 나가는지 보고 늘릴 것.
// ⚠️ 고친 뒤에는 **`npx tsx scripts/gen-card-index.mts`를 꼭 다시** 돌린다.
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface Card {
  n: string
  name?: string
  r?: string
  img?: string
  koImg?: string
}

/**
 * 카드에 찍힌 글자 → 우리가 쓰는 레어도 이름.
 *
 * ⚠️⚠️ **여기 없는 글자는 안 쓴다.** 모르는 것을 넘겨짚어 넣으면 그게 지금 고치고 있는
 *    그 문제(저쪽이 지어낸 값)를 우리가 다시 만드는 것이다. 이름은 도감이 **실제로 쓰는
 *    것**만 골랐다(일본 세트 레어도 이름을 세어서 맞췄다).
 * ⚠️ `S`·`SSR`은 처음에 **일부러 뺐다**(뜻이 갈릴까 봐). 그 뒤 ja-S4a(샤이니스타V)에서
 *    답과 맞대 보니 `S`→Shiny Rare 8장 · `SSR`→Shiny Secret Rare 2장이 **전부 일치**해서
 *    넣었다. 이렇게 **답을 아는 세트로 확인한 뒤에만** 표를 넓힌다.
 */
const 글자표: Record<string, string> = {
  C: 'Common',
  U: 'Uncommon',
  R: 'Rare',
  RR: 'Double Rare',
  RRR: 'Triple Rare',
  AR: 'Art Rare',
  SR: 'Super Rare',
  SAR: 'Special Art Rare',
  UR: 'Ultra Rare',
  HR: 'Hyper Rare',
  MUR: 'Mega Ultra Rare',
  MAR: 'Mega Attack Rare',
  ACE: 'ACE Rare',
  K: 'Kagayaku',
  CHR: 'Character Rare',
  CSR: 'Character Super Rare',
  TR: 'Trainer Rare',
  S: 'Shiny Rare',
  SSR: 'Shiny Secret Rare',
  PROMO: 'Promo',
}

/**
 * ⚠️⚠️ **상자 안 글자를 레어도로 읽는 것이 이 일의 가장 큰 함정이다.**
 * 카드 아래쪽에는 네모 상자가 둘 있다 — ①레귤레이션 마크(글자 하나: A~I) ②세트 코드
 * (MC·M2·SV2a·S-P…). **레어도는 상자 밖, 번호 뒤에** 찍힌다.
 * 처음 물음에서는 이걸 안 밝혔더니 「스타트 덱 100」 468번(레어도 없는 카드)의 세트 코드
 * `MC`에서 **C를 뽑아 「커먼」이라 답했다**(2026-08-13, 20장 중 1장). 없는 레어도를 지어
 * 넣는 것이라 제일 나쁜 실수다 — 지금 고치고 있는 그 문제를 우리가 다시 만드는 꼴이다.
 */
const 물음 = `이 그림은 포켓몬 카드의 **아래쪽 가장자리만** 잘라 낸 것입니다.

거기 나란히 있는 것들:
  [네모 상자 안 글자 하나] [네모 상자 안 세트 코드] [카드 번호] [레어도]
  예) I  MC  468/742          ← 레어도가 없는 카드
  예) J  M2  110/080  SAR     ← 레어도가 SAR인 카드

카드 번호(예: 131/190) **바로 뒤에** 인쇄된 대문자 레어도 기호만 답하세요.
  C, U, R, RR, RRR, AR, SR, SAR, UR, HR, MUR, MAR, ACE, K, CHR, CSR, TR, S, SSR 등.

- **네모 상자 안 글자는 절대 답하지 마세요.** 상자 안 글자 하나(A~I)는 레귤레이션 마크,
  상자 안 짧은 글자(MC, M2, sv4a, S-P 등)는 세트 코드입니다. 둘 다 레어도가 아닙니다.
- 옛 카드는 레어도가 **오른쪽 끝**에 있기도 합니다.
- 네모 도장으로 PROMO 라고 찍혀 있으면 PROMO 라고 답하세요. 그 옆 글자 하나는 무시하세요.
- 별 모양·다이아 모양 같은 **그림만 있고 글자가 없으면** SYMBOL 이라고 답하세요.
- **번호 뒤에 아무 글자도 없으면 NONE** 이라고 답하세요. 이게 아주 흔합니다 —
  그림이 화려하다고 레어도가 있는 것이 아닙니다. **없으면 없다고 하세요. 짐작하지 마세요.**
- 흐리거나 가려서 확신할 수 없으면 UNSURE 라고 답하세요.

답은 그 한 낱말만, 다른 말 없이 적어 주세요.`

const 인자 = process.argv.slice(2)
const 값 = (이름: string) => {
  const i = 인자.indexOf(이름)
  return i >= 0 ? 인자[i + 1] : undefined
}
const 검사할것 = 값('--check')
const 채울것 = 값('--fill')
const 최대 = Number(값('--limit') ?? 30)
const 그림고름 = 값('--img')
const 쓰기 = 인자.includes('--write')
const slug = 검사할것 ?? 채울것

if (!slug) {
  console.log('세트를 주세요: --check <slug> 또는 --fill <slug>')
  process.exit(1)
}

const 키 = process.env.ANTHROPIC_API_KEY
if (!키) {
  console.log('ANTHROPIC_API_KEY 가 없습니다. node --env-file=.env 로 돌리세요.')
  process.exit(1)
}

/**
 * 어느 그림을 쓸까.
 *
 * ⚠️⚠️ **작은 그림으로는 못 읽는다.** 도감에 박힌 tcgplayer 주소는 `_in_400x400`인데
 *    그 크기에서는 레어도 글자가 뭉개진다 — `_in_800x800`으로 바꿔서 봐야 한다.
 *    limitless 그림은 274×381이라 **바꿀 방법이 없어 건너뛴다**(억지로 읽으면 틀린다).
 */
function 그림주소(c: Card): string | null {
  if (그림고름 === 'ko') return c.koImg ?? null
  if (그림고름 === 'tcg400') return c.img?.includes('tcgplayer') ? c.img : null
  if (그림고름 === 'tcg800') return c.img?.includes('tcgplayer') ? c.img.replace('_in_400x400', '_in_800x800') : null
  // 기본: 한글 그림(868×1212)이 제일 크다 → 없으면 tcgplayer 800
  if (c.koImg) return c.koImg
  if (c.img?.includes('tcgplayer')) return c.img.replace('_in_400x400', '_in_800x800')
  return null
}

/**
 * 어느 모델로 읽을까. 기본은 사진 스캔이 쓰는 `claude-sonnet-5`.
 * ⚠️ 싼 모델로 바꾸려면 **반드시 `--check`로 정확도를 먼저 재고** 쓸 것. 작은 글씨라
 *    모델을 낮추면 제일 먼저 무너지는 자리다.
 */
const 모델 = 값('--model') ?? 'claude-sonnet-5'

/**
 * **두 번 물어 답이 같을 때만 쓴다.** 기본으로 켜 둔다.
 *
 * ⚠️⚠️ **이것만으로는 「지어내기」를 못 막는다.** 처음엔 「지어낼 때는 답이 흔들리겠지」로
 *    짐작하고 이걸 약으로 삼았는데, 재 보니 **두 번 다 똑같이 틀렸다**(샤이니스타V 131 →
 *    두 번 다 RR · 179 → 두 번 다 U. 카드엔 표기가 없다). 그림 분위기를 보고 짐작하는
 *    것이라 흔들림이 아니라 **체계적인 오독**이었다.
 *    진짜 약은 **아래쪽 띠만 잘라 보내기**다(`아래띠만`) — 자르니 둘 다 NONE이 됐다.
 * ⚠️ 그래도 남겨 둔 까닭: 자른 뒤에도 흐린 그림에서는 답이 갈린다(실측 25장에 1~2장).
 *    갈리면 `FLIP`으로 버려지므로 **틀리게 채우는 대신 안 채운다** — 그게 맞는 쪽이다.
 *    값이 두 배로 드니 급할 때는 `--once`.
 */
const 한번만 = 인자.includes('--once')
async function 두번읽기(url: string): Promise<string> {
  const a = await 읽기(url)
  if (한번만 || a.startsWith('ERR')) return a
  const b = await 읽기(url)
  return a === b ? a : 'FLIP'
}

/**
 * 그림에서 **아래쪽 띠만** 잘라 낸다(`scripts/crop-card-bottom.py`).
 * ⚠️⚠️ 이게 이 도구의 핵심이다 — 통짜로 보내면 모델이 카드 분위기를 보고 **없는 레어도를
 *    지어낸다.** 자르면 지어낼 재료가 없다. 값도 650토큰 → 300~425토큰으로 준다.
 */
function 아래띠만(원본: Buffer): Promise<Buffer> {
  return new Promise((풀기, 깨기) => {
    const p = spawn('python3', [path.resolve('scripts/crop-card-bottom.py')])
    const 조각: Buffer[] = []
    const 오류: Buffer[] = []
    p.stdout.on('data', (d) => 조각.push(d))
    p.stderr.on('data', (d) => 오류.push(d))
    p.on('error', () => 깨기(new Error('python3 을 못 찾았습니다')))
    p.on('close', (코드) =>
      코드 === 0 && 조각.length
        ? 풀기(Buffer.concat(조각))
        : 깨기(new Error(`자르기 실패 ${코드} ${Buffer.concat(오류).toString().slice(0, 80)}`)),
    )
    p.stdin.end(원본)
  })
}

async function 읽기(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!r.ok) throw new Error(`그림 ${r.status}`)
  const buf = await 아래띠만(Buffer.from(await r.arrayBuffer()))
  const 종류 = 'image/png'
  const a = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 키!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 모델,
      // ⚠️⚠️ **넉넉히 준다.** 16으로 뒀더니 「이 카드의 레어도 기호는 **D**입니다」처럼
      //    한국어로 길게 답하다 **말이 잘려 글자가 안 나왔다** — ja-S4a 171장 중 87장이
      //    그렇게 빈 답이 됐다(2026-08-13). 답이 길어져도 아래에서 영문 낱말만 뽑으므로
      //    넉넉한 편이 낫다. (말머리 미리 넣기는 이 모델이 안 받는다 — 400이 온다.)
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 종류, data: buf.toString('base64') } },
            { type: 'text', text: 물음 },
          ],
        },
      ],
    }),
  })
  if (!a.ok) throw new Error(`저쪽 ${a.status} ${(await a.text()).slice(0, 120)}`)
  const j = (await a.json()) as { content?: { text?: string }[] }
  // ⚠️ 한글·별표·마침표를 통째로 지우면 「레어도기호는D입니다」가 한 덩어리로 붙어 버린다.
  //    **첫 번째 영문 낱말**만 뽑는다.
  const 글 = (j.content?.[0]?.text ?? '').toUpperCase()
  return (글.match(/[A-Z]+/) ?? [''])[0]
}

const 파일 = path.resolve('public/sets', `${slug}.json`)
const 세트 = JSON.parse(await readFile(파일, 'utf-8')) as { name?: string; cards?: Card[] }
const 전부 = 세트.cards ?? []
const 있음 = (c: Card) => !!c.r && c.r !== 'None'
/**
 * 카드 번호를 콕 집어 그것만 본다(`--only 131~MirrorHolofoil.190,179~...`).
 * ⚠️ **한 번 틀린 카드를 다시 재 보려고 만들었다.** 고쳤다고 말하려면 「전에 틀린 그 카드」로
 *    다시 재야 한다 — 무작위로 뽑으면 그 카드가 안 걸려 고쳐진 척이 된다.
 */
const 콕 = (값('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const 후보 = 전부
  .filter((c) => (콕.length ? 콕.includes(c.n) : 검사할것 ? 있음(c) : !있음(c)))
  .filter((c) => 그림주소(c))
// 앞에서부터 몰아 뽑으면 그 세트의 한 구간만 본다 — 고르게 흩어 뽑는다.
const 걸음 = Math.max(1, Math.floor(후보.length / 최대))
const 볼것 = 후보.filter((_, i) => i % 걸음 === 0).slice(0, 최대)

console.log(`${slug} (${세트.name ?? ''}) — ${검사할것 ? '맞춰 보기' : '채우기'} · 후보 ${후보.length}장 중 ${볼것.length}장`)

let 맞음 = 0
let 틀림 = 0
let 모름 = 0
let 채움 = 0
const 어긋난것: string[] = []
/**
 * 표에 없어서 안 쓴 글자를 모아 둔다.
 * ⚠️ **이걸 안 찍으면 「못 읽음」이 뭉뚱그려져 표를 넓힐 기회를 놓친다.** ja-S4a에서
 *    12장 중 9장이 못 읽음이었는데, 알고 보니 못 읽은 게 아니라 **표에 없는 글자**였다.
 */
const 표밖: Record<string, { 셈: number; 우리값: Record<string, number> }> = {}

// ⚠️ 한 번에 4장씩만 부른다. 더 몰아치면 저쪽이 429를 낸다.
for (let i = 0; i < 볼것.length; i += 4) {
  const 묶음 = 볼것.slice(i, i + 4)
  const 답들 = await Promise.all(
    묶음.map(async (c) => {
      try {
        return await 두번읽기(그림주소(c)!)
      } catch (e) {
        return `ERR:${(e as Error).message}`
      }
    }),
  )
  for (let k = 0; k < 묶음.length; k++) {
    const c = 묶음[k]
    const 글자 = 답들[k]
    const 우리말 = 글자표[글자]
    if (검사할것) {
      if (!우리말) {
        모름++
        const 칸 = (표밖[글자] ??= { 셈: 0, 우리값: {} })
        칸.셈++
        칸.우리값[c.r ?? ''] = (칸.우리값[c.r ?? ''] ?? 0) + 1
        continue
      }
      if (우리말 === c.r) 맞음++
      else {
        틀림++
        어긋난것.push(`${c.n} ${c.name ?? ''} — 우리 「${c.r}」 ↔ 그림 「${글자}」(${우리말})`)
      }
    } else {
      if (!우리말) {
        모름++
        표밖[글자] = { 셈: (표밖[글자]?.셈 ?? 0) + 1, 우리값: {} }
        continue
      }
      c.r = 우리말
      채움++
      console.log(`  ${c.n} ${(c.name ?? '').slice(0, 26)} → ${글자} (${우리말})`)
    }
  }
  process.stdout.write(`  …${Math.min(i + 4, 볼것.length)}/${볼것.length}\r`)
}

console.log('')
if (검사할것) {
  const 센것 = 맞음 + 틀림
  console.log(`맞음 ${맞음} · 틀림 ${틀림} · 못 읽음(안 씀) ${모름}`)
  console.log(`정확도 ${센것 ? ((맞음 / 센것) * 100).toFixed(1) : '-'}% (읽어낸 것 기준)`)
  if (어긋난것.length) {
    console.log('\n어긋난 것:')
    for (const s of 어긋난것) console.log('  ', s)
  }
  const 밖 = Object.entries(표밖).sort((a, b) => b[1].셈 - a[1].셈)
  if (밖.length) {
    console.log('\n표에 없어서 안 쓴 글자(← 우리 값):')
    for (const [글자, v] of 밖) console.log(`   ${글자.padEnd(8)} ${v.셈}장  ← ${JSON.stringify(v.우리값)}`)
  }
} else {
  console.log(`채움 ${채움}장 · 못 읽어 건너뜀 ${모름}장`)
  const 밖 = Object.entries(표밖).sort((a, b) => b[1].셈 - a[1].셈)
  if (밖.length) console.log('  건너뛴 까닭:', 밖.map(([g, v]) => `${g} ${v.셈}장`).join(' · '))
  if (쓰기 && 채움) {
    await writeFile(파일, `${JSON.stringify(세트, null, 0)}\n`, 'utf-8')
    console.log('→ 적었습니다. gen-card-index.mts 를 다시 돌리세요.')
  } else if (!쓰기) {
    console.log('(보기만 했습니다. 실제로 채우려면 --write)')
  }
}
