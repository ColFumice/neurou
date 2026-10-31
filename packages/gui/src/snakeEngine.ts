/**
 * v1.36：第二款 GameModule —— 贪吃蛇。
 *
 * 只实现规则与状态；60Hz 调度、输入队列、暂停、结果回传全部复用 Game SDK。
 */
import type { GameModule } from './gameSdk.js';

export type SnakeCommand = 'up' | 'down' | 'left' | 'right';

export interface SnakeCell {
  x: number;
  y: number;
}

export interface SnakeState {
  body: SnakeCell[];
  direction: SnakeCommand;
  pending: SnakeCommand | null;
  food: SnakeCell;
  score: number;
  eaten: number;
  over: boolean;
  rngState: number;
  moveAccumulator: number;
}

export const SNAKE_W = 24;
export const SNAKE_H = 18;

function nextRandom(state: number): { state: number; value: number } {
  let a = state >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

function opposite(a: SnakeCommand, b: SnakeCommand): boolean {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  );
}

function occupied(body: SnakeCell[], x: number, y: number): boolean {
  return body.some((cell) => cell.x === x && cell.y === y);
}

function spawnFood(state: SnakeState): void {
  for (let attempt = 0; attempt < SNAKE_W * SNAKE_H; attempt += 1) {
    const next = nextRandom(state.rngState);
    state.rngState = next.state;
    const x = Math.floor(next.value * SNAKE_W);
    const second = nextRandom(state.rngState);
    state.rngState = second.state;
    const y = Math.floor(second.value * SNAKE_H);
    if (!occupied(state.body, x, y)) {
      state.food = { x, y };
      return;
    }
  }
}

export function createSnake(seed = 1): SnakeState {
  const rngState = seed >>> 0 || 1;
  const state: SnakeState = {
    body: [
      { x: 8, y: 9 },
      { x: 7, y: 9 },
      { x: 6, y: 9 },
    ],
    direction: 'right',
    pending: null,
    food: { x: 14, y: 9 },
    score: 0,
    eaten: 0,
    over: false,
    rngState,
    moveAccumulator: 0,
  };
  spawnFood(state);
  return state;
}

export const SNAKE_MODULE: GameModule<SnakeState, SnakeCommand> = {
  id: 'snake',
  title: { zh: '贪吃蛇', en: 'Snake' },
  create: (seed) => createSnake(seed),
  step(state, command, fixedMs): void {
    if (state.over) return;
    if (command && !opposite(state.direction, command)) {
      state.pending = command;
    }
    state.moveAccumulator += fixedMs;
    const interval = Math.max(75, 180 - (snakeLevel(state) - 1) * 12);
    while (state.moveAccumulator >= interval && !state.over) {
      state.moveAccumulator -= interval;
      if (state.pending) {
        state.direction = state.pending;
        state.pending = null;
      }
      const head = state.body[0]!;
      const delta =
        state.direction === 'up'
          ? { x: 0, y: -1 }
          : state.direction === 'down'
            ? { x: 0, y: 1 }
            : state.direction === 'left'
              ? { x: -1, y: 0 }
              : { x: 1, y: 0 };
      const nextHead = { x: head.x + delta.x, y: head.y + delta.y };
      if (
        nextHead.x < 0 ||
        nextHead.x >= SNAKE_W ||
        nextHead.y < 0 ||
        nextHead.y >= SNAKE_H
      ) {
        state.over = true;
        return;
      }
      const eating = nextHead.x === state.food.x && nextHead.y === state.food.y;
      const bodyToCheck = eating ? state.body : state.body.slice(0, -1);
      if (occupied(bodyToCheck, nextHead.x, nextHead.y)) {
        state.over = true;
        return;
      }
      state.body.unshift(nextHead);
      if (eating) {
        state.score += 10;
        state.eaten += 1;
        spawnFood(state);
      } else {
        state.body.pop();
      }
    }
  },
  score: (state) => state.score,
  lines: (state) => state.eaten,
  level: (state) => snakeLevel(state),
  isOver: (state) => state.over,
  serialize(state) {
    return JSON.parse(JSON.stringify(state)) as unknown;
  },
  deserialize(data) {
    if (!data || typeof data !== 'object') return null;
    const candidate = data as Partial<SnakeState>;
    if (!Array.isArray(candidate.body) || candidate.body.length === 0) return null;
    if (!candidate.food || typeof candidate.food.x !== 'number' || typeof candidate.food.y !== 'number') return null;
    const directions: SnakeCommand[] = ['up', 'down', 'left', 'right'];
    if (!directions.includes(candidate.direction ?? 'up')) return null;
    const body = candidate.body.filter((cell) => cell && Number.isFinite(cell.x) && Number.isFinite(cell.y));
    if (body.length === 0) return null;
    const state = createSnake(Number(candidate.rngState) || 1);
    state.body = body;
    state.direction = candidate.direction ?? 'right';
    state.pending = candidate.pending ?? null;
    state.food = { x: candidate.food.x, y: candidate.food.y };
    state.score = Number(candidate.score) || 0;
    state.eaten = Number(candidate.eaten) || 0;
    state.over = Boolean(candidate.over);
    state.rngState = Number(candidate.rngState) || state.rngState;
    state.moveAccumulator = Number(candidate.moveAccumulator) || 0;
    return state;
  },
};

export function snakeLevel(state: SnakeState): number {
  return 1 + Math.floor(state.eaten / 5);
}

export function snakeInterval(state: SnakeState): number {
  return Math.max(75, 180 - (snakeLevel(state) - 1) * 12);
}
