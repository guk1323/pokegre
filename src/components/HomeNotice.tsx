import { useState } from 'react';
import { trackEvent } from '../api/localStats';
import { thumb } from '../lib/cardImg';
import 공지 from '../data/homeNotice.json';

// 홈 맨 위에 잠깐 띄우는 **공지**. 지금은 「한글판 30주년 추첨 응모」가 들어 있다
// (사장님 지시 2026-09-04: "열리면 바로 홈화면에 공지처럼 띄우게", "응모 언제부터
//  언제까지고 언제 발표고 … 이미지도", "디자인 좀 더 이쁘게").
//
// ⚠️⚠️ **글·그림·켜고 끄기가 전부 `src/data/homeNotice.json`에 있다.** 공지를 바꿀 때
//    이 파일을 열 일이 없어야 한다.
// ⚠️ **운영자 인사말(OnboardingBanner)과 다른 물건이다.** 그건 편지 꼴로 길게 쓰는
//    자리이고, 이건 **때를 놓치면 안 되는 한 가지**를 알리는 자리다. 둘을 겹쳐 띄우지
//    않는다 — 홈 맨 위가 두 겹이 되면 정작 검색창이 밀린다.
// ⚠️ **앞일을 못 박는 말은 쓰지 않는다**(사장님 방침). 「반드시 당첨」·「최저가」 같은
//    말은 안 된다. 우리가 파는 것도 아니고 조건이 바뀔 수 있다.
// ⚠️⚠️ **모르는 것은 비워 둔다.** 빈 항목은 저절로 안 그려진다 — 기간·발표일을 지어내
//    적으면 사람을 헛걸음시킨다. 아는 것만 적고 나머지는 공식 안내로 보낸다.

type 항목 = { 이름: string; 값: string };
type 공지꼴 = {
  켬: boolean;
  제목: string;
  본문: string;
  /** 이름·값 짝. **첫 항목은 크게(응모 기간), 나머지는 한 줄씩** 적는다. 값이 빈 것은 안 그린다. */
  항목?: 항목[];
  /** 한눈에 볼 숫자 셋(발표·배송·가격). 값은 짧게, 곁말에 보탬말. 폰에서도 세 칸이라
   *  **값은 8자 안**으로 적는다 — 길면 칸이 줄바꿈되어 숫자판 꼴이 무너진다. */
  핵심?: { 이름: string; 값: string; 곁말?: string }[];
  /** 놓치면 헛돈 쓰는 단서 한 줄(딴 상품과 헷갈리기 쉬운 것 등). 비우면 안 그린다. */
  주의?: string;
  /** 공식 안내 그림. `/`로 시작하면 우리 파일, 아니면 바깥 주소(그림 창구를 태운다).
   *  ⚠️ 바깥 주소는 `IMG_ALLOWED_HOSTS`에 그 호스트가 있어야 뜬다(server/api.ts). */
  그림?: string;
  그림설명?: string;
  링크글: string;
  링크: string;
  /** "2026-09-13" — 이 날이 지나면 저절로 안 뜬다. 비우면 끌 때까지 뜬다.
   *  ⚠️ 지난 공지가 홈에 남아 있는 것이 제일 나쁘다 — 응모가 끝났는데 「응모 중」이라고
   *     적혀 있으면 사람을 헛걸음시킨다. 마감일을 아는 공지는 반드시 적어 둔다. */
  내릴날: string;
  /** 이 값을 바꾸면 **전에 닫은 사람에게도 다시** 뜬다. 새 공지마다 뒤 숫자를 올린다. */
  닫기열쇠: string;
};

const N = 공지 as 공지꼴;

function 이미닫았나(열쇠: string): boolean {
  try {
    return localStorage.getItem(열쇠) === '1';
  } catch {
    // 사파리 사생활 보호 모드에서는 읽기만 해도 오류가 난다. 그때는 그냥 띄운다.
    return false;
  }
}

/** 한국시간으로 그날 0시(끝날은 23:59:59)의 시각. 못 읽으면 NaN. */
const 한국시각 = (날: string, 끝 = false) =>
  new Date(`${날}T${끝 ? '23:59:59' : '00:00:00'}+09:00`).getTime();

/** 마감일이 지났나. 한국시간 기준으로 **그날 끝까지**는 띄운다. */
function 지났나(내릴날: string): boolean {
  if (!내릴날) return false;
  const 끝 = 한국시각(내릴날, true);
  return Number.isFinite(끝) && Date.now() > 끝;
}

