// 開始前の設定。ブラウザに保存して次回も同じ値で始める（保存できない環境でも動く）。
const KEY = 'vr-rouya-settings-v1';

// 部屋の大きさの目安（江戸間ではなく、よくある 1畳 = 1.82m × 0.91m 前後で丸めた値）
export const ROOM_PRESETS = {
  '4.5': { label: '4.5畳', width: 2.73, depth: 2.73 },
  '6': { label: '6畳', width: 3.64, depth: 2.73 },
  '8': { label: '8畳', width: 3.64, depth: 3.64 },
  '10': { label: '10畳', width: 4.55, depth: 3.64 },
};

// 鉄格子の間隔（中心どうしの距離 m）
export const DENSITY = {
  sparse: { label: 'まばら', spacing: 0.22 },
  normal: { label: 'ふつう', spacing: 0.15 },
  dense: { label: 'みっしり', spacing: 0.11 },
};

// 演出の強度。数字が大きいほど物が多く、出来事が起きやすい（それでも基本は静か）
export const INTENSITY = {
  low: {
    label: '控えめ',
    shadow: 0.12, doorOpacity: 0.78,
    ambientGap: [70, 160], patrolGap: [360, 540], firstPatrol: [120, 180],
    lamp: false, lightsOut: false,
  },
  normal: {
    label: 'ふつう',
    shadow: 0.2, doorOpacity: 0.88,
    ambientGap: [40, 100], patrolGap: [180, 320], firstPatrol: [80, 130],
    lamp: true, lightsOut: true,
  },
  high: {
    label: '本格的',
    shadow: 0.28, doorOpacity: 0.92,
    ambientGap: [22, 60], patrolGap: [100, 200], firstPatrol: [50, 80],
    lamp: true, lightsOut: true,
  },
};

export const DEFAULTS = {
  preset: '6',
  width: 3.64,
  depth: 2.73,
  height: 2.4,
  density: 'normal',
  volume: 0.7,
  voice: true,
  intensity: 'normal',
  planes: true,       // 平面検出（Quest の空間設定）で部屋の形を読む
  occlusion: false,   // 深度センサーで家具の後ろの鉄格子を隠す（実験的）
};

export const LIMITS = {
  width: [1.5, 8],
  depth: [1.5, 8],
  height: [2.0, 3.5],
};

export function clampSettings(s) {
  const c = (v, [a, b], d) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
  s.width = c(+s.width, LIMITS.width, DEFAULTS.width);
  s.depth = c(+s.depth, LIMITS.depth, DEFAULTS.depth);
  s.height = c(+s.height, LIMITS.height, DEFAULTS.height);
  s.volume = c(+s.volume, [0, 1], DEFAULTS.volume);
  if (!DENSITY[s.density]) s.density = DEFAULTS.density;
  if (!INTENSITY[s.intensity]) s.intensity = DEFAULTS.intensity;
  s.voice = !!s.voice;
  s.planes = !!s.planes;
  s.occlusion = !!s.occlusion;
  return s;
}

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {
    saved = {};
  }
  return clampSettings({ ...DEFAULTS, ...saved });
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    // 保存できなくても体験はできる
  }
}
