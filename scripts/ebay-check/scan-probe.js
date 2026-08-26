// 【1단계 · 재 보기】 이베이 「팔린 목록」 쪽을 직접 긁을 수 있는지 재 본다.
//
// ⚠️⚠️ **이건 재는 것이지 쌓는 것이 아니다.** 서버에 아무것도 안 보낸다. 다음 셋만 잰다:
//    ① 얼마나 빠른가(분당 몇 장) ② 언제 막히는가 ③ 「내 카드 것만 고르기」가 맞는가
//
// ⚠️ **왜 `fetch`를 안 쓰나** — 매물 쪽(`/itm/`)은 fetch가 되는데, **검색 쪽(`/sch/`)은
//    이베이 봇 차단이 가로챈다**(2026-08-19 실측: radware가 `Failed to fetch`를 냈다).
//    그래서 **읽기용 탭을 하나 열어 주소만 바꿔 가며** 읽는다. 같은 출처라 부모가
//    자식 탭의 내용을 그대로 읽을 수 있다. 러너 자신은 살아 있다.
//
// 【넣는 차례】
//   1. 크롬에서 이베이 아무 페이지나 연다.
//   2. 그 탭에서 이 파일을 통째로 넣는다.
//   3. 팝업 차단이 뜨면 허용한다(읽기용 탭 하나를 연다).
//   4. `window.__scan` 을 읽으면 진행이 보인다. 멈추려면 `window.__scan.on = false`.
//
// ⚠️ 러너(값 고치기)와 **같이 돌리지 마라.** 이베이가 한 벌이라 둘이 겹치면 빨리 막힌다.

const 잴장수 = 50;        // 이번에 재 볼 카드 수
const 사이쉼 = 2500;      // 검색 사이에 쉬는 시간(ms). 막히면 늘린다.
const 기다림최대 = 20000; // 한 쪽이 뜨기를 기다리는 한계(ms)

// 잴 카드 — 값나가는 것 50장(세트당 2장까지). `번호`는 「제목에 이게 있어야 우리 카드」의 잣대다.
const 카드들 = [{"no":"107","nameEn":"Rayquaza Star"},{"no":"1","nameEn":"Mew"},{"no":"102","nameEn":"Gyarados Star (Delta Species)"},{"no":"BW73","nameEn":"Darkrai (Team Plasma)"},{"no":"100","nameEn":"Charizard Star (Delta Species)"},{"no":"230","nameEn":"Poncho-wearing Pikachu"},{"no":"XY116","nameEn":"Arceus"},{"no":"146","nameEn":"Charizard"},{"no":"112","nameEn":"Umbreon ex"},{"no":"108","nameEn":"Torchic Star"},{"no":"113","nameEn":"Metagross Star"},{"no":"78","nameEn":"Mewtwo GX (Secret Shining)"},{"no":"104","nameEn":"Pikachu Star"},{"no":"82","nameEn":"Houndoom (Prime)"},{"no":"101","nameEn":"Mew Star (Delta Species)"},{"no":"136","nameEn":"Charizard"},{"no":"135","nameEn":"Colress (Team Plasma) (135 Full Art)"},{"no":"97","nameEn":"Gengar Lv.X"},{"no":"113","nameEn":"Flying Pikachu"},{"no":"1","nameEn":"Espeon (1)"},{"no":"101","nameEn":"Jolteon Star"},{"no":"18","nameEn":"Pikachu"},{"no":"BW94","nameEn":"Eevee"},{"no":"120","nameEn":"Mew EX (120 Full Art)"},{"no":"XY69","nameEn":"Rayquaza EX (Shiny)"},{"no":"294","nameEn":"Mario Pikachu"},{"no":"144","nameEn":"Mewtwo LV.X"},{"no":"65","nameEn":"Shining Gyarados"},{"no":"154","nameEn":"Charizard V (Alternate Full Art)"},{"no":"DP19","nameEn":"Darkrai LV.X"},{"no":"146","nameEn":"Rayquaza C Lv.X"},{"no":"108","nameEn":"Gengar ex"},{"no":"37","nameEn":"Mesprit"},{"no":"195a","nameEn":"Dedenne GX"},{"no":"102","nameEn":"Espeon ex"},{"no":"93","nameEn":"Deoxys ex (Speed Forme)"},{"no":"14","nameEn":"Slowking"},{"no":"SL7","nameEn":"Lugia (Shiny)"},{"no":"1","nameEn":"Ampharos"},{"no":"120","nameEn":"Empoleon LV.X"},{"no":"H31","nameEn":"Vaporeon (H31)"},{"no":"4","nameEn":"Dark Charizard (4)"},{"no":"149","nameEn":"Lugia"},{"no":"39","nameEn":"Rayquaza ex - 039 (EX Collector's Tin)"},{"no":"11","nameEn":"Smeargle (11)"},{"no":"142","nameEn":"Blastoise EX (142 Full Art)"},{"no":"109","nameEn":"Gardevoir"},{"no":"94","nameEn":"Arceus Lv.X (94)"},{"no":"H11","nameEn":"Houndoom (H11)"},{"no":"4","nameEn":"Blastoise (4)"}];

