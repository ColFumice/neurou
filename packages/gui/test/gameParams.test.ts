import { describe, expect, it } from 'vitest';
import { clampDifficulty, clampWaves } from '../src/gameSdk.js';

describe('游戏参数范围', () => {
  it('难度限制在 1..5', () => {
    expect(clampDifficulty(0)).toBe(1);
    expect(clampDifficulty(3.4)).toBe(3);
    expect(clampDifficulty(9)).toBe(5);
    expect(clampDifficulty(undefined)).toBe(1);
  });

  it('波次限制在 1..10，默认 3', () => {
    expect(clampWaves(0)).toBe(1);
    expect(clampWaves(2)).toBe(2);
    expect(clampWaves(99)).toBe(10);
    expect(clampWaves(undefined)).toBe(3);
  });
});
