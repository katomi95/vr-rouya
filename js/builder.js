// 箱と円柱を1つのジオメトリにまとめるための小さな道具。
// 鉄格子は数百本の部品になるが、材質ごとに1回の描画で済ませる。
// UV はメートル単位の位置から付けるので、長い部品でも模様が引き伸ばされない。
import * as THREE from '../vendor/three.module.min.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }

  _push(m, x, y, z, nx, ny, nz, u, v) {
    _v.set(x, y, z).applyMatrix4(m);
    _n.set(nx, ny, nz).applyMatrix3(_nm).normalize();
    this.pos.push(_v.x, _v.y, _v.z);
    this.nor.push(_n.x, _n.y, _n.z);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  // 中心 (0,0,0)、大きさ sx×sy×sz の箱を m で置く。
  // UV は面ごとに「横方向, 縦方向」のメートル値 × scale + off（縦は常に局所 y：錆のしずくが下へ流れる）
  addBox(m, sx, sy, sz, { scale = 0.5, off = [0, 0] } = {}) {
    _nm.getNormalMatrix(m);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // [法線, 面の u 軸, 面の v 軸]
    const faces = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const h = [hx, hy, hz];
    for (const [n, a, b] of faces) {
      const base = [];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 1, 2].map((i) => n[i] * h[i] + a[i] * su * h[i] + b[i] * sv * h[i]);
        // 面の中の位置（メートル）から UV
        const pu = a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
        const pv = b[0] * p[0] + b[1] * p[1] + b[2] * p[2];
        base.push(this._push(m, p[0], p[1], p[2], n[0], n[1], n[2], pu * scale + off[0], -pv * scale + off[1]));
      }
      this.idx.push(base[0], base[1], base[2], base[0], base[2], base[3]);
    }
  }

  // 局所 y 方向に伸びる円柱（中心が原点、長さ h、半径 r）
  addCylinder(m, r, h, seg = 10, { scale = 0.5, off = [0, 0], caps = true } = {}) {
    _nm.getNormalMatrix(m);
    const circ = 2 * Math.PI * r;
    const start = this.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const u = (i / seg) * circ * scale + off[0];
      this._push(m, c * r, -h / 2, s * r, c, 0, s, u, (h / 2) * scale + off[1]);
      this._push(m, c * r, h / 2, s * r, c, 0, s, u, (-h / 2) * scale + off[1]);
    }
    for (let i = 0; i < seg; i++) {
      const a = start + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (!caps) return;
    for (const sy of [-1, 1]) {
      const c0 = this._push(m, 0, (sy * h) / 2, 0, 0, sy, 0, off[0], off[1]);
      const ring = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(this._push(m, Math.cos(a) * r, (sy * h) / 2, Math.sin(a) * r, 0, sy, 0,
          Math.cos(a) * r * scale + off[0], Math.sin(a) * r * scale + off[1]));
      }
      for (let i = 0; i < seg; i++) {
        if (sy > 0) this.idx.push(c0, ring[i + 1], ring[i]);
        else this.idx.push(c0, ring[i], ring[i + 1]);
      }
    }
  }

  get empty() {
    return this.idx.length === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// 行列を作る小さな関数：平行移動 + Y回転 + X回転 + Z回転
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
export function mat(x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _one);
}
