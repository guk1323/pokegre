/**
 * PPT 덤프(export-cards.csv)에서 **세트 이름 전부**를 뽑아 src/data/pptSetList.json에 적는다.
 *
 * 왜 따로 두나 — pptSetNames.json은 "우리 세트 슬러그 ↔ 저쪽 이름" 대조표라 우리가 화면에
 * 가진 세트만 들어 있다(332개). 그런데 저쪽 덤프에는 세트가 654개 있고, 덤프 카드의
 * **29%(16,962장)가 대조표에 없는 세트**다(2026-08-08 실측).
 *
 * 이 목록이 하는 일은 하나다 — **낙찰 제목이 딴 세트 이름을 적었는지 알아보는 것**
 * (server/api.ts의 긴형제 참고). 그러려면 우리가 화면에 안 가진 세트도 알아야 한다.
 * "Expansion Pack"에 섞인 "CP6: Expansion Pack 20th Anniversary"처럼, 섞여 들어오는
 * 쪽은 대개 우리가 안 가진 세트다.
 *
 * 다시 만들려면 (덤프를 받은 날에):
 *   node --experimental-strip-types scripts/gen-ppt-set-list.mts /data/export-cards.csv
 */
import { readFile, writeFile } from 'node:fs/promises'

const 파일 = process.argv[2] ?? '/data/export-cards.csv'

// 따옴표 안의 쉼표를 살려서 한 줄을 칸으로 쪼갠다.
function 칸쪼개기(줄: string): string[] {
  const 칸: string[] = []
  let 지금 = ''
  let 따옴표 = false
  for (let i = 0; i < 줄.length; i++) {
    const c = 줄[i]
    if (c === '"') {
      if (따옴표 && 줄[i + 1] === '"') {
        지금 += c
        i++
      } else 따옴표 = !따옴표
    } else if (c === ',' && !따옴표) {
      칸.push(지금)
      지금 = ''
    } else 지금 += c
  }
  칸.push(지금)
  return 칸
}

const 줄들 = (await readFile(파일, 'utf-8')).split('\n')
const 머리 = 칸쪼개기(줄들[0])
const iSet = 머리.indexOf('setName')
if (iSet < 0) throw new Error('setName 칸이 없습니다: ' + 머리.join(','))

const 셈 = new Map<string, number>()
for (let i = 1; i < 줄들.length; i++) {
  if (!줄들[i].trim()) continue
  const s = 칸쪼개기(줄들[i])[iSet]?.trim()
  if (s) 셈.set(s, (셈.get(s) ?? 0) + 1)
}

const 목록 = [...셈.keys()].sort((a, b) => a.localeCompare(b))
await writeFile(
  new URL('../src/data/pptSetList.json', import.meta.url),
  JSON.stringify(목록, null, 0) + '\n',
)
console.log(`세트 이름 ${목록.length}개를 src/data/pptSetList.json에 적었습니다(카드 ${[...셈.values()].reduce((a, b) => a + b, 0).toLocaleString()}장 기준).`)