window.__scan = {
  on: true, 본카드: 0, 받은줄: 0, 고른줄: 0, 광고: 0, 막힘연속: 0,
  시작: Date.now(), 멈춘까닭: '', 표본: [], 느린것: [],
};
const S = window.__scan;

// ── 「이 매물이 우리 카드인가」 ────────────────────────────────────────────────
// ⚠️⚠️ **여기가 이 안의 핵심이다.** 저쪽(PPT)은 **이름만 보고** 뭉쳐서 캡틴피카츄 한 칸에
//    여덟 가지 카드가 섞였다. 우리는 **무엇을 검색했는지 아니까** 번호로 좁힐 수 있다.
// ⚠️ 앞의 0 때문에 틀린 적이 있다(「Pikachu 004」를 4번이 아니라 1번으로 봄).
//    그래서 **숫자만 뽑아 앞의 0을 떼고** 견준다.
// ⚠️⚠️⚠️ **「번호가 들어 있나」로 보면 안 된다 — 처음에 그렇게 만들었다가 틀렸다.**
//    우리 번호가 `09/09`인데 딴 카드 제목 `0703/09`에도 「/09」가 있어서, 실측 35건 중
//    **23건을 골랐고 그중 11건이 딴 카드**였다(2026-08-19). 리포에 적힌 「앞의 0」 함정과
//    같은 것이다. **슬래시 앞쪽이 내 번호와 같아야** 내 카드다.
const 앞0떼기 = (s) => String(s).replace(/^0+/, '') || '0';
function 내카드인가(제목, 번호) {
  const t = String(제목 || '').toLowerCase();
  const [내번, 총] = String(번호).toLowerCase().split('/');
  const n = 앞0떼기(내번);
  if (!n) return false;
  const 슬래시들 = [...t.matchAll(/(\d+)\s*\/\s*(\d+)/g)];
  if (총) {
    // 「09/09」 꼴을 가진 카드. 제목에 슬래시 번호가 있으면 **그것만** 본다.
    for (const m of 슬래시들) {
      if (앞0떼기(m[1]) === n) return true;                       // 09/09
      // 「0709/09」처럼 앞에 팩 번호가 붙는 판이 있다 — 뒤 두 자리가 카드 번호다.
      if (m[1].length > 2 && 앞0떼기(m[1].slice(-2)) === n) return true;
    }
    // ⚠️ 슬래시 번호가 **하나라도 있으면** 위에서 갈렸으니 여기서 더 안 본다.
    //    안 그러면 `0703/09`의 「/09」가 낱말 검사에 걸려 딴 카드를 담는다.
    if (슬래시들.length) return false;
  }
  // 슬래시 없는 번호(`107`·`BW73`·`H31`)이거나, 제목이 번호를 슬래시 없이 적은 경우.
  const 낱말 = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^0-9a-z])0*' + 낱말 + '($|[^0-9a-z])').test(t);
}

// ── 읽기용 탭 ────────────────────────────────────────────────────────────────
let 읽기탭 = null;
const 탭열기 = () => {
  읽기탭 = window.open('https://www.ebay.com/sch/i.html?_nkw=pokemon&LH_Sold=1&LH_Complete=1', 'pokegre_scan');
  return 읽기탭;
};
const 기다려서읽기 = (url) =>
  new Promise((done) => {
    const 끝 = Date.now() + 기다림최대;
    읽기탭.location.href = url;
    const 봄 = setInterval(() => {
      let d = null;
      try { d = 읽기탭.document; } catch { /* 아직 남의 출처 */ }
      const 다됨 = d && d.readyState === 'complete' && d.URL.includes('_nkw=');
      if (다됨 || Date.now() > 끝) { clearInterval(봄); done(다됨 ? d : null); }
    }, 250);
  });

