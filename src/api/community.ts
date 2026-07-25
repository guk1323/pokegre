import { isTrackingOff } from './localStats';

export type PostCategory = "free" | "question" | "suggestion" | "pulls";

export const CATEGORY_LABEL: Record<PostCategory, string> = {
  free: "자유",
  question: "질문",
  suggestion: "건의",
  pulls: "개봉 자랑",
};

export interface CommunityPost {
  category: PostCategory;
  id: number;
  title: string;
  author: string;
  // 작성자가 운영자면 닉네임 옆에 배지를 단다.
  authorIsAdmin: boolean;
  content: string;
  // 팩 개봉 자랑글에만 붙는 카드 목록(서버가 검증한 결과). 이미지 그리드로 그린다.
  pull?: { pack: string; god: boolean; cards: { img: string; name: string; r: string }[] };
  createdAt: number;
  // 고친 적 있으면 그 시각. 화면에 "(수정됨)"을 붙이는 데만 쓴다.
  editedAt?: number;
  // 좋아요 개수와, 지금 보는 사람이 눌렀는지. 누가 눌렀는지 목록은 서버가 주지 않는다.
  likeCount: number;
  liked: boolean;
  // 운영자가 공지로 고정한 글. 모든 게시판 맨 위에 "공지"로 뜬다.
  isPinned: boolean;
  commentCount: number;
  // 글을 열어 본 횟수. 없던 시절 글은 서버가 0으로 준다.
  viewCount?: number;
  isMine: boolean;
  // 운영자가 가린 글. 운영자가 아닌 사람에게는 title·content가 이미 서버에서
  // 안내 문구로 바뀌어 오므로, 이 값은 표시를 다르게 할 때만 쓴다.
  isHidden: boolean;
}

export interface CommunityComment {
  id: number;
  postId: number;
  author: string;
  authorIsAdmin: boolean;
  content: string;
  createdAt: number;
  isMine: boolean;
  isHidden: boolean;
}

export const LOGIN_REQUIRED = 'login_required';

export async function fetchPosts(category?: PostCategory): Promise<CommunityPost[]> {
  const qs = category ? `?category=${category}` : "";
  const res = await fetch(`/api/local/community/posts${qs}`);
  if (!res.ok) throw new Error('게시글을 불러오지 못했습니다.');
  return res.json();
}

export async function fetchPost(id: number): Promise<CommunityPost> {
  // 집계 제외 브라우저(운영자·테스트)는 조회수를 올리지 않도록 서버에 알린다.
  const qs = isTrackingOff() ? '?notrack=1' : '';
  const res = await fetch(`/api/local/community/posts/${id}${qs}`);
  if (!res.ok) throw new Error('게시글을 찾을 수 없습니다.');
  return res.json();
}

// 작성자는 서버가 세션에서 가져오므로 보내지 않는다.
export async function createPost(input: { title: string; content: string; category: PostCategory }): Promise<CommunityPost> {
  const res = await fetch('/api/local/community/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error(LOGIN_REQUIRED);
  if (!res.ok) throw new Error('게시글을 작성하지 못했습니다.');
  return res.json();
}

export async function updatePost(
  id: number,
  input: { title: string; content: string; category: PostCategory },
): Promise<CommunityPost> {
  const res = await fetch(`/api/local/community/posts/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error(LOGIN_REQUIRED);
  if (!res.ok) throw new Error('게시글을 수정하지 못했습니다.');
  return res.json();
}

export async function deletePost(id: number): Promise<void> {
  const res = await fetch(`/api/local/community/posts/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('게시글을 삭제하지 못했습니다.');
}

// 좋아요를 켜고 끈다. 서버가 바뀐 개수와 지금 상태(눌렀는지)를 돌려준다.
export async function toggleLike(id: number): Promise<{ likeCount: number; liked: boolean }> {
  const res = await fetch(`/api/local/community/posts/${id}/like`, { method: 'POST' });
  if (res.status === 401) throw new Error(LOGIN_REQUIRED);
  if (!res.ok) throw new Error('좋아요를 처리하지 못했습니다.');
  return res.json();
}

// 공지 고정/해제. 운영자만 부를 수 있고, 아니면 서버가 404를 준다.
export async function setPostPinned(id: number, pinned: boolean): Promise<CommunityPost> {
  const res = await fetch(`/api/local/community/posts/${id}/${pinned ? 'pin' : 'unpin'}`, { method: 'POST' });
  if (!res.ok) throw new Error('공지 설정을 변경하지 못했습니다.');
  return res.json();
}

export async function fetchComments(postId: number): Promise<CommunityComment[]> {
  const res = await fetch(`/api/local/community/posts/${postId}/comments`);
  if (!res.ok) throw new Error('댓글을 불러오지 못했습니다.');
  return res.json();
}

export async function createComment(postId: number, input: { content: string }): Promise<CommunityComment> {
  const res = await fetch(`/api/local/community/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error(LOGIN_REQUIRED);
  if (!res.ok) throw new Error('댓글을 작성하지 못했습니다.');
  return res.json();
}

export async function reportPost(postId: number, reason?: string): Promise<void> {
  const res = await fetch(`/api/local/community/posts/${postId}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error('신고를 접수하지 못했습니다.');
}

export async function reportComment(postId: number, commentId: number, reason?: string): Promise<void> {
  const res = await fetch(`/api/local/community/posts/${postId}/comments/${commentId}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error('신고를 접수하지 못했습니다.');
}

export interface CommunityReport {
  id: number;
  targetType: "post" | "comment";
  postId: number;
  commentId: number | null;
  reason: string;
  createdAt: number;
  // 신고당한 글이 이미 지워졌을 수 있다.
  exists: boolean;
  isHidden: boolean;
  postTitle: string | null;
  author: string | null;
  excerpt: string | null;
}

// 운영자만 부를 수 있다. 아니면 서버가 404를 준다 — 화면에서 메뉴를 숨기는 건
// 편의일 뿐이고 실제 차단은 서버가 한다.
export async function fetchReports(): Promise<CommunityReport[]> {
  const res = await fetch("/api/local/community/reports");
  if (!res.ok) throw new Error("신고함을 불러오지 못했습니다.");
  return res.json();
}

export async function setPostHidden(postId: number, hidden: boolean): Promise<void> {
  const res = await fetch(`/api/local/community/posts/${postId}/${hidden ? "hide" : "unhide"}`, { method: "POST" });
  if (!res.ok) throw new Error("처리하지 못했습니다.");
}

export async function setCommentHidden(commentId: number, hidden: boolean): Promise<void> {
  const res = await fetch(`/api/local/community/comments/${commentId}/${hidden ? "hide" : "unhide"}`, { method: "POST" });
  if (!res.ok) throw new Error("처리하지 못했습니다.");
}

// 금지어 목록은 조금만 비틀면 뚫린다. 뚫린 걸 실제로 처리하는 게 이것이다.
// 초기화된 사람은 다음에 들어올 때 닉네임을 다시 정해야 한다.
export async function resetReportedNickname(reportId: number): Promise<void> {
  const res = await fetch(`/api/local/community/reports/${reportId}/reset-nickname`, { method: "POST" });
  if (!res.ok) throw new Error("닉네임을 초기화하지 못했습니다.");
}

// 화면에 공개해도 되는 서버 설정. 지금은 오픈톡 링크 하나뿐이다.
export async function fetchAppConfig(): Promise<{ openChatUrl: string | null }> {
  try {
    const res = await fetch("/api/local/config");
    if (!res.ok) return { openChatUrl: null };
    return await res.json();
  } catch {
    return { openChatUrl: null };
  }
}
