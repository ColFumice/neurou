import { describe, expect, it } from 'vitest';
import { PONG_H, PONG_MODULE, createPong } from '../src/pongEngine.js';

describe('Pong GameModule', () => {
  it('初始球与球拍在场地内', () => {
    const state = createPong(1);
    expect(state.playerY).toBe(PONG_H / 2);
    expect(state.ballX).toBeGreaterThan(0);
    expect(state.ballY).toBeGreaterThan(0);
    expect(PONG_MODULE.isOver(state)).toBe(false);
  });

  it('上下移动球拍并受场地边界限制', () => {
    const state = createPong(1);
    const before = state.playerY;
    PONG_MODULE.step(state, 'up', 16.7);
    expect(state.playerY).toBeLessThan(before);
    for (let i = 0; i < 200; i += 1) PONG_MODULE.step(state, 'up', 16.7);
    expect(state.playerY).toBeGreaterThanOrEqual(7);
  });

  it('球触顶反弹', () => {
    const state = createPong(1);
    state.ballY = 2;
    state.vy = -50;
    PONG_MODULE.step(state, undefined, 16.7);
    expect(state.vy).toBeGreaterThan(0);
  });

  it('AI 得分达到 5 时结束', () => {
    const state = createPong(1);
    state.aiScore = 4;
    state.ballX = -10;
    PONG_MODULE.step(state, undefined, 16.7);
    expect(state.aiScore).toBe(5);
    expect(PONG_MODULE.isOver(state)).toBe(true);
  });

  it('存档序列化/恢复', () => {
    const state = createPong(9);
    PONG_MODULE.step(state, 'down', 16.7);
    const data = PONG_MODULE.serialize?.(state);
    const restored = PONG_MODULE.deserialize?.(data);
    expect(restored).toBeTruthy();
    expect(restored?.ballX).toBeCloseTo(state.ballX);
    expect(restored?.playerY).toBeCloseTo(state.playerY);
    expect(PONG_MODULE.deserialize?.({})).toBeNull();
  });
});
