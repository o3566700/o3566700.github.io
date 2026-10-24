// HD-2D 點陣角色產生器（約 3 頭身）。純邏輯：輸出 RGBA，不依賴 DOM，Node 與瀏覽器都能用。
// 每個零件依骨架角度重新點陣化（不是旋轉圖片），零件交疊處自動加內描邊，最後加外框。
// 外型設定在 players.json 的 sprite 欄位，球衣顏色在 team.colors。

export const CELL_W = 48;
export const CELL_H = 88;
export const FRAMES = 6;
export const ANIMS = ['idle', 'run', 'dribble', 'shoot', 'defend', 'pass'];
export const DIRS = ['front', 'back'];
const GROUND = CELL_H - 3; // 鞋底所在列

// ---------- 顏色 ----------
const rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// 4 階：亮、基本、暗、最暗。暗部往藍紫偏，亮部往暖黃偏（HD-2D 常見的色相偏移）
function ramp(hex) {
  const c = rgb(hex);
  return [mix(c, [255, 244, 214], 0.28), c, mix(c, [38, 30, 72], 0.34), mix(c, [20, 14, 40], 0.6)];
}
const OUTLINE = [24, 18, 32];

// 3×5 數字字型
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001010010', '111101111101111', '111101111001111',
];

const BUILDS = {
  slim: { sw: 13, ww: 11, arm: 3, leg: 4 },
  normal: { sw: 14, ww: 12, arm: 4, leg: 4 },
  stocky: { sw: 15, ww: 13, arm: 4, leg: 5 },
  muscular: { sw: 16, ww: 13, arm: 5, leg: 5 },
  big: { sw: 16, ww: 14, arm: 4, leg: 5 },
};

// ---------- 畫布：每格記錄顏色與所屬零件 ----------
class Buf {
  constructor() {
    this.c = new Array(CELL_W * CELL_H).fill(null);
    this.part = new Int16Array(CELL_W * CELL_H).fill(-1);
    this.nextPart = 0;
  }
  ok(x, y) {
    return x >= 0 && y >= 0 && x < CELL_W && y < CELL_H;
  }
  // 畫一個零件：pixels = Map("x,y" → color)。先在下層零件上畫 1px 內描邊，再填色。
  paint(pixels, { innerLine = true } = {}) {
    const id = this.nextPart++;
    if (innerLine) {
      for (const key of pixels.keys()) {
        const [x, y] = key.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!this.ok(nx, ny) || pixels.has(`${nx},${ny}`)) continue;
          const i = ny * CELL_W + nx;
          if (this.c[i] && this.part[i] !== id) this.c[i] = OUTLINE;
        }
      }
    }
    for (const [key, col] of pixels) {
      const [x, y] = key.split(',').map(Number);
      if (!this.ok(x, y)) continue;
      const i = y * CELL_W + x;
      this.c[i] = col;
      this.part[i] = id;
    }
  }
  outline() {
    const add = [];
    for (let y = 0; y < CELL_H; y++)
      for (let x = 0; x < CELL_W; x++) {
        if (this.c[y * CELL_W + x]) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.ok(x + dx, y + dy) && this.c[(y + dy) * CELL_W + x + dx]);
        if (n) add.push(y * CELL_W + x);
      }
    for (const i of add) this.c[i] = OUTLINE;
  }
}

