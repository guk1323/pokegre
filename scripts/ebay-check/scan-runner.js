// 【이베이 긁기 러너】 「팔린 목록」 쪽을 직접 읽어 우리 서버에 쌓는다.
//
// ⚠️⚠️ **왜 만들었나 — 저쪽(PPT)이 우리 천장이었다.** 캡틴피카츄 AR을 재 보니
//    저쪽은 낙찰 **4건**(7월 중순 것)을 주는데 이베이엔 **49건**이 있었고,
//    그래서 PSA 9가 **4.9만원**으로 나갔다(진짜 **34.5만원** · 7배).
//    한 번 검색에 **3.9초 · 240줄**이 온다. 매물을 하나씩 여는 옛 러너보다 60배 빠르다.
//
// ⚠️⚠️ **이 파일은 판단을 안 한다.** 쪽을 열어 줄을 뜯어 보내기만 한다 —
//    어느 카드 것인지 가리기·등급 읽기·환율 되돌리기는 **전부 서버가** 한다
//    (`/api/local/scan-queue`). 잣대가 두 벌이면 언젠가 반드시 어긋난다.
//
// 【넣는 차례 — 옛 러너와 같다】
//   1. 크롬에서 이베이 매물이든 검색이든 아무 페이지나 연다.
//   2. 그 탭에서 `window.__b = window.open('https://pokegre.com/?bridge=1')`
//   3. **새 탭**에 `bridge.js` 를 넣는다.
//   4. **이베이 탭**에 이 파일을 넣는다. 팝업 차단이 뜨면 허용한다(읽기용 탭 하나).
//   5. `window.__scan` 으로 진행을 본다. 멈추려면 `window.__scan.on = false`.
//
// ⚠️ 옛 러너(값 고치기)와 **같이 돌리지 마라.** 이베이가 한 벌이라 겹치면 빨리 막힌다.
// ⚠️ **막힘 8연속이면 스스로 멈춘다.** 그러면 몇 시간 쉰다(옛 러너와 같은 규칙).

const 몇장 = 200;         // 한 바퀴에 볼 카드 수
const 최저값 = 100;       // 이 값($) 위 카드만. 전부 돌 수는 없다(58,528장).
const 사이쉼 = 2500;      // 검색 사이 쉼(ms). 막히기 시작하면 늘린다.
const 기다림최대 = 25000; // 한 쪽이 뜨기를 기다리는 한계(ms)
const 한쪽에 = 240;       // 한 쪽에 담을 줄 수(이베이 `_ipg`). 240이 최대다.

window.__scan = {
  on: true, 본카드: 0, 보낸줄: 0, 담긴줄: 0, 남띔: 0, 막힘연속: 0,
  시작: Date.now(), 멈춘까닭: '', 최근: [],
};
const S = window.__scan;

// 다리 탭을 거쳐 우리 서버와 이야기한다(이베이 탭은 우리 서버를 못 부른다 — 이베이 CSP).
window.__ask = (kind, extra) => new Promise((done, fail) => {
  const id = Math.random().toString(36).slice(2);
  const 받기 = (e) => {
    const d = e.data;
    if (!d || d.a !== 'pokegre' || d.id !== id) return;
    window.removeEventListener('message', 받기);
    d.ok ? done(d.data) : fail(new Error(d.err || '실패'));
  };
  window.addEventListener('message', 받기);
  window.__b.postMessage({ q: 'pokegre', id, kind, ...extra }, '*');
  setTimeout(() => { window.removeEventListener('message', 받기); fail(new Error('시간초과')); }, 30000);
});

// ── 읽기용 탭 하나를 열어 주소만 바꿔 가며 읽는다 ────────────────────────────
// ⚠️ **`fetch`로는 안 된다.** 매물 쪽(`/itm/`)은 되는데 **검색 쪽(`/sch/`)은 이베이
//    봇 차단이 가로챈다**(2026-08-19 실측). 탭을 열면 잘 읽힌다 — 같은 출처라
//    부모가 자식 탭 내용을 그대로 본다. 러너 자신은 살아 있다.
let 읽기탭 = null;
const 기다려서읽기 = (url) => new Promise((done) => {
  const 끝 = Date.now() + 기다림최대;
  읽기탭.location.href = url;
  const 봄 = setInterval(() => {
    let d = null;
    try { d = 읽기탭.document; } catch (e) { /* 아직 남의 출처 */ }
    const 다됨 = d && d.readyState === 'complete' && d.URL.includes('_nkw=');
    if (다됨 || Date.now() > 끝) { clearInterval(봄); done(다됨 ? d : null); }
  }, 250);
});

