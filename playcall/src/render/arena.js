// HD-2D 球場場景：3D 球場 + 場館 + 打光 + 後製（光暈、移軸景深、暗角、調色）。
// 座標：x = 球場寬（左右），z = 球場長（-z 是畫面上方），y = 高度；單位公尺。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// NBA 球場尺寸（公尺）
export const COURT = {
  length: 28.65,
  width: 15.24,
  rimFromBaseline: 1.575,
  boardFromBaseline: 1.22,
  rimHeight: 3.05,
  threeRadius: 7.24,
  cornerThree: 6.71,
  keyWidth: 4.88,
  keyLength: 5.79,
  circle: 1.83,
};
const HALF_L = COURT.length / 2;
const HALF_W = COURT.width / 2;

// 籃框中心位置：side = -1 上方籃框（畫面上方），+1 下方
export const rimPos = (side) => new THREE.Vector3(0, COURT.rimHeight, side * (HALF_L - COURT.rimFromBaseline));

function pixelTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 可重現的亂數，讓木紋每次都一樣
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

// ---------- 球場地板貼圖（點陣木紋 + 線） ----------
function courtTexture() {
  const PX = 24; // 每公尺像素數（刻意低解析度，保留點陣感）
  const margin = 2; // 場外地板（公尺）
  const W = Math.round((COURT.width + margin * 2) * PX);
  const H = Math.round((COURT.length + margin * 2) * PX);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rand = rng(7);
  const X = (m) => Math.round((m + HALF_W + margin) * PX);
  const Z = (m) => Math.round((m + HALF_L + margin) * PX);

  // 場外：深色木地板
  g.fillStyle = '#5b3a22';
  g.fillRect(0, 0, W, H);
  // 木條：沿球場長邊排列，每條寬 6px，長度隨機，色調微變
  const tones = ['#d9a466', '#d29c5d', '#dfad70', '#cf975a', '#d6a263'];
  for (let x = X(-HALF_W); x < X(HALF_W); x += 6) {
    let z = Z(-HALF_L) - Math.floor(rand() * 40);
    while (z < Z(HALF_L)) {
      const len = 40 + Math.floor(rand() * 70);
      g.fillStyle = tones[Math.floor(rand() * tones.length)];
      g.fillRect(x, z, 6, len);
      g.fillStyle = 'rgba(90,50,20,0.35)';
      g.fillRect(x, z, 6, 1); // 接縫
      g.fillRect(x + 5, z, 1, len);
      if (rand() < 0.3) {
        g.fillStyle = 'rgba(120,70,30,0.25)';
        g.fillRect(x + 1 + Math.floor(rand() * 4), z + Math.floor(rand() * len), 1, 3); // 木節
      }
      z += len;
    }
  }
  // 罰球區塗色：上方藍、下方黑
  const paint = (side, color) => {
    const z0 = side < 0 ? Z(-HALF_L) : Z(HALF_L - COURT.keyLength);
    g.fillStyle = color;
    g.fillRect(X(-COURT.keyWidth / 2), z0, X(COURT.keyWidth / 2) - X(-COURT.keyWidth / 2), Math.round(COURT.keyLength * PX));
  };
  paint(-1, '#1f5fae');
  paint(1, '#24242a');
  // 中圈塗色
  g.fillStyle = '#1f5fae';
  g.beginPath();
  g.arc(X(0), Z(0), COURT.circle * PX * 0.55, 0, Math.PI * 2);
  g.fill();

  // 白線（2px）
  g.strokeStyle = '#f4f1ea';
  g.lineWidth = 2;
  const line = (pts) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.stroke();
  };
  g.strokeRect(X(-HALF_W), Z(-HALF_L), X(HALF_W) - X(-HALF_W), Z(HALF_L) - Z(-HALF_L));
  line([[-HALF_W, 0], [HALF_W, 0]]);
  g.beginPath();
  g.arc(X(0), Z(0), COURT.circle * PX, 0, Math.PI * 2);
  g.stroke();
  for (const side of [-1, 1]) {
    const base = side * HALF_L;
    const rimZ = side * (HALF_L - COURT.rimFromBaseline);
    const ftZ = side * (HALF_L - COURT.keyLength);
    // 罰球區框線與罰球圈
    line([[-COURT.keyWidth / 2, base], [-COURT.keyWidth / 2, ftZ], [COURT.keyWidth / 2, ftZ], [COURT.keyWidth / 2, base]]);
    g.beginPath();
    g.arc(X(0), Z(ftZ), COURT.circle * PX, 0, Math.PI * 2);
    g.stroke();
    // 三分線：底角直線 + 弧線
    const cx = COURT.cornerThree;
    const dz = Math.sqrt(COURT.threeRadius ** 2 - cx ** 2);
    line([[-cx, base], [-cx, rimZ - side * dz]]);
    line([[cx, base], [cx, rimZ - side * dz]]);
    const a = Math.atan2(dz, cx);
    g.beginPath();
    if (side < 0) g.arc(X(0), Z(rimZ), COURT.threeRadius * PX, a, Math.PI - a);
    else g.arc(X(0), Z(rimZ), COURT.threeRadius * PX, Math.PI + a, -a);
    g.stroke();
    // 禁區半圓
    g.beginPath();
    g.arc(X(0), Z(rimZ), 1.22 * PX, side < 0 ? 0 : Math.PI, side < 0 ? Math.PI : Math.PI * 2);
    g.stroke();
  }
  return { texture: pixelTexture(c), w: COURT.width + margin * 2, h: COURT.length + margin * 2 };
}

