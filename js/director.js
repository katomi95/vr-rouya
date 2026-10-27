// 体験の進行。といっても、ほとんど何も起きない。
//  - 最初に扉が閉まり、閂がかかり、看守が去っていく
//  - あとは静寂。ときどき遠くの物音、まれに看守の巡回と声
// 脱出・クリア・スコアの類はない。おわるにはヘッドセットを外す（または「おわる」）。
import * as THREE from '../vendor/three.module.min.js';

const rand = ([a, b]) => a + Math.random() * (b - a);
const DIGITS = ['まる', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
export const readNumber = (n) => String(n).split('').map((d) => DIGITS[+d]).join(' ');

export class Director {
  constructor(cell, audio, voice) {
    this.cell = cell;
    this.audio = audio;
    this.voice = voice;
    this.active = false;
    this.queue = [];
    this.log = []; // 確認用：何が起きたか
  }

  begin(intensity, number) {
    this.I = intensity;
    this.number = number;
    this.t = 0;
    this.active = true;
    this.queue = [];
    this.lastLine = null;
    this.lightsOutAt = -1e9;
    this.nextAmbient = 14 + Math.random() * 10;
    this.nextPatrol = rand(intensity.firstPatrol);
    this.firstPatrol = true;
    this.cell.setLatch(0);
    this.cell.setLamp(true);
    this._intro();
  }

  end() {
    this.active = false;
    this.queue = [];
    this.voice.cancel();
  }

  at(delay, fn) {
    this.queue.push({ t: this.t + delay, fn });
  }

  _w(local) {
    return this.cell.toWorld(local);
  }

  // ---------- 最初：収監 ----------
  _intro() {
    const cell = this.cell;
    const door = this._w(cell.doorLocal);
    this.revealFrom = cell.reveal;
    this.revealT = 0;
    this.at(1.5, () => this.audio.doorSlam(door, { near: true }));
    this.latchAnim = { start: 1.75, dur: 0.45 };
    this.at(1.75, () => this.audio.latch(door));
    // 鍵をかけた看守が、廊下を去っていく
    const d = cell.doorInfo.x;
    const dir = Math.random() < 0.5 ? 1 : -1;
    this.at(3.4, () => {
      this.audio.keys(this._w(cell.corridorLocal(d, 1.0, 1.1)), 0, 0.6, 0.9);
      this.audio.walk((s) => this._w(cell.corridorLocal(d + dir * (0.5 + s * 11), 1.3, 0.1)), { duration: 9, delay: 0.5 });
    });
    this.log.push('intro');
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const cell = this.cell;

    // 出現：半透明 → 不透明
    if (this.revealT < 1) {
      this.revealT = Math.min(1, this.revealT + dt / 1.3);
      const k = this.revealT * this.revealT * (3 - 2 * this.revealT);
      cell.setReveal(THREE.MathUtils.lerp(this.revealFrom, 1, k));
    }
    if (this.latchAnim) {
      const k = (this.t - this.latchAnim.start) / this.latchAnim.dur;
      if (k >= 0) cell.setLatch(Math.min(1, k * k));
      if (k >= 1) this.latchAnim = null; // 閉まりきると南京錠も出る
    }

    // 予定していた出来事
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].t <= this.t) {
        const q = this.queue.splice(i, 1)[0];
        q.fn();
      }
    }

    if (this.t >= this.nextAmbient) {
      this._ambient();
      this.nextAmbient = this.t + rand(this.I.ambientGap);
    }
    if (this.t >= this.nextPatrol) {
      this._patrol();
      this.nextPatrol = this.t + rand(this.I.patrolGap);
    }
  }

  // ---------- 遠くの物音 ----------
  _ambient() {
    const cell = this.cell;
    const far = () => this._w(cell.corridorLocal((Math.random() - 0.5) * 30, 3 + Math.random() * 12, Math.random() < 0.3 ? 3.5 + Math.random() * 2 : 1));
    const r = Math.random();
    if (r < 0.38) {
      this.audio.clang(far());
      this.log.push('clang');
    } else if (r < 0.66) {
      this.audio.doorSlam(far());
      this.log.push('far-door');
    } else if (r < 0.82) {
      this.audio.keys(far(), 0, 0.8, 0.6);
      this.log.push('far-keys');
    } else {
      // 遠くの廊下を誰かが通り過ぎる（立ち止まらない）
      const out = 5 + Math.random() * 6;
      const s0 = (Math.random() - 0.5) * 6, dir = Math.random() < 0.5 ? 1 : -1;
      this.audio.walk((s) => this._w(cell.corridorLocal(s0 + dir * (s * 16 - 8), out, 0.1)), { duration: 12, keys: false });
      this.log.push('far-steps');
    }
  }

  // ---------- 看守の巡回 ----------
  _patrol() {
    const cell = this.cell;
    const d = cell.doorInfo.x;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const line = this._pickLine();
    const stopDur = line.after ? 9 : 6;
    const path = (s) => this._w(cell.corridorLocal(d + dir * (s * 16 - 8), 1.3, 0.1));
    const stop = this.audio.walk(path, { duration: 14, stopAt: 0.5, stopDur });
    if (stop < 0) return;
    const door = this._w(cell.corridorLocal(d, 1.0, 1.1));
    this.at(stop + 0.4, () => this.audio.keys(door, 0, 0.5, 0.8));
    this.at(stop + 1.4, () => this._say(line.text));
    if (line.after) this.at(stop + 6.2, () => this._say(line.after));
    if (line.id === 'lights') {
      this.at(stop + 3.2, () => this._lights(false));
      this.at(stop + 3.2 + rand([60, 95]), () => this._lights(true));
    }
    this.log.push(`patrol:${line.id}`);
  }

  _pickLine() {
    const n = readNumber(this.number);
    const lines = [
      { id: 'rollcall', w: 3, text: `囚人番号、${n}。点呼！`, after: 'よし。' },
      { id: 'quiet', w: 3, text: '静粛に！' },
      { id: 'visit', w: 2, text: '面会は許可されていない！' },
      { id: 'talk', w: 2, text: '私語は慎め！' },
      { id: 'check', w: 2, text: `${n}番。異常はないか。`, after: '……ないな。' },
      { id: 'wait', w: 1, text: 'そのまま待て。' },
    ];
    if (this.I.lightsOut && this.cell.lamp.on && this.t - this.lightsOutAt > 480) {
      lines.push({ id: 'lights', w: 3, text: '消灯時間だ！' });
    }
    if (this.firstPatrol) {
      this.firstPatrol = false;
      this.lastLine = lines[0].id;
      return lines[0];
    }
    const pool = lines.filter((l) => l.id !== this.lastLine);
    let r = Math.random() * pool.reduce((s, l) => s + l.w, 0);
    for (const l of pool) {
      r -= l.w;
      if (r <= 0) {
        this.lastLine = l.id;
        return l;
      }
    }
    return pool[0];
  }

  _say(text) {
    const ok = this.voice.say(text);
    this.log.push(ok ? `say:${text}` : `say(skip):${text}`);
  }

  _lights(on) {
    const cell = this.cell;
    if (!cell.cfg.lamp) return;
    if (!on) this.lightsOutAt = this.t;
    cell.setLamp(on);
    const lamp = this._w(new THREE.Vector3(0, cell.cfg.height - 0.1, 0));
    this.audio.lightSwitch(lamp, this._w(cell.corridorLocal(-6, 4, 2)), on);
    this.log.push(on ? 'lights-on' : 'lights-out');
  }
}
