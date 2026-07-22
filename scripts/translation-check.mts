// 번역 점검: SNKRDUNK 카드명을 대량 수집 → koreanizeTitle 후 CJK(일본어) 잔여를 찾는다.
// 잔여 조각을 빈도순으로 뽑아, 사전에 추가할 매핑 후보를 본다. 일회성 스크립트.
import { koreanizeTitle } from '../src/lib/koreanizeTitle.ts'

const KW = [
  'リザードン', 'ピカチュウ', 'イーブイ', 'ミュウ', 'ミュウツー', 'ルギア', 'レックウザ',
  'ゲッコウガ', 'ガブリアス', 'ミミッキュ', 'ニンフィア', 'ブラッキー', 'カメックス', 'フシギバナ',
  'プロモ', 'トレーナー', 'エネルギー', 'スペシャルデッキ', '拡張パック', '強化拡張パック',
  'ハイクラスパック', 'デッキビルドボックス', '対戦', 'キャンペーン', 'ナンジャモ', 'マリィ',
  // 2차: 다른 세대·유형으로 넓힘
  'ホップ', 'ソニア', 'ダンデ', 'サーナイト', 'ルカリオ', 'ゾロアーク', 'カイリュー', 'バンギラス',
  'ギラティナ', 'ディアルガ', 'パルキア', 'ホウオウ', 'カイオーガ', 'グラードン', 'アルセウス',
  'コライドン', 'ミライドン', 'テラスタル', 'イーブイヒーローズ', 'VSTARユニバース', '旧裏',
  'ポケモンセンター', '記念', '限定', 'チャンピオンズ', 'サポート', 'グッズ', 'スタジアム',
]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const titles = new Set<string>()

for (const kw of KW) {
  for (let page = 1; page <= 4; page++) {
    try {
      const u = `https://snkrdunk.com/v3/search?func=all&refId=search&keyword=${encodeURIComponent(kw)}&sortKey=default&cardVersion=2&brandIds=pokemon&perPage=100&page=${page}`
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } })
      const j: any = await r.json()
      const p = j.search?.products?.length ? j.search.products : (j.search?.rankingProducts ?? [])
      if (!p.length) break
      for (const x of p) if (x.title) titles.add(x.title)
    } catch {
      /* skip */
    }
    await sleep(250)
  }
  process.stderr.write(`${kw}: 누적 ${titles.size}\n`)
}

const CJK = /[぀-ヿ㐀-䶿一-鿿]/
const frag = /[぀-ヿ㐀-䶿一-鿿]+/g
const leftover = new Map<string, number>()
const examples = new Map<string, { raw: string; ko: string }>()
let checked = 0
let withCJK = 0
for (const t of titles) {
  const ko = koreanizeTitle(t)
  checked++
  if (!CJK.test(ko)) continue
  withCJK++
  for (const m of ko.match(frag) ?? []) {
    leftover.set(m, (leftover.get(m) ?? 0) + 1)
    if (!examples.has(m)) examples.set(m, { raw: t, ko })
  }
}
console.log(`\n검사 ${checked}개 · CJK잔여 있는 카드 ${withCJK}개`)
console.log('=== 잔여 조각(빈도순 상위 45) ===')
for (const [f, n] of [...leftover.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45)) {
  const ex = examples.get(f)!
  console.log(`  ${n}회  「${f}」  예: ${ex.raw.slice(0, 42)} → ${ex.ko.slice(0, 42)}`)
}
