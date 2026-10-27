/**
 * 基准弦的纯数学层：控制点、单调三次插值（PCHIP）、五声音阶、
 * 采样 → 谐波（供 PeriodicWave）、Karplus-Strong 拨弦缓冲。
 *
 * 这一层没有任何 DOM 依赖，也不 import React，可直接在 node 里单测。
 */

/** 基准弦所在的画布尺寸（与调律台 viewBox 一致）。 */
export const WAVE_WIDTH = 1440;
export const WAVE_HEIGHT = 900;

/** 基准线的 y。 */
export const WAVE_BASE_Y = 838;

/** 控制点的纵向活动范围：向上最多 96px、向下 34px。 */
export const WAVE_Y_MIN = 742;
export const WAVE_Y_MAX = 872;

/** 控制点横向活动范围，两端留一点余量。 */
export const WAVE_X_MIN = 8;
export const WAVE_X_MAX = 1432;

/** 两次点击的 x 距离小于它时，视为同一控制点（只改 y）。 */
export const WAVE_MERGE_X = 18;

/** 控制点（画布坐标）。 */
export interface WavePoint {
  x: number;
  y: number;
}

/** 曲线采样点（画布坐标）。 */
export interface CurveSample {
  x: number;
  y: number;
}

/** 一个沿弦传播的拨弦小波包。`at` 是 performance.now() 时间。 */
export interface PluckPacket {
  x: number;
  at: number;
  amplitude: number;
  sign: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/* ------------------------------------------------------------------ *
 * 控制点
 * ------------------------------------------------------------------ */

/**
 * 点击插入一个控制点：x/y 先夹进基准弦的活动范围。
 * 与已有控制点 x 距离 < WAVE_MERGE_X 时合并（只更新该点 y，x 保持不变）。
 * 返回新的、按 x 排序的数组（不修改入参）。
 */
export function insertPoint(points: readonly WavePoint[], x: number, y: number): WavePoint[] {
  const px = clamp(x, WAVE_X_MIN, WAVE_X_MAX);
  const py = clamp(y, WAVE_Y_MIN, WAVE_Y_MAX);
  const next = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }));

  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < next.length; i++) {
    const distance = Math.abs(next[i]!.x - px);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = i;
    }
  }
  if (nearest >= 0 && nearestDistance < WAVE_MERGE_X) {
    next[nearest]!.y = py;
  } else {
    next.push({ x: px, y: py });
  }
  next.sort((a, b) => a.x - b.x);
  return next;
}

/** 把 y 夹进活动范围，供拖动/调试复用。 */
export function clampY(y: number): number {
  return clamp(y, WAVE_Y_MIN, WAVE_Y_MAX);
}

/* ------------------------------------------------------------------ *
 * 单调三次插值（Fritsch–Carlson / PCHIP）
 * ------------------------------------------------------------------ */

interface Knots {
  xs: number[];
  ys: number[];
}

function buildKnots(points: readonly WavePoint[], baseY: number): Knots {
  const base = finiteOr(baseY, WAVE_BASE_Y);
  const inner = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .filter((p) => p.x > 0 && p.x < WAVE_WIDTH)
    .map((p) => ({ x: p.x, y: clamp(p.y, WAVE_Y_MIN, WAVE_Y_MAX) }))
    .sort((a, b) => a.x - b.x);
  const xs: number[] = [0];
  const ys: number[] = [base];
  let lastX = 0;
  for (const p of inner) {
    // 保证严格递增，插值才稳定（insertPoint 已合并，这里是兜底）。
    if (p.x - lastX < 0.5) continue;
    xs.push(p.x);
    ys.push(p.y);
    lastX = p.x;
  }
  xs.push(WAVE_WIDTH);
  ys.push(base);
  return { xs, ys };
}

/**
 * PCHIP 的节点切线（Fritsch–Carlson，端点用 SciPy 的单侧公式并做单调钳制）。
 * 区间内单调、无过冲。
 */
export function pchipTangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = Math.min(xs.length, ys.length);
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;

  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const hi = xs[i + 1]! - xs[i]!;
    h.push(hi);
    d.push(hi > 0 ? (ys[i + 1]! - ys[i]!) / hi : 0);
  }
  if (n === 2) {
    m[0] = d[0]!;
    m[1] = d[0]!;
    return m;
  }

  for (let i = 1; i < n - 1; i++) {
    const d0 = d[i - 1]!;
    const d1 = d[i]!;
    if (d0 === 0 || d1 === 0 || (d0 > 0) !== (d1 > 0)) {
      m[i] = 0;
      continue;
    }
    const h0 = h[i - 1]!;
    const h1 = h[i]!;
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    m[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
  }

  const endpoint = (h0: number, h1: number, d0: number, d1: number): number => {
    if (h0 <= 0 || h0 + h1 <= 0) return d0;
    const tangent = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if ((tangent > 0) !== (d0 > 0)) return 0;
    if ((d0 > 0) !== (d1 > 0) && Math.abs(tangent) > Math.abs(3 * d0)) return 3 * d0;
    return tangent;
  };

  m[0] = endpoint(h[0]!, h[1]!, d[0]!, d[1]!);
  m[n - 1] = endpoint(h[n - 2]!, h[n - 3]!, d[n - 2]!, d[n - 3]!);
  return m;
}

