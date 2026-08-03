import { readFileSync, writeFileSync } from 'node:fs'
const lines = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => l.split('\t'))
const bad: string[][] = []
let i = 0
async function worker() {
  while (i < lines.length) {
    const [slug, n, url] = lines[i++]
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-0' } })
      if (!r.ok) bad.push([slug, n, url])
    } catch { bad.push([slug, n, url]) }
  }
}
await Promise.all(Array.from({ length: 20 }, worker))
const by: Record<string, number> = {}
for (const [s] of bad) by[s] = (by[s] ?? 0) + 1
console.log(`${lines.length}개 중 안 열리는 것 ${bad.length}개`)
Object.entries(by).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`  ${s.padEnd(15)} ${n}개`))
writeFileSync(process.argv[3], bad.map((b) => b.join('\t')).join('\n'))
