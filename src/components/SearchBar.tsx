import { useEffect, useRef, useState, type ReactNode } from 'react';

// ⚠️ `cardboard`는 **새로 깐 길**이다(2026-08-12). eBay·TCGplayer와 같은 자료를 쓰지만
//    저쪽에 묻지 않고 받아 둔 덤프에서 꺼낸다(크레딧 0). 옛 둘은 그대로 둔다 —
//    사장님 지시로 나란히 놓고 견주는 중이다(src/api/cardBoard.ts 설명 참고).
// ⚠️ 옛 해외 시세('ebay'·'tcgplayer')는 2026-08-13에 지웠다.
export type SearchSource = 'snkrdunk' | 'cardboard' | 'cardboard_tcg';
const SOURCE_LABEL: Record<SearchSource, string> = {
  snkrdunk: 'SNKRDUNK',
  // 해외 시세의 두 마켓. **같은 값을 보는 눈이 둘일 뿐**이라 이름은 마켓 이름 그대로 쓴다.
  cardboard: 'eBay',
  cardboard_tcg: 'TCGplayer',
};
// 마켓마다 칩 색을 달리한다. 색이 바뀌는 것만으로도 "여기가 바뀌는 자리"임이 읽힌다
// (2026-08-07 운영자 지시). 사이트가 흑백 기조라 원색은 피하고, 각 마켓이 실제로 쓰는
// 색을 낮은 채도로 가져왔다 — 스니커덩크는 검정 그대로, 이베이는 파랑, TCGplayer는 주황.
// ⚠️ 흰 글자가 얹히므로 너무 밝은 색은 안 된다(대비).
const SOURCE_CHIP: Record<SearchSource, string> = {
  snkrdunk: 'bg-neutral-900',
  cardboard: 'bg-blue-700',
  cardboard_tcg: 'bg-orange-600',
};

