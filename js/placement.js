// 手動配置の手順（3ページ）と、Quest の空間設定（平面検出）から部屋の形を読む処理。
//  1. 正面を決める：部屋のまん中に立ち、ドアの方を向いて決定
//  2. 部屋の大きさ：幅・奥行・高さ・位置・向き（・床の高さ）を合わせる
//  3. 鉄扉の位置：現実のドアに重ねる → 「収監される」で体験開始
import * as THREE from '../vendor/three.module.min.js';
import { WALLS, WALL_LABEL } from './cell.js';
import { LIMITS } from './settings.js';

const fmt = (v) => `${v.toFixed(2)} m`;

export function pageStart() {
  return {
    title: '配置 1/3　正面を決める',
    lines: [
      '部屋のまん中あたりに立ち、',
      '部屋のドアがある方を向いてください。',
      'その向きが鉄扉のある「正面」になります。',
      '（その場で向きを変えるだけで大丈夫です）',
    ],
    rows: [],
    footer: [
      { id: 'quit', text: 'やめる', w: 200 },
      { id: 'confirm-front', text: 'この向きで決定', primary: true, w: 360 },
    ],
  };
}

export function pageSize(s, { fitted, floorKnown }) {
  const rows = [
    { label: '幅', value: fmt(s.width), buttons: [{ id: 'w-', text: '−' }, { id: 'w+', text: '+' }] },
    { label: '奥行', value: fmt(s.depth), buttons: [{ id: 'd-', text: '−' }, { id: 'd+', text: '+' }] },
    { label: '高さ', value: fmt(s.height), buttons: [{ id: 'h-', text: '−' }, { id: 'h+', text: '+' }] },
    {
      label: '位置',
      buttons: [
        { id: 'mx-', text: '←' }, { id: 'mx+', text: '→' },
        { id: 'mz-', text: '前へ', w: 120 }, { id: 'mz+', text: '手前', w: 120 },
      ],
    },
    { label: '向き', buttons: [{ id: 'r+', text: '⟲' }, { id: 'r-', text: '⟳' }] },
  ];
  if (!floorKnown) rows.push({ label: '床', buttons: [{ id: 'f+', text: '▲' }, { id: 'f-', text: '▼' }] });
  return {
    title: '配置 2/3　部屋の大きさ',
    lines: fitted
      ? ['空間設定から部屋の形を読み取りました。', 'ずれていたら直してください。']
      : ['黄色い線が、現実の床と壁の角に', '重なるように合わせてください。'],
    rows,
    footer: [
      { id: 'back-start', text: '戻る', w: 200 },
      { id: 'next-door', text: '次へ', primary: true, w: 260 },
    ],
  };
}

export function pageDoor(door, fittedDoor) {
  return {
    title: '配置 3/3　鉄扉の位置',
    lines: [
      fittedDoor ? '空間設定のドアの位置に置きました。' : '鉄扉を現実のドアの位置に合わせてください。',
      '鉄扉は開きません。現実のドアはふつうに使えます。',
    ],
    rows: [
      { label: '扉', buttons: [{ id: 'door-', text: '◀ 左へ', w: 180 }, { id: 'door+', text: '右へ ▶', w: 180 }] },
      { label: '壁', buttons: [{ id: 'door-wall', text: `${WALL_LABEL[door.wall]}の壁 → 次の壁`, w: 380 }] },
    ],
    footer: [
      { id: 'back-size', text: '戻る', w: 200 },
      { id: 'go', text: '収監される', primary: true, w: 320 },
    ],
  };
}

// パネルのボタンで寸法・位置を変える。place: { x, z, yaw, floorY }。戻り値：作り直しが必要か
export function applySizeButton(id, s, place) {
  const step = 0.05;
  const c = (v, [a, b]) => Math.min(b, Math.max(a, v));
  const cos = Math.cos(place.yaw), sin = Math.sin(place.yaw);
  // 独房の X 軸（右）と -Z 軸（前）のワールド方向
  const right = [cos, -sin], fwd = [-sin, -cos];
  switch (id) {
    case 'w-': s.width = c(s.width - step * 2, LIMITS.width); return true;
    case 'w+': s.width = c(s.width + step * 2, LIMITS.width); return true;
    case 'd-': s.depth = c(s.depth - step * 2, LIMITS.depth); return true;
    case 'd+': s.depth = c(s.depth + step * 2, LIMITS.depth); return true;
    case 'h-': s.height = c(s.height - step, LIMITS.height); return true;
    case 'h+': s.height = c(s.height + step, LIMITS.height); return true;
    case 'mx-': place.x -= right[0] * step; place.z -= right[1] * step; return false;
    case 'mx+': place.x += right[0] * step; place.z += right[1] * step; return false;
    case 'mz-': place.x += fwd[0] * step; place.z += fwd[1] * step; return false;
    case 'mz+': place.x -= fwd[0] * step; place.z -= fwd[1] * step; return false;
    case 'r+': place.yaw += THREE.MathUtils.degToRad(2); return false;
    case 'r-': place.yaw -= THREE.MathUtils.degToRad(2); return false;
    case 'f+': place.floorY += 0.02; return false;
    case 'f-': place.floorY -= 0.02; return false;
    default: return false;
  }
}

