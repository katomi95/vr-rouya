// 鉄・塗装鋼板・プレートのテクスチャを Canvas で作る（画像ファイルなし）。
// どれも継ぎ目なく繰り返せるよう、ノイズは周期的に作る。
import * as THREE from '../vendor/three.module.min.js';

// ---------- 繰り返し可能なノイズ ----------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// period×period の格子に乱数を置いた、周期的な値ノイズ
function valueNoise(period, rng) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1];
    const c = g[y1 * period + x0], d = g[y1 * period + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// 0..1 の座標 (u, v) で引ける、オクターブ重ねの周期ノイズ
function fbm(seed, base, octaves) {
  const rng = makeRng(seed);
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push({ f: base << o, n: valueNoise(base << o, rng), a: 0.5 ** o });
  const norm = layers.reduce((s, l) => s + l.a, 0);
  return (u, v) => {
    let s = 0;
    for (const l of layers) s += l.n(u * l.f, v * l.f) * l.a;
    return s / norm;
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

function canvasTex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 色・粗さ・凹凸の3枚をまとめて作る。shade(u, v) が { r, g, b, rough, bump } を返す
function bake(size, shade) {
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  };
  const cc = mk(), rc = mk(), bc = mk();
  const ci = cc.getContext('2d').createImageData(size, size);
  const ri = rc.getContext('2d').createImageData(size, size);
  const bi = bc.getContext('2d').createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = shade(x / size, y / size);
      const k = (y * size + x) * 4;
      ci.data[k] = p.r; ci.data[k + 1] = p.g; ci.data[k + 2] = p.b; ci.data[k + 3] = 255;
      const r = Math.round(p.rough * 255);
      ri.data[k] = r; ri.data[k + 1] = r; ri.data[k + 2] = r; ri.data[k + 3] = 255;
      const b = Math.round(p.bump * 255);
      bi.data[k] = b; bi.data[k + 1] = b; bi.data[k + 2] = b; bi.data[k + 3] = 255;
    }
  }
  cc.getContext('2d').putImageData(ci, 0, 0);
  rc.getContext('2d').putImageData(ri, 0, 0);
  bc.getContext('2d').putImageData(bi, 0, 0);
  return { map: canvasTex(cc, true), roughnessMap: canvasTex(rc, false), bumpMap: canvasTex(bc, false), canvas: cc };
}

// 縦に流れる錆のしずく。u 方向は周期的、v 方向に下へ伸びる。
// 画素ごとに全部のしずくを調べると重いので、先に size×size の格子へ描いておく
function dripField(seed, count, size) {
  const rng = makeRng(seed);
  const f = new Float32Array(size * size);
  for (let i = 0; i < count; i++) {
    const u0 = rng(), v0 = rng(), w = 0.004 + rng() * 0.012, len = 0.08 + rng() * 0.35, a = 0.4 + rng() * 0.6;
    const wx = Math.ceil(w * size), ly = Math.ceil(len * size);
    const cx = u0 * size, cy = Math.floor(v0 * size);
    for (let dy = 0; dy < ly; dy++) {
      const y = (cy + dy) % size;
      const fall = 1 - dy / ly;
      for (let dx = -wx; dx <= wx; dx++) {
        const x = (((Math.round(cx) + dx) % size) + size) % size;
        const d = Math.abs(Math.round(cx) + dx - cx) / (w * size);
        if (d >= 1) continue;
        const k = y * size + x;
        f[k] = Math.max(f[k], (1 - d) * fall * a);
      }
    }
  }
  return (u, v) => f[Math.floor(v * size) * size + Math.floor(u * size)];
}

// 細い引っかき傷（短い線分）。これも格子へ先に描く
function scratchField(seed, count, size) {
  const rng = makeRng(seed);
  const f = new Float32Array(size * size);
  for (let i = 0; i < count; i++) {
    const a = (rng() - 0.5) * 0.9 + (rng() < 0.5 ? 0 : Math.PI / 2);
    const x0 = rng() * size, y0 = rng() * size, len = (0.02 + rng() * 0.07) * size;
    for (let t = 0; t < len; t += 0.5) {
      const x = ((Math.round(x0 + Math.cos(a) * t) % size) + size) % size;
      const y = ((Math.round(y0 + Math.sin(a) * t) % size) + size) % size;
      f[y * size + x] = 1;
    }
  }
  return (u, v) => f[Math.floor(v * size) * size + Math.floor(u * size)];
}

