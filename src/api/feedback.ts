// 의견함. 보내기는 누구나(로그인 불필요, 서버가 IP당 시간당 5건 제한),
// 읽기·지우기는 운영자만(신고함 화면). 홈 배너(FeedbackBanner)가 보내는 쪽이다.

export interface FeedbackItem {
  id: number;
  text: string;
  at: number;
  /** 로그인한 사람의 닉네임. 비로그인 의견은 null — 화면에서 「익명」으로 보인다. */
  author: string | null;
}

export async function sendFeedback(text: string): Promise<void> {
  const res = await fetch('/api/local/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (res.status === 429) throw new Error('잠시 후 다시 보내 주세요.');
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? '보내지 못했습니다.');
  }
}

export async function fetchFeedback(): Promise<FeedbackItem[]> {
  const res = await fetch('/api/local/feedback');
  if (!res.ok) throw new Error('불러오지 못했습니다.');
  return res.json();
}

export async function deleteFeedback(id: number): Promise<void> {
  const res = await fetch(`/api/local/feedback/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('지우지 못했습니다.');
}
