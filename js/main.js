// 起動・設定・配置・体験・終了。
//  - XRモード：Quest Browser の immersive-ar（パススルー）。現実の部屋に牢屋を重ねる。
//  - プレビューモード：PCブラウザ。仮の部屋を表示し、マウスで見回す（WASD で歩ける）。
// 配置（3ページのパネル）と体験の中身は両モード共通。
import * as THREE from '../vendor/three.module.min.js';
import { Cell, wallFrames } from './cell.js';
import { PrisonAudio } from './audio.js';
import { GuardVoice } from './voice.js';
import { Director } from './director.js';
import { Panel, EndButton, makeRay, placeInFront } from './ui3d.js';
import { pageStart, pageSize, pageDoor, applySizeButton, applyDoorButton, fitFromPlanes, readXRPlanes } from './placement.js';
import { loadSettings, saveSettings, clampSettings, ROOM_PRESETS, DENSITY, INTENSITY } from './settings.js';

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const startBtn = $('btn-start');
const previewBtn = $('btn-preview');
const backBtn = $('btn-back');
const statusEl = $('xr-status');
const hintEl = $('hint');

// 確認用の URL パラメータ
//  ?skip=1       プレビューで配置を飛ばしてすぐ収監
//  ?fakeplanes=1 プレビューで「空間設定を読めた」場合を試す（仮の部屋の壁を平面として渡す）
const params = new URLSearchParams(location.search);
const SKIP = params.get('skip') === '1';
const FAKE_PLANES = params.get('fakeplanes') === '1';

// ---------- 設定フォーム ----------
let settings = loadSettings();
const form = {
  preset: $('preset'), width: $('width'), depth: $('depth'), height: $('height'),
  volume: $('volume'), volumeOut: $('volume-out'), voice: $('voice'), voiceStatus: $('voice-status'),
  planes: $('planes'), occlusion: $('occlusion'),
};
function writeForm(s) {
  form.preset.value = ROOM_PRESETS[s.preset] ? s.preset : 'custom';
  form.width.value = s.width.toFixed(2);
  form.depth.value = s.depth.toFixed(2);
  form.height.value = s.height.toFixed(2);
  document.querySelector(`input[name="density"][value="${s.density}"]`).checked = true;
  document.querySelector(`input[name="intensity"][value="${s.intensity}"]`).checked = true;
  form.volume.value = Math.round(s.volume * 100);
  form.volumeOut.value = form.volume.value;
  form.voice.checked = s.voice;
  form.planes.checked = s.planes;
  form.occlusion.checked = s.occlusion;
}
function readForm() {
  const s = {
    ...settings,
    preset: form.preset.value,
    width: parseFloat(form.width.value),
    depth: parseFloat(form.depth.value),
    height: parseFloat(form.height.value),
    density: document.querySelector('input[name="density"]:checked')?.value,
    intensity: document.querySelector('input[name="intensity"]:checked')?.value,
    volume: form.volume.value / 100,
    voice: form.voice.checked,
    planes: form.planes.checked,
    occlusion: form.occlusion.checked,
  };
  return clampSettings(s);
}
writeForm(settings);
form.preset.addEventListener('change', () => {
  const p = ROOM_PRESETS[form.preset.value];
  if (!p) return;
  form.width.value = p.width.toFixed(2);
  form.depth.value = p.depth.toFixed(2);
});
for (const el of [form.width, form.depth]) el.addEventListener('input', () => { form.preset.value = 'custom'; });
form.volume.addEventListener('input', () => {
  form.volumeOut.value = form.volume.value;
  audio.setVolume(form.volume.value / 100);
  voice.volume = form.volume.value / 100;
});
$('settings').addEventListener('submit', (e) => e.preventDefault());

// ---------- レンダラーとシーン ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 60);
scene.add(camera);

// 金属の映り込み用の、ぼんやりした部屋の明るさ（上が明るく下が暗い＋天井の蛍光灯）
{
  const env = new THREE.Scene();
  const g = new THREE.SphereGeometry(10, 32, 16);
  const col = [];
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    const v = y > 0 ? 0.55 + y * 0.45 : 0.55 + y * 0.4;
    col.push(v, v * 0.97, v * 0.92);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const tube = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.9, 3.6) }));
  tube.position.set(0, 8, 0);
  env.add(tube);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.03).texture;
  pm.dispose();
}
scene.add(new THREE.HemisphereLight(0xf4efe6, 0x3b3631, 1.1));

