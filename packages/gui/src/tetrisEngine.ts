/**
 * 阶段 2：俄罗斯方块核心状态机。
 *
 * 纯 TypeScript，不依赖 DOM/Canvas/React；GUI 与测试共用。
 * 固定 10×20 棋盘，7-bag 确定性随机，旋转/碰撞/消行/计分/结束。
 */

export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type TetrisAction =
  | 'left'
  | 'right'
  | 'rotateCW'
  | 'rotateCCW'
  | 'softDrop'
  | 'hardDrop';

export interface ActivePiece {
  kind: PieceKind;
  rotation: number;
  x: number;
  y: number;
}

export interface TetrisSnapshot {
  board: number[][];
  active: ActivePiece | null;
  queue: PieceKind[];
  score: number;
  lines: number;
  level: number;
  over: boolean;
  tick: number;
  seed: number;
  rngState: number;
  /** 最近一次消行数，供渲染动画用。 */
  lastCleared: number;
  lastAction: TetrisAction | null;
}

export const BOARD_W = 10;
export const BOARD_H = 20;
export const PIECE_KINDS: readonly PieceKind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const SHAPES: Record<PieceKind, number[][]> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

/** 顺时针旋转一次。非方阵按 N 旋转（I 为 4x4，其余 2/3）。 */
export function rotateMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const next = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      next[x]![n - 1 - y] = matrix[y]![x] ?? 0;
    }
  }
  return next;
}

const ROTATIONS: Record<PieceKind, number[][][]> = (() => {
  const result = {} as Record<PieceKind, number[][][]>;
  for (const kind of PIECE_KINDS) {
    const states: number[][][] = [];
    let current = SHAPES[kind].map((row) => [...row]);
    for (let i = 0; i < 4; i += 1) {
      states.push(current);
      current = rotateMatrix(current);
    }
    result[kind] = states;
  }
  return result;
})();

export function shapeFor(kind: PieceKind, rotation: number): number[][] {
  return ROTATIONS[kind][((rotation % 4) + 4) % 4]!;
}

export function pieceColorIndex(kind: PieceKind): number {
  return PIECE_KINDS.indexOf(kind) + 1;
}

/** 简易确定性 PRNG（mulberry32）。 */
export function nextRandom(state: number): { state: number; value: number } {
  let a = state >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a, value };
}

export function createBoard(): number[][] {
  return Array.from({ length: BOARD_H }, () => new Array<number>(BOARD_W).fill(0));
}

/** 消行纯函数；返回新棋盘与消除行数（从底部往上保留）。 */
export function clearFullLines(board: number[][]): { board: number[][]; cleared: number } {
  const kept = board.filter((row) => row.some((cell) => cell === 0));
  const cleared = board.length - kept.length;
  const empty = Array.from({ length: cleared }, () => new Array<number>(BOARD_W).fill(0));
  return { board: [...empty, ...kept], cleared };
}

export class TetrisEngine {
  private board: number[][];
  private active: ActivePiece | null = null;
  private queue: PieceKind[] = [];
  private score = 0;
  private lines = 0;
  private level = 1;
  private over = false;
  private tickCount = 0;
  private seed: number;
  private rngState: number;
  private lastCleared = 0;
  private lastAction: TetrisAction | null = null;

  constructor(seed = 1) {
    this.seed = seed >>> 0 || 1;
    this.rngState = this.seed;
    this.board = createBoard();
    this.spawn();
  }

  get snapshot(): TetrisSnapshot {
    return {
      board: this.board.map((row) => [...row]),
      active: this.active ? { ...this.active } : null,
      queue: [...this.queue],
      score: this.score,
      lines: this.lines,
      level: this.level,
      over: this.over,
      tick: this.tickCount,
      seed: this.seed,
      rngState: this.rngState,
      lastCleared: this.lastCleared,
      lastAction: this.lastAction,
    };
  }

  get isOver(): boolean {
    return this.over;
  }

  get gravityMs(): number {
    return Math.max(80, 800 - (this.level - 1) * 70);
  }

  reset(seed = this.seed): void {
    this.seed = seed >>> 0 || 1;
    this.rngState = this.seed;
    this.board = createBoard();
    this.queue = [];
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.over = false;
    this.tickCount = 0;
    this.lastCleared = 0;
    this.lastAction = null;
    this.spawn();
  }

  private random(): number {
    const next = nextRandom(this.rngState);
    this.rngState = next.state;
    return next.value;
  }

  private refillQueue(): void {
    while (this.queue.length < 5) {
      const bag = [...PIECE_KINDS];
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      this.queue.push(...bag);
    }
  }

  private nextKind(): PieceKind {
    this.refillQueue();
    return this.queue.shift()!;
  }

  private spawn(): void {
    const kind = this.nextKind();
    const shape = shapeFor(kind, 0);
    const x = Math.floor((BOARD_W - shape.length) / 2);
    this.active = { kind, rotation: 0, x, y: 0 };
    if (this.collides(this.active)) {
      this.over = true;
      this.active = null;
    }
  }

