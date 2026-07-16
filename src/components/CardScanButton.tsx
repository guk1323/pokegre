import { useRef, useState } from 'react';
import { scanCard } from '../api/cardScan';

export function CardScanButton({
  onResult,
}: {
  onResult: (query: string, edition: 'japanese' | 'english') => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const result = await scanCard(file);
      // "영어 이름 + 번호"는 SNKRDUNK(영어→일본카드로 연결)와 이베이(영어 색인) 양쪽에서
      // 똑같이 그 카드 한 장으로 좁혀지는 공용 열쇠다. 그래서 소스와 무관하게 이걸로 찾는다.
      // (일본 세트코드는 이베이에서 안 먹혀서 안 쓴다.) 번호를 못 읽었으면 이름만으로 후보를
      // 좁혀 사용자가 고른다.
      const query = result.found
        ? [result.pokemonNameEn, result.cardNumber].filter(Boolean).join(' ')
        : '';
      if (query) {
        onResult(query, result.edition ?? 'japanese');
      } else {
        setError('카드를 인식하지 못했어요. 다시 찍어보세요.');
      }
    } catch {
      setError('카드 인식에 실패했어요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        title="카드 촬영으로 검색"
        className="flex h-[46px] w-[46px] items-center justify-center rounded-xl border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-black" />
        ) : (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 13a3 3 0 100 6 3 3 0 000-6z" />
          </svg>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleChange} className="hidden" />
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </div>
  );
}