function evaluateHermite(xs: readonly number[], ys: readonly number[], ms: readonly number[], x: number): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return WAVE_BASE_Y;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const h = xs[hi]! - xs[lo]!;
  if (h <= 0) return ys[lo]!;
  const t = (x - xs[lo]!) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const y0 = ys[lo]!;
  const y1 = ys[hi]!;
  const m0 = ms[lo] ?? 0;
  const m1 = ms[hi] ?? 0;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * m1
  );
}

/**
 * 用 PCHIP 穿过控制点（两端锚定在 (0, baseY)、(1440, baseY)），
 * 均匀评估 `samples` 个采样点。默认 280 个（≥240）。
 */
export function fitCurve(points: readonly WavePoint[], samples = 280, baseY = WAVE_BASE_Y): CurveSample[] {
  const { xs, ys } = buildKnots(points, baseY);
  const ms = pchipTangents(xs, ys);
  const count = Math.max(2, Math.floor(samples));
  const out: CurveSample[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const x = i === count - 1 ? WAVE_WIDTH : (i / (count - 1)) * WAVE_WIDTH;
    out[i] = { x, y: evaluateHermite(xs, ys, ms, x) };
  }
  // 端点必须精确锚定。
  out[0] = { x: 0, y: ys[0]! };
  out[count - 1] = { x: WAVE_WIDTH, y: ys[ys.length - 1]! };
  return out;
}

/** 某 x 处曲线的 y（端点外夹住）。 */
export function curveYAt(points: readonly WavePoint[], x: number, baseY = WAVE_BASE_Y): number {
  const { xs, ys } = buildKnots(points, baseY);
  const ms = pchipTangents(xs, ys);
  return evaluateHermite(xs, ys, ms, clamp(finiteOr(x, 0), 0, WAVE_WIDTH));
}

/** 曲线采样后的纵向位移（y - baseY），按 x 均匀采样，供谐波分析用。 */
export function curveDisplacements(
  points: readonly WavePoint[],
  count = 256,
  baseY = WAVE_BASE_Y,
): number[] {
  return fitCurve(points, count, baseY).map((s) => s.y - finiteOr(baseY, WAVE_BASE_Y));
}

/* ------------------------------------------------------------------ *
 * 音高：A 小调五声音阶，110Hz → 880Hz，共 16 档（3 个八度）
 * ------------------------------------------------------------------ */

/** A 小调五声音阶（A C D E G）的半音步进，跨 3 个八度共 16 个音。 */
const PENTATONIC_STEPS: readonly number[] = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34, 36];

/** 16 个固定音高，110Hz（A2）→ 880Hz（A5）。 */
export const WAVE_NOTES: readonly number[] = PENTATONIC_STEPS.map((semi) => 110 * Math.pow(2, semi / 12));

/**
 * 横坐标 → 五声音阶音高。x 越靠右音越高；degree ∈ [0, 15]。
 */
export function pitchForX(x: number, width = WAVE_WIDTH): { freq: number; degree: number } {
  const w = Number.isFinite(width) && width > 0 ? width : WAVE_WIDTH;
  const t = clamp(finiteOr(x, 0) / w, 0, 1);
  const degree = Math.round(t * (WAVE_NOTES.length - 1));
  return { freq: WAVE_NOTES[degree]!, degree };
}

/* ------------------------------------------------------------------ *
 * 曲线位移 → 谐波（给 PeriodicWave 用）
 * ------------------------------------------------------------------ */

/**
 * 去均值、按最大绝对值归一化。全零/静音输入返回全零。
 */
export function normalizeDisplacements(values: readonly number[]): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  if (n === 0) return out;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += finiteOr(values[i]!, 0) / n;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = finiteOr(values[i]!, 0) - mean;
    out[i] = v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }
  if (peak <= 1e-9) return new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = out[i]! / peak;
  return out;
}

export interface HarmonicSpectrum {
  /** length 为 count + 1；index 0 恒为 0（PeriodicWave 忽略 DC）。 */
  real: Float32Array;
  imag: Float32Array;
  /** 1..count 次谐波的能量之和，用来判断“是否还有形状”。 */
  energy: number;
}