const cell = new Cell();
cell.root.visible = false;
scene.add(cell.root);
// 廊下側からの明かり（鉄格子の陰影用。独房についていく）
const corridorLight = new THREE.DirectionalLight(0xfff0dc, 1.3);
const corridorTarget = new THREE.Object3D();
cell.root.add(corridorLight, corridorTarget);
corridorLight.target = corridorTarget;

const audio = new PrisonAudio();
const voice = new GuardVoice();
const director = new Director(cell, audio, voice);
cell.onCameraMove = (amount) => audio.servo(cell.toWorld(cell.cameraLocal), 0.5 + amount * 1.2);

const panel = new Panel();
const endButton = new EndButton();
scene.add(panel.mesh, endButton.mesh);

voice.status().then((st) => {
  form.voiceStatus.textContent = {
    ok: `日本語の音声で話します（${voice.voice.name}）。声は立体音響になりません。`,
    'no-api': 'このブラウザは音声合成に対応していないため、看守は黙っています。',
    'no-ja': 'この端末には日本語の音声がないため、看守は黙っています。',
  }[st];
});

// ---------- 状態 ----------
const state = {
  mode: 'title',     // 'title' | 'place' | 'jail'
  xr: false,
  page: null,        // 'start' | 'size' | 'door'
  ready: false,      // XR で頭の位置が取れたか
  floorKnown: true,
  place: { x: 0, z: 0, yaw: 0, floorY: 0 },
  door: { wall: 'front', offset: 0 },
  number: 1000,
  fitted: false,
  fittedDoor: false,
  planes: [],
};
const inset = () => (settings.occlusion ? 0.12 : 0.06);

function cellConfig() {
  const I = INTENSITY[settings.intensity];
  return {
    width: settings.width,
    depth: settings.depth,
    height: settings.height,
    spacing: DENSITY[settings.density].spacing,
    door: state.door,
    number: state.number,
    shadow: I.shadow,
    doorOpacity: I.doorOpacity,
    lamp: I.lamp,
    inset: inset(),
  };
}

function rebuild() {
  cell.build(cellConfig());
  const L = cell.corridorLocal(cell.doorInfo.x, 2.5, 3.6);
  corridorLight.position.copy(L);
  corridorTarget.position.set(0, 0, 0);
  applyPlace();
}

function applyPlace() {
  const p = state.place;
  cell.root.position.set(p.x, p.floorY, p.z);
  cell.root.rotation.set(0, p.yaw, 0);
  cell.root.updateMatrixWorld(true);
}

function maxOffFor(wall) {
  const f = wallFrames(settings.width, settings.depth, inset())[wall];
  return Math.max(0, f.len / 2 - 0.43 - 0.1 - 0.08);
}

// ---------- 配置パネル ----------
function refreshPage() {
  if (state.page === 'start') panel.setPage(pageStart());
  else if (state.page === 'size') panel.setPage(pageSize(settings, { fitted: state.fitted, floorKnown: state.floorKnown }));
  else if (state.page === 'door') panel.setPage(pageDoor(state.door, state.fittedDoor));
}

function showPage(name) {
  state.page = name;
  refreshPage();
  placeInFront(panel.mesh, camera, 0.62, 0.2);
  panel.mesh.visible = true;
}

function headYaw() {
  camera.updateMatrixWorld();
  const f = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
  return Math.atan2(-f.x, -f.z);
}
function headPos() {
  return new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
}

function onPanelButton(id) {
  switch (id) {
    case 'quit':
      quit();
      return;
    case 'confirm-front':
      captureFront();
      return;
    case 'back-start':
      showPage('start');
      return;
    case 'next-door':
      showPage('door');
      return;
    case 'back-size':
      showPage('size');
      return;
    case 'go':
      beginJail();
      return;
    default:
      break;
  }
  if (id.startsWith('door')) {
    applyDoorButton(id, state.door, maxOffFor);
    state.fittedDoor = false;
    rebuild();
  } else if (applySizeButton(id, settings, state.place)) {
    settings.preset = 'custom';
    rebuild();
  } else {
    applyPlace();
  }
  refreshPage();
}