// ---------- 幾何零件 ----------
// 膠囊（四肢）：a→b，半徑 r；依「與軸線的帶號距離」上明暗（光從左上）
function capsule(a, b, r, pal, extra = {}) {
  const px = new Map();
  const [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const nx = -dy / Math.sqrt(len2), ny = dx / Math.sqrt(len2); // 法線
  const lightSide = nx * -0.7 + ny * -0.7 > 0 ? 1 : -1; // 法線朝左上的那側為亮面
  const x0 = Math.floor(Math.min(ax, bx) - r - 1), x1 = Math.ceil(Math.max(ax, bx) + r + 1);
  const y0 = Math.floor(Math.min(ay, by) - r - 1), y1 = Math.ceil(Math.max(ay, by) + r + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const cx = ax + dx * t, cy = ay + dy * t;
      const d = Math.hypot(x - cx, y - cy);
      if (d > r + 0.15) continue;
      const side = ((x - cx) * nx + (y - cy) * ny) * lightSide; // >0 亮面
      let shade = 1;
      if (side > r * 0.45) shade = 0;
      else if (side < -r * 0.25) shade = 2;
      if (extra.band && t >= extra.band[0] && t <= extra.band[1]) {
        px.set(`${x},${y}`, extra.bandPal[shade]);
        continue;
      }
      px.set(`${x},${y}`, pal[shade]);
    }
  return px;
}

function poly(pts) {
  const set = new Set();
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y + 0.5 && y2 > y + 0.5) || (y2 <= y + 0.5 && y1 > y + 0.5)) xs.push(x1 + ((y + 0.5 - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) set.add(`${x},${y}`);
  }
  return set;
}

// ---------- 頭（16×17，含髮型、五官、鬍子） ----------
const HW = 16, HH = 17;
function headMask(dir) {
  const m = [];
  const chin = dir === 'front' ? 0.7 : 0.2;
  for (let y = 0; y < HH; y++)
    for (let x = 0; x < HW; x++) {
      let nx = (x + 0.5 - 8 - (y > 10 ? chin : 0)) / 7.3;
      const ny = (y + 0.5 - 8.3) / 8.5;
      if (y > 10) nx /= 1 - (y - 10) * 0.075;
      if (nx * nx + ny * ny <= 1) m.push([x, y, nx, ny]);
    }
  return m;
}

// 髮型：回傳 (x, y) → 0 無 / 1 頭髮 / 2 頭髮亮部；y 可以是負的（頭頂上方的髮量）
const HAIR = {
  cornrows(x, y, dir) {
    if (y < 0) return 0;
    const top = y <= 4 || (y <= 6 && (x <= 3 || x >= 13));
    if (!top) {
      // 腦後垂下的短辮子
      const braid = dir === 'front' ? x <= 1 && y >= 7 && y <= 13 && (x + y) % 2 === 0 : y >= 6 && y <= 14 && x % 3 === 0;
      return braid ? 1 : 0;
    }
    return x % 3 === 1 ? 2 : 1; // 一條條往後梳的辮子線
  },
  short(x, y) {
    if (y === -1) return x >= 4 && x <= 11 ? 1 : 0;
    if (y < 0) return 0;
    return y <= 3 || (y <= 6 && (x <= 2 || x >= 14)) ? (y === 0 && x > 4 && x < 9 ? 2 : 1) : 0;
  },
  fade(x, y) {
    if (y === -2) return x >= 5 && x <= 10 ? 1 : 0;
    if (y === -1) return x >= 3 && x <= 12 ? 1 : 0;
    if (y < 0) return 0;
    if (y <= 2) return y === 0 && x > 4 && x < 9 ? 2 : 1;
    return y <= 6 && (x <= 2 || x >= 14) ? 2 : 0; // 兩側推短（顏色較淺）
  },
  buzz(x, y) {
    if (y < 0) return 0;
    return y <= 2 || (y <= 5 && (x <= 2 || x >= 14)) ? 2 : 0;
  },
  curly(x, y) {
    if (y === -3) return x >= 4 && x <= 11 && x % 2 === 0 ? 1 : 0;
    if (y === -2) return x >= 2 && x <= 13 ? (x % 3 === 0 ? 2 : 1) : 0;
    if (y === -1) return x >= 1 && x <= 14 ? (x % 3 === 1 ? 2 : 1) : 0;
    if (y < 0) return 0;
    return y <= 3 || (y <= 7 && (x <= 2 || x >= 14)) ? ((x + y) % 3 === 0 ? 2 : 1) : 0;
  },
  twists(x, y) {
    if (y < -4) return 0;
    if (y < 0) return x >= 2 && x <= 13 && (x % 2 === 0 || y >= -2) ? (x % 2 === 0 ? 2 : 1) : 0;
    return y <= 3 || (y <= 6 && (x <= 2 || x >= 14)) ? (x % 2 === 0 ? 2 : 1) : 0;
  },
};

