// 센터링 측정용 카드 검출. 사진에서 카드 바깥 테두리(outer)와 일러스트/뒷면 테두리
// 안쪽 경계(inner)를 찾는다. CenteringTool에서 쓰고, 테스트 하네스에서도 같은 코드를
// 불러 정확도를 잰다(코드가 하나여야 테스트가 의미 있다).

export type Rect = { l: number; t: number; r: number; b: number }; // 이미지 대비 0~1 비율

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 어두운 배경 위 카드를 밝기로 가르는 오츠(Otsu) 임계값.
function otsu(g: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, thr = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; thr = i; }
  }
  return thr;
}

// 밝은 픽셀 덩어리(연결요소) 중 "가운데 카드"의 바깥 사각형을 고른다. 카드 비율(~0.72)에
// 맞고 충분히 큰 덩어리를 찾되, 이미지 가장자리에 닿는 덩어리(=화면에 걸친 옆 카드)는
// 점수를 크게 깎아 무시한다. 홀로·어두운 배경에 강하다.
function detectOuter(bright: Uint8Array, W: number, H: number): { lo: number; ro: number; to: number; bo: number } | null {
  const label = new Int32Array(W * H);
  const stack: number[] = [];
  let best: { minx: number; maxx: number; miny: number; maxy: number; score: number } | null = null;
  let cur = 0;
  for (let s = 0; s < W * H; s++) {
    if (!bright[s] || label[s]) continue;
    cur++;
    let area = 0, minx = W, maxx = 0, miny = H, maxy = 0, touch = false;
    stack.length = 0;
    stack.push(s);
    label[s] = cur;
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % W;
      const y = (p / W) | 0;
      area++;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touch = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (bright[np] && !label[np]) { label[np] = cur; stack.push(np); }
        }
    }
    const w = maxx - minx + 1;
    const h = maxy - miny + 1;
    const ratio = w / h;
    if (area < W * H * 0.03 || w < W * 0.25 || h < H * 0.25 || ratio < 0.5 || ratio > 0.95) continue;
    const score = area * (touch ? 0.3 : 1);
    if (!best || score > best.score) best = { minx, maxx, miny, maxy, score };
  }
  if (!best) return null;
  return { lo: best.minx, ro: best.maxx, to: best.miny, bo: best.maxy };
}

// 바깥 테두리(from)에서 안쪽(to)으로 스캔해 처음 만나는 강한 선(=일러스트 테두리)의 인덱스.
// 깊은 곳의 더 강한 본문·텍스트 선보다, 테두리에 가장 가까운 선을 잡아야 안쪽으로 침범하지
// 않는다. from>to면 반대 방향(우·하)으로 스캔한다. 못 찾으면 null(인셋으로 대체).
function firstStrongInBand(P: Float32Array, from: number, to: number, T: number): number | null {
  const a = Math.round(from);
  const b = Math.round(to);
  const step = b >= a ? 1 : -1;
  for (let i = a; step > 0 ? i <= b : i >= b; i += step) {
    if (i <= 0 || i >= P.length - 1) continue;
    if (P[i] >= T && P[i] >= P[i - 1] && P[i] >= P[i + 1]) return i;
  }
  return null;
}

