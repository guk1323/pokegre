import { useEffect, useState } from 'react';
import {
  fetchPosts,
  fetchPost,
  fetchComments,
  createPost,
  createComment,
  deletePost,
  reportPost,
  reportComment,
  type CommunityPost,
  type CommunityComment,
} from './api/community';
import { startKakaoLogin } from './api/auth';

async function handleReport(action: () => Promise<void>) {
  if (!window.confirm('이 게시물을 신고하시겠어요? 운영자가 확인 후 조치합니다.')) return;
  try {
    await action();
    window.alert('신고가 접수되었습니다.');
  } catch {
    window.alert('신고 접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${min}`;
}

function PostList({
  posts,
  loading,
  loggedIn,
  onOpen,
  onWrite,
}: {
  posts: CommunityPost[];
  loading: boolean;
  loggedIn: boolean;
  onOpen: (id: number) => void;
  onWrite: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-black">자유게시판</h2>
        {loggedIn ? (
          <button
            type="button"
            onClick={onWrite}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            글쓰기
          </button>
        ) : (
          <button
            type="button"
            onClick={startKakaoLogin}
            className="rounded-lg bg-[#FEE500] px-4 py-2 text-sm font-semibold text-[#191600] hover:brightness-95"
          >
            카카오 로그인하고 글쓰기
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400 py-12 text-center">불러오는 중...</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-neutral-400 py-12 text-center">아직 글이 없어요. 첫 글을 남겨보세요!</p>
      ) : (
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {posts.map((post) => (
            <li key={post.id}>
              <button
                type="button"
                onClick={() => onOpen(post.id)}
                className="w-full flex items-center justify-between gap-3 px-2 py-3 text-left hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-black truncate">
                    {post.title}
                    {post.commentCount > 0 && <span className="ml-1 text-xs text-indigo-500">[{post.commentCount}]</span>}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {post.author} · {formatDate(post.createdAt)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PostDetail({
  post,
  comments,
  commentsLoading,
  loggedIn,
  onBack,
  onSubmitComment,
  onDelete,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  commentsLoading: boolean;
  loggedIn: boolean;
  onBack: () => void;
  onSubmitComment: (content: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await onSubmitComment(content.trim());
      setContent('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="text-sm text-neutral-500 hover:text-black mb-4">
        ← 목록으로
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-bold text-black">{post.title}</h2>
        <div className="flex flex-shrink-0 gap-2">
          {post.isMine ? (
            <button type="button" onClick={onDelete} className="text-xs text-neutral-400 hover:text-rose-500">
              삭제
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleReport(() => reportPost(post.id))}
              className="text-xs text-neutral-400 hover:text-rose-500"
            >
              신고
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-neutral-400 mb-4">
        {post.author} · {formatDate(post.createdAt)}
      </p>
      <p className="text-sm text-neutral-800 whitespace-pre-wrap mb-8">{post.content}</p>

      <p className="text-xs font-semibold text-neutral-500 mb-2">댓글 {comments.length}개</p>
      {commentsLoading ? (
        <p className="text-sm text-neutral-400 py-4">불러오는 중...</p>
      ) : (
        <ul className="mb-4 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-neutral-50 p-3">
              <div className="flex items-start justify-between gap-3 mb-1">
                <p className="text-xs text-neutral-400">
                  {c.author} · {formatDate(c.createdAt)}
                </p>
                <button
                  type="button"
                  onClick={() => handleReport(() => reportComment(post.id, c.id))}
                  className="flex-shrink-0 text-xs text-neutral-400 hover:text-rose-500"
                >
                  신고
                </button>
              </div>
              <p className="text-sm text-neutral-800 whitespace-pre-wrap">{c.content}</p>
            </li>
          ))}
        </ul>
      )}

      {loggedIn ? (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="댓글을 남겨보세요"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            등록
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={startKakaoLogin}
          className="w-full rounded-lg bg-[#FEE500] py-2 text-sm font-semibold text-[#191600] hover:brightness-95"
        >
          카카오 로그인하고 댓글 남기기
        </button>
      )}
    </div>
  );
}

function PostForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { title: string; content: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), content: content.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2 className="text-base font-bold text-black mb-4">글쓰기</h2>
      <div className="space-y-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="내용을 입력하세요"
          rows={10}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
          취소
        </button>
        <button
          type="submit"
          disabled={submitting || !title.trim() || !content.trim()}
          className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          등록
        </button>
      </div>
    </form>
  );
}

type View = 'list' | 'detail' | 'write';

export function Community({ loggedIn }: { loggedIn: boolean }) {
  const [view, setView] = useState<View>('list');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  function loadPosts() {
    setPostsLoading(true);
    fetchPosts()
      .then(setPosts)
      .catch(() => undefined)
      .finally(() => setPostsLoading(false));
  }

  useEffect(() => {
    loadPosts();
  }, []);

  function openPost(id: number) {
    setView('detail');
    setCommentsLoading(true);
    fetchPost(id).then(setSelectedPost);
    fetchComments(id)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }

  async function handleCreatePost(input: { title: string; content: string }) {
    const post = await createPost(input);
    setView('list');
    loadPosts();
    openPost(post.id);
  }

  async function handleCreateComment(content: string) {
    if (!selectedPost) return;
    const comment = await createComment(selectedPost.id, { content });
    setComments((prev) => [...prev, comment]);
    setSelectedPost((prev) => (prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev));
    setPosts((prev) => prev.map((p) => (p.id === selectedPost.id ? { ...p, commentCount: p.commentCount + 1 } : p)));
  }

  async function handleDeletePost() {
    if (!selectedPost) return;
    if (!window.confirm('이 글을 삭제할까요? 댓글도 함께 삭제됩니다.')) return;
    try {
      await deletePost(selectedPost.id);
      setView('list');
      loadPosts();
    } catch {
      window.alert('삭제하지 못했습니다.');
    }
  }

  if (view === 'write') {
    return <PostForm onCancel={() => setView('list')} onSubmit={handleCreatePost} />;
  }

  if (view === 'detail' && selectedPost) {
    return (
      <PostDetail
        post={selectedPost}
        comments={comments}
        commentsLoading={commentsLoading}
        loggedIn={loggedIn}
        onBack={() => setView('list')}
        onSubmitComment={handleCreateComment}
        onDelete={handleDeletePost}
      />
    );
  }

  return (
    <PostList
      posts={posts}
      loading={postsLoading}
      loggedIn={loggedIn}
      onOpen={openPost}
      onWrite={() => setView('write')}
    />
  );
}
