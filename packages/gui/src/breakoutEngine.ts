/**
 * v1.43：第四款 GameModule —— 打砖块。
 * 继续验证 GameHost：只写规则 + draw + commandFor。
 */
import type { GameModule } from './gameSdk.js';

export type BreakoutCommand = 'left' | 'right';

export interface BreakoutState {
  paddleX: number;
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  bricks: number[];
  lives: number;
  score: number;
  over: boolean;
  won: boolean;
  difficulty: number;
  wave: number;
  maxWaves: number;
}

export const BREAKOUT_W = 100;
export const BREAKOUT_H = 70;
export const BRICK_COLS = 8;
export const BRICK_ROWS = 5;
const PADDLE_HALF = 6;
const BALL_RADIUS = 1.3;
const BRICK_W = BREAKOUT_W / BRICK_COLS;
const BRICK_H = 4;

export function createBreakout(seed = 1, difficulty = 1, maxWaves = 3): BreakoutState {
  const state: BreakoutState = {
    paddleX: BREAKOUT_W / 2,
    ballX: BREAKOUT_W / 2,
    ballY: BREAKOUT_H - 14,
    vx: 38 + difficulty * 4,
    vy: -(44 + difficulty * 5),
    bricks: Array.from({ length: BRICK_COLS * BRICK_ROWS }, () => 1),
    lives: 3,
    score: 0,
    over: false,
    won: false,
    difficulty: Math.max(1, Math.min(5, difficulty)),
    wave: 1,
    maxWaves: Math.max(1, Math.min(10, maxWaves)),
  };
  // 少量随机缺口，避免完全机械。
  let rng = seed >>> 0 || 1;
  for (let index = 0; index < 4; index += 1) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    state.bricks[(rng >>> 0) % state.bricks.length] = 0;
  }
  return state;
}

function resetBall(state: BreakoutState): void {
  state.ballX = state.paddleX;
  state.ballY = BREAKOUT_H - 14;
  state.vx = (38 + state.difficulty * 4) * (state.ballX < BREAKOUT_W / 2 ? 1 : -1);
  state.vy = -(44 + state.difficulty * 5);
}

export const BREAKOUT_MODULE: GameModule<BreakoutState, BreakoutCommand> = {
  id: 'breakout',
  title: { zh: '打砖块', en: 'Breakout' },
  create: (seed, params) => createBreakout(seed, params?.difficulty ?? 1, params?.waves ?? 3),
  step(state, command, fixedMs): void {
    if (state.over) return;
    const dt = Math.min(0.05, fixedMs / 1000);
    if (command === 'left') state.paddleX -= 76 * dt;
    if (command === 'right') state.paddleX += 76 * dt;
    state.paddleX = Math.max(PADDLE_HALF, Math.min(BREAKOUT_W - PADDLE_HALF, state.paddleX));

    state.ballX += state.vx * dt;
    state.ballY += state.vy * dt;
    if (state.ballX < BALL_RADIUS) {
      state.ballX = BALL_RADIUS;
      state.vx = Math.abs(state.vx);
    } else if (state.ballX > BREAKOUT_W - BALL_RADIUS) {
      state.ballX = BREAKOUT_W - BALL_RADIUS;
      state.vx = -Math.abs(state.vx);
    }
    if (state.ballY < BALL_RADIUS) {
      state.ballY = BALL_RADIUS;
      state.vy = Math.abs(state.vy);
    }

    // 挡板
    if (state.ballY >= BREAKOUT_H - 9 && state.ballY <= BREAKOUT_H - 5 && state.vy > 0) {
      if (Math.abs(state.ballX - state.paddleX) <= PADDLE_HALF + 2) {
        state.ballY = BREAKOUT_H - 9.1;
        state.vy = -Math.abs(state.vy);
        state.vx += ((state.ballX - state.paddleX) / PADDLE_HALF) * 18;
        state.vx = Math.max(-65, Math.min(65, state.vx));
      }
    }

    // 砖块
    if (state.ballY < 8 + BRICK_ROWS * BRICK_H) {
      const col = Math.floor(state.ballX / BRICK_W);
      const row = Math.floor((state.ballY - 5) / BRICK_H);
      if (col >= 0 && col < BRICK_COLS && row >= 0 && row < BRICK_ROWS) {
        const index = row * BRICK_COLS + col;
        if (state.bricks[index]) {
          state.bricks[index] = 0;
          state.score += 10;
          state.vy = -state.vy;
          if (state.bricks.every((brick) => brick === 0)) {
            state.score += 25;
            if (state.wave < state.maxWaves) {
              state.wave += 1;
              state.bricks = state.bricks.map((_, index) => ((index + state.wave) % 7 === 0 ? 0 : 1));
              resetBall(state);
              state.vx *= 1 + (state.wave - 1) * 0.08;
              state.vy *= 1 + (state.wave - 1) * 0.08;
            } else {
              state.won = true;
              state.over = true;
            }
          }
        }
      }
    }

    if (state.ballY > BREAKOUT_H + 3) {
      state.lives -= 1;
      if (state.lives <= 0) {
        state.over = true;
      } else {
        resetBall(state);
      }
    }
  },
  score: (state) => state.score,
  lines: (state) => state.bricks.filter((brick) => brick === 0).length,
  level: (state) => 1,
  wave: (state) => state.wave,
  isOver: (state) => state.over,
  serialize: (state) => ({ ...state, bricks: [...state.bricks] }),
  deserialize(data): BreakoutState | null {
    if (!data || typeof data !== 'object') return null;
    const candidate = data as Partial<BreakoutState>;
    if (!Array.isArray(candidate.bricks)) return null;
    const state = createBreakout(1);
    state.paddleX = Number(candidate.paddleX) || state.paddleX;
    state.ballX = Number(candidate.ballX) || state.ballX;
    state.ballY = Number(candidate.ballY) || state.ballY;
    state.vx = Number(candidate.vx) || state.vx;
    state.vy = Number(candidate.vy) || state.vy;
    state.bricks = candidate.bricks.map((brick) => (brick ? 1 : 0));
    state.lives = Number(candidate.lives) || 3;
    state.score = Number(candidate.score) || 0;
    state.over = Boolean(candidate.over);
    state.won = Boolean(candidate.won);
    state.difficulty = Math.max(1, Math.min(5, Number(candidate.difficulty) || 1));
    state.wave = Math.max(1, Number(candidate.wave) || 1);
    state.maxWaves = Math.max(state.wave, Math.min(10, Number(candidate.maxWaves) || 3));
    return state;
  },
};
