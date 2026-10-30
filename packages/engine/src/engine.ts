/**
 * v5.2：Engine facade。
 *
 * Host 只通过这一层驱动运行时：不直接改 Universe/WorldState，
 * 预览、CLI、未来的 player 共享同一套 step/dispatch/observe 语义。
 */
import type { IRRule, WorldIR } from '@neurou/core';
import {
  Universe,
  cloneState,
  initialValues,
  type EmittedCue,
  type RuntimeValue,
  type TickResult,
  type UniverseOptions,
  type WorldState,
} from '@neurou/runtime';
import type { BackendPortFrame } from './backend.js';

export interface SceneFrame {
  scene?: string;
  tick: number;
  phase?: string;
  values: Record<string, RuntimeValue>;
  cues: EmittedCue[];
  activeSystems: string[];
  ports: Record<string, BackendPortFrame>;
  ended: { id: string; name: string; tick: number } | null;
}

export type EngineListener = (frame: SceneFrame) => void;

/** v6.1：Host 稳定 ABI 标识；字段语义见 docs/110。 */
export const HOST_ABI = 'neurou-host/1' as const;

export interface HostSnapshot {
  abi: typeof HOST_ABI;
  /** 快照状态结构版本；v1 内自增，破坏性变更升 ABI。 */
  stateVersion: 1;
  description: EngineDescription;
  values: Record<string, RuntimeValue>;
  state: WorldState;
}

/** v5.51：Host 集成用的只读世界摘要。 */
export interface EngineDescription {
  abi: typeof HOST_ABI;
  name: string;
  version: string;
  tick: number;
  scene?: string;
  phase?: string;
  ended: boolean;
  endedName?: string;
  scenes: string[];
  systems: string[];
  activeSystems: string[];
  ports: { name: string; kind: '视觉' | '音频' }[];
  strings: number;
  audioAssets: number;
  textureAssets: number;
  functions: number;
}

export class Engine {
  ir: WorldIR;
  private universe: Universe;
  private readonly options: UniverseOptions;
  private readonly listeners = new Set<EngineListener>();
  private lastCues: EmittedCue[] = [];

  constructor(ir: WorldIR, options: UniverseOptions = {}) {
    this.ir = ir;
    this.options = { ...options };
    this.universe = new Universe(ir, options);
  }

  get tick(): number {
    return this.universe.state.tick;
  }

  describe(): EngineDescription {
    return {
      abi: HOST_ABI,
      name: this.ir.name,
      version: String(this.ir.meta['版本'] ?? ''),
      tick: this.tick,
      ...(this.sceneName ? { scene: this.sceneName } : {}),
      ...(this.phaseName ? { phase: this.phaseName } : {}),
      ended: this.universe.state.ended !== null,
      ...(this.universe.state.ended ? { endedName: this.universe.state.ended.name } : {}),
      scenes: (this.ir.scenes ?? []).map((scene) => scene.name),
      systems: (this.ir.systems ?? []).map((system) => system.name),
      activeSystems: this.activeSystems(),
      ports: (this.ir.ports ?? []).map((port) => ({ name: port.name, kind: port.kind })),
      strings: this.ir.strings.length,
      audioAssets: (this.ir.audioAssets ?? []).length,
      textureAssets: (this.ir.textureAssets ?? []).length,
      functions: (this.ir.functions ?? []).length,
    };
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

  /** v5.10：Host 的场景列表；没有场景时为空。 */
  scenes(): Array<{ id: string; name: string }> {
    return (this.ir.scenes ?? []).map((scene) => ({ id: scene.id, name: scene.name }));
  }

  get currentSceneId(): string | undefined {
    return this.universe.state.sceneId;
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

  /** v6.1：可 JSON 序列化的 Host 快照；ABI 见 docs/110。 */
  toHostSnapshot(): HostSnapshot {
    return {
      abi: HOST_ABI,
      stateVersion: 1,
      description: this.describe(),
      values: { ...this.state.values },
      state: this.snapshot(),
    };
  }

  /** v6.5：从 Host 快照恢复；只接受同一 ABI 的 stateVersion 1。 */
  restoreHostSnapshot(snapshot: HostSnapshot): boolean {
    if (snapshot.abi !== HOST_ABI) return false;
    const version = snapshot.stateVersion ?? 1;
    if (version !== 1) return false;
    this.restore(snapshot.state);
    return true;
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

  /**
   * v5.5：保 tick 的热替换。值、tick、pending 都保留；
   * 新弦取基线，消失的弦/规则状态被裁掉。结构编辑不再重建 Engine。
   */
  replaceWorld(ir: WorldIR): void {
    const previous = this.universe.snapshot();
    const stringIds = new Set(ir.strings.map((item) => item.id));
    const values = initialValues(ir);
    for (const [id, value] of Object.entries(previous.values)) {
      if (stringIds.has(id)) values[id] = value;
    }
    const state = cloneState(previous);
    state.values = values;
    state.pending = previous.pending.filter((entry) => stringIds.has(entry.id));
    if (state.ended) {
      const endingIds = new Set(ir.endings.map((ending) => ending.id));
      if (!endingIds.has(state.ended.id)) state.ended = null;
    }
    const scenes = ir.scenes ?? [];
    if (scenes.length > 0 && (!state.sceneId || !scenes.some((scene) => scene.id === state.sceneId))) {
      state.sceneId = scenes[0]!.id;
    }
    if (state.spectra) {
      for (const id of Object.keys(state.spectra)) {
        if (!ir.spectra.some((spectrum) => spectrum.id === id)) delete state.spectra[id];
      }
    }
    if (state.matrices) {
      for (const id of Object.keys(state.matrices)) {
        if (!ir.matrices.some((matrix) => matrix.id === id)) delete state.matrices[id];
      }
    }
    const next = new Universe(ir, this.options);
    next.restore(state);
    this.ir = ir;
    this.universe = next;
    this.emit();
  }

  observe(): SceneFrame {
    const state = this.universe.snapshot();
    const ports: Record<string, BackendPortFrame> = {};
    for (const port of this.ir.ports ?? []) {
      const params: Record<string, RuntimeValue> = {};
      for (const param of port.params) params[param.name] = state.values[param.string] ?? null;
      ports[port.id] = {
        id: port.id,
        name: port.name,
        kind: port.kind,
        params,
        ...(port.texture ? { texture: port.texture } : {}),
        ...(port.textureAsset ? { textureAsset: port.textureAsset } : {}),
      };
    }
    return {
      scene: this.sceneName,
      tick: state.tick,
      phase: this.phaseName,
      values: state.values,
      cues: this.lastCues.map((cue) => ({ ...cue })),
      activeSystems: this.activeSystems(),
      ports,
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
