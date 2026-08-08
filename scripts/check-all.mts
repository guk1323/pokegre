/**
 * 자료가 섞이지 않았는지 한 번에 훑는다. **바깥에 아무것도 안 부른다** — 크레딧도 0.
 *
 * 왜 묶었나 — 2026-08-08 하루에만 자료가 섞이는 곳을 다섯 군데 찾았다. 하나를 고치면
 * 다른 곳이 조용히 깨지는 일이 반복돼서(래디언트 컬렉션이 그랬다), 손댈 때마다 전부
 * 다시 돌려 봐야 한다.
 *
 * 실행:
 *   node --experimental-strip-types scripts/check-all.mts               ← 우리 자료만
 *   node --experimental-strip-types scripts/check-all.mts <cards.csv>   ← 저쪽 덤프와도 대조
 *
 * ⚠️ 여기 나오는 숫자가 0이 아니라고 무조건 문제는 아니다. 각 검사기 머리말에 "이건
 *    정상"이라고 적어 둔 것들이 있다(무장조 겹침 1건 · 도감 갈래 몇 건 등).
 *    **숫자가 늘어났는지**를 본다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = process.argv[2]

const 우리것 = [
  ['우리 세트 자료', 'check-set-data.mts'],
  ['작가 자료', 'check-artist-cards.mts'],
  ['이름이 겹치는 카드', 'check-dup-card-names.mts'],
  ['도감 갈래', 'check-card-facts.mts'],
  ['사전이 규칙을 덮나', 'check-rule-override.mts'],
  ['사전끼리 어긋나나', 'check-name-conflicts.mts'],
  ['번호 별칭이 딴 카드를 가리키나', 'check-alias-better-match.mts'],
]
const 덤프것 = [
  ['세트 대조표', 'check-set-mapping.mts'],
  ['번호 별칭표', 'check-number-alias.mts'],
  ['레어도 대조', 'check-rarity-pairs.mts'],
]

let 실패 = 0
for (const [이름, 파일] of [...우리것, ...(CSV ? 덤프것 : [])]) {
  const 길 = join(ROOT, 'scripts', 파일)
  if (!existsSync(길)) {
    console.log(`\n■ ${이름} — 검사기가 없다(${파일})`)
    실패++
    continue
  }
  // ⚠️ koreanize*.ts 를 가져오는 검사기는 node 로 못 돈다(확장자 없는 import). tsx 로 돌린다.
  const tsx = /koreanize/.test(readFileSync(길, 'utf-8'))
  const r = tsx
    ? spawnSync('npx', ['tsx', 길, ...(CSV ? [CSV] : [])], { cwd: ROOT, encoding: 'utf-8' })
    : spawnSync(process.execPath, ['--experimental-strip-types', 길, ...(CSV ? [CSV] : [])], {
        cwd: ROOT,
        encoding: 'utf-8',
      })
  const 줄 = String(r.stdout ?? '')
    .split('\n')
    .filter((x) => x.trim() && !/ExperimentalWarning|--experimental|^\(Use `node/.test(x))
  console.log(`\n■ ${이름}`)
  for (const x of 줄.slice(0, 4)) console.log('  ' + x)
  if (r.status !== 0 && r.status !== null) {
    console.log(`  ⚠️ 끝내지 못했다(코드 ${r.status})`)
    console.log('  ' + String(r.stderr ?? '').split('\n').slice(0, 3).join('\n  '))
    실패++
  }
}
if (!CSV) {
  console.log('\n(덤프와 대조하려면: node --experimental-strip-types scripts/check-all.mts <cards.csv>)')
}
console.log(실패 ? `\n못 돌린 검사 ${실패}개` : '\n검사 전부 돌았다.')
process.exit(실패 ? 1 : 0)