  collides(piece: ActivePiece): boolean {
    const shape = shapeFor(piece.kind, piece.rotation);
    for (let y = 0; y < shape.length; y += 1) {
      for (let x = 0; x < shape.length; x += 1) {
        if (!shape[y]![x]) continue;
        const bx = piece.x + x;
        const by = piece.y + y;
        if (bx < 0 || bx >= BOARD_W || by >= BOARD_H) return true;
        if (by >= 0 && this.board[by]![bx]) return true;
      }
    }
    return false;
  }

  private move(dx: number, dy: number): boolean {
    if (!this.active || this.over) return false;
    const candidate = { ...this.active, x: this.active.x + dx, y: this.active.y + dy };
    if (this.collides(candidate)) return false;
    this.active = candidate;
    return true;
  }

  private rotate(direction: 1 | -1): boolean {
    if (!this.active || this.over) return false;
    if (this.active.kind === 'O') return false;
    const rotation = (this.active.rotation + direction + 4) % 4;
    for (const kick of [0, -1, 1, -2, 2]) {
      const candidate = { ...this.active, rotation, x: this.active.x + kick };
      if (!this.collides(candidate)) {
        this.active = candidate;
        return true;
      }
    }
    return false;
  }

  private lock(): void {
    if (!this.active) return;
    const shape = shapeFor(this.active.kind, this.active.rotation);
    const color = pieceColorIndex(this.active.kind);
    for (let y = 0; y < shape.length; y += 1) {
      for (let x = 0; x < shape.length; x += 1) {
        if (!shape[y]![x]) continue;
        const bx = this.active.x + x;
        const by = this.active.y + y;
        if (by < 0) {
          this.over = true;
          continue;
        }
        this.board[by]![bx] = color;
      }
    }
    const result = clearFullLines(this.board);
    this.board = result.board;
    this.lastCleared = result.cleared;
    if (result.cleared > 0) {
      const table = [0, 100, 300, 500, 800];
      this.score += table[Math.min(4, result.cleared)]! * this.level;
      this.lines += result.cleared;
      this.level = 1 + Math.floor(this.lines / 10);
    }
    this.active = null;
    if (!this.over) this.spawn();
  }

  private softDrop(): void {
    if (!this.active) return;
    if (this.move(0, 1)) {
      this.score += 1;
    } else {
      this.lock();
    }
  }

  private hardDrop(): void {
    if (!this.active) return;
    let distance = 0;
    while (this.move(0, 1)) distance += 1;
    this.score += distance * 2;
    this.lock();
  }

  /** 执行一个输入；返回是否产生有效变化。 */
  apply(action: TetrisAction): boolean {
    if (!this.active || this.over) return false;
    this.lastAction = action;
    switch (action) {
      case 'left':
        return this.move(-1, 0);
      case 'right':
        return this.move(1, 0);
      case 'rotateCW':
        return this.rotate(1);
      case 'rotateCCW':
        return this.rotate(-1);
      case 'softDrop':
        this.softDrop();
        return true;
      case 'hardDrop':
        this.hardDrop();
        return true;
      default:
        return false;
    }
  }

  /** 重力步：能下移则下移，否则锁定。 */
  tick(): void {
    if (!this.active || this.over) return;
    this.tickCount += 1;
    if (!this.move(0, 1)) this.lock();
  }

  /** 幽灵方块落点 y。 */
  ghostY(): number {
    if (!this.active) return 0;
    let y = this.active.y;
    while (true) {
      const candidate = { ...this.active, y: y + 1 };
      if (this.collides(candidate)) break;
      y += 1;
    }
    return y;
  }

  /** 恢复快照（回放/调试/暂停恢复）。 */
  load(snapshot: TetrisSnapshot): void {
    this.board = snapshot.board.map((row) => [...row]);
    this.active = snapshot.active ? { ...snapshot.active } : null;
    this.queue = [...snapshot.queue];
    this.score = snapshot.score;
    this.lines = snapshot.lines;
    this.level = snapshot.level;
    this.over = snapshot.over;
    this.tickCount = snapshot.tick;
    this.seed = snapshot.seed;
    this.rngState = snapshot.rngState;
    this.lastCleared = snapshot.lastCleared;
    this.lastAction = snapshot.lastAction;
  }

  /** 逐动作重放，便于回放/测试。 */
  replay(actions: readonly TetrisAction[]): void {
    for (const action of actions) this.apply(action);
  }

  get boardState(): number[][] {
    return this.board.map((row) => [...row]);
  }

  get activePiece(): ActivePiece | null {
    return this.active ? { ...this.active } : null;
  }

  get scoreValue(): number {
    return this.score;
  }

  get linesValue(): number {
    return this.lines;
  }

  get levelValue(): number {
    return this.level;
  }

  get nextPieces(): PieceKind[] {
    return this.queue.slice(0, 3);
  }

  get lastClearCount(): number {
    return this.lastCleared;
  }
}