export function HomeNotice() {
  const [닫음, set닫음] = useState(() => 이미닫았나(N.닫기열쇠));
  if (!N.켬 || 닫음 || 지났나(N.내릴날)) return null;

  const 적힌항목 = (N.항목 ?? []).filter((x) => x.이름 && x.값.trim());
  // 우리 파일(`/…`)은 그대로, 바깥 주소는 그림 창구를 태운다(직접 걸면 막힌다).
  const 그림주소 = N.그림 ? (N.그림.startsWith('/') ? N.그림 : thumb(N.그림, 560)) : '';

  // 첫 항목(응모 기간)은 **크게 따로** 세우고 나머지는 아래 작은 표로 간다.
  const [으뜸, ...나머지] = 적힌항목;

  // ⚠️⚠️ **「공식 안내 보기」 단추는 카드 맨 아래 「주의」 줄 오른쪽에 둔다.** 자리를 네 번 바꿨다:
  //    ① 맨 아래 홀로 → ② 머리말 줄 오른쪽(떠 보임) → ③ 「응모 기간」 줄 오른쪽(폰에서 혼자
  //    오른쪽으로 떨어짐) → ④ 그림 아래 가운데(정보보다 먼저 나와 읽는 순서가 거꾸로, 그림
  //    딸린 단추처럼 보임). 결론: **정보 → 주의 → 행동** 순서가 자연스럽다. 주의 글과 한
  //    줄에 두면 단추가 글에 붙어 있고, 폰에서는 **가로로 꽉 차게** 내려가 혼자 떠 보이지 않는다.
  const 단추 = N.링크 ? (
    <a
      href={N.링크}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent('home_notice', N.제목)}
      className="block shrink-0 whitespace-nowrap rounded-full bg-neutral-900 px-6 py-3 text-center text-[13.5px] font-bold text-white hover:bg-neutral-700 sm:inline-block sm:py-2.5"
    >
      {N.링크글}
    </a>
  ) : null;

  return (
    // ⚠️⚠️⚠️ **바탕에 쓸 수 있는 색이 정해져 있다.** 어두운 화면은 색 변수를 뒤집는데
    //    amber는 단계마다 뒤집히는 것과 아닌 것이 섞여 있다(**50은 뒤집히고 100·200은
    //    안 뒤집힌다** — 2026-09-04 두 번 실측). 글자는 neutral이라 늘 뒤집히므로,
    //    **안 뒤집히는 바탕 + 뒤집히는 글자**를 붙이면 대비가 1.1까지 떨어진다.
    //      · 바탕에 써도 되는 것 — `bg-neutral-*` · `bg-amber-50` (다 뒤집힌다)
    //      · 바탕에 쓰면 안 되는 것 — `bg-amber-100/200` · `bg-white/xx`
    //      · `border-amber-*`는 마음껏 — 테두리는 글자 대비와 상관이 없다.
    // ⚠️⚠️ **색을 거의 안 쓴다**(사장님 지시 2026-09-04 「조잡하지 않고 고급지고 깔끔하게」).
    //    노란 바탕에 알약을 늘어놓았더니 PC에서 줄바꿈이 나며 어수선했다. 지금은
    //    사이트의 여느 카드와 같은 **중립 바탕**에, 왼쪽 가는 선 하나만 색을 쓴다.
    //    눈에 띄는 몫은 **글자 크기 차이**가 맡는다.
    // ⚠️ **`break-keep`** — 한글은 기본이 글자 단위 줄바꿈이라 「포켓몬 스토」/「어 온라인」처럼
    //    단어 한가운데가 잘린다(사장님 2026-09-04 "한글로 읽을때 불편하지않게"). 띄어쓰기에서만 끊는다.
    <section className="relative mb-4 overflow-hidden rounded-2xl border border-neutral-200 border-l-[3px] border-l-amber-400 bg-gradient-to-br from-amber-50 via-neutral-50 to-neutral-50 break-keep">
      <div className="flex flex-col md:flex-row md:items-center">
        {/* ── 상품 그림 ──────────────────────────────────────────────
            ⚠️⚠️ **바탕 없는 그림(webp, 투명)이다.** 예전에는 어두운 판을 깔고 그 위에
               얹었는데 "그림 자리가 너무 크다"는 말을 들었다(사장님 2026-09-04).
               지금은 카드 바탕 위에 상품만 얹어서 자리를 적게 먹는다.
            ⚠️ 투명이라 **밝은·어두운 화면 둘 다에서 그대로** 쓴다 — 바탕색을 안 깔았으니
               맞출 색도 없다. 그림자는 CSS로 준다(그림에 구우면 어두운 화면에서 뜬다).
            ⚠️ 폰에서는 위로 올라가되 **높이를 h-28로 묶는다**. 안 묶으면 첫 화면을
               그림이 다 먹어 검색창이 밀린다. */}
        {그림주소 && (
          <div className="flex justify-center px-6 pt-7 md:w-56 md:shrink-0 md:px-0 md:py-8 md:pl-8 lg:w-64">
            <img
              src={그림주소}
              alt={N.그림설명 || N.제목}
              loading="lazy"
              decoding="async"
              className="h-32 w-auto drop-shadow-[0_10px_22px_rgba(0,0,0,0.20)] md:h-auto md:w-[86%]"
            />
          </div>
        )}

        <div className="min-w-0 flex-1 px-6 pb-6 pt-5 md:px-8 md:py-8">
          <button
            type="button"
            aria-label="공지 닫기"
            // ⚠️⚠️ 닫기 단추도 글자다 — 흐린 회색을 쓰면 기준(4.5)에 걸린다.
            //    `neutral-400`은 밝은 화면 2.48, `neutral-600`은 어두운 화면 2.09였다
            //    (2026-09-04 실측). **`neutral-700`이 두 화면에서 다 넘긴다.**
            // ⚠️ **색에 `transition`을 걸지 않는다.** 걸어 두면 밝은↔어두운을 바꾸는 동안
            //    글자색만 천천히 따라와 **잠깐 대비가 1.4까지 떨어진다**(재다가 잡았다).
            className="absolute right-3 top-3 z-10 rounded-lg px-2 py-1 text-lg leading-none text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
          onClick={() => {
              set닫음(true);
              try {
                localStorage.setItem(N.닫기열쇠, '1');
              } catch {
                /* 못 적어도 이번 화면에서는 닫힌다 */
              }
            }}
          >
            ×
          </button>

          <p className="flex items-center gap-1.5 pr-7 text-[11px] font-bold tracking-wide text-neutral-500">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            한글판 30주년 · 추첨 응모 안내
          </p>
          <h2 className="mt-2 pr-7 text-[19px] font-black leading-snug tracking-tight text-neutral-900 [text-wrap:balance] md:text-[22px]">
            {N.제목}
          </h2>
          {N.본문 && <p className="mt-2.5 text-[13.5px] leading-relaxed text-neutral-600 [text-wrap:pretty] lg:text-[14px]">{N.본문}</p>}

          {/* ── 으뜸 줄: 응모 기간 ─────────────────────────────────────
              ⚠️ 이 공지에서 사람이 알고 싶은 건 결국 **언제까지냐** 하나다. 첫 항목만
                 따로 크게 세운다.
              ⚠️ **「시작까지 N일」 같은 남은 날 딱지는 붙이지 않는다**(사장님 지시
                 2026-09-04 "시작까지 4일 이런건 없애"). 날짜만 적는다. */}
          {으뜸 && (
            <div className="mt-6 border-t border-neutral-200 pt-5">
              <p className="text-[11px] font-bold tracking-wide text-neutral-500">{으뜸.이름}</p>
              <p className="mt-1 text-[22px] font-black leading-tight tracking-tight text-neutral-900 md:text-[26px]">
                {으뜸.값}
              </p>
            </div>
          )}

          {/* ── 숫자판: 발표 · 배송 · 가격을 세 칸으로. 표 한 줄보다 눈에 빨리 들어온다. */}
          {(N.핵심 ?? []).filter((x) => x.값.trim()).length > 0 && (
            <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
              {(N.핵심 ?? []).filter((x) => x.값.trim()).map((x) => (
                <div key={x.이름} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 sm:px-4 sm:py-3">
                  <p className="text-[11px] font-bold text-neutral-500">{x.이름}</p>
                  <p className="mt-0.5 text-[14px] font-black leading-tight tracking-tight text-neutral-900 sm:text-[15px]">
                    {x.값}
                  </p>
                  {x.곁말 && <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{x.곁말}</p>}
                </div>
              ))}
            </div>
          )}

          {/* ── 나머지: 이름·값 표. **늘 한 칸이다.**
              ⚠️⚠️ 두 칸으로 나누지 않는다(사장님 지시 2026-09-04 "줄바꿈이 많은건 별로야
                 차라리 한줄로 길게가 낫지"). 두 칸으로 쪼개면 칸이 300px로 좁아져
                 「1박스 70,000원 무료배송 · 구성: 20팩 × 6장 · 홀로카드 120장」이 두 줄로
                 접힌다. 한 칸이면 PC에서 항목마다 **한 줄**로 끝난다. */}
          {나머지.length > 0 && (
            <dl className="mt-4 grid gap-y-2.5">
              {나머지.map((x) => (
                <div key={x.이름} className="flex gap-3 text-[13px] leading-relaxed lg:text-[13.5px]">
                  <dt className="w-[3.75rem] shrink-0 font-bold text-neutral-500">{x.이름}</dt>
                  <dd className="min-w-0 flex-1 text-neutral-800 [text-wrap:pretty]">{x.값}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* ── 마무리 줄: 주의 글(왼쪽) + 단추(오른쪽). 폰에서는 위아래로, 단추는 가로로 꽉 찬다. */}
          {(N.주의 || 단추) && (
            <div className="mt-5 flex flex-col gap-4 border-t border-neutral-200 pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              {N.주의 && (
                <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-neutral-500 [text-wrap:pretty]">{N.주의}</p>
              )}
              {단추}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
