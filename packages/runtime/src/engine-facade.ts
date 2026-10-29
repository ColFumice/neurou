/**
 * v5.2：Engine facade。
 *
 * Host 只通过这一层驱动运行时：不直接改 Universe/WorldState，
 * 预览、CLI、未来的 player 共享同一套 step/dispatch/observe 语义。
 */
import type { IRRule, WorldIR } from '@neurou/core';
import { Universe, type EmittedCue, type TickResult, type UniverseOptions } from './engine.js';
import type { RuntimeValue, WorldState } from './state.js';

export interface SceneFrame {
  scene?: string;
  tick: number;
  phase?: string;
  values: Record<string, RuntimeValue>;
  cues: EmittedCue[];
  activeSystems: string[];
  ended: { id: string; name: string; tick: number } | null;
}

export type EngineListener = (frame: SceneFrame) => void;

export class Engine {
  readonly ir: WorldIR;
  private readonly universe: Universe;
  private readonly listeners = new Set<EngineListener>();
  private lastCues: EmittedCue[] = [];

  constructor(ir: WorldIR, options: UniverseOptions = {}) {
    this.ir = ir;
    this.universe = new Universe(ir, options);
  }

  get tick(): number {
    return this.universe.state.tick;
  }

  get phaseName(): string | undefined {
    return this.universe.phaseName;
  }

  get ended(): boolean {
    return this.universe.ended;
  }

  get sceneName(): string | undefined {
    return this.universe.sceneName;
  }

  activeSystems(): string[] {
    return this.universe.activeSystems();
  }

  availableActions(): IRRule[] {
    return this.universe.availableActions();
  }

  get(id: string): RuntimeValue {
    return this.universe.get(id);
  }

  number(id: string): number {
    return this.universe.number(id);
  }

  /** Host 的只读状态投影；不要在这里改运行时内部结构。 */
  get state(): Readonly<WorldState> {
    return this.universe.state;
  }

  get stats(): typeof this.universe.stats {
    return this.universe.stats;
  }

  inject(id: string, value: RuntimeValue): number {
    return this.universe.inject(id, value);
  }

  getMatrixPosition(name: string): number | undefined {
    return this.universe.getMatrixPosition(name);
  }

  getMatrixCell(name: string, row: string, col: string, position?: number): number | undefined {
    return this.universe.getMatrixCell(name, row, col, position);
  }

  /** 选择动作；真正的效果在下一拍 step 中结算。 */
  dispatch(actionId: string): boolean {
    return this.universe.act(actionId);
  }

  /** 推进一拍，并广播观测帧。 */
  step(): TickResult {
    const result = this.universe.tick();
    this.lastCues = result.cues;
    this.emit();
    return result;
  }

  transitionScene(nameOrId: string): boolean {
    const changed = this.universe.transitionScene(nameOrId);
    if (changed) this.emit();
    return changed;
  }

  snapshot(): WorldState {
    return this.universe.snapshot();
  }

  restore(state: WorldState): void {
    this.universe.restore(state);
    this.emit();
  }

  observe(): SceneFrame {
    const state = this.universe.snapshot();
    return {
      scene: this.sceneName,
      tick: state.tick,
      phase: this.phaseName,
      values: state.values,
      cues: this.lastCues.map((cue) => ({ ...cue })),
      activeSystems: this.activeSystems(),
      ended: state.ended,
    };
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const frame = this.observe();
    for (const listener of this.listeners) listener(frame);
  }
}

export function createEngine(ir: WorldIR, options: UniverseOptions = {}): Engine {
  return new Engine(ir, options);
}