// 한 열(col)/행(row)의 평균 RGB.
function meanColor(data: Uint8ClampedArray, W: number, kind: 'col' | 'row', idx: number, a: number, b: number): [number, number, number] {
  let r = 0, g = 0, bl = 0, n = 0;
  for (let k = a; k <= b; k++) {
    const p = (kind === 'col' ? k * W + idx : idx * W + k) * 4;
    r += data[p]; g += data[p + 1]; bl += data[p + 2]; n++;
  }
  n = Math.max(1, n);
  return [r / n, g / n, bl / n];
}
function cdist(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}
// 테두리 색(edge 바로 안쪽)을 샘플하고 안으로 스캔하며 색이 바뀌는 첫 지점을 일러스트
// 테두리로 본다. 임계값은 고정이 아니라 밴드 안 최대 변화의 55%(최소 30)로 적응시킨다 —
// 앞면처럼 대비가 크면 크게, 뒷면(파란 테두리↔파란 소용돌이)처럼 미묘하면 낮게 잡힌다.
// 코너는 피하려고 가운데 밴드(cross0~cross1)만 샘플한다. 못 찾으면 null.
function colorTransition(data: Uint8ClampedArray, W: number, kind: 'col' | 'row', fromEdge: number, toDeep: number, cross0: number, cross1: number): number | null {
  const a = Math.round(fromEdge);
  const b = Math.round(toDeep);
  const step = b >= a ? 1 : -1;
  const border = meanColor(data, W, kind, a, cross0, cross1);
  const dists: { i: number; d: number }[] = [];
  let maxD = 0;
  for (let i = a; step > 0 ? i <= b : i >= b; i += step) {
    const d = cdist(meanColor(data, W, kind, i, cross0, cross1), border);
    dists.push({ i, d });
    if (d > maxD) maxD = d;
  }
  if (maxD < 30) return null; // 밴드 안에 의미 있는 색 변화가 없다.
  const thr = Math.max(30, maxD * 0.55);
  for (const { i, d } of dists) if (d >= thr) return i;
  return null;
}

