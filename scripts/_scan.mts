import { readdir, readFile } from 'node:fs/promises';
import { koreanizeTitle } from '../src/lib/koreanizeTitle';
import { kanaToHangul } from '../src/lib/kanaToHangul';

// 히라가나는 일본어 낱말이라 "뜻"으로 옮겨야 한다(가타카나는 이름·외래어라 음역이 맞다).
// 변환 결과가 음역기(kanaToHangul)와 똑같으면 = 사전에 없어서 소리만 옮긴 것이다.
const files = (await readdir('public/sets')).filter((f) => f.endsWith('.json') && !['index.json', 'ko-index.json'].includes(f));
const hits = new Map<string, { ko: string; n: number; ex: Set<string> }>();

for (const f of files) {
  let j: any;
  try { j = JSON.parse(await readFile('public/sets/' + f, 'utf-8')); } catch { continue }
  if ((j.ed ?? (f.startsWith('ja-') ? 'ja' : 'en')) !== 'ja') continue;
  for (const c of j.cards ?? []) {
    const src: string = c.name ?? '';
    const out = koreanizeTitle(src);
    for (const run of src.match(/[ぁ-ん]{2,}/g) ?? []) {
      const ko = koreanizeTitle(run);
      const translit = kanaToHangul(run);
      // 음역과 같고, 그게 최종 이름에 그대로 박혀 있으면 뜻이 안 옮겨진 것.
      if (ko === translit && /^[가-힣]+$/.test(ko) && out.includes(ko)) {
        const v = hits.get(run) ?? { ko, n: 0, ex: new Set<string>() };
        v.n++; if (v.ex.size < 2) v.ex.add(out.slice(0, 34));
        hits.set(run, v);
      }
    }
  }
}
const list = [...hits.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(`뜻이 안 옮겨지고 소리만 남은 것: ${list.length}종 / ${list.reduce((s, [, v]) => s + v.n, 0)}건\n`);
for (const [src, v] of list) console.log(`  ${src.padEnd(12)} → ${v.ko.padEnd(13)} ${String(v.n).padStart(3)}건  ${[...v.ex].join(' , ')}`);