// ---------- 看台觀眾貼圖（點陣小人頭） ----------
function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  const rand = rng(42);
  g.fillStyle = '#15161d';
  g.fillRect(0, 0, 256, 32);
  const shirts = ['#1f5fae', '#f58426', '#e8e8e8', '#2a2a33', '#1f5fae', '#f58426', '#8a8f9c'];
  const skins = ['#e0b08a', '#b07a52', '#7a4b30', '#c9946a'];
  for (let row = 0; row < 2; row++)
    for (let x = 2; x < 256; x += 6) {
      const y = row * 16 + 4 + Math.floor(rand() * 2);
      g.fillStyle = shirts[Math.floor(rand() * shirts.length)];
      g.fillRect(x, y + 5, 5, 6);
      g.fillStyle = skins[Math.floor(rand() * skins.length)];
      g.fillRect(x + 1, y + 1, 3, 4);
      if (rand() < 0.15) {
        g.fillStyle = '#f2e4a0';
        g.fillRect(x + 4, y - 2, 1, 4); // 舉手 / 手機燈
      }
    }
  const t = pixelTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------- LED 看板貼圖 ----------
function ledTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const g = c.getContext('2d');
  for (let x = 0; x < 128; x++) {
    const band = Math.floor(x / 16) % 2;
    g.fillStyle = band ? '#f58426' : '#1f6fd0';
    g.fillRect(x, 0, 1, 8);
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let x = 2; x < 128; x += 8) g.fillRect(x, 3, 4, 2);
  const t = pixelTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------- 籃框 ----------
function makeHoop(side) {
  const grp = new THREE.Group();
  const baseZ = side * (HALF_L + 1.3);
  const rimZ = side * (HALF_L - COURT.rimFromBaseline);
  const boardZ = side * (HALF_L - COURT.boardFromBaseline);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: 0.6 });
  const pad = new THREE.MeshStandardMaterial({ color: side < 0 ? 0x1f5fae : 0x2a2a30, roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.4), pad);
  base.position.set(0, 0.5, baseZ);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 0.25), dark);
  pole.position.set(0, 2.2, baseZ);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, Math.abs(baseZ - boardZ)), dark);
  arm.position.set(0, 3.75, (baseZ + boardZ) / 2);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.83, 1.07, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1 })
  );
  board.position.set(0, COURT.rimHeight + 0.5, boardZ);
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.83, 1.07, 0.04)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  frame.position.copy(board.position);
  const square = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.59, 0.45)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  square.position.set(0, COURT.rimHeight + 0.3, boardZ - side * 0.03);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.23, 0.02, 6, 24),
    new THREE.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0x501000, roughness: 0.4 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, COURT.rimHeight, rimZ);
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(0.23, 0.15, 0.42, 12, 3, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 })
  );
  net.position.set(0, COURT.rimHeight - 0.21, rimZ);
  grp.add(base, pole, arm, board, frame, square, rim, net);
  grp.userData.net = net;
  return grp;
}

