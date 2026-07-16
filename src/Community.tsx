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
  CATEGORY_LABEL,
  fetchAppConfig,
  type CommunityPost,
  type CommunityComment,
  type PostCategory,
} from './api/community';

async function handleReport(action: () => Promise<void>) {
  if (!window.confirm('이 게시물을 신고하시겠어요? 운영자가 확인 후 조치합니다.')) return;
  try {
    await action();
    window.alert('신고가 접수되었습니다.');
  } catch {
    window.alert('신고 접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }
}

// 운영자 표시. 등급처럼 다녀서 얻는 게 아니라 권한이라, 이모지 대신 검정 알약으로
// 확실히 구분한다.
function AuthorName({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  if (!isAdmin) return <>{name}</>;
  return (
    <>
      <span className="mr-1 rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        운영자
      </span>
      {name}
    </>
  );
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
  heading,
  emptyText,
  posts,
  loading,
  loggedIn,
  onOpen,
  onWrite,
  onRequestLogin,
}: {
  heading: string;
  emptyText: string;
  posts: CommunityPost[];
  loading: boolean;
  loggedIn: boolean;
  onOpen: (id: number) => void;
  onWrite: () => void;
  onRequestLogin: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-black">{heading}</h2>
        {/* 비로그인이어도 글쓰기 버튼은 보여준다 — 누르면 로그인 모달이 뜨므로,
            버튼을 숨겨서 "왜 글을 못 쓰지?" 하게 만드는 것보다 낫다. */}
        <button
          type="button"
          onClick={loggedIn ? onWrite : onRequestLogin}
          className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          글쓰기
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400 py-12 text-center">불러오는 중...</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-neutral-400 py-12 text-center">{emptyText}</p>
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
                    {/* "전체" 탭에서는 게시판이 섞이므로 앞에 말머리를 붙인다. */}
                    <span className="mr-1 text-xs font-semibold text-neutral-500">[{CATEGORY_LABEL[post.category]}]</span>
                    {post.title}
                    {post.commentCount > 0 && <span className="ml-1 text-xs text-indigo-500">[{post.commentCount}]</span>}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    <AuthorName name={post.author} isAdmin={post.authorIsAdmin} /> · {formatDate(post.createdAt)}
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
  onRequestLogin,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  commentsLoading: boolean;
  loggedIn: boolean;
  onRequestLogin: () => void;
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
        <AuthorName name={post.author} isAdmin={post.authorIsAdmin} /> · {formatDate(post.createdAt)}
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
                  <AuthorName name={c.author} isAdmin={c.authorIsAdmin} /> · {formatDate(c.createdAt)}
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
          onClick={onRequestLogin}
          className="w-full rounded-lg border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          로그인하고 댓글 남기기
        </button>
      )}
    </div>
  );
}

// 글쓰기에서 고를 수 있는 게시판. "전체"는 실제 게시판이 아니라 목록 필터라 뺀다.
const WRITABLE_CATEGORIES: PostCategory[] = ['free', 'question', 'suggestion'];

function PostForm({
  initialCategory,
  onCancel,
  onSubmit,
}: {
  initialCategory: PostCategory;
  onCancel: () => void;
  onSubmit: (input: { title: string; content: string; category: PostCategory }) => Promise<void>;
}) {
  const [category, setCategory] = useState<PostCategory>(initialCategory);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), content: content.trim(), category });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2 className="text-base font-bold text-black mb-4">글쓰기</h2>
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {WRITABLE_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                category === c ? 'bg-black text-white' : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
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

// null = 전체 게시판. 특정 카테고리를 고르면 그 게시판만 본다.
const CATEGORY_TABS: { key: PostCategory | null; label: string }[] = [
  { key: null, label: '전체' },
  { key: 'free', label: '자유' },
  { key: 'question', label: '질문' },
  { key: 'suggestion', label: '건의' },
];

export function Community({ loggedIn, onRequestLogin }: { loggedIn: boolean; onRequestLogin: () => void }) {
  const [view, setView] = useState<View>('list');
  const [category, setCategory] = useState<PostCategory | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [openChatUrl, setOpenChatUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchAppConfig().then((c) => setOpenChatUrl(c.openChatUrl));
  }, []);

  function loadPosts(cat: PostCategory | null = category) {
    setPostsLoading(true);
    fetchPosts(cat ?? undefined)
      .then(setPosts)
      .catch(() => undefined)
      .finally(() => setPostsLoading(false));
  }

  useEffect(() => {
    loadPosts(category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  function openPost(id: number) {
    setView('detail');
    setCommentsLoading(true);
    fetchPost(id).then(setSelectedPost);
    fetchComments(id)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }

  async function handleCreatePost(input: { title: string; content: string; category: PostCategory }) {
    const post = await createPost(input);
    setView('list');
    // 방금 쓴 글의 게시판으로 옮겨가 바로 보이게 한다.
    setCategory(post.category);
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
    // 지금 보던 게시판을 기본값으로. "전체"에서 눌렀으면 자유로 시작한다.
    return (
      <PostForm initialCategory={category ?? 'free'} onCancel={() => setView('list')} onSubmit={handleCreatePost} />
    );
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
        onRequestLogin={onRequestLogin}
      />
    );
  }

  return (
    <div>
      {/* 오픈톡 링크는 운영자가 .env에 넣었을 때만 뜬다. 실시간으로 묻고 답하기 좋은
          창구라, 게시판보다 위에 눈에 띄게 둔다. */}
      {openChatUrl && (
        <a
          href={openChatUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#03C75A]/30 bg-[#03C75A]/5 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-black">오픈채팅으로 문의하기</p>
            <p className="text-xs text-neutral-500 mt-0.5">피드백·질문·버그 제보를 편하게 남겨주세요.</p>
          </div>
          <span className="flex-shrink-0 rounded-lg bg-[#03C75A] px-3 py-1.5 text-xs font-semibold text-white">
            바로가기
          </span>
        </a>
      )}

      {/* 게시판 탭. 누르면 그 게시판 글만 다시 불러온다. */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key ?? 'all'}
            type="button"
            onClick={() => setCategory(tab.key)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${
              category === tab.key ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <PostList
        heading={category === null ? '전체 게시판' : `${CATEGORY_LABEL[category]}게시판`}
        emptyText={
          category === null
            ? '아직 글이 없어요. 첫 글을 남겨보세요!'
            : `${CATEGORY_LABEL[category]}게시판에 아직 글이 없어요. 첫 글을 남겨보세요!`
        }
        posts={posts}
        loading={postsLoading}
        loggedIn={loggedIn}
        onOpen={openPost}
        onWrite={() => setView('write')}
        onRequestLogin={onRequestLogin}
      />
    </div>
  );
}
