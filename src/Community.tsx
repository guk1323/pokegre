import { useEffect, useState } from 'react';
import { AdSlot } from './components/AdSlot';
import { useSubScreen } from './lib/useSubScreen';
import { PostBody, 본문에쓴사진 } from './lib/postFormat';
import {
  fetchPosts,
  fetchPost,
  fetchComments,
  createPost,
  updatePost,
  toggleLike,
  setPostPinned,
  createComment,
  deletePost,
  reportPost,
  reportComment,
  CATEGORY_LABEL,
  fetchAppConfig,
  uploadPostImage,
  MAX_POST_IMAGES,
  type CommunityPost,
  type CommunityComment,
  type PostCategory,
} from './api/community';
import { formatKrwApprox } from './api/exchangeRate';

async function handleReport(action: () => Promise<void>) {
  if (!window.confirm('이 게시물을 신고하시겠습니까? 운영자가 확인 후 조치합니다.')) return;
  try {
    await action();
    window.alert('신고가 접수되었습니다.');
  } catch (err) {
    // 로그인이 필요한 경우까지 "잠시 후 다시 시도"라고 하면 몇 번을 눌러도 안 된다.
    window.alert(
      err instanceof Error && err.message ? err.message : '신고 접수에 실패했습니다. 잠시 후 다시 시도해주세요.',
    );
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

// 한 쪽에 보여 줄 글 수(사장님 지시 2026-08-11 "10개로 나눠서").
const POSTS_PER_PAGE = 10;

/**
 * 쪽 번호로 무엇을 보여 줄지. 쪽이 30개면 번호를 30개 그릴 수 없으니 지금 쪽 둘레만 낸다.
 * 앞뒤로 두 개씩(최대 5개) — 네이버 카페도 이런 식이다.
 */
function 쪽번호들(지금: number, 전체: number): number[] {
  const 최대 = 5;
  if (전체 <= 최대) return Array.from({ length: 전체 }, (_, i) => i + 1);
  // 끝쪽에 붙으면 창을 안쪽으로 밀어, 늘 5개가 보이게 한다.
  const 시작 = Math.min(Math.max(1, 지금 - 2), 전체 - 최대 + 1);
  return Array.from({ length: 최대 }, (_, i) => 시작 + i);
}

function PagerButton({
  disabled,
  onClick,
  label,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="h-8 w-8 rounded-lg text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/**
 * 글 목록 한 줄.
 *
 * 넓은 화면에서는 제목·작성자·작성일·조회를 칸으로 나눠 세운다(사장님 지시 2026-08-11 —
 * 네이버 카페 꼴이 눈에 익다고 하셨다). 폰에서는 칸을 넷으로 쪼개면 제목이 몇 글자밖에
 * 안 남아서, 제목 한 줄 + 그 밑에 작은 글씨 한 줄로 둔다.
 */
function PostRow({ post, onOpen }: { post: CommunityPost; onOpen: (id: number) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(post.id)}
        className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-neutral-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-black">
            {/* 공지(고정 글)는 게시판 말머리 대신 눈에 띄는 공지 배지를 앞에 단다. */}
            {post.isPinned ? (
              <span className="mr-1 rounded bg-[#2a78d6] px-1.5 py-0.5 text-[10px] font-bold text-white">공지</span>
            ) : (
              <span className="mr-1 text-xs font-semibold text-neutral-500">[{CATEGORY_LABEL[post.category]}]</span>
            )}
            {/* 비밀글 표시. 이모지는 안 쓴다(사이트 지침) — 작은 자물쇠 그림으로 둔다. */}
            {post.secret && (
              <svg
                aria-label="비밀글"
                role="img"
                viewBox="0 0 24 24"
                className="mr-1 inline-block h-3.5 w-3.5 align-[-2px] text-neutral-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
              >
                <rect x="4" y="10" width="16" height="10" rx="2.5" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            )}
            {post.title}
            {post.commentCount > 0 && <span className="ml-1 text-xs text-indigo-500">[{post.commentCount}]</span>}
          </p>
          {/* 폰에서만 쓰는 줄. 넓은 화면에서는 오른쪽 칸들이 같은 것을 보여 준다. */}
          <p className="mt-0.5 text-xs text-neutral-400 sm:hidden">
            <AuthorName name={post.author} isAdmin={post.authorIsAdmin} /> · {formatDate(post.createdAt)} · 조회{' '}
            {(post.viewCount ?? 0).toLocaleString()}
            {/* 좋아요 수도 목록에서 보이게(사장님 지시 2026-08-10). 0은 줄만 어지럽혀 숨긴다. */}
            {post.likeCount > 0 && ` · 좋아요 ${post.likeCount.toLocaleString()}`}
          </p>
        </div>
        <span className="hidden w-24 shrink-0 truncate text-center text-xs text-neutral-500 sm:block">
          <AuthorName name={post.author} isAdmin={post.authorIsAdmin} />
        </span>
        <span className="hidden w-16 shrink-0 text-center text-xs tabular-nums text-neutral-400 sm:block">
          {formatDate(post.createdAt)}
        </span>
        <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-neutral-400 sm:block">
          {(post.viewCount ?? 0).toLocaleString()}
        </span>
        {/* 0은 줄만 어지럽혀 빈칸으로 둔다(폰 줄과 같은 잣대). */}
        <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-neutral-400 sm:block">
          {post.likeCount > 0 ? post.likeCount.toLocaleString() : ''}
        </span>
      </button>
    </li>
  );
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
  const [쪽, set쪽] = useState(1);
  // 공지는 쪽수에서 빼고 따로 센다 — 공지가 많은 게시판이면 공지가 한 쪽을 다 먹는다.
  const 공지 = posts.filter((p) => p.isPinned);
  const 보통글 = posts.filter((p) => !p.isPinned);
  const 쪽수 = Math.max(1, Math.ceil(보통글.length / POSTS_PER_PAGE));
  // ⚠️ 게시판을 바꾸거나 글이 지워져 쪽수가 줄면, 보고 있던 쪽이 사라져 빈 화면이 된다.
  //    그럴 땐 마지막 쪽으로 당긴다. (useEffect로 되돌리면 빈 화면이 한 번 그려진다.)
  const 지금쪽 = Math.min(쪽, 쪽수);
  const 이쪽글 = 보통글.slice((지금쪽 - 1) * POSTS_PER_PAGE, 지금쪽 * POSTS_PER_PAGE);
  // 쪽이 아주 많아도 번호를 다 그리면 줄이 넘친다. 지금 쪽 둘레만 보인다.
  const 보일쪽들 = 쪽번호들(지금쪽, 쪽수);
  // 게시판을 바꾸면 1쪽부터 본다. posts가 통째로 바뀐 것을 길이·첫 글로 알아낸다.
  const 열쇠 = `${posts.length}:${posts[0]?.id ?? 0}`;
  const [본열쇠, set본열쇠] = useState(열쇠);
  if (본열쇠 !== 열쇠) {
    set본열쇠(열쇠);
    if (쪽 !== 1) set쪽(1);
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-black">{heading}</h2>
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
        <>
          {/* 칸 이름줄. 넓은 화면에서만 보인다 — 폰에서는 칸이 좁아 제목만 남기고
              나머지는 제목 밑에 한 줄로 붙인다(아래 PostRow). */}
          <div className="hidden border-y border-neutral-200 bg-neutral-50 px-2 py-2 text-xs font-semibold text-neutral-500 sm:flex">
            <span className="flex-1">제목</span>
            <span className="w-24 shrink-0 text-center">작성자</span>
            <span className="w-16 shrink-0 text-center">작성일</span>
            <span className="w-14 shrink-0 text-right">조회</span>
            {/* ⚠️ **좋아요 칸이 없어서 넓은 화면에서만 안 보였다**(사장님 지적 2026-08-14).
                폰 줄(아래 PostRow의 `sm:hidden`)에는 좋아요가 들어 있는데 칸 쪽에는
                빠져 있었다 — 같은 것을 두 군데서 그리므로 **한쪽만 고치면 이렇게 어긋난다.** */}
            <span className="w-14 shrink-0 text-right">좋아요</span>
          </div>
          <ul className="divide-y divide-neutral-200 border-b border-neutral-200 border-t sm:border-t-0">
            {/* 공지는 어느 쪽수에서도 맨 위에 둔다. 쪽을 넘겼다고 공지가 사라지면
                읽으라고 붙여 둔 뜻이 없어진다(네이버 카페도 이렇게 한다). */}
            {공지.map((post) => (
              <PostRow key={post.id} post={post} onOpen={onOpen} />
            ))}
            {이쪽글.map((post, i) => (
              <div key={post.id} className="contents">
                {/* 글 5줄 뒤 광고 한 줄. ul의 divide가 줄을 그어 주므로 li로 낀다. */}
                {i === 5 && (
                  <li className="list-none px-2">
                    <AdSlot 형태="가로" 이름="게시판-목록" />
                  </li>
                )}
                <PostRow post={post} onOpen={onOpen} />
              </div>
            ))}
          </ul>
          {/* 쪽 번호. 한 쪽에 10개씩(사장님 지시 2026-08-11). 한 쪽뿐이면 안 그린다. */}
          {쪽수 > 1 && (
            <nav className="mt-4 flex items-center justify-center gap-1" aria-label="쪽 넘기기">
              <PagerButton disabled={지금쪽 === 1} onClick={() => set쪽(지금쪽 - 1)} label="이전 쪽">
                ‹
              </PagerButton>
              {보일쪽들.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set쪽(n)}
                  aria-current={n === 지금쪽 ? 'page' : undefined}
                  className={`h-8 min-w-8 rounded-lg px-2 text-sm tabular-nums ${
                    n === 지금쪽 ? 'bg-black font-bold text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  {n}
                </button>
              ))}
              <PagerButton disabled={지금쪽 === 쪽수} onClick={() => set쪽(지금쪽 + 1)} label="다음 쪽">
                ›
              </PagerButton>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function PostDetail({
  post,
  comments,
  commentsLoading,
  loggedIn,
  isAdmin,
  onBack,
  onSubmitComment,
  onDelete,
  onEdit,
  onToggleLike,
  onTogglePin,
  onRequestLogin,
}: {
  post: CommunityPost;
  comments: CommunityComment[];
  commentsLoading: boolean;
  loggedIn: boolean;
  isAdmin: boolean;
  onRequestLogin: () => void;
  onBack: () => void;
  onSubmitComment: (content: string) => Promise<void>;
  onDelete: () => void;
  onEdit: () => void;
  onToggleLike: () => void;
  onTogglePin: () => void;
}) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 본문이 [사진N]으로 자리를 잡은 사진은 아래 묶음에서 뺀다(같은 사진을 두 번 안 보이게).
  const 아래사진 = (post.images ?? []).filter((_u, i) => !본문에쓴사진(post.content).has(i + 1));

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
        <h2 className="text-lg font-bold text-black">
          {post.isPinned && (
            <span className="mr-1.5 align-middle rounded bg-[#2a78d6] px-1.5 py-0.5 text-xs font-bold text-white">공지</span>
          )}
          {post.secret && (
            <span className="mr-1.5 align-middle rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-bold text-neutral-600">
              비밀글
            </span>
          )}
          {post.title}
        </h2>
        <div className="flex flex-shrink-0 gap-2">
          {/* 운영자는 어느 글이든 공지로 올리거나 내릴 수 있다. */}
          {isAdmin && (
            <button type="button" onClick={onTogglePin} className="text-xs text-neutral-400 hover:text-[#2a78d6]">
              {post.isPinned ? '공지 해제' : '공지 등록'}
            </button>
          )}
          {post.isMine ? (
            <>
              <button type="button" onClick={onEdit} className="text-xs text-neutral-400 hover:text-black">
                수정
              </button>
              <button type="button" onClick={onDelete} className="text-xs text-neutral-400 hover:text-rose-500">
                삭제
              </button>
            </>
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
        {post.editedAt != null && ' · 수정됨'}
        {' · 조회 '}
        {(post.viewCount ?? 0).toLocaleString()}
      </p>
      {post.pull ? (
        <div className="mb-6">
          {post.content && <p className="mb-3 whitespace-pre-wrap text-sm text-neutral-800">{post.content}</p>}
          {post.pull.god && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
              갓팩입니다. 전부 AR 이상이 나왔습니다.
            </p>
          )}
          <p className="mb-2 text-xs text-neutral-400">
            {post.pull.pack}
            {/* 같은 카드를 묶은 뒤라 세는 단위가 "장"이 아니라 "종"이다.
                12종이 실제로는 20장일 수 있다(카드마다 ×3처럼 적힌다). */}
            {post.pull.total && post.pull.total > post.pull.cards.length
              ? ` · 총 ${post.pull.total}장 중 좋은 카드 ${post.pull.cards.length}종`
              : ''}
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {post.pull.cards.map((c, i) => (
              <div key={i}>
                {/* 같은 카드가 여러 장 나오면 한 장만 그리고 장수를 겹쳐 적는다.
                    카드 위에 얹어야 어느 카드가 여러 장인지 바로 붙어 보인다. */}
                <div className="relative">
                  {c.img && (
                    <img
                      src={`/api/img?u=${encodeURIComponent(/\.(png|jpe?g|webp)(\?|$)/i.test(c.img) ? c.img : `${c.img}/high.webp`)}&w=240`}
                      alt=""
                      className="aspect-[5/7] w-full rounded-lg bg-neutral-50 object-contain ring-1 ring-neutral-200"
                    />
                  )}
                  {c.q && c.q > 1 ? (
                    <span className="absolute right-1 top-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-white">
                      ×{c.q}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-700">{c.name}</p>
                <p className="text-[10px] text-neutral-400">{c.r}</p>
                {/* 뽑았을 그때의 값. 지금 시세가 아니라 **글 올린 날의 값**이라 안 변한다.
                    시세를 못 받은 세트는 값이 안 와서 줄이 안 생긴다(0원이라고 적으면 틀린 말). */}
                {c.krw ? (
                  <p className="text-[10px] font-bold text-neutral-800">{formatKrwApprox(c.krw)}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <PostBody content={post.content} images={post.images ?? []} />
        </div>
      )}
      {/* 작성자가 올린 사진. 누르면 원본을 새 탭으로 연다.
          ⚠️ **본문이 [사진N]으로 자리를 잡은 것은 여기서 뺀다** — 안 빼면 같은 사진이
             본문에 한 번, 아래에 또 한 번 나온다. */}
      {아래사진.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {아래사진.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              {/* ⚠️ loading="lazy"를 쓰면 안 된다. 높이를 정해 두지 않은 이미지라 불러오기
                  전 높이가 0인데, 그러면 브라우저가 "화면 밖"으로 보고 영영 안 불러와
                  사진이 통째로 안 뜬다(실제로 그랬다). 글 하나에 최대 4장이라 바로 부른다. */}
              <img src={u} alt="" className="min-h-24 w-full rounded-xl bg-neutral-50 object-contain ring-1 ring-neutral-200" />
            </a>
          ))}
        </div>
      )}

      {/* 좋아요. 비로그인이 누르면 로그인 모달을 띄운다 — 버튼을 숨기면 "왜 못 누르지?"
          하게 되므로 보여주고 누를 때 안내한다. 누른 상태는 파란 하트로 채워 보여준다. */}
      <div className="mb-8">
        <button
          type="button"
          onClick={loggedIn ? onToggleLike : onRequestLogin}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
            post.liked
              ? 'border-[#2a78d6] bg-[#2a78d6]/5 text-[#2a78d6]'
              : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          <span>{post.liked ? '♥' : '♡'}</span>
          <span>좋아요</span>
          {post.likeCount > 0 && <span>{post.likeCount}</span>}
        </button>
      </div>

      <AdSlot 형태="가로" 이름="게시판-글" />

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
  mode,
  initialCategory,
  initialTitle = '',
  initialContent = '',
  initialImages = [],
  initialSecret = false,
  onCancel,
  onSubmit,
}: {
  // 새 글인지 수정인지. 제목·버튼 문구만 다르고 나머지는 같다.
  mode: 'write' | 'edit';
  initialCategory: PostCategory;
  initialTitle?: string;
  initialContent?: string;
  initialImages?: string[];
  initialSecret?: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    title: string;
    content: string;
    category: PostCategory;
    images: string[];
    secret: boolean;
  }) => Promise<void>;
}) {
  const [category, setCategory] = useState<PostCategory>(initialCategory);
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [images, setImages] = useState<string[]>(initialImages);
  // 비밀글. 건의 게시판에서만 쓴다(서버도 같은 조건으로 막는다).
  const [secret, setSecret] = useState(initialSecret);
  const [uploading, setUploading] = useState(false);
  const [imgErr, setImgErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = ''; // 같은 파일을 다시 골라도 반응하도록 비운다
    if (!files.length) return;
    setImgErr('');
    setUploading(true);
    try {
      for (const f of files) {
        if (images.length >= MAX_POST_IMAGES) {
          setImgErr(`사진은 최대 ${MAX_POST_IMAGES}장까지 올릴 수 있습니다.`);
          break;
        }
        const url = await uploadPostImage(f);
        // ⚠️ 올리자마자 본문 끝에 [사진N] 표시를 넣어 준다(2026-08-23). 이게 없으면
        //    「자리를 정할 수 있다」는 것을 아무도 모른다 — 표시를 원하는 줄로 옮기면
        //    거기에 사진이 들어간다. 지우면 예전처럼 글 아래 묶음으로 간다.
        setImages((prev) => {
          if (prev.length >= MAX_POST_IMAGES) return prev;
          const 번호 = prev.length + 1;
          setContent((c) => (c.trimEnd() ? `${c.trimEnd()}\n\n[사진${번호}]\n` : `[사진${번호}]\n`));
          return [...prev, url];
        });
      }
    } catch (err) {
      setImgErr(err instanceof Error ? err.message : '사진을 올리지 못했습니다.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), content: content.trim(), category, images, secret: secret && category === 'suggestion' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2 className="mb-4 text-lg font-bold text-black">{mode === 'edit' ? '글 수정' : '글쓰기'}</h2>
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
        {/* ⚠️ 비밀글은 건의에서만 켠다. 자유·질문까지 열어 주면 아무도 못 읽는 글이
            목록을 채워 게시판이 죽는다. 건의는 원래 운영자에게 하는 말이라 맞다. */}
        {category === 'suggestion' && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={secret}
              onChange={(e) => setSecret(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-black"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-neutral-800">비밀글로 올리기</span>
              <span className="block text-xs text-neutral-500">
                나와 운영자만 볼 수 있습니다. 목록에는 자물쇠로 표시됩니다.
              </span>
            </span>
          </label>
        )}
        {/* ⚠️ 비밀글을 다른 게시판으로 옮기면 비밀이 풀린다. 체크박스가 소리 없이 사라질
            뿐이라, 글쓴이는 저장하고 나서야 공개된 걸 안다. 그래서 저장 전에 말해 준다. */}
        {initialSecret && category !== 'suggestion' && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700">
            건의가 아닌 게시판으로 옮기면 비밀글이 풀려 누구나 볼 수 있습니다.
          </p>
        )}
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

        {/* 사진 첨부 — 올린 뒤 주소만 글에 담는다. */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
              사진 첨부
              <input type="file" accept="image/*" multiple onChange={handlePick} className="hidden" />
            </label>
            <span className="text-xs text-neutral-400">
              {uploading ? '올리는 중…' : `${images.length}/${MAX_POST_IMAGES}장 · 한 장에 4MB까지`}
            </span>
          </div>
          {/* 꾸미는 법. 몰라도 그냥 쓰면 예전과 똑같이 나온다 — 알면 더 쓸 수 있다는 안내다. */}
          <details className="mt-2 text-xs text-neutral-500">
            <summary className="cursor-pointer font-semibold">글 꾸미는 법</summary>
            <div className="mt-1.5 space-y-0.5 leading-relaxed">
              <p>
                <code>## 제목</code> · <code>### 작은 제목</code> · <code>**굵게**</code> · <code>- 목록</code> ·{' '}
                <code>---</code> (가로줄)
              </p>
              <p>
                <code>[사진1]</code>을 원하는 줄로 옮기면 그 자리에 사진이 들어갑니다.{' '}
                <code>[사진1 작게]</code>처럼 크기도 정할 수 있습니다(작게·보통·크게).
              </p>
              <p>
                표는 <code>| 칸 | 칸 |</code>로 쓰고, 다음 줄에 <code>|---|---|</code>를 두면 첫 줄이 머리글이 됩니다.
              </p>
            </div>
          </details>
          {imgErr && <p className="mt-1 text-xs font-semibold text-rose-600">{imgErr}</p>}
          {images.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((u, i) => (
                <div key={u} className="relative">
                  <img src={u} alt="" className="aspect-square w-full rounded-lg object-cover ring-1 ring-neutral-200" />
                  {/* 본문에 이 번호로 적으면 그 자리에 들어간다. */}
                  <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white">
                    [사진{i + 1}]
                  </span>
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((x) => x !== u))}
                    className="absolute right-1 top-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-white"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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

type View = 'list' | 'detail' | 'write' | 'edit';

// null = 전체 게시판. 특정 카테고리를 고르면 그 게시판만 본다.
const CATEGORY_TABS: { key: PostCategory | null; label: string }[] = [
  { key: null, label: '전체' },
  { key: 'free', label: '자유' },
  { key: 'question', label: '질문' },
  { key: 'suggestion', label: '건의' },
  { key: 'pulls', label: '오늘의 상점' },
];

export function Community({
  loggedIn,
  isAdmin,
  onRequestLogin,
  initialPostId,
  onInitialPostDone,
}: {
  loggedIn: boolean;
  isAdmin: boolean;
  onRequestLogin: () => void;
  /** /community/<번호>로 들어왔을 때 바로 열 글. 없으면 목록부터. */
  initialPostId?: number | null;
  onInitialPostDone?: () => void;
}) {
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

  // 글 하나를 화면에 띄우되 방문기록은 건드리지 않는다(복원·뒤로가기용).
  function showPost(id: number) {
    setView('detail');
    setCommentsLoading(true);
    fetchPost(id).then(setSelectedPost);
    fetchComments(id)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }

  // 글보기·글쓰기를 방문기록 한 칸으로: 뒤로가기가 정확히 직전 화면(목록/글)으로 간다.
  const sub = useSubScreen<{ v: 'detail' | 'write' | 'edit'; id?: number }>(
    'post',
    (data) => {
      if (!data) {
        setView('list');
        return;
      }
      if (data.v === 'write') {
        setView('write');
        return;
      }
      // detail·edit 복원은 글을 다시 불러와 글보기로 (수정 화면은 소유권 확인이 필요해
      // 기록 복원으로는 열지 않는다 — 글에서 다시 수정을 누르면 된다).
      if (data.id != null) showPost(data.id);
    },
    // 닫으면 주소·탭 제목을 목록으로. (App.tsx의 VIEW_PATH·VIEW_TITLE과 같은 값이어야 한다.)
    { path: '/community', title: '게시판 | pokegre' },
    // ⚠️ **글 하나에 주소를 준다**(2026-08-23). 이게 없으면 구글이 `/community` 한 쪽만
    //    읽어서, 정보글을 아무리 쌓아도 검색으로는 아무도 안 온다. 글쓰기 화면은 주소를
    //    안 바꾼다 — 남에게 보낼 주소가 아니고, 새로고침하면 빈 글쓰기가 뜰 뿐이다.
    //    ⚠️ 빈 문자열을 돌려주면 안 된다 — useSubScreen이 뒤에 검색어(?notrack=1 등)를
    //       붙이므로 주소가 「?notrack=1」만 남는 꼴이 된다. 글쓰기는 목록 주소로 둔다.
    (data) => (data.v === 'detail' && data.id != null ? `/community/${data.id}` : '/community'),
  );

  // /community/<번호>로 들어온 경우 그 글부터 연다.
  useEffect(() => {
    if (initialPostId == null) return;
    showPost(initialPostId);
    onInitialPostDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPostId]);

  function openPost(id: number) {
    showPost(id);
    sub.push({ v: 'detail', id });
  }

  async function handleCreatePost(input: { title: string; content: string; category: PostCategory; secret?: boolean }) {
    const post = await createPost(input);
    // 방금 쓴 글의 게시판으로 옮겨가 바로 보이게 한다. 글쓰기 칸을 글보기로 바꿔치기해서
    // (replace) 뒤로가기가 빈 글쓰기 화면이 아니라 목록으로 가게 한다.
    setCategory(post.category);
    showPost(post.id);
    sub.replace({ v: 'detail', id: post.id });
  }

  async function handleUpdatePost(input: { title: string; content: string; category: PostCategory; secret?: boolean }) {
    if (!selectedPost) return;
    const updated = await updatePost(selectedPost.id, input);
    setSelectedPost(updated);
    // 목록에도 바뀐 내용을 반영해둔다. 게시판이 바뀌었을 수 있으니 그 게시판으로 옮긴다.
    setCategory(updated.category);
    loadPosts(updated.category);
    // 수정 칸을 되돌리면(기록 한 칸 뒤로) 글보기가 복원되면서 수정된 내용을 다시 불러온다.
    sub.back();
  }

  async function handleTogglePin() {
    if (!selectedPost) return;
    try {
      const updated = await setPostPinned(selectedPost.id, !selectedPost.isPinned);
      setSelectedPost(updated);
      // 목록 순서(공지는 맨 위)가 바뀌므로 다시 불러온다.
      loadPosts();
    } catch {
      window.alert('공지 설정을 변경하지 못했습니다.');
    }
  }

  async function handleToggleLike() {
    if (!selectedPost) return;
    // 눌린 즉시 반응하도록 화면을 먼저 바꾸고, 서버 응답으로 정확한 값을 맞춘다.
    setSelectedPost((prev) =>
      prev ? { ...prev, liked: !prev.liked, likeCount: prev.likeCount + (prev.liked ? -1 : 1) } : prev,
    );
    try {
      const { likeCount, liked } = await toggleLike(selectedPost.id);
      setSelectedPost((prev) => (prev ? { ...prev, likeCount, liked } : prev));
      setPosts((prev) => prev.map((p) => (p.id === selectedPost.id ? { ...p, likeCount, liked } : p)));
    } catch {
      // 실패하면 눌렀던 걸 되돌린다.
      setSelectedPost((prev) =>
        prev ? { ...prev, liked: !prev.liked, likeCount: prev.likeCount + (prev.liked ? -1 : 1) } : prev,
      );
    }
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
      loadPosts();
      sub.back();
    } catch {
      window.alert('삭제하지 못했습니다.');
    }
  }

  if (view === 'write') {
    // 지금 보던 게시판을 기본값으로. "전체"에서 눌렀으면 자유로 시작한다.
    return (
      <PostForm
        mode="write"
        initialCategory={category ?? 'free'}
        onCancel={() => sub.back()}
        onSubmit={handleCreatePost}
      />
    );
  }

  if (view === 'edit' && selectedPost) {
    return (
      <PostForm
        mode="edit"
        initialCategory={selectedPost.category}
        initialTitle={selectedPost.title}
        initialContent={selectedPost.content}
        initialSecret={selectedPost.secret === true}
        onCancel={() => sub.back()}
        onSubmit={handleUpdatePost}
      />
    );
  }

  if (view === 'detail' && selectedPost) {
    return (
      <PostDetail
        post={selectedPost}
        comments={comments}
        commentsLoading={commentsLoading}
        loggedIn={loggedIn}
        isAdmin={isAdmin}
        onBack={() => sub.back()}
        onSubmitComment={handleCreateComment}
        onDelete={handleDeletePost}
        onEdit={() => { setView('edit'); sub.push({ v: 'edit', id: selectedPost.id }); }}
        onToggleLike={handleToggleLike}
        onTogglePin={handleTogglePin}
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
            ? '아직 글이 없습니다. 첫 글을 남겨보세요.'
            : `${CATEGORY_LABEL[category]}게시판에 아직 글이 없습니다. 첫 글을 남겨보세요.`
        }
        posts={posts}
        loading={postsLoading}
        loggedIn={loggedIn}
        onOpen={openPost}
        onWrite={() => { setView('write'); sub.push({ v: 'write' }); }}
        onRequestLogin={onRequestLogin}
      />
    </div>
  );
}
