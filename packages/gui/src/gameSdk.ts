/**
 * v1.35：Game SDK v1。
 *
 * 把俄罗斯方块里已经验证过的实时能力抽成可复用的宿主契约：
 *   - 固定步长主循环；
 *   - 输入队列；
 *   - 开始 / 暂停 / 继续；
 *   - 结果只回传一次；
 *   - 快照 / 恢复；
 *   - 游戏模块注册。
 *
 * 渲染仍由各场景负责；SDK 只统一“时间、输入、生命周期、结果”。
 */
import type { IRGame } from '@neurou/core';
import { FixedStepLoop } from './gameLoop.js';
import { TetrisEngine, type TetrisAction } from './tetrisEngine.js';
import { SNAKE_MODULE, type SnakeCommand } from './snakeEngine.js';
import { PONG_MODULE } from './pongEngine.js';
import { BREAKOUT_MODULE } from './breakoutEngine.js';

export type GameReason = 'over' | 'exit';

export interface GameResult {
  score: number;
  lines: number;
  level: number;
  reason: GameReason;
}

/**
 * 一个游戏模块只需要提供：
 *   - create(seed)：新局状态；
 *   - step(state, command, fixedMs)：每个固定步；
 *   - score/lines/level/over：结果读取。
 */
export function clampDifficulty(value: number | undefined): number {
  return Math.max(1, Math.min(5, Math.round(Number(value) || 1)));
}

export function clampWaves(value: number | undefined): number {
  if (value === undefined) return 3;
  return Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
}

export interface GameParams {
  waves?: number;
  difficulty?: number;
}

export interface GameModule<TState, TCommand> {
  id: string;
  title: { zh: string; en: string };
  create(seed: number, params?: GameParams): TState;
  step(state: TState, command: TCommand | undefined, fixedMs: number): void;
  score(state: TState): number;
  lines(state: TState): number;
  level(state: TState): number;
  isOver(state: TState): boolean;
  /** 当前波次/关卡；用于 GameHost 统一 HUD。 */
  wave?(state: TState): number;
  /** v1.39：会话存档；未提供则只存内存。 */
  serialize?(state: TState): unknown;
  deserialize?(data: unknown): TState | null;
}

export interface GameSave {
  moduleId: string;
  tick: number;
  state: unknown;
}

export interface GameSessionSnapshot<TState> {
  tick: number;
  paused: boolean;
  pending: number;
  state: TState;
}

/** 输入/暂停/结果统一会话。场景只负责渲染与按键映射。 */
export class GameSession<TState, TCommand> {
  readonly module: GameModule<TState, TCommand>;
  readonly loop: FixedStepLoop<TCommand>;
  state: TState;
  private started = false;
  private resultSent = false;

  constructor(module: GameModule<TState, TCommand>, seed = 1) {
    this.module = module;
    this.loop = new FixedStepLoop<TCommand>({ stepMs: 1000 / 60 });
    this.state = module.create(seed);
  }

  get isStarted(): boolean {
    return this.started;
  }

  get isPaused(): boolean {
    return this.loop.isPaused;
  }

  start(seed: number, params?: GameParams): void {
    this.state = this.module.create(seed, params);
    this.loop.clearInputs();
    this.loop.resetTick();
    this.loop.resetAccumulator();
    this.loop.resume();
    this.started = true;
    this.resultSent = false;
  }

  input(command: TCommand): void {
    if (!this.started) return;
    this.loop.enqueue(command);
  }

  pause(): void {
    this.loop.pause();
  }

  resume(): void {
    this.loop.resume();
  }

  togglePause(): boolean {
    return this.loop.togglePause();
  }

  /** 推进真实时间；返回实际步数。 */
  advance(deltaMs: number): number {
    if (!this.started) return 0;
    return this.loop.advance(deltaMs, (command) => {
      this.module.step(this.state, command, this.loop.stepMs);
    }).steps;
  }

  finish(reason: GameReason): GameResult | null {
    if (!this.started || this.resultSent) return null;
    this.resultSent = true;
    return {
      score: this.module.score(this.state),
      lines: this.module.lines(this.state),
      level: this.module.level(this.state),
      reason,
    };
  }

  snapshot(): GameSessionSnapshot<TState> {
    return {
      tick: this.loop.tick,
      paused: this.loop.isPaused,
      pending: this.loop.pendingInputs,
      state: this.state,
    };
  }

  /** 保存当前局；未开始/已结束不可续。 */
  save(): GameSave | null {
    if (!this.started || this.module.isOver(this.state)) return null;
    const state = this.module.serialize ? this.module.serialize(this.state) : this.state;
    return { moduleId: this.module.id, tick: this.loop.tick, state };
  }

