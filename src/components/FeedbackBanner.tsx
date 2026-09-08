import { useState } from 'react';
import { sendFeedback } from '../api/feedback';
import { trackEvent } from '../api/localStats';

// 홈의 배너(2026-08-21 의견함 · 2026-08-23부터 공지도 같이 싣는다 · 사장님 지시).
// 자리는 하나뿐이라 **공지와 의견함을 한 장에 담는다** — 편지 한 통에 사과를 적고
// 그 끝에 의견을 여쭙는 **편지 꼴**이다.
//
// ⚠️ 한 번 닫으면 다시 안 뜬다. 새 공지를 올릴 땐 아래 제목·날짜·본문을 바꾸고
//    **DISMISS_KEY·SENT_KEY 뒤 날짜도 함께** 바꾼다(닫았던 사람에게도 다시 뜬다).
// ⚠️ 앞일을 못 박는 말(무료·광고 없음·앞으로 계속)은 쓰지 않는다.
// ⚠️ 사과는 **겪은 일과 한 조치**만 적는다. 안쪽 사정(메모리·청소 코드)은 안 적는다 —
//    오시는 분에게는 「언제 안 됐고, 지금은 되나」만 뜻이 있다.
const DISMISS_KEY = 'pokegre_feedback_dismissed_v20260823';
// 보낸 사람에게는 의견 칸을 다시 안 내민다 — 같은 사람에게 계속 물으면 성가시다.
// (공지 글은 그래도 보인다. 사과는 보낸 사람도 봐야 한다.)
const SENT_KEY = 'pokegre_feedback_sent_v20260823';

const TITLE = '접속 장애 안내';
const NOTICE_DATE = '2026년 8월 23일';
const HELLO = '안녕하세요. pokegre 운영자입니다.';
const SORRY =
  '오늘 저녁 6시경부터 8시 15분경까지 사이트가 열리지 않았습니다. 이용에 불편을 드려 죄송합니다.';
const FIXED = '서버가 감당할 수 있는 양을 넘어서면서 멈췄습니다. 원인을 찾아 서버를 늘리고 고쳤습니다.';
const ASK = '쓰시면서 불편한 점이나 고쳤으면 하는 점이 있으면 남겨 주세요.';
const SIGN = 'pokegre 올림.';

// 고개 숙여 인사하는 그림. 사이트가 흑백 톤이라 선 하나로 그리고 색은 글자색을 따른다.
// 포켓몬 캐릭터는 저작권이 있어 쓸 수 없으므로 직접 그린 그림이다.
// 고개 숙여 인사하는 그림. 사이트가 흑백 톤이라 선 하나로 그리고 색은 글자색을 따른다.
// 포켓몬 캐릭터는 저작권이 있어 쓸 수 없으므로 직접 그린 그림이다.
function BowingFigure({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className} fill="none">
      <path d="M21 58 L21 46" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M21 46 C22 38 28 33 36 31" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <path d="M30 36 C31 42 32 46 33 49" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="45" cy="28" r="11" fill="currentColor" />
      <path d="M54 12 L57 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <path d="M50 10 L51 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function saved(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function save(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // 시크릿 모드 등에서 저장이 막혀도 이번 세션에서는 동작하게 둔다.
  }
}

export function FeedbackBanner() {
  // ⚠️ 공지가 실려 있으므로 **의견을 이미 보낸 사람에게도 배너는 보인다.**
  //    (예전엔 보낸 사람에게 배너째로 안 보였다 — 그러면 사과를 못 읽는다.)
  const [shown, setShown] = useState(() => !saved(DISMISS_KEY));
  const [askShown] = useState(() => !saved(SENT_KEY));
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!shown) return null;

  function dismiss() {
    save(DISMISS_KEY);
    setShown(false);
  }

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError('');
    try {
      await sendFeedback(t);
      trackEvent('feedback');
      save(SENT_KEY);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative rounded-xl border border-neutral-200 bg-neutral-50 p-4 pr-10 sm:p-5 sm:pr-12">
      <button
        type="button"
        aria-label="공지 닫기"
        onClick={dismiss}
        /* ⚠️ 밝은 화면에서 neutral-400은 대비 2.48로 기준(4.5) 미달이었다 — 500으로 올렸다
           (2026-08-23 실측). 날짜 글씨도 같은 까닭으로 500이다. */
        className="absolute right-2 top-2 p-1.5 text-neutral-500 hover:text-black"
      >
        ✕
      </button>

      <div className="flex items-baseline gap-2">
        <p className="text-sm font-bold text-black">{TITLE}</p>
        <span className="text-[11px] font-semibold text-neutral-500">{NOTICE_DATE}</span>
      </div>

      {/* ⚠️ **단추를 글 흐름 안에 둔다.** 예전에는 글 아래 빈 줄에 홀로 놓여 있어
          넓은 화면에서 오른쪽이 텅 비고 단추가 동떨어져 보였다(사장님 지적 2026-08-23).
          편지 문장 사이에 넣고, 빈 오른쪽은 인사 그림이 받는다. */}
      <div className="mt-2.5 flex items-end gap-3">
        <div className="min-w-0 flex-1 text-sm leading-relaxed text-neutral-600">
          <p>{HELLO}</p>
          <p className="mt-3">{SORRY}</p>
          <p className="mt-2">{FIXED}</p>

          {done ? (
            <p className="mt-3">
              <b className="text-black">감사합니다.</b> 보내 주신 의견은 잘 읽고 사이트에 반영해 가겠습니다.
            </p>
          ) : askShown ? (
            <>
              <p className="mt-3">
                {ASK} <b className="text-neutral-800">운영자에게만 보입니다.</b>
              </p>
              {open ? (
                <div className="mt-2">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={500}
                    rows={3}
                    autoFocus
                    placeholder="예: 팝수 조회가 편합니다. 검색 결과에 ○○도 보이면 좋겠습니다."
                    className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-black placeholder:text-neutral-400"
                  />
                  {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      disabled={busy || !text.trim()}
                      onClick={submit}
                      className="inline-flex min-h-[44px] items-center rounded-lg bg-neutral-900 px-5 py-3 text-sm font-bold text-white hover:bg-neutral-700 disabled:opacity-40"
                    >
                      보내기
                    </button>
                    <span className="text-xs text-neutral-400">{text.length}/500</span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  /* ⚠️⚠️ **폰에서는 44px을 지키고, 넓은 화면에서만 줄인다**(사장님 2026-08-23:
                     「의견 쓰기 버튼을 좀 작게」). 손가락으로 누르는 자리는 44px 밑으로 내리면
                     헛누름이 늘어난다 — 그건 폰 이야기고, 마우스로 누르는 넓은 화면은 상관없다.
                     편지 안에 놓인 단추라 크면 사과보다 단추가 먼저 눈에 든다. */
                  className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-neutral-900 px-4 py-3 text-sm font-bold text-white hover:bg-neutral-700 sm:min-h-0 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-xs"
                >
                  의견 쓰기
                </button>
              )}
            </>
          ) : null}

          <p className="mt-3">{SIGN}</p>
        </div>
        {/* 인사말 옆에 세워 둔다. 좁은 화면에서는 글이 밀리므로 숨긴다. */}
        <BowingFigure className="hidden h-16 w-16 flex-shrink-0 text-neutral-300 sm:block sm:h-20 sm:w-20" />
      </div>
      {/* 폰에서는 글 아래 가운데에 작게 놓는다. */}
      <BowingFigure className="mx-auto mt-1 block h-14 w-14 text-neutral-300 sm:hidden" />
    </div>
  );
}
