// 看守の声。Web Speech API（speechSynthesis）の日本語音声で読み上げる。
// 日本語の音声が無い環境では何も言わない（英語の声で日本語を読ませると別物になるので）。
// speechSynthesis は WebAudio を通らないため立体音響にはならない。
export class GuardVoice {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    this.voice = null;
    this.enabled = true;
    this.volume = 0.7;
    this._ready = this.supported ? this._findVoice() : Promise.resolve(null);
  }

  // 声の一覧は後から届くことがあるので、少し待つ
  _findVoice() {
    return new Promise((resolve) => {
      const pick = () => {
        const list = window.speechSynthesis.getVoices() || [];
        const ja = list.filter((v) => /^ja(-|_|$)/i.test(v.lang));
        if (!ja.length) return null;
        // 男性っぽい名前の声があれば優先（無ければ最初の日本語音声）
        return ja.find((v) => /male|男|Ichiro|Keita|Otoya|Hattori|Daichi|Naoki/i.test(v.name) && !/female/i.test(v.name)) || ja[0];
      };
      let v = pick();
      if (v) {
        this.voice = v;
        resolve(v);
        return;
      }
      const done = () => {
        v = pick();
        if (v) {
          this.voice = v;
          window.speechSynthesis.removeEventListener('voiceschanged', done);
          resolve(v);
        }
      };
      window.speechSynthesis.addEventListener('voiceschanged', done);
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', done);
        if (!this.voice) this.voice = pick();
        resolve(this.voice);
      }, 2500);
    });
  }

  // 'ok' | 'no-api' | 'no-ja'
  async status() {
    if (!this.supported) return 'no-api';
    await this._ready;
    return this.voice ? 'ok' : 'no-ja';
  }

  get available() {
    return this.enabled && !!this.voice;
  }

  say(text) {
    if (!this.available) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = this.voice;
      u.lang = this.voice.lang;
      u.rate = 0.92;
      u.pitch = 0.55; // 低めの声で
      u.volume = Math.min(1, this.volume * 1.1);
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }

  cancel() {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      // 何もしない
    }
  }
}
