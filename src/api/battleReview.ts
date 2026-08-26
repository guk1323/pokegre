// 포켓몬 디펜스 — **게임평**.
//
// ⚠️⚠️ **읽기는 누구나 · 쓰기는 로그인 · 지우기는 운영자**(사장님 2026-08-18).
//    처음에는 「별 36개 만점인 사람만」이었는데 걷어냈다 — "남이 쓴 게 보여야 다음 사람도 쓴다".
//    자격이 헐거워진 만큼 **막는 것들이 더 중요하다**(200자·하루 한 번·같은 글·링크).
// ⚠️ **회원번호는 답에 안 실린다.** 보이는 이름은 사람이 직접 적은 것뿐이다.
// ⚠️ 길은 `/api/local/auth/…` 밑이다. 계정에 붙는 것은 전부 거기 산다.

export interface 게임평 {
  id: string;
  at: number;
  이름: string;
  글: string;
  별: number;
}

export interface 게임평상태 {
  로그인: boolean;
  /** 서버가 아는 내 별 합계. **자격에는 안 쓴다** — 글 옆에 보이는 값이다. */
  별: number;
  쓸수있나: boolean;
  운영자: boolean;
  /** 누구에게나 온다(최근 100개). */
  목록: 게임평[];
}

const 빈것: 게임평상태 = { 로그인: false, 별: 0, 쓸수있나: false, 운영자: false, 목록: [] };

/** 들어온 게임평 + 내가 쓸 수 있나. 서버가 죽어 있어도 게임은 돌아야 하므로 빈 것을 준다. */
export async function 게임평받기(): Promise<게임평상태> {
  try {
    const r = await fetch('/api/local/auth/battle-review', { credentials: 'include' });
    if (!r.ok) return 빈것;
    const v = (await r.json()) as Partial<게임평상태>;
    return {
      로그인: !!v.로그인,
      별: Number(v.별) || 0,
      쓸수있나: !!v.쓸수있나,
      운영자: !!v.운영자,
      목록: Array.isArray(v.목록) ? v.목록 : [],
    };
  } catch {
    return 빈것;
  }
}

/**
 * 게임평을 남긴다. **왜 안 됐는지를 그대로 돌려준다** — 그냥 실패로 두면 고장으로 보인다.
 */
export async function 게임평남기기(글: string, 이름: string): Promise<{ 됐나: boolean; 까닭?: string }> {
  try {
    const r = await fetch('/api/local/auth/battle-review', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 글, 이름 }),
    });
    if (r.ok) return { 됐나: true };
    const v = (await r.json().catch(() => ({}))) as { error?: string };
    const 말: Record<string, string> = {
      'login required': '로그인한 뒤에 쓸 수 있습니다.',
      'too short': '조금만 더 적어 주십시오.',
      'too long': '200자까지 쓸 수 있습니다.',
      'no links': '링크는 넣을 수 없습니다.',
      'once a day': '하루에 한 번만 쓸 수 있습니다.',
      'same text': '같은 글은 다시 올릴 수 없습니다.',
    };
    return { 됐나: false, 까닭: 말[v.error ?? ''] ?? '남기지 못했습니다. 잠시 뒤 다시 해 주십시오.' };
  } catch {
    return { 됐나: false, 까닭: '남기지 못했습니다. 잠시 뒤 다시 해 주십시오.' };
  }
}

/** 운영자만 지운다. 운영자가 아니면 서버가 404를 준다. */
export async function 게임평지우기(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/local/auth/battle-review/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return r.ok;
  } catch {
    return false;
  }
}
