import { useRef, useState } from 'react';
import { scanCard, type CardScanResult, type ScanStage } from '../api/cardScan';
import { trackEvent } from '../api/localStats';

export function CardScanButton({
  onResult,
  onStart,
  onError,
  failed,
}: {
  /**
   * 방금 사진으로 찾기가 실패했나. **단추 자신이 빨개져서** 무엇이 실패했는지 가리킨다.
   *
   * ⚠️⚠️ **글자도 폭도 안 바꾼다.** 「사진」을 「못 읽음」으로 바꾸면 단추가 넓어져
   *    옆 검색바가 그만큼 줄어든다 — 사장님이 제일 중요하다고 하신 「화면이 안 움직이는 것」이
   *    깨진다(2026-08-29). 테두리와 글자 **색만** 바꾼다.
   * ⚠️ 왜 실패했는지는 **아래 안내 줄**이 말한다. 여기서 말하려 들면 폭이 바뀐다.
   */
  failed?: boolean;
  /**
   * 스캔이 실패했는지 알린다. **글은 App이 그린다** — 이 부품 안에서 그리면 안 된다.
   * ⚠️ 글이 아니라 **참/거짓**만 넘긴다. 문구가 화면 폭에 따라 달라지는데(폰은 짧게),
   *    그 판단은 자리를 아는 App이 해야 한다.
   *
   * ⚠️⚠️ 예전엔 여기 `<p>`로 직접 그렸는데, 이 부품이 검색 줄의 **flex 칸 하나**라서
   *    「카드 인식에 실패했습니다」가 뜨는 순간 그 칸이 글자 폭만큼 넓어졌다. 폰(375px)
   *    실측으로 **검색바가 257px → 209px, 48px를 뺏겼다**(2026-08-29 사장님 지적:
   *    「검색바랑 마켓 선택칸이 벌어지더라」). 게다가 줄 높이까지 늘어 검색창과 판 토글이
   *    떨어졌다 — 2026-08-06에 「검색바랑 토글은 붙어 있는 게 이쁘다」고 정한 것과 어긋난다.
   * ⚠️ 그래서 스캔 관련 글은 **토글 줄 아래 한자리**에 모은다(그때 옮겨 둔 그 자리다).
   */
  onError?: (failed: boolean) => void;
  // 소스별로 다른 검색어를 준다. SNKRDUNK는 언어 무관한 "세트+번호"라 항상 확실하고,
  // 이베이는 영어 이름이 필요하다. App이 소스에 맞춰 고른다. result는 "틀렸습니다" 신고용.
  /** 사진을 고른 **직후** 불린다. 부모가 사전 같은 무거운 것을 미리 읽어 두는 데 쓴다 —
   *  모델이 사진을 읽는 2~3초 동안 겹쳐 두면 결과가 온 뒤 기다릴 게 없다. */
  onStart?: () => void;
  onResult: (q: {
    snkrdunk: string;
    ebay: string;
    edition: 'japanese' | 'english';
    result: CardScanResult;
  }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<ScanStage>('사진 준비 중');
  // 오류 글은 App이 그린다(위 `onError` 설명). 여기서는 알리기만 한다.
  const setError = (실패: boolean) => onError?.(실패);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    trackEvent('scan');
    onStart?.();
    setLoading(true);
    setError(false);
    try {
      const result = await scanCard(file, setStage);
      if (!result.found) {
        setError(true);
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
        setError(true);
      }
    } catch {
      // ⚠️ 방문자에게 이 둘은 **같은 뜻**이다 — 「사진으로 못 찾았다」. 문구를 하나로 둔다.
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    // ⚠️ **이 칸은 단추 폭 그대로여야 한다.** 안에 글을 그리면 그 폭만큼 칸이 넓어져
    //    옆 검색바를 잡아먹는다(위 `onError` 설명). `shrink-0`으로 못 박아 둔다.
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        title="카드 사진으로 검색 (촬영 또는 앨범)"
        // ⚠️ 예전엔 글자 없는 46x46 아이콘 하나였다. 설명이 title(마우스 올림)에만
        //    있어 폰에서는 영영 안 보였고, aria-label도 없었다. 정작 카드 이름을
        //    모르는 사람이 이 버튼을 제일 필요로 한다(2026-08-04).
        aria-label="카드 사진으로 검색"
        // ⚠️ 폰에서는 여백을 한 단계 줄인다(사장님 지시 2026-08-29: 「검색바가 좀 더
        //    길었으면」). 글자·아이콘은 그대로 두고 **좌우 여백과 사이만** 줄여 8px을
        //    검색바에 넘긴다. 넓은 화면은 자리가 넉넉하니 예전 그대로 둔다.
        className={`flex h-[46px] items-center justify-center gap-1 rounded-xl border bg-white px-2.5 hover:bg-neutral-50 disabled:opacity-50 sm:gap-1.5 sm:px-3 ${
          failed ? 'border-rose-400 text-rose-500' : 'border-neutral-300 text-neutral-600'
        }`}
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
        {/* 도는 동안은 단계 글로 바꾼다 — 「사진 준비 중 → 카드 읽는 중」. */}
        <span className="whitespace-nowrap text-sm font-semibold">
          {loading ? (
            stage
          ) : (
            <>
              사진<span className="hidden sm:inline">으로 찾기</span>
            </>
          )}
        </span>
      </button>
      {/* capture 속성을 빼면 폰에서 "사진 찍기 / 앨범에서 선택"을 함께 고를 수 있다.
          카드가 손에 없거나 즉석에서 찍기 어려운 상황을 위해 보관함 선택도 허용한다. */}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
    </div>
  );
}
