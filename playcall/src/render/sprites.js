// 程式拼裝的點陣圖球員。純邏輯：輸出 RGBA 像素陣列，不依賴 DOM。
// 外型來自 players.json 的 look / ht，球衣顏色來自 team.colors。

export const CELL_W = 20;
export const CELL_H = 44;

export const ANIMS = {
  idle: 2,
  run: 4,
  dribble: 4,
  shoot: 4,
  defend: 2,
};

const SKIN = {
  light: ['#C99067', '#A8724E'],
  medium: ['#9C6640', '#7C4F31'],
  dark: ['#6A4129', '#4E2F1D'],
};
const HAIR = '#1C1410';
const OUTLINE = '#14121C';
const BALL = ['#E8742A', '#9A4316'];
const EYE = '#14121C';

const BUILD_WIDTH = { slim: 6, normal: 7, stocky: 8, muscular: 8, big: 8 };

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

// 球員身高（英吋）→ 點陣身高。74 吋 = 22px，88 吋 = 30px。
export function bodyHeight(ht) {
  return Math.round(22 + ((ht - 74) * 8) / 14);
}

class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Array(w * h).fill(null);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.px[y * this.w + x];
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  outline(c) {
    const add = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))
          add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, c);
  }
  toRGBA() {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    this.px.forEach((c, i) => {
      if (c) out.set(hex(c), i * 4);
    });
    return out;
  }
}

// 每一格動畫的姿勢參數。
function pose(anim, f) {
  const p = { stride: 0, bob: 0, crouch: 0, jump: 0, wide: 0, arms: 'down', ball: null, slide: 0 };
  switch (anim) {
    case 'idle':
      p.bob = f;
      break;
    case 'run':
    case 'dribble':
      p.stride = [1, 0, -1, 0][f];
      p.bob = f % 2;
      if (anim === 'dribble') {
        p.arms = 'dribble';
        p.ball = f % 2 === 0 ? 'hand' : 'floor';
      }
      break;
    case 'shoot':
      p.crouch = [1, 0, 0, 1][f];
      p.jump = [0, 2, 3, 0][f];
      p.arms = ['chest', 'up', 'up', 'down'][f];
      p.ball = ['chest', 'head', 'release', null][f];
      break;
    case 'defend':
      p.wide = 2;
      p.crouch = 1;
      p.arms = 'out';
      p.slide = f;
      break;
  }
  return p;
}