// 鬍子：回傳 0 / 1 濃 / 2 淡（鬍渣）；座標為頭部格子
const BEARD = {
  none: () => 0,
  chin(x, y) {
    if (y === 12 && x >= 8 && x <= 12) return 1; // 八字鬍
    if (y >= 14 && x >= 7 && x <= 12) return 1; // 下巴較濃
    if (y >= 11 && (x === 3 || x === 4 || x === 13)) return 2; // 臉頰較稀
    return 0;
  },
  thick(x, y) {
    if (y === 12 && x >= 7 && x <= 12) return 1;
    if (y >= 11 && (x <= 5 || x >= 13)) return 1;
    if (y >= 14) return 1;
    return 0;
  },
  full(x, y) {
    if (y === 12 && x >= 8 && x <= 12) return 1;
    if (y >= 12 && (x <= 5 || x >= 13)) return 1;
    if (y >= 14) return 1;
    return 0;
  },
  short(x, y) {
    if (y === 12 && x >= 8 && x <= 11) return 1;
    if (y >= 13 && (x <= 4 || x >= 13 || y >= 15)) return 1;
    return 0;
  },
  light(x, y) {
    if (y === 12 && x >= 9 && x <= 11) return 2;
    if (y >= 14 && (x + y) % 2 === 0) return 2;
    return 0;
  },
  mustache(x, y) {
    return y === 12 && x >= 8 && x <= 11 ? 1 : 0;
  },
};

function drawHead(buf, ox, oy, dir, look, P) {
  const px = new Map();
  const put = (x, y, c) => px.set(`${ox + x},${oy + y}`, c);
  const mask = headMask(dir);
  const inHead = new Set(mask.map(([x, y]) => `${x},${y}`));
  for (const [x, y, nx, ny] of mask) {
    const s = nx * 0.85 + ny * 0.35;
    put(x, y, P.skin[s < -0.6 ? 0 : s > 0.75 ? 3 : s > 0.42 ? 2 : 1]);
  }
  // 耳朵
  const ear = dir === 'front' ? [[0, 8], [0, 9], [-1, 9], [0, 10]] : [[15, 8], [15, 9], [16, 9], [15, 10]];
  ear.forEach(([x, y], i) => put(x, y, P.skin[i === 2 ? 2 : 1]));

  if (dir === 'front') {
    // 眉毛、眼睛（朝右前方：瞳孔偏右）、鼻、嘴
    const sleepy = look.eyes === 'sleepy';
    for (const x of [5, 6, 7, 10, 11, 12]) put(x, 7, P.hair[1]);
    for (const [ex, w] of [[5, 3], [10, 2]]) {
      for (let i = 0; i < w; i++) {
        put(ex + i, 8, sleepy ? P.skin[2] : OUTLINE); // 眼皮
        put(ex + i, 9, i === w - 1 ? OUTLINE : [238, 232, 222]);
      }
      if (!sleepy) put(ex + w - 1, 8, OUTLINE);
    }
    put(11, 10, P.skin[2]);
    put(11, 11, P.skin[2]);
    put(10, 13, P.skin[3]);
    put(11, 13, P.skin[3]);
    if (look.young) put(12, 12, mix(P.skin[1], [220, 120, 110], 0.25)); // 臉頰紅潤
    const beard = BEARD[look.beard] || BEARD.none;
    for (const [x, y] of mask) {
      const b = beard(x, y);
      if (b === 1) put(x, y, (x + y) % 4 === 0 ? P.hair[0] : P.hair[1]);
      if (b === 2 && (x + y) % 2 === 0) put(x, y, mix(P.skin[2], P.hair[1], 0.5));
    }
  }
  // 頭髮（背面時頭髮蓋住更多）
  const hair = HAIR[look.hair] || HAIR.short;
  for (let y = -5; y < HH; y++)
    for (let x = -2; x < HW + 2; x++) {
      let h = hair(x, y, dir);
      if (dir === 'back' && !h && inHead.has(`${x},${y}`) && y <= 9) h = (hair(x, Math.min(y, 3), dir) || hair(x, 1, dir)) ? 1 : 0;
      if (!h) continue;
      if (y >= 0 && !inHead.has(`${x},${y}`) && !(look.hair === 'cornrows' && y > 5)) continue;
      put(x, y, P.hair[h === 2 ? 0 : 1]);
    }
  if (look.extras?.includes('headband')) for (let x = 0; x < HW; x++) if (inHead.has(`${x},4`)) put(x, 4, P.band[x < 4 ? 0 : x > 11 ? 2 : 1]);
  buf.paint(px);
}