/**
 * 把曲线位移采样（先去均值、归一化）做 DFT，取 1..count 次谐波。
 * index 0 置 0；返回数组长度恒为 count + 1。
 */
export function displacementsToHarmonics(samples: readonly number[], count = 32): HarmonicSpectrum {
  const harmonics = Math.max(1, Math.min(128, Math.floor(finiteOr(count, 32))));
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  const values = normalizeDisplacements(samples);
  const n = values.length;
  if (n < 2) return { real, imag, energy: 0 };

  for (let k = 1; k <= harmonics; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * k * i) / n;
      const v = values[i]!;
      re += v * Math.cos(angle);
      im += v * Math.sin(angle);
    }
    real[k] = (2 / n) * re;
    imag[k] = (2 / n) * im;
  }

  let energy = 0;
  for (let k = 1; k <= harmonics; k++) energy += real[k]! * real[k]! + imag[k]! * imag[k]!;
  return { real, imag, energy };
}

/** 一阶低通再取平均，用来从曲线位移估计明暗（0..1）。 */
export function brightnessOf(displacements: readonly number[]): number {
  if (displacements.length === 0) return 0;
  let sum = 0;
  for (const v of displacements) sum += Math.abs(finiteOr(v, 0));
  return clamp(sum / displacements.length / 96, 0, 1);
}

/* ------------------------------------------------------------------ *
 * Karplus-Strong 拨弦缓冲
 * ------------------------------------------------------------------ */

