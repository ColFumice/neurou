import { describe, expect, it } from 'vitest';
import {
  SNAKE_H,
  SNAKE_MODULE,
  SNAKE_W,
  createSnake,
  snakeInterval,
  snakeLevel,
} from '../src/snakeEngine.js';

describe('Snake GameModule', () => {
  it('初始蛇长度 3，食物不在蛇身上', () => {
    const state = createSnake(1);
    expect(state.body).toHaveLength(3);
    expect(state.food.x).toBeGreaterThanOrEqual(0);
    expect(state.food.x).toBeLessThan(SNAKE_W);
    expect(state.food.y).toBeGreaterThanOrEqual(0);
    expect(state.food.y).toBeLessThan(SNAKE_H);
    expect(state.body.some((cell) => cell.x === state.food.x && cell.y === state.food.y)).toBe(false);
  });

  it('向右移动，按固定步长推进', () => {
    const state = createSnake(1);
    const headBefore = { ...state.body[0]! };
    for (let i = 0; i < 20; i += 1) SNAKE_MODULE.step(state, undefined, 16.7);
    expect(state.body[0]!.x).toBeGreaterThan(headBefore.x);
    expect(state.over).toBe(false);
  });

  it('向左转向会被忽略（不能 180 度）', () => {
    const state = createSnake(1);
    SNAKE_MODULE.step(state, 'left', 16.7);
    expect(state.direction).toBe('right');
    expect(state.pending).toBeNull();
  });

  it('撞墙或撞自己会结束', () => {
    const state = createSnake(1);
    state.body = [{ x: SNAKE_W - 1, y: 0 }];
    state.direction = 'right';
    SNAKE_MODULE.step(state, undefined, 200);
    expect(state.over).toBe(true);

    const second = createSnake(1);
    second.body = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 5 },
      { x: 4, y: 4 },
    ];
    second.direction = 'up';
    second.pending = 'left';
    SNAKE_MODULE.step(second, undefined, 200);
    expect(second.over).toBe(true);
  });

  it('相同 seed 的初始状态完全一致', () => {
    const a = createSnake(42);
    const b = createSnake(42);
    expect(a).toEqual(b);
    expect(snakeLevel(a)).toBe(1);
    expect(snakeInterval(a)).toBe(180);
  });
});
