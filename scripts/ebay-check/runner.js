// 【러너】 이베이 탭에 넣는다. 위에서 bridge.js 를 넣어 두어야 한다.
// ⚠️ 넣기 전에 이 탭에서 window.__b = window.open('https://pokegre.com/?bridge=1') 을 해 둘 것.

const 급함 = 'p15';          // p15 → 헐값상위 → 헐값 → 상위 → '' (전부). README 참고
const 시간 = 6;               // 몇 시간 돌릴까 (사장님 지시 2026-08-17)
// ⚠️ 리포 메모는 「하루 2~3시간씩 나눠 돌라」고 한다 — 2시간 뒤 이베이가 조여
//    분당 233건 → 36건으로 떨어진 적이 있다. 6시간은 그보다 길다.
//    막힘 8번 연속이면 스스로 멈추니 그때는 몇 시간 쉬어야 한다.

window.__ask = (kind, extra) => new Promise((done, fail) => {
  const id = Math.random().toString(36).slice(2);
  const 받기 = (e) => { const d = e.data; if (!d || d.a !== 'pokegre' || d.id !== id) return;
    window.removeEventListener('message', 받기); d.ok ? done(d.data) : fail(new Error(d.err || '실패')); };
  window.addEventListener('message', 받기);
  window.__b.postMessage({ q: 'pokegre', id, kind, ...extra }, '*');
  setTimeout(() => { window.removeEventListener('message', 받기); fail(new Error('시간초과')); }, 30000);
});

// 매물 한 건 읽기.
// ⚠️ 「팔림」이 확실할 때만 값을 쓴다 — 안 팔리고 끝난 것도 값이 보이는데 그건 호가다.
// ⚠️⚠️ **없어진 매물(404)과 잠깐 튄 오류를 갈라야 한다.** 둘 다 「오류」로 두면,
//    영영 안 열리는 매물이 큐 앞에 남아 러너가 그것만 두드리며 앞으로 못 나간다.
//    404는 「지워짐」으로 보내 확인 끝에 넣고, 나머지 오류만 큐에 남긴다.
window.__읽기 = async (itm) => {
  try {
    const r = await fetch('https://www.ebay.com/itm/' + itm, { credentials: 'include' });
    if (r.status === 404 || r.status === 410) return { 상태: '지워짐', 값: null, 제목: '' };
    if (!r.ok) return { 상태: '오류', 값: null, 제목: '' };
    const h = await r.text();
    if (h.length < 40000) return { 상태: '막힘', 값: null, 제목: '' };     // 봇 차단·토막 응답
    if (/\/p\/\d/.test(r.url) && !/\/itm\//.test(r.url)) return { 상태: '지워짐', 값: null, 제목: '' };
    const 제목 = (h.match(/<title>([^<]+)<\/title>/) || [, ''])[1].replace(/\s*\|\s*eBay\s*$/i, '').trim();
    const 팔림 = /This listing sold on|Item sold on|listing was ended by the seller because the item was sold/i.test(h);
    if (!팔림) return { 상태: '미상', 값: null, 제목 };
    const m = h.match(/US\s*\$\s*([\d,]+\.\d{2})/);
    return { 상태: m ? '팔림' : '미상', 값: m ? Number(m[1].replace(/,/g, '')) : null, 제목 };
  } catch (e) { return { 상태: '오류', 값: null, 제목: '' }; }
};

window.__run = { on: true, 확인: 0, 팔림: 0, 안읽힘: 0, 보냄: 0, 고침: 0, 막힘연속: 0, 급함,
  끝: Date.now() + 시간 * 3600 * 1000, 멈춘까닭: '', 시작: Date.now() };
const S = window.__run;
const 보낼것 = [];

const 보내기 = async () => {
  if (!보낼것.length) return;
  const 묶음 = 보낼것.splice(0, 400);
  try { const d = await window.__ask('post', { rows: 묶음 }); S.보냄 += 묶음.length; S.고침 = d.고침표 ?? S.고침; }
  catch { 보낼것.unshift(...묶음); }          // 못 보냈으면 되돌려 둔다 — 버리지 않는다
};

(async () => {
  while (S.on && Date.now() < S.끝) {
    let 큐;
    try { 큐 = (await window.__ask('queue', { n: 4000, 급함 })).rows || []; }
    catch (e) { S.멈춘까닭 = '큐 못 받음: ' + e; break; }
    if (!큐.length) { S.멈춘까닭 = '이 급함은 다 봤다 — 다음 급함으로'; break; }
    let i = 0;
    const 일꾼 = async () => {
      while (S.on && Date.now() < S.끝 && i < 큐.length) {
        const [itm, 우리, card, g] = 큐[i++];
        const r = await window.__읽기(itm);
        S.확인++;
        // ⚠️ 못 읽은 것은 **보내지 않는다.** 보내면 서버가 「확인 끝」으로 적어 다시는 안 본다.
        if (r.상태 === '오류' || r.상태 === '막힘') {
          S.안읽힘++;
          if (r.상태 === '막힘') { S.막힘연속++; if (S.막힘연속 >= 8) { S.on = false; S.멈춘까닭 = '이베이가 막았다 — 멈춤'; } }
        } else {
          S.막힘연속 = 0;
          if (r.상태 === '팔림') S.팔림++;
          보낼것.push([itm, r.상태, r.값, 우리, card, g, r.제목]);
          if (보낼것.length >= 400) await 보내기();
        }
        await new Promise((s) => setTimeout(s, 850));
      }
    };
    await Promise.all([일꾼(), 일꾼(), 일꾼(), 일꾼()]);
    await 보내기();
    if (!S.on) break;
  }
  await 보내기();
  S.on = false;
  if (!S.멈춘까닭) S.멈춘까닭 = '시간 다 됨';
})();
'러너 시작 · 급함=' + 급함 + ' · 끝 ' + new Date(S.끝).toLocaleTimeString('ko-KR');