// 「この向きで決定」：今の立ち位置と向きを独房の中心と正面にする。空間設定が読めれば合わせる
function captureFront() {
  const h = headPos();
  const yaw = headYaw();
  state.place.x = h.x;
  state.place.z = h.z;
  state.place.yaw = yaw;
  state.fitted = false;
  state.fittedDoor = false;
  const planes = state.xr ? state.planes : (FAKE_PLANES ? previewPlanes() : []);
  if (settings.planes && planes.length) {
    const fit = fitFromPlanes(planes, h, yaw, state.place.floorY);
    if (fit) {
      Object.assign(state.place, fit.place);
      if (fit.width) settings.width = clampSettings({ ...settings, width: fit.width }).width;
      if (fit.depth) settings.depth = clampSettings({ ...settings, depth: fit.depth }).depth;
      if (fit.height) settings.height = clampSettings({ ...settings, height: fit.height }).height;
      if (fit.width || fit.depth) settings.preset = 'custom';
      state.fitted = fit.found >= 2;
      if (fit.door) {
        state.door.wall = fit.door.wall;
        state.door.offset = fit.door.offset;
        state.fittedDoor = true;
      }
    }
  }
  if (!state.fittedDoor) {
    state.door.wall = 'front';
    state.door.offset = 0;
  }
  rebuild();
  showPage('size');
}

// 「収監される」
function beginJail() {
  state.mode = 'jail';
  state.page = null;
  panel.mesh.visible = false;
  cell.setGuide(false);
  saveSettings(settings);
  audio.setVolume(settings.volume);
  audio.start(cell.toWorld(cell.ventLocal));
  voice.enabled = settings.voice;
  voice.volume = settings.volume;
  director.begin(INTENSITY[settings.intensity], state.number);
  for (const c of controllers) c.userData.ray.visible = false;
}

// 配置・体験の開始（XR／プレビュー共通の初期化）
function enterPlacement() {
  state.mode = 'place';
  state.number = 1000 + Math.floor(Math.random() * 9000);
  state.door = { wall: 'front', offset: 0 };
  director.end();
  cell.reveal = 0.45;
  cell.setLamp(true);
  rebuild(); // 閂は作り直すと開いた状態になる
  cell.setGuide(true);
  cell.setReveal(0.45);
  cell.root.visible = true;
  endButton.hide();
}

// ---------- タイトル画面：XR 対応状況の確認 ----------
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function checkXR() {
  if (!window.isSecureContext) {
    setStatus('WebXR は HTTPS（または localhost）でのみ動きます。https:// のURLで開いてください。PCではプレビューで見られます。', true);
    return;
  }
  if (!('xr' in navigator)) {
    setStatus('このブラウザは WebXR に対応していません。Meta Quest 3 のブラウザで開いてください。PCではプレビューで見られます。', true);
    return;
  }
  let ok = false;
  try {
    ok = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {
    console.warn(e);
  }
  if (ok) {
    startBtn.disabled = false;
    setStatus('パススルーMRで体験できます。');
  } else {
    setStatus('この環境はパススルーMR（immersive-ar）に対応していません。Meta Quest 3 のブラウザで開いてください。PCではプレビューで見られます。', true);
  }
}
checkXR();

// ---------- XR（Quest 3） ----------
const controllers = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  c.userData.connected = false;
  c.userData.hover = null;
  const ray = makeRay();
  c.add(ray);
  c.userData.ray = ray;
  c.addEventListener('connected', (e) => {
    c.userData.connected = true;
    c.userData.source = e.data;
  });
  c.addEventListener('disconnected', () => {
    c.userData.connected = false;
    c.userData.source = null;
    ray.visible = false;
  });
  // トリガーを引き切ったとき／ピンチしたとき（押して離すと1回届く）
  c.addEventListener('select', () => {
    if (!state.xr) return;
    controllerRay(c);
    onSelect(raycaster);
  });
  scene.add(c);
  controllers.push(c);
}

