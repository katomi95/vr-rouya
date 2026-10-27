// 牢獄の音。すべて WebAudio で合成する（音声ファイルなし）。
// 音はワールド座標で置き、HRTF の立体音響で聞かせる（頭の位置・向きは毎フレーム listener に渡す）。
//  - 換気口の低い動作音（ずっと鳴っている。換気口の位置から）
//  - 建物全体のごく小さな低いうなり
//  - 金属音、遠くで閉まる鉄扉、看守の足音、鍵束、閂、監視カメラの首振り … 呼ばれたときだけ
// 遠くの音ほど残響（コンクリートの廊下っぽい長い響き）を多くする。
// AudioContext はブラウザの制約上、ボタンを押したタイミングで init() すること。
export class PrisonAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.loops = [];
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // 残響：減衰するノイズを畳み込みの応答にする（約3秒、高域から先に消える）
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    this.reverb.connect(this.wet).connect(this.master);
    this.noise = this._noiseBuffer(2, false);
    this.brown = this._noiseBuffer(4, true);
  }

  _impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        // 時間とともに暗く（ローパスを強く）なっていく
        const k = Math.min(0.95, 0.25 + t * 0.35);
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        const early = i < ctx.sampleRate * 0.012 ? 0 : 1; // 直接音と分ける短い間
        d[i] = lp * Math.exp(-t * 2.1) * early * 2.2;
      }
    }
    return buf;
  }

  _noiseBuffer(sec, brown) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    if (brown) {
      // ループの継ぎ目をなじませる
      const f = 3000;
      for (let i = 0; i < f; i++) {
        const k = i / f;
        d[len - f + i] = d[len - f + i] * (1 - k) + d[i] * k;
      }
    }
    return buf;
  }

  get ready() {
    return !!this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (!this.ctx || !this.running) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  // 立体音響の出口。pos：ワールド座標、wet：残響の量
  _out(pos, { wet = 0.3, ref = 1, dry = 1 } = {}) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    p.maxDistance = 60;
    setPos(p, pos);
    const d = ctx.createGain();
    d.gain.value = dry;
    p.connect(d).connect(this.master);
    const w = ctx.createGain();
    w.gain.value = wet;
    p.connect(w).connect(this.reverb);
    return p;
  }

  // 開始：換気音と建物のうなりを鳴らしはじめる
  start(ventPos) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    this.stopLoops();
    this.running = true;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(this.volume, now + 2.5);

    // 換気口：低いノイズ＋電源のうなり（100Hz と 50Hz）、ゆっくり揺れる
    const vent = this._out(ventPos, { wet: 0.12, ref: 0.8 });
    const g = ctx.createGain();
    g.gain.value = 0.32;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    src.connect(lp).connect(g);
    const hum1 = ctx.createOscillator();
    hum1.frequency.value = 100;
    const h1 = ctx.createGain();
    h1.gain.value = 0.035;
    hum1.connect(h1).connect(g);
    const hum2 = ctx.createOscillator();
    hum2.frequency.value = 50;
    const h2 = ctx.createGain();
    h2.gain.value = 0.05;
    hum2.connect(h2).connect(g);
    // ファンのかすかな羽音（帯域を絞ったノイズの音量を回転数っぽく揺らす）
    const fan = ctx.createBufferSource();
    fan.buffer = this.noise;
    fan.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 1.4;
    const fg = ctx.createGain();
    fg.gain.value = 0.012;
    const flfo = ctx.createOscillator();
    flfo.frequency.value = 13;
    const flg = ctx.createGain();
    flg.gain.value = 0.006;
    flfo.connect(flg).connect(fg.gain);
    fan.connect(bp).connect(fg).connect(g);
    const slow = ctx.createOscillator();
    slow.frequency.value = 0.05;
    const sg = ctx.createGain();
    sg.gain.value = 0.06;
    slow.connect(sg).connect(g.gain);
    g.connect(vent);

    // 建物全体のうなり（どこからともなく。立体にしない）
    const room = ctx.createBufferSource();
    room.buffer = this.brown;
    room.loop = true;
    room.playbackRate.value = 0.7;
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 120;
    const rg = ctx.createGain();
    rg.gain.value = 0.12;
    room.connect(rlp).connect(rg).connect(this.master);

    for (const n of [src, hum1, hum2, fan, flfo, slow, room]) n.start(now);
    this.loops = [src, hum1, hum2, fan, flfo, slow, room];
    this.ventPanner = vent;
  }

  stopLoops() {
    for (const n of this.loops) {
      try { n.stop(); } catch (e) { /* 止まっている */ }
    }
    this.loops = [];
  }

  stop() {
    if (!this.ctx) return;
    this.running = false;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.15);
    const loops = this.loops;
    this.loops = [];
    setTimeout(() => {
      for (const n of loops) {
        try { n.stop(); } catch (e) { /* 止まっている */ }
      }
    }, 800);
  }

  // 頭の位置と向き（three の matrixWorld の elements）
  setListener(e) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const px = e[12], py = e[13], pz = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---------- 部品 ----------

  _env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _noiseHit(dest, t, { type = 'bandpass', freq = 1000, q = 1, peak = 0.5, attack = 0.002, decay = 0.08, rate = 1 }) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, peak, attack, decay);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + attack + decay + 0.05);
  }

  _tone(dest, t, freq, peak, decay, type = 'sine', attack = 0.003) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    this._env(g, t, peak, attack, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    return o;
  }

  // 金属を叩いた音（非整数倍の倍音を重ねる）
  _metal(dest, t, base, peak, length) {
    const ratios = [1, 2.32, 4.25, 6.63, 9.38, 12.1];
    ratios.forEach((r, i) => {
      const f = base * r * (1 + (Math.random() - 0.5) * 0.02);
      if (f > 9000) return;
      this._tone(dest, t, f, peak / (1 + i * 0.9), length / (1 + i * 0.45));
    });
    this._noiseHit(dest, t, { freq: base * 6, q: 0.7, peak: peak * 0.8, decay: 0.05 });
  }

  _lowpass(dest, freq) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.connect(dest);
    return f;
  }

  // ---------- 出来事 ----------

  // どこか遠くで鉄の何かがぶつかる
  clang(pos, delay = 0) {
    if (!this.running) return;
    const t = this.now + delay;
    const out = this._lowpass(this._out(pos, { wet: 1.6, ref: 2, dry: 0.6 }), 2600);
    this._metal(out, t, 180 + Math.random() * 260, 0.5, 2.2);
    if (Math.random() < 0.5) this._metal(out, t + 0.18 + Math.random() * 0.2, 210 + Math.random() * 200, 0.22, 1.4);
  }

  // 鉄扉が閉まる（ドンという低音＋金属の響き＋錠のかかる音）
  doorSlam(pos, { delay = 0, near = false } = {}) {
    if (!this.running) return;
    const t = this.now + delay;
    const p = this._out(pos, near ? { wet: 0.45, ref: 1.2 } : { wet: 1.8, ref: 2.5, dry: 0.55 });
    const out = this._lowpass(p, near ? 6000 : 1800);
    this._noiseHit(out, t, { type: 'lowpass', freq: 260, q: 0.5, peak: near ? 1.6 : 1.2, attack: 0.004, decay: 0.45 });
    this._tone(out, t, 48, near ? 0.9 : 0.7, 0.6);
    this._tone(out, t, 72, near ? 0.4 : 0.3, 0.35);
    this._metal(out, t + 0.01, 96 + Math.random() * 20, near ? 0.35 : 0.3, 2.5);
    // ガチャン
    this._noiseHit(out, t + 0.32, { freq: 2400, q: 2, peak: near ? 0.5 : 0.25, decay: 0.05 });
    this._metal(out, t + 0.34, 820, near ? 0.12 : 0.06, 0.25);
  }

  // 閂を差し込む：こすれる音 → ガチン
  latch(pos, delay = 0) {
    if (!this.running) return;
    const t = this.now + delay;
    const ctx = this.ctx;
    const out = this._out(pos, { wet: 0.35, ref: 0.8 });
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(1300, t);
    f.frequency.linearRampToValueAtTime(2100, t + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.05);
    g.gain.linearRampToValueAtTime(0.22, t + 0.38);
    g.gain.linearRampToValueAtTime(0, t + 0.45);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + 0.5);
    this._metal(out, t + 0.46, 340, 0.4, 0.5);
    this._noiseHit(out, t + 0.46, { type: 'lowpass', freq: 500, peak: 0.6, decay: 0.12 });
    // 南京錠をかける
    this._noiseHit(out, t + 1.1, { freq: 3200, q: 3, peak: 0.25, decay: 0.03 });
    this._metal(out, t + 1.12, 1900, 0.05, 0.12);
  }

  // 革靴の足音1歩（かかと → つま先）
  _step(pos, t, loud, far) {
    const out = this._lowpass(this._out(pos, { wet: far ? 1.2 : 0.55, ref: 1.2, dry: 0.9 }), far ? 2500 : 7000);
    const v = 0.8 + Math.random() * 0.4;
    this._noiseHit(out, t, { freq: 900 + Math.random() * 300, q: 1.1, peak: 0.55 * loud * v, decay: 0.07 });
    this._noiseHit(out, t, { freq: 3200, q: 2.5, peak: 0.18 * loud * v, decay: 0.025 });
    this._tone(out, t, 85, 0.25 * loud * v, 0.06);
    this._noiseHit(out, t + 0.05 + Math.random() * 0.02, { freq: 1400, q: 1.2, peak: 0.2 * loud * v, decay: 0.05 });
  }

  // 鍵束がじゃらっと鳴る
  keys(pos, delay = 0, dur = 0.7, loud = 1) {
    if (!this.running) return;
    const t0 = this.now + delay;
    const out = this._out(pos, { wet: 0.5, ref: 1 });
    const n = 8 + Math.floor(Math.random() * 10);
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.pow(Math.random(), 1.6) * dur;
      const f = 2600 + Math.random() * 4600;
      this._tone(out, t, f, 0.045 * loud, 0.05 + Math.random() * 0.18);
      this._tone(out, t, f * 1.51, 0.02 * loud, 0.04 + Math.random() * 0.08);
      this._noiseHit(out, t, { type: 'highpass', freq: 5000, q: 0.7, peak: 0.05 * loud, decay: 0.015 });
    }
  }

  // 看守が歩く。path(s) が 0..1 に対するワールド座標を返す。
  // stopAt（0..1）で立ち止まり、stopDur 秒後にまた歩き出す。onStop は立ち止まった時刻（秒後）を知らせる
  walk(path, { duration = 12, stride = 0.62, stopAt = -1, stopDur = 0, keys = true, delay = 0 } = {}) {
    if (!this.running) return 0;
    const steps = Math.floor(duration / stride);
    let t = delay;
    let stopped = false;
    let stopTime = -1;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      if (!stopped && stopAt >= 0 && s >= stopAt) {
        stopped = true;
        stopTime = t;
        t += stopDur;
      }
      // 端では小さく（遠い）、近づくと大きく：距離減衰は panner に任せる
      this._step(path(s), this.now + t + (Math.random() - 0.5) * 0.03, 1, false);
      if (keys && Math.random() < 0.35) this.keys(path(s), t + 0.03, 0.18, 0.5);
      t += stride * (0.95 + Math.random() * 0.1);
    }
    return stopTime;
  }

  // 監視カメラのモーター音（ごく小さい）
  servo(pos, dur) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = this.now;
    const out = this._out(pos, { wet: 0.05, ref: 0.4 });
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    o.frequency.linearRampToValueAtTime(175, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(160, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1300;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.08);
    g.gain.setValueAtTime(0.03, t + dur - 0.08);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // 照明のスイッチ（遠くの大きなブレーカー＋電球の近くのカチッ）
  lightSwitch(lampPos, farPos, on) {
    if (!this.running) return;
    const t = this.now;
    const far = this._lowpass(this._out(farPos, { wet: 1.5, ref: 2, dry: 0.5 }), 2000);
    this._noiseHit(far, t, { type: 'lowpass', freq: 400, peak: 0.6, decay: 0.15 });
    this._metal(far, t, 260, 0.15, 0.8);
    const near = this._out(lampPos, { wet: 0.2, ref: 0.6 });
    this._noiseHit(near, t + 0.25, { freq: 3000, q: 2, peak: 0.12, decay: 0.02 });
    if (on) this._tone(near, t + 0.27, 100, 0.03, 0.4, 'triangle');
  }
}

function setPos(p, v) {
  if (p.positionX) {
    p.positionX.value = v.x;
    p.positionY.value = v.y;
    p.positionZ.value = v.z;
  } else {
    p.setPosition(v.x, v.y, v.z);
  }
}
