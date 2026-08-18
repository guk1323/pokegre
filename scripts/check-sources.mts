/**
 * **배포 전 점검 — 소스 × 판 조합을 전부 돌린다.**
 *
 * ⚠️ **200이 뜨나만 보면 못 찾는다**(사장님 지적). 어제 받은 값이 오늘 화면에 나오는지를
 *    봐야 한다 — 이름이 한글인가 · 값이 붙어 있나 · 날짜가 최근인가 · 세트 이름이 있나.
 *
 * 도는 곳: 스니커덩크(일) · 이베이(일/북미) · 티피(일/북미) + 도감 찾기.
 * ⚠️ 이베이 **한글판은 2026-08-10에 뺐다** — 여기서도 안 본다.
 * 한 축만 보면 다른 축이 조용히 깨진다.
 *
 * 먼저 서버를 띄운 뒤 실행한다(npm run dev). 크레딧은 캐시가 비었을 때만 든다(검색당 18~36).
 *   npm run 소스점검
 */
const 밑 = 'http://localhost:5173'
const 잔 = async (p: string) => {
  const r = await fetch(밑 + p)
  return { 상태: r.status, j: r.ok ? await r.json() : null }
}
let 나쁨 = 0
const 봐 = (이름: string, 참: boolean, 덧: string) => {
  console.log(`  ${참 ? '○' : '✗'} ${이름.padEnd(24)} ${덧}`)
  if (!참) 나쁨++
}
const 최근인가 = (d: string) => {
  const t = Date.parse(d)
  return Number.isFinite(t) && Date.now() - t < 400 * 864e5
}

// ── ① 스니커덩크 (일본판) ────────────────────────────────────────────────────
console.log('\n① 스니커덩크 · 일본판')
{
  // ⚠️ 파라미터·필드 이름은 **화면이 쓰는 것 그대로**여야 한다(src/api/snkrdunk.ts).
  //    내가 임의로 지어 쓰다가 400을 받고 "스니커덩크가 죽었나" 했다.
  const q = new URLSearchParams({ func: 'all', refId: 'search', keyword: 'リザードン', sortKey: 'default', cardVersion: '2', brandIds: 'pokemon', perPage: '6', page: '1' })
  const { 상태, j } = await 잔('/api/snkrdunk/v3/search?' + q)
  const list = j?.search?.products ?? j?.search?.rankingProducts ?? []
  봐('응답', 상태 === 200 && list.length > 0, `상태 ${상태} · ${list.length}장`)
  const 값있음 = list.filter((x: { salePrice?: number }) => (x.salePrice ?? 0) > 0).length
  봐('값이 붙어 있나', 값있음 === list.length, `${값있음}/${list.length}장에 값`)
  console.log(`     예: ${String(list[0]?.title ?? '?').slice(0, 46)} · ¥${list[0]?.salePrice ?? 0}`)
}

// ── ②③ 해외 시세(eBay · TCGplayer) × 일본판 · 북미판 ────────────────────────
//
// ⚠️⚠️ **2026-08-13에 새 길로 옮겼다.** 예전에는 `/api/local/card-prices`(저쪽에 매물을
//    물어보던 옛 길)를 두드렸는데, 그 길을 지우면서 이 점검이 통째로 터졌다
//    (`<!doctype html>`을 JSON으로 읽으려다 죽었다).
//    지금은 시세도 팝수도 전부 `/api/local/card-board` 하나를 쓴다 — **크레딧 0**이라
//    점검을 몇 번 돌려도 값이 안 나간다(옛 점검은 한 번에 36크레딧이었다).
for (const [판이름, lang] of [
  ['일본판', 'japanese'],
  ['북미판', 'english'],
] as const) {
  console.log(`\n해외 시세 · ${판이름}`)
  const t = Date.now()
  const { 상태, j } = await 잔(`/api/local/card-board?q=${encodeURIComponent('리자몽')}&lang=${lang}`)
  const cards = j?.cards ?? []
  봐('응답', 상태 === 200 && cards.length > 0, `상태 ${상태} · ${cards.length}장 · ${Date.now() - t}ms`)
  if (!cards.length) continue
  // ⚠️ **첫 장으로만 보면 안 된다.** 값이 붙는 카드는 목록 전체에 흩어져 있다 —
  //    첫 장이 마침 값 없는 프로모면 「다 깨졌다」로 잘못 읽는다.
  const 등급있음 = cards.filter((x: { grades?: unknown[] }) => (x.grades?.length ?? 0) > 0).length
  const 티피있음 = cards.filter((x: { tcgplayer?: { market?: number } }) => (x.tcgplayer?.market ?? 0) > 0).length
  const 팝수있음 = cards.filter((x: { population?: { all?: number } }) => (x.population?.all ?? 0) > 0).length
  봐('등급별 낙찰이 붙나', 등급있음 > 0, `${등급있음}/${cards.length}장`)
  봐('TCGplayer 마켓가가 붙나', 티피있음 > 0, `${티피있음}/${cards.length}장`)
  봐('감정 수량이 붙나', 팝수있음 > 0, `${팝수있음}/${cards.length}장`)
  봐('세트 이름이 한글인가', cards.every((x: { setName?: string }) => !!x.setName), `예: ${cards[0].name} · ${cards[0].setName}`)
  // ⚠️ 「사진 없음」 회색 타일이 늘어나는 것을 여기서 잡는다. 옛 길에서 53%까지 갔던 자리다.
  const 사진없음 = cards.filter((x: { imageUrl?: string }) => !x.imageUrl).length
  봐('사진이 다 붙나', 사진없음 === 0, `사진 없는 카드 ${사진없음}장`)
}

// ── ④ 도감으로 찾기(크레딧 0) ────────────────────────────────────────────────
console.log('\n④ 도감으로 찾기 · 크레딧 0')
for (const [판이름, lang, q] of [
  ['일본판', 'japanese', '리자몽'],
  ['북미판', 'english', '리자몽'],
  ['일본판', 'japanese', '박사의 연구'],
] as const) {
  const { 상태, j } = await 잔(`/api/local/card-lookup?q=${encodeURIComponent(q)}&lang=${lang}&limit=6`)
  const cards = j?.cards ?? []
  봐(`${판이름} "${q}"`, 상태 === 200 && cards.length > 0, `${cards.length}장 · 예: ${cards[0]?.ko ?? '?'} (${cards[0]?.setKo ?? '?'})`)
  const 한글 = cards.filter((x: { ko?: string }) => /[가-힣]/.test(String(x.ko ?? ''))).length
  봐('  이름이 한글인가', 한글 === cards.length, `${한글}/${cards.length}장`)
  const 그림 = cards.filter((x: { img?: string }) => !!x.img).length
  봐('  그림이 있나', 그림 === cards.length, `${그림}/${cards.length}장`)
}

console.log(나쁨 ? `\n✗ ${나쁨}가지가 걸렸습니다\n` : '\n○ 전부 통과했습니다\n')
