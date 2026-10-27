import type { IRString, WorldIR } from '@neurou/core';

/**
 * 运行时状态。
 *
 * 一个 WorldState 就是集合论隐喻里的一个 V[G]——某一局实际展开的宇宙。
 * 它必须是可完整序列化的：冻结、回放、分叉，都只依赖这一坨数据。
 */

export type RuntimeValue = number | boolean | string | Set<string> | null;

/** 谱的调制模式：固定（持久叠加）或受迫（每拍衰减回锚点）。 */
export type SpectrumMode = '固定' | '受迫';

/**
 * 谱在一局里的可变状态。
 *
 * - `anchors`：玩家编辑的锚点，永不自行回弹；
 * - `values`：锚点叠加调制后的当前曲线，每拍末夹回谱的范围；
 * - `mode`：从 IR 复制过来，便于快照自带完整语义。
 *
 * 范围 / 插值 / 循环是编译期固定的元数据，留在 IR 里，不进快照。
 */
export interface SpectrumState {
  anchors: number[];
  values: number[];
  mode: SpectrumMode;
}

export interface PendingDelta {
  due: number;
  id: string;
  delta: number;
}

export interface TimelineEvent {
  tick: number;
  kind: 'action' | 'forcing' | 'chord' | 'coupling' | 'signal' | 'ending' | 'axiom';
  id: string;
  detail?: string;
}

export interface WorldState {
  /** 当前拍数，从 0 开始 */
  tick: number;
  phaseIndex: number;
  phaseTick: number;
  values: Record<string, RuntimeValue>;
  /** 一次性力迫是否已经触发过 */
  fired: Record<string, boolean>;
  /** 规则冷却到的拍数 */
  cooldownUntil: Record<string, number>;
  /** 信号上一次的真假（用于上升沿） */
  signalWas: Record<string, boolean>;
  /** 延迟生效的耦合增量 */
  pending: PendingDelta[];
  /** 动作锁定到哪一拍（耗时） */
  busyUntil: number;
  ended: { id: string; name: string; tick: number } | null;
  /** 时间线；默认关闭以省内存 */
  log: TimelineEvent[];
  /** 确定性随机数状态 */
  rng: number;
  /** 分支标识，纯为调试与回放 */
  branch: string;
  /**
   * 谱的可变状态。旧快照可能没有这个字段；新世界即使没有谱也会有空对象，
   * 这样快照形状对「有没有谱」保持稳定。
   */
  spectra?: Record<string, SpectrumState>;
}

export function initialValues(world: WorldIR): Record<string, RuntimeValue> {
  const out: Record<string, RuntimeValue> = {};
  for (const s of world.strings) {
    out[s.id] = toRuntime(s.baseline);
  }
  return out;
}

export function toRuntime(v: unknown): RuntimeValue {
  if (Array.isArray(v)) return new Set(v.map(String));
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' || v === null) return v;
  return null;
}

export function toJson(v: RuntimeValue): string | number | boolean | string[] | null {
  if (v instanceof Set) return [...v].sort();
  return v;
}

export function cloneValue(v: RuntimeValue): RuntimeValue {
  return v instanceof Set ? new Set(v) : v;
}

function initialSpectra(world: WorldIR): Record<string, SpectrumState> {
  const out: Record<string, SpectrumState> = {};
  for (const s of world.spectra) {
    out[s.id] = { anchors: [...s.bands], values: [...s.bands], mode: s.mode };
  }
  return out;
}

function cloneSpectra(spectra: Record<string, SpectrumState>): Record<string, SpectrumState> {
  const out: Record<string, SpectrumState> = {};
  for (const [id, s] of Object.entries(spectra)) {
    out[id] = { anchors: [...s.anchors], values: [...s.values], mode: s.mode };
  }
  return out;
}

export function createState(world: WorldIR, seed = 1, log = false): WorldState {
  return {
    tick: 0,
    phaseIndex: 0,
    phaseTick: 0,
    values: initialValues(world),
    fired: {},
    cooldownUntil: {},
    signalWas: {},
    pending: [],
    busyUntil: 0,
    ended: null,
    log: [],
    rng: seed >>> 0 || 1,
    branch: 'root',
    spectra: initialSpectra(world),
  };
}

export function cloneState(s: WorldState): WorldState {
  const values: Record<string, RuntimeValue> = {};
  for (const [k, v] of Object.entries(s.values)) values[k] = cloneValue(v);
  return {
    tick: s.tick,
    phaseIndex: s.phaseIndex,
    phaseTick: s.phaseTick,
    values,
    fired: { ...s.fired },
    cooldownUntil: { ...s.cooldownUntil },
    signalWas: { ...s.signalWas },
    pending: s.pending.map((p) => ({ ...p })),
    busyUntil: s.busyUntil,
    ended: s.ended ? { ...s.ended } : null,
    log: s.log.map((e) => ({ ...e })),
    rng: s.rng,
    branch: s.branch,
    ...(s.spectra ? { spectra: cloneSpectra(s.spectra) } : {}),
  };
}

/** 可移植的存档格式：把 Set 变成数组，便于 JSON。 */
export interface SerializedState {
  tick: number;
  phaseIndex: number;
  phaseTick: number;
  values: Record<string, string | number | boolean | string[] | null>;
  fired: Record<string, boolean>;
  cooldownUntil: Record<string, number>;
  signalWas: Record<string, boolean>;
  pending: PendingDelta[];
  busyUntil: number;
  ended: { id: string; name: string; tick: number } | null;
  rng: number;
  branch: string;
  /** 与 WorldState.spectra 同形；旧存档可能没有。 */
  spectra?: Record<string, SpectrumState>;
}

export function serializeState(s: WorldState): SerializedState {
  const values: SerializedState['values'] = {};
  for (const [k, v] of Object.entries(s.values)) values[k] = toJson(v);
  return {
    tick: s.tick,
    phaseIndex: s.phaseIndex,
    phaseTick: s.phaseTick,
    values,
    fired: { ...s.fired },
    cooldownUntil: { ...s.cooldownUntil },
    signalWas: { ...s.signalWas },
    pending: s.pending.map((p) => ({ ...p })),
    busyUntil: s.busyUntil,
    ended: s.ended ? { ...s.ended } : null,
    rng: s.rng,
    branch: s.branch,
    ...(s.spectra ? { spectra: cloneSpectra(s.spectra) } : {}),
  };
}

export function deserializeState(s: SerializedState): WorldState {
  const values: Record<string, RuntimeValue> = {};
  for (const [k, v] of Object.entries(s.values)) values[k] = toRuntime(v);
  return {
    tick: s.tick,
    phaseIndex: s.phaseIndex,
    phaseTick: s.phaseTick,
    values,
    fired: { ...s.fired },
    cooldownUntil: { ...s.cooldownUntil },
    signalWas: { ...s.signalWas },
    pending: s.pending.map((p) => ({ ...p })),
    busyUntil: s.busyUntil,
    ended: s.ended ? { ...s.ended } : null,
    log: [],
    rng: s.rng,
    branch: s.branch,
    ...(s.spectra ? { spectra: cloneSpectra(s.spectra) } : {}),
  };
}

export function numberRange(s: IRString): { min: number; max: number } {
  const d = s.domain;
  if (d.type !== 'number') return { min: -Infinity, max: Infinity };
  return { min: d.min ?? -Infinity, max: d.max ?? Infinity };
}

export function clampString(s: IRString, n: number): number {
  const { min, max } = numberRange(s);
  return Math.min(max, Math.max(min, n));
}
