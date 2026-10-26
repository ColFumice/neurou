import { describe, expect, it } from 'vitest';
import {
  WAVE_BASE_Y,
  WAVE_NOTES,
  WAVE_WIDTH,
  WAVE_X_MAX,
  WAVE_X_MIN,
  WAVE_Y_MAX,
  WAVE_Y_MIN,
  breathOffsetAt,
  curveYAt,
  displacementsToHarmonics,
  fitCurve,
  insertPoint,
  ksPluckBuffer,
  normalizeDisplacements,
  pitchForX,
  pluckOffsetAt,
  type PluckPacket,
  type WavePoint,
} from '../src/waveMath.js';

const CONTROL_POINTS: readonly WavePoint[] = [
  { x: 300, y: 780 },
  { x: 760, y: 800 },
  { x: 1120, y: 770 },
];

function rmsOf(buffer: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const value = buffer[i]!;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, to - from));
}

describe('基准弦：曲线几何', () => {
  it('插值穿过控制点，两端精确锚定在基准线上', () => {
    for (const point of CONTROL_POINTS) {
      expect(curveYAt(CONTROL_POINTS, point.x)).toBeCloseTo(point.y, 9);
    }
    // 1441 个采样 = 每像素一个采样点，控制点的 x 都落在网格上。
    const samples = fitCurve(CONTROL_POINTS, 1441, WAVE_BASE_Y);
    expect(samples).toHaveLength(1441);
    expect(samples[0]).toEqual({ x: 0, y: WAVE_BASE_Y });
    expect(samples[samples.length - 1]).toEqual({ x: WAVE_WIDTH, y: WAVE_BASE_Y });
    for (const point of CONTROL_POINTS) {
      const sample = samples[point.x]!;
      expect(sample.x).toBe(point.x);
      expect(sample.y).toBeCloseTo(point.y, 9);
    }
  });

  it('相邻控制点之间无过冲/抖动：采样值夹在两端 y 之间', () => {
    const points: readonly WavePoint[] = [
      { x: 240, y: 760 },
      { x: 620, y: 852 },
      { x: 980, y: 746 },
      { x: 1260, y: 830 },
    ];
    const knots: readonly WavePoint[] = [
      { x: 0, y: WAVE_BASE_Y },
      ...points,
      { x: WAVE_WIDTH, y: WAVE_BASE_Y },
    ];
    const samples = fitCurve(points, 2881, WAVE_BASE_Y);
    for (let k = 0; k < knots.length - 1; k++) {
      const left = knots[k]!;
      const right = knots[k + 1]!;
      const low = Math.min(left.y, right.y);
      const high = Math.max(left.y, right.y);
      const between = samples.filter((s) => s.x >= left.x && s.x <= right.x);
      expect(between.length).toBeGreaterThan(0);
      for (const sample of between) {
        expect(sample.y).toBeGreaterThanOrEqual(low - 1e-6);
        expect(sample.y).toBeLessThanOrEqual(high + 1e-6);
      }
    }
  });

  it('空控制点 = 一条水平基准线', () => {
    const samples = fitCurve([], 240, WAVE_BASE_Y);
    expect(samples).toHaveLength(240);
    expect(samples.every((s) => Math.abs(s.y - WAVE_BASE_Y) < 1e-9)).toBe(true);
    expect(curveYAt([], 720, WAVE_BASE_Y)).toBe(WAVE_BASE_Y);
  });

  it('insertPoint：18px 内合并（只改 y），远处插入并按 x 排序', () => {
    const points: readonly WavePoint[] = [{ x: 300, y: 800 }];
    const merged = insertPoint(points, 312, 760);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ x: 300, y: 760 });
    // 不修改入参
    expect(points).toEqual([{ x: 300, y: 800 }]);

    const added = insertPoint(points, 330, 810); // 30px > 18px
    expect(added).toHaveLength(2);
    expect(added.map((p) => p.x)).toEqual([300, 330]);

    const sorted = insertPoint(added, 100, 790);
    expect(sorted.map((p) => p.x)).toEqual([100, 300, 330]);
  });

  it('insertPoint 把 x/y 夹进活动范围', () => {
    const left = insertPoint([], -100, 100);
    expect(left[0]).toEqual({ x: WAVE_X_MIN, y: WAVE_Y_MIN });
    const right = insertPoint([], WAVE_WIDTH + 100, 2000);
    expect(right[0]).toEqual({ x: WAVE_X_MAX, y: WAVE_Y_MAX });
  });
});

describe('基准弦：音高映射', () => {
  it('五声音阶共 16 档，110Hz → 880Hz', () => {
    expect(WAVE_NOTES).toHaveLength(16);
    expect(WAVE_NOTES[0]).toBeCloseTo(110, 9);
    expect(WAVE_NOTES[15]).toBeCloseTo(880, 9);
  });

  it('音高随 x 单调非降，且范围在 [110, 880]', () => {
    let previous = 0;
    const degrees = new Set<number>();
    for (let x = 0; x <= WAVE_WIDTH; x += 4) {
      const { freq, degree } = pitchForX(x);
      expect(freq).toBeGreaterThanOrEqual(110 - 1e-9);
      expect(freq).toBeLessThanOrEqual(880 + 1e-9);
      expect(freq).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = freq;
      degrees.add(degree);
    }
    expect(degrees.size).toBe(16);
    expect(pitchForX(0).freq).toBeCloseTo(110, 9);
    expect(pitchForX(WAVE_WIDTH).freq).toBeCloseTo(880, 9);
    // 超出范围夹住
    expect(pitchForX(-50).freq).toBeCloseTo(110, 9);
    expect(pitchForX(WAVE_WIDTH + 80).freq).toBeCloseTo(880, 9);
    expect(pitchForX(0, 720).freq).toBeCloseTo(110, 9);
    expect(pitchForX(720, 720).freq).toBeCloseTo(880, 9);
  });
});