async function requestAR() {
  const optionalFeatures = ['local-floor'];
  if (settings.planes) optionalFeatures.push('plane-detection');
  const init = { optionalFeatures };
  if (settings.occlusion) {
    // 深度センサーが使えれば、three.js が自動で「現実の物の奥にある CG」を隠す
    optionalFeatures.push('depth-sensing');
    init.depthSensing = { usagePreference: ['gpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] };
  }
  try {
    return await navigator.xr.requestSession('immersive-ar', init);
  } catch (e) {
    if (!settings.occlusion) throw e;
    // 深度センサーの指定で断られたら、それ抜きでもう一度
    console.warn('depth-sensing なしで再試行', e);
    return navigator.xr.requestSession('immersive-ar', { optionalFeatures: optionalFeatures.filter((f) => f !== 'depth-sensing') });
  }
}

async function startXR() {
  settings = readForm();
  saveSettings(settings);
  audio.init(); // ボタン操作の中で音を有効化しておく
  audio.setVolume(settings.volume);
  startBtn.disabled = true;
  setStatus('起動中…');
  let session;
  try {
    session = await requestAR();
  } catch (e) {
    console.error(e);
    setStatus(`パススルーMRを開始できませんでした（${e.name || 'Error'}: ${e.message || e}）。許可ダイアログで拒否した場合は、ページを再読み込みしてもう一度お試しください。`, true);
    startBtn.disabled = false;
    return;
  }
  let refType = 'local-floor';
  try {
    await session.requestReferenceSpace('local-floor');
  } catch (e) {
    refType = 'local';
  }
  state.floorKnown = refType === 'local-floor';
  renderer.xr.setReferenceSpaceType(refType);
  try {
    await renderer.xr.setSession(session);
  } catch (e) {
    console.error(e);
    setStatus(`XRの初期化に失敗しました（${e.message || e}）。`, true);
    startBtn.disabled = false;
    session.end().catch(() => {});
    return;
  }
  session.addEventListener('end', onXREnd);
  state.xr = true;
  state.ready = false;
  state.planes = [];
  titleEl.hidden = true;
  backBtn.hidden = true;
  hintEl.hidden = true;
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  room.visible = false;
  enterPlacement();
  cell.root.visible = false; // 頭の位置が分かるまで出さない
}

// XR の最初のフレーム：頭の位置から床の高さを決め、パネルを出す
function initXRFrame(frame) {
  const ref = renderer.xr.getReferenceSpace();
  const pose = frame && ref && frame.getViewerPose(ref);
  if (!pose) return false;
  camera.matrixWorld.fromArray(pose.transform.matrix);
  camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
  const y = pose.transform.position.y;
  state.place.floorY = state.floorKnown ? 0 : y - 1.6; // 床が分からなければ立った人の目の高さと仮定
  followHead(1);
  cell.root.visible = true;
  if (SKIP) beginJail();
  else showPage('start');
  return true;
}

function endXR() {
  const s = renderer.xr.getSession();
  if (s) s.end().catch(() => {});
}

function onXREnd() {
  state.xr = false;
  backToTitle();
}

function quit() {
  if (state.xr) endXR();
  else backToTitle();
}

// ---------- 光線と選択 ----------
const raycaster = new THREE.Raycaster();
const _rot = new THREE.Matrix4();
function controllerRay(c) {
  c.updateMatrixWorld(true);
  _rot.identity().extractRotation(c.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_rot);
}

function onSelect(rc) {
  if (state.mode === 'place' && state.page) {
    const h = panel.hitTest(rc);
    if (h.id) onPanelButton(h.id);
    else if (!h.hit) placeInFront(panel.mesh, camera, 0.62, 0.2); // 何もない所を指したら、パネルを手元に呼ぶ
    return;
  }
  if (state.mode === 'jail') {
    if (endButton.mesh.visible && rc.intersectObject(endButton.mesh, false).length) quit();
    else endButton.summon(camera);
  }
}

function updatePointers() {
  let endHover = false;
  let panelHover = null;
  for (const c of controllers) {
    const ray = c.userData.ray;
    if (!c.userData.connected) {
      ray.visible = false;
      continue;
    }
    controllerRay(c);
    let dist = -1;
    if (state.mode === 'place' && state.page) {
      const h = panel.hitTest(raycaster);
      if (h.hit) dist = h.distance;
      if (h.id) panelHover = h.id;
      ray.visible = true;
    } else if (state.mode === 'jail' && endButton.mesh.visible) {
      const h = raycaster.intersectObject(endButton.mesh, false)[0];
      if (h) {
        dist = h.distance;
        endHover = true;
      }
      ray.visible = true;
    } else {
      ray.visible = false;
    }
    ray.scale.z = dist > 0 ? dist : 1.2;
    ray.userData.dot.visible = dist > 0;
  }
  if (state.mode === 'place') panel.setHover(panelHover);
  endButton.setHover(endHover);
}

// スティック操作（配置の2ページ目）：左＝独房を動かす、右の左右＝回す
function updateSticks(dt) {
  if (state.page !== 'size') return;
  const s = renderer.xr.getSession();
  if (!s) return;
  for (const src of s.inputSources) {
    const gp = src.gamepad;
    if (!gp || gp.axes.length < 4) continue;
    const ax = Math.abs(gp.axes[2]) > 0.25 ? gp.axes[2] : 0;
    const ay = Math.abs(gp.axes[3]) > 0.25 ? gp.axes[3] : 0;
    if (!ax && !ay) continue;
    if (src.handedness === 'left') {
      const yaw = headYaw();
      const f = [-Math.sin(yaw), -Math.cos(yaw)], r = [Math.cos(yaw), -Math.sin(yaw)];
      const v = 0.35 * dt;
      state.place.x += (r[0] * ax - f[0] * ay) * v;
      state.place.z += (r[1] * ax - f[1] * ay) * v;
    } else if (src.handedness === 'right' && ax) {
      state.place.yaw -= ax * THREE.MathUtils.degToRad(20) * dt;
    }
    applyPlace();
  }
}

// 配置1ページ目：独房は頭について回る（どの向きが正面になるか分かるように）
function followHead(k) {
  const h = headPos();
  const yaw = headYaw();
  const p = state.place;
  p.x += (h.x - p.x) * k;
  p.z += (h.z - p.z) * k;
  let d = yaw - p.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  p.yaw += d * k;
  applyPlace();
}

// ---------- PCプレビュー用の仮の部屋 ----------
// パススルーの代わり。XR と同じ見え方になるよう、深度を書かず一番最初に描く（CG はいつも部屋の手前）
const ROOM = { W: 3.64, D: 2.73, H: 2.4, doorX: 0.95 };
const room = new THREE.Group();
{
  const { W, D, H } = ROOM;
  const basic = (c) => new THREE.MeshBasicMaterial({ color: c, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, order = -1000) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, 0);
    o.renderOrder = order;
    room.add(o);
    return o;
  };
  add(new THREE.PlaneGeometry(W, D), basic(0xb08d68), 0, 0, 0, -Math.PI / 2);          // フローリング
  add(new THREE.PlaneGeometry(W, D), basic(0xeeece6), 0, H, 0, Math.PI / 2);           // 天井
  add(new THREE.PlaneGeometry(W, H), basic(0xe4e0d6), 0, H / 2, -D / 2);               // 正面（ドアの壁）
  add(new THREE.PlaneGeometry(W, H), basic(0xdcd7cc), 0, H / 2, D / 2, 0, Math.PI);
  add(new THREE.PlaneGeometry(D, H), basic(0xd6d1c5), -W / 2, H / 2, 0, 0, Math.PI / 2);
  add(new THREE.PlaneGeometry(D, H), basic(0xdfdacf), W / 2, H / 2, 0, 0, -Math.PI / 2);
  // 現実のドア（木目）とノブ、後ろの壁の窓とカーテン、天井の照明
  add(new THREE.PlaneGeometry(0.8, 2.0), basic(0x9a7652), ROOM.doorX, 1.0, -D / 2 + 0.005, 0, 0, -999);
  add(new THREE.CircleGeometry(0.03, 12), basic(0xd8d0c0), ROOM.doorX + 0.3, 0.95, -D / 2 + 0.01, 0, 0, -998);
  add(new THREE.PlaneGeometry(1.5, 1.1), basic(0xbcd8ea), -0.4, 1.45, D / 2 - 0.005, 0, Math.PI, -999);
  add(new THREE.PlaneGeometry(0.35, 1.3), basic(0xd9c9a8), 0.5, 1.4, D / 2 - 0.01, 0, Math.PI, -998);
  add(new THREE.PlaneGeometry(0.35, 1.3), basic(0xd9c9a8), -1.3, 1.4, D / 2 - 0.01, 0, Math.PI, -998);
  add(new THREE.CircleGeometry(0.25, 24), basic(0xfaf8f2), 0.3, H - 0.005, 0.2, Math.PI / 2, 0, -999);
  add(new THREE.PlaneGeometry(1.6, 1.1), basic(0x8f9aa3), 0, 0.003, 0.15, -Math.PI / 2, 0, -999); // ラグ
  // 家具（深度を書かない Lambert。裏面は描かない）
  const box = (w, h, d, color, x, z, y = h / 2) => {
    const m = new THREE.MeshLambertMaterial({ color, depthWrite: false, fog: false });
    return add(new THREE.BoxGeometry(w, h, d), m, x, y, z, 0, 0, -990);
  };
  box(0.98, 0.42, 1.98, 0x7d8a96, -W / 2 + 0.52, D / 2 - 1.03);   // ベッド
  box(0.98, 0.12, 1.9, 0xf0ece4, -W / 2 + 0.52, D / 2 - 1.03, 0.47); // 布団
  box(0.55, 0.14, 0.35, 0xffffff, -W / 2 + 0.52, D / 2 - 1.8, 0.58); // 枕
  box(1.1, 0.04, 0.6, 0xc49a6c, W / 2 - 0.32, 0.2, 0.72);           // 机
  box(0.04, 0.7, 0.55, 0x9c7a54, W / 2 - 0.32 - 0.52, 0.2, 0.35);
  box(0.04, 0.7, 0.55, 0x9c7a54, W / 2 - 0.32 + 0.52, 0.2, 0.35);
  box(0.55, 0.34, 0.03, 0x1d1f22, W / 2 - 0.2, 0.25, 0.95).rotation.y = -Math.PI / 2; // モニター
  box(0.45, 0.45, 0.45, 0x3f4a55, W / 2 - 0.85, 0.3, 0.23);          // 椅子
  box(0.8, 1.8, 0.3, 0xe6dfd0, W / 2 - 0.5, D / 2 - 0.16);           // 本棚
  box(0.32, 0.32, 0.32, 0x7a5638, -W / 2 + 0.35, -D / 2 + 0.3);     // 観葉植物の鉢
  box(0.5, 0.6, 0.5, 0x4f7d48, -W / 2 + 0.35, -D / 2 + 0.3, 0.62);
  const grid = new THREE.GridHelper(W, 20, 0x9c7b58, 0x9c7b58);
  grid.material.depthWrite = false;
  grid.renderOrder = -999;
  grid.position.y = 0.002;
  room.add(grid);
}
room.visible = false;
scene.add(room);

// 仮の部屋の壁を「平面検出の結果」として渡す（?fakeplanes=1 の確認用）
function previewPlanes() {
  const { W, D, H } = ROOM;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  return [
    { vertical: true, label: 'wall', center: v(0, 1.2, -D / 2), normal: v(0, 0, 1), width: W },
    { vertical: true, label: 'wall', center: v(0, 1.2, D / 2), normal: v(0, 0, -1), width: W },
    { vertical: true, label: 'wall', center: v(-W / 2, 1.2, 0), normal: v(1, 0, 0), width: D },
    { vertical: true, label: 'wall', center: v(W / 2, 1.2, 0), normal: v(-1, 0, 0), width: D },
    { vertical: false, label: 'ceiling', center: v(0, H, 0), normal: v(0, -1, 0), width: W },
    { vertical: true, label: 'door frame', center: v(ROOM.doorX, 1.0, -D / 2), normal: v(0, 0, 1), width: 0.8 },
  ];
}

// ---------- PCプレビュー ----------
const look = { yaw: 0, pitch: -0.1, down: false, x: 0, y: 0, moved: 0, id: null };
const walker = { x: 0, z: 0.1, keys: new Set() };
const PREVIEW_EYE = 1.6;
let hintTimer = 0;

function applyLook() {
  camera.position.set(walker.x, PREVIEW_EYE, walker.z);
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
}

function startPreview() {
  settings = readForm();
  saveSettings(settings);
  audio.init();
  audio.setVolume(settings.volume);
  state.xr = false;
  state.floorKnown = true;
  state.place.floorY = 0;
  titleEl.hidden = true;
  backBtn.hidden = false;
  hintEl.hidden = false;
  hintEl.classList.remove('fade');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.add('fade'), 6000);
  document.body.classList.add('preview');
  scene.background = new THREE.Color(0x202020);
  renderer.setClearColor(0x202020, 1);
  room.visible = true;
  look.yaw = 0;
  look.pitch = -0.1;
  walker.x = 0;
  walker.z = 0.1;
  applyLook();
  enterPlacement();
  followHead(1);
  if (SKIP) {
    captureFront();
    beginJail();
  } else showPage('start');
}

