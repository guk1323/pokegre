import { useEffect, useRef, useState } from 'react';
import { CardImg } from './CardImg';
import { Price, useKrw } from './KrwHint';
import { reportCardTitleMiss } from '../api/localStats';
import { ShareButton } from './ShareButton';
import {
  fetchConditionPrices,
  fetchPriceHistory,
  fetchTradedGrades,
  koreanizeGrade,
  RAW_GRADE_DESCRIPTION,
  type ConditionGroup,
  type PriceHistory,
  type PriceRange,
  type SnkrdunkCard,
} from '../api/snkrdunk';
import { PriceChart } from './PriceChart';


export function CardDetail({ card }: { card: SnkrdunkCard }) {
  // 등급 칸은 3열이라 좁다. 엔화와 원화를 같이 넣으면 글자가 넘쳐서
  // 원화만 적는다(사용자 결정 2026-08-03).
  const krw = useKrw();
  const isBox = card.category === 'box';
  const [groups, setGroups] = useState<ConditionGroup[]>([]);
  const [loading, setLoading] = useState(!isBox);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [range, setRange] = useState<PriceRange>('all');
  // '' = 아직 등급 목록을 못 받았거나(첫 조회) 등급이 없는 상품(박스)
  const [condition, setCondition] = useState('');
  // 카드 이름(한글화) 오류 신고를 한 번 누르면 감사 문구로 바꾼다.
  const [titleReported, setTitleReported] = useState(false);
  // 실거래 기록이 있는 등급. 카드를 열 때 등급마다 한 번씩 물어 알아낸다(무료).
  // null이면 아직 확인 전이라 목록을 거르지 않는다.
  const [tradedGrades, setTradedGrades] = useState<Set<string> | null>(null);
  // 수량은 항상 1개(1장)로 고정한다. 사용자가 고를 일이 없고("10박스 묶음 시세"를
  // 보고 싶은 사람은 없다), 안 고정하면 박스 시세가 묶음 총액과 섞여 부풀려진다.
  const [variantId, setVariantId] = useState<number | null>(null);

  // 박스는 등급(PSA/BGS 등) 개념 자체가 없어서 조회할 필요가 없다 — 등급별
  // 최저가 섹션도 통째로 숨긴다.
  useEffect(() => {
    if (isBox) return;
    setLoading(true);
    setError(null);
    setGroups([]);
    fetchConditionPrices(card.apparelId)
      .then(setGroups)
      .catch(() => setError('등급별 시세를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [card.apparelId, isBox]);

  // 카드를 바꾸면 기간/등급 선택을 되돌린다. 직전 카드에서 "1주"나 "PSA10"을 보다가
  // 넘어왔는데 새 카드엔 그 데이터가 없으면 빈 그래프가 뜨기 때문.
  useEffect(() => {
    setRange('all');
    setCondition('');
    setVariantId(null);
    setTitleReported(false);
    setTradedGrades(null);
  }, [card.apparelId]);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistory(null);
    fetchPriceHistory(card.apparelId, range, condition || undefined, variantId ?? undefined)
      .then((result) => {
        if (cancelled || !result) return;
        // 첫 조회에서 필터 목록을 받아오면, 그걸로 기본값을 정해 다시 조회한다.
        // 목록은 상품마다 달라서(박스는 등급이 없고 수량 단위도 個/枚로 다름)
        // 코드를 박아두지 않고 API가 주는 첫 항목을 쓴다.
        const 등급정할것 = condition === '' && result.conditions.length > 0;
        const 변형정할것 = variantId === null && result.variants.length > 0;
        if (등급정할것) setCondition(result.conditions[0].code);
        if (변형정할것) setVariantId(result.variants[0].id);
        // ⚠️⚠️ **등급·변형을 안 고르고 받은 자료는 화면에 올리지 않는다.**
        //    첫 조회는 필터 없이 나가므로 그 답에는 **PSA 10과 생카가, 마스터볼과
        //    기본판이 한 줄에 섞여** 있다. 예전엔 그걸 먼저 그려 놓고 곧바로 다시 받아
        //    덮었는데, 그 사이에 사람이 섞인 그래프와 값을 본다(2026-08-08).
        //    곧 다시 받으므로 그때 그리면 된다 — 잘못된 값을 잠깐이라도 보이면 안 된다.
        // ⚠️ 여기서 돌아갈 때는 **로딩 표시를 그대로 둔다.** 끄면 빈 화면이 잠깐 보인다.
        //    곧 이어질 조회(등급·변형이 정해진)가 자료를 올리며 끈다.
        if (등급정할것 || 변형정할것) return;
        setHistory(result);
        setHistoryLoading(false);
      })
      .catch(() => {
        if (!cancelled) setHistoryLoading(false);
      });
  
  return () => {
      cancelled = true;
    };
  }, [card.apparelId, range, condition, variantId]);

  // 등급 목록을 받으면, 어느 등급에 실거래 기록이 있는지 한 번 훑어 둔다.
  // 카드마다 한 번만 한다(등급이나 기간을 바꿔도 다시 하지 않는다).
  // ⚠️ 수량(variantId)은 넘겨야 한다. 그래프는 1장짜리 거래만 받는데 훑기가 묶음까지
  //    세면 "기록 있다"고 해놓고 빈 그래프를 띄운다(2026-08-05).
  // ⚠️ "이미 훑었나"를 tradedGrades로 판단하면 안 된다. 수량이 뒤늦게 정해지면
  //    (첫 조회 응답에서 온다) 다시 훑어야 하는데, 그때 tradedGrades에는 수량 없이
  //    훑은 옛 답이 들어 있어 그대로 건너뛴다. 무엇으로 훑었는지를 따로 적어 둔다.
  const gradeCodes = (history?.conditions ?? []).map((c) => c.code).join(',');
  const 훑은조건 = useRef('');
  useEffect(() => {
    if (!gradeCodes) return;
    const 조건 = `${card.apparelId}|${variantId ?? ''}|${gradeCodes}`;
    if (훑은조건.current === 조건) return;
    훑은조건.current = 조건;
    let cancelled = false;
    setTradedGrades(null); // 새로 훑는 동안은 거르지 않는다(옛 답으로 거르면 틀린다)
    fetchTradedGrades(card.apparelId, gradeCodes.split(','), variantId ?? undefined)
      .then((set) => {
        if (!cancelled) setTradedGrades(set);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      // ⚠️ 적어 둔 것도 지운다. 안 지우면 훑기가 영영 안 끝난다:
      //    그래프를 다시 받을 때 history를 잠깐 null로 비우는데(윗 useEffect), 그러면
      //    gradeCodes가 ''가 되어 이 훑기가 취소된다. 곧바로 목록이 돌아와도 "이미
      //    훑었다"고 적혀 있어 그냥 넘어가 버린다 — 결국 아무것도 못 거른다(2026-08-05).
      if (훑은조건.current === 조건) 훑은조건.current = '';
    };
  }, [card.apparelId, gradeCodes, variantId]);

  // 그래프에 띄울 등급 목록 — 실거래 기록이 있는 등급만.
  //
  // ⚠️ "매물이 있는 등급"으로 거르면 안 된다. 그래프는 실거래 기록이고 아래 등급별
  //    최저가는 지금 올라온 매물이라 서로 다른 자료다(그렇게 만들었다가 되돌렸다).
  // ⚠️ 아직 다 훑기 전(null)에는 거르지 않는다 — 그때는 어느 등급에 기록이 있는지
  //    모르므로 함부로 빼면 있는 등급까지 사라진다.
  //
  // ⚠️ 예전엔 "지금 고른 등급"도 무조건 남겼다(`c.code === condition`). 선택칸이 제
  //    값을 잃고 튀는 걸 막으려던 것인데, 그게 두 가지 버그를 만들었다(2026-08-05):
  //    ① 기록 없는 A로 시작했다가 B를 고르면 A가 목록에서 사라진다. 되돌아갈 수 없다.
  //    ② A를 고른 채로는 그래프가 "실거래 기록이 없습니다"만 띄운다.
  //    고른 등급을 붙잡아 두는 대신, 기록 없는 등급을 고르고 있으면 있는 쪽으로
  //    옮긴다(아래 useEffect). 그러면 목록에서 뺄 등급을 고르고 있을 일이 없다.
  const pickedConditions = (history?.conditions ?? []).filter(
    (c) => !tradedGrades || tradedGrades.has(c.code),
  );

  // 실거래가 없는 등급을 고르고 있으면 있는 등급으로 옮긴다.
  // 스니커덩크가 주는 첫 등급(대개 A)에 기록이 없는 카드가 흔하다 — 망나뇽 R
  // [SM11 068/094]는 A 0건, B 1건, C 2건이다.
  useEffect(() => {
    if (!tradedGrades || !condition || tradedGrades.has(condition)) return;
    const 있는것 = (history?.conditions ?? []).find((c) => tradedGrades.has(c.code));
    if (있는것) setCondition(있는것.code);
  }, [tradedGrades, condition, history]);

  return (
    <div
      // ⚠️⚠️ **붙여 두되(sticky) 안쪽이 스크롤되게 한다.**
      //    상세가 화면보다 길면(등급표+그래프+낱개가 쌓이면 1,100px을 넘는다) 붙어 있는 채로
      //    아래쪽이 화면 밖에 남는다. 그러면 **왼쪽 목록을 끝까지 내려야** 비로소 상세 밑이
      //    보인다 — 목록이 2,000px을 넘으니 사실상 못 본다
      //    (사장님 지적 2026-08-15: "어느정도 훨씬 더 내려야 상세보기도 내려가져").
      //    화면 높이에서 위 여백(top-4=16px)과 아래 숨 쉴 자리를 뺀 만큼으로 묶고,
      //    넘치면 **패널 안에서** 굴리게 한다.
      //    ⚠️ `100dvh`를 쓴다 — 폰 주소창이 접히고 펴져도 값이 따라 바뀐다(`vh`는 안 바뀐다).
      //    ⚠️ 이 칸은 `lg` 이상에서만 보인다(좁은 화면은 시트가 대신한다).
      className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white p-5"
    >
      <div className="h-40 w-full rounded-lg mb-4 overflow-hidden bg-neutral-100">
        <CardImg src={card.imageUrl} alt={card.title} className="h-full w-full object-contain" lazy={false} />
      </div>

      <div className="mb-1 flex items-start justify-between gap-2">
        {/* 카드 이름은 "이름 [세트 번호](팩 이름)" 한 덩어리로 온다. 통째로 두면 폰에서
            세 줄을 차지해 정작 보러 온 시세가 아래로 밀린다. 팩은 아랫줄로 뺀다. */}
        <h2 className="text-base font-bold text-black">{cardTitleMain(card.title)}</h2>
        <ShareButton path={`/c/${card.apparelId}`} name={card.title} />
      </div>
      {cardTitlePack(card.title) && (
        <p className="mb-1 text-xs text-neutral-500">{cardTitlePack(card.title)}</p>
      )}
      <p className="text-xs text-neutral-400 mb-4">
        매물 {card.stock.toLocaleString()}개
        {card.favoriteCount !== undefined && ` · 찜 ${card.favoriteCount.toLocaleString()}`}
      </p>
      <div className="rounded-lg bg-neutral-50 p-4 mb-4">
        <p className="text-xs text-neutral-400 mb-1">현재 최저가 (SNKRDUNK)</p>
        {Number.isFinite(card.price) && card.price > 0 ? (
          <>
            {/* 자세히 보는 화면이라 여기서만 기준일을 밝힌다. 목록에서 타일마다 반복하면
                시끄럽고, 정작 가격을 뜯어보는 건 이 화면이다. */}
            <Price
              amount={card.price}
              currency="jpy"
              className="text-2xl font-extrabold text-black"
              showDate
            />
          </>
        ) : (
          <span className="text-lg font-bold text-neutral-400">현재 매물이 없습니다</span>
        )}
      </div>
      {/* 카드 이름 한글화가 이상하면(예: 파미리마토→패밀리마트) 사용자가 알려준다.
          화면에 보인 제목과 원본 링크만 보내고, 사진·개인정보는 안 보낸다. */}
      {titleReported ? (
        <p className="mb-4 text-[11px] text-neutral-400">알려주셔서 감사합니다. 이름을 고치겠습니다.</p>
      ) : (
        <button
          type="button"
          onClick={() => {
            reportCardTitleMiss(card.title, card.rawTitle ?? card.title, card.link);
            setTitleReported(true);
          }}
          // ⚠️ 글줄이 17px이라 누르기 어려웠다(운영자 지시 2026-08-06). 여백으로 40px까지
            //    넓히되 -my로 되돌려 줄 간격은 그대로 둔다.
            className="-my-3 mb-1 py-3 text-[11px] text-neutral-400 underline hover:text-neutral-600"
        >
          카드 이름이 이상한가요?
        </button>
      )}


      <div className="mb-4">
        <PriceChart
          points={history?.points ?? []}
          ranges={history?.ranges ?? []}
          range={range}
          onRangeChange={setRange}
          conditions={pickedConditions}
          condition={condition}
          onConditionChange={setCondition}
          unitLabel={history?.variants[0]?.name}
          loading={historyLoading}
        />
      </div>

      <a
        href={card.link}
        target="_blank"
        rel="noreferrer"
        className="block text-center rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-black hover:bg-neutral-50 mb-4"
      >
        SNKRDUNK에서 원본 보기
      </a>

      {!isBox && (
      <div>
        <p className="text-xs font-semibold text-neutral-500 mb-2">등급별 최저가</p>

        {loading ? (
          <p className="text-xs text-neutral-400 py-4 text-center">불러오는 중...</p>
        ) : error ? (
          <p className="text-xs text-rose-500 py-4 text-center">{error}</p>
        ) : !groups.some((g) => g.chips.some((c) => c.hasListing)) ? (
          <p className="text-xs text-neutral-400 py-4 text-center">등급별 매물이 없습니다.</p>
        ) : (
          // 매물이 있는 등급만 보여준다. 예전엔 없는 등급까지 흐리게 다 그려서
          // "매물없음" 칸이 화면을 가득 채웠다(등급이 열 몇 개라 대부분 빈칸이다).
          // 이베이 상세도 값이 있는 등급만 내려주므로 두 화면이 같은 방식이 된다.
          <div className="space-y-3">
            {groups
              .map((group) => ({ ...group, chips: group.chips.filter((c) => c.hasListing) }))
              .filter((group) => group.chips.length > 0)
              .map((group) => (
                <div key={group.label}>
                  <p className="text-[11px] font-semibold text-neutral-400 mb-1">{group.label}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.chips.map((chip) => (
                      <div
                        key={chip.conditionId}
                        title={RAW_GRADE_DESCRIPTION[chip.filterConditionId]}
                        className="rounded-lg border border-neutral-200 p-2 text-center"
                      >
                        <p className="text-[11px] font-semibold text-neutral-600">{koreanizeGrade(chip.text)}</p>
                        <p className="text-xs font-bold text-black">{krw(chip.usedMinPrice ?? 0, 'jpy')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// "메가리자몽 X ex MA [M2a 223/193](하이클래스팩「MEGA드림 ex」)" 를 둘로 나눈다.
function cardTitleMain(title: string): string {
  return title.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

function cardTitlePack(title: string): string {
  const m = title.match(/\(([^()]*)\)\s*$/);
  return m ? m[1].trim() : '';
}