describe('基准弦：位移 → 谐波', () => {
  const shape = Array.from({ length: 240 }, (_, i) => 20 + 40 * Math.sin((i / 240) * Math.PI * 2));

  it('数组长度 = count + 1，DC 置 0，无 NaN/Infinity', () => {
    const harmonics = displacementsToHarmonics(shape, 32);
    expect(harmonics.real).toHaveLength(33);
    expect(harmonics.imag).toHaveLength(33);
    expect(harmonics.real[0]).toBe(0);
    expect(harmonics.imag[0]).toBe(0);
    for (let k = 0; k <= 32; k++) {
      expect(Number.isFinite(harmonics.real[k]!)).toBe(true);
      expect(Number.isFinite(harmonics.imag[k]!)).toBe(true);
    }
    expect(harmonics.energy).toBeGreaterThan(0);
  });

  it('归一化：放大与平移不改变谐波形状', () => {
    const base = displacementsToHarmonics(shape, 16);
    const transformed = displacementsToHarmonics(
      shape.map((value) => value * 3 - 17),
      16,
    );
    for (let k = 1; k <= 16; k++) {
      expect(transformed.real[k]!).toBeCloseTo(base.real[k]!, 5);
      expect(transformed.imag[k]!).toBeCloseTo(base.imag[k]!, 5);
    }
    expect(transformed.energy).toBeCloseTo(base.energy, 5);
  });

  it('静音曲线（全零/常数）没有谐波能量', () => {
    const silent = displacementsToHarmonics(new Array(240).fill(0), 32);
    expect(silent.energy).toBe(0);
    expect(Array.from(silent.real).every((v) => v === 0)).toBe(true);

    const flat = normalizeDisplacements(new Array(128).fill(838));
    expect(Array.from(flat).every((v) => v === 0)).toBe(true);
  });
});

describe('基准弦：normalizeDisplacements', () => {
  it('去均值并把峰值归一到 1', () => {
    const out = normalizeDisplacements([10, 20, 30, 40]);
    expect(Array.from(out)).toHaveLength(4);
    expect(out[0]).toBeCloseTo(-1, 6);
    expect(out[1]).toBeCloseTo(-1 / 3, 6);
    expect(out[2]).toBeCloseTo(1 / 3, 6);
    expect(out[3]).toBeCloseTo(1, 6);
    const mean = Array.from(out).reduce((acc, value) => acc + value, 0) / out.length;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
    expect(Math.max(...Array.from(out).map(Math.abs))).toBeCloseTo(1, 9);
  });

  it('空输入/非有限值也能安全处理', () => {
    expect(normalizeDisplacements([])).toHaveLength(0);
    const withNaN = normalizeDisplacements([Number.NaN, 5]);
    expect(Array.from(withNaN).every(Number.isFinite)).toBe(true);
  });
});

describe('基准弦：Karplus-Strong 拨弦缓冲', () => {
  const options = {
    freq: 440,
    seconds: 1.2,
    sampleRate: 48000,
    brightness: 0.7,
  } as const;

  it('长度正确、无 NaN、峰值受限', () => {
    const buffer = ksPluckBuffer(options);
    expect(buffer).toHaveLength(Math.round(options.seconds * options.sampleRate));
    let peak = 0;
    for (const value of buffer) {
      expect(Number.isFinite(value)).toBe(true);
      peak = Math.max(peak, Math.abs(value));
    }
    expect(peak).toBeLessThanOrEqual(0.93);
    expect(peak).toBeGreaterThan(0.5);
  });

  it('首尾能量递减（会衰减到静音）', () => {
    const buffer = ksPluckBuffer(options);
    const quarter = Math.floor(buffer.length / 4);
    const head = rmsOf(buffer, 0, quarter);
    const tail = rmsOf(buffer, buffer.length - quarter, buffer.length);
    expect(head).toBeGreaterThan(tail * 4);
    expect(tail).toBeLessThan(0.01);
  });

  it('相同参数产生相同缓冲（可缓存），不同音高不同缓冲', () => {
    const first = ksPluckBuffer(options);
    const second = ksPluckBuffer(options);
    expect(Array.from(second)).toEqual(Array.from(first));

    const low = ksPluckBuffer({ ...options, freq: 110 });
    expect(Array.from(low)).not.toEqual(Array.from(first));
  });
});

describe('基准弦：动效小函数', () => {
  it('拨弦波包约 0.9s 内衰减掉', () => {
    const packet: PluckPacket = { x: 700, at: 0, amplitude: 12, sign: -1 };
    expect(Math.abs(pluckOffsetAt([packet], 700, 0))).toBeCloseTo(12, 6);
    const late = Math.abs(pluckOffsetAt([packet], 700, 950));
    expect(late).toBeLessThan(0.5);
    expect(Math.abs(pluckOffsetAt([packet], 700, 2000))).toBe(0);
  });

  it('呼吸幅度小于 1.2px', () => {
    for (let t = 0; t < 20_000; t += 137) {
      expect(Math.abs(breathOffsetAt(t, 300))).toBeLessThanOrEqual(1.2);
    }
  });
});
