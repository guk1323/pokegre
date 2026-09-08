/**
 * **팝수 화면의 안내** — 아직 아무 카드도 안 찾았을 때만 나온다.
 *
 * ⚠️ 왜 있나: 검색 전 화면에 검색바만 덩그러니 있었다(사장님 지적 2026-09-01).
 * ⚠️ **10초 안에 「팝수가 뭐고 왜 중요한지」가 들어와야 한다**(사장님 지시 2026-09-02).
 *    설명을 길게 늘어놓지 말고 문장을 줄이고 그림으로 보여 준다.
 * ⚠️⚠️ **여기 적힌 숫자는 전부 우리 자료에서 센 것이다.** 지어내지 말 것.
 *    · 회사별 등급 칸: data/population-detail.json 33,860장 전수(2026-09-02)
 *    · 연도별 팝수 중간값: 같은 자료 + card-index.json 발매일
 *    · 센터링 잣대: src/components/CenteringTool.tsx 의 COMPANY_LADDERS 그대로
 *      (PSA 10은 55:45다. 60:40이 아니다 — 초안에 잘못 적혔던 값)
 * ⚠️ 감정 회사가 넷뿐인 것처럼 쓰지 않는다. 팝수를 공개하는 곳이 넷일 뿐이고,
 *    낙찰 자료에는 TAG·ACE도 잡힌다.
 * ⚠️ 이모지를 쓰지 않는다(사이트 공통).
 */

/** 카드 뒷면 — 우리 자산을 얹는다. 네모로 흉내 내지 않는다. */
const 카드그림 = '/pack-card-back.svg';

/**
 * 팝수 견주기 — 길이 차이가 곧 메시지다.
 *
 * ⚠️⚠️ **이름·값을 막대 옆에 두면 좁은 화면에서 대비가 무너진다.** 320px에서 재 보니
 *    막대가 놓일 자리가 76px밖에 안 남아, 3 대 3,000(0.1%)이 화면에서는 18%로 보였다
 *    (2026-09-02 실측). 이름·값을 **위로 올리고 막대에 한 줄을 통째로** 준다.
 * ⚠️ 그래도 제일 짧은 막대는 보여야 하므로 최소 너비를 두되, 6px까지만 준다.
 */
function 견주기() {
  const 줄 = (이름: string, 값: string, 폭: string, 진하게: boolean, 덧: string) => (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-neutral-500">{이름}</span>
        <span className="text-sm font-bold text-neutral-800">
          {값}
          <span className="ml-1.5 text-[11px] font-normal text-neutral-500">{덧}</span>
        </span>
      </div>
      <div className="mt-1 h-6 w-full rounded-md bg-neutral-100">
        <div
          className={`h-6 rounded-md ${진하게 ? 'bg-amber-600' : 'bg-neutral-300'}`}
          style={{ width: 폭, minWidth: 6 }}
        />
      </div>
    </div>
  );
  return (
    <div className="mt-4 space-y-3">
      {줄('A 카드', '3장', '0.1%', true, '귀함')}
      {줄('B 카드', '3,000장', '100%', false, '흔함')}
      <p className="pt-0.5 text-[11px] text-neutral-500">둘 다 10등급입니다. 값은 완전히 다릅니다.</p>
    </div>
  );
}

