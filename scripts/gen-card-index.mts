// 카드 이름으로 전체에서 찾기 위한 색인을 만든다.
//
// 왜 미리 만드나: 화면에서 "개굴닌자"를 치면 세트를 가리지 않고 다 나와야 하는데,
// 세트 파일이 284개(카드 31,603장)라 그때그때 다 열 수가 없다. 그렇다고 색인을
// 통째로 내려주면 3MB라 사용자가 받기엔 무겁다. 그래서 파일로 만들어 두고 서버가
// 읽어 검색 결과만 내려준다. 공개 폴더(public)가 아니라 리포 루트에 둔다 — 서버만
// 읽으면 되고, 공개돼 있으면 크롤러가 3MB를 긁어 간다.
//
// 한글 이름은 여기서 미리 변환해 둔다 — 서버가 변환기를 들고 있지 않아도 되게.
//
// 사용법: npx tsx scripts/gen-card-index.mts
// 세트 데이터나 이름 사전이 바뀌면 다시 돌린다.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { koName, koSet } from '../src/lib/koCardName'
import { isPocketSet } from '../src/lib/pocketSets'

const SETS_DIR = path.resolve('public/sets')
// public/ 에 두면 정적 파일로 공개돼 누구나 3MB를 내려받을 수 있다.
// 서버만 읽으면 되므로 리포 루트에 두고 Dockerfile 이 이미지로 복사한다.
const OUT = path.resolve('card-index.json')

interface SetIndexEntry {
  slug: string
  ed: 'ja' | 'en'
  name: string
  releaseDate: string
  serie?: string
}

// 한 줄이 카드 한 장. 자리를 아끼려고 객체가 아니라 배열로 둔다(7MB → 서버만 읽는다).
// [0] 세트 slug · [1] 카드번호 · [2] 한글 이름 · [3] 이미지
// [4] 공식 한글명(없으면 '') · [5] 한글판 이미지 · [6] 한글판 번호
// [7] 저쪽(PPT) 번호 · [8] 원래 이름(한글 이름과 다를 때만) · [9] 레어도
// [10] **그림이 그 카드 것이 아니라 같은 번호의 일반판 것**일 때 '1'(아니면 '')
// [11] **카드에 실제로 찍힌 번호**(옛 일본 세트만. 없으면 '')
type Row = [string, string, string, string, string, string, string, string, string, string, string, string]

// ⚠️ **화면과 같은 함수를 쓴다.** 예전엔 여기서 규칙을 따로 들고 있었는데, 화면 쪽
//    koName에는 없는 갈래가 빠져 있어 **33장이 화면과 다른 이름으로 색인**됐다
//    (2026-08-08 실측). 일본판인데 원본 이름이 영어로 들어온 카드들이다:
//        화면 "로켓단의 아폴로"   ↔   색인 "Team 로켓단의 Archer"
//    색인은 카드 검색이 읽는 자료라, 이름이 다르면 **화면에 보이는 이름으로 검색해도
//    안 나온다.** 규칙이 둘이면 언젠가 반드시 어긋난다.

