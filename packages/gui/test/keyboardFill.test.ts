import { describe, expect, it } from 'vitest';
import { layoutKeyboard } from '../src/stringMath.js';

describe('持续弦全屏键盘映射（v1.3）', () => {
  it('46 键横向铺满、四行纵向铺满', () => {
    const keys = layoutKeyboard(1000, 1000, true);
    expect(keys).toHaveLength(46);
    expect(Math.min(...keys.map((key) => key.cx))).toBeLessThan(80);
    expect(Math.max(...keys.map((key) => key.cx))).toBeGreaterThan(920);
    expect(Math.min(...keys.map((key) => key.cy))).toBeLessThan(180);
    expect(Math.max(...keys.map((key) => key.cy))).toBeGreaterThan(820);
    expect(Math.min(...keys.map((key) => key.y))).toBe(0);
    expect(Math.max(...keys.map((key) => key.y + key.h))).toBeCloseTo(1000, 5);
  });
});