  /** 恢复存档；模块不匹配或状态损坏返回 false。 */
  restore(save: unknown): boolean {
    if (!save || typeof save !== 'object') return false;
    const payload = save as Partial<GameSave>;
    if (payload.moduleId !== this.module.id || !this.module.deserialize) return false;
    const state = this.module.deserialize(payload.state);
    if (!state) return false;
    this.state = state;
    this.started = true;
    this.resultSent = false;
    this.loop.clearInputs();
    this.loop.resetAccumulator();
    this.loop.setTick(typeof payload.tick === 'number' ? payload.tick : 0);
    this.loop.pause();
    return true;
  }
}

/** 俄罗斯方块模块状态：引擎 + 重力累积。 */
export interface TetrisModuleState {
  difficulty?: number;
  engine: TetrisEngine;
  gravityAccumulator: number;
}

export const TETRIS_MODULE: GameModule<TetrisModuleState, TetrisAction> = {
  id: 'tetris',
  title: { zh: '俄罗斯方块', en: 'Tetris' },
  create(seed: number, params?: GameParams): TetrisModuleState {
    return { engine: new TetrisEngine(seed), gravityAccumulator: 0, difficulty: params?.difficulty ?? 1 };
  },
  step(state, command, fixedMs): void {
    const engine = state.engine;
    if (engine.isOver) return;
    if (command) engine.apply(command);
    state.gravityAccumulator += fixedMs;
    const interval = Math.max(70, engine.gravityMs - (Math.max(1, state.difficulty ?? 1) - 1) * 70);
    if (state.gravityAccumulator >= interval) {
      state.gravityAccumulator = 0;
      engine.tick();
    }
  },
  score: (state) => state.engine.scoreValue,
  lines: (state) => state.engine.linesValue,
  level: (state) => state.engine.levelValue,
  wave: (state) => state.engine.levelValue,
  isOver: (state) => state.engine.isOver,
  serialize(state) {
    return { engine: state.engine.snapshot, gravityAccumulator: state.gravityAccumulator, difficulty: state.difficulty ?? 1 };
  },
  deserialize(data) {
    if (!data || typeof data !== 'object') return null;
    const payload = data as { engine?: { board?: unknown }; gravityAccumulator?: number };
    if (!payload.engine || !Array.isArray(payload.engine.board)) return null;
    const engine = new TetrisEngine(1);
    try {
      engine.load(payload.engine as Parameters<TetrisEngine['load']>[0]);
    } catch {
      return null;
    }
    return { engine, gravityAccumulator: Number(payload.gravityAccumulator) || 0, difficulty: Math.max(1, Math.min(5, Number((payload as { difficulty?: number }).difficulty) || 1)) };
  },
};

export interface GameModuleInfo {
  id: string;
  /** 与 `游戏 模块` 字段对齐。 */
  moduleName: string;
  title: { zh: string; en: string };
  description: { zh: string; en: string };
  controls: { zh: string; en: string };
}

/** v1.35：已注册的游戏模块；`游戏 模块 名字` 必须命中这里。 */
export const GAME_MODULES: readonly GameModuleInfo[] = [
  {
    id: 'tetris',
    moduleName: '俄罗斯方块',
    title: TETRIS_MODULE.title,
    description: { zh: '七种方块、消行与计分。', en: 'Seven pieces, line clears, score.' },
    controls: { zh: '← → 移动 · ↑ 旋转 · ↓ 软降 · Space 硬降', en: '← → move · ↑ rotate · ↓ soft · Space hard' },
  },
  {
    id: 'snake',
    moduleName: '贪吃蛇',
    title: SNAKE_MODULE.title,
    description: { zh: '转向吃食物，撞墙或撞自己结束。', en: 'Eat, avoid walls and yourself.' },
    controls: { zh: '方向键 / WASD 转向', en: 'Arrows / WASD' },
  },
  {
    id: 'pong',
    moduleName: '乒乓',
    title: PONG_MODULE.title,
    description: { zh: '上下移动球拍，先到 5 分获胜。', en: 'Move the paddle, first to five.' },
    controls: { zh: '↑/↓ 或 W/S 移动球拍', en: '↑/↓ or W/S' },
  },
  {
    id: 'breakout',
    moduleName: '打砖块',
    title: BREAKOUT_MODULE.title,
    description: { zh: '左右移动挡板，消完砖块。', en: 'Move the paddle, clear all bricks.' },
    controls: { zh: '← → 移动挡板', en: '← → paddle' },
  },
];

export function gameModuleForName(name: string): GameModuleInfo | undefined {
  return GAME_MODULES.find((item) => item.moduleName === name || item.id === name);
}

/**
 * 多游戏选择：
 *   1. 优先结果弦正好是当前弦的游戏；
 *   2. 其次当前弦类型的游戏（按结果弦类型）；
 *   3. 最后回退第一个游戏。
 */
export function selectGameForFocus(
  games: readonly IRGame[] | undefined,
  focus: { id: string; name: string; kind: string },
): IRGame | undefined {
  if (!games || games.length === 0) return undefined;
  return (
    games.find((game) => game.resultStringId === focus.id) ??
    games.find((game) => game.resultString === focus.name) ??
    games[0]
  );
}
