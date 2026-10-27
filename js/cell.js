// 牢屋そのもの：鉄格子・鉄扉・囚人番号プレート・監視カメラ・監視灯・換気口・床の格子の影。
// 座標は「独房の座標」：原点は部屋の中心の床、-Z が扉のある壁の方向（開始時の正面）、Y が上。
// root を現実の部屋に合わせて置き（位置と向き）、中身は build() で作り直す。
// 当たり判定は一切持たない（すり抜けられる）。
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder, mat } from './builder.js';
import { makeIronTextures, makeDoorTextures, makePlateTexture, makeGlowTexture } from './textures.js';

export const WALLS = ['front', 'right', 'back', 'left'];
export const WALL_LABEL = { front: '正面', right: '右', back: '後ろ', left: '左' };

const BAR_R = 0.021;      // 鉄格子の半径（太さ 4.2cm）
const DOOR_W = 0.86;
const JAMB = 0.1;         // 扉枠の太さ
const BAND_H = 0.05;      // 横の補強材の高さ
const POST = 0.07;        // 角柱
const WIN = { x: 0.13, y0: 1.48, y1: 1.62 }; // 覗き窓（半幅・下端・上端）

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 壁ごとの置き方（独房の座標）。u = 部屋の内側から見て右向き、n = 内向きの法線
export function wallFrames(W, D, inset) {
  const hw = W / 2 - inset, hd = D / 2 - inset;
  return {
    front: { c: new THREE.Vector3(0, 0, -hd), ry: 0, len: hw * 2 },
    right: { c: new THREE.Vector3(hw, 0, 0), ry: -Math.PI / 2, len: hd * 2 },
    back: { c: new THREE.Vector3(0, 0, hd), ry: Math.PI, len: hw * 2 },
    left: { c: new THREE.Vector3(-hw, 0, 0), ry: Math.PI / 2, len: hd * 2 },
  };
}

function frameAxes(f) {
  // ry だけ回したときの u（局所 +X）と n（局所 +Z）
  const u = new THREE.Vector3(Math.cos(f.ry), 0, -Math.sin(f.ry));
  const n = new THREE.Vector3(Math.sin(f.ry), 0, Math.cos(f.ry));
  return { u, n };
}

