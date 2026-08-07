// 저쪽(PPT)이 주는 세트 이름 → 우리 한글 세트 이름. **화면들이 이 한 벌만 쓴다.**
//
// 왜 필요한가: PPT의 세트 이름은 코드가 앞에 붙은 영문이다
// ("CP6: Expansion Pack 20th Anniversary"). 우리 영문 세트명 사전은 그대로는 못
// 알아듣는다. 다행히 **슬러그 ↔ 저쪽 이름 대조표(pptSetNames.json)** 를 이미
// 갖고 있으므로, 거꾸로 찾아 우리 세트 이름을 얻는다.
//
// 왜 따로 뺐나: 같은 대조표를 api/ebayPrices.ts가 이미 갖고 있었는데, 팝수 화면을
// 고치면서 **똑같은 것을 한 벌 더 만들었다**(2026-08-07). 그러면 언젠가 한쪽만
// 고쳐서 같은 카드가 화면마다 다른 세트 이름으로 나온다 — 이 저장소에서 이미
// 여러 번 낸 사고다([[koCardName]] · [[gradeOrder]] 참고).
//
// ⚠️ 대조표에 없는 세트는 **빈 문자열**을 준다. 부르는 쪽이 영문 그대로 두거나
//    영문 세트명 사전에 맡기면 된다 — 여기서 이름을 지어내지 않는다.
import pptSetNames from '../data/pptSetNames.json';

let 지도: Map<string, string> | null = null;

export async function pptSetKo(name: string): Promise<string> {
  if (!지도) {
    const { loadSetIndex, koSet } = await import('./cardCatalog');
    const idx = await loadSetIndex().catch(() => []);
    const 슬러그로 = new Map(idx.map((s) => [s.slug, s]));
    지도 = new Map();
    for (const [슬러그, 저쪽이름] of Object.entries(pptSetNames as Record<string, string | string[]>)) {
      const s = 슬러그로.get(슬러그);
      if (!s) continue;
      for (const n of ([] as string[]).concat(저쪽이름)) 지도.set(String(n).toLowerCase(), koSet(s.ed, s.name));
    }
  }
  return 지도.get(String(name).trim().toLowerCase()) ?? '';
}

/** 여러 개를 한 번에. 못 찾은 것은 원래 이름 그대로 남긴다. */
export async function pptSetKoMany(names: string[]): Promise<Map<string, string>> {
  const 결과 = new Map<string, string>();
  for (const n of new Set(names)) 결과.set(n, (await pptSetKo(n)) || n);
  return 결과;
}
