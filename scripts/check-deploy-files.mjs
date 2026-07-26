// 배포 이미지에 빠진 파일이 없는지 검사한다.
//
// 배포 이미지에는 dist와 server만 들어가고, server가 src에서 가져다 쓰는 파일은
// Dockerfile에 손으로 한 줄씩 적어 복사한다. 이 목록과 실제 import가 어긋나면
// 빌드는 멀쩡히 통과하고 배포도 성공한 것처럼 보이는데, 서버가 뜨자마자
// ERR_MODULE_NOT_FOUND로 죽어서 사이트가 502가 된다(2026-07-25에 실제로 겪음).
//
// 사람이 기억으로 맞추는 대신, server에서 시작해 import를 따라가며 src 안에서 실제로
// 필요한 파일을 모두 모으고 Dockerfile의 COPY 목록과 대조한다.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const IMPORT_RE = /(?:from|import)\s+['"]([^'"]+)['"]/g;

// import 경로를 실제 파일로 바꾼다. 확장자를 생략했거나 .js로 적은 경우까지 받아준다.
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // 패키지는 node_modules에서 온다
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, 'index.ts')];
  return candidates.find((c) => existsSync(c) && !c.endsWith(path.sep)) ?? null;
}

// server에서 출발해 import를 따라가며 src 아래에서 필요한 파일을 모은다.
function collectNeededSrcFiles(entryFiles) {
  const seen = new Set();
  const needed = new Set();
  const queue = [...entryFiles];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf-8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, m[1]);
      if (!target) continue;
      const rel = path.relative(ROOT, target);
      if (rel.startsWith(`src${path.sep}`)) needed.add(rel);
      queue.push(target);
    }
  }
  return needed;
}

const serverFiles = ['server/index.ts', 'server/api.ts'].map((f) => path.resolve(ROOT, f));
const needed = collectNeededSrcFiles(serverFiles);

const dockerfile = readFileSync(path.resolve(ROOT, 'Dockerfile'), 'utf-8');
// 최종 이미지 단계에서 COPY로 넣는 src 파일 목록.
const copied = new Set(
  [...dockerfile.matchAll(/^COPY\s+(.+)$/gm)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((p) => p.startsWith('src/')),
);

const missing = [...needed].filter((rel) => {
  const unix = rel.split(path.sep).join('/');
  // 파일 그대로 적었거나, 그 파일이 든 폴더를 통째로 복사했으면 통과.
  return ![...copied].some((c) => c === unix || (c.endsWith('/') && unix.startsWith(c)));
});

if (missing.length) {
  console.error('\n배포 이미지에 빠진 파일이 있습니다. 이대로 배포하면 서버가 뜨자마자 죽습니다.\n');
  for (const m of missing) console.error(`  - ${m}`);
  console.error('\nDockerfile의 COPY 줄에 위 파일을 추가하세요. 예:');
  console.error(`  COPY ${missing.join(' ')} ./src/lib/\n`);
  process.exit(1);
}

console.log(`배포 파일 검사 통과 — server가 쓰는 src 파일 ${needed.size}개가 모두 이미지에 들어갑니다.`);