// 카드 바깥 테두리(밝기 분할)와 안쪽 일러스트 테두리(색 변화 + 경계선)를 함께 검출.
// backSide면 안쪽 검색 띠를 좁게 잡는다 — 포켓몬 카드 뒷면은 디자인이 표준이라
// 테두리가 항상 얇고, 띠를 좁히면 소용돌이 무늬 안쪽을 잘못 잡는 걸 막는다.
// 실패하면 null(자동 인식 실패로 처리 → 수동 안내).
export function detectCard(img: HTMLImageElement | HTMLCanvasElement, opts?: { backSide?: boolean }): { outer: Rect; inner: Rect } | null {
  const natW = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const natH = 'naturalHeight' in img ? img.naturalHeight : img.height;
  // 처리 해상도. 낮으면 테두리(카드 폭의 ~6%)가 몇 px밖에 안 돼 1px 어긋남이 비율을
  // 5%p씩 흔든다. 560이면 테두리가 ~20px라 흔들림이 절반 이하로 준다.
  const W = 560;
  const H = Math.max(1, Math.round((natH / natW) * W));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return null;
  }
  const g = new Float32Array(W * H);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  // ── 바깥: (밝거나 색이 진한) 카드 픽셀을 배경(무채색 어두움)과 가르고 가운데 덩어리 ──
  // 밝기만 쓰면 뒷면의 "어두운 파란 테두리"가 어두운 책상과 같이 배경으로 묻혀, 밝은
  // 소용돌이 안쪽만 카드로 잡힌다. 그래서 밝기 OR 채도(색 진함)로 카드를 판별한다.
  const thr = Math.max(otsu(g), 40);
  const bright = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const r = data[p], gg = data[p + 1], b = data[p + 2];
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b); // 무채색이면 0, 진한 색이면 큼
    bright[i] = g[i] > thr || sat > 45 ? 1 : 0;
  }
  // "밝기+채도" 결합값. 경계 검출 전반에 쓴다(그림자에 안 속고, 색 있는 카드에 민감).
  const cs = new Float32Array(W * H);
  for (let i = 0, p = 0; i < cs.length; i++, p += 4) {
    const r = data[p], gg = data[p + 1], b = data[p + 2];
    cs[i] = 0.5 * g[i] + 1.5 * (Math.max(r, gg, b) - Math.min(r, gg, b));
  }

  // 2차 바깥 검출: 카드 비율(가로/세로 ≈ 0.72)에 맞는 "가장 강한 사각형"을 찾는다.
  // 어두운 배경 가정이 깨질 때(나무 책상, 손에 든 사진, 슬리브) 밝기 분할 대신 쓴다.
  // 카드 인쇄 경계는 플라스틱 끝보다 대비가 훨씬 세서, 변 4개의 세기 합이 제일 큰
  // 비율 맞는 조합이 곧 카드다.
  const detectOuterByRect = (): { lo: number; ro: number; to: number; bo: number } | null => {
    const colProf = new Float32Array(W);
    const y0 = Math.round(H * 0.3), y1 = Math.round(H * 0.7);
    for (let x = 1; x < W; x++) {
      let s = 0;
      for (let y = y0; y <= y1; y++) s += Math.abs(cs[y * W + x] - cs[y * W + x - 1]);
      colProf[x] = s / Math.max(1, y1 - y0 + 1);
    }
    const rowProf = new Float32Array(H);
    const x0 = Math.round(W * 0.3), x1 = Math.round(W * 0.7);
    for (let y = 1; y < H; y++) {
      let s = 0;
      for (let x = x0; x <= x1; x++) s += Math.abs(cs[y * W + x] - cs[(y - 1) * W + x]);
      rowProf[y] = s / Math.max(1, x1 - x0 + 1);
    }
    const peaks = (P: Float32Array, a: number, b: number): number[] => {
      let mx = 0;
      for (let i = a; i <= b; i++) if (P[i] > mx) mx = P[i];
      const out: { i: number; v: number }[] = [];
      for (let i = Math.max(1, a); i <= Math.min(P.length - 2, b); i++)
        if (P[i] >= mx * 0.12 && P[i] >= P[i - 1] && P[i] >= P[i + 1]) out.push({ i, v: P[i] });
      return out.sort((p, q) => q.v - p.v).slice(0, 14).map((p) => p.i);
    };
    const Ls = peaks(colProf, Math.round(W * 0.005), Math.round(W * 0.6));
    const Rs = peaks(colProf, Math.round(W * 0.4), Math.round(W * 0.995));
    const Ts = peaks(rowProf, Math.round(H * 0.005), Math.round(H * 0.6));
    const Bs = peaks(rowProf, Math.round(H * 0.4), Math.round(H * 0.995));
    let cMax = 0;
    for (let x = 0; x < W; x++) if (colProf[x] > cMax) cMax = colProf[x];
    let rMax = 0;
    for (let y = 0; y < H; y++) if (rowProf[y] > rMax) rMax = rowProf[y];
    if (cMax <= 0 || rMax <= 0) return null;
    let best: { lo: number; ro: number; to: number; bo: number; s: number } | null = null;
    for (const l of Ls)
      for (const r of Rs) {
        const w = r - l;
        if (w < W * 0.3) continue;
        for (const t of Ts)
          for (const b of Bs) {
            const h = b - t;
            if (h < H * 0.25) continue;
            const ar = w / h;
            if (ar < 0.63 || ar > 0.8) continue;
            // 면적 가중을 세게 둔다 — 홀로 카드 안쪽 무늬도 변이 강해서, 면적 보너스가
            // 약하면 카드 안의 작은 사각형이 이겨버린다. 카드는 화면의 큰 사각형이다.
            const s =
              colProf[l] / cMax + colProf[r] / cMax + rowProf[t] / rMax + rowProf[b] / rMax + 2.2 * ((w * h) / (W * H));
            if (!best || s > best.s) best = { lo: l, ro: r, to: t, bo: b, s };
          }
      }
    return best;
  };

  const box = detectOuter(bright, W, H);
  // 분할 결과를 믿을 수 있나: 이미지 가장자리에 닿거나(배경까지 카드로 분류돼 있음),
  // 화면 대부분을 덮으면 못 믿는다 → 사각형 탐색으로 대체.
  const boxUntrusted =
    !box ||
    box.lo <= 1 || box.to <= 1 || box.ro >= W - 2 || box.bo >= H - 2 ||
    ((box.ro - box.lo) * (box.bo - box.to)) / (W * H) > 0.82;
  const finalBox = boxUntrusted ? (detectOuterByRect() ?? box) : box;
  if (!finalBox) return null;
  let { lo, ro, to, bo } = finalBox;
  // ── 바깥 스냅 보정: 분할로 잡은 대략의 경계를, 주변(±1.5%)에서 가장 강한 실제 경계선
  // 위치로 끌어당긴다. 분할이 그림자·반사로 1~2px 어긋나도 최종 선은 카드 모서리에 붙는다.
  // 기준은 밝기가 아니라 "밝기+채도" 결합이다 — 카드 옆 그림자에서는 그림자→배경의 밝기
  // 대비가 카드→그림자보다 세서 밝기만 보면 스냅이 그림자 끝으로 끌려간다. 채도는 카드
  // (색 있음)→그림자(무채색)에서만 뚝 떨어지므로 결합하면 카드 모서리가 확실히 이긴다.
  {
    const colAll = new Float32Array(W);
    for (let x = 1; x < W; x++) {
      let s = 0;
      for (let y = to; y <= bo; y++) s += Math.abs(cs[y * W + x] - cs[y * W + x - 1]);
      colAll[x] = s;
    }
    const rowAll = new Float32Array(H);
    for (let y = 1; y < H; y++) {
      let s = 0;
      for (let x = lo; x <= ro; x++) s += Math.abs(cs[y * W + x] - cs[(y - 1) * W + x]);
      rowAll[y] = s;
    }
    const snap = (P: Float32Array, center: number, win: number) => {
      let bi = center, bv = -1;
      for (let i = Math.max(1, center - win); i <= Math.min(P.length - 2, center + win); i++)
        if (P[i] > bv) { bv = P[i]; bi = i; }
      return bi;
    };
    // 창을 좁게(1.5%) 둔다. 넓으면 뒷면처럼 카드 끝(약한 경계) 대신 안쪽 테두리(강한
    // 경계)로 당겨 바깥 박스가 카드보다 작아진다. 분할이 이미 근처라 미세 보정이면 충분.
    const winX = Math.max(2, Math.round(W * 0.015));
    const winY = Math.max(2, Math.round(H * 0.015));
    lo = snap(colAll, lo, winX);
    ro = snap(colAll, ro, winX);
    to = snap(rowAll, to, winY);
    bo = snap(rowAll, bo, winY);
    if (ro - lo < W * 0.2 || bo - to < H * 0.2) return null;

    // ── 슬리브/탑로더 보정: 사람들이 카드를 슬리브·탑로더에 끼운 채 찍으면 위 경계는
    // 플라스틱 끝을 잡는다. 그 안쪽(1.5~14%)에서 가장 강한 경계(진짜 카드 끝) 후보를 찾고,
    // "두 경계 사이 고리"가 배경과 비슷한 색(=투명 플라스틱 아래로 배경이 비침)이면 후보를
    // 채택해 파고든다. 카드 테두리(노랑·은색처럼 밝거나 선명한 색)면 배경과 확 달라 그대로
    // 둔다. 네 변을 각각 따로 판단한다 — 슬리브 안에서 카드가 쏠려 있어도 맞는다.
    {
      // 영역 평균색.
      const region = (x0: number, x1: number, y0: number, y1: number): [number, number, number] => {
        let r = 0, gg = 0, b = 0, n = 0;
        for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(H - 1, Math.max(y0, y1)); y++)
          for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(W - 1, Math.max(x0, x1)); x++) {
            const p = (y * W + x) * 4;
            r += data[p]; gg += data[p + 1]; b += data[p + 2]; n++;
          }
        n = Math.max(1, n);
        return [r / n, gg / n, b / n];
      };
      const dist3 = (a: [number, number, number], b: [number, number, number]) =>
        Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      const mx0 = lo + Math.round((ro - lo) * 0.3), mx1 = ro - Math.round((ro - lo) * 0.3);
      const my0 = to + Math.round((bo - to) * 0.3), my1 = bo - Math.round((bo - to) * 0.3);
      const out = Math.max(3, Math.round(W * 0.012)); // 바깥 배경 샘플 폭
      const RING_LIKE_BG = 48; // 고리≈배경 판정 임계(맨해튼 RGB 거리)
      const adjust = (side: 'l' | 'r' | 't' | 'b') => {
        const horiz = side === 'l' || side === 'r';
        const P = horiz ? colAll : rowAll;
        const len = horiz ? ro - lo : bo - to;
        const edge = side === 'l' ? lo : side === 'r' ? ro : side === 't' ? to : bo;
        const dir = side === 'l' || side === 't' ? 1 : -1; // 안쪽 방향
        // 띠(1.5~20%) 안의 경계 후보들: 띠 최대치의 40% 이상인 국소 봉우리, 가까운 순.
        // (바인더 포켓은 카드보다 한참 커서 띠를 넉넉히 잡아야 카드 끝까지 닿는다.)
        const a = Math.round(edge + dir * len * 0.015);
        const b = Math.round(edge + dir * len * 0.2);
        let bandMax = 0;
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++)
          if (i > 0 && i < P.length - 1 && P[i] > bandMax) bandMax = P[i];
        if (bandMax <= 0) return;
        const cands: number[] = [];
        for (let i = a; dir > 0 ? i <= b : i >= b; i += dir) {
          if (i <= 0 || i >= P.length - 1) continue;
          if (P[i] >= bandMax * 0.4 && P[i] >= P[i - 1] && P[i] >= P[i + 1]) cands.push(i);
        }
        // 바깥 배경색: 경계 바로 바깥쪽 띠.
        const bg: [number, number, number] = horiz
          ? region(edge - dir * 1, edge - dir * 2 * out, my0, my1)
          : region(mx0, mx1, edge - dir * 1, edge - dir * 2 * out);
        // 고리(경계~후보 사이)가 "전부" 배경색인지 본다. 평균 하나로 보면 플라스틱 구간이
        // 길 때 카드 일부가 섞여도 평균이 배경처럼 나와 카드 안까지 파고드는 사고가 난다.
        // 그래서 3조각으로 나눠 조각마다 배경과 비슷해야 통과 — 카드에 닿는 순간 실패한다.
        const ringOk = (from: number, toC: number): boolean => {
          const n = 3;
          for (let k = 0; k < n; k++) {
            const s0 = from + ((toC - from) * k) / n;
            const s1 = from + ((toC - from) * (k + 1)) / n;
            const c: [number, number, number] = horiz
              ? region(Math.round(s0), Math.round(s1), my0, my1)
              : region(mx0, mx1, Math.round(s0), Math.round(s1));
            if (dist3(c, bg) >= RING_LIKE_BG) return false;
          }
          return true;
        };
        // 가까운 후보부터 순서대로, 고리가 전부 플라스틱인 동안 계속 파고든다.
        // 카드 테두리 색이 섞이는 순간 멈춘다 — 반사광 줄무늬는 지나치고 카드 끝에서 정지.
        let adopted: number | null = null;
        for (const cand of cands) {
          if (Math.abs(cand - edge) < len * 0.015) continue;
          if (ringOk(edge + dir, cand - dir)) adopted = cand;
          else break;
        }
        if (adopted != null) {
          if (side === 'l') lo = adopted;
          else if (side === 'r') ro = adopted;
          else if (side === 't') to = adopted;
          else bo = adopted;
        }
      };
      // 두 번 반복한다 — 탑로더처럼 플라스틱 겹이 두꺼우면 1회차는 탑로더 끝,
      // 2회차에 진짜 카드 끝까지 파고든다.
      const before = { lo, ro, to, bo };
      for (let pass = 0; pass < 2; pass++) {
        const prev = `${lo},${ro},${to},${bo}`;
        adjust('l');
        adjust('r');
        adjust('t');
        adjust('b');
        if (`${lo},${ro},${to},${bo}` === prev) break;
      }
      // 안전장치: 보정 결과 상자가 너무 작거나 비율이 깨지면 보정만 되돌린다(실패 아님).
      const ar = (ro - lo) / Math.max(1, bo - to);
      if (ro - lo < W * 0.15 || bo - to < H * 0.15 || ar < 0.55 || ar > 0.95) {
        ({ lo, ro, to, bo } = before);
      }
    }
  }
  const outer: Rect = { l: lo / W, t: to / H, r: (ro + 1) / W, b: (bo + 1) / H };
  const owP = ro - lo;
  const ohP = bo - to;
  // ── 안쪽: 카드 영역 안에서만 경계선 프로파일 → 바깥에서 안으로 첫 강한 선 ──
  const colV = new Float32Array(W);
  for (let x = lo + 1; x <= ro; x++) {
    let s = 0;
    for (let y = to; y <= bo; y++) s += Math.abs(g[y * W + x] - g[y * W + x - 1]);
    colV[x] = s / Math.max(1, ohP);
  }
  const rowH = new Float32Array(H);
  for (let y = to + 1; y <= bo; y++) {
    let s = 0;
    for (let x = lo; x <= ro; x++) s += Math.abs(g[y * W + x] - g[(y - 1) * W + x]);
    rowH[y] = s / Math.max(1, owP);
  }
  let cMax = 0;
  for (let x = lo; x <= ro; x++) if (colV[x] > cMax) cMax = colV[x];
  let rMax = 0;
  for (let y = to; y <= bo; y++) if (rowH[y] > rMax) rMax = rowH[y];
  const cT = cMax * 0.18;
  const rT = rMax * 0.18;
  // 색 변화 기반(테두리 색이 그림과 다르면 경계가 흐려도 잡힘) — 가운데 밴드만 샘플.
  const my0 = to + Math.round(ohP * 0.25);
  const my1 = bo - Math.round(ohP * 0.25);
  const mx0 = lo + Math.round(owP * 0.25);
  const mx1 = ro - Math.round(owP * 0.25);
  // 앞면은 얇은 테두리도 있어 넓은 띠(2~22%)를, 뒷면은 파란 테두리 안쪽 경계가 대략
  // 3~16%에 있으니 그 범위를 쓴다. 뒷면은 맨 가장자리 얇은 라인을 건너뛰려 3%부터 시작.
  const backSide = !!opts?.backSide;
  const bandLo = backSide ? 0.03 : 0.02;
  const bandHi = backSide ? 0.2 : 0.22;
  // 색 변화 기반(색만 다르면 경계가 흐려도 잡힘)과 경계선 강도 기반(밝기 급변). 뒷면은
  // "어두운 파란 테두리 → 밝은 소용돌이"라 밝기 급변이 가장 확실하니 그걸 우선하고,
  // 앞면은 색 변화를 우선한다.
  const liC = colorTransition(data, W, 'col', lo + owP * bandLo, lo + owP * bandHi, my0, my1);
  const riC = colorTransition(data, W, 'col', ro - owP * bandLo, ro - owP * bandHi, my0, my1);
  const tiC = colorTransition(data, W, 'row', to + ohP * bandLo, to + ohP * bandHi, mx0, mx1);
  const biC = colorTransition(data, W, 'row', bo - ohP * bandLo, bo - ohP * bandHi, mx0, mx1);
  const liE = firstStrongInBand(colV, lo + owP * bandLo, lo + owP * bandHi, cT);
  const riE = firstStrongInBand(colV, ro - owP * bandLo, ro - owP * bandHi, cT);
  const tiE = firstStrongInBand(rowH, to + ohP * bandLo, to + ohP * bandHi, rT);
  const biE = firstStrongInBand(rowH, bo - ohP * bandLo, bo - ohP * bandHi, rT);
  let li: number | null, ri: number | null, ti: number | null, bi: number | null;
  if (backSide) {
    // 뒷면에서 확실한 특징은 "어두운 파란 테두리 → 밝은 소용돌이"의 밝기 상승이다.
    // (파랑 우세(b−r)는 테두리와 소용돌이 가장자리가 둘 다 파래서 구분이 안 되고,
    //  더 안쪽의 노란 로고에서 크게 반응해 경계를 로고까지 밀어버린다 — 예전 버그.)
    // 가운데 밴드(30~70%)만 평균해 프로파일을 만든다 — 모서리 라운딩과 로고를 피한다.
    const lumProfile = (kind: 'col' | 'row'): Float32Array => {
      const len = kind === 'col' ? W : H;
      const P = new Float32Array(len);
      const a = kind === 'col' ? to + Math.round(ohP * 0.3) : lo + Math.round(owP * 0.3);
      const b = kind === 'col' ? bo - Math.round(ohP * 0.3) : ro - Math.round(owP * 0.3);
      for (let i = 0; i < len; i++) {
        let s = 0, n = 0;
        for (let k = a; k <= b; k++) { s += g[kind === 'col' ? k * W + i : i * W + k]; n++; }
        P[i] = s / Math.max(1, n);
      }
      return P;
    };
    const colLum = lumProfile('col');
    const rowLum = lumProfile('row');
    // 바깥에서 안으로 들어가며 "밝기가 크게 올라가는" 첫 지점(테두리→소용돌이)을 찾는다.
    // 밴드 안 최대 상승폭의 55%를 넘는 첫 상승 봉우리를 고르고, 포물선 보간으로 서브픽셀
    // 위치까지 다듬는다. 로고·소용돌이의 더 강한 변화가 더 안쪽에 있어도 첫 봉우리가 이긴다.
    const risingEdge = (P: Float32Array, fromEdge: number, toDeep: number): number | null => {
      const a = Math.round(fromEdge);
      const b = Math.round(toDeep);
      const step = b >= a ? 1 : -1;
      // 안쪽 방향 밝기 상승량 D[i] = P[i+step] - P[i]
      const idx: number[] = [];
      const D: number[] = [];
      for (let i = a; step > 0 ? i < b : i > b; i += step) {
        idx.push(i);
        D.push(P[i + step] - P[i]);
      }
      if (!D.length) return null;
      const maxRise = Math.max(...D);
      if (maxRise < 4) return null; // 의미 있는 밝기 상승 없음 → 다른 방법으로
      const thr = maxRise * 0.55;
      for (let k = 0; k < D.length; k++) {
        if (D[k] >= thr && (k === 0 || D[k] >= D[k - 1]) && (k === D.length - 1 || D[k] >= D[k + 1])) {
          // 포물선 보간: 이웃 상승량으로 봉우리의 소수점 위치를 추정한다.
          const dm = k > 0 ? D[k - 1] : D[k];
          const dp = k < D.length - 1 ? D[k + 1] : D[k];
          const denom = dm - 2 * D[k] + dp;
          const off = denom !== 0 ? clamp(0.5 * (dm - dp) / denom, -0.5, 0.5) : 0;
          // D[k]는 i→i+step 구간의 상승이므로 경계는 그 사이(+0.5step)다.
          return idx[k] + step * (0.5 + off);
        }
      }
      return null;
    };
    const liB = risingEdge(colLum, lo + owP * bandLo, lo + owP * bandHi);
    const riB = risingEdge(colLum, ro - owP * bandLo, ro - owP * bandHi);
    const tiB = risingEdge(rowLum, to + ohP * bandLo, to + ohP * bandHi);
    const biB = risingEdge(rowLum, bo - ohP * bandLo, bo - ohP * bandHi);
    li = liB ?? liE ?? liC;
    ri = riB ?? riE ?? riC;
    ti = tiB ?? tiE ?? tiC;
    bi = biB ?? biE ?? biC;
  } else {
    li = liC ?? liE;
    ri = riC ?? riE;
    ti = tiC ?? tiE;
    bi = biC ?? biE;
  }
  const inner: Rect = {
    l: li != null ? li / W : outer.l + (outer.r - outer.l) * 0.05,
    t: ti != null ? ti / H : outer.t + (outer.b - outer.t) * 0.05,
    r: ri != null ? (ri + 1) / W : outer.r - (outer.r - outer.l) * 0.05,
    b: bi != null ? (bi + 1) / H : outer.b - (outer.b - outer.t) * 0.05,
  };
  if (!(inner.l < inner.r - 0.02 && inner.t < inner.b - 0.02)) {
    inner.l = outer.l + (outer.r - outer.l) * 0.05;
    inner.r = outer.r - (outer.r - outer.l) * 0.05;
    inner.t = outer.t + (outer.b - outer.t) * 0.05;
    inner.b = outer.b - (outer.b - outer.t) * 0.05;
  }
  inner.l = clamp(inner.l, outer.l, outer.r);
  inner.r = clamp(inner.r, outer.l, outer.r);
  inner.t = clamp(inner.t, outer.t, outer.b);
  inner.b = clamp(inner.b, outer.t, outer.b);
  return { outer, inner };
}
