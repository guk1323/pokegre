// 새 시세 길 — 「카드가 먼저, 값이 나중」 (2026-08-12)
//
// ⚠️⚠️ **옛 길(ebayPrices.ts)을 대신하는 게 아니라 옆에 새로 깐 길이다**(사장님 지시:
//    "기존꺼에 덧붙이지 말고 새로운 토글 만들어서"). 둘을 나란히 켜 두고 견준 뒤에
//    무엇을 남길지 정한다. 그래서 옛 파일은 한 줄도 안 건드렸다.
//
// 무엇이 다른가:
//   옛 길 — 저쪽(PPT)에 **매물을 물어본다.** 매물 제목이 재료라 뒤처리가 겹겹이 붙는다
//           (제목 뜯기·조각 잇기·옮겨쌓기·세트 대응표). 크레딧을 쓰고 1~28초가 걸렸다.
//   새 길 — **우리 도감에서 카드를 먼저 고른다.** 카드가 정해지면 그 카드의 PPT 번호로
//           받아 둔 덤프에서 값을 꺼내면 끝이다. **크레딧 0 · 0.02초.**
//
// 내주는 꼴은 옛 길과 **똑같다**(EbayCard) — 화면 부품을 그대로 쓰라는 지시였다.
import type { EbayCard, EbayGradeStat } from './ebayPrices';

/** 새 길이 더 주는 칸. 옛 길에는 없어서 옵션으로 얹는다. */
export interface BoardCard extends EbayCard {
  /**
   * 목록에 실린 등급이 **대표 하나로 잘려 있다**는 표시.
   *
   * ⚠️ 카드 하나에 등급이 최대 17줄인데 목록 타일은 **한 줄만** 보여 준다. 다 실어
   *    보내면 안 쓰는 것이 덩치의 83%라, 그만큼 적게 낼 수밖에 없었다(그래서 12장이었다).
   *    지금은 목록에 대표만 싣고 **카드를 누를 때 나머지를 받아 온다**(크레딧 0 · 10ms).
   */
  gradesTrimmed?: boolean;
  /**
   * 카드를 열어 **등급 전부·추이·낱개 낙찰까지 채운** 카드라는 표시.
   * ⚠️ `gradesTrimmed`만 보면 안 된다 — 등급이 원래 하나뿐인 카드는 잘린 적이 없어
   *    그 값이 false라, 열 때마다 추이를 다시 받으러 간다(크레딧이 새는 자리).
   */
  채워짐?: boolean;
  /** 감정 수량(PSA·CGC·BGS·SGC 합산). 옛 길은 카드를 열어야 나왔다. */
  population?: { psa10?: number; psa9?: number; psaAll?: number; all: number; gem?: number } | null;
  /** 우리 도감 세트 slug. 값이 없는 카드도 여기서 왔음을 밝히는 데 쓴다. */
  slug?: string;
}

export interface BoardResult {
  /**
   * 찾은 카드 **전부**. ⚠️ **쪽을 안 나눈다.**
   *
   * 옛 길이 12장씩 끊어 「더 보기」를 둔 것은 한 쪽마다 크레딧 36이 나가고 저쪽이
   * 12장씩만 주기 때문이다. 우리 파일만 읽는 이 길에는 그 이유가 하나도 없다 —
   * 쪽 나누기 자체가 베낀 것이었다(사장님 지적 2026-08-12).
   */
  cards: BoardCard[];
  /** 검색어에 걸린 전체 장수. `cards.length`와 다르면 천장에 걸려 잘린 것이다. */
  total: number;
  /** 천장에 걸려 잘랐을 때 그 천장 값(안 잘렸으면 0/없음). 말없이 자르면 「이게 전부」로 읽힌다. */
  잘림?: number;
  /** 재료를 받아 온 날(UTC). 값이 언제 것인지 밝히려고 같이 준다. */
  받은날?: { 시세: string | null; 낙찰: string | null; 팝수: string | null };
}

/** 카드를 열 때 채워지는 것들. */
export interface BoardDetail {
  /** 등급 전부. **추이(history)와 낱개 낙찰(sales)까지** 채워져 온다. */
  grades: EbayGradeStat[];
  /** TCGplayer 추이. `condition`은 어느 상태의 추이인지 — 큰 숫자와 다르면 제목에 밝힌다. */
  tcgHistory: { condition: string | null; history: { date: string; price: number }[] } | null;
  /**
   * 감정 수량. 덤프에 있으면 그것, 없으면 서버가 카드를 열 때 받아 쌓아 둔 것.
   * ⚠️ 이게 오므로 화면은 옛 길의 `card-extra`를 **안 부른다.**
   */
  population: BoardCard['population'];
}

/**
 * 카드 한 장을 열 때 부른다. 세 가지를 한 번에 채운다:
 *   ① 등급 전부(목록에는 대표 하나만 실려 있다)
 *   ② 등급별 **날짜별 낙찰 추이** — 그래프의 재료
 *   ③ 등급별 **낱개 낙찰**(날짜·값·제목·이베이 링크)
 *
 * ⚠️ ②③은 덤프에 없어서 저쪽에 물어야 나온다. 서버가 **한 번 받으면 쌓아 두고 이레 동안
 *    다시 안 묻는다** — 그래서 이미 본 카드는 크레딧 0이다(server의 `카드기록받기`).
 */
export async function fetchBoardDetail(
  tcgPlayerId: string,
  edition: 'japanese' | 'english' | 'other',
  signal?: AbortSignal,
  /**
   * **등급표만 달라**(추이·낱개는 빼고). 비교 담기가 쓴다 — 비교표는 등급표만 그리는데
   * 추이·낱개는 저쪽에 물어야 나와 처음 보는 카드면 3크레딧이다. 켜면 **크레딧 0.**
   */
  등급만?: boolean,
): Promise<BoardDetail> {
  const p = new URLSearchParams({ grades: tcgPlayerId, lang: edition });
  if (등급만) p.set('grades만', '1');
  const r = await fetch(`/api/local/card-board?${p}`, { signal });
  if (!r.ok) throw new Error(`card-board grades ${r.status}`);
  const j = (await r.json()) as Partial<BoardDetail>;
  return { grades: j.grades ?? [], tcgHistory: j.tcgHistory ?? null, population: j.population ?? null };
}

export async function searchCardBoard(
  query: string,
  edition: 'japanese' | 'english' | 'other',
  signal?: AbortSignal,
  /** 도감·세트·작가에서 눌러서 온 그 카드. 주면 맨 앞에 세워 준다(형제 카드도 같이 나온다). */
  콕?: { slug: string; no: string } | null,
): Promise<BoardResult> {
  const p = new URLSearchParams({ q: query, lang: edition });
  if (콕?.slug) {
    p.set('slug', 콕.slug);
    p.set('no', 콕.no);
  }
  const r = await fetch(`/api/local/card-board?${p}`, { signal });
  if (!r.ok) throw new Error(`card-board ${r.status}`);
  return (await r.json()) as BoardResult;
}