function backToTitle() {
  state.mode = 'title';
  state.page = null;
  director.end();
  audio.stop();
  cell.root.visible = false;
  panel.mesh.visible = false;
  endButton.hide();
  room.visible = false;
  document.body.classList.remove('preview');
  backBtn.hidden = true;
  hintEl.hidden = true;
  titleEl.hidden = false;
  writeForm(settings);
  startBtn.disabled = true;
  checkXR();
}

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (state.xr || state.mode === 'title' || e.button !== 0) return;
  look.down = true;
  look.x = e.clientX;
  look.y = e.clientY;
  look.moved = 0;
  look.id = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!look.down || e.pointerId !== look.id) return;
  const dx = e.clientX - look.x, dy = e.clientY - look.y;
  look.x = e.clientX;
  look.y = e.clientY;
  look.moved += Math.abs(dx) + Math.abs(dy);
  const k = 0.0042;
  look.yaw += dx * k;
  look.pitch = THREE.MathUtils.clamp(look.pitch + dy * k, -1.45, 1.45);
  applyLook();
});
const endDrag = (e) => {
  if (!look.down) return;
  look.down = false;
  // ほとんど動かさずに離したらクリック：XR のトリガーと同じ扱い
  if (!state.xr && state.mode !== 'title' && look.moved < 6 && e.type === 'pointerup') {
    clickAt(e.clientX, e.clientY);
  }
};
function clickAt(x, y) {
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  onSelect(raycaster);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointermove', (e) => {
  // プレビューではマウスの下のボタンを明るくする
  if (state.xr || state.mode !== 'place' || look.down) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  panel.setHover(panel.hitTest(raycaster).id);
});
window.addEventListener('keydown', (e) => {
  if (state.xr || state.mode === 'title') return;
  walker.keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => walker.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => walker.keys.clear());

function updateWalker(dt) {
  const k = walker.keys;
  const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
  const side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
  if (!fwd && !side) return;
  const v = 1.1 * dt;
  walker.x += (-Math.sin(look.yaw) * fwd + Math.cos(look.yaw) * side) * v;
  walker.z += (-Math.cos(look.yaw) * fwd - Math.sin(look.yaw) * side) * v;
  walker.x = THREE.MathUtils.clamp(walker.x, -ROOM.W / 2 + 0.2, ROOM.W / 2 - 0.2);
  walker.z = THREE.MathUtils.clamp(walker.z, -ROOM.D / 2 + 0.2, ROOM.D / 2 - 0.2);
  applyLook();
}

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startBtn.addEventListener('click', startXR);
previewBtn.addEventListener('click', startPreview);
backBtn.addEventListener('click', quit);

// ---------- メインループ（XR でも PC でも同じ setAnimationLoop） ----------
const clock = new THREE.Clock();
let planeTick = 0;

function frameStep(dt, time, frame) {
  if (state.mode === 'title') return;
  if (state.xr) {
    if (!state.ready) {
      state.ready = initXRFrame(frame);
      if (!state.ready) return;
    }
    // 平面検出の結果は、配置中にときどき読む
    if (settings.planes && state.mode === 'place' && frame && ++planeTick % 20 === 0) {
      state.planes = readXRPlanes(frame, renderer.xr.getReferenceSpace());
    }
    updatePointers();
    updateSticks(dt);
  } else {
    updateWalker(dt);
  }
  if (state.mode === 'place' && state.page === 'start') followHead(Math.min(1, dt * 3));
  if (state.mode === 'jail') director.update(dt);
  camera.updateMatrixWorld();
  const head = headPos();
  cell.update(dt, head, time);
  audio.setListener(camera.matrixWorld.elements);
  endButton.update(dt);
}

renderer.setAnimationLoop((t, frame) => {
  const dt = Math.min(clock.getDelta(), 0.05);
  frameStep(dt, t / 1000, frame);
  if (state.mode !== 'title') renderer.render(scene, camera);
});

// デバッグ・自動確認用
function lookAtPoint(x, y, z) {
  const d = new THREE.Vector3(x, y, z).sub(camera.position).normalize();
  look.yaw = Math.atan2(-d.x, -d.z);
  look.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  applyLook();
}
window.__rouya = {
  renderer, scene, camera, cell, director, audio, voice, panel, endButton, state, look, walker,
  get settings() { return settings; },
  applyLook, lookAtPoint, startPreview, backToTitle, onPanelButton, clickAt,
  frame: (dt = 1 / 60, t = performance.now() / 1000) => { frameStep(dt, t, null); renderer.render(scene, camera); },
};