// 床の格子の影（廊下側の明かりが鉄格子越しに差し込んでいる、という見立て）。
// 床の各点から光源へ向かう線が扉の壁を通る位置を求め、そこに鉄格子・補強材・扉があれば暗くする
const shadowVert = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = (uFloorM * vec4(position, 1.0)).xyz; // 床板の行列＝独房の座標への変換
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;
const shadowFrag = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uC; uniform vec3 uU; uniform vec3 uN;
  uniform float uLen, uH, uBarStart, uBarStep, uStrength, uOpacity;
  uniform vec4 uDoor;   // x0, x1, 扉の高さ, 枠の太さ
  uniform vec4 uWin;    // x0, x1, y0, y1（覗き窓）
  uniform vec3 uBands;  // 補強材の高さ3本
  varying vec3 vLocal;
  float band(float d, float half_, float w) { return 1.0 - smoothstep(half_ - w, half_ + w, abs(d)); }
  void main() {
    vec3 p = vLocal;
    vec3 dir = p - uLight;
    float den = dot(dir, uN);
    if (den <= 1e-4) discard;
    float t = dot(uC - uLight, uN) / den;
    vec3 q = uLight + dir * t;
    float qx = dot(q - uC, uU);
    float qy = q.y;
    float dLight = length(q - uLight);
    float dFloor = length(p - q);
    float w = 0.003 + 0.07 * dFloor / (dLight + dFloor); // 遠いほど影がぼける
    float hl = uLen * 0.5;
    // 光が差し込む範囲（壁の幅の中）だけに影を落とす
    float lit = 1.0 - smoothstep(hl - 0.3, hl + 0.05, abs(qx));
    lit *= exp(-dFloor * 0.22);
    float s = 0.0;
    float inDoor = step(uDoor.x - uDoor.w, qx) * step(qx, uDoor.y + uDoor.w);
    // 鉄格子（扉の範囲では扉の上だけ）
    float k = (qx - uBarStart) / uBarStep;
    float d = abs(fract(k + 0.5) - 0.5) * uBarStep;
    float bars = band(d, ${BAR_R.toFixed(3)}, w);
    bars *= mix(1.0, step(uDoor.z + uDoor.w, qy), inDoor);
    s = max(s, bars);
    // 横の補強材・床と天井のレール
    s = max(s, band(qy - uBands.x, ${(BAND_H / 2).toFixed(3)}, w));
    s = max(s, band(qy - uBands.y, ${(BAND_H / 2).toFixed(3)}, w));
    s = max(s, band(qy - uBands.z, ${(BAND_H / 2).toFixed(3)}, w));
    s = max(s, 1.0 - smoothstep(0.04 - w, 0.04 + w, qy));
    // 角柱
    s = max(s, smoothstep(hl - ${POST.toFixed(3)} - w, hl - ${POST.toFixed(3)} + w, abs(qx)));
    // 扉と枠（覗き窓からは光が入る）
    float door = (smoothstep(uDoor.x - uDoor.w - w, uDoor.x - uDoor.w + w, qx) - smoothstep(uDoor.y + uDoor.w - w, uDoor.y + uDoor.w + w, qx))
               * (1.0 - smoothstep(uDoor.z + uDoor.w - w, uDoor.z + uDoor.w + w, qy));
    float win = (smoothstep(uWin.x - w, uWin.x + w, qx) - smoothstep(uWin.y - w, uWin.y + w, qx))
              * (smoothstep(uWin.z - w, uWin.z + w, qy) - smoothstep(uWin.w - w, uWin.w + w, qy));
    s = max(s, door * (1.0 - win * 0.85));
    float a = s * lit * uStrength * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;

export class Cell {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'cell';
    this.content = null;
    this.reveal = 1;
    this.doorFade = 1;

    const iron = makeIronTextures(512);
    this.ironMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: iron.map, roughnessMap: iron.roughnessMap, bumpMap: iron.bumpMap,
      bumpScale: 2.2, metalness: 0.55, roughness: 1, envMapIntensity: 0.9,
    });
    const door = makeDoorTextures(512);
    this.doorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: door.map, roughnessMap: door.roughnessMap, bumpMap: door.bumpMap,
      bumpScale: 1.6, metalness: 0.3, roughness: 1, envMapIntensity: 0.7, transparent: true,
    });
    this.doorIronMat = this.ironMat.clone();
    this.doorIronMat.transparent = true;
    this.housingMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.55, metalness: 0.05 });
    this.lensMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.15, metalness: 0.6 });
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
    this.glowTex = makeGlowTexture();
    this.plateTex = null;
    this.plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.42, envMapIntensity: 1.0 });

    this.shadowMat = new THREE.ShaderMaterial({
      uniforms: {
        uFloorM: { value: new THREE.Matrix4() },
        uLight: { value: new THREE.Vector3() },
        uC: { value: new THREE.Vector3() }, uU: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() },
        uLen: { value: 1 }, uH: { value: 2.4 }, uBarStart: { value: 0 }, uBarStep: { value: 0.15 },
        uStrength: { value: 0.2 }, uOpacity: { value: 1 },
        uDoor: { value: new THREE.Vector4() }, uWin: { value: new THREE.Vector4() }, uBands: { value: new THREE.Vector3() },
      },
      vertexShader: 'uniform mat4 uFloorM;\n' + shadowVert,
      fragmentShader: shadowFrag,
      transparent: true,
      depthWrite: false,
      // パススルーの上に「黒を半透明で重ねる」：アルファも素直に足す（a² に薄まらないように）
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });

    // 配置中だけ見せる、床の外周と角の目印
    this.guideMat = new THREE.LineBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.9, depthTest: false });

    this.lamp = { on: true, level: 1, flicker: 0 };
    this.cam = { yaw: 0, pitch: 0.4, tYaw: 0, tPitch: 0.4, moving: false, hold: 0, blink: 0 };
    this.onCameraMove = null; // 監視カメラが首を振りはじめたとき（音を鳴らす）
  }

  // cfg: { width, depth, height, spacing, door: { wall, offset }, number, shadow, doorOpacity, lamp, inset }
  build(cfg) {
    this.cfg = cfg;
    if (this.content) {
      this.root.remove(this.content);
      this.content.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const content = (this.content = new THREE.Group());
    this.root.add(content);

    const { width: W, depth: D, height: H, spacing } = cfg;
    const inset = cfg.inset ?? 0.06;
    const frames = wallFrames(W, D, inset);
    this.frames = frames;
    const iron = new MeshBuilder();
    const wallM = (f) => mat(f.c.x, 0, f.c.z, 0, f.ry, 0);
    const bands = [0.14, Math.min(1.05, H * 0.45), H - 0.14];
    this.bands = bands;
    const rnd = mulberry(cfg.number || 1);
    const off = () => [rnd() * 7, rnd() * 7];

    // 扉の位置（壁の長さに収める）
    const dw = frames[cfg.door.wall];
    const doorH = Math.min(2.0, H - 0.3);
    const maxOff = Math.max(0, dw.len / 2 - DOOR_W / 2 - JAMB - 0.08);
    cfg.door.offset = THREE.MathUtils.clamp(cfg.door.offset, -maxOff, maxOff);
    const doorX = cfg.door.offset;
    const dx0 = doorX - DOOR_W / 2, dx1 = doorX + DOOR_W / 2;
    this.doorInfo = { wall: cfg.door.wall, x: doorX, h: doorH, maxOff };

    for (const name of WALLS) {
      const f = frames[name];
      const M = wallM(f);
      const L = f.len;
      const isDoorWall = name === cfg.door.wall;
      const n = Math.max(2, Math.round(L / spacing));
      const step = L / n;
      if (isDoorWall) this.barGrid = { start: -L / 2, step };
      for (let i = 1; i < n; i++) {
        const x = -L / 2 + i * step;
        const local = new THREE.Matrix4();
        if (isDoorWall && x > dx0 - JAMB - BAR_R && x < dx1 + JAMB + BAR_R) {
          // 扉の上（まぐさの上）だけ短い鉄格子
          const y0 = doorH + JAMB, len = H - 0.02 - y0;
          if (len > 0.08 && (x > dx0 && x < dx1)) {
            local.multiplyMatrices(M, mat(x, y0 + len / 2, 0));
            iron.addCylinder(local, BAR_R, len, 10, { off: off(), caps: false });
          }
          continue;
        }
        local.multiplyMatrices(M, mat(x, H / 2, 0));
        iron.addCylinder(local, BAR_R, H - 0.02, 10, { off: off(), caps: false });
      }
      // 横の補強材（平鋼）。扉の部分は切る
      const segs = isDoorWall ? [[-L / 2, dx0 - JAMB], [dx1 + JAMB, L / 2]] : [[-L / 2, L / 2]];
      for (const y of bands) {
        for (const [a, b] of segs) {
          if (b - a < 0.02) continue;
          iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat((a + b) / 2, y, 0)), b - a, BAND_H, 0.013, { off: off() });
        }
        // 鉄格子と補強材の交点の鋲（内側の面）
        for (let i = 1; i < n; i++) {
          const x = -L / 2 + i * step;
          if (isDoorWall && x > dx0 - JAMB - BAR_R && x < dx1 + JAMB + BAR_R) continue;
          iron.addCylinder(new THREE.Matrix4().multiplyMatrices(M, mat(x, y, 0.009, Math.PI / 2)), 0.009, 0.008, 6, { off: off() });
        }
      }
      // 床と天井のレール（山形鋼のつもりの角材）
      iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(0, 0.02, 0)), L, 0.04, 0.07, { off: off() });
      iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(0, H - 0.02, 0)), L, 0.04, 0.07, { off: off() });
      // 角柱（各壁の左端に1本。4本で四隅になる）
      iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(-L / 2, H / 2, 0)), POST, H, POST, { off: off() });

      if (isDoorWall) {
        // 扉枠（左右の柱とまぐさ）
        for (const x of [dx0 - JAMB / 2, dx1 + JAMB / 2]) {
          iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(x, (doorH + JAMB) / 2, 0)), JAMB, doorH + JAMB, JAMB, { off: off() });
        }
        iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(doorX, doorH + JAMB / 2, 0)), DOOR_W + JAMB * 2, JAMB, JAMB, { off: off() });
      }
    }

    // 囚人番号プレートの取り付け金具（3本の鉄格子にまたがる平鋼）
    const plate = this._platePlace(frames[cfg.door.wall], doorX);
    {
      const M = wallM(frames[cfg.door.wall]);
      iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(plate.x, plate.y + 0.02, BAR_R + 0.006)), 0.36, 0.04, 0.012, { off: off() });
      iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(plate.x, plate.y - 0.05, BAR_R + 0.006)), 0.36, 0.04, 0.012, { off: off() });
    }

    // 換気口（扉の向かいの壁、天井近く。現実の壁に貼りつける）
    const ventWall = WALLS[(WALLS.indexOf(cfg.door.wall) + 2) % 4];
    {
      const f = frames[ventWall];
      const M = wallM(f);
      const vz = -inset + 0.015;
      const vy = H - 0.32;
      iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(0, vy, vz)), 0.46, 0.24, 0.02, { off: off() });
      for (let i = 0; i < 6; i++) {
        iron.addBox(new THREE.Matrix4().multiplyMatrices(M, mat(0, vy - 0.09 + i * 0.036, vz + 0.02, -0.6)), 0.4, 0.028, 0.006, { off: off() });
      }
      this.ventLocal = new THREE.Vector3(0, vy, vz).applyMatrix4(M);
    }

    const ironMesh = new THREE.Mesh(iron.build(), this.ironMat);
    ironMesh.name = 'bars';
    content.add(ironMesh);

    // ---------- 鉄扉 ----------
    const doorGroup = new THREE.Group();
    doorGroup.applyMatrix4(new THREE.Matrix4().multiplyMatrices(wallM(frames[cfg.door.wall]), mat(doorX, 0, 0)));
    content.add(doorGroup);
    this._buildDoor(doorGroup, doorH);
    this.doorGroup = doorGroup;
    this.doorCenterLocal = new THREE.Vector3(0, doorH / 2, 0).applyMatrix4(doorGroup.matrix);

    // ---------- 囚人番号プレート ----------
    if (this.plateTex) this.plateTex.dispose();
    this.plateTex = makePlateTexture(cfg.number);
    this.plateMat.map = this.plateTex;
    this.plateMat.needsUpdate = true;
    const plateMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.004), [
      this.ironMat, this.ironMat, this.ironMat, this.ironMat, this.plateMat, this.ironMat,
    ]);
    plateMesh.applyMatrix4(new THREE.Matrix4().multiplyMatrices(wallM(frames[cfg.door.wall]), mat(plate.x, plate.y, BAR_R + 0.016)));
    content.add(plateMesh);

    // ---------- 監視カメラ（扉の壁の、扉から遠い方の天井の隅） ----------
    this._buildCamera(content, frames, cfg, H, doorX);

    // ---------- 監視灯（天井の中央、かご付き電球） ----------
    this._buildLamp(content, H, cfg.lamp);

    // ---------- 床の格子の影 ----------
    const fW = W - inset * 2, fD = D - inset * 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fW, fD), this.shadowMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.004;
    floor.renderOrder = 5;
    floor.name = 'floor-shadow';
    floor.updateMatrix();
    this.shadowMat.uniforms.uFloorM.value.copy(floor.matrix);
    content.add(floor);
    this._setupShadow(frames[cfg.door.wall], doorX, doorH, H, cfg.shadow);

    // ---------- 配置中の目印 ----------
    const guide = new THREE.Group();
    const hw = W / 2 - inset, hd = D / 2 - inset;
    const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const loop = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.01, z)));
    guide.add(new THREE.LineLoop(loop, this.guideMat));
    const vg = [];
    for (const [x, z] of pts) vg.push(new THREE.Vector3(x, 0.01, z), new THREE.Vector3(x, H, z));
    guide.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(vg), this.guideMat));
    // 扉の輪郭
    const dM = doorGroup.matrix;
    const dp = [[-DOOR_W / 2, 0], [DOOR_W / 2, 0], [DOOR_W / 2, doorH], [-DOOR_W / 2, doorH]]
      .map(([x, y]) => new THREE.Vector3(x, y + 0.005, 0.06).applyMatrix4(dM));
    guide.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(dp), this.guideMat));
    guide.traverse((o) => { o.renderOrder = 300; });
    content.add(guide);
    this.guide = guide;

    this.setReveal(this.reveal);
  }

  _platePlace(f, doorX) {
    const half = f.len / 2;
    let x = doorX + DOOR_W / 2 + JAMB + 0.36;
    if (x + 0.2 > half - POST) x = doorX - DOOR_W / 2 - JAMB - 0.36;
    return { x, y: 1.52 };
  }

  _buildDoor(g, dh) {
    const paint = new MeshBuilder();
    const iron = new MeshBuilder();
    const hw = DOOR_W / 2 - 0.006;
    const T = 0.06;
    const sc = { scale: 0.9, off: [0.2, 0.1] };
    const box = (b, x, y, z, sx, sy, sz, opt = sc, rx = 0) => b.addBox(mat(x, y, z, rx), sx, sy, sz, opt);
    // 扉板（覗き窓の穴を残して4枚で）
    const y0 = 0.012;
    box(paint, 0, (y0 + WIN.y0) / 2, 0, hw * 2, WIN.y0 - y0, T);
    box(paint, 0, (WIN.y1 + dh) / 2, 0, hw * 2, dh - WIN.y1, T);
    box(paint, (-hw - WIN.x) / 2, (WIN.y0 + WIN.y1) / 2, 0, hw - WIN.x, WIN.y1 - WIN.y0, T);
    box(paint, (hw + WIN.x) / 2, (WIN.y0 + WIN.y1) / 2, 0, hw - WIN.x, WIN.y1 - WIN.y0, T);
    // 内側の面の補強板（外周の帯と横帯2本）
    const zf = T / 2 + 0.006;
    box(paint, 0, dh - 0.04, zf, hw * 2, 0.07, 0.012);
    box(paint, 0, 0.05, zf, hw * 2, 0.08, 0.012);
    box(paint, -hw + 0.035, dh / 2, zf, 0.07, dh - 0.02, 0.012);
    box(paint, hw - 0.035, dh / 2, zf, 0.07, dh - 0.02, 0.012);
    for (const y of [0.42, 1.12]) box(paint, 0, y, zf, hw * 2 - 0.1, 0.08, 0.012);
    // 覗き窓の縁と、上に開いた蓋
    box(paint, 0, WIN.y1 + 0.02, zf, WIN.x * 2 + 0.08, 0.04, 0.014);
    box(paint, 0, WIN.y0 - 0.02, zf, WIN.x * 2 + 0.08, 0.04, 0.014);
    box(paint, -WIN.x - 0.02, (WIN.y0 + WIN.y1) / 2, zf, 0.04, WIN.y1 - WIN.y0, 0.014);
    box(paint, WIN.x + 0.02, (WIN.y0 + WIN.y1) / 2, zf, 0.04, WIN.y1 - WIN.y0, 0.014);
    box(paint, 0, WIN.y1 + 0.13, zf + 0.012, WIN.x * 2 + 0.06, 0.16, 0.01);
    // 食器口（閉じている）
    box(paint, 0, 0.9, zf + 0.004, 0.4, 0.14, 0.014);
    box(paint, 0, 0.9 + 0.045, zf + 0.016, 0.06, 0.018, 0.016);
    // 鋲（外周の帯に沿って）
    for (let y = 0.12; y < dh - 0.08; y += 0.13) {
      for (const x of [-hw + 0.035, hw - 0.035]) paint.addCylinder(mat(x, y, zf + 0.008, Math.PI / 2), 0.009, 0.01, 6, sc);
    }
    for (let x = -hw + 0.1; x < hw - 0.06; x += 0.13) {
      for (const y of [0.05, dh - 0.04, 0.42, 1.12]) paint.addCylinder(mat(x, y, zf + 0.008, Math.PI / 2), 0.009, 0.01, 6, sc);
    }
    // 覗き窓の細い格子
    for (const x of [-0.065, 0, 0.065]) iron.addCylinder(mat(x, (WIN.y0 + WIN.y1) / 2, 0), 0.007, WIN.y1 - WIN.y0, 6, {});
    // 蝶番（扉の左側。錆びた筒と羽根）
    for (const y of [0.3, dh / 2, dh - 0.3]) {
      iron.addCylinder(mat(-DOOR_W / 2 - 0.012, y, zf + 0.012), 0.026, 0.19, 10, {});
      iron.addBox(mat(-DOOR_W / 2 + 0.08, y, zf + 0.004), 0.17, 0.13, 0.008, {});
      iron.addBox(mat(-DOOR_W / 2 - 0.06, y, JAMB / 2 + 0.004), 0.09, 0.13, 0.008, {});
      iron.addCylinder(mat(-DOOR_W / 2 - 0.012, y + 0.11, zf + 0.012), 0.012, 0.03, 8, {}); // 軸の頭
    }
    // 閂の受け金具（扉に2つ、枠に1つ）。コの字
    const latchY = 1.08, lz = zf + 0.05;
    const bracket = (x) => {
      iron.addBox(mat(x, latchY + 0.038, lz - 0.02), 0.06, 0.016, 0.07, {});
      iron.addBox(mat(x, latchY - 0.038, lz - 0.02), 0.06, 0.016, 0.07, {});
      iron.addBox(mat(x, latchY, lz + 0.03), 0.06, 0.092, 0.014, {});
    };
    bracket(hw - 0.33);
    bracket(hw - 0.12);
    bracket(DOOR_W / 2 + JAMB / 2);
    this.doorPaint = new THREE.Mesh(paint.build(), this.doorMat);
    this.doorIron = new THREE.Mesh(iron.build(), this.doorIronMat);
    this.doorPaint.renderOrder = 10;
    this.doorIron.renderOrder = 11;
    g.add(this.doorPaint, this.doorIron);

    // 閂（太い棒＋握り）。閉じると枠の受け金具まで差し込まれる
    const latch = new MeshBuilder();
    latch.addCylinder(mat(0, 0, 0, 0, 0, Math.PI / 2), 0.022, 0.62, 12, {});
    latch.addCylinder(mat(-0.12, 0, 0.05, Math.PI / 2), 0.012, 0.1, 8, {});
    latch.addCylinder(mat(-0.12, 0, 0.1, Math.PI / 2), 0.02, 0.05, 10, {});
    const latchMesh = new THREE.Mesh(latch.build(), this.doorIronMat);
    latchMesh.renderOrder = 12;
    this.latchClosedX = hw - 0.12 + 0.06;
    this.latchOpenX = this.latchClosedX - 0.24;
    latchMesh.position.set(this.latchOpenX, latchY, lz);
    g.add(latchMesh);
    this.latchMesh = latchMesh;
    this.latchT = 0;

    // 南京錠（枠の受け金具にぶら下がる）
    const lock = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.075, 0.028), this.doorIronMat);
    body.position.y = -0.085;
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 14, Math.PI), this.doorIronMat);
    shackle.position.y = -0.048;
    lock.add(body, shackle);
    lock.position.set(DOOR_W / 2 + JAMB / 2, latchY - 0.03, lz + 0.045);
    lock.rotation.x = 0.12;
    lock.traverse((o) => { o.renderOrder = 12; });
    lock.visible = false;
    g.add(lock);
    this.padlock = lock;
  }

  _buildCamera(content, frames, cfg, H, doorX) {
    const f = frames[cfg.door.wall];
    const M = mat(f.c.x, 0, f.c.z, 0, f.ry, 0);
    const side = doorX > 0 ? -1 : 1;
    const x = side * (f.len / 2 - 0.3);
    const mount = new THREE.Group();
    mount.applyMatrix4(new THREE.Matrix4().multiplyMatrices(M, mat(x, H, 0.3)));
    mount.scale.setScalar(1.6); // 部屋の隅でもちゃんと目に入る大きさに
    mount.updateMatrix();
    content.add(mount);
    // 天井から下がる支柱
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), this.housingMat);
    pole.position.y = -0.07;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 14), this.housingMat);
    base.position.y = -0.006;
    mount.add(pole, base);
    const yaw = new THREE.Group();
    yaw.position.y = -0.15;
    mount.add(yaw);
    const pitch = new THREE.Group();
    yaw.add(pitch);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.2), this.housingMat);
    body.position.z = 0.04;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.008, 0.24), this.housingMat);
    hood.position.set(0, 0.044, 0.06);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16), this.lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.142;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), this.ledMat);
    led.position.set(0.03, -0.022, 0.142);
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), this.housingMat);
    pitch.add(body, hood, lens, led, joint);
    this.camYaw = yaw;
    this.camPitch = pitch;
    // カメラの向きは、mount の座標で計算する（mount は壁の向きに回っている）
    this.camMount = mount;
    // 最初は部屋の中央を見下ろしている
    this.cam.yaw = this.cam.tYaw = 0;
    this.cam.pitch = this.cam.tPitch = 0.45;
    this.cam.hold = 0;
  }

  _buildLamp(content, H, enabled) {
    const g = new THREE.Group();
    g.position.set(0, H, 0);
    content.add(g);
    this.lampGroup = g;
    g.visible = !!enabled;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 18), this.ironMat);
    base.position.y = -0.015;
    g.add(base);
    // かご（輪2つと縦の針金）
    for (const [y, r] of [[-0.06, 0.06], [-0.2, 0.05]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 5, 20), this.ironMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.15, 4), this.ironMat);
      w.position.set(Math.cos(a) * 0.056, -0.13, Math.sin(a) * 0.056);
      w.rotation.z = Math.cos(a) * 0.07;
      w.rotation.x = -Math.sin(a) * 0.07;
      g.add(w);
    }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 10), this.bulbMat);
    bulb.position.y = -0.12;
    g.add(bulb);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55,
    }));
    glow.scale.setScalar(0.45);
    glow.position.y = -0.12;
    glow.renderOrder = 50;
    g.add(glow);
    this.lampBulb = bulb;
    this.lampGlow = glow;
    // 監視灯の明かりは鉄格子にだけ当たる（現実の部屋は照らせない）
    const light = new THREE.PointLight(0xffd9a8, 1.6, 7, 1.6);
    light.position.y = -0.16;
    g.add(light);
    this.lampLight = light;
    this._applyLamp();
  }

  _setupShadow(f, doorX, doorH, H, strength) {
    const { u, n } = frameAxes(f);
    const U = this.shadowMat.uniforms;
    U.uC.value.copy(f.c);
    U.uU.value.copy(u);
    U.uN.value.copy(n);
    // 廊下の明かり：扉の壁の外 2.4m、高さ 3.2m、扉寄り
    U.uLight.value.copy(f.c).addScaledVector(n, -2.4).addScaledVector(u, doorX * 0.6);
    U.uLight.value.y = Math.max(3.2, H + 0.6);
    U.uLen.value = f.len;
    U.uH.value = H;
    U.uBarStart.value = this.barGrid.start;
    U.uBarStep.value = this.barGrid.step;
    U.uStrength.value = strength;
    U.uDoor.value.set(doorX - DOOR_W / 2, doorX + DOOR_W / 2, doorH, JAMB);
    U.uWin.value.set(doorX - WIN.x, doorX + WIN.x, WIN.y0, WIN.y1);
    U.uBands.value.set(this.bands[0], this.bands[1], this.bands[2]);
  }

  // ---------- 外から使う ----------

  // 独房の座標 → ワールド座標
  toWorld(v, out = new THREE.Vector3()) {
    this.root.updateMatrixWorld();
    return out.copy(v).applyMatrix4(this.root.matrixWorld);
  }

  // 扉の壁の外側の廊下の点（s：扉の壁に沿った距離、out：外への距離）
  corridorLocal(s, out = 1.8, y = 1.5) {
    const f = this.frames[this.cfg.door.wall];
    const { u, n } = frameAxes(f);
    return f.c.clone().addScaledVector(u, s).addScaledVector(n, -out).setY(y);
  }

  get doorLocal() {
    return this.doorCenterLocal.clone();
  }

  // 0（見えない）〜 1（完全に出現）
  setReveal(a) {
    this.reveal = a;
    const solid = a >= 0.999;
    if (this.ironMat.transparent === solid) {
      this.ironMat.transparent = !solid;
      this.ironMat.needsUpdate = true;
      this.housingMat.transparent = !solid;
      this.housingMat.needsUpdate = true;
      this.plateMat.transparent = !solid;
      this.plateMat.needsUpdate = true;
    }
    this.ironMat.opacity = a;
    this.housingMat.opacity = a;
    this.plateMat.opacity = a;
    this.lensMat.transparent = !solid;
    this.lensMat.opacity = a;
    this.shadowMat.uniforms.uOpacity.value = a;
    this._applyDoorOpacity();
    this._applyLamp();
  }

  setGuide(on) {
    if (this.guide) this.guide.visible = on;
  }

  _applyDoorOpacity() {
    const base = this.cfg ? this.cfg.doorOpacity : 0.88;
    const o = this.reveal * base * this.doorFade;
    this.doorMat.opacity = o;
    this.doorIronMat.opacity = o;
  }

  setLamp(on) {
    this.lamp.on = on;
  }

  _applyLamp() {
    if (!this.lampBulb) return;
    const l = this.lamp.level * this.reveal;
    this.lampBulb.material.color.setRGB(0.2 + 0.8 * l, 0.18 + 0.77 * l, 0.15 + 0.69 * l);
    this.lampGlow.material.opacity = 0.55 * l;
    this.lampLight.intensity = 1.6 * l;
  }

  // 閂の位置 0（開）〜 1（閉）
  setLatch(t) {
    this.latchT = t;
    this.latchMesh.position.x = THREE.MathUtils.lerp(this.latchOpenX, this.latchClosedX, t);
    this.padlock.visible = t >= 1;
  }

  // head：頭のワールド座標
  update(dt, head, time) {
    if (!this.content) return;
    this.root.updateMatrixWorld();
    const local = this.root.worldToLocal(head.clone());

    // 扉に近づくと透ける（現実のドアや出入口が見えるように）
    const dd = Math.hypot(local.x - this.doorCenterLocal.x, local.z - this.doorCenterLocal.z);
    const target = THREE.MathUtils.lerp(0.32, 1, smooth(0.55, 1.5, dd));
    this.doorFade += (target - this.doorFade) * Math.min(1, dt * 4);
    this._applyDoorOpacity();

    // 監視灯：ゆっくり点く／消える。ごくまれに一瞬だけ暗くなる（点滅はさせない）
    const want = this.lamp.on ? 1 : 0;
    const rate = this.lamp.on ? 1.2 : 2.5;
    this.lamp.level += THREE.MathUtils.clamp(want - this.lamp.level, -rate * dt, rate * dt);
    if (this.lamp.on && this.lamp.level > 0.95 && Math.random() < dt / 90) this.lamp.flicker = 0.25;
    if (this.lamp.flicker > 0) {
      this.lamp.flicker -= dt;
      this.lamp.level = Math.min(this.lamp.level, 0.82);
    }
    this._applyLamp();

    this._updateCamera(dt, head, time);
  }

  _updateCamera(dt, head, time) {
    const c = this.cam;
    // 監視カメラは、頭の方へ「ときどき」向き直る（一定以上ずれたら、または数秒ごと）
    this.camMount.updateMatrixWorld();
    const p = this.camYaw.parent.worldToLocal(head.clone()).sub(this.camYaw.position);
    const ty = Math.atan2(p.x, p.z);
    const tp = -Math.atan2(p.y, Math.hypot(p.x, p.z));
    c.hold -= dt;
    const err = Math.abs(angDiff(ty, c.tYaw)) + Math.abs(tp - c.tPitch);
    if (err > 0.2 || (c.hold <= 0 && err > 0.04)) {
      if (!c.moving && this.onCameraMove && this.reveal >= 1) this.onCameraMove(Math.min(1.2, err));
      c.tYaw = ty;
      c.tPitch = THREE.MathUtils.clamp(tp, -0.2, 1.3);
      c.hold = 3 + Math.random() * 3;
    }
    const sp = THREE.MathUtils.degToRad(26) * dt; // 首振りの速さの上限
    const dy = angDiff(c.tYaw, c.yaw), dp = c.tPitch - c.pitch;
    c.moving = Math.abs(dy) > 0.004 || Math.abs(dp) > 0.004;
    c.yaw += THREE.MathUtils.clamp(dy, -sp, sp);
    c.pitch += THREE.MathUtils.clamp(dp, -sp, sp);
    this.camYaw.rotation.y = c.yaw;
    this.camPitch.rotation.x = c.pitch;
    // 録画中ランプ：2秒ごとに短く点く
    const on = time % 2 < 0.18;
    this.ledMat.color.setHex(on && this.reveal > 0.5 ? 0xff2a1a : 0x2a0505);
  }

  get cameraLocal() {
    return new THREE.Vector3(0, -0.15, 0).applyMatrix4(this.camMount.matrix); // 大きさ込み
  }
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
