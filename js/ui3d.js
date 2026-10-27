// XR の中の表示：配置用のパネル、「おわる」ボタン、コントローラーの光線。
// どれも Canvas に描いた板。DOM Overlay は使わない（Quest の immersive-ar で確実に出せるように）。
import * as THREE from '../vendor/three.module.min.js';

const FONT = '"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();

// 頭の正面（水平方向）に板を置く。dist：前への距離、drop：目の高さからどれだけ下げるか
export function placeInFront(mesh, camera, dist, drop, side = 0) {
  camera.updateMatrixWorld();
  _m.copy(camera.matrixWorld);
  _p.setFromMatrixPosition(_m);
  _q.setFromRotationMatrix(_m);
  _f.set(0, 0, -1).applyQuaternion(_q);
  _f.y = 0;
  if (_f.lengthSq() < 1e-4) _f.set(0, 0, -1);
  _f.normalize();
  const r = new THREE.Vector3(-_f.z, 0, _f.x);
  mesh.position.copy(_p).addScaledVector(_f, dist).addScaledVector(r, side);
  mesh.position.y -= drop;
  mesh.lookAt(_p.x, _p.y - drop * 0.4, _p.z);
}

// ---------- 配置パネル ----------
// page: { title, lines: [文字列], rows: [{ label, value?, buttons: [{ id, text, w? }] }], footer: [{ id, text, primary? }] }
export class Panel {
  constructor() {
    this.W = 1024;
    this.H = 720;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const size = 0.6;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size * (this.H / this.W)),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    );
    this.mesh.renderOrder = 400;
    this.mesh.visible = false;
    this.buttons = [];
    this.hover = null;
    this.page = null;
  }

  setPage(page) {
    this.page = page;
    this.redraw();
  }

  redraw() {
    const { ctx, W, H } = this;
    const page = this.page;
    ctx.clearRect(0, 0, W, H);
    if (!page) return;
    roundRect(ctx, 6, 6, W - 12, H - 12, 28);
    ctx.fillStyle = 'rgba(22,22,22,0.9)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,192,74,0.75)';
    ctx.stroke();
    // 注意書き風の黄色い帯
    ctx.save();
    roundRect(ctx, 6, 6, W - 12, 78, 28);
    ctx.clip();
    ctx.fillStyle = '#e8b030';
    ctx.fillRect(0, 0, W, 84);
    ctx.restore();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `700 40px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(page.title, 40, 46);

    let y = 120;
    ctx.fillStyle = '#e8e4da';
    ctx.font = `400 30px ${FONT}`;
    for (const line of page.lines || []) {
      ctx.fillText(line, 40, y);
      y += 44;
    }
    if ((page.lines || []).length) y += 12;

    this.buttons = [];
    const bh = 64;
    for (const row of page.rows || []) {
      ctx.fillStyle = '#c9c3b5';
      ctx.font = `500 32px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, 40, y + bh / 2);
      let x = 210;
      const order = row.value != null ? [row.buttons[0], { value: row.value }, ...row.buttons.slice(1)] : row.buttons;
      for (const b of order) {
        if (b.value != null) {
          ctx.fillStyle = '#fff';
          ctx.font = `700 34px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(b.value, x + 90, y + bh / 2);
          x += 180;
          continue;
        }
        const w = b.w || 110;
        this._button(b, x, y, w, bh, false);
        x += w + 14;
      }
      y += bh + 16;
    }

    // 下の段のボタン（右寄せ）
    const footer = page.footer || [];
    let fx = W - 40;
    const fy = H - 40 - 80;
    for (let i = footer.length - 1; i >= 0; i--) {
      const b = footer[i];
      const w = b.w || 260;
      fx -= w;
      this._button(b, fx, fy, w, 80, !!b.primary);
      fx -= 20;
    }
    this.tex.needsUpdate = true;
  }

  _button(b, x, y, w, h, primary) {
    const { ctx } = this;
    const hot = this.hover === b.id;
    roundRect(ctx, x, y, w, h, 14);
    if (primary) ctx.fillStyle = hot ? '#ffd27a' : '#e8b030';
    else ctx.fillStyle = hot ? '#6b665c' : '#3b3934';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = hot ? '#fff' : 'rgba(255,255,255,0.25)';
    ctx.stroke();
    ctx.fillStyle = primary ? '#1a1a1a' : '#f2eee4';
    ctx.font = `700 ${b.small ? 26 : 32}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text, x + w / 2, y + h / 2 + 1);
    this.buttons.push({ id: b.id, x, y, w, h });
  }

  // 光線（Raycaster）が当たったボタンの id
  hitTest(raycaster) {
    if (!this.mesh.visible) return { hit: false, id: null };
    const h = raycaster.intersectObject(this.mesh, false)[0];
    if (!h || !h.uv) return { hit: false, id: null };
    const px = h.uv.x * this.W, py = (1 - h.uv.y) * this.H;
    for (const b of this.buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return { hit: true, id: b.id, distance: h.distance };
    }
    return { hit: true, id: null, distance: h.distance };
  }

  setHover(id) {
    if (id === this.hover) return;
    this.hover = id;
    this.redraw();
  }
}

// ---------- 「おわる」ボタン ----------
// 体験中はふだん見えない。トリガー（ピンチ）を引くと正面に出てきて、しばらくすると消える。
function drawEnd(hover) {
  const W = 360, H = 130;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  roundRect(ctx, 6, 6, W - 12, H - 12, 24);
  ctx.fillStyle = hover ? 'rgba(255,214,130,0.95)' : 'rgba(25,25,25,0.75)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = hover ? '#fff' : 'rgba(255,192,74,0.8)';
  ctx.stroke();
  ctx.fillStyle = hover ? '#1a1a1a' : '#f4efe4';
  ctx.font = `700 50px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('おわる', W / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class EndButton {
  constructor() {
    this.texIdle = drawEnd(false);
    this.texHover = drawEnd(true);
    this.material = new THREE.MeshBasicMaterial({ map: this.texIdle, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.065), this.material);
    this.mesh.renderOrder = 410;
    this.mesh.visible = false;
    this.hover = false;
    this.life = 0;
  }

  summon(camera) {
    placeInFront(this.mesh, camera, 0.5, 0.16);
    this.mesh.visible = true;
    this.life = 7;
  }

  update(dt) {
    if (!this.mesh.visible) return;
    if (!this.hover) this.life -= dt;
    this.material.opacity = Math.min(1, this.life / 0.8);
    if (this.life <= 0) this.hide();
  }

  setHover(on) {
    if (on === this.hover) return;
    this.hover = on;
    this.material.map = on ? this.texHover : this.texIdle;
    if (on) this.life = Math.max(this.life, 2);
  }

  hide() {
    this.mesh.visible = false;
    this.setHover(false);
  }
}

// コントローラー（手）ごとの細い光線と、当たった所の点
export function makeRay() {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }));
  line.renderOrder = 420;
  line.visible = false;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  dot.renderOrder = 421;
  dot.position.z = -1;
  line.add(dot);
  line.userData.dot = dot;
  return line;
}
