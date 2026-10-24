// 2D 骨架動畫：把零件圖接上關節，依姿勢角度即時算出每個零件的位置與旋轉。
// 零件來自 art/players/{id}/（由 tools/cut-parts.py 產生）。
// 角色預設面向右方；面向左時整個水平翻轉。
//
// 命名：A = 畫面右側那一邊（角色的左手/左腳，離鏡頭較遠）
//       B = 畫面左側那一邊（角色的右手/右腳，離鏡頭較近）

// 每種零件的錨點（以圖片寬高的比例表示）。pivot = 接到父骨骼的點；joints = 子骨骼接的點。
// base = 圖片本身的方向修正（度），例如手掌圖是手指朝上，所以轉 180 度。
export const ANCHORS = {
  hips: { pivot: [0.5, 0.1], joints: { hipB: [0.3, 0.32], hipA: [0.7, 0.32] } },
  torso: { pivot: [0.5, 0.93], joints: { neck: [0.5, 0.07], shoulderB: [0.15, 0.17], shoulderA: [0.85, 0.17] } },
  head: { pivot: [0.6, 0.92] },
  upperArm: { pivot: [0.5, 0.13], joints: { elbow: [0.45, 0.9] }, scale: 0.85 },
  forearm: { pivot: [0.5, 0.07], joints: { wrist: [0.5, 0.93] }, scale: 0.85 },
  hand: { pivot: [0.45, 0.93], base: 180, scale: 0.85 },
  thigh: { pivot: [0.5, 0.07], joints: { knee: [0.5, 0.9] } },
  shin: { pivot: [0.5, 0.07], joints: { ankle: [0.5, 0.86] } },
  shoe: { pivot: [0.4, 0.22] },
};

// 個別零件的錨點修正（同類零件左右不對稱時用）
export const OVERRIDES = {
  handA: { pivot: [0.3, 0.95] },
  handB: { pivot: [0.7, 0.95] },
};

const KIND = {
  hips: 'hips', torso: 'torso', head: 'head',
  upperArmA: 'upperArm', upperArmB: 'upperArm', forearmA: 'forearm', forearmB: 'forearm',
  handA: 'hand', handB: 'hand', thighA: 'thigh', thighB: 'thigh',
  shinA: 'shin', shinB: 'shin', shoeA: 'shoe', shoeB: 'shoe',
};

// 由後往前的繪製順序（遠側手臂在身體後面，近側手臂在最前面）
const DRAW_ORDER = [
  'upperArmA', 'forearmA', 'handA',
  'thighA', 'shinA', 'shoeA', 'thighB', 'shinB', 'shoeB',
  'head', 'torso', 'hips',
  'upperArmB', 'forearmB', 'handB',
];

// ---------- 2D 仿射矩陣 [a, b, c, d, e, f] ----------
const mat = (a, b, c, d, e, f) => [a, b, c, d, e, f];
const mul = (m, n) =>
  mat(
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  );
const translate = (x, y) => mat(1, 0, 0, 1, x, y);
// 姿勢角度：0 = 往下垂，正值 = 往角色前方（右）擺。畫布的正旋轉是順時針，所以取負號。
const rotate = (deg) => {
  const r = (-deg * Math.PI) / 180;
  return mat(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0);
};
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export async function loadRig(baseUrl) {
  const meta = await (await fetch(`${baseUrl}/parts.json`)).json();
  const images = {};
  await Promise.all(
    Object.keys(meta).map(
      (name) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve((images[name] = img));
          img.onerror = reject;
          img.src = `${baseUrl}/${name}.png`;
        })
    )
  );
  return { meta, images };
}

function anchor(rig, name, key) {
  const a = { ...ANCHORS[KIND[name]], ...OVERRIDES[name] };
  const { w, h } = rig.meta[name];
  const [fx, fy] = key === 'pivot' ? a.pivot : a.joints[key];
  return [fx * w, fy * h];
}

// 依姿勢算出每個零件的世界矩陣（原點 = 腰部，單位 = 原圖像素）
export function solve(rig, pose) {
  const world = {};
  const place = (name, parentM, angle) => {
    const [px, py] = anchor(rig, name, 'pivot');
    const { base = 0, scale = 1 } = ANCHORS[KIND[name]];
    const m = mul(mul(parentM, rotate(angle)), mul(mul(rotate(base), mat(scale, 0, 0, scale, 0, 0)), translate(-px, -py)));
    world[name] = m;
    return m;
  };
  const jointOf = (name, key) => {
    const [x, y] = anchor(rig, name, key);
    return apply(world[name], x, y);
  };
  const at = (name, key) => translate(...jointOf(name, key));
  // 子骨骼的旋轉要累加父骨骼的角度，所以額外記錄累計角度
  const acc = {};

  const root = translate(pose.x || 0, pose.y || 0);
  acc.hips = pose.hips || 0;
  place('hips', root, acc.hips);
  acc.torso = acc.hips + (pose.torso || 0);
  place('torso', root, acc.torso);
  place('head', at('torso', 'neck'), acc.torso + (pose.head || 0));

  for (const s of ['A', 'B']) {
    const arm = pose[`arm${s}`] || [0, 0, 0];
    let a = acc.torso + arm[0];
    place(`upperArm${s}`, at('torso', `shoulder${s}`), a);
    a += arm[1];
    place(`forearm${s}`, at(`upperArm${s}`, 'elbow'), a);
    a += arm[2];
    place(`hand${s}`, at(`forearm${s}`, 'wrist'), a);

    const leg = pose[`leg${s}`] || [0, 0, 0];
    let l = acc.hips + leg[0];
    place(`thigh${s}`, at('hips', `hip${s}`), l);
    l += leg[1];
    place(`shin${s}`, at(`thigh${s}`, 'knee'), l);
    // 鞋子角度相對於髖部（不累加），預設平踩地面
    place(`shoe${s}`, at(`shin${s}`, 'ankle'), acc.hips + leg[2]);
  }
  // 手掌中心：手腕再往手指方向延伸半個手掌
  const palm = (s) => {
    const { w, h } = rig.meta[`hand${s}`];
    return apply(world[`hand${s}`], w * 0.5, h * 0.45);
  };
  const footY = Math.max(jointOf('shinA', 'ankle')[1], jointOf('shinB', 'ankle')[1]);
  return { world, hands: { A: palm('A'), B: palm('B') }, footY };
}

// 畫出角色。x, y = 腳底位置（螢幕座標），scale = 縮放，facing = 1 向右 / -1 向左
export function drawRig(ctx, rig, pose, x, y, scale, facing = 1) {
  const solved = solve(rig, pose);
  const { world } = solved;
  // 讓「站直時的腳踝」對到 y，跳躍時由 pose.lift 往上抬
  const ground = rig.groundY ?? (rig.groundY = solve(rig, {}).footY + rig.meta.shoeA.h * 0.6);
  const screen = mul(translate(x, y), mul(mat(scale * facing, 0, 0, scale, 0, 0), translate(0, -ground - (pose.lift || 0))));
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  for (const name of DRAW_ORDER) {
    const m = mul(screen, world[name]);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(rig.images[name], 0, 0);
  }
  ctx.restore();
  return { screen, hands: solved.hands, ground };
}

export function worldToScreen(screen, p) {
  return apply(screen, p[0], p[1]);
}