// ---------- 後製：移軸景深 + 暗角 + 調色 ----------
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    focus: { value: 0.55 }, // 清晰帶中心（螢幕 y，0 = 底部）
    band: { value: 0.22 }, // 清晰帶半寬
    strength: { value: 2.2 }, // 模糊強度（像素）
    dir: { value: new THREE.Vector2(1, 0) },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float focus, band, strength; uniform vec2 dir, resolution;
    varying vec2 vUv;
    void main(){
      float d = max(0.0, abs(vUv.y - focus) - band);
      float r = clamp(d * 6.0, 0.0, 1.0) * strength;
      vec2 step = dir / resolution * r;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2270;
      sum += (texture2D(tDiffuse, vUv + step * 1.38) + texture2D(tDiffuse, vUv - step * 1.38)) * 0.3162;
      sum += (texture2D(tDiffuse, vUv + step * 3.23) + texture2D(tDiffuse, vUv - step * 3.23)) * 0.0703;
      gl_FragColor = sum;
    }`,
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.9 } },
  vertexShader: TiltShiftShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // 暖色調 + 輕微提高對比
      c.rgb = (c.rgb - 0.5) * 1.08 + 0.5;
      c.rgb *= vec3(1.04, 1.0, 0.94);
      float v = smoothstep(0.95, 0.25, distance(vUv, vec2(0.5, 0.52)));
      c.rgb *= mix(1.0, v, vignette * 0.55);
      gl_FragColor = c;
    }`,
};