// ── 한 쪽에서 팔린 줄을 뽑는다 ───────────────────────────────────────────────
// ⚠️ **광고 두 줄이 섞여 온다**(매물번호가 가짜 `123456`). 반드시 뺀다.
// ⚠️ **값이 원화로 온다** — 이베이 계정 배송지가 한국이라서다. 여기서는 **바꾸지 않고
//    그대로 적는다**(재는 단계라 원본을 봐야 한다). 쌓는 단계에서 달러로 되돌린다.
function 줄뽑기(doc) {
  const 줄들 = [...doc.querySelectorAll('li')].filter((li) => li.querySelector('a[href*="/itm/"]'));
  const 결과 = [];
  let 광고 = 0;
  for (const li of 줄들) {
    const a = li.querySelector('a[href*="/itm/"]');
    const itm = (a?.href.match(/\/itm\/(\d+)/) || [])[1] || '';
    if (!itm || itm.length < 9) { 광고++; continue; } // 「Shop on eBay」 같은 광고
    const 제목 = (li.querySelector('[role="heading"], .s-item__title, .s-card__title')?.innerText || '').split('\n')[0].trim();
    const 글 = li.innerText || '';
    const 값 = (글.match(/(?:KRW|US\s?\$|\$)\s?[\d,]+\.\d{2}/) || [])[0] || '';
    const 날 = (글.match(/Sold\s+(\w{3}\s+\d{1,2},\s+\d{4})/) || [])[1] || '';
    const 경매 = /\d+\s+bids?/.test(글);
    if (제목) 결과.push({ itm, 제목, 값, 날, 경매 });
  }
  return { 결과, 광고 };
}

(async () => {
  if (!탭열기()) { S.멈춘까닭 = '읽기용 탭을 못 열었습니다 — 팝업 차단을 허용해 주세요'; S.on = false; return; }
  await new Promise((r) => setTimeout(r, 3000));
  for (const c of 카드들.slice(0, 잴장수)) {
    if (!S.on) break;
    const t0 = Date.now();
    const q = `${c.nameEn} ${c.no}`;
    const url = 'https://www.ebay.com/sch/i.html?' +
      new URLSearchParams({ _nkw: q, LH_Sold: '1', LH_Complete: '1', _ipg: '60' }).toString();
    const doc = await 기다려서읽기(url);
    S.본카드++;
    if (!doc || (doc.body.innerText || '').length < 3000 || /Security Measure|본인 인증/.test(doc.title + doc.body.innerText.slice(0, 400))) {
      S.막힘연속++;
      if (S.막힘연속 >= 8) { S.on = false; S.멈춘까닭 = '이베이가 막았습니다 — 멈춤'; break; }
      await new Promise((r) => setTimeout(r, 사이쉼 * 2));
      continue;
    }
    S.막힘연속 = 0;
    const { 결과, 광고 } = 줄뽑기(doc);
    const 내것 = 결과.filter((x) => 내카드인가(x.제목, c.no));
    S.받은줄 += 결과.length; S.고른줄 += 내것.length; S.광고 += 광고;
    const 걸린 = Date.now() - t0;
    if (걸린 > 8000) S.느린것.push({ 이름: c.nameEn, 초: Math.round(걸린 / 100) / 10 });
    // 눈으로 볼 표본 — 앞 8장만
    if (S.표본.length < 8) {
      S.표본.push({
        카드: `${c.nameEn} ${c.no}`, 받음: 결과.length, 내것: 내것.length,
        고른예: 내것.slice(0, 2).map((x) => `${x.값} ${x.날} · ${x.제목.slice(0, 58)}`),
        버린예: 결과.filter((x) => !내카드인가(x.제목, c.no)).slice(0, 2).map((x) => x.제목.slice(0, 58)),
      });
    }
    await new Promise((r) => setTimeout(r, 사이쉼));
  }
  S.on = false;
  if (!S.멈춘까닭) S.멈춘까닭 = '다 봤습니다';
  const 분 = (Date.now() - S.시작) / 60000;
  S.요약 = {
    본카드: S.본카드, 걸린분: Math.round(분 * 10) / 10,
    분당카드: Math.round(S.본카드 / 분 * 10) / 10,
    받은줄: S.받은줄, 고른줄: S.고른줄,
    고른비율: S.받은줄 ? Math.round(S.고른줄 / S.받은줄 * 100) + '%' : '-',
    카드당받은줄: S.본카드 ? Math.round(S.받은줄 / S.본카드 * 10) / 10 : 0,
    광고줄: S.광고, 멈춘까닭: S.멈춘까닭,
  };
  try { 읽기탭.close(); } catch { /* 이미 닫힘 */ }
})();

'재 보기 시작 · window.__scan 으로 진행을 봅니다 · 멈추려면 window.__scan.on = false';