export interface KsPluckOptions {
  freq: number;
  seconds?: number;
  sampleRate?: number;
  /** 0 = 闷，1 = 亮。 */
  brightness?: number;
  /** 固定种子，便于测试与缓存。 */
  seed?: number;
  /** v2.0：谱作为音色（初始激励/波表）。 */
  timbre?: { bands: readonly number[]; min?: number; max?: number; smooth?: boolean; loop?: boolean };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 把谱段采样成一个周期波形（v2.0.1 持续音色用）：0..1 归一化、去直流、峰值归一化。
 */
export function spectrumWaveSamples(
  bands: readonly number[],
  options: { min?: number; max?: number; smooth?: boolean; loop?: boolean } = {},
  count = 256,
): Float32Array {
  const out = new Float32Array(Math.max(8, Math.round(count)));
  if (bands.length < 2) return out;
  const min = finiteOr(options.min ?? 0, 0);
  const max = finiteOr(options.max ?? 1, 1);
  const span = max - min || 1;
  const smooth = options.smooth === true;
  const loop = options.loop === true;
  let mean = 0;
  for (let i = 0; i < out.length; i++) {
    let phase = i / out.length;
    if (loop) phase -= Math.floor(phase);
    else phase = clamp(phase, 0, 1);
    const at = phase * (bands.length - 1);
    const i0 = Math.floor(at);
    const i1 = Math.min(bands.length - 1, i0 + 1);
    let t = at - i0;
    if (smooth) t = (1 - Math.cos(Math.PI * t)) / 2;
    const a = (bands[i0]! - min) / span;
    const b = (bands[i1]! - min) / span;
    out[i] = a * (1 - t) + b * t;
    mean += out[i]!;
  }
  mean /= out.length;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = out[i]! - mean;
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  if (peak > 1e-6) {
    for (let i = 0; i < out.length; i++) out[i] = out[i]! / peak;
  } else {
    out.fill(0);
  }
  return out;
}

/**
 * Karplus-Strong：噪声激励 + 延迟线 + 低通反馈，最后叠一条指数衰减包络。
 * 返回长度 = round(seconds * sampleRate) 的缓冲；峰值归一化到 ~0.92，无 NaN。
 */
export function ksPluckBuffer(options: KsPluckOptions): Float32Array {
  const sampleRate = Math.max(8000, Math.round(finiteOr(options.sampleRate ?? 48000, 48000)));
  const seconds = clamp(finiteOr(options.seconds ?? 1.5, 1.5), 0.05, 8);
  const length = Math.max(8, Math.round(seconds * sampleRate));
  const freq = clamp(finiteOr(options.freq ?? 220, 220), 20, sampleRate / 2 - 1);
  const brightness = clamp(finiteOr(options.brightness ?? 0.5, 0.5), 0, 1);
  const seed = Math.round(finiteOr(options.seed ?? 1, 1));

  const delay = Math.max(2, Math.min(length - 2, Math.round(sampleRate / freq)));
  const out = new Float32Array(length);
  const random = mulberry32(seed * 2654435761 + Math.round(freq * 1000));

  // 激励：有谱音色时，用谱采样作为初始波形；否则用噪声。
  const timbre = options.timbre;
  const bands = timbre?.bands ?? [];
  if (timbre && bands.length >= 2) {
    const tMin = finiteOr(timbre.min ?? 0, 0);
    const tMax = finiteOr(timbre.max ?? 1, 1);
    const span = tMax - tMin || 1;
    const smooth = timbre.smooth === true;
    const loop = timbre.loop === true;
    const wave: number[] = [];
    let mean = 0;
    for (let i = 0; i < delay; i++) {
      let phase = i / delay;
      if (loop) phase = phase - Math.floor(phase);
      else phase = clamp(phase, 0, 1);
      const at = phase * (bands.length - 1);
      const i0 = Math.floor(at);
      const i1 = Math.min(bands.length - 1, i0 + 1);
      let t = at - i0;
      if (smooth) t = (1 - Math.cos(Math.PI * t)) / 2;
      const a = (bands[i0]! - tMin) / span;
      const b = (bands[i1]! - tMin) / span;
      const v = (loop ? a : a) * (1 - t) + b * t;
      wave.push(v);
      mean += v;
    }
    mean /= delay;
    let peak = 0;
    for (let i = 0; i < delay; i++) {
      wave[i] = wave[i]! - mean;
      peak = Math.max(peak, Math.abs(wave[i]!));
    }
    const scale = peak > 1e-6 ? 1 / peak : 0;
    for (let i = 0; i < delay; i++) out[i] = wave[i]! * scale;
  } else {
    // 激励噪声：亮度越高，低通越弱（高频越多）。
    const alpha = 0.28 + 0.55 * brightness;
    let smoothing = 0;
    for (let i = 0; i < delay; i++) {
      smoothing += alpha * (random() * 2 - 1 - smoothing);
      out[i] = smoothing;
    }
  }

  // 延迟线反馈：平均 + 轻微损耗。
  const loopGain = 0.9965 - (1 - brightness) * 0.01;
  for (let i = delay; i < length; i++) {
    const a = out[i - delay]!;
    const b = i - delay - 1 >= 0 ? out[i - delay - 1]! : a;
    out[i] = 0.5 * (a + b) * loopGain;
  }

  // 指数衰减包络（约 0.9s 内落下去），并做 1.5ms 起音淡入避免爆音。
  const tau = Math.max(0.08, seconds * 0.3);
  const fadeSamples = Math.max(1, Math.min(Math.floor(sampleRate * 0.0015), Math.floor(length / 8)));
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const envelope = Math.exp(-i / (sampleRate * tau)) * (i < fadeSamples ? i / fadeSamples : 1);
    const v = out[i]! * envelope;
    out[i] = v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }
  if (peak > 1e-9) {
    const scale = 0.92 / peak;
    for (let i = 0; i < length; i++) out[i] = out[i]! * scale;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 动效：拨弦波包 / 呼吸
 * ------------------------------------------------------------------ */

const PLUCK_LIFE = 1.05; // 秒

function gaussian(x: number, center: number, spread: number): number {
  const d = (x - center) / (spread || 1);
  return Math.exp(-d * d);
}

/**
 * 沿弦传播的拨弦小波包：两个波峰从拨点向左右传播并衰减，约 0.9s 内消失。
 * 初始最大位移 ≈ amplitude（10–16px）。
 */
export function pluckOffsetAt(packets: readonly PluckPacket[], x: number, now: number): number {
  let offset = 0;
  for (const p of packets) {
    const age = (finiteOr(now, 0) - p.at) / 1000;
    if (!(age >= 0) || age > PLUCK_LIFE) continue;
    const decay = Math.exp(-age / 0.32) * (1 - smoothstep(0.72, PLUCK_LIFE, age));
    if (decay <= 0.0005) continue;
    const spread = 30 + age * 150;
    const travel = age * 560;
    const bump = 0.5 * (gaussian(x, p.x - travel, spread) + gaussian(x, p.x + travel, spread));
    offset += p.sign * p.amplitude * decay * bump;
  }
  return offset;
}

/** 极慢的呼吸（≤1.2px），让弦永远不是死的。 */
export function breathOffsetAt(now: number, x = 0): number {
  const t = finiteOr(now, 0) / 1000;
  const base = 0.58 * Math.sin((Math.PI * 2 * t) / 8.5);
  const ripple = 0.24 * Math.sin((Math.PI * 2 * clamp(x, 0, WAVE_WIDTH)) / WAVE_WIDTH + t * 0.55 + 1.2);
  return base + ripple;
}

/* ------------------------------------------------------------------ *
 * 路径
 * ------------------------------------------------------------------ */

/** 采样点 → SVG 折线 path（数值保留 2 位小数，足够密所以视觉是丝滑的）。 */
export function samplesToPath(samples: readonly CurveSample[]): string {
  if (samples.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!;
    const x = Math.round(p.x * 100) / 100;
    const y = Math.round(p.y * 100) / 100;
    parts.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
  }
  return parts.join(' ');
}
