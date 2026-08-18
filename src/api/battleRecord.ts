// 포켓몬 디펜스 시즌1 — **계정에 붙는 기록**.
//
// ⚠️⚠️ **게임은 로그인 없이도 다 된다.** 로그인한 사람만 기록이 계정에 남는다
//    (사장님 2026-08-18: "비로그인 로그인 다 가능하게는 해줘 근데 로그인한 회원은 기록을 써주자").
//    그래서 이 파일의 함수는 **실패해도 조용하다** — 게임이 멈추면 안 된다.
//
// ⚠️⚠️ 길이 `/api/local/auth/…` 밑이다 — 계정에 붙는 것은 전부 거기 산다(즐겨찾기·카드 뽑기와 한자리).
//    `/api/local/battle`로 부르면 **404**다(2026-08-18에 그렇게 짰다가 바로 잡았다).
//
// ⚠️ 담는 것은 「판이름 → 최고 별」뿐이다. 깬 판은 별이 1 이상인 것으로 안다
//    (깬 목록을 따로 두면 둘이 어긋날 자리가 생긴다).

export interface 디펜스기록 {
  /** 서버가 이 요청을 로그인한 사람으로 봤나. 화면에 「기록이 남는다」를 알릴 때 쓴다. */
  로그인: boolean;
  stars: Record<string, number>;
}

const 빈것: 디펜스기록 = { 로그인: false, stars: {} };

/**
 * 내 기록을 받아 온다. 로그인 안 했으면 `{로그인:false, stars:{}}`가 온다(오류 아님).
 * ⚠️ 서버가 죽어 있어도 게임은 돌아야 하므로 **빈 것**을 돌려준다.
 */
export async function 기록받기(): Promise<디펜스기록> {
  try {
    const r = await fetch('/api/local/auth/battle', { credentials: 'include' });
    if (!r.ok) return 빈것;
    const v = (await r.json()) as 디펜스기록;
    return { 로그인: !!v.로그인, stars: v.stars ?? {} };
  } catch {
    return 빈것;
  }
}

/**
 * 내 기록을 **합쳐** 올린다(덮어쓰지 않는다). 서버가 별을 `max`로 남긴다.
 * ⚠️ 비로그인이면 서버가 조용히 넘긴다 — 화면이 로그인 여부를 안 따져도 된다.
 */
export async function 기록올리기(stars: Record<string, number>): Promise<디펜스기록> {
  try {
    const r = await fetch('/api/local/auth/battle', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stars }),
    });
    if (!r.ok) return 빈것;
    const v = (await r.json()) as 디펜스기록;
    return { 로그인: !!v.로그인, stars: v.stars ?? {} };
  } catch {
    return 빈것;
  }
}

/**
 * 두 별 표를 합친다 — **큰 쪽이 남는다.**
 * ⚠️⚠️ 이 규칙이 서버와 같아야 한다. 한쪽만 고치면 기기를 옮길 때마다 별이 오르내린다.
 */
export function 별합치기(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const 나온것: Record<string, number> = { ...a };
  for (const [이름, 별] of Object.entries(b)) {
    if ((나온것[이름] ?? 0) < 별) 나온것[이름] = 별;
  }
  return 나온것;
}

/**
 * 계정 기록을 지운다.
 * ⚠️⚠️ **로컬만 지우면 안 된다** — 다음에 켤 때 서버에서 도로 받아 와 되살아난다.
 *    「깬 기록 지우기」는 반드시 이것도 같이 불러야 한다.
 */
export async function 기록지우기(): Promise<void> {
  try {
    await fetch('/api/local/auth/battle', { method: 'DELETE', credentials: 'include' });
  } catch {
    /* 서버가 죽어 있어도 로컬은 지워진다 */
  }
}
