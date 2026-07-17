import { useEffect, useState } from 'react';
import { fetchTitleFeedback, type TitleFeedback } from '../api/localStats';

// 운영자만 보는, 카드 이름 한글화 신고 목록. 화면에 보였던 제목과 원본 링크를 함께 보여줘,
// 링크로 실제 일본어 이름을 확인하고 koreanizeTitle 사전을 보탤 수 있게 한다.
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

  return (
    <div>
      <h2 className="text-base font-bold text-black mb-1">카드 이름 신고</h2>
      <p className="text-xs text-neutral-400 mb-4">
        사용자가 이름이 이상하다고 알려준 카드예요. 원본을 눌러 실제 이름을 확인하고 한글화를 고치세요.
      </p>

      {loading ? (
        <p className="text-sm text-neutral-400 py-8 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-sm text-neutral-400 py-8 text-center">신고 목록을 불러오지 못했습니다.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-400 py-8 text-center rounded-xl border border-dashed border-neutral-200">
          아직 신고가 없어요.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={`${item.at}-${i}`} className="rounded-xl border border-neutral-200 p-3">
              <p className="text-sm font-semibold text-black break-words">{item.title}</p>
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
          ))}
        </ul>
      )}
    </div>
  );
}
