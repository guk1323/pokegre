// 일회성 데이터 생성 스크립트: PokeAPI에서 포켓몬 종별 한글/일본어/영어 이름을 받아
// src/data/pokemonNames.json 정적 사전으로 저장한다. 런타임에는 네트워크 호출 없이 이 파일만 사용.
import { writeFile } from 'node:fs/promises';

const TOTAL = 1025;
const CONCURRENCY = 20;

async function fetchSpecies(id) {
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
  if (!res.ok) throw new Error(`species ${id} failed: ${res.status}`);
  const data = await res.json();
  const findName = (lang) => data.names.find((n) => n.language.name === lang)?.name ?? null;
  return {
    id,
    ko: findName('ko'),
    ja: findName('ja-hrkt') ?? findName('ja'),
    en: findName('en'),
  };
}

async function main() {
  const results = new Array(TOTAL);
  let cursor = 1;

  async function worker() {
    while (cursor <= TOTAL) {
      const id = cursor++;
      let attempt = 0;
      while (attempt < 3) {
        try {
          results[id - 1] = await fetchSpecies(id);
          break;
        } catch (err) {
          attempt++;
          if (attempt >= 3) {
            console.error(`skip ${id}:`, err.message);
          } else {
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const entries = results.filter((r) => r && r.ko && r.ja);
  console.log(`fetched ${entries.length}/${TOTAL} species with ko+ja names`);

  await writeFile(
    new URL('../src/data/pokemonNames.json', import.meta.url),
    JSON.stringify(entries),
  );
}

main();
