import { useEffect, useState } from 'react';
import {
  fetchReports,
  resetReportedNickname,
  setCommentHidden,
  setPostHidden,
  type CommunityReport,
} from '../api/community';

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 운영자 전용 신고함. 이 화면을 감춰봐야 보안은 아니다 — 서버가 운영자가 아니면
// 신고 목록 자체를 안 준다. 여기서 숨기는 건 다른 사람 메뉴를 깔끔하게 두는 편의다.
export function ReportInbox() {
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  function load() {
    setLoading(true);
    fetchReports()
      .then(setReports)
      .catch((e) => setError(e instanceof Error ? e.message : '불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  // 금지어 목록으로 못 막은 닉네임을 실제로 처리하는 자리. 초기화하면 그 사람은
  // 다음에 들어올 때 닉네임을 다시 정해야 한다.
  async function resetNickname(report: CommunityReport) {
    if (!window.confirm(`"${report.author}" 닉네임을 지울까요? 다음 접속 때 새로 정하게 됩니다.`)) return;
    setBusyId(report.id);
    try {
      await resetReportedNickname(report.id);
      load();
    } catch {
      window.alert('초기화하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(report: CommunityReport) {
    setBusyId(report.id);
    try {
      const next = !report.isHidden;
      if (report.targetType === 'comment' && report.commentId != null) {
        await setCommentHidden(report.commentId, next);
      } else {
        await setPostHidden(report.postId, next);
      }
      load();
    } catch {
      window.alert('처리하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-neutral-400 py-12 text-center">불러오는 중...</p>;
  if (error) return <p className="text-sm text-rose-500 py-12 text-center">{error}</p>;

  return (
    <div>
      <h2 className="text-base font-bold text-black mb-1">신고함</h2>
      <p className="text-xs text-neutral-500 mb-4">
        가리기는 삭제가 아닙니다. 언제든 되살릴 수 있고 원문도 남습니다.
      </p>

      {reports.length === 0 ? (
        <p className="text-sm text-neutral-400 py-12 text-center rounded-xl border border-dashed border-neutral-200">
          신고된 글이 없습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-neutral-200 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-xs text-neutral-400">
                    {r.targetType === 'comment' ? '댓글' : '게시글'} · {formatDate(r.createdAt)}
                    {r.author && ` · ${r.author}`}
                  </p>
                  <p className="text-sm font-semibold text-black mt-0.5">
                    신고 사유: {r.reason || '(없음)'}
                  </p>
                </div>
                {r.isHidden && (
                  <span className="flex-shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                    가려짐
                  </span>
                )}
              </div>

              {r.exists ? (
                <>
                  {r.postTitle && <p className="text-xs text-neutral-500 mb-1">글 제목: {r.postTitle}</p>}
                  <p className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-800 whitespace-pre-wrap mb-3">
                    {r.excerpt}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => toggle(r)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                        r.isHidden
                          ? 'border border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                          : 'bg-neutral-900 text-white hover:bg-neutral-700'
                      }`}
                    >
                      {r.isHidden ? '되살리기' : '가리기'}
                    </button>
                    {r.author && (
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => resetNickname(r)}
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        닉네임 초기화
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-neutral-400">신고된 글이 이미 삭제되었습니다.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
