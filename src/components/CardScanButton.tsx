import { useRef, useState } from 'react';
import { scanCard, type CardScanResult } from '../api/cardScan';
import { trackEvent } from '../api/localStats';

export function CardScanButton({
  onResult,
}: {
  // 소스별로 다른 검색어를 준다. SNKRDUNK는 언어 무관한 "세트+번호"라 항상 확실하고,
  // 이베이는 영어 이름이 필요하다. App이 소스에 맞춰 고른다. result는 "틀렸습니다" 신고용.
  onResult: (q: {
    snkrdunk: string;
    ebay: string;
    edition: 'japanese' | 'english';
    result: CardScanResult;
  }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    trackEvent('scan');
    setLoading(true);
    setError(null);
    try {
      const result = await scanCard(file);
      if (!result.found) {
        setError('카드를 인식하지 못했습니다. 다시 찍어보세요.');
        return;
      }
      // SNKRDUNK: "세트+번호"(예: M4 086/083)는 언어와 무관해 이름 오독에도 안 흔들리고
      // 그 카드 한 장으로 좁혀진다. 이베이: 영어 색인이라 영어 이름+번호가 필요하다.
      // 번호를 못 읽었으면 둘 다 영어 이름만으로 후보를 좁혀 사용자가 고른다.
      const num = result.cardNumber;
      const snkrdunk = num ? [result.setCode, num].filter(Boolean).join(' ') : (result.pokemonNameEn ?? '');
      const ebay = num ? [result.pokemonNameEn, num].filter(Boolean).join(' ') : (result.pokemonNameEn ?? '');
      if (snkrdunk || ebay) {
        // 'english'만 영문판으로, 그 외(japanese·korean 등)는 전부 일본판 시장으로.
        onResult({ snkrdunk, ebay, edition: result.edition === 'english' ? 'english' : 'japanese', result });
      } else {
        setError('카드를 인식하지 못했습니다. 다시 찍어보세요.');
      }
    } catch {
      setError('카드 인식에 실패했습니다.');
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
        title="카드 사진으로 검색 (촬영 또는 앨범)"
        // ⚠️ 예전엔 글자 없는 46x46 아이콘 하나였다. 설명이 title(마우스 올림)에만
        //    있어 폰에서는 영영 안 보였고, aria-label도 없었다. 정작 카드 이름을
        //    모르는 사람이 이 버튼을 제일 필요로 한다(2026-08-04).
        aria-label="카드 사진으로 검색"
        className="flex h-[46px] items-center justify-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-3 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
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
        {/* 폰은 자리가 빠듯해 "사진" 두 글자, 큰 화면은 다 적는다. */}
        <span className="whitespace-nowrap text-sm font-semibold">
          사진<span className="hidden sm:inline">으로 찾기</span>
        </span>
      </button>
      {/* capture 속성을 빼면 폰에서 "사진 찍기 / 앨범에서 선택"을 함께 고를 수 있다.
          카드가 손에 없거나 즉석에서 찍기 어려운 상황을 위해 보관함 선택도 허용한다. */}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </div>
  );
}