function drawPlayer(g, player, colors, anim, f) {
  const look = player.look;
  const [skin, skinDark] = SKIN[look.skin];
  const h = bodyHeight(player.ht);
  const tw = BUILD_WIDTH[look.build];
  const armW = look.build === 'muscular' || look.build === 'big' ? 2 : 1;
  const p = pose(anim, f);

  const torsoH = Math.round((h - 10) * 0.47);
  const legH = h - 10 - torsoH - p.crouch;
  const cx = 9 + p.slide;
  const left = cx - Math.floor(tw / 2);

  // 由下往上排：鞋 2、腿、短褲 3、上衣、頭 5
  const baseY = CELL_H - 2 - p.jump;
  const shoeY = baseY - 1;
  const legTop = shoeY - legH;
  const shortsY = legTop - 3;
  const torsoY = shortsY - torsoH + p.bob;
  const headY = torsoY - 5;

  // 腿與鞋
  const legGap = 1 + p.wide;
  const legL = cx - 1 - Math.ceil(legGap / 2) - 1 + 1;
  const legR = cx + Math.floor(legGap / 2) + 1;
  const lOff = p.stride;
  const rOff = -p.stride;
  g.rect(legL + lOff, legTop, 2, legH - (p.stride > 0 ? 1 : 0), skin);
  g.rect(legR + rOff, legTop, 2, legH - (p.stride < 0 ? 1 : 0), skin);
  g.rect(legL + lOff - 1, shoeY - (p.stride > 0 ? 1 : 0), 3, 2, colors.shoes);
  g.rect(legR + rOff, shoeY - (p.stride < 0 ? 1 : 0), 3, 2, colors.shoes);

  // 短褲
  g.rect(left, shortsY, tw, 3, colors.shorts);
  g.rect(left, shortsY, 1, 3, colors.trim);
  g.rect(left + tw - 1, shortsY, 1, 3, colors.trim);
  g.set(cx, shortsY + 2, null);

  // 上衣
  g.rect(left, torsoY, tw, torsoH, colors.jersey);
  g.rect(left, torsoY, tw, 1, colors.trim);
  g.rect(left, torsoY, 1, torsoH, colors.trim); // 側邊滾條
  g.rect(left + tw - 1, torsoY, 1, torsoH, colors.trim);
  g.rect(cx - 1, torsoY, 3, 1, skin); // 領口
  g.set(cx, torsoY + 1, skin);
  g.rect(left, torsoY + torsoH - 1, tw, 1, colors.trim2);

  // 手臂
  const aL = left - armW;
  const aR = left + tw;
  const armLen = torsoH + 1;
  const arm = (x, y, w, len) => g.rect(x, y, w, len, skin);
  switch (p.arms) {
    case 'down':
      arm(aL, torsoY + 1, armW, armLen);
      arm(aR, torsoY + 1, armW, armLen);
      break;
    case 'out':
      g.rect(aL - 2, torsoY + 1, armW + 2, 1, skin);
      arm(aL - 2, torsoY + 1, 1, armLen - 2);
      g.rect(aR, torsoY + 1, armW + 2, 1, skin);
      arm(aR + armW + 1, torsoY + 1, 1, armLen - 2);
      break;
    case 'chest':
      arm(aL, torsoY + 1, armW, 3);
      arm(aR, torsoY + 1, armW, 3);
      g.rect(left + 1, torsoY + 3, tw - 2, 1, skinDark);
      break;
    case 'up':
      arm(aL + 1, headY - 4, armW, 5 + 2);
      arm(aR - 1, headY - 4, armW, 5 + 2);
      break;
    case 'dribble':
      arm(aL, torsoY + 1, armW, armLen);
      arm(aR, torsoY + 1, armW, armLen - 2);
      g.set(aR + armW, torsoY + armLen - 1, skin);
      break;
  }

  // 頭
  const hx = cx - 2;
  g.rect(hx, headY + 1, 5, 4, skin);
  g.set(hx + 4, headY + 4, skinDark);
  g.set(hx + 2, headY + 2, EYE);
  g.set(hx + 4, headY + 2, EYE);
  switch (look.hair) {
    case 'buzz':
      g.rect(hx, headY, 5, 1, '#3A2A20');
      break;
    case 'twists':
      g.rect(hx - 1, headY, 7, 2, HAIR);
      g.set(hx, headY - 1, HAIR);
      g.set(hx + 2, headY - 1, HAIR);
      g.set(hx + 4, headY - 1, HAIR);
      g.set(hx - 1, headY + 2, HAIR);
      break;
    case 'curly':
      g.rect(hx, headY, 5, 1, HAIR);
      g.set(hx + 1, headY - 1, HAIR);
      g.set(hx + 3, headY - 1, HAIR);
      g.set(hx, headY + 1, HAIR);
      break;
    default:
      g.rect(hx, headY, 5, 1, HAIR);
      g.set(hx, headY + 1, HAIR);
  }
  switch (look.beard) {
    case 'light':
      g.rect(hx + 1, headY + 4, 3, 1, skinDark);
      break;
    case 'goatee':
      g.set(hx + 2, headY + 3, HAIR);
      g.set(hx + 3, headY + 3, HAIR);
      g.set(hx + 3, headY + 4, HAIR);
      break;
    case 'full':
      g.rect(hx, headY + 3, 5, 2, HAIR);
      g.set(hx + 2, headY + 3, skin);
      g.set(hx + 3, headY + 3, skin);
      break;
  }

  // 球
  const ball = (x, y) => {
    g.rect(x, y, 3, 3, BALL[0]);
    g.set(x + 1, y + 1, BALL[1]);
  };
  switch (p.ball) {
    case 'hand':
      ball(aR + armW, torsoY + armLen);
      break;
    case 'floor':
      ball(aR + armW, shoeY - 2);
      break;
    case 'chest':
      ball(cx - 1, torsoY + 2);
      break;
    case 'head':
      ball(cx - 1, headY - 4);
      break;
    case 'release':
      ball(cx, headY - 8);
      break;
  }
}

export function renderFrame(player, colors, anim, f) {
  const g = new Grid(CELL_W, CELL_H);
  drawPlayer(g, player, colors, anim, f);
  g.outline(OUTLINE);
  return g.toRGBA();
}

// 整張 sprite sheet：每列一種動作，每欄一格。
export function renderSheet(player, colors) {
  const rows = Object.keys(ANIMS);
  const cols = Math.max(...Object.values(ANIMS));
  const w = CELL_W * cols;
  const h = CELL_H * rows.length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((anim, r) => {
    for (let f = 0; f < ANIMS[anim]; f++) {
      const frame = renderFrame(player, colors, anim, f);
      for (let y = 0; y < CELL_H; y++) {
        const src = y * CELL_W * 4;
        const dst = ((r * CELL_H + y) * w + f * CELL_W) * 4;
        data.set(frame.subarray(src, src + CELL_W * 4), dst);
      }
    }
  });
  return { width: w, height: h, data, rows };
}

// 瀏覽器用：轉成 canvas。
export function sheetToCanvas(sheet) {
  const c = document.createElement('canvas');
  c.width = sheet.width;
  c.height = sheet.height;
  c.getContext('2d').putImageData(new ImageData(sheet.data, sheet.width, sheet.height), 0, 0);
  return c;
}
