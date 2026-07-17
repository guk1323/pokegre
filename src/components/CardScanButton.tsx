import { useRef, useState } from 'react';
import { scanCard } from '../api/cardScan';

export function CardScanButton({
  onResult,
}: {
  // 소스별로 다른 검색어를 준다. SNKRDUNK는 언어 무관한 "세트+번호"라 항상 확실하고,
  // 이베이는 영어 이름이 필요하다. App이 소스에 맞춰 고른다.
  onResult: (q: { snkrdunk: string; ebay: string; edition: 'japanese' | 'english' }) => void;
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
      if (!result.found) {
        setError('카드를 인식하지 못했어요. 다시 찍어보세요.');
        return;
      }
      // SNKRDUNK: "세트+번호"(예: M4 086/083)는 언어와 무관해 이름 오독에도 안 흔들리고
      // 그 카드 한 장으로 좁혀진다. 이베이: 영어 색인이라 영어 이름+번호가 필요하다.
      // 번호를 못 읽었으면 둘 다 영어 이름만으로 후보를 좁혀 사용자가 고른다.
      const num = result.cardNumber;
      const snkrdunk = num ? [result.setCode, num].filter(Boolean).join(' ') : (result.pokemonNameEn ?? '');
      const ebay = num ? [result.pokemonNameEn, num].filter(Boolean).join(' ') : (result.pokemonNameEn ?? '');
      if (snkrdunk || ebay) {
        // 'english'만 북미판으로, 그 외(japanese·korean 등)는 전부 일본판 시장으로.
        onResult({ snkrdunk, ebay, edition: result.edition === 'english' ? 'english' : 'japanese' });
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
