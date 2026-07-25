import { useEffect, useState } from 'react';
import { clearTitleFeedback, deleteTitleFeedback, fetchTitleFeedback, type TitleFeedback } from '../api/localStats';
import { koreanizeTitle } from '../lib/koreanizeTitle';

// 운영자만 보는, 카드 이름 한글화 신고 목록. 화면에 보였던 제목과 원본 링크를 함께 보여줘,
// 링크로 실제 일본어 이름을 확인하고 koreanizeTitle 사전을 보탤 수 있게 한다. 처리 끝난
// 신고는 삭제할 수 있어 "할 일 목록"처럼 쓴다.
function formatWhen(ms: number): string {
  const d = new Date(ms);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}.${d.getDate()}(${wd}) ${hh}:${mm}`;
}

export function TitleFeedbackList() {
  const [items, setItems] = useState<TitleFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchTitleFeedback()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(at: number) {
    // 낙관적 제거 — 실패하면 되돌린다.
    const prev = items;
    setItems((list) => list.filter((x) => x.at !== at));
    try {
      await deleteTitleFeedback(at);
    } catch {
      setItems(prev);
    }
  }

  async function handleClearAll() {
    if (!window.confirm('신고 목록을 전부 지울까요?')) return;
    const prev = items;
    setItems([]);
    try {
      await clearTitleFeedback();
    } catch {
      setItems(prev);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-black">카드 이름 신고</h2>
        {items.length > 0 && (
          <button type="button" onClick={handleClearAll} className="text-xs text-neutral-400 hover:text-rose-500">
            전체 삭제
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-400 mb-4">
        사용자가 이름이 이상하다고 알려준 카드예요. 원본을 눌러 실제 이름을 확인하고 한글화를 고친 뒤, 처리한 신고는 삭제하세요.
      </p>

      {loading ? (
        <p className="text-sm text-neutral-400 py-8 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-sm text-neutral-400 py-8 text-center">신고 목록을 불러오지 못했습니다.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-400 py-8 text-center rounded-xl border border-dashed border-neutral-200">
          신고가 없습니다. (처리 완료)
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => {
            // 원본이 있으면 최신 사전으로 다시 변환한 "지금 이름"을 보여준다. 신고 당시
            // 이름과 다르면 고쳐진 것이고, 같으면 아직 그대로다.
            const now = item.raw ? koreanizeTitle(item.raw) : item.title;
            const fixed = !!item.raw && now !== item.title;
            return (
            <li key={`${item.at}-${i}`} className="rounded-xl border border-neutral-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-black break-words">{now}</p>
                  {fixed ? (
                    <p className="mt-0.5 text-xs text-neutral-400 break-words line-through">{item.title}</p>
                  ) : (
                    item.raw && <p className="mt-0.5 text-[11px] font-semibold text-amber-600">아직 그대로예요</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(item.at)}
                  aria-label="신고 삭제"
                  className="flex-shrink-0 text-neutral-300 hover:text-rose-500"
                >
                  ✕
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-400">{formatWhen(item.at)}</span>
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-[#2a78d6] hover:underline flex-shrink-0"
                  >
                    원본 보기 ↗
                  </a>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
