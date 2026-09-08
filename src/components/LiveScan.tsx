import { useEffect, useRef, useState } from 'react';
import { scanCard } from '../api/cardScan';
import { fetchBoardDetail, searchCardBoard, type BoardCard } from '../api/cardBoard';
import { formatGradeLabel, type EbayGradeStat } from '../api/ebayPrices';
import { fetchExchangeRates, type ExchangeRates } from '../api/exchangeRate';

/**
 * 방송용 카드 스캔 — **폰 기준**이다.
 *
 * ⚠️⚠️ **이 화면 자체가 방송 화면이다.** 라이브를 폰으로 하시니(사장님 지시 2026-08-31),
 *    뒷카메라가 화면을 꽉 채우고 그 아래에 값 띠가 얹힌다. 폰 화면을 그대로 송출하면
 *    (유튜브·치지직의 화면 방송, 또는 프리즘 라이브 같은 앱의 화면 소스) 자막이 붙은
 *    방송이 된다. 컴퓨터로 할 때는 이 창을 OBS **창 캡처**로 넣으면 그대로 쓰인다.
 *
 * ⚠️ 그래서 보통 화면과 규칙이 다르다:
 *   · 화면에 보이는 게 **전부 방송에 나간다** — 오류 글·후보 수는 띠에 안 올린다
 *   · 띠 높이가 안 바뀌어야 화면이 안 튄다
 *   · 색을 못 박는다(아래 설명) — 보는 사람 설정에 흔들리면 안 된다
 *
 * ⚠️⚠️ **카메라는 https에서만 열린다.** `http://192.168.0.22:5173` 같은 주소로 폰에서
 *    들어오면 브라우저가 카메라를 아예 안 준다(localhost는 예외라 맥에서는 열린다).
 *    그래서 폰으로 제대로 쓰려면 **배포한 주소(https://pokegre.com/live.html)** 여야 한다.
 *    카메라를 못 열면 파일 고르기로 되돌아간다 — 그 길은 http에서도 된다.
 */

/** 값 두 줄에 쓸 등급 칸. 사장님이 정한 것 — 미감정 싱글과 PSA 10. */
const 보여줄등급 = ['raw', 'psa10'] as const;

/**
 * 등급 배열에서 한 칸을 찾는다.
 * ⚠️ PPT가 등급 이름을 한 가지로만 보내지 않는다(`psa10`·`psa 10`·`PSA10`). 카드판 화면이
 *    쓰는 `formatGradeLabel`과 같은 눈으로 보려고, 영문자·숫자만 남겨 견준다.
 */
function 등급찾기(grades: EbayGradeStat[], 칸: string): EbayGradeStat | undefined {
  const 씻기 = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return grades.find((g) => 씻기(g.grade) === 씻기(칸));
}

/**
 * 그 등급의 대표값.
 * ⚠️ 카드판과 **같은 기준**이어야 한다 — 현재 적정가(smartPrice), 없으면 중앙값.
 *    여기만 평균으로 두면 같은 카드가 방송과 사이트에서 다른 값으로 나간다.
 */
function 대표값(g: EbayGradeStat): number | null {
  const v = g.smartPrice != null ? g.smartPrice : g.medianPrice;
  return v > 0 ? v : null;
}

/** 달러를 원화 어림수로. 환율을 못 받았으면 달러를 그대로 적는다(값을 안 숨긴다). */
function 값글(usd: number, rates: ExchangeRates | null): string {
  if (!rates) return `$${Math.round(usd).toLocaleString('en-US')}`;
  const krw = usd * rates.usdToKrw;
  // ⚠️ 방송 자막은 한눈에 읽혀야 한다. 「약 115만원」보다 자릿수가 보이는 편이 낫다.
  return `${(Math.round(krw / 1000) * 1000).toLocaleString('ko-KR')}원`;
}

interface 값칸 {
  라벨: string;
  글: string;
  /** 이 값을 몇 건의 낙찰로 셌나. 0이면 낙찰이 아니라 마켓가다. */
  건수: number;
}

/**
 * 검색 결과에서 **정말 그 카드**를 고른다.
 *
 * ⚠️ 맨 앞 카드를 그냥 쓰면 안 된다 — 「Charizard ex」 하나에 38장이 걸린다(실측).
 *    방송 자막에 다른 카드 값이 뜨는 건 값이 없는 것보다 나쁘다. 그래서
 *    **번호가 맞는 카드**를 먼저 찾고, 세트 코드까지 맞으면 그걸 쓴다.
 * ⚠️ 번호는 카드마다 적는 꼴이 다르다(`223` · `223/197` · `No. 004`). 숫자만 남겨 견준다.
 */
