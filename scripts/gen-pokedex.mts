// 포켓몬별 카드 목록을 미리 만들어 public/pokedex/에 저장한다.
//
// 왜 미리 만드나: 카드가 40,489장이고, 어느 포켓몬 카드인지 가려내려면 이름 1,025개와
// 맞춰 봐야 한다. 이걸 브라우저에서 하면 세트 파일 371개를 통째로 받아야 한다(수 MB).
// 미리 만들어 두면 검색은 목록 파일 하나(작다)로 하고, 고른 포켓몬 것만 따로 받는다.
// 작가 화면(public/artists/by-card.json)이 같은 방식이다.
//
// ⚠️ 이름 대조는 **번역 전 원문**으로 한다. 일본판은 일본어, 영문판은 영어와 맞춘다.
//    한글로 옮긴 뒤에 맞추면 번역이 틀린 카드는 통째로 빠진다.
// ⚠️ 긴 이름부터 맞춘다. "리자몽"을 먼저 맞추면 "메가리자몽"이 리자몽으로 잡힌다.
//    실제로는 메가리자몽도 리자몽 카드가 맞지만, 진화 전후를 섞지 않으려면 긴 쪽이 맞다.
//
// 쓰는 법: npx tsx scripts/gen-pokedex.mts
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import pokemonNames from '../src/data/pokemonNames.json' with { type: 'json' }
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'
import { koreanizeEnglishCardName } from '../src/lib/koreanizeEnglishTitle.ts'
import { koName } from '../src/lib/cardCatalog.ts'
import { isPocketSet } from '../src/lib/pocketSets.ts'
import cardCategories from '../src/data/cardCategories.json' with { type: 'json' }
import cardFacts from '../src/data/cardFacts.json' with { type: 'json' }
import oldJpDex from '../src/data/oldJpDex.json' with { type: 'json' }

type Pokemon = { id: number; ko: string; ja: string; en: string }
type SetMeta = { slug: string; ed: 'ja' | 'en'; name: string; releaseDate?: string; serie?: string }
type Card = { n: string; name: string; img?: string; r?: string; tcg?: string; printNo?: string }

/** 한 장. 화면이 쓰는 것만 담는다 — 파일이 커지면 첫 화면이 느려진다. */
type Entry = {
  /** 카드 이름(번역 전 원문). 화면이 우리 사전으로 한글로 만든다. */
  name: string
  /** 세트 슬러그. 눌러서 세트 화면으로 갈 때 쓴다. */
  s: string
  /**
   * **카드에 실제로 찍힌 번호**(옛 일본 세트만). 없으면 `n`을 보여 준다.
   * ⚠️ 1996~2001 구판은 카드 번호가 없고 포켓몬 도감번호가 「No.004」로 찍혀 있다.
   *    우리 `n`은 정렬 순번이라 실물과 다르다(사장님 지시 2026-08-17).
   */
  p?: string
  /** 카드 번호 */
  n: string
  /** 그림 */
  img?: string
  /** 등급 */
  r?: string
  /**
   * **PPT 번호**(tcgPlayerId). 화면이 이베이·TCGplayer 시세를 이름으로 뒤지지 않고
   * 이 번호로 콕 집어 부른다 — 딴 카드가 안 섞이고 크레딧도 48분의 1이다.
   * ⚠️ 없는 카드도 있다(PPT에 없는 옛 카드). 그때는 예전처럼 이름으로 찾는다.
   */
  tcg?: string
}

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'pokedex')

