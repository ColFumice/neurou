import { describe, expect, it } from 'vitest';
import { ksPluckBuffer } from '../src/waveMath.js';

const base = { freq: 220, seconds: 0.25, sampleRate: 8000, seed: 7 };

describe('ksPluckBuffer：谱音色激励', () => {
  it('带 timbre 的缓冲：有限、归一化、确定性', () => {
    const a = ksPluckBuffer({
      ...base,
      timbre: { bands: [0, 1, 0.2, 0.8], min: 0, max: 1, smooth: true, loop: true },
    });
    const b = ksPluckBuffer({
      ...base,
      timbre: { bands: [0, 1, 0.2, 0.8], min: 0, max: 1, smooth: true, loop: true },
    });
    expect(a).toHaveLength(b.length);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const value of a) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...a.map(Math.abs))).toBeGreaterThan(0.5);
  });

  it('不同谱给出不同波形；无 timbre 仍是原噪声路径', () => {
    const one = ksPluckBuffer({
      ...base,
      timbre: { bands: [0, 1, 0], min: 0, max: 1, smooth: false, loop: true },
    });
    const two = ksPluckBuffer({
      ...base,
      timbre: { bands: [1, 0, 0.5], min: 0, max: 1, smooth: false, loop: true },
    });
    expect(Array.from(one)).not.toEqual(Array.from(two));
    const noise = ksPluckBuffer(base);
    expect(Array.from(noise)).not.toEqual(Array.from(one));
  });
});