// ── 한 쪽에서 팔린 줄을 뜯는다 ───────────────────────────────────────────────
// ⚠️ **광고 두 줄이 섞여 온다**(매물번호가 가짜 `123456`). 자릿수로 뺀다.
// ⚠️ **값이 원화로 온다** — 이베이 계정 배송지가 한국이라서다. 여기서는 **그대로 보낸다.**
//    달러로 되돌리는 것은 서버 몫이다(오늘 환율로 되돌리면 원래 달러값으로 거의 온다).
function 줄뜯기(doc) {
  const out = [];
  for (const li of [...doc.querySelectorAll('li')].filter((x) => x.querySelector('a[href*="/itm/"]'))) {
    const a = li.querySelector('a[href*="/itm/"]');
    const itm = ((a && a.href.match(/\/itm\/(\d+)/)) || [])[1] || '';
    if (!itm || itm.length < 9) continue;
    const h = li.querySelector('[role="heading"], .s-item__title, .s-card__title');
    const t = ((h && h.innerText) || '').split('\n')[0].trim();
    if (!t) continue;
    const 글 = li.innerText || '';
    const krw = Number(((글.match(/KRW\s?[\d,]+\.\d{2}/) || [])[0] || '').replace(/[^\d.]/g, '')) || 0;
    const usd = Number(((글.match(/US\s?\$\s?[\d,]+\.\d{2}/) || [])[0] || '').replace(/[^\d.]/g, '')) || 0;
    const d = (글.match(/Sold\s+(\w{3}\s+\d{1,2},\s+\d{4})/) || [])[1] || '';
    // ⚠️⚠️ **「Best offer accepted」는 적힌 값이지 실제로 판 값이 아니다.** 이베이는
    //    깎아 준 금액을 안 밝힌다 — 그대로 담으면 **실제보다 비싸게** 잡힌다.
    //    여기서는 표시만 보내고, 셈에서 뺄지는 서버가 정한다.
    out.push({ itm, t, krw, usd, d, a: /\d+\s+bids?/.test(글), bo: /best offer accepted/i.test(글) });
  }
  return out;
}

(async () => {
  if (!window.__b) { S.멈춘까닭 = '다리 탭(window.__b)이 없습니다 — bridge.js 부터 넣으세요'; S.on = false; return; }
  읽기탭 = window.open('https://www.ebay.com/sch/i.html?_nkw=pokemon&LH_Sold=1&LH_Complete=1', 'pokegre_scan');
  if (!읽기탭) { S.멈춘까닭 = '읽기용 탭을 못 열었습니다 — 팝업 차단을 허용해 주세요'; S.on = false; return; }
  await new Promise((r) => setTimeout(r, 3000));

  let 큐;
  try { 큐 = (await window.__ask('scanQueue', { n: 몇장, min: 최저값 })).rows || []; }
  catch (e) { S.멈춘까닭 = '긁을 목록을 못 받았습니다: ' + e; S.on = false; return; }
  if (!큐.length) { S.멈춘까닭 = '긁을 카드가 없습니다'; S.on = false; return; }
  S.할것 = 큐.length;

  for (const [id, 이름, 번호] of 큐) {
    if (!S.on) break;
    const url = 'https://www.ebay.com/sch/i.html?' +
      new URLSearchParams({ _nkw: `${이름} ${번호}`, LH_Sold: '1', LH_Complete: '1', _ipg: String(한쪽에) }).toString();
    const doc = await 기다려서읽기(url);
    S.본카드++;
    // ⚠️ 막힘 판정: 쪽이 너무 짧거나 인증 화면이면 못 읽은 것이다. **못 읽은 것은 안 보낸다** —
    //    보내면 서버가 「0건」으로 알아듣고 멀쩡한 값을 지운다.
    if (!doc || (doc.body.innerText || '').length < 3000 ||
        /Security Measure|본인 인증/.test(doc.title + doc.body.innerText.slice(0, 400))) {
      S.막힘연속++;
      if (S.막힘연속 >= 8) { S.on = false; S.멈춘까닭 = '이베이가 막았습니다 — 멈춤'; break; }
      await new Promise((r) => setTimeout(r, 사이쉼 * 2));
      continue;
    }
    S.막힘연속 = 0;
    const rows = 줄뜯기(doc);
    if (!rows.length) { await new Promise((r) => setTimeout(r, 사이쉼)); continue; }
    try {
      const 답 = await window.__ask('scanPost', { card: id, rows });
      S.보낸줄 += rows.length;
      S.담긴줄 += 답.담음 || 0;
      S.남띔 += 답.남띔 || 0;
      S.최근.unshift(`${이름} ${번호} · 받은줄 ${rows.length} → 담음 ${답.담음 || 0}`);
      S.최근 = S.최근.slice(0, 8);
    } catch (e) { S.최근.unshift(`${이름} ${번호} · 못 보냄: ${e}`); }
    await new Promise((r) => setTimeout(r, 사이쉼));
  }

  S.on = false;
  if (!S.멈춘까닭) S.멈춘까닭 = '한 바퀴 다 봤습니다';
  const 분 = (Date.now() - S.시작) / 60000;
  S.요약 = {
    본카드: S.본카드, 걸린분: Math.round(분 * 10) / 10,
    분당카드: Math.round((S.본카드 / 분) * 10) / 10,
    보낸줄: S.보낸줄, 담긴줄: S.담긴줄, 남의카드로걸러낸줄: S.남띔,
    멈춘까닭: S.멈춘까닭,
  };
  try { 읽기탭.close(); } catch (e) { /* 이미 닫힘 */ }
})();

'이베이 긁기 시작 · window.__scan 으로 진행을 봅니다 · 멈추려면 window.__scan.on = false';