const list = pokemonNames as Pokemon[]
// 긴 이름부터 — 짧은 이름이 긴 이름 안에 들어 있는 경우를 먼저 가로채지 않게.
const byJa = [...list].sort((a, b) => b.ja.length - a.ja.length)
const byEn = [...list].sort((a, b) => b.en.length - a.en.length)
// ⚠️ 표기 흔들림을 걷어내고 견준다. 우리 사전은 `Farfetch’d`(굽은 따옴표)인데 카드
//    원문은 `Farfetch'd`(곧은 따옴표)라 파오리가 안 잡혔고, `deoxys`·`weezing`처럼
//    소문자로 적힌 원문도 놓쳤다(2026-08-07 점검 중 발견).
const 견줌 = (s: string) => s.replace(/[’‘'`´]/g, "'").replace(/\s+/g, ' ').toLowerCase()
/**
 * 카드 이름 안에 포켓몬 이름이 들었나.
 *
 * ⚠️⚠️ **영문 이름은 글자만 겹쳐도 걸린다.** 그냥 `includes`로 보던 때 트레이너·굿즈
 *    카드가 포켓몬 무더기에 섞였다(2026-08-09에 10장을 잡았다):
 *        `Big Parasol`      → Para**s**ol 안의 Paras  → 파라스 무더기
 *        `Hypnotoxic Laser` → **Hypno**toxic 안의 Hypno → 슬리퍼 무더기
 *        `Aaron's Aura` · `Charon's Choice` → A**aron**·Ch**aron** 안의 Aron → 가보리 무더기
 *    그래서 **영문일 때만 앞뒤에 다른 알파벳이 붙지 않을 것**을 요구한다.
 *    `Charizard ex`·`Charizard-EX`·`Erika's Oddish`·`Nidoran♀`는 앞뒤가 알파벳이
 *    아니라 그대로 걸린다.
 * ⚠️ 한글·일본어에는 이 검사를 걸면 안 된다 — 낱말 사이가 안 띄어져 있어 다 막힌다.
 */
const 들었나 = (통: string, 조각: string) => {
  const a = 견줌(통)
  const b = 견줌(조각)
  if (!b) return false
  if (!/^[a-z0-9'. -]+$/.test(b)) return a.includes(b)
  const 벽 = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![a-z])${벽}(?![a-z])`).test(a)
}

const idx = JSON.parse(readFileSync(path.join(ROOT, 'public/sets/index.json'), 'utf-8')) as SetMeta[]
const meta = new Map(idx.map((s) => [s.slug, s]))

// 카드가 포켓몬인지 트레이너·에너지인지 **원본에 물어 둔 것**. 이름으로 짐작하면
// "빛나는 리자몽"·"피카츄 ex"가 트레이너로 가고, 반대로 포켓몬 이름이 든 트레이너
// ("마그마단의 슈퍼볼")가 포켓몬으로 갈 수 있다(2026-08-07 점검 중 발견).
// 세 갈래로 받아 뒀다 — 세트 단위 REST(cardCategories) · 영문판 GraphQL(cardFacts) ·
// 옛 일본판 카드 상세(oldJpDex). 아는 카드는 38,009장 중 29,155장(77%)이다.
const 종류표 = cardCategories as Record<string, Record<string, string>>
const 북미표 = cardFacts as Record<string, { c?: string }>
const 옛표 = oldJpDex as Record<string, { c?: string }>
const 카드종류 = (slug: string, setId: string, n: string): 'p' | 't' | 'e' | '' => {
  const 번호들 = [String(n), String(n).replace(/^0+/, ''), String(n).padStart(3, '0')]
  // ⚠️ **같은 번호를 앞의 0만 다르게 두 번 적어 놓고 갈래가 다른 칸이 25개 있다.**
  //    en-swsh1은 "64"=포켓몬 / "064"=트레이너인데, 64번은 Frosmoth(포켓몬)다.
  //    한 세트 자리에 **딴 세트 자료가 겹쳐 들어온 것**이다(en-swsh1은 216장짜리인데
  //    칸이 416개, en-sma는 94장에 400개). 지금은 우리 번호가 0 없는 꼴이라 맞는
  //    쪽이 먼저 걸려서 탈이 안 나지만, 세트 자료의 번호 꼴이 바뀌면 그날로 뒤집힌다.
  //    → **갈리면 모른다고 한다.** 모르면 아래 다른 표를 보고, 그것도 없으면 ''다.
  //      ''는 안전하다 — 도감은 갈래가 t·e라고 **못 박은** 것만 뺀다.
  const 본것 = new Set<string>()
  for (const k of 번호들) {
    const a = 종류표[slug]?.[k]
    if (a) 본것.add(a)
  }
  if (본것.size === 1) return [...본것][0] as 'p' | 't' | 'e'
  const b = 옛표[`${setId}-${n}`]?.c
  if (b) return b as 'p' | 't' | 'e'
  for (const k of 번호들) {
    const f = 북미표[`${setId}-${k}`]?.c
    if (f) return f as 'p' | 't' | 'e'
  }
  return ''
}

/** 포켓몬 id → 그 포켓몬 카드들 */
const buckets = new Map<number, (Entry & { date: string })[]>()

// 트레이너·에너지 카드. 포켓몬처럼 이름표(ja/en/ko 대조표)가 없으므로 **한글 카드
// 이름**으로 묶는다 — 일본판 「博士の研究」와 영문판 「Professor's Research」가 둘 다
// "박사의 연구"가 되어 한 무더기가 된다(운영자 지시 2026-08-06).
// ⚠️ 그래서 여기만은 번역을 거친다. 포켓몬 쪽은 원문으로 맞추는 것과 반대인데,
//    이유가 다르다 — 포켓몬은 대조표가 있어 원문이 더 정확하고, 트레이너는 판을
//    묶어 줄 열쇠가 한글 이름밖에 없다.
const trainers = new Map<string, (Entry & { date: string; ko: string })[]>()
// 한글 포켓몬 이름 → 도감번호. 위 대조에서 빠진 카드를 이름으로 건져 올릴 때 쓴다.
const koPokemon = new Map(list.map((p) => [p.ko.replace(/[\s·]/g, ''), p.id]))
// 한글 이름으로 찾을 때도 긴 것부터 본다("이상해꽃"이 "이상해"보다 앞서야 한다).
const byKo = [...list].sort((a, b) => b.ko.length - a.ko.length)
// ⚠️ 화면이 쓰는 것과 **같은 함수**를 쓴다. 예전에는 여기서 따로 만들었는데, 화면은
//    옛 세트의 깨진 원본을 더 손보고 있어서 결과가 갈렸다 — 같은 카드가 세트 화면에서는
//    "로켓단의 레트라", 도감에서는 "Team 로켓단의 레트라"로 보였다(점검 중 발견
//    2026-08-06). 규칙이 둘이면 언젠가 반드시 어긋난다.
const koCardName = koName

for (const f of readdirSync(path.join(ROOT, 'public/sets'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue
  const slug = f.replace('.json', '')
  const m = meta.get(slug)
  if (!m) continue
  // 휴대폰 게임 전용 카드는 시세가 있을 수 없어 도감에서 뺀다(pocketSets.ts 참고).
  if (isPocketSet(m.serie)) continue
  const d = JSON.parse(readFileSync(path.join(ROOT, 'public/sets', f), 'utf-8')) as { ed: 'ja' | 'en'; cards?: Card[] }
  const pool = d.ed === 'ja' ? byJa : byEn
  for (const c of d.cards ?? []) {
    const nm = c.name ?? ''
    if (!nm) continue
    // ⚠️ `p`(카드에 찍힌 번호)를 같이 담는다 — 옛 일본 세트는 우리 `n`(정렬 순번)과 실물이
    //    다르다(파이리가 우리는 012, 카드엔 No.004). 화면은 찍힌 쪽을 보여 준다.
    const 한장 = { name: nm, s: slug, n: c.n, p: c.printNo || undefined, img: c.img || undefined, r: c.r || undefined, tcg: c.tcg || undefined, date: m.releaseDate ?? '' }
    // ⚠️ **이름으로 포켓몬을 찾았으면 그것을 믿는다.** 원본 종류표로 먼저 걸렀더니
    //    "자시안 V"·"히스이 가디"·"팔데아 켄타로스" 같은 멀쩡한 포켓몬 카드 150종이
    //    트레이너로 새어 나갔다(2026-08-07 회귀 검사에서 발견). 종류표는 세트·번호를
    //    맞춰 온 것이라 번호 표기가 어긋나면 남의 카드 종류를 가져온다.
    //    종류표는 **이름으로 못 찾았을 때만** 쓴다 — 반대 판 사전까지 뒤져 볼지 정하는 데.
    let hit = pool.find((p) => 들었나(nm, d.ed === 'ja' ? p.ja : p.en))
    // ⚠️ **이름이 다른 이름 안에 통째로 들어갈 때가 있다.** 그러면 트레이너가 포켓몬
    //    밑에 걸린다(2026-08-08 실측 31장):
    //        ラッキー(럭키) ⊂ ラッキーメット(행운의헬멧) · アーボ(아보) ⊂ ルアーボール
    //        サンド(모래두지) ⊂ サンドウィッチ · Paras ⊂ Parasol Lady
    //        リザード(리자드) ⊂ カリザード · Hypno(슬리퍼) ⊂ Hypnotoxic Laser
    //    이름이 카드 이름보다 짧으면(=일부만 걸린 것) 원본 종류를 확인한다. 종류가
    //    트레이너·에너지라고 **못 박은 것만** 물린다.
    //    ⚠️ 종류표로 먼저 거르면 안 된다 — 그러면 멀쩡한 포켓몬 150종이 샌다(위 설명).
    //       여기서는 **이름이 이미 걸린 뒤**에, 그것도 일부만 걸렸을 때만 본다.
    if (hit) {
      const 그이름 = d.ed === 'ja' ? hit.ja : hit.en
      if (그이름 && nm.replace(/\s/g, '').length > 그이름.replace(/\s/g, '').length) {
        // ⚠️ **한글 이름으로 한 번 더 본다.** 옛 세트는 원본이 영어를 가타카나로 적어
        //    놓은 것이 있다(ja-VS1의 `ブルーノのマチャンプ` — 진짜 일본명은 カイリキー).
        //    그러면 일본어 사전으로는 マチャンプ가 안 걸리고 ブルー(블루)만 걸려
        //    **괴력몬 카드가 블루 밑에** 붙는다. 우리 한글 변환기는 이미 "시바의 괴력몬"
        //    으로 옳게 바꾸므로, 한글로 다른 포켓몬이 잡히면 그쪽이 맞다.
        const ko = koCardName(d.ed, nm)
        const 한글로 = ko ? byKo.find((p) => 들었나(ko, p.ko)) : undefined
        // ⚠️ **두 포켓몬이 다 든 카드를 옮기면 안 된다.** "피카츄&제크로무 GX"는 둘 다
        //    맞는 카드다. 한글 사전은 긴 이름부터 보므로 그냥 두면 제크로무로 옮겨진다
        //    (2026-08-08 회귀 검사에서 잡음 — 태그팀 카드 27장이 그랬다).
        //    한글로 찾은 것이 **지금 것의 긴 꼴일 때만** 바꾼다(폴리곤 → 폴리곤2).
        const 긴꼴인가 = !!한글로 && 한글로.id !== hit.id && 들었나(한글로.ko, hit.ko)
        if (긴꼴인가) hit = 한글로!
        else if (ko && /[가-힣]/.test(ko) && !들었나(ko, hit.ko)) {
          // ⚠️ **한글 이름에 지금 것이 아예 없으면 일부만 걸린 것이다.**
          //    ラッキーメット → "행운의헬멧"에 "럭키"가 없다. ルアーボール → "루어볼"에
          //    "아보"가 없고, ポケモンだいすきクラブ → "포켓몬애호가클럽"에 "크랩"이 없다.
          //    한글로 다른 포켓몬이 잡히면 그쪽이 맞고(시바의 괴력몬), 없으면
          //    포켓몬 카드가 아니다. 한글로 못 옮긴 이름은 건드리지 않는다.
          if (한글로 && 한글로.id !== hit.id) hit = 한글로
          else hit = undefined
        } else {
          const 종류 = 카드종류(slug, m.id, String(c.n))
          if (종류 === 't' || 종류 === 'e') hit = undefined
        }
      }
    }
    if (!hit) {
      const 종류 = 카드종류(slug, m.id, String(c.n))
      // ⚠️ 일본판 세트인데 원문이 영문인 카드가 526장 있다(원본 오염). 제 판 사전으로만
      //    찾으면 "Pikachu ex"가 트레이너로 샌다 — 원본이 포켓몬이라고 하면 반대 판
      //    사전도 본다. 트레이너·에너지라고 하면 뒤지지 않는다(엉뚱한 매칭을 막는다).
      // ⚠️ 종류를 **모를 때도** 반대 판 사전은 본다. 일본판 ja-SV6의 원문이
      //    "Teal Mask Ogerpon ex"인데 그 세트 종류표가 없어 오거폰이 트레이너로
      //    남아 있었다(2026-08-07). 반대 판 사전은 원문이 그 언어로 오염됐을 때만
      //    걸리므로, 멀쩡한 트레이너가 새어 들어올 일이 없다. 다만 원본이 트레이너·
      //    에너지라고 못박은 카드는 건드리지 않는다.
      if (종류 !== 't' && 종류 !== 'e') {
        const 반대 = d.ed === 'ja' ? byEn : byJa
        hit = 반대.find((p) => 들었나(nm, d.ed === 'ja' ? p.en : p.ja))
        // ⚠️ 원문이 오염돼 양쪽 사전 다 못 알아보는 카드가 있다 — `バゴン（デルタ種）`은
        //    아공이인데 정식 일본명이 `タツベイ`라 안 걸린다. 그래도 **화면 이름은 이미
        //    맞다**("아공이 (델타종)"). 한글 부분일치는 트레이너를 빨아들이기 쉬우므로
        //    (“마그마단의 슈퍼볼” ← 마그마) **원본이 포켓몬이라고 한 카드에만** 쓴다.
        if (!hit && 종류 === 'p') {
          const ko = koCardName(d.ed, nm)
          if (ko) hit = byKo.find((p) => 들었나(ko, p.ko))
        }
      }
    }
    if (hit) {
      const arr = buckets.get(hit.id) ?? []
      arr.push(한장)
      buckets.set(hit.id, arr)
    } else {
      // 포켓몬이 아니면 트레이너·에너지다. 한글 이름으로 묶는다.
      const ko = koCardName(d.ed, nm)
      if (!ko) continue
      // ⚠️ 원문으로 못 알아본 **포켓몬**이 여기로 흘러든다. 옛 세트(e시리즈·PCG·neo)는
      //    TCGdex의 일본어 칸이 정식 이름 대신 영어명 가타카나로 오염돼 있어서
      //    (デンリュウ가 아니라 アンファロス) 위 대조에서 빠진다. 그대로 두면 도감에
      //    "라이츄"가 두 개 서고, 옛 카드 837장이 트레이너 쪽에 갇힌다(운영자 점검
      //    2026-08-06). 한글 이름이 포켓몬 이름과 같으면 그 포켓몬 무더기로 보낸다.
      const 같은포켓몬 = koPokemon.get(ko.replace(/[\s·]/g, ''))
      if (같은포켓몬) {
        const arr = buckets.get(같은포켓몬) ?? []
        arr.push(한장)
        buckets.set(같은포켓몬, arr)
        continue
      }
      // ⚠️ 띄어쓰기·가운뎃점만 다른 것은 같은 카드다. 그대로 두면 "체육관배지 16장"과
      //    "체육관 배지 8장"이 따로 서 있어, 찾는 사람은 둘 다 눌러 봐야 한다
      //    (운영자 지적 2026-08-06). 묶는 열쇠에서만 빼고, 보여줄 이름은 그대로 쓴다.
      // ⚠️ 대소문자도 지운다. "뮤 ex"와 "뮤 Ex"가 따로 서 있었다(운영자 점검
      //    2026-08-06). 같은 카드인데 표기만 다른 것이다.
      const key = ko.replace(/[\s·]/g, '').toLowerCase()
      const arr = trainers.get(key) ?? []
      arr.push({ ...한장, ko })
      trainers.set(key, arr)
    }
  }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// 카드 번호를 **숫자로** 견준다. 글자로 견주면 "100"이 "11"보다 앞에 서서
// 리자몽/en-xy2가 100, 107, 108, 11, 12, 13 순이 된다(2026-08-07 발견, 250개 묶음).
// 접두사가 붙은 번호("SM158"·"XY121")도 접두사가 같으면 숫자로 견준다.
export const 번호쪼개기 = (n: string) => {
  const m = String(n).match(/^([A-Za-z-]*)0*(\d+)([a-z]?)$/i)
  return m ? { 앞: m[1].toUpperCase(), 숫자: Number(m[2]), 뒤: m[3] } : null
}
export const 번호순 = (a: string, b: string) => {
  const A = 번호쪼개기(a)
  const B = 번호쪼개기(b)
  // 번호 꼴이 아니거나 접두사가 다르면 글자로 견준다 — 우리가 정할 일이 아니다.
  if (!A || !B || A.앞 !== B.앞) return String(a).localeCompare(String(b))
  return A.숫자 - B.숫자 || A.뒤.localeCompare(B.뒤)
}

// 발매일이 빈 세트는 맨 뒤로(9로 시작하는 문자열은 어떤 날짜보다 크다).
const 발매순 = (a: { date: string; s: string; n: string }, b: { date: string; s: string; n: string }) =>
  (a.date || '9').localeCompare(b.date || '9') || a.s.localeCompare(b.s) || 번호순(a.n, b.n)

// 목록 파일. 검색창이 이것만 받아 이름을 찾는다.
// t: 'p'=포켓몬 · 't'=트레이너·에너지. 화면이 어느 쪽인지 표시하는 데 쓴다.
/**
 * `cv` = 목록에 보일 **대표 카드 그림**. 작가 화면이 그렇게 하고 있어 꼴을 맞춘다.
 *
 * ⚠️ **주소를 통째로 넣으면 목록이 574KB → 981KB가 된다.** 이 파일은 화면을 열면
 *    바로 받는 것이라 두 배로 불리면 안 된다. 그림 6,400개 중 6,107개가 PPT 주소
 *    (`…/product/<번호>_in_400x400.jpg`)라 **번호만 적고 화면이 주소를 만든다** — +68KB다.
 *    PPT 주소가 아닌 293개만 주소를 그대로 적는다.
 */
const 대표그림 = (카드: { img?: string }[]): string => {
  const img = 카드.find((c) => c.img)?.img ?? ''
  const m = /tcgplayer-cdn\.tcgplayer\.com\/product\/(\d+)_/.exec(img)
  return m ? m[1] : img
}
type Row = { id: number; ko: string; en: string; c: number; t: 'p' | 't'; cv?: string }
const index: Row[] = list
  .filter((p) => (buckets.get(p.id)?.length ?? 0) > 0)
  .map((p) => ({ id: p.id, ko: p.ko, en: p.en, c: buckets.get(p.id)!.length, t: 'p', cv: 대표그림(buckets.get(p.id)!) }))

// ⚠️ 트레이너 번호는 10000부터 준다. 포켓몬 도감번호(1~1025)와 겹치면 파일이 덮인다.
//    포켓몬이 늘어도(새 세대) 10000까지는 한참 남는다.
const TRAINER_ID_BASE = 10000
const 트레이너목록 = [...trainers.entries()].sort((a, b) => b[1].length - a[1].length)
트레이너목록.forEach(([, arr], i) => {
  const id = TRAINER_ID_BASE + i
  // 영어 이름은 영문판 카드가 있으면 그 원문을 쓴다(검색을 영어로도 되게).
  const en = arr.find((c) => !c.s.startsWith('ja-'))?.name ?? ''
  // ⚠️ 보여줄 이름은 **띄어쓰기가 있는 쪽**을 고른다. 열쇠에서 띄어쓰기를 뺐더니
  //    "체육관배지"처럼 붙은 이름이 대표가 되는 일이 생겼다. 사람이 읽기엔 띄어 쓴
  //    쪽이 낫고, 붙여 쓴 것도 검색에 걸린다(찾을 때도 띄어쓰기를 무시하므로).
  // ⚠️ 대소문자를 무시하고 묶기 시작한 뒤로는 대문자 쪽이 대표가 될 수 있다
  //    ("해피너스 Ex"). ex·V·GX 같은 표기는 공식이 소문자라 그쪽이 맞다
  //    (점검 중 발견 2026-08-06). 띄어쓰기가 많은 쪽 → 그중 대문자가 적은 쪽.
  const 이름들 = [...new Set(arr.map((c) => c.ko))]
  const 띄 = (s: string) => (s.match(/[\s·]/g) ?? []).length
  const 대 = (s: string) => (s.match(/[A-Z]/g) ?? []).length
  const ko = 이름들.sort((a, b) => 띄(b) - 띄(a) || 대(a) - 대(b))[0]
  index.push({ id, ko, en, c: arr.length, t: 't', cv: 대표그림(arr) })
})
writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index))

// 하나씩. 발매 순으로 세워 둔다 — 화면에서 다시 세울 필요가 없다.
let 총장수 = 0
for (const [id, arr] of buckets) {
  arr.sort(발매순)
  총장수 += arr.length
  writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(arr))
}
트레이너목록.forEach(([, arr], i) => {
  arr.sort(발매순)
  총장수 += arr.length
  writeFileSync(path.join(OUT, `${TRAINER_ID_BASE + i}.json`), JSON.stringify(arr))
})

const size = readdirSync(OUT).reduce((n, f) => n + readFileSync(path.join(OUT, f)).length, 0)
console.log(
  `도감 ${index.length}종(포켓몬 ${index.filter((r) => r.t === 'p').length} · 트레이너 ${index.filter((r) => r.t === 't').length}) · 카드 ${총장수.toLocaleString()}장 · 파일 ${readdirSync(OUT).length}개 · ` +
    `${(size / 1024 / 1024).toFixed(1)}MB (목록 ${(readFileSync(path.join(OUT, 'index.json')).length / 1024).toFixed(0)}KB)`,
)
