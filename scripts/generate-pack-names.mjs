// 일회성 데이터 생성 스크립트: pokecardmon.com이 정리해둔 일본판 박스/팩의
// 한글 번역명을 긁어와 src/data/packNames.json 정적 사전으로 저장한다.
// (pokecardmon도 SNKRDUNK CDN 이미지를 그대로 쓰는 걸 보면 같은 세트 코드
// 체계를 공유하는 것으로 보여, 세트 코드 기준으로 매칭이 가능하다.)
import { writeFile } from 'node:fs/promises';

const BASE = 'https://pokecardmon.com/ko?market=JP&page=';
const MAX_PAGES = 24;

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 번역이 없는 박스는 box-subname div 자체가 생략되어 있다. 이전에 정규식
// matchAll로 전체를 훑으면 그 다음 카드의 이름을 잘못 끌어오는 버그가 있어서,
// <a class="box-card"...> 단위로 먼저 잘라 각 조각 안에서만 값을 뽑는다.
function parseBoxCards(html) {
  const chunks = html.split('<a class="box-card"').slice(1);
  const entries = [];

  for (const chunk of chunks) {
    const hrefMatch = chunk.match(/href="\/ko\/box\/([^"?]+)\?market=JP"/);
    const nameMatch = chunk.match(/<div class="box-name">([^<]+)<\/div>/);
    const subnameMatch = chunk.match(/<div class="box-subname">([^<]*)<\/div>/);
    if (!hrefMatch || !nameMatch || !subnameMatch || !subnameMatch[1]) continue;
    entries.push({
      code: hrefMatch[1],
      ja: decodeEntities(nameMatch[1]),
      ko: decodeEntities(subnameMatch[1]),
    });
  }

  return { rawCount: chunks.length, entries };
}

async function fetchPage(page) {
  const res = await fetch(`${BASE}${page}`);
  if (!res.ok) throw new Error(`page ${page} failed: ${res.status}`);
  const html = await res.text();
  return parseBoxCards(html);
}

async function main() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const { rawCount, entries } = await fetchPage(page);
      if (rawCount === 0) break;
      all.push(...entries);
      console.log(`page ${page}: ${entries.length}/${rawCount} entries have Korean names`);
    } catch (err) {
      console.error(`page ${page} error:`, err.message);
    }
  }

  const seen = new Map();
  for (const entry of all) {
    seen.set(entry.code.toUpperCase(), entry);
  }
  const unique = [...seen.values()];
  console.log(`total unique pack codes: ${unique.length}`);

  await writeFile(
    new URL('../src/data/packNames.json', import.meta.url),
    JSON.stringify(unique),
  );
}

main();
