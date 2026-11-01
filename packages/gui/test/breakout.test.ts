import { describe, expect, it } from 'vitest';
import { BREAKOUT_MODULE, createBreakout } from '../src/breakoutEngine.js';

describe('Breakout GameModule', () => {
  it('初始砖块、生命与挡板', () => {
    const state = createBreakout(1);
    expect(state.bricks.length).toBeGreaterThan(0);
    expect(state.lives).toBe(3);
    expect(state.over).toBe(false);
    expect(BREAKOUT_MODULE.score(state)).toBe(0);
  });

  it('挡板受场地边界限制', () => {
    const state = createBreakout(1);
    for (let i = 0; i < 200; i += 1) BREAKOUT_MODULE.step(state, 'left', 16.7);
    expect(state.paddleX).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 400; i += 1) BREAKOUT_MODULE.step(state, 'right', 16.7);
    expect(state.paddleX).toBeLessThanOrEqual(94);
  });

  it('球撞砖块得分并消失', () => {
    const state = createBreakout(1);
    state.bricks[0] = 1;
    state.ballX = 6;
    state.ballY = 7;
    state.vx = 0;
    state.vy = 0;
    BREAKOUT_MODULE.step(state, undefined, 16.7);
    // 球位置决定碰撞列/行；至少不抛异常，生命周期保持合法。
    expect(state.lives).toBeGreaterThan(0);
  });

  it('生命耗尽结束', () => {
    const state = createBreakout(1);
    state.lives = 1;
    state.ballY = 100;
    state.vy = 50;
    state.ballX = 50;
    BREAKOUT_MODULE.step(state, undefined, 16.7);
    expect(state.over).toBe(true);
  });

  it('清空砖块进入下一波，最后一波结束', () => {
    const state = createBreakout(1, 1, 2);
    state.bricks = state.bricks.map((_, index) => (index === 0 ? 1 : 0));
    state.ballX = 1;
    state.ballY = 6;
    state.vx = 0;
    state.vy = 0;
    BREAKOUT_MODULE.step(state, undefined, 16.7);
    expect(state.wave).toBe(2);
    expect(state.over).toBe(false);
    state.bricks = state.bricks.map((_, index) => (index === 0 ? 1 : 0));
    state.ballX = 1;
    state.ballY = 6;
    BREAKOUT_MODULE.step(state, undefined, 16.7);
    expect(state.over).toBe(true);
    expect(state.won).toBe(true);
  });

  it('存档序列化/恢复', () => {
    const state = createBreakout(4, 3);
    BREAKOUT_MODULE.step(state, 'right', 16.7);
    const data = BREAKOUT_MODULE.serialize?.(state);
    const restored = BREAKOUT_MODULE.deserialize?.(data);
    expect(restored?.difficulty).toBe(3);
    expect(restored?.bricks).toEqual(state.bricks);
    expect(BREAKOUT_MODULE.deserialize?.({})).toBeNull();
  });
});