export function SearchBar({
  value,
  onChange,
  onFocus,
  onBlur,
  onSubmit,
  onKeyNav,
  onClear,
  source,
  onSourceChange,
  sources,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  // 지우기(x)를 눌렀을 때. 안 주면 그냥 검색어만 비운다.
  // ⚠️ 홈 검색창은 이걸로 홈까지 되돌린다 — 검색어만 비우면 골라 둔 카드나 사진 검색
  //    맥락이 남아, 홈으로 가려면 새로고침을 해야 했다(운영자 지적 2026-08-05).
  onClear?: () => void;
  // 자동완성 목록을 방향키로 오르내리게 한다. 위/아래/Escape를 위쪽에서 처리하고,
  // 처리했으면 true를 돌려준다(그때는 기본 동작인 커서 이동을 막는다).
  onKeyNav?: (key: 'ArrowDown' | 'ArrowUp' | 'Escape' | 'Enter') => boolean;
  // 어느 마켓에서 찾을지. 검색창 안 왼쪽에 넣는다 — 예전엔 검색창 아래 한 줄을
  // 통째로 차지했다(2026-08-05 운영자 지시로 합침).
  source?: SearchSource;
  onSourceChange?: (s: SearchSource) => void;
  /** 목록에 보일 마켓. 안 주면 셋 다. 탭이 고른 갈래만 보이게 할 때 쓴다. */
  sources?: SearchSource[];
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // ── 한글 조합 중 엔터 ────────────────────────────────────────────────────────
  //
  // ⚠️⚠️ **한글은 마지막 글자가 아직 "조합 중"일 때 엔터가 들어온다.** 그 상태에서
  //    `blur()`로 입력칸을 떠나면 브라우저가 조합을 확정하며 **그 글자를 한 번 더 넣는다** —
  //    "리자몽"을 치고 엔터를 눌렀는데 "리자몽몽"이 됐다(사장님 지적 2026-08-10).
  //    영문은 조합이 없어서 이 일이 안 난다. 그래서 영문으로만 눌러 보면 못 잡는다.
  //
  //    → 조합 중 엔터는 **아무것도 하지 않고 표시만 남긴다.** 조합이 끝나는 순간
  //      (compositionend) 그때 검색한다. 그래야 **한 번만 눌러도** 검색된다
  //      (조합 중 엔터를 그냥 무시해 버리면 두 번 눌러야 해서 그것도 불편하다).
  const 조합중 = useRef(false);
  const 엔터기다림 = useRef(false);
  // ⚠️ `onSubmit`은 렌더마다 새로 만들어진다. 조합이 끝난 뒤에 부르려면 **그때의 최신 것**을
  //    잡아야 한다 — 옛 것을 부르면 방금 친 글자가 빠진 검색어로 찾는다.
  const 제출 = useRef(onSubmit);
  제출.current = onSubmit;
  const 키움직임 = useRef(onKeyNav);
  키움직임.current = onKeyNav;
  /** 엔터를 실제로 처리한다. 조합이 없을 땐 바로, 조합 중이면 끝난 뒤에 부른다. */
  const 엔터하기 = (el: HTMLInputElement) => {
    // 목록에서 고른 항목이 있으면 그것으로 검색한다(키보드는 그대로 둔다 —
    // 고른 말이 검색창에 들어가는 게 보여야 한다).
    if (키움직임.current?.('Enter')) return;
    el.blur();
    제출.current?.();
  };
  // 바깥을 누르면 닫는다. 목록을 열어 둔 채 다른 데를 눌렀을 때 걸려 있으면 답답하다.
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);

  const hasSource = !!source && !!onSourceChange;
  return (
    <div className="relative">
      {hasSource ? (
        <div ref={wrapRef} className="absolute left-1.5 top-1/2 z-20 -translate-y-1/2">
          <button
            type="button"
            // ⚠️ onMouseDown으로 blur를 막는다. 안 막으면 검색창이 포커스를 잃으며
            //    자동완성이 닫히는 동작과 겹쳐 클릭이 씹힌다(지우기 버튼과 같은 이유).
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((v) => !v)}
            aria-label={`검색할 마켓: ${SOURCE_LABEL[source]}`}
            // ⚠️ 폰에서 누를 자리를 44px로 넓힌다(28px이었다). 보이는 알약은 그대로 두고
            //    before로 투명한 여백만 두른다 — 검은 알약을 키우면 검색창을 덮는다.
            className={`relative flex items-center gap-1 rounded-lg ${SOURCE_CHIP[source]} py-1.5 pl-2.5 pr-2 text-xs font-bold text-white before:absolute before:-inset-y-2 before:-inset-x-1.5 before:content-['']`}
          >
            {SOURCE_LABEL[source]}
            {/* ⚠️ 예전엔 작은 '▾' 하나였다. 그것만으로는 "여기서 마켓을 바꿀 수 있다"가
                안 읽혀, 방문 기록이 스니커덩크 2,016회에 이베이 156·TCGplayer 85로
                쏠려 있었다(2026-08-07 운영자 지적). 좌우 화살표는 '바꾸기'로 바로 읽히고,
                자리는 그대로다 — 줄을 새로 만들면 예전에 싫다고 하신 배치로 돌아간다. */}
            <svg
              className="h-3 w-3 opacity-90"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M7 4L3 8l4 4" />
              <path d="M3 8h13" />
              <path d="M17 20l4-4-4-4" />
              <path d="M21 16H8" />
            </svg>
          </button>
          {open && (
            <div className="absolute left-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
              {/* ⚠️ 탭(일본 매물 / 해외 시세)이 생긴 뒤로는 **그 탭에 속한 마켓만** 보여
                  준다. 안 그러면 「해외 시세」 탭에서 스니커덩크를 고를 수 있어 탭과
                  어긋난다(2026-08-09). `sources`를 안 주면 예전처럼 셋 다 나온다. */}
              {(sources ?? (Object.keys(SOURCE_LABEL) as SearchSource[])).map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSourceChange(s);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold ${
                    s === source ? 'bg-neutral-100 text-black' : 'text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {/* 칩과 같은 색 점. 목록에서 고르기 전에 어느 색인지 이어진다. */}
                  <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_CHIP[s]}`} aria-hidden />
                  {SOURCE_LABEL[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      )}
      {/* 안내문구는 짧게. 폰 화면(375px)에서는 20자 남짓만 보이는데 예전 문구는 55자라
          "팩 이릅"에서 잘려 무슨 말인지 알 수 없었다. */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          // ⚠️ **조합 표시를 여기서 반드시 내린다.** 조합 도중에 다른 데를 눌러 떠나면
          //    `compositionend`가 안 올 수 있는데, 그러면 표시가 켜진 채 남아 **그 뒤로
          //    엔터가 통째로 안 먹는다.** 기다리던 엔터도 같이 버린다(떠났으니 검색 안 한다).
          조합중.current = false;
          엔터기다림.current = false;
          onBlur?.();
        }}
        // 엔터(폰 키보드의 "검색")를 누르면 자동완성을 닫고 키보드를 내린다. 예전에는
        // 검색창 밖을 따로 눌러야 닫혀서, 결과가 나와도 자동완성이 그 위를 덮고 있었다.
        onCompositionStart={() => {
          조합중.current = true;
        }}
        onCompositionEnd={(e) => {
          조합중.current = false;
          if (!엔터기다림.current) return;
          엔터기다림.current = false;
          // ⚠️ `currentTarget`은 이 함수가 끝나면 비워지므로 **먼저 잡아 둔다.**
          const el = e.currentTarget;
          // ⚠️ 조합이 끝나며 들어온 글자가 상태에 반영된 **다음에** 검색한다. 바로 부르면
          //    마지막 글자가 빠진 말로 찾는다.
          setTimeout(() => 엔터하기(el), 0);
        }}
        onKeyDown={(e) => {
          // ⚠️ 조합 중에는 브라우저가 keyCode 229를 보낸다. `isComposing`이 표준이고,
          //    안 오는 브라우저를 위해 우리 표시(조합중)도 같이 본다.
          if (e.nativeEvent.isComposing || 조합중.current) {
            // 조합 중 엔터는 여기서 **아무것도 안 한다.** 조합이 끝나면 그때 검색한다.
            if (e.key === 'Enter') 엔터기다림.current = true;
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape') {
            // 위/아래는 커서를 글자 끝으로 보내려 하므로, 목록을 움직였으면 막는다.
            if (onKeyNav?.(e.key)) e.preventDefault();
            return;
          }
          if (e.key !== 'Enter') return;
          엔터하기(e.currentTarget);
        }}
        enterKeyHint="search"
        // ⚠️ 소스 칩이 왼쪽 자리를 먹으므로 안내문구가 더 짧아야 한다. 폰(375)에서
        //    "카드 이름 검색 · 시세 확인"은 "· "에서 잘려 말이 끊겨 보였다(2026-08-05).
        placeholder={hasSource ? '카드 이름 검색' : '카드 이름 검색 · 시세 확인'}
        // ⚠️ 왼쪽 여백은 소스 칩이 있으면 그만큼 벌린다. 안 벌리면 글자가 칩 밑으로
        //    들어가 가려진다. 칩 글자 길이가 SNKRDUNK·TCGplayer로 달라서 넉넉히 잡는다.
        className={`w-full rounded-xl border border-neutral-300 bg-white py-3 pr-10 text-sm text-black placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black ${
          hasSource ? 'pl-[7.5rem]' : 'pl-10'
        }`}
      />
      {/* 검색어가 있을 때만 오른쪽 끝에 지우기(X). onMouseDown로 blur를 막아 눌러도
          자동완성이 먼저 닫혀 클릭이 씹히는 일이 없게 한다. */}
      {value && (
        <button
          type="button"
          aria-label="검색어 지우기"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (onClear ? onClear() : onChange(''))}
          // ⚠️ 보이는 동그라미는 24px 그대로 두고, 누를 자리만 44px로 넓힌다(before는
          //    투명하다). 동그라미 자체를 키우면 검색창 안에서 회색 원이 커 보인다.
          //    자주 쓰는 버튼인데 24px은 손가락으로 놓치기 쉽다(운영자 지시 2026-08-06).
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 before:absolute before:-inset-2.5 before:content-['']"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {children}
    </div>
  );
}