/** ③ 감정 회사가 보는 네 곳 — 카드 아래에 태그로 늘어놓는다. */
function 네곳() {
  return (
    <div className="mt-4">
      <div className="flex justify-center">
        <img src={카드그림} alt="카드 뒷면" className="h-[132px] w-auto rounded-lg ring-1 ring-neutral-300" />
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {[
          ['가운데 맞음', '양쪽 여백'],
          ['모서리', '네 귀퉁이'],
          ['가장자리', '테두리'],
          ['표면', '긁힘·눌림'],
        ].map(([이름, 덧]) => (
          <span key={이름} className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-700">
            <b className="font-bold">{이름}</b>
            <span className="ml-1 text-neutral-500">{덧}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PopulationGuide() {
  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-2xl border border-neutral-200 p-5">
        <h2 className="text-base font-bold text-black">팝수란</h2>
        {/* ⚠️ 3단계 흐름 띠를 지웠다(사장님 지적 2026-09-02). 카드를 회사에 보내면 케이스에
            싸여 나온다는 것은 이 화면에 오는 사람에겐 이미 아는 얘기다. 자리만 먹고 정작
            봐야 할 견주기 막대를 아래로 밀어냈다. */}
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">
          감정 회사가 그 카드에 어떤 등급을 몇 장 매겼는지 집계해 공개한 숫자입니다. 카드가 세상에 몇 장
          있는지는 알 수 없지만, 팝수로 희소성을 가늠할 수 있습니다.
        </p>
        <견주기 />
        {/* ⚠️ 기관 목록 문장을 여기서 뺐다(사장님 지적 2026-09-02). 이 칸은 「팝수가 뭐고
            왜 중요한가」를 말하는 자리라 주제가 튀었다. **지운 게 아니라 아래 표 쪽으로
            옮겼다** — 넷뿐인 것처럼 읽히는 자리가 거기라서, 그 옆에 있어야 뜻이 산다. */}
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-neutral-200 p-5">
          <h2 className="text-base font-bold text-black">회사마다 등급 체계가 다릅니다</h2>
          {/* ⚠️ 「BGS의 10점은 젬민트가 아니라 프리스틴」이라고 적었더니 「그럼 BGS 젬민트는
              뭐냐」에서 한 번 걸렸다(사장님 지적 2026-09-02). 9.5가 젬민트라는 것을 밝힌다. */}
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">
            팝수를 공개하는 곳은 이 넷입니다. PSA는 정수 등급만 쓰고, BGS는 9.5가 젬민트이고 10이
            프리스틴입니다. 표의 빈칸은 자료가 없어서가 아니라 그 회사가 그 칸을 안 쓰기 때문입니다.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-center text-sm">
              <thead>
                <tr className="text-[11px] text-neutral-500">
                  <th className="py-1.5 text-left font-semibold">칸</th>
                  {['PSA', 'BGS', 'CGC', 'SGC'].map((c) => (
                    <th key={c} className="py-1.5 font-semibold">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* ⚠️⚠️ **이름은 회사 실제 등급명, 값은 우리 자료 실측이다**(2026-09-02).
                    사장님이 주신 표에는 BGS의 「젬민트 10」과 「진품만」이 있음으로 돼 있었는데,
                    33,860장 전수에 **둘 다 0건**이다. BGS의 10점은 프리스틴으로 들어가기
                    때문이고(그 설명과 자료가 오히려 맞아떨어진다), 그래서 젬민트 칸이 빈다.
                    ⚠️ CGC 퍼펙트는 지금 안 쓰는 옛 등급이라 옛 슬랩에만 남아 있다(2,268장). */}
                {[
                  // ⚠️ 자료의 `perfect` 칸은 하나지만 **회사마다 부르는 이름이 다르다** —
                  //    BGS는 블랙라벨, CGC는 퍼펙트(지금은 안 쓰는 옛 등급)다. 한 줄로 묶으면
                  //    「CGC도 블랙라벨을 준다」로 읽혀 틀린다(사장님 지적 2026-09-02).
                  //    ⚠️ CGC 퍼펙트를 통째로 빼면 반대로 어긋난다 — 그 등급이 붙은 카드가
                  //       2,268장 남아 있어, 그 카드를 찾으면 표에 숫자가 뜬다.
                  ['블랙라벨 10', 0, 1, 0, 0],
                  ['퍼펙트 10', 0, 0, 1, 0],
                  ['프리스틴 10', 0, 1, 1, 1],
                  ['젬민트 10', 1, 0, 1, 1],
                  ['9.5', 0, 1, 1, 1],
                  ['9 이하', 1, 1, 1, 1],
                  ['진품만', 1, 0, 1, 1],
                ].map(([이름, ...칸]) => (
                  <tr key={이름 as string} className="border-t border-neutral-100">
                    <td className="py-2 text-left text-[13px] font-semibold text-neutral-800">{이름}</td>
                    {(칸 as number[]).map((v, i) => (
                      <td key={i} className={v ? 'py-2 text-base text-neutral-800' : 'py-2 text-base text-neutral-300'}>
                        {v ? '●' : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* ⚠️ BGS·CGC 이름 설명을 뺐다 — 오른쪽 칸의 배지 목록에서 이미 같은 말을 한다. */}
          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
            「진품만」은 등급 점수 없이 진품 확인만 받은 수량입니다. 감정 회사는 이 밖에도 여럿이라, 낙찰
            기록에는 TAG·ACE에서 매긴 등급도 섞여 나옵니다.
          </p>
        </section>

        <section className="rounded-2xl border border-neutral-200 p-5">
          <h2 className="text-base font-bold text-black">완벽 그 이상의 등급</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">
            감정 회사는 아래 네 가지를 함께 봅니다. 일반적인 10점(젬민트)보다 흠잡을 데 없는 카드에는
            프리스틴이나 블랙라벨 같은 최상위 등급이 따로 붙습니다.
          </p>
          <네곳 />
          <div className="mt-4 rounded-xl bg-neutral-50 p-3">
            <p className="text-xs font-bold text-neutral-700">가운데 맞음으로 견주면</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">
              PSA는 앞면 여백이 55:45에서 60:40 정도까지 10을 줍니다. BGS 10과 CGC 프리스틴은 50:50에
              가까워야 합니다.
            </p>
            {/* ⚠️ 「우리 도구는 55를 자른 값으로 쓴다」를 여기서 뺐다(사장님 지적 2026-09-02).
                팝수 보러 온 사람에게 다른 도구의 내부 잣대를 말하는 건 맥락이 튄다.
                **지운 게 아니라 센터링 측정 화면으로 옮겼다** — 그 값이 실제로 쓰이는 자리다. */}
          </div>
          <ul className="mt-3 space-y-2">
            {[
              ['BGS', '네 항목이 모두 10이면 블랙라벨, 10이 셋에 9.5가 하나면 프리스틴입니다.'],
              ['CGC', '지금은 프리스틴 10이 최상위 등급입니다.'],
            ].map(([회사, 설명]) => (
              <li key={회사} className="flex gap-2.5 text-xs leading-relaxed text-neutral-600">
                <span className="mt-0.5 h-fit flex-shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {회사}
                </span>
                <span>{설명}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ⚠️ 「~하지 마십시오」로 적었다가 바꿨다(사장님 지적 2026-09-02). 조회하러 온 사람에게
          지침을 내리는 말투로 읽혔다. 막는 대신 **왜 그런지**를 담백하게 적는다.
          ⚠️ 「2021년 이후 등급 신청이 급증해서」라는 까닭은 우리 자료로 확인 못 했다.
             대신 자료로 보이는 것(쌓이는 속도 차이)만 숫자로 적는다. */}
      <section className="rounded-2xl border border-neutral-200 p-5">
        <h2 className="text-base font-bold text-black">알아 두면 좋은 것</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-neutral-800">쌓이는 속도가 시기마다 다릅니다</p>
            <p className="mt-1 text-sm leading-relaxed text-neutral-600">
              2023년에 나온 카드는 3년 만에 한 장당 중간값 315장이 쌓였습니다. 2014년 카드는 12년이 지난
              지금도 8장입니다. 시기가 다른 카드끼리는 숫자만 견주기보다 그 무렵 사정을 같이 보시면 좋습니다.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-800">회사별로 나눠 보여 드리는 까닭</p>
            <p className="mt-1 text-sm leading-relaxed text-neutral-600">
              회사마다 등급을 매기는 기준이 다릅니다. BGS에는 젬민트 10 칸이 없고 PSA에는 9.5가 없습니다.
              하나로 합친 숫자보다 회사별로 따로 보는 편이 카드 값을 가늠하는 데 도움이 됩니다.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
