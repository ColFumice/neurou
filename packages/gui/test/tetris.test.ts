import { describe, expect, it } from 'vitest';
import {
  BOARD_H,
  BOARD_W,
  TetrisEngine,
  clearFullLines,
  createBoard,
  nextRandom,
  pieceColorIndex,
  rotateMatrix,
  shapeFor,
} from '../src/tetrisEngine.js';
import { commandForKey } from '../src/tetrisInput.js';

describe('TetrisEngine', () => {
  it('生成 10×20 空棋盘与当前方块', () => {
    const engine = new TetrisEngine(42);
    expect(engine.boardState).toHaveLength(BOARD_H);
    expect(engine.boardState[0]).toHaveLength(BOARD_W);
    expect(engine.activePiece).not.toBeNull();
    expect(engine.boardState.flat().every((cell) => cell === 0)).toBe(true);
  });

  it('硬降锁定到底部并产生分数', () => {
    const engine = new TetrisEngine(7);
    engine.apply('hardDrop');
    expect(engine.scoreValue).toBeGreaterThan(0);
    expect(engine.boardState.flat().some((cell) => cell !== 0)).toBe(true);
    expect(engine.activePiece).not.toBeNull();
  });

  it('左右移动与旋转受墙/碰撞限制', () => {
    const engine = new TetrisEngine(9);
    for (let i = 0; i < 20; i += 1) engine.apply('left');
    const left = engine.activePiece!;
    expect(left.x).toBeGreaterThanOrEqual(0);
    expect(engine.apply('rotateCW')).toBeTypeOf('boolean');
  });

  it('相同 seed + 相同输入序列完全确定', () => {
    const a = new TetrisEngine(123);
    const b = new TetrisEngine(123);
    const actions = ['hardDrop', 'left', 'hardDrop', 'rotateCW', 'hardDrop'] as const;
    for (const action of actions) {
      a.apply(action);
      b.apply(action);
    }
    expect(a.snapshot).toEqual(b.snapshot);
  });

  it('消行纯函数从底部移除满行并补空行', () => {
    const board = createBoard();
    board[BOARD_H - 1] = new Array<number>(BOARD_W).fill(1);
    board[BOARD_H - 2] = new Array<number>(BOARD_W).fill(2);
    const result = clearFullLines(board);
    expect(result.cleared).toBe(2);
    expect(result.board).toHaveLength(BOARD_H);
    expect(result.board[0]!.every((cell) => cell === 0)).toBe(true);
    expect(result.board[BOARD_H - 1]!.every((cell) => cell === 0)).toBe(true);
  });

  it('消行计分并更新行数', () => {
    const engine = new TetrisEngine(5);
    engine.apply('hardDrop');
    expect(engine.linesValue).toBeGreaterThanOrEqual(0);
    expect(engine.scoreValue).toBeGreaterThan(0);
  });

  it('7-bag 首个 bag 的 7 个方块种类不重复', () => {
    const engine = new TetrisEngine(11);
    const seen = new Set<string>();
    seen.add(engine.activePiece!.kind);
    for (let i = 0; i < 6; i += 1) {
      engine.apply('hardDrop');
      seen.add(engine.activePiece!.kind);
    }
    expect(seen.size).toBe(7);
  });

  it('连续硬降最终进入 game over 且 reset 清空', () => {
    const engine = new TetrisEngine(3);
    for (let i = 0; i < 200 && !engine.isOver; i += 1) engine.apply('hardDrop');
    expect(engine.isOver).toBe(true);
    engine.reset(3);
    expect(engine.isOver).toBe(false);
    expect(engine.scoreValue).toBe(0);
    expect(engine.linesValue).toBe(0);
    expect(engine.boardState.flat().every((cell) => cell === 0)).toBe(true);
  });

  it('快照 load 可恢复完全相同的状态', () => {
    const engine = new TetrisEngine(77);
    engine.apply('left');
    engine.apply('hardDrop');
    engine.tick();
    const snapshot = engine.snapshot;
    const restored = new TetrisEngine(1);
    restored.load(snapshot);
    expect(restored.snapshot).toEqual(snapshot);
  });

  it('固定 60Hz 推进 10 秒不超时', () => {
    const engine = new TetrisEngine(19);
    const started = performance.now();
    for (let i = 0; i < 600; i += 1) engine.tick();
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('随机动作 fuzz：棋盘/方块始终在合法范围', () => {
    let rng = 123456789;
    const rand = (): number => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return rng / 4294967296;
    };
    const actions = ['left', 'right', 'rotateCW', 'rotateCCW', 'softDrop', 'hardDrop'] as const;
    for (const seed of [1, 2, 3, 99]) {
      const engine = new TetrisEngine(seed);
      for (let i = 0; i < 400; i += 1) {
        engine.apply(actions[Math.floor(rand() * actions.length)]!);
        const snap = engine.snapshot;
        expect(snap.board).toHaveLength(BOARD_H);
        for (const row of snap.board) {
          expect(row).toHaveLength(BOARD_W);
          expect(row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 7)).toBe(true);
        }
        if (snap.active) {
          expect(snap.active.x).toBeGreaterThanOrEqual(-1);
          expect(snap.active.x).toBeLessThanOrEqual(BOARD_W);
          expect(snap.active.y).toBeGreaterThanOrEqual(-1);
          expect(snap.active.y).toBeLessThanOrEqual(BOARD_H);
        }
        expect(snap.score).toBeGreaterThanOrEqual(0);
        expect(snap.lines).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('旋转矩阵保持尺寸并旋转 4 次回原形', () => {
    const shape = shapeFor('T', 0);
    let rotated = shape;
    for (let i = 0; i < 4; i += 1) rotated = rotateMatrix(rotated);
    expect(rotated).toEqual(shape);
    expect(pieceColorIndex('I')).toBe(1);
  });

  it('PRNG 状态确定且值在 0..1', () => {
    const a = nextRandom(1);
    const b = nextRandom(1);
    expect(a).toEqual(b);
    expect(a.value).toBeGreaterThanOrEqual(0);
    expect(a.value).toBeLessThan(1);
  });
});

describe('tetrisInput', () => {
  it('映射游戏键并忽略方向键 repeat', () => {
    expect(commandForKey('ArrowLeft', false)).toBe('left');
    expect(commandForKey('ArrowLeft', true)).toBeNull();
    expect(commandForKey('Space', false)).toBe('hardDrop');
    expect(commandForKey('ArrowDown', true)).toBe('softDrop');
    expect(commandForKey('KeyP', false)).toBe('pause');
    expect(commandForKey('Escape', false)).toBe('exit');
  });
});