// ---------- 身體 ----------
function drawTorso(buf, J, dir, b, P, num) {
  const { shL, shR, hipL, hipR, neck } = J;
  const shape = poly([
    [shL[0] + 1, shL[1] - 1], [shR[0], shR[1] - 1],
    [hipR[0] + 1, hipR[1] + 1], [hipL[0], hipL[1] + 1],
  ]);
  const px = new Map();
  const xs = [...shape].map((k) => +k.split(',')[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  for (const k of shape) {
    const [x, y] = k.split(',').map(Number);
    const u = (x - minX) / Math.max(1, maxX - minX);
    px.set(k, P.jersey[u < 0.15 ? 0 : u > 0.68 ? 2 : 1]);
  }
  // 腋下開口與肩帶滾邊
  for (const k of shape) {
    const [x, y] = k.split(',').map(Number);
    if (!shape.has(`${x - 1},${y}`) || !shape.has(`${x + 1},${y}`)) px.set(k, P.trim[1]);
  }
  // 領口：正面 V 領、背面圓領
  const cx = Math.round(neck[0]);
  const top = Math.round(shL[1] - 1);
  const depth = dir === 'front' ? 3 : 1;
  for (let d = 0; d < depth; d++)
    for (let x = cx - (depth - d) - 1; x <= cx + (depth - d); x++) {
      px.set(`${x},${top + d}`, P.skin[1]);
      px.set(`${x - 1},${top + d}`, P.trim[1]);
      px.set(`${cx + (depth - d) + 1},${top + d}`, P.trim[1]);
    }
  px.set(`${cx},${top + depth}`, P.trim[1]);
  // 號碼（背面較大，置中）
  const digits = String(num).split('').map(Number);
  const w = digits.length * 4 - 1;
  const nx = cx - Math.floor(w / 2);
  const ny = top + (dir === 'front' ? 5 : 3);
  const ink = new Set();
  digits.forEach((dg, i) => [...DIGITS[dg]].forEach((bit, k) => bit === '1' && ink.add(`${nx + i * 4 + (k % 3)},${ny + Math.floor(k / 3)}`)));
  for (const k of ink) {
    const [x, y] = k.split(',').map(Number);
    if (!px.has(k)) continue;
    px.set(k, P.number);
    const e = `${x + 1},${y + 1}`;
    if (px.has(e) && !ink.has(e)) px.set(e, P.numberEdge);
  }
  buf.paint(px);
}

function drawShorts(buf, J, legs, b, P) {
  const px = new Map();
  const { hipL, hipR } = J;
  const body = poly([[hipL[0] - 1, hipL[1] - 1], [hipR[0] + 2, hipR[1] - 1], [hipR[0] + 2, hipR[1] + 3], [hipL[0] - 1, hipL[1] + 3]]);
  for (const k of body) px.set(k, P.shorts[1]);
  for (const leg of legs) {
    const end = [leg.hip[0] + (leg.knee[0] - leg.hip[0]) * 0.85, leg.hip[1] + (leg.knee[1] - leg.hip[1]) * 0.85];
    for (const [k, c] of capsule(leg.hip, end, b.leg / 2 + 1.6, P.shorts)) px.set(k, c);
  }
  // 腰帶、下襬與側邊條
  const ys = [...px.keys()].map((k) => +k.split(',')[1]);
  const top = Math.min(...ys);
  for (const k of [...px.keys()]) {
    const [x, y] = k.split(',').map(Number);
    if (y === top) px.set(k, P.trim[1]);
    else if (!px.has(`${x},${y + 1}`)) px.set(k, P.trim2[1]);
    else if (!px.has(`${x - 1},${y}`) || !px.has(`${x + 1},${y}`)) px.set(k, P.trim[2]);
  }
  buf.paint(px);
}

function drawLeg(buf, leg, b, P, extras, side) {
  const thigh = capsule(leg.hip, leg.knee, b.leg / 2, P.skin);
  const sockFrom = extras.includes('socksHigh') ? 0.2 : 0.55;
  const shin = capsule(leg.knee, leg.ankle, b.leg / 2 - 0.4, P.skin, { band: [sockFrom, 1], bandPal: P.sock });
  const px = new Map([...thigh, ...shin]);
  if (extras.includes(`knee${side}`)) for (const [k] of capsule(leg.knee, leg.knee, b.leg / 2 + 0.6, P.pad)) px.set(k, P.pad[1]);
  buf.paint(px);
  // 鞋：朝右（面向方向），鞋底一列淺色
  const shoe = new Map();
  const [ax, ay] = leg.ankle.map(Math.round);
  const toe = leg.toeDir;
  for (let y = 0; y < 3; y++)
    for (let x = -2; x <= 4; x++) {
      if (y === 0 && (x < -1 || x > 1)) continue;
      const sx = ax + x * toe;
      const col = y === 2 ? P.sole[1] : x === 2 && y === 1 ? P.accent[1] : P.shoe[x <= -1 ? 0 : y === 1 && x > 2 ? 2 : 1];
      shoe.set(`${sx},${ay + y + 1}`, col);
    }
  buf.paint(shoe);
}

function drawArm(buf, arm, b, P, extras, side, reach) {
  const r = b.arm / 2;
  const px = new Map([...capsule(arm.sh, arm.elbow, r + 0.3, P.skin), ...capsule(arm.elbow, arm.wrist, r - 0.2, P.skin)]);
  if (extras.includes(`sleeve${side}`)) {
    for (const [k, c] of capsule(arm.sh, arm.elbow, r + 0.3, P.sleeve)) px.set(k, c);
  }
  if (extras.includes(`wrist${side}`)) {
    const a = [arm.elbow[0] + (arm.wrist[0] - arm.elbow[0]) * 0.72, arm.elbow[1] + (arm.wrist[1] - arm.elbow[1]) * 0.72];
    for (const [k, c] of capsule(a, arm.wrist, r + 0.3, P.band)) px.set(k, c);
  }
  if (extras.includes('tattoo')) {
    for (const [k] of capsule(arm.sh, arm.elbow, r - 0.6, P.skin)) {
      const [x, y] = k.split(',').map(Number);
      if ((x * 3 + y * 5) % 7 < 2) px.set(k, mix(P.skin[2], [30, 40, 80], 0.5));
    }
  }
  // 手掌
  for (const [k, c] of capsule(arm.wrist, arm.hand, r + 0.1, P.skin)) px.set(k, c);
  buf.paint(px);
}

// ---------- 姿勢 ----------
// 角度：0 = 下垂，正 = 往面向方向（右）擺。手：[上臂, 前臂相對上臂]；腳：[大腿, 小腿相對大腿]
function pose(anim, f, dir) {
  const ph = (f / FRAMES) * Math.PI * 2;
  const s = Math.sin(ph), c = Math.cos(ph);
  const P = { bob: 0, lean: 0, lift: 0, armA: [10, 15], armB: [-10, 15], legA: [6, -2], legB: [-6, 2], wide: 0, hand: null };
  switch (anim) {
    case 'idle':
      P.bob = f % 3 === 2 ? 1 : 0;
      P.armA = [10 + (f % 3 === 2 ? 2 : 0), 18];
      P.armB = [-10 - (f % 3 === 2 ? 2 : 0), 18];
      break;
    case 'run':
    case 'dribble': {
      const amp = anim === 'run' ? 30 : 22;
      const leg = (p) => [amp * Math.sin(p), -(10 + 55 * Math.max(0, -Math.cos(p)))];
      P.legA = leg(ph);
      P.legB = leg(ph + Math.PI);
      P.lean = 1;
      P.bob = Math.abs(c) > 0.7 ? 0 : 1;
      P.lift = Math.abs(c) > 0.7 ? 1 : 0;
      P.armA = [8 - 22 * s, 45 + 10 * s];
      P.armB = [-8 + 22 * s, 45 - 10 * s];
      if (anim === 'dribble') {
        const down = (1 - Math.cos(ph * 2)) / 2; // 手往下拍
        P.armB = [30 + 10 * down, 10 + 10 * (1 - down)];
        P.hand = 'B';
      }
      break;
    }
    case 'shoot': {
      const K = [
        { bob: 0, armA: [40, 90], armB: [30, 100], legA: [6, -2], legB: [-6, 2] },
        { bob: 3, armA: [45, 95], armB: [35, 100], legA: [30, -60], legB: [18, -55] },
        { bob: 0, lift: 4, armA: [150, 30], armB: [-165, -25], legA: [4, -10], legB: [-4, -8] },
        { bob: 0, lift: 6, armA: [140, 20], armB: [-178, -2], legA: [8, -20], legB: [-2, -14] },
        { bob: 0, lift: 3, armA: [110, 20], armB: [-170, -10], legA: [6, -10], legB: [-4, -6] },
        { bob: 2, armA: [30, 30], armB: [-30, 30], legA: [22, -40], legB: [10, -32] },
      ][f];
      Object.assign(P, K);
      P.hand = f <= 3 ? 'B' : null;
      break;
    }
    case 'defend': {
      const sl = [0, 1, 0, -1, 0, 1][f];
      P.legA = [34 + sl * 4, -40];
      P.legB = [-34 + sl * 4, 40];
      P.bob = 4;
      P.armA = [120 + sl * 6, 40];
      P.armB = [-115 + sl * 6, -40];
      P.shift = sl;
      break;
    }
    case 'pass': {
      const K = [
        { armA: [40, 95], armB: [30, 100] },
        { armA: [55, 70], armB: [45, 75], lean: -1 },
        { armA: [85, 15], armB: [80, 15], lean: 1 },
        { armA: [80, 10], armB: [75, 10], lean: 1 },
        { armA: [40, 40], armB: [20, 40] },
        { armA: [10, 18], armB: [-10, 18] },
      ][f];
      Object.assign(P, K);
      P.legA = [14, -6];
      P.legB = [-10, 4];
      P.hand = f <= 2 ? 'B' : null;
      break;
    }
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
  const b = BUILDS[S.build];
  const P = palette(S, colors);
  const p = pose(anim, f, dir);
  const buf = new Buf();
  const ex = S.extras || [];

  const H = S.height; // 含頭的總身高（像素）
  const body = H - HH;
  const T = Math.round(body * 0.36);
  const legLen = body - T - 1;
  const L1 = Math.round(legLen * 0.48), L2 = legLen - L1 - 3;
  const reach = S.reach || 1;
  const A1 = Math.round(T * 0.62 * reach), A2 = Math.round(T * 0.52 * reach);

  const cx = 23 + (p.shift || 0);
  const ankleY = GROUND - 3 - p.lift;
  // 由腳往上推髖部高度（彎膝時髖部下降）
  const legPts = (angles, hipX) => {
    const k = vec(angles[0], L1);
    const a = vec(angles[0] + angles[1], L2);
    return { k, a };
  };
  const la = legPts(p.legA), lb = legPts(p.legB);
  const drop = Math.max(la.k[1] + la.a[1], lb.k[1] + lb.a[1]);
  const hipY = Math.round(ankleY - drop);
  const shY = hipY - T + p.bob; // bob：上半身下沉（呼吸、蹲）
  const headY = shY - HH - 1; // 留 2px 脖子
  const lean = p.lean || 0;

  const hipL = [cx - Math.floor(b.ww / 2), hipY];
  const hipR = [cx + Math.ceil(b.ww / 2) - 1, hipY];
  const shL = [cx + lean - Math.floor(b.sw / 2), shY];
  const shR = [cx + lean + Math.ceil(b.sw / 2) - 1, shY];
  const J = { shL, shR, hipL, hipR, neck: [cx + lean, shY] };

  // 腳：A = 畫面右側（遠），B = 畫面左側（近）
  const mkLeg = (hipX, pts) => {
    const hip = [hipX, hipY + 1];
    const knee = [hip[0] + pts.k[0], hip[1] + pts.k[1]];
    const ankle = [hip[0] + pts.k[0] + pts.a[0], hip[1] + pts.k[1] + pts.a[1]];
    return { hip, knee, ankle, toeDir: 1 };
  };
  const legA = mkLeg(cx + Math.round(b.ww / 4), la);
  const legB = mkLeg(cx - Math.round(b.ww / 4), lb);

  const mkArm = (shX, angles, out) => {
    const sh = [shX, shY + 2];
    const e = vec(angles[0] * out, A1);
    const w = vec((angles[0] + angles[1]) * out, A2);
    const elbow = [sh[0] + e[0], sh[1] + e[1]];
    const wrist = [elbow[0] + w[0], elbow[1] + w[1]];
    const h = vec((angles[0] + angles[1]) * out, 2.2);
    return { sh, elbow, wrist, hand: [wrist[0] + h[0], wrist[1] + h[1]] };
  };
  // 手臂角度正值 = 往右；A 在右肩、B 在左肩
  const armA = mkArm(shR[0] - 1, p.armA, 1);
  const armB = mkArm(shL[0] + 1, p.armB, 1);

  const order =
    dir === 'front'
      ? ['armA', 'legA', 'legB', 'shorts', 'torso', 'head', 'armB']
      : ['legA', 'legB', 'shorts', 'armA', 'armB', 'torso', 'head'];
  for (const part of order) {
    if (part === 'armA') drawArm(buf, armA, b, P, ex, dir === 'front' ? 'L' : 'R', reach);
    if (part === 'armB') drawArm(buf, armB, b, P, ex, dir === 'front' ? 'R' : 'L', reach);
    if (part === 'legA') drawLeg(buf, legA, b, P, ex, 'L');
    if (part === 'legB') drawLeg(buf, legB, b, P, ex, 'R');
    if (part === 'shorts') drawShorts(buf, J, [legA, legB], b, P);
    if (part === 'torso') drawTorso(buf, J, dir, b, P, player.num);
    if (part === 'head') {
      buf.paint(capsule([cx + lean, shY - 3], [cx + lean, shY], 2, P.skin), { innerLine: false });
      drawHead(buf, cx + lean - 8, headY, dir, S, P);
    }
  }
  buf.outline();

  const rgba = new Uint8ClampedArray(CELL_W * CELL_H * 4);
  buf.c.forEach((c, i) => c && rgba.set([c[0], c[1], c[2], 255], i * 4));
  const hand = p.hand === 'B' ? armB.hand : null;
  return { rgba, hand: hand && hand.map(Math.round) };
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
    sole: ramp('#d9d9d9'),
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
