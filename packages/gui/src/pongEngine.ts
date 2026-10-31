/**
 * v1.40：第三款 GameModule —— 乒乓。
 * 只写规则；Canvas/60Hz/输入/暂停/存档/结果全部由 GameHost 提供。
 */
import type { GameModule } from './gameSdk.js';

export type PongCommand = 'up' | 'down';

export interface PongState {
  playerY: number;
  aiY: number;
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  playerScore: number;
  aiScore: number;
  over: boolean;
  rngState: number;
}

export const PONG_W = 120;
export const PONG_H = 70;
export const PONG_TARGET = 5;

const PADDLE_HALF = 7;
const PLAYER_X = 4;
const AI_X = PONG_W - 4;

function nextRandom(state: number): { state: number; value: number } {
  let a = state >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

function serve(state: PongState, towardPlayer: boolean): void {
  const random = nextRandom(state.rngState);
  state.rngState = random.state;
  state.ballX = PONG_W / 2;
  state.ballY = PONG_H / 2 + (random.value - 0.5) * 16;
  state.vx = towardPlayer ? -58 : 58;
  state.vy = (random.value - 0.5) * 46;
}

export function createPong(seed = 1): PongState {
  const state: PongState = {
    playerY: PONG_H / 2,
    aiY: PONG_H / 2,
    ballX: PONG_W / 2,
    ballY: PONG_H / 2,
    vx: 58,
    vy: 12,
    playerScore: 0,
    aiScore: 0,
    over: false,
    rngState: seed >>> 0 || 1,
  };
  serve(state, false);
  return state;
}

export const PONG_MODULE: GameModule<PongState, PongCommand> = {
  id: 'pong',
  title: { zh: '乒乓', en: 'Pong' },
  create: (seed) => createPong(seed),
  step(state, command, fixedMs): void {
    if (state.over) return;
    const dt = Math.min(0.05, fixedMs / 1000);
    if (command === 'up') state.playerY -= 62 * dt;
    if (command === 'down') state.playerY += 62 * dt;
    state.playerY = Math.max(PADDLE_HALF, Math.min(PONG_H - PADDLE_HALF, state.playerY));

    // AI 跟随球，但速度有限。
    const target = state.ballY;
    const delta = target - state.aiY;
    state.aiY += Math.max(-42 * dt, Math.min(42 * dt, delta));
    state.aiY = Math.max(PADDLE_HALF, Math.min(PONG_H - PADDLE_HALF, state.aiY));

    state.ballX += state.vx * dt;
    state.ballY += state.vy * dt;
    if (state.ballY < 1.5) {
      state.ballY = 1.5;
      state.vy = Math.abs(state.vy);
    } else if (state.ballY > PONG_H - 1.5) {
      state.ballY = PONG_H - 1.5;
      state.vy = -Math.abs(state.vy);
    }

    const hitPaddle = (x: number, y: number, paddleY: number): boolean =>
      Math.abs(x - state.ballX) < 2 && Math.abs(y - state.ballY) < PADDLE_HALF + 1.5;

    if (state.vx < 0 && state.ballX <= PLAYER_X + 2 && hitPaddle(PLAYER_X, state.playerY, state.playerY)) {
      state.ballX = PLAYER_X + 2.1;
      state.vx = Math.abs(state.vx) * 1.03;
      state.vy += ((state.ballY - state.playerY) / PADDLE_HALF) * 28;
      state.vy = Math.max(-68, Math.min(68, state.vy));
    } else if (state.vx > 0 && state.ballX >= AI_X - 2 && hitPaddle(AI_X, state.aiY, state.aiY)) {
      state.ballX = AI_X - 2.1;
      state.vx = -Math.abs(state.vx) * 1.03;
      state.vy += ((state.ballY - state.aiY) / PADDLE_HALF) * 20;
      state.vy = Math.max(-68, Math.min(68, state.vy));
    }

    if (state.ballX < -2) {
      state.aiScore += 1;
      if (state.aiScore >= PONG_TARGET) state.over = true;
      else serve(state, false);
    } else if (state.ballX > PONG_W + 2) {
      state.playerScore += 1;
      if (state.playerScore >= PONG_TARGET) state.over = true;
      else serve(state, true);
    }
  },
  score: (state) => state.playerScore * 100 - state.aiScore * 10,
  lines: (state) => state.playerScore,
  level: (state) => 1,
  isOver: (state) => state.over,
  serialize: (state) => ({ ...state }),
  deserialize(data): PongState | null {
    if (!data || typeof data !== 'object') return null;
    const candidate = data as Partial<PongState>;
    if (!Number.isFinite(candidate.ballX) || !Number.isFinite(candidate.ballY)) return null;
    const state = createPong(1);
    state.playerY = Number(candidate.playerY) || state.playerY;
    state.aiY = Number(candidate.aiY) || state.aiY;
    state.ballX = Number(candidate.ballX) || state.ballX;
    state.ballY = Number(candidate.ballY) || state.ballY;
    state.vx = Number(candidate.vx) || state.vx;
    state.vy = Number(candidate.vy) || state.vy;
    state.playerScore = Number(candidate.playerScore) || 0;
    state.aiScore = Number(candidate.aiScore) || 0;
    state.over = Boolean(candidate.over);
    state.rngState = Number(candidate.rngState) || state.rngState;
    return state;
  },
};