function 고르기(cards: BoardCard[], 번호: string | null | undefined, 세트: string | null | undefined) {
  if (!cards.length) return undefined;
  const 숫자만 = (s: string | null | undefined) => (s ?? '').replace(/^0+/, '').match(/\d+/)?.[0] ?? '';
  const 찍힌 = 숫자만(번호);
  if (!찍힌) return cards[0];
  const 번호맞음 = cards.filter((c) => 숫자만(c.printNo ?? c.cardNumber) === 찍힌);
  if (!번호맞음.length) return cards[0];
  if (번호맞음.length === 1 || !세트) return 번호맞음[0];
  const 세트키 = 세트.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    번호맞음.find((c) => c.setNameEn.toLowerCase().replace(/[^a-z0-9]/g, '').includes(세트키)) ?? 번호맞음[0]
  );
}

interface 띠내용 {
  이름: string;
  세트: string;
  번호: string | null;
  값: 값칸[];
}

export function LiveScan() {
  const 화면ref = useRef<HTMLVideoElement>(null);
  const 파일칸 = useRef<HTMLInputElement>(null);
  const [도는중, set도는중] = useState(false);
  const [띠, set띠] = useState<띠내용 | null>(null);
  const [탈난말, set탈난말] = useState<string | null>(null);
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  /** 카메라가 안 열린 까닭. 열렸으면 null. */
  const [카메라탈, set카메라탈] = useState<string | null>(null);
  /** 후보가 여럿이면 엉뚱한 카드일 수 있다. 사장님이 눈으로 가리도록 잠깐 띄운다. */
  const [고른카드, set고른카드] = useState<{ 이름: string; 후보: number } | null>(null);

  useEffect(() => {
    fetchExchangeRates().then(setRates);
  }, []);

  // ── 뒷카메라 켜기 ───────────────────────────────────────────────────────────
  useEffect(() => {
    let 흐름: MediaStream | null = null;
    let 살아있나 = true;
    (async () => {
      // ⚠️ https가 아니면 `navigator.mediaDevices` 자체가 없다. 없는 걸 부르면 그냥
      //    터지므로, 왜 안 되는지 사람 말로 적어 준다.
      if (!navigator.mediaDevices?.getUserMedia) {
        set카메라탈('https 주소가 아니라 카메라를 못 켭니다');
        return;
      }
      try {
        흐름 = await navigator.mediaDevices.getUserMedia({
          // ⚠️ `ideal`이다(`exact` 아님). 앞카메라뿐인 기기에서 `exact`는 아예 실패한다.
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
          audio: false,
        });
        if (!살아있나) {
          흐름.getTracks().forEach((t) => t.stop());
          return;
        }
        if (화면ref.current) {
          화면ref.current.srcObject = 흐름;
          set카메라탈(null);
        }
      } catch {
        set카메라탈('카메라를 못 켰습니다 — 아래 단추로 사진을 고르세요');
      }
    })();
    return () => {
      살아있나 = false;
      흐름?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /** 지금 카메라에 비치는 한 장을 파일로 뜬다. */
  async function 지금한장(): Promise<File | null> {
    const v = 화면ref.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
    return blob ? new File([blob], 'card.jpg', { type: 'image/jpeg' }) : null;
  }

  async function 알아보기(file: File) {
    set도는중(true);
    set탈난말(null);
    set고른카드(null);
    try {
      // ⚠️ **`trackEvent('scan')`을 일부러 안 부른다.** 검색바의 사진 단추는 부르지만,
      //    이건 사장님 혼자 쓰는 방송 도구다 — 방송 한 번에 수십 번 찍으면 「사진으로 찾기」
      //    통계가 통째로 사장님 것이 된다. 통계는 방문자가 무엇을 하는지 보는 자리다
      //    (운영 확인을 `?notrack=1`로 하는 것과 같은 까닭).
      const 읽음 = await scanCard(file);
      if (!읽음.found || !읽음.pokemonNameEn) {
        set탈난말('카드를 못 읽었습니다');
        return;
      }
      const 판 = 읽음.edition === 'english' ? 'english' : 'japanese';
      // ⚠️ 카드판은 영어 색인이라 **영어 이름 + 번호**로 좁힌다.
      const 검색어 = [읽음.pokemonNameEn, 읽음.cardNumber].filter(Boolean).join(' ');
      const 결과 = await searchCardBoard(검색어, 판);
      const 카드 = 고르기(결과.cards, 읽음.cardNumber, 읽음.setCode);
      if (!카드) {
        set탈난말(`${읽음.pokemonNameEn} — 시세 자료가 없습니다`);
        return;
      }
      // ⚠️ **목록에는 등급이 대표 하나만 실려 온다**(cardBoard의 `gradesTrimmed`).
      // ⚠️⚠️ **`등급만`을 켜면 안 된다.** 크레딧이 0이라 켜고 싶지만, 그 길로 오는 등급표에는
      //    **`raw`(미감정 싱글) 칸이 없다** — 그 칸은 덤프에 있는 게 아니라 **낙찰 제목을
      //    우리가 다시 갈라 만든 것**이라 낱개 낙찰까지 받아야 생긴다(2026-08-31 실측).
      //    처음 보는 카드만 3크레딧이고, 한 번 받으면 이레 동안 0이다.
      const 상세 = await fetchBoardDetail(카드.tcgPlayerId, 판);

      const 값 = 보여줄등급
        .map((칸) => {
          const g = 등급찾기(상세.grades, 칸);
          const v = g ? 대표값(g) : null;
          return v == null || !g ? null : { 라벨: formatGradeLabel(칸), 글: 값글(v, rates), 건수: g.count };
        })
        .filter((x): x is 값칸 => x !== null);

      // ⚠️ 미감정 낙찰이 없는 카드가 있다. 그럴 때만 TCGplayer 마켓가로 메운다.
      //    ⚠️ **라벨을 따로 단다** — 낙찰가(이베이)와 마켓가(TCGplayer)는 뜻이 다른 값이라,
      //       같은 「미감정 싱글」로 적으면 두 값을 견줄 수 없게 된다.
      if (!등급찾기(상세.grades, 'raw') && 카드.tcgplayer?.market) {
        값.unshift({ 라벨: 'TCG 마켓가', 글: 값글(카드.tcgplayer.market, rates), 건수: 0 });
      }

      if (!값.length) {
        set탈난말(`${카드.name} — 낙찰 기록이 없습니다`);
        return;
      }
      set고른카드({ 이름: 카드.name, 후보: 결과.cards.length });
      set띠({
        이름: 카드.name,
        세트: 카드.setName,
        // 카드에 실제로 찍힌 번호가 있으면 그것을 쓴다(옛 일본 세트는 도감번호가 찍혀 있다).
        번호: 카드.printNo ?? 카드.cardNumber,
        값,
      });
    } catch {
      set탈난말('시세를 못 가져왔습니다');
    } finally {
      set도는중(false);
    }
  }

  async function 찍기() {
    const file = await 지금한장();
    if (!file) {
      파일칸.current?.click();
      return;
    }
    await 알아보기(file);
  }

  return (
    /* ⚠️⚠️ **색을 전부 못 박았다(#쌩값).** 이 리포는 다크모드를 `--color-neutral-*` 변수를
       통째로 뒤집어서 만든다(index.css) — `bg-neutral-950`이 어두운 화면에서는 **밝은 회색**이
       된다. `text-white`·`bg-black`도 마찬가지로 뒤집힌다.
       보통 화면은 그게 맞지만 **방송 자막은 보는 사람 설정에 흔들리면 안 된다** — 사장님이
       다크모드면 자막이 흰 띠로 나가 버린다. 그래서 여기서만 변수를 안 쓴다.
       ⚠️ 이 파일에 `bg-neutral-*`·`text-white`·`bg-black`을 새로 쓰면 그 자리부터 다시 뒤집힌다. */
    <div className="relative h-dvh w-full overflow-hidden bg-[#000000] text-[#ffffff]">
      {/* ── 카메라. 화면을 꽉 채운다 — 이게 방송 그림이다 ────────────────────── */}
      {/* ⚠️ `playsInline`이 없으면 아이폰 사파리가 영상을 **전체화면 재생기로 띄운다** —
          방송 화면이 통째로 가려진다. `muted`가 없으면 자동 재생을 막는다. */}
      <video
        ref={화면ref}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* 카메라를 못 켰을 때만 까닭을 적는다. 켜졌으면 아무것도 안 그린다. */}
      {카메라탈 && (
        <div className="absolute inset-x-0 top-0 flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-base text-[#d0d0d0]">{카메라탈}</p>
          <button
            type="button"
            onClick={() => 파일칸.current?.click()}
            className="rounded-xl bg-[#ffffff] px-6 py-3 text-base font-bold text-[#111111]"
          >
            사진 고르기
          </button>
        </div>
      )}

      {/* ── 찍기 단추. 띠 바로 위 가운데 ──────────────────────────────────────
          ⚠️ 이 단추도 방송에 나간다. 폰 화면을 그대로 송출하기 때문이다.
             카메라 앱과 같은 꼴(동그라미)이라 보는 사람이 이상하게 안 여긴다. */}
      <button
        type="button"
        onClick={찍기}
        disabled={도는중}
        aria-label="카드 찍기"
        className="absolute bottom-32 left-1/2 flex h-20 w-20 -translate-x-1/2 items-center justify-center rounded-full border-4 border-[#ffffff] bg-[#ffffff]/25 backdrop-blur disabled:opacity-40"
      >
        {도는중 ? (
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-[#ffffff]/40 border-t-[#ffffff]" />
        ) : (
          <span className="h-14 w-14 rounded-full bg-[#ffffff]" />
        )}
      </button>

      {/* 탈난 말·후보 수는 **찍기 단추 위**에 잠깐. 띠에는 안 올린다 —
          띠는 마지막으로 성공한 카드를 그대로 물고 있어야 방송이 안 흔들린다. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-56 flex flex-col items-center gap-1 px-6 text-center">
        {탈난말 && (
          <p className="rounded-lg bg-[#000000]/70 px-3 py-1 text-sm font-semibold text-[#fb7185]">{탈난말}</p>
        )}
        {고른카드 && 고른카드.후보 > 1 && (
          <p className="rounded-lg bg-[#000000]/70 px-3 py-1 text-xs text-[#d0d0d0]">
            같은 이름 {고른카드.후보}장 중 하나입니다 — 맞는지 보세요
          </p>
        )}
      </div>

      {/* ── 아래쪽: 방송에 나갈 띠 ──────────────────────────────────────────────
          ⚠️ **높이를 못 박아 둔다.** 값이 한 줄일 때와 두 줄일 때 띠 높이가 달라지면
             화면이 튄다(컴퓨터에서 OBS 자르기로 쓸 때는 칸까지 어긋난다).
          ⚠️ 바탕은 **순검정**이다. index.css는 눈이 아프다고 순검정을 안 쓰지만, 그건
             오래 읽는 화면 이야기다 — 자막 띠는 영상 위에 얹히므로 순검정이 제일 또렷하다. */}
      <div className="absolute inset-x-0 bottom-0 h-28 border-t-4 border-[#fbbf24] bg-[#000000] px-4 sm:px-8">
        {띠 ? (
          /* ⚠️ **폰에서는 접힌다(기본), 넓은 화면은 한 줄이다(`sm:`).**
             폰(375px)에서 한 줄로 두면 이름이 통째로 밀려나고 PSA 10 값이 잘렸다
             (2026-08-31 실측: 문서폭 428 > 화면폭 375). */
          <div className="flex h-full flex-col justify-center gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="min-w-0">
              <p className="truncate text-xl font-bold leading-tight text-[#ffffff] sm:text-3xl">{띠.이름}</p>
              <p className="truncate text-sm text-[#a0a0a0] sm:text-lg">
                {띠.세트}
                {띠.번호 ? ` · ${띠.번호}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-5 sm:gap-8">
              {띠.값.map((v) => (
                <div key={v.라벨} className="sm:text-right">
                  {/* ⚠️ **건수를 라벨에 붙인다.** 낙찰 1건짜리 값이 큰 글씨로 방송에 나가면
                      그게 시세로 읽힌다 — 실제로 「피카츄 025」의 PSA 10은 낙찰이 1건뿐이다
                      (2026-08-31 실측). 값을 감추는 대신 **몇 건으로 센 값인지**를 같이 적어,
                      보는 사람이 스스로 가늠하게 한다. */}
                  <p className="text-[11px] font-semibold tracking-wide text-[#fbbf24] sm:text-sm">
                    {v.라벨}
                    {v.건수 > 0 ? <span className="text-[#c9932c]"> · 낙찰 {v.건수}건</span> : ''}
                  </p>
                  <p className="text-xl font-bold tabular-nums leading-tight text-[#ffffff] sm:text-3xl">{v.글}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center text-lg text-[#5a5a5a] sm:text-xl">
            {도는중 ? '읽는 중…' : '카드를 비추고 단추를 누르세요'}
          </div>
        )}
      </div>

      {/* 카메라가 안 될 때의 대비책. `capture`를 안 붙여야 찍기·앨범을 둘 다 고를 수 있다. */}
      <input
        ref={파일칸}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void 알아보기(f);
        }}
        className="hidden"
      />
    </div>
  );
}