async function main() {
  const index = JSON.parse(await readFile(path.join(SETS_DIR, 'index.json'), 'utf-8')) as SetIndexEntry[]
  const setOf = new Map(index.map((s) => [s.slug, s]))

  const files = (await readdir(SETS_DIR)).filter(
    (f) => f.endsWith('.json') && !['index.json', 'ko-index.json'].includes(f),
  )

  const rows: Row[] = []
  const sets: Record<string, [string, string, string, string]> = {} // slug → [한글 세트명, ed, 발매일, 영문 세트명]

  for (const f of files) {
    const slug = f.replace('.json', '')
    let file: { ed?: 'ja' | 'en'; cards?: { n: string; name: string; img?: string; koName?: string; koImg?: string; koNo?: string; tcg?: string; r?: string; imgBase?: boolean; printNo?: string }[] }
    try {
      file = JSON.parse(await readFile(path.join(SETS_DIR, f), 'utf-8'))
    } catch {
      continue
    }
    const meta = setOf.get(slug)
    // 휴대폰 게임 전용 카드는 실물 거래가 없어 색인에서 뺀다(pocketSets.ts 참고).
    if (isPocketSet(meta?.serie)) continue
    const ed = file.ed ?? meta?.ed ?? (slug.startsWith('en-') ? 'en' : 'ja')
    // 모바일 포켓은 실물이 없어 플리마켓에서 팔 수 없다 — 색인에서 뺀다.
    if (slug.includes('pocket')) continue

    // 세트 이름도 화면과 같은 함수(koSet)를 쓴다. 여기도 규칙이 따로 있었다.
    const setKo = meta ? koSet(ed, meta.name) : slug
    // ⚠️ **원래(영문) 세트 이름도 담는다.** 세트 이름으로 카드를 찾을 수 있게 하려는 것인데
    //    (2026-08-16), 한글 이름만 있으면 「Paradigm Trigger」·「crown zenith」처럼
    //    **영문으로 치는 사람**이 0건을 본다(실제 검색 기록에 있다). 한글과 같으면 빈칸.
    const setEn = meta ? meta.name : ''
    sets[slug] = [setKo, ed, meta?.releaseDate ?? '', setEn === setKo ? '' : setEn]

    for (const c of file.cards ?? []) {
      // ⚠️ 8번째 칸은 **PPT 번호(tcg)**다. 새 시세 길이 이 번호로 덤프에서 값을 찾는다
      //    (2026-08-12). 없는 카드도 있다(구판·프로모 9%) — 그건 빈 문자열이다.
      // ⚠️ 9번째 칸은 **원래 이름**이다. 없으면 「charizard」를 쳤을 때 한 장도 안 나온다 —
      //    색인에는 한글 이름만 있어서다. 한글 이름과 같으면 빈칸으로 둬 자리를 아낀다.
      // ⚠️ 10번째 칸은 **레어도**다. 「저지맨 SR」처럼 뒤에 레어도를 붙여 찾는 사람이 있는데
      //    색인에 없으면 0건이 된다(2026-08-12). 도감 63,070장 중 60,328장(96%)에 있다.
      const ko = koName(ed, c.name)
      rows.push([slug, c.n, ko, c.img ?? '', c.koName ?? '', c.koImg ?? '', c.koNo ?? '', c.tcg ?? '', c.name === ko ? '' : c.name, c.r ?? '', c.imgBase ? '1' : '', c.printNo ?? ''])
    }
  }

  // ── 같은 카드가 두 줄로 들어간 것을 합친다 ────────────────────────────────────
  //
  // ⚠️⚠️ 카드 목록을 **두 군데서** 받아 온 탓에 한 카드가 두 줄인 세트가 있다.
  //    한쪽은 limitless/TCGdex(번호가 `11`, PPT 번호 없음), 한쪽은 PPT 덤프
  //    (번호가 `11~602979`, PPT 번호 있음)에서 왔다. **31개 세트 · 814줄**이 그렇다.
  //    합치기 전에는 「EBB 리자몽」을 찾으면 **같은 카드가 두 번** 나오고, 그중 하나는
  //    PPT 번호가 없어 값이 안 붙어 「값 없는 카드」로 보였다(2026-08-12 새 시세 길에서 발견).
  //
  // ⚠️ **없는 쪽을 그냥 버리면 안 된다.** 814줄 중 **134줄에만 한글판 자료**(공식 한글명·
  //    한글 그림·한글 번호)가 있다 — 버리면 그 카드들의 한글 이름이 사라진다.
  //    그래서 **지우는 게 아니라 합친다**: PPT 번호는 있는 쪽에서, 한글 자료는 가진 쪽에서.
  //
  // ⚠️ **글자 하나까지 같은 이름 + 같은 밑번호 + 같은 세트**일 때만 합친다. 느슨하게
  //    맞추면 다른 카드가 묶인다(drop-dup-imgless-cards.mts의 「1st Place ↔ 3rd Place」 참고).
  // ⚠️ **양쪽 다 PPT 번호가 있으면 안 합친다** — 그건 진짜로 다른 인쇄(Mirror Holo 등)다.
  // ⚠️⚠️ **앞의 0을 반드시 뗀다.** 안 떼면 「001」과 「1」이 다른 번호가 되어 합칠 것을
  //    못 합친다 — 그래서 새 일본 세트 29개에 **같은 카드가 두 벌**로 남아 있었다
  //    (2026-08-12 발견. ja-M2a는 실제 250장인데 604장으로 보였다).
  //    한쪽은 limitless에서 와서 번호가 「001」·이름이 일본어(ヒビキのカイロス)이고
  //    저쪽 번호도 레어도도 없다. 다른 쪽은 PPT 덤프라 「1」·영문(Ethan's Pinsir)이고
  //    둘 다 있다. **한글 이름은 둘이 똑같다**(「심향의 쁘사이저」) — 그래서 이름으로
  //    묶는 이 규칙이 맞고, 번호만 어긋나 있었다.
  const 밑번호 = (n: string) => String(n).split('~')[0].replace(/^0+(?=\d)/, '')
  // TCGplayer 그림은 저쪽이 403으로 막는 일이 있다(2026-08-12에 약 2,990장 확인).
  // 합칠 때 막히지 않는 쪽 그림이 있으면 그걸 남긴다 — 같은 카드니 어느 쪽을 써도 된다.
  const 안막히는그림 = (u: string) => !!u && !u.includes('tcgplayer-cdn')
  const 묶음 = new Map<string, Row[]>()
  for (const r of rows) {
    const k = `${r[0]} ${밑번호(r[1])} ${r[2]}`
    const 있 = 묶음.get(k)
    if (있) 있.push(r)
    else 묶음.set(k, [r])
  }
  const 합친것 = new Set<Row>()
  let 합침 = 0
  let 한글살림 = 0
  for (const v of 묶음.values()) {
    if (v.length < 2) continue
    const 번호있음 = v.filter((r) => r[7])
    const 번호없음 = v.filter((r) => !r[7])
    if (번호있음.length !== 1 || !번호없음.length) continue // 애매하면 안 건드린다
    const 남길 = 번호있음[0]
    for (const 버릴 of 번호없음) {
      // 한글 자료는 가진 쪽에서 옮겨 온다(남길 쪽이 비어 있을 때만).
      if (!남길[4] && 버릴[4]) { 남길[4] = 버릴[4]; 한글살림++ }
      if (!남길[5] && 버릴[5]) 남길[5] = 버릴[5]
      if (!남길[6] && 버릴[6]) 남길[6] = 버릴[6]
      if (!안막히는그림(남길[3]) && 안막히는그림(버릴[3])) 남길[3] = 버릴[3]
      합친것.add(버릴)
      합침++
    }
  }
  const 남은줄 = rows.filter((r) => !합친것.has(r))
  if (합침) console.log(`  같은 카드 두 줄을 합쳤습니다 — ${합침.toLocaleString()}줄 (한글 자료를 옮겨 살린 것 ${한글살림}장)`)

  // 최신 세트가 먼저 나오게 미리 정렬해 둔다. 검색할 때마다 정렬하지 않아도 된다.
  남은줄.sort((a, b) => (sets[b[0]]?.[2] ?? '').localeCompare(sets[a[0]]?.[2] ?? ''))
  rows.length = 0
  rows.push(...남은줄)

  // ── 검수 곁 카드(1st Edition·기타 언어)를 도감에 세운다(사장님 지시 2026-08-20) ──
  // 원천은 검수 저장소의 곁 파일이다 — 실제 낙찰이 있어 갈라 둔 카드만 생기고, 다시
  // 만들어도 같은 꼴로 다시 선다. 열쇠는 캡틴츄와 같은 `~` 갈래(`12345~1st`·`12345~lang`).
  // 덤프·팝수처럼 저쪽 번호를 쓰는 자리는 `~` 앞만 보므로 안 부딪히고, 시세는 승격이
  // 구운 우리 값(보정등급·card-history)으로만 나온다.
  // ⚠️ 이름·번호·그림은 곁 파일에 이미 들어 있다(이름 꼬리 「 · 1st Edition」·「 · 기타 언어」 포함).
  try {
    const 검수폴더 = path.resolve('data/ebay-check')
    // ⚠️ 2026-08-22에 「· 리버스 홀로」(-rev) 곁이 늘었다(사장님 승인). 꼬리 목록은 서버
    //    다시짓기의 곁이름들과 같아야 한다 — 한쪽만 늘리면 파일은 생기는데 도감엔 안 선다.
    const 곁파일들 = (await readdir(검수폴더)).filter((f) => /-(1st|lang|rev)\.json$/.test(f) && !f.startsWith('._'))
    // ⚠️ 곁 카드는 **원본과 같은 카드**다(언어·초판·리버스만 다르다). 레어도는 원본 것을 그대로
    //    물려받는다 — 비워 두면 「저지맨 SR」처럼 레어도로 찾을 때 곁 카드가 안 나오고, 세트
    //    간판(레어도 순)에서도 빠진다(2026-09-08: 곁 3,983장 중 3,522장이 이 때문에 빈칸이었다).
    //    그림도 곁 파일에 없으면 원본 그림을 쓴다(18장).
    const 원본 = new Map<string, Row>()
    for (const r of rows) if (r[7] && !String(r[7]).includes('~')) 원본.set(String(r[7]), r)
    let 곁수 = 0
    let 물려받음 = 0
    for (const f of 곁파일들) {
      try {
        const 검 = JSON.parse(await readFile(path.join(검수폴더, f), 'utf8')) as {
          id: string; slug: string; name: string; nameEn: string; no: string; img: string
        }
        const 꼬리 = f.endsWith('-1st.json') ? '~1st' : f.endsWith('-rev.json') ? '~rev' : '~lang'
        const base = String(검.id).replace(/-(1st|lang|rev)$/, '')
        // ⚠️ 캡틴피카츄(617410)의 기타 언어 곁은 안 세운다 — 그 중국어 낙찰의 주인은
        //    도감의 중국어판 카드(zh-CBB1C · 617410~zh)라, 세우면 같은 낙찰이 두 카드에
        //    실린다(영문 카드의 「일본판」을 지우는 것과 같은 까닭 — 주인이 따로 있으면 안 겹친다).
        if (base === '617410' && 꼬리 === '~lang') continue
        const 부모 = 원본.get(base)
        const 레어도 = 부모?.[9] ?? ''
        const 그림 = String(검.img ?? '') || 부모?.[3] || ''
        if (부모 && (레어도 || (!검.img && 그림))) 물려받음++
        rows.push([검.slug, String(검.no ?? ''), String(검.name ?? ''), 그림, '', '', '', `${base}${꼬리}`, String(검.nameEn ?? ''), 레어도, '', ''])
        곁수++
      } catch { /* 깨진 파일은 건너뜀 */ }
    }
    if (곁수) console.log(`  검수 곁 카드 ${곁수.toLocaleString()}장을 도감에 세웠습니다(1st Edition·기타 언어) · 원본에서 레어도·그림을 물려받은 것 ${물려받음.toLocaleString()}장.`)
  } catch { /* 검수 저장소가 없는 환경이면 곁 카드 없이 만든다 */ }

  await writeFile(OUT, JSON.stringify({ sets, rows }))
  const mb = (JSON.stringify({ sets, rows }).length / 1024 / 1024).toFixed(2)
  console.log(`카드 ${rows.length.toLocaleString()}장 · 세트 ${Object.keys(sets).length}개 → ${path.relative('.', OUT)} (${mb} MB)`)
}

await main()
