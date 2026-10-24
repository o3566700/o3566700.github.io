// HD-2D 點陣角色產生器（Q 版、約 2.7 頭身、特徵誇張化）。純邏輯：輸出 RGBA，不依賴 DOM。
// 設計原則（參考像素美術常見作法）：
//   1. 剪影優先：每名球員用體型、髮型、手長做出不同的剪影
//   2. 小尺寸誇張比例：大頭、短而粗的四肢、大鞋
//   3. 細節少而大：每人只放大 2–3 個招牌特徵
//   4. 姿勢有重心：預設微蹲前傾的籃球預備姿勢
// 每個零件依骨架角度重新點陣化（不旋轉圖片），交疊處加內描邊，最後加外框。
// 外型參數在 players.json 的 sprite 欄位，球衣顏色在 team.colors。

export const CELL_W = 64;
export const CELL_H = 128;
export const FRAMES = 6;
export const ANIMS = ['idle', 'run', 'dribble', 'shoot', 'defend', 'pass'];
export const DIRS = ['front', 'back'];
const GROUND = CELL_H - 3; // 鞋底所在列
const HW = 20; // 頭寬
const HH = 20; // 頭高

// ---------- 顏色 ----------
const rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// 4 階：亮、基本、暗、最暗。暗部偏藍紫、亮部偏暖黃（色相偏移，HD-2D 常見作法）
function ramp(hex) {
  const c = rgb(hex);
  return [mix(c, [255, 244, 214], 0.3), c, mix(c, [38, 30, 72], 0.36), mix(c, [20, 14, 40], 0.62)];
}
const OUTLINE = [26, 18, 34];
const WHITE = [240, 236, 228];

// 3×5 數字字型
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001010010', '111101111101111', '111101111001111',
];

// ---------- 畫布 ----------
class Buf {
  constructor() {
    this.c = new Array(CELL_W * CELL_H).fill(null);
    this.part = new Int16Array(CELL_W * CELL_H).fill(-1);
    this.next = 0;
  }
  ok(x, y) {
    return x >= 0 && y >= 0 && x < CELL_W && y < CELL_H;
  }
  // 畫一個零件（Map "x,y" → 顏色）。innerLine：在下層零件上先畫 1px 描邊，讓交疊處分得開
  paint(px, innerLine = true) {
    const id = this.next++;
    if (innerLine)
      for (const k of px.keys()) {
        const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!this.ok(nx, ny) || px.has(`${nx},${ny}`)) continue;
          const i = ny * CELL_W + nx;
          if (this.c[i] && this.part[i] !== id) this.c[i] = OUTLINE;
        }
      }
    for (const [k, col] of px) {
      const [x, y] = k.split(',').map(Number);
      if (!this.ok(x, y)) continue;
      this.c[y * CELL_W + x] = col;
      this.part[y * CELL_W + x] = id;
    }
  }
  outline() {
    const add = [];
    for (let y = 0; y < CELL_H; y++)
      for (let x = 0; x < CELL_W; x++)
        if (!this.c[y * CELL_W + x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.ok(x + dx, y + dy) && this.c[(y + dy) * CELL_W + x + dx]))
          add.push(y * CELL_W + x);
    for (const i of add) this.c[i] = OUTLINE;
  }
}

