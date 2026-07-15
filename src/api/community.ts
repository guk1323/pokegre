export interface CommunityPost {
  id: number;
  title: string;
  author: string;
  content: string;
  createdAt: number;
  commentCount: number;
}

export interface CommunityComment {
  id: number;
  postId: number;
  author: string;
  content: string;
  createdAt: number;
}

export async function fetchPosts(): Promise<CommunityPost[]> {
  const res = await fetch('/api/local/community/posts');
  if (!res.ok) throw new Error('게시글을 불러오지 못했습니다.');
  return res.json();
}

export async function fetchPost(id: number): Promise<CommunityPost> {
  const res = await fetch(`/api/local/community/posts/${id}`);
  if (!res.ok) throw new Error('게시글을 찾을 수 없습니다.');
  return res.json();
}

export async function createPost(input: { title: string; author: string; content: string }): Promise<CommunityPost> {
  const res = await fetch('/api/local/community/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('게시글을 작성하지 못했습니다.');
  return res.json();
}

export async function fetchComments(postId: number): Promise<CommunityComment[]> {
  const res = await fetch(`/api/local/community/posts/${postId}/comments`);
  if (!res.ok) throw new Error('댓글을 불러오지 못했습니다.');
  return res.json();
}

export async function createComment(
  postId: number,
  input: { author: string; content: string },
): Promise<CommunityComment> {
  const res = await fetch(`/api/local/community/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
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
