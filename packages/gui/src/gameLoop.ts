/**
 * 阶段 1：固定步长循环 / 输入队列 / 暂停 / 快照时钟。
 *
 * 不依赖 DOM，可在测试与 GUI 共用。GUI 用 requestAnimationFrame 驱动 advance，
 * 每次 advance 按固定 stepMs 消费输入队列并推进世界步。
 */

export interface FixedLoopOptions {
  /** 固定步长，默认 1000/60。 */
  stepMs?: number;
  /** 单次 advance 最多补多少步，避免切后台回来一次追几千步。 */
  maxStepsPerAdvance?: number;
  /** 单次 advance 最大时间增量。 */
  maxDeltaMs?: number;
}

export interface FixedLoopAdvance {
  /** 本次实际推进的固定步数。 */
  steps: number;
  /** 推进后的总步数。 */
  tick: number;
}

/**
 * 固定步长时钟 + 输入队列。
 *
 * 输入不是立即执行，而是入队（enqueue），下一次 advance 的每个固定步消费一个；
 * 这样按键和物理/游戏步一致，且可完整重放。
 */
export class FixedStepLoop<T> {
  readonly stepMs: number;
  private readonly maxStepsPerAdvance: number;
  private readonly maxDeltaMs: number;
  private accumulator = 0;
  private tickCount = 0;
  private queue: T[] = [];
  private paused = false;

  constructor(options: FixedLoopOptions = {}) {
    this.stepMs = Math.max(1, options.stepMs ?? 1000 / 60);
    this.maxStepsPerAdvance = Math.max(1, Math.round(options.maxStepsPerAdvance ?? 8));
    this.maxDeltaMs = Math.max(this.stepMs, options.maxDeltaMs ?? 250);
  }

  get tick(): number {
    return this.tickCount;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get pendingInputs(): number {
    return this.queue.length;
  }

  enqueue(...inputs: T[]): void {
    for (const input of inputs) this.queue.push(input);
  }

  /** 取出下一个输入；没有则 undefined。 */
  private takeInput(): T | undefined {
    return this.queue.shift();
  }

  /** 清空未消费的输入。 */
  clearInputs(): void {
    this.queue = [];
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  /** 重置时间/输入，但不清零 tick（需要归零请用 resetTick）。 */
  resetAccumulator(): void {
    this.accumulator = 0;
  }

  resetTick(): void {
    this.tickCount = 0;
  }

  setTick(value: number): void {
    this.tickCount = Math.max(0, Math.floor(value));
  }
  /**
   * 推进真实时间。
   * @param deltaMs 距上一帧的真实毫秒
   * @param onStep 每固定步回调；入参为该步消费的输入（可能 undefined）
   */
  advance(deltaMs: number, onStep: (input: T | undefined, tick: number) => void): FixedLoopAdvance {
    if (this.paused) return { steps: 0, tick: this.tickCount };
    const delta = Math.max(0, Math.min(this.maxDeltaMs, deltaMs));
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= this.stepMs && steps < this.maxStepsPerAdvance) {
      this.accumulator -= this.stepMs;
      const input = this.takeInput();
      this.tickCount += 1;
      onStep(input, this.tickCount);
      steps += 1;
    }
    return { steps, tick: this.tickCount };
  }

  snapshot(): { stepMs: number; tick: number; paused: boolean; pending: T[] } {
    return {
      stepMs: this.stepMs,
      tick: this.tickCount,
      paused: this.paused,
      pending: [...this.queue],
    };
  }
}