// 膠囊（四肢）：a→b、半徑 r；依與軸線的帶號距離分亮/中/暗（光從左上）
function capsule(a, b, r, pal, band) {
  const px = new Map();
  const [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const lit = nx * -0.7 + ny * -0.7 >= 0 ? 1 : -1;
  for (let y = Math.floor(Math.min(ay, by) - r - 1); y <= Math.ceil(Math.max(ay, by) + r + 1); y++)
    for (let x = Math.floor(Math.min(ax, bx) - r - 1); x <= Math.ceil(Math.max(ax, bx) + r + 1); x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
      const cx = ax + dx * t, cy = ay + dy * t;
      if (Math.hypot(x - cx, y - cy) > r + 0.2) continue;
      const side = ((x - cx) * nx + (y - cy) * ny) * lit;
      const shade = side > r * 0.4 ? 0 : side < -r * 0.3 ? 2 : 1;
      const p = band && t >= band.from && t <= band.to ? band.pal : pal;
      px.set(`${x},${y}`, p[shade]);
    }
  return px;
}

function polySet(pts) {
  const set = new Set();
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      const yy = y + 0.5;
      if ((y1 <= yy && y2 > yy) || (y2 <= yy && y1 > yy)) xs.push(x1 + ((yy - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) set.add(`${x},${y}`);
  }
  return set;
}

// ---------- 頭 ----------
function headMask(dir, jaw) {
  const m = [];
  const chin = dir === 'front' ? 0.9 : 0.2;
  const taper = jaw === 'square' ? 0.045 : jaw === 'round' ? 0.03 : 0.065;
  for (let y = 0; y < HH; y++)
    for (let x = 0; x < HW; x++) {
      let nx = (x + 0.5 - 10 - (y > 12 ? chin : 0)) / 9.4;
      const ny = (y + 0.5 - 10.2) / 10;
      if (y > 12) nx /= 1 - (y - 12) * taper;
      if (nx * nx + ny * ny <= 1) m.push([x, y, nx, ny]);
    }
  return m;
}

// 髮型：(x, y, dir) → 0 無 / 1 頭髮 / 2 亮部。y 可為負（頭頂上方的髮量）；可超出頭的範圍
const HAIR = {
  cornrows(x, y, dir) {
    if (y < -1) return 0;
    if (y === -1) return x >= 5 && x <= 14 ? 1 : 0;
    if (y <= 5 || (y <= 9 && (x <= 3 || x >= 17))) return x % 3 === 1 ? 2 : 1; // 往後梳的辮子線
    // 垂下的辮子（正面在左後方，背面整排）
    if (dir === 'front') return x >= -2 && x <= 2 && y <= 20 && (x + 20) % 2 === 0 ? 1 : 0;
    return y <= 21 && x >= 1 && x <= 18 && x % 2 === 1 ? 1 : 0;
  },
  short(x, y) {
    if (y === -1) return x >= 5 && x <= 14 ? 1 : 0;
    if (y < -1) return 0;
    if (y <= 4 || (y <= 8 && (x <= 2 || x >= 17))) return y <= 1 && x >= 6 && x <= 10 ? 2 : 1;
    return 0;
  },
  fade(x, y) {
    if (y === -3) return x >= 6 && x <= 13 ? 1 : 0;
    if (y === -2 || y === -1) return x >= 3 && x <= 16 ? (y === -2 && x <= 8 ? 2 : 1) : 0;
    if (y < -3) return 0;
    if (y <= 2) return 1;
    return y <= 8 && (x <= 2 || x >= 17) ? 2 : 0; // 兩側推短（淺色）
  },
  buzz(x, y) {
    if (y < 0) return 0;
    return y <= 3 || (y <= 7 && (x <= 2 || x >= 17)) ? 2 : 0;
  },
  curly(x, y) {
    if (y < -4) return 0;
    if (y < 0) {
      const w = [7, 9, 10, 10][y + 4];
      if (Math.abs(x + 0.5 - 10) > w) return 0;
      return (x + y) % 3 === 0 ? 2 : (x + y * 2) % 5 === 0 && y === -4 ? 0 : 1;
    }
    return y <= 4 || (y <= 9 && (x <= 2 || x >= 17)) ? ((x + y) % 3 === 0 ? 2 : 1) : 0;
  },
  twists(x, y) {
    // 頭頂一大叢扭扭頭：一束束往上豎起，高度不一
    if (y < 0) {
      if (x < 1 || x > 18) return 0;
      const tip = -7 - ((x * 7) % 3);
      if (y < tip) return 0;
      return x % 2 === 0 ? 2 : 1;
    }
    return y <= 4 || (y <= 8 && (x <= 2 || x >= 17)) ? (x % 2 === 0 ? 2 : 1) : 0;
  },
};

// 鬍子：(x, y) → 0 / 1 濃 / 2 淡；可超出頭的範圍（大鬍子）
const BEARD = {
  none: () => 0,
  chin(x, y) {
    if (y === 14 && x >= 10 && x <= 15) return 1;
    if (y >= 16 && x >= 8 && x <= 15) return 1;
    if (y >= 20 && y <= 21 && x >= 10 && x <= 14) return 1; // 下巴往下凸
    if (y >= 13 && (x === 3 || x === 4 || x === 17)) return 2;
    return 0;
  },
  huge(x, y) {
    // 一大團鬍子：從臉頰一路長到下巴下方
    if (y === 14 && x >= 9 && x <= 16) return 1;
    if (y >= 12 && y <= 15 && (x <= 5 || x >= 17)) return 1;
    if (y >= 16 && y <= 23) {
      const w = 9.5 - Math.max(0, y - 19) * 1.6;
      return Math.abs(x + 0.5 - 10.8) <= w ? ((x + y) % 4 === 0 ? 2 : 1) : 0;
    }
    return 0;
  },
  full(x, y) {
    if (y === 14 && x >= 10 && x <= 15) return 1;
    if (y >= 13 && (x <= 5 || x >= 17)) return 1;
    if (y >= 16) return 1;
    if (y >= 20 && y <= 20 && x >= 8 && x <= 14) return 1;
    return 0;
  },
  boxed(x, y) {
    if (y === 14 && x >= 10 && x <= 14) return 1;
    if (y >= 15 && (x <= 4 || x >= 17 || y >= 17)) return 1;
    return 0;
  },
  stubble(x, y) {
    if (y === 14 && x >= 11 && x <= 14) return 2;
    if (y >= 16 && (x + y) % 2 === 0) return 2;
    return 0;
  },
  mustache(x, y) {
    return y === 14 && x >= 10 && x <= 15 ? 1 : 0;
  },
};

function drawHead(buf, ox, oy, dir, S, P) {
  const px = new Map();
  const put = (x, y, c) => px.set(`${ox + x},${oy + y}`, c);
  const mask = headMask(dir, S.jaw);
  const inHead = new Set(mask.map(([x, y]) => `${x},${y}`));
  for (const [x, y, nx, ny] of mask) {
    const s = nx * 0.85 + ny * 0.35;
    put(x, y, P.skin[s < -0.62 ? 0 : s > 0.78 ? 3 : s > 0.45 ? 2 : 1]);
  }
  // 耳朵
  const ear = dir === 'front' ? [[-1, 10], [-1, 11], [-2, 11], [-1, 12], [0, 12]] : [[20, 10], [20, 11], [21, 11], [20, 12], [19, 12]];
  ear.forEach(([x, y], i) => put(x, y, P.skin[i === 2 ? 2 : 1]));

  if (dir === 'front') {
    const eyes = S.eyes || 'normal';
    // 眉毛
    const brows = eyes === 'intense' ? [[6, 8], [7, 8], [8, 9], [9, 9], [12, 9], [13, 8], [14, 8]] : [[6, 8], [7, 8], [8, 8], [12, 8], [13, 8], [14, 8]];
    for (const [x, y] of brows) put(x, y, P.hair[1]);
    // 眼睛（朝右前方：瞳孔在右側）
    for (const [ex, w] of [[6, 3], [12, 2]]) {
      if (eyes === 'sleepy') {
        for (let i = 0; i < w; i++) {
          put(ex + i, 9, P.skin[2]);
          put(ex + i, 10, P.skin[3]); // 厚眼皮
          put(ex + i, 11, i === w - 1 ? OUTLINE : WHITE);
        }
      } else if (eyes === 'big') {
        for (let i = 0; i < w; i++) {
          put(ex + i, 9, OUTLINE);
          put(ex + i, 10, i >= w - 2 ? OUTLINE : WHITE);
          put(ex + i, 11, i >= w - 2 ? OUTLINE : WHITE);
        }
        put(ex + w - 1, 10, WHITE); // 眼睛亮點
      } else {
        for (let i = 0; i < w; i++) {
          put(ex + i, 9, OUTLINE);
          put(ex + i, 10, i === w - 1 ? OUTLINE : WHITE);
        }
      }
    }
    // 鼻子、嘴
    put(14, 11, P.skin[2]);
    put(14, 12, P.skin[2]);
    put(13, 13, P.skin[3]);
    put(14, 13, P.skin[2]);
    for (const x of [11, 12, 13]) put(x, 15, P.skin[3]);
    if (S.cheeks) {
      put(15, 13, mix(P.skin[1], [235, 120, 110], 0.3));
      put(5, 13, mix(P.skin[1], [235, 120, 110], 0.3));
    }
    const beard = BEARD[S.beard] || BEARD.none;
    for (let y = 0; y < HH + 5; y++)
      for (let x = -1; x < HW + 1; x++) {
        const b = beard(x, y);
        if (!b) continue;
        if (!inHead.has(`${x},${y}`) && S.beard !== 'huge' && !(S.beard === 'chin' && y >= 20)) continue;
        // 鬍子用平塗：下緣一列暗色、左上偶爾一點亮色，不要雜訊
        if (b === 1) put(x, y, !beard(x, y + 1) ? P.hair[2] : x < 7 && y % 3 === 0 ? P.hair[0] : P.hair[1]);
        else if ((x + y) % 2 === 0) put(x, y, mix(P.skin[2], P.hair[1], 0.5));
      }
  }
  // 頭髮（背面時，髮際線以上的頭部也是頭髮）
  const hair = HAIR[S.hair] || HAIR.short;
  for (let y = -8; y < HH + 3; y++)
    for (let x = -3; x < HW + 3; x++) {
      let h = hair(x, y, dir);
      if (dir === 'back' && inHead.has(`${x},${y}`) && y <= 12) h = 1; // 背面：後腦整片頭髮用基本色
      if (!h) continue;
      const hanging = S.hair === 'cornrows' && y > 9;
      if (y >= 0 && !inHead.has(`${x},${y}`) && !hanging) continue;
      put(x, y, P.hair[h === 2 ? 0 : 1]);
    }
  if (S.extras?.includes('headband')) for (let x = -1; x <= HW; x++) if (inHead.has(`${x},5`) || inHead.has(`${x},6`)) { put(x, 5, P.band[x < 5 ? 0 : 1]); put(x, 6, P.band[x > 14 ? 2 : 1]); }
  buf.paint(px);
}

// ---------- 身體 ----------
function drawTorso(buf, J, dir, P, num) {
  const { shL, shR, hipL, hipR, neckX } = J;
  const shape = polySet([[shL[0], shL[1]], [shR[0] + 1, shR[1]], [hipR[0] + 1, hipR[1] + 1], [hipL[0], hipL[1] + 1]]);
  const xs = [...shape].map((k) => +k.split(',')[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const px = new Map();
  for (const k of shape) {
    const [x] = k.split(',').map(Number);
    const u = (x - minX) / Math.max(1, maxX - minX);
    px.set(k, P.jersey[u < 0.14 ? 0 : u > 0.7 ? 2 : 1]);
  }
  for (const k of shape) {
    const [x, y] = k.split(',').map(Number);
    if (!shape.has(`${x - 1},${y}`) || !shape.has(`${x + 1},${y}`)) px.set(k, P.trim[1]); // 肩帶 / 腋下滾邊
    if (!shape.has(`${x},${y + 1}`)) px.set(k, P.jersey[2]);
  }
  // 領口：正面 V 領、背面淺圓領
  const top = shL[1];
  const depth = dir === 'front' ? 4 : 1;
  for (let d = 0; d < depth; d++) {
    const half = depth - d + 1;
    for (let x = neckX - half; x <= neckX + half; x++) px.set(`${x},${top + d}`, P.skin[d === 0 ? 2 : 1]);
    px.set(`${neckX - half - 1},${top + d}`, P.trim[1]);
    px.set(`${neckX + half + 1},${top + d}`, P.trim[1]);
  }
  for (let x = neckX - 1; x <= neckX + 1; x++) px.set(`${x},${top + depth}`, P.trim[1]);
  // 號碼（描邊）
  const digits = String(num).split('').map(Number);
  const w = digits.length * 4 - 1;
  const nx = neckX - Math.floor(w / 2);
  const ny = top + (dir === 'front' ? 7 : 4);
  const ink = new Set();
  digits.forEach((dg, i) => [...DIGITS[dg]].forEach((bit, k) => bit === '1' && ink.add(`${nx + i * 4 + (k % 3)},${ny + Math.floor(k / 3)}`)));
  for (const k of ink) {
    if (!px.has(k)) continue;
    const [x, y] = k.split(',').map(Number);
    px.set(k, P.number);
    for (const e of [`${x + 1},${y}`, `${x},${y + 1}`, `${x + 1},${y + 1}`]) if (px.has(e) && !ink.has(e)) px.set(e, P.numberEdge);
  }
  buf.paint(px);
}

function drawShorts(buf, J, legs, S, P) {
  const px = new Map();
  const { hipL, hipR } = J;
  for (const k of polySet([[hipL[0] - 1, hipL[1] - 2], [hipR[0] + 2, hipR[1] - 2], [hipR[0] + 2, hipR[1] + 4], [hipL[0] - 1, hipL[1] + 4]])) px.set(k, P.shorts[1]);
  for (const leg of legs) {
    const end = [leg.hip[0] + (leg.knee[0] - leg.hip[0]) * 0.8, leg.hip[1] + (leg.knee[1] - leg.hip[1]) * 0.8];
    for (const [k, c] of capsule(leg.hip, end, S.leg / 2 + 2.2, P.shorts)) px.set(k, c);
  }
  const ys = [...px.keys()].map((k) => +k.split(',')[1]);
  const top = Math.min(...ys);
  for (const k of [...px.keys()]) {
    const [x, y] = k.split(',').map(Number);
    if (y <= top + 1) px.set(k, P.trim[y === top ? 1 : 2]); // 腰帶
    else if (!px.has(`${x},${y + 1}`)) px.set(k, P.trim2[1]); // 下襬
    else if (!px.has(`${x - 1},${y}`) || !px.has(`${x + 1},${y}`)) px.set(k, P.trim[1]); // 側邊條
  }
  buf.paint(px);
}

function drawLeg(buf, leg, S, P, side) {
  const ex = S.extras || [];
  const px = new Map([
    ...capsule(leg.hip, leg.knee, S.leg / 2, P.skin),
    ...capsule(leg.knee, leg.ankle, S.leg / 2 - 0.3, P.skin, { from: ex.includes('socksHigh') ? 0.15 : 0.55, to: 1, pal: P.sock }),
  ]);
  if (ex.includes(`knee${side}`)) for (const [k] of capsule(leg.knee, [leg.knee[0], leg.knee[1] + 2], S.leg / 2 + 0.7, P.pad)) px.set(k, P.pad[k.split(',')[0] < leg.knee[0] ? 0 : 1]);
  buf.paint(px);
  // 大頭鞋：朝右，9 寬 4 高
  const shoe = new Map();
  const ax = Math.round(leg.ankle[0]), ay = Math.round(leg.ankle[1]);
  const rows = [[-2, 2], [-3, 5], [-3, 6], [-3, 6]];
  rows.forEach(([a, b], r) => {
    for (let x = a; x <= b; x++) {
      let col = P.shoe[x < -1 ? 0 : x > 3 && r >= 1 ? 2 : 1];
      if (r === 2 && x >= 0 && x <= 3) col = P.accent[1];
      if (r === 3) col = x > 3 ? P.sole[2] : P.sole[1];
      shoe.set(`${ax + x},${ay + r}`, col);
    }
  });
  buf.paint(shoe);
}

function drawArm(buf, arm, S, P, side) {
  const ex = S.extras || [];
  const r = S.arm / 2;
  const px = new Map([...capsule(arm.sh, arm.elbow, r + 0.5, P.skin), ...capsule(arm.elbow, arm.wrist, r, P.skin)]);
  if (ex.includes(`sleeve${side}`)) for (const [k, c] of capsule(arm.sh, arm.elbow, r + 0.5, P.sleeve)) px.set(k, c);
  if (ex.includes('tattoo'))
    for (const k of [...px.keys()]) {
      const [x, y] = k.split(',').map(Number);
      if ((x * 5 + y * 3) % 6 < 2 && px.get(k) !== P.skin[0]) px.set(k, mix(P.skin[2], [30, 46, 92], 0.55));
    }
  if (ex.includes(`wrist${side}`)) {
    const a = [arm.elbow[0] + (arm.wrist[0] - arm.elbow[0]) * 0.65, arm.elbow[1] + (arm.wrist[1] - arm.elbow[1]) * 0.65];
    for (const [k, c] of capsule(a, arm.wrist, r + 0.6, P.band)) px.set(k, c);
  }
  // 手掌：圓圓的連指手套形
  for (const [k, c] of capsule(arm.hand, arm.hand, r + 1.0, P.skin)) px.set(k, c);
  buf.paint(px);
}

// ---------- 姿勢 ----------
// 角度：0 = 下垂，正 = 往面向方向（右）。手：[上臂, 前臂相對上臂]；腳：[大腿, 小腿相對大腿]
const READY = { bob: 1, lean: 1, lift: 0, armA: [7, 16], armB: [-3, 18], legA: [16, -18], legB: [-10, 12] };

function pose(anim, f, reach = 1) {
  const swing = 1 / reach; // 手越長，擺幅越小，避免甩成麵條
  const ph = (f / FRAMES) * Math.PI * 2;
  const s = Math.sin(ph), c = Math.cos(ph);
  const P = { ...READY, hand: null, shift: 0 };
  switch (anim) {
    case 'idle': {
      const b = [0, 0, 1, 1, 1, 0][f];
      P.bob = 1 + b;
      P.armA = [7 + b, 16];
      P.armB = [-3 - b, 18];
      break;
    }
    case 'run':
    case 'dribble': {
      const amp = anim === 'run' ? 28 : 20;
      const leg = (p) => [amp * Math.sin(p) + 4, -(14 + 52 * Math.max(0, -Math.cos(p)))];
      P.legA = leg(ph);
      P.legB = leg(ph + Math.PI);
      P.lean = 2;
      P.bob = Math.abs(c) > 0.7 ? 1 : 2;
      P.lift = Math.abs(c) > 0.7 ? 1 : 0;
      P.armA = [8 - 22 * s * swing, 50 * swing];
      P.armB = [-4 + 22 * s * swing, 50 * swing];
      if (anim === 'dribble') {
        const down = (1 - Math.cos(ph * 2)) / 2;
        P.armB = [34 + 10 * down, 8 + 14 * (1 - down)];
        P.hand = 'B';
      }
      break;
    }
    case 'shoot':
      Object.assign(P, [
        { bob: 1, armA: [40, 95], armB: [28, 105], legA: [16, -18], legB: [-10, 12] },
        { bob: 5, armA: [42, 100], armB: [30, 105], legA: [36, -66], legB: [16, -52] },
        { bob: 0, lift: 5, armA: [150, 30], armB: [-168, -20], legA: [6, -10], legB: [-4, -8] },
        { bob: 0, lift: 7, armA: [140, 20], armB: [-178, 0], legA: [10, -22], legB: [-2, -14] },
        { bob: 0, lift: 4, armA: [115, 25], armB: [-172, -12], legA: [8, -12], legB: [-4, -6] },
        { bob: 3, armA: [30, 30], armB: [-20, 35], legA: [26, -44], legB: [8, -30] },
      ][f]);
      P.hand = f <= 3 ? 'B' : null;
      break;
    case 'defend': {
      const sl = [0, 1, 2, 1, 0, -1][f];
      P.legA = [36 + sl * 3, -44];
      P.legB = [-36 + sl * 3, 44];
      P.bob = 5;
      P.lean = 0;
      P.armA = [118 + sl * 4, 45];
      P.armB = [-112 + sl * 4, -45];
      P.shift = Math.round(sl / 2);
      break;
    }
    case 'pass':
      Object.assign(P, [
        { armA: [40, 95], armB: [28, 105] },
        { armA: [50, 80], armB: [40, 85], lean: 0 },
        { armA: [82, 15], armB: [78, 15], lean: 3 },
        { armA: [80, 8], armB: [76, 8], lean: 3 },
        { armA: [45, 40], armB: [25, 40], lean: 2 },
        { armA: [7, 16], armB: [-3, 18] },
      ][f]);
      P.legA = [20, -16];
      P.legB = [-12, 10];
      P.hand = f <= 2 ? 'B' : null;
      break;
  }
  return P;
}

const vec = (deg, len) => {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r) * len, Math.cos(r) * len];
};

// ---------- 組合一格 ----------
export function renderFrame(player, colors, anim, f, dir) {
  const S = player.sprite;
  const P = palette(S, colors);
  const p = pose(anim, f, S.reach || 1);
  const buf = new Buf();

  const body = S.height - HH - 2;
  const T = Math.round(body * (1 - (S.legRatio || 0.56)));
  const legLen = body - T - 4; // 扣掉鞋高
  const L1 = Math.round(legLen * 0.5), L2 = legLen - L1;
  const armLen = T * 0.78 * (S.reach || 1); // Q 版手短：一般人垂手只到腰下
  const A1 = Math.round(armLen * 0.5), A2 = Math.round(armLen * 0.5);

  const cx = 31 + p.shift;
  const ankleY = GROUND - 3 - p.lift;
  const legVec = (a) => {
    const k = vec(a[0], L1);
    const s2 = vec(a[0] + a[1], L2);
    return { k, s: s2 };
  };
  const la = legVec(p.legA), lb = legVec(p.legB);
  const hipY = Math.round(ankleY - Math.max(la.k[1] + la.s[1], lb.k[1] + lb.s[1]));
  const shY = hipY - T + p.bob;
  const lean = p.lean;
  const hipL = [cx - Math.floor(S.ww / 2), hipY];
  const hipR = [cx + Math.ceil(S.ww / 2) - 1, hipY];
  const shL = [cx + lean - Math.floor(S.sw / 2), shY];
  const shR = [cx + lean + Math.ceil(S.sw / 2) - 1, shY];
  const J = { shL, shR, hipL, hipR, neckX: cx + lean };

  const mkLeg = (hx, v) => {
    const hip = [hx, hipY + 1];
    const knee = [hip[0] + v.k[0], hip[1] + v.k[1]];
    return { hip, knee, ankle: [knee[0] + v.s[0], knee[1] + v.s[1]] };
  };
  const legA = mkLeg(cx + Math.round(S.ww / 4), la); // 畫面右側（遠）
  const legB = mkLeg(cx - Math.round(S.ww / 4), lb); // 畫面左側（近）
  const mkArm = (shX, a) => {
    const sh = [shX, shY + 2];
    const e = vec(a[0], A1);
    const elbow = [sh[0] + e[0], sh[1] + e[1]];
    const w = vec(a[0] + a[1], A2);
    const wrist = [elbow[0] + w[0], elbow[1] + w[1]];
    const h = vec(a[0] + a[1], S.arm / 2 + 1);
    return { sh, elbow, wrist, hand: [wrist[0] + h[0], wrist[1] + h[1]] };
  };
  const armA = mkArm(shR[0] - Math.floor(S.arm / 3), p.armA);
  const armB = mkArm(shL[0] + Math.floor(S.arm / 3), p.armB);

  const order = dir === 'front' ? ['armA', 'legA', 'legB', 'shorts', 'torso', 'head', 'armB'] : ['legA', 'legB', 'shorts', 'armA', 'armB', 'torso', 'head'];
  for (const part of order) {
    if (part === 'armA') drawArm(buf, armA, S, P, dir === 'front' ? 'L' : 'R');
    if (part === 'armB') drawArm(buf, armB, S, P, dir === 'front' ? 'R' : 'L');
    if (part === 'legA') drawLeg(buf, legA, S, P, 'L');
    if (part === 'legB') drawLeg(buf, legB, S, P, 'R');
    if (part === 'shorts') drawShorts(buf, J, [legA, legB], S, P);
    if (part === 'torso') drawTorso(buf, J, dir, P, player.num);
    if (part === 'head') {
      buf.paint(capsule([cx + lean, shY - 3], [cx + lean, shY + 1], 2.5, P.skin), false); // 脖子
      drawHead(buf, cx + lean - 9, shY - HH - 1, dir, S, P);
    }
  }
  buf.outline();

  const rgba = new Uint8ClampedArray(CELL_W * CELL_H * 4);
  buf.c.forEach((c, i) => c && rgba.set([c[0], c[1], c[2], 255], i * 4));
  return { rgba, hand: p.hand === 'B' ? armB.hand.map(Math.round) : null };
}

function palette(S, colors) {
  return {
    skin: ramp(S.skin),
    hair: ramp(S.hairColor || '#1c1410'),
    jersey: ramp(colors.jersey),
    shorts: ramp(colors.shorts),
    trim: ramp(colors.trim),
    trim2: ramp(colors.trim2),
    sock: ramp(colors.sock),
    shoe: ramp(colors.shoes),
    sole: ramp('#dcdcdc'),
    accent: ramp(colors.accent),
    sleeve: ramp(colors.trim),
    band: ramp(colors.band || colors.trim2),
    pad: ramp('#26262c'),
    number: rgb(colors.number),
    numberEdge: rgb(colors.numberEdge),
  };
}

// 整張 sprite sheet：12 列（正面 6 種動作、背面 6 種動作）× 6 欄
export function renderSheet(player, colors) {
  const w = CELL_W * FRAMES;
  const h = CELL_H * ANIMS.length * DIRS.length;
  const data = new Uint8ClampedArray(w * h * 4);
  const hands = {};
  DIRS.forEach((dir, di) =>
    ANIMS.forEach((anim, ai) => {
      const row = di * ANIMS.length + ai;
      hands[`${dir}.${anim}`] = [];
      for (let f = 0; f < FRAMES; f++) {
        const { rgba, hand } = renderFrame(player, colors, anim, f, dir);
        hands[`${dir}.${anim}`].push(hand);
        for (let y = 0; y < CELL_H; y++) data.set(rgba.subarray(y * CELL_W * 4, (y + 1) * CELL_W * 4), ((row * CELL_H + y) * w + f * CELL_W) * 4);
      }
    })
  );
  return { width: w, height: h, data, hands };
}