// 扉を壁に沿って動かす。角を越えたら隣の壁へ回り込む
export function applyDoorButton(id, door, maxOffFor) {
  if (id === 'door-wall') {
    door.wall = WALLS[(WALLS.indexOf(door.wall) + 1) % 4];
    door.offset = 0;
    return;
  }
  const d = id === 'door+' ? 0.1 : -0.1;
  const max = maxOffFor(door.wall);
  const next = door.offset + d;
  if (next > max + 0.05) {
    door.wall = WALLS[(WALLS.indexOf(door.wall) + 1) % 4];
    door.offset = -maxOffFor(door.wall);
  } else if (next < -max - 0.05) {
    door.wall = WALLS[(WALLS.indexOf(door.wall) + 3) % 4];
    door.offset = maxOffFor(door.wall);
  } else {
    door.offset = Math.min(max, Math.max(-max, next));
  }
}

// ---------- 平面検出から部屋の形を読む ----------
// planes: [{ vertical, label, center: Vector3, normal: Vector3, width }]（ワールド座標）
// head: 立っている位置（Vector3）、yaw：向いている方向、floorY：床の高さ
// 戻り値：{ place: { x, z, yaw }, width?, depth?, height?, door?: { wall, offset } } または null
export function fitFromPlanes(planes, head, yaw, floorY) {
  const walls = planes.filter((p) => p.vertical && (/wall/i.test(p.label) || (!p.label && p.width > 0.9)));
  if (walls.length < 1) return null;
  const P = new THREE.Vector3(head.x, 0, head.z);
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  // 各壁の「自分から壁へ向かう」水平方向と距離
  const info = walls.map((w) => {
    const a = new THREE.Vector3(w.normal.x, 0, w.normal.z);
    if (a.lengthSq() < 1e-4) return null;
    a.normalize();
    const c = new THREE.Vector3(w.center.x, 0, w.center.z);
    let dist = c.clone().sub(P).dot(a);
    if (dist < 0) {
      a.negate();
      dist = -dist;
    }
    return { a, dist, w };
  }).filter((x) => x && x.dist > 0.25);
  if (!info.length) return null;
  // 正面：いま向いている方向にいちばん近い壁の向きに合わせる（45°以内）
  let best = null;
  for (const i of info) {
    const d = i.a.dot(fwd);
    if (d > 0.7 && (!best || d > best.d)) best = { d, i };
  }
  if (!best) return null;
  const f = best.i.a.clone();
  const newYaw = Math.atan2(-f.x, -f.z);
  const r = new THREE.Vector3(-f.z, 0, f.x); // 右
  const dirs = { front: f, back: f.clone().negate(), right: r, left: r.clone().negate() };
  const near = {};
  for (const i of info) {
    for (const [name, v] of Object.entries(dirs)) {
      if (i.a.dot(v) > 0.94 && (near[name] == null || i.dist < near[name])) near[name] = i.dist;
    }
  }
  const out = { place: { yaw: newYaw } };
  let cf = 0, cr = 0;
  if (near.front != null && near.back != null) {
    out.depth = near.front + near.back;
    cf = (near.front - near.back) / 2;
  }
  if (near.left != null && near.right != null) {
    out.width = near.left + near.right;
    cr = (near.right - near.left) / 2;
  }
  const center = P.clone().addScaledVector(f, cf).addScaledVector(r, cr);
  out.place.x = center.x;
  out.place.z = center.z;
  // 天井
  const ceil = planes.filter((p) => !p.vertical && (/ceiling/i.test(p.label) || p.normal.y < -0.7));
  if (ceil.length) {
    const h = Math.min(...ceil.map((p) => p.center.y)) - floorY;
    if (h > LIMITS.height[0] - 0.2 && h < LIMITS.height[1] + 0.3) out.height = h;
  }
  // ドア（ラベルに door を含む平面）
  const door = planes.find((p) => /door/i.test(p.label));
  if (door) {
    const W = out.width ?? 0, D = out.depth ?? 0;
    const v = new THREE.Vector3(door.center.x, 0, door.center.z).sub(center);
    const lx = v.dot(r), lz = -v.dot(f); // 独房の座標（-Z が正面）
    const cand = [
      { wall: 'front', d: Math.abs(lz + D / 2), offset: lx },
      { wall: 'back', d: Math.abs(lz - D / 2), offset: -lx },
      { wall: 'right', d: Math.abs(lx - W / 2), offset: lz },
      { wall: 'left', d: Math.abs(lx + W / 2), offset: -lz },
    ];
    cand.sort((a, b) => a.d - b.d);
    if (W && D && cand[0].d < 0.6) out.door = { wall: cand[0].wall, offset: cand[0].offset };
  }
  out.found = Object.keys(near).length;
  return out;
}

// XRFrame の detectedPlanes を、上の関数が使う形に変換する
const _m = new THREE.Matrix4();
export function readXRPlanes(frame, refSpace) {
  const set = frame && frame.detectedPlanes;
  if (!set || !set.size) return [];
  const out = [];
  set.forEach((plane) => {
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose) return;
    _m.fromArray(pose.transform.matrix);
    // 平面の座標では、法線が +Y、形は XZ 平面上の多角形
    const poly = plane.polygon || [];
    let cx = 0, cz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) {
      cx += p.x; cz += p.z;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    if (poly.length) { cx /= poly.length; cz /= poly.length; }
    const center = new THREE.Vector3(cx, 0, cz).applyMatrix4(_m);
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(_m);
    out.push({
      vertical: plane.orientation === 'vertical' || Math.abs(normal.y) < 0.3,
      label: plane.semanticLabel || '',
      center,
      normal,
      width: poly.length ? Math.max(maxX - minX, maxZ - minZ) : 0,
    });
  });
  return out;
}
