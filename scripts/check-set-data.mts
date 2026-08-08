/**
 * 우리 세트 자료 자체가 성한지 본다. 저쪽(PPT) 자료와 맞추기 **전에** 우리 쪽부터
 * 멀쩡해야 한다 — 여기가 틀리면 뒤의 모든 대조가 헛일이 된다.
 *
 * 보는 것:
 *   ① 목록(index.json) ↔ 파일: 빠진 파일·목록에 없는 파일·슬러그 중복·카드 수
 *   ② 세트 안: 번호 중복 · 이름 빈 것 · 번호 빈 것
 *   ③ 그림 주소: 주소에 든 **세트 코드**와 **카드 번호**가 그 카드와 맞는가
 *
 * ⚠️ ③에서 코드가 달라 보이는 것은 대개 CDN 이름 규칙이다("SM4+" → "SM4p",
 *    "M-P" → "MP"). 그래서 **한 세트가 여러 코드로 갈리는지**를 본다 — 갈리지 않으면
 *    세트 통째로 이름만 다른 것이라 섞임이 아니다.
 *
 * **2026-08-08 결과: 전부 깨끗하다.**
 *   세트 371개·카드 40,489장 — 어긋남 0
 *   그림 36,375장 중 36,367장이 번호까지 일치. 나머지 8장은 ja-MC 기본 에너지의
 *   약자 차이다(우리 "DAR" ↔ 그림 "D"). 같은 카드다.
 *
 * 실행: node --experimental-strip-types scripts/check-set-data.mts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = existsSync(join(ROOT, 'public/sets')) ? join(ROOT, 'public/sets') : join(ROOT, 'dist/sets')
type Card = { n?: string; name?: string; img?: string }

const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
  slug: string
  count?: number
  releaseDate?: string
}[]
const 파일 = new Set(
  readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'ko-index.json')
    .map((f) => f.replace('.json', '')),
)

const 탈 = (x: string) => 문제.push(x)
const 문제: string[] = []

// ① 목록 ↔ 파일
const 본슬러그 = new Set<string>()
for (const s of idx) {
  if (본슬러그.has(s.slug)) 탈(`목록에 슬러그가 두 번: ${s.slug}`)
  본슬러그.add(s.slug)
  if (!파일.has(s.slug)) {
    탈(`목록엔 있는데 파일이 없다: ${s.slug}`)
    continue
  }
  if (!s.releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(s.releaseDate)) 탈(`발매일이 이상하다: ${s.slug} "${s.releaseDate}"`)
  const cards = (JSON.parse(readFileSync(join(dir, `${s.slug}.json`), 'utf8')).cards ?? []) as Card[]
  if (s.count !== cards.length) 탈(`카드 수가 안 맞는다: ${s.slug} 목록 ${s.count} ↔ 파일 ${cards.length}`)
}
for (const f of 파일) if (!본슬러그.has(f)) 탈(`파일은 있는데 목록에 없다: ${f}`)

// ② 세트 안 + ③ 그림
let 카드수 = 0
let 그림잼 = 0
let 그림맞음 = 0
const 세트별그림코드 = new Map<string, Set<string>>()
for (const slug of 파일) {
  const cards = (JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8')).cards ?? []) as Card[]
  const 본번호 = new Set<string>()
  for (const c of cards) {
    카드수++
    const n = String(c.n ?? '')
    if (!n) 탈(`번호가 빈 카드: ${slug} "${c.name ?? ''}"`)
    else if (본번호.has(n)) 탈(`같은 번호가 두 번: ${slug} ${n}`)
    else 본번호.add(n)
    if (!String(c.name ?? '').trim()) 탈(`이름이 빈 카드: ${slug} ${n}`)

    const u = String(c.img ?? '')
    if (!u) continue
    const 코드 =
      u.match(/\/tpc\/([A-Za-z0-9+.-]+)\//) ??
      u.match(/assets\.tcgdex\.net\/[a-z]{2}\/[A-Za-z0-9]+\/([A-Za-z0-9+.-]+)\//)
    if (코드) {
      const s = 세트별그림코드.get(slug) ?? new Set<string>()
      s.add(코드[1])
      세트별그림코드.set(slug, s)
    }
    const 번호 =
      u.match(/\/tpc\/[A-Za-z0-9+.-]+\/[A-Za-z0-9+.-]+_([A-Za-z0-9]+)_/) ??
      u.match(/assets\.tcgdex\.net\/[a-z]{2}\/[A-Za-z0-9]+\/[A-Za-z0-9+.-]+\/([A-Za-z0-9]+)(?:\/|$)/)
    if (!번호) continue
    그림잼++
    const 벗김 = (x: string) => x.replace(/^0+/, '').toUpperCase()
    if (벗김(n) === 벗김(번호[1])) 그림맞음++
    else if (!/^(DAR|FIG|FIR|GRA|LIG|MET|PSY|WAT)$/.test(n)) {
      // 기본 에너지는 우리가 세 글자, 그림이 한 글자를 쓴다(DAR ↔ D). 같은 카드다.
      탈(`그림 번호가 다르다: ${slug} 번호 ${n} ↔ 그림 ${번호[1]} (${c.name ?? ''})`)
    }
  }
}
for (const [slug, 코드들] of 세트별그림코드) {
  if (코드들.size > 1) 탈(`한 세트인데 그림 코드가 갈린다: ${slug} → ${[...코드들].join(', ')}`)
}

console.log(`세트 ${idx.length}개 · 카드 ${카드수.toLocaleString()}장 · 그림 번호를 잰 것 ${그림잼.toLocaleString()}장(맞음 ${그림맞음.toLocaleString()})`)
console.log(문제.length ? `문제 ${문제.length}개\n` : '문제 없음')
for (const x of 문제.slice(0, 30)) console.log('  ' + x)
