// 【다리 탭】 pokegre.com 에 넣는다. 이베이 탭은 우리 서버를 못 부르므로 이 탭이 대신 부른다.
// ⚠️ 열쇠(토큰)를 여기 적지 않는다 — 서버가 sec-fetch-site: same-origin 으로 알아본다.
// ⚠️ 창구가 둘이다 — 옛 러너(값 고치기)와 새 러너(이베이 긁기)가 이 다리를 같이 쓴다.
const 길 = '/api/local/check-queue';
const 긁기길 = '/api/local/scan-queue';
window.__bridge = true;
window.onmessage = async (e) => {
  const d = e.data;
  if (!d || d.q !== 'pokegre') return;
  const 답 = (v) => e.source && e.source.postMessage({ a: 'pokegre', id: d.id, ...v }, '*');
  try {
    if (d.kind === 'queue') {
      const r = await fetch(길 + '?n=' + d.n + (d.급함 ? '&pri=' + encodeURIComponent(d.급함) : ''));
      답({ ok: r.ok, data: await r.json() });
    } else if (d.kind === 'post') {
      const r = await fetch(길, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: d.rows }) });
      답({ ok: r.ok, data: await r.json() });
    } else if (d.kind === 'scanQueue') {
      const r = await fetch(긁기길 + '?n=' + d.n + '&min=' + (d.min || 100));
      답({ ok: r.ok, data: await r.json() });
    } else if (d.kind === 'scanPost') {
      const r = await fetch(긁기길, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ card: d.card, rows: d.rows }) });
      답({ ok: r.ok, data: await r.json() });
    }
  } catch (err) { 답({ ok: false, err: String(err) }); }
};
'다리 켜짐';
