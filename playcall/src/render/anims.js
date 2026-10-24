// 動作：輸入動作名稱與時間（秒），輸出骨架姿勢。
// 姿勢欄位（角度，0 = 下垂，正 = 往前擺；手腳為 [上段, 下段相對上段, 末端相對下段]）：
//   hips, torso, head, armA, armB, legA, legB, lift（往上抬的像素，跳躍用）, ball

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

function lerpPose(p, q, t) {
  const out = {};
  for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) {
    if (k === 'ball') continue; // 球的狀態由各動作自己決定
    const a = p[k] ?? (Array.isArray(q[k]) ? q[k].map(() => 0) : 0);
    const b = q[k] ?? (Array.isArray(p[k]) ? p[k].map(() => 0) : 0);
    out[k] = Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], t)) : lerp(a, b, t);
  }
  return out;
}

// 關鍵影格動作：[[時間比例, 姿勢], ...]
function keyframes(frames, u) {
  for (let i = 0; i < frames.length - 1; i++) {
    const [t0, p0] = frames[i];
    const [t1, p1] = frames[i + 1];
    if (u <= t1) return lerpPose(p0, p1, ease((u - t0) / (t1 - t0)));
  }
  return frames[frames.length - 1][1];
}

const IDLE = {
  torso: 2, head: -2,
  armA: [8, 10, 0], armB: [-6, 12, 0],
  legA: [6, -3, 0], legB: [-6, 3, 0],
};

export const ANIMS = {
  idle: { loop: true, dur: 2.4 },
  run: { loop: true, dur: 0.62 },
  dribble: { loop: true, dur: 0.7 },
  shoot: { loop: false, dur: 1.1 },
  defend: { loop: true, dur: 0.9 },
};

// 腳的角度：鞋子為絕對角度，負值 = 腳尖朝下
function stride(ph, amp, kneeAmp) {
  const sw = Math.sin(ph);
  const back = Math.max(0, -Math.cos(ph)); // 擺盪期（腳在後方抬起）
  return [amp * sw, -(15 + kneeAmp * back), -25 * back + 8 * Math.max(0, sw)];
}

export function poseAt(anim, time) {
  const def = ANIMS[anim];
  const u = def.loop ? (time / def.dur) % 1 : Math.min(1, time / def.dur);
  const s = Math.sin(u * TAU);
  const c = Math.cos(u * TAU);

  switch (anim) {
    case 'idle': {
      const breath = Math.sin(u * TAU);
      return { ...IDLE, torso: 2 + breath, lift: breath * 3, armA: [8 + breath, 10, 0], armB: [-6 - breath, 12, 0] };
    }

    case 'run':
      // 3/4 視角下手臂主要是前後擺（朝鏡頭），畫面上只看到小幅度擺動與彎肘
      return {
        hips: 4, torso: 8, head: -6,
        legA: stride(u * TAU, 34, 65), legB: stride(u * TAU + Math.PI, 34, 65),
        armA: [12 - 22 * s, 55 + 15 * s, 0], armB: [-8 + 22 * s, 55 - 15 * s, 0],
        lift: 16 * Math.abs(c),
      };

    case 'dribble': {
      const push = (1 + Math.cos(u * TAU)) / 2; // 1 = 手在高點
      const ballY = 1 - Math.abs(Math.sin(u * Math.PI)); // 1 = 在手上，0 = 在地上
      return {
        hips: 6, torso: 12, head: -10,
        legA: stride(u * TAU, 22, 40), legB: stride(u * TAU + Math.PI, 22, 40),
        armA: [10 - 15 * s, 50, 0],
        armB: [22 - 10 * push, 15 + 25 * push, 15],
        lift: 8 * Math.abs(c),
        ball: { mode: 'dribble', t: ballY },
      };
    }

    case 'shoot': {
      const gather = {
        hips: 16, torso: -6, head: -6,
        legA: [40, -64, 0], legB: [30, -58, 0],
        armA: [35, 85, 0], armB: [25, 100, 0],
        lift: -45,
      };
      const rise = {
        hips: 0, torso: -2, head: -4,
        legA: [4, -6, -15], legB: [-4, -4, -20],
        armA: [150, 25, 0], armB: [-160, -30, -10],
        lift: 70,
      };
      const release = {
        hips: 0, torso: -1, head: -6,
        legA: [8, -14, -20], legB: [-2, -10, -25],
        armA: [140, 15, 0], armB: [-178, -5, -40],
        lift: 85,
      };
      const land = { ...IDLE, hips: 10, legA: [24, -40, 0], legB: [14, -34, 0], lift: -25, armA: [20, 20, 0], armB: [-150, -10, -40] };
      const p = keyframes(
        [
          [0, IDLE],
          [0.25, gather],
          [0.45, rise],
          [0.58, release],
          [0.82, land],
          [1, IDLE],
        ],
        u
      );
      p.ball = u < 0.58 ? { mode: 'hands' } : { mode: 'flight', t: (u - 0.58) / 0.42 };
      return p;
    }

    case 'defend': {
      // 低重心滑步：雙腳張開、小腿接近垂直，雙手張開上舉
      const slide = Math.sin(u * TAU);
      return {
        hips: 0, torso: 6, head: -6,
        legA: [30 + 6 * slide, -28, 0], legB: [-30 + 6 * slide, 28, 0],
        armA: [115 + 8 * slide, 35, 0], armB: [-110 + 8 * slide, -35, 0],
        lift: -45 + 6 * Math.abs(slide),
      };
    }
  }
  return IDLE;
}