// ---------- 主場景 ----------
export function createArena(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0c12);
  scene.fog = new THREE.Fog(0x0b0c12, 30, 70);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);

  // 地板
  const ct = courtTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ct.w, ct.h),
    new THREE.MeshStandardMaterial({ map: ct.texture, roughness: 0.42, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(80, 90), new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.01;
  scene.add(outer);

  // 籃框
  const hoops = [makeHoop(-1), makeHoop(1)];
  hoops.forEach((h) => scene.add(h));

  // 看台：沿兩側與兩端的階梯，每階貼觀眾
  const crowd = crowdTexture();
  const standMat = new THREE.MeshStandardMaterial({ color: 0x24252e, roughness: 0.95 });
  const addStand = (len, x, z, rotY) => {
    const grp = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6 + i * 0.6, 1.0), standMat);
      step.position.set(0, (0.6 + i * 0.6) / 2, -i * 1.0);
      const tex = crowd.clone();
      tex.needsUpdate = true;
      tex.repeat.set(len / 6, 1);
      tex.offset.x = i * 0.37;
      const people = new THREE.Mesh(
        new THREE.PlaneGeometry(len, 0.9),
        new THREE.MeshStandardMaterial({ map: tex, transparent: false, roughness: 1, emissive: 0x111118, emissiveMap: tex, emissiveIntensity: 0.6 })
      );
      people.position.set(0, 0.6 + i * 0.6 + 0.4, -i * 1.0 + 0.2);
      grp.add(step, people);
    }
    grp.position.set(x, 0, z);
    grp.rotation.y = rotY;
    scene.add(grp);
  };
  addStand(34, -HALF_W - 4.2, 0, -Math.PI / 2);
  addStand(34, HALF_W + 4.2, 0, Math.PI / 2);
  addStand(24, 0, -HALF_L - 4.5, 0);
  addStand(24, 0, HALF_L + 4.5, Math.PI);

  // LED 看板（場邊，會發光 → 光暈）
  const led = ledTexture();
  const leds = [];
  const addLed = (len, x, z, rotY) => {
    const tex = led.clone();
    tex.needsUpdate = true;
    tex.repeat.set(len / 4, 1);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(len, 0.75),
      new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) })
    );
    m.position.set(x, 0.45, z);
    m.rotation.y = rotY;
    scene.add(m);
    leds.push(tex);
  };
  addLed(30, -HALF_W - 2.2, 0, Math.PI / 2);
  addLed(30, HALF_W + 2.2, 0, -Math.PI / 2);
  addLed(14, 0, -HALF_L - 2.6, 0);
  addLed(14, 0, HALF_L + 2.6, Math.PI);

  // 燈光：暖色環境光 + 天花板聚光燈（加上可見的光錐）
  scene.add(new THREE.HemisphereLight(0xffe8c8, 0x2a1c10, 0.9));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.1);
  key.position.set(-6, 20, 8);
  scene.add(key);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfff0c8, transparent: true, opacity: 0.022, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const [x, z] of [[-4, -9], [4, -9], [-4, 0], [4, 0], [-4, 9], [4, 9]]) {
    const spot = new THREE.SpotLight(0xffe9c4, 60, 30, 0.42, 0.6, 1.6);
    spot.position.set(x, 14, z);
    spot.target.position.set(x * 0.6, 0, z);
    scene.add(spot, spot.target);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 14, 24, 1, true), coneMat);
    cone.position.set(x, 7, z);
    scene.add(cone);
  }

  // 浮塵粒子
  const dustN = 260;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustN * 3);
  const rand = rng(99);
  for (let i = 0; i < dustN; i++) {
    dustPos[i * 3] = (rand() - 0.5) * 16;
    dustPos[i * 3 + 1] = rand() * 9;
    dustPos[i * 3 + 2] = (rand() - 0.5) * 30;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0xfff2cc, size: 0.06, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  scene.add(dust);

  // 後製
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
  composer.addPass(bloom);
  const tiltH = new ShaderPass(TiltShiftShader);
  const tiltV = new ShaderPass(TiltShiftShader);
  tiltV.uniforms.dir.value.set(0, 1);
  composer.addPass(tiltH);
  composer.addPass(tiltV);
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());

  // 半場鏡頭：side = -1 拍上方半場（進攻往上），+1 拍下方半場（鏡頭轉 180 度）
  const cam = { side: -1, t: 1, from: -1 };
  const PITCH = THREE.MathUtils.degToRad(47);
  const FIT_WIDTH = 11.8; // 畫面寬度塞進的球場寬（公尺）：三分弧完整，底角允許略為切掉
  function placeCamera(blend) {
    const aspect = camera.aspect;
    // 讓球場寬度（含一點邊）剛好塞滿畫面寬度
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
    const dist = FIT_WIDTH / 2 / Math.tan(hfov / 2);
    const ang = Math.PI * (cam.from < 0 ? 0 : 1) + Math.PI * (cam.side - cam.from) * 0.5 * ease(blend) * -1;
    const targetZ = THREE.MathUtils.lerp(cam.from, cam.side, ease(blend)) * 9.0;
    const target = new THREE.Vector3(0, 0, targetZ);
    const back = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)); // 鏡頭在目標「後方」
    camera.position.copy(target).addScaledVector(back, Math.cos(PITCH) * dist).add(new THREE.Vector3(0, Math.sin(PITCH) * dist, 0));
    camera.lookAt(target.x, 1.0, target.z);
  }
  const ease = (t) => t * t * (3 - 2 * t);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    for (const p of [tiltH, tiltV]) p.uniforms.resolution.value.set(w * pr, h * pr);
  }

  let effects = true;
  function update(dt, time, render = true) {
    if (cam.t < 1) cam.t = Math.min(1, cam.t + dt / 1.2);
    placeCamera(cam.t);
    leds.forEach((t) => (t.offset.x = (time * 0.15) % 1));
    const p = dust.geometry.attributes.position;
    for (let i = 0; i < dustN; i++) {
      p.array[i * 3 + 1] += dt * 0.08;
      p.array[i * 3] += Math.sin(time * 0.5 + i) * dt * 0.03;
      if (p.array[i * 3 + 1] > 9) p.array[i * 3 + 1] = 0;
    }
    p.needsUpdate = true;
    if (!render) return;
    if (effects) composer.render(dt);
    else renderer.render(scene, camera);
  }

  return {
    THREE,
    scene,
    camera,
    renderer,
    hoops,
    resize,
    update,
    get side() {
      return cam.side;
    },
    switchSide() {
      cam.from = cam.side;
      cam.side = -cam.side;
      cam.t = 0;
    },
    setEffects(on) {
      effects = on;
    },
  };
}