// ---------- 黒ずんだ鉄（鉄格子・補強材・蝶番・閂） ----------
export function makeIronTextures(size = 512) {
  const n1 = fbm(11, 4, 5);   // 錆のまだら
  const n2 = fbm(23, 16, 4);  // 細かいざらつき
  const n3 = fbm(37, 8, 3);   // 黒ずみ
  const drip = dripField(41, 90, size);
  const scratchAt = scratchField(53, 70, size);
  return bake(size, (u, v) => {
    const rustN = n1(u, v) * 0.75 + n2(u, v) * 0.25;
    let rust = smooth(0.52, 0.7, rustN) * 0.85;
    rust = Math.max(rust, drip(u, v) * 0.6);
    const grime = n3(u, v);
    const fine = n2(u, v);
    const scr = scratchAt(u, v) * (1 - rust);
    // 地の鉄：ほぼ黒の青灰色。錆：赤茶〜こげ茶
    const ir = 44 + fine * 22 - grime * 14, ig = 43 + fine * 21 - grime * 14, ib = 42 + fine * 20 - grime * 12;
    const rv = n2(u * 1.3 + 0.2, v * 1.3);
    const rr = mix(70, 104, rv), rg = mix(44, 60, rv), rb = mix(30, 36, rv);
    let r = mix(ir, rr, rust), g = mix(ig, rg, rust), b = mix(ib, rb, rust);
    r = mix(r, 120, scr * 0.6); g = mix(g, 118, scr * 0.6); b = mix(b, 114, scr * 0.6);
    return {
      r, g, b,
      rough: Math.min(1, mix(0.5, 0.95, rust) - scr * 0.25 + (fine - 0.5) * 0.1),
      bump: 0.5 + (rust * (fine - 0.3)) * 0.6 - scr * 0.35 + (n2(u * 2, v * 2) - 0.5) * 0.15,
    };
  });
}

// ---------- 鉄扉：灰緑の塗装が剥げて錆が出ている鋼板 ----------
export function makeDoorTextures(size = 512) {
  const n1 = fbm(71, 4, 5);
  const n2 = fbm(83, 16, 4);
  const n3 = fbm(97, 2, 3);
  const drip = dripField(101, 60, size);
  return bake(size, (u, v) => {
    const chip = smooth(0.63, 0.67, n1(u, v) * 0.45 + n2(u, v) * 0.55);   // 塗装の剥げ（小さく不規則に）
    const rust = Math.max(chip, drip(u, v) * 0.45);
    const fine = n2(u, v);
    const tone = n3(u, v);
    // 塗装：くすんだ灰緑。上の方がやや明るく、下は汚れて暗い
    const dirt = smooth(0.55, 1.0, v) * 0.35 + tone * 0.15;
    const pr = 70 + fine * 12 - dirt * 34, pg = 78 + fine * 12 - dirt * 34, pb = 72 + fine * 10 - dirt * 30;
    const rr = mix(66, 96, fine), rg = mix(42, 56, fine), rb = mix(30, 34, fine);
    return {
      r: mix(pr, rr, rust), g: mix(pg, rg, rust), b: mix(pb, rb, rust),
      rough: mix(0.62, 0.95, rust) + (fine - 0.5) * 0.08,
      // 剥げたところは一段へこむ
      bump: 0.62 - chip * 0.3 + (fine - 0.5) * 0.12,
    };
  });
}

// ---------- 囚人番号のプレート ----------
export function makePlateTexture(number) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const n = fbm(131, 8, 4);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // ヘアライン仕上げのステンレス風：横方向に細かい筋
      const k = (y * W + x) * 4;
      const line = Math.sin(y * 1.7 + n(x / W * 0.2, y / H) * 40) * 6;
      const g = 150 + line + n(x / W, y / H) * 40 - smooth(0.6, 1, n(x / W * 2, y / H * 2)) * 50;
      img.data[k] = g * 0.98; img.data[k + 1] = g; img.data[k + 2] = g * 0.97; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 縁の影
  ctx.strokeStyle = 'rgba(30,30,30,0.6)';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  // ねじ
  for (const [x, y] of [[30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30]]) {
    const gr = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 11);
    gr.addColorStop(0, '#ddd');
    gr.addColorStop(1, '#555');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 3);
    ctx.lineTo(x + 7, y - 3);
    ctx.stroke();
  }
  // 刻印風の文字（白い下ハイライト＋黒）
  const FONT = '"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif';
  const engrave = (text, size, y, weight = 700) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(text, W / 2 + 1, y + 2);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillText(text, W / 2, y);
  };
  engrave('囚 人 番 号', 40, 72, 700);
  engrave(String(number), 108, 160, 800);
  // 少しだけ錆汚れ
  for (let i = 0; i < 4; i++) {
    const x = 40 + Math.random() * (W - 80);
    const gr = ctx.createLinearGradient(x, H * 0.5, x, H);
    gr.addColorStop(0, 'rgba(110,60,30,0)');
    gr.addColorStop(1, 'rgba(110,60,30,0.35)');
    ctx.fillStyle = gr;
    ctx.fillRect(x, H * 0.5, 3 + Math.random() * 4, H * 0.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- 床に落ちる光のにじみ（監視灯のグロー用の丸い点） ----------
export function makeGlowTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,236,200,1)');
  g.addColorStop(0.25, 'rgba(255,214,160,0.45)');
  g.addColorStop(1, 'rgba(255,200,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
