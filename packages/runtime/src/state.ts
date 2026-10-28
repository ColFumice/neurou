import type { IRMatrix, IRSpectrum, IRString, WorldIR } from '@neurou/core';

/**
 * 运行时状态。
 *
 * 一个 WorldState 就是集合论隐喻里的一个 V[G]——某一局实际展开的宇宙。
 * 它必须是可完整序列化的：冻结、回放、分叉，都只依赖这一坨数据。
 */

export type RuntimeValue = number | boolean | string | Set<string> | null;

/** 谱的调制模式：固定（持久叠加）或受迫（每拍衰减回锚点）。 */
export type SpectrumMode = '固定' | '受迫';

/** 谱的插值方式；运行时按快照里的元数据采样。 */
export type SpectrumInterpolation = '线性' | '平滑' | '阶跃';

/**
 * 谱在一局里的可变状态。
 *
 * - `anchors`：玩家编辑的锚点，永不自行回弹；
 * - `values`：锚点叠加调制后的当前曲线，每拍末夹回谱的范围；
 * - `mode`：从 IR 复制过来，便于快照自带完整语义；
 * - `min` / `max` / `interpolation` / `loop`：v2.1a 起随快照携带的采样元数据。
 *
 * 元数据在编译期由 IR 固定，复制进状态是为了让 `evalExpr` 只凭一份
 * WorldState 就能采样（规则/结局在运行时不持有 IR），并让快照/分叉
 * 自带完整语义。旧存档没有这些字段，因此类型上保持可选：反序列化回退到
 * 0..1 / 线性 / 不循环，Universe.restore 再从 IR 重建真正的值。
 */
export interface SpectrumState {
  anchors: number[];
  values: number[];
  mode: SpectrumMode;
  min?: number;
  max?: number;
  interpolation?: SpectrumInterpolation;
  loop?: boolean;
}

/** 从 IR 的作者数据生成一份初始谱状态。 */
export function createSpectrumState(ir: IRSpectrum): SpectrumState {
  return {
    anchors: [...ir.bands],
    values: [...ir.bands],
    mode: ir.mode,
    min: ir.min,
    max: ir.max,
    interpolation: ir.interpolation,
    loop: ir.loop,
  };
}

/** 关系谱里一条格子曲线在一局里的不可变副本（v2.3a）。 */
export interface MatrixCurveState {
  row: string;
  col: string;
  /** 1..64 个采样值，位置 0..1 均匀分布。 */
  bands: number[];
  /** v2.12：该格单独的插值覆盖。 */
  interpolation?: SpectrumInterpolation;
  /** v2.14：该格单独的循环覆盖。 */
  loop?: boolean;
  /** v2.15：该格单独的时间速度/相位覆盖。 */
  speed?: number;
  phase?: number;
}

/**
 * 关系谱在一局里的静态数据（v2.3a）。
 *
 * 矩阵作者数据不随拍变化，但规则/结局的 `evalExpr` 只拿到 WorldState，
 * 因此把整张矩阵复制进状态。`rows` / `cols` 是标签到下标的索引，用于
 * 四参数查表在缺曲线时回退到 `values` 的标量值，也供 Universe.getMatrixCell
 * 直接按标签读取。旧快照没有这个字段；Universe.restore 会从 IR 重建。
 */
export interface MatrixState {
  rows: string[];
  cols: string[];
  values: number[][];
  curves: MatrixCurveState[];
  interpolation: SpectrumInterpolation;
  loop: boolean;
  /** v2.6：时间轴周期 / 速度 / 相位（随世界进入运行时）。 */
  period?: number;
  speed?: number;
  phase?: number;
  /** v2.7：相位源（多矩阵联动）。 */
  phaseSource?: { matrix: string; row: string; col: string };
}

/** 从 IR 的作者数据生成一份初始矩阵状态（深拷贝，避免共享可变数组）。 */
export function createMatrixState(ir: IRMatrix): MatrixState {
  return {
    rows: [...ir.rows],
    cols: [...ir.cols],
    values: ir.values.map((row) => [...row]),
    curves: (ir.curves ?? []).map((curve) => ({
      row: curve.row,
      col: curve.col,
      bands: [...curve.bands],
      ...(curve.interpolation ? { interpolation: curve.interpolation } : {}),
      ...(curve.loop !== undefined ? { loop: curve.loop } : {}),
      ...(curve.speed !== undefined ? { speed: curve.speed } : {}),
      ...(curve.phase !== undefined ? { phase: curve.phase } : {}),
    })),
    interpolation: ir.interpolation === '平滑' ? '平滑' : ir.interpolation === '阶跃' ? '阶跃' : '线性',
    loop: ir.loop === true,
    ...(ir.period !== undefined ? { period: ir.period } : {}),
    speed: ir.speed ?? 1,
    phase: ir.phase ?? 0,
    ...(ir.phaseSource ? { phaseSource: { ...ir.phaseSource } } : {}),
  };
}

function normalizeMatrixState(s: MatrixState): MatrixState {
  const rows = Array.isArray(s.rows) ? s.rows.map(String) : [];
  const cols = Array.isArray(s.cols) ? s.cols.map(String) : [];
  const values = Array.isArray(s.values)
    ? s.values.map((row) =>
        Array.isArray(row) ? row.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)) : [],
      )
    : [];
  const curves = Array.isArray(s.curves)
    ? s.curves.map((curve) => ({
        row: String(curve.row),
        col: String(curve.col),
        bands: Array.isArray(curve.bands)
          ? curve.bands.map((b) => (typeof b === 'number' && Number.isFinite(b) ? b : 0))
          : [],
        ...(curve.interpolation === '平滑' || curve.interpolation === '阶跃' || curve.interpolation === '线性'
          ? { interpolation: curve.interpolation }
          : {}),
        ...(typeof curve.loop === 'boolean' ? { loop: curve.loop } : {}),
        ...(typeof curve.speed === 'number' && Number.isFinite(curve.speed) && curve.speed > 0
          ? { speed: curve.speed }
          : {}),
        ...(typeof curve.phase === 'number' && Number.isFinite(curve.phase)
          ? { phase: ((curve.phase % 1) + 1) % 1 }
          : {}),
      }))
    : [];
  const period = typeof s.period === 'number' && Number.isFinite(s.period) && s.period > 0 ? s.period : undefined;
  const speed = typeof s.speed === 'number' && Number.isFinite(s.speed) && s.speed > 0 ? s.speed : 1;
  const rawPhase = typeof s.phase === 'number' && Number.isFinite(s.phase) ? s.phase : 0;
  return {
    rows,
    cols,
    values,
    curves,
    interpolation: s.interpolation === '平滑' ? '平滑' : s.interpolation === '阶跃' ? '阶跃' : '线性',
    loop: s.loop === true,
    ...(period !== undefined ? { period } : {}),
    speed,
    phase: ((rawPhase % 1) + 1) % 1,
    ...(s.phaseSource && typeof s.phaseSource.matrix === 'string'
      ? {
          phaseSource: {
            matrix: s.phaseSource.matrix,
            row: String(s.phaseSource.row),
            col: String(s.phaseSource.col),
          },
        }
      : {}),
  };
}

/**
 * 采样一条曲线（谱与关系谱共用的底层实现）。
 *
 * - 线性：相邻段之间直线插值；段 i 落在 i / (n - 1)；
 * - 平滑：余弦插值 t' = (1 - cos(πt)) / 2，中点和线性一致，段点处导数为 0；
 * - `loop` 为 false 时位置夹到 [0, 1]；为 true 时按周期 [0, 1) 回绕
 *   （position = 1 等价于 0，负数同样回绕）；
 * - 单段曲线在任意有限位置都返回该段。
 *
 * 空曲线或非有限位置返回 undefined。
 */
function sampleBands(
  bands: readonly number[],
  position: number,
  interpolation: SpectrumInterpolation | undefined,
  loop: boolean,
): number | undefined {
  if (!Number.isFinite(position)) return undefined;
  const n = bands.length;
  if (n === 0) return undefined;

  const p = loop ? ((position % 1) + 1) % 1 : Math.min(1, Math.max(0, position));
  if (n === 1) return bands[0]!;

  // v2.9：阶跃按 n 个等宽平台保持，不插值。
  if (interpolation === '阶跃') {
    const stepIndex = Math.min(n - 1, Math.floor(p * n));
    return bands[stepIndex]!;
  }

  const x = p * (n - 1);
  const i = Math.floor(x);
  if (i >= n - 1) return bands[n - 1]!;
  const a = bands[i]!;
  const b = bands[i + 1]!;
  const t = x - i;
  if (interpolation === '平滑') {
    const eased = (1 - Math.cos(Math.PI * t)) / 2;
    return a + (b - a) * eased;
  }
  return a + (b - a) * t;
}

/** v2.15：把矩阵时间位置映射到某条曲线自己的时间轴。 */
export function curveLocalPosition(
  curve: Pick<MatrixCurveState, 'speed' | 'phase'>,
  position: number,
): number {
  return position * (curve.speed ?? 1) + (curve.phase ?? 0);
}

/**
 * 采样一条关系谱格子曲线（v2.3a）。
 *
 * 语义和 `查谱` / `sampleSpectrum` 完全一致：位置 0..1、线性或平滑、
 * 非循环夹到 [0, 1]、循环按 [0, 1) 回绕；n = 1 时恒为该段值。
 * 曲线不存在（空数组）或位置非有限时返回 undefined，由调用方决定
 * 回退到标量 `段` 还是 0。
 */
export function sampleMatrixCurve(
  curve: Pick<MatrixCurveState, 'bands'>,
  position: number,
  interpolation: SpectrumInterpolation = '线性',
  loop = false,
): number | undefined {
  return sampleBands(curve.bands, position, interpolation, loop);
}

/**
 * 采样一条谱的当前曲线（v2.1a 起由 Universe.getSpectrumAt 与 `查谱` 共用）。
 *
 * min / max 只约束 `values` 的范围，不改变插值形状；其余语义见 sampleBands。
 */
export function sampleSpectrum(st: SpectrumState, position: number): number | undefined {
  return sampleBands(st.values, position, st.interpolation, st.loop === true);
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
  /**
   * 关系谱的静态数据（v2.3a）。和 spectra 一样保持「无矩阵也有空对象」的
   * 稳定形状；旧快照没有该字段时由 Universe.restore 从 IR 重建。
   */
  matrices?: Record<string, MatrixState>;
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

/**
 * 把一条（可能来自旧存档的）谱状态补全成当前形状。
 *
 * 旧快照只有 anchors / values / mode；缺失的采样元数据回退到
 * 0..1 / 线性 / 不循环。Universe.restore 还会用 IR 覆盖这些回退值。
 */
function normalizeSpectrumState(s: SpectrumState): SpectrumState {
  const min = typeof s.min === 'number' && Number.isFinite(s.min) ? s.min : 0;
  const max = typeof s.max === 'number' && Number.isFinite(s.max) ? s.max : 1;
  const validRange = max > min;
  return {
    anchors: [...s.anchors],
    values: [...s.values],
    mode: s.mode === '受迫' ? '受迫' : '固定',
    min: validRange ? min : 0,
    max: validRange ? max : 1,
    interpolation: s.interpolation === '平滑' ? '平滑' : s.interpolation === '阶跃' ? '阶跃' : '线性',
    loop: s.loop === true,
  };
}

function initialSpectra(world: WorldIR): Record<string, SpectrumState> {
  const out: Record<string, SpectrumState> = {};
  for (const s of world.spectra) out[s.id] = createSpectrumState(s);
  return out;
}

function cloneSpectra(spectra: Record<string, SpectrumState>): Record<string, SpectrumState> {
  const out: Record<string, SpectrumState> = {};
  for (const [id, s] of Object.entries(spectra)) out[id] = normalizeSpectrumState(s);
  return out;
}

function initialMatrices(world: WorldIR): Record<string, MatrixState> {
  const out: Record<string, MatrixState> = {};
  for (const m of world.matrices) out[m.id] = createMatrixState(m);
  return out;
}

function cloneMatrices(matrices: Record<string, MatrixState>): Record<string, MatrixState> {
  const out: Record<string, MatrixState> = {};
  for (const [id, m] of Object.entries(matrices)) out[id] = normalizeMatrixState(m);
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
    matrices: initialMatrices(world),
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
    ...(s.matrices ? { matrices: cloneMatrices(s.matrices) } : {}),
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
  /** 与 WorldState.matrices 同形；旧存档可能没有。 */
  matrices?: Record<string, MatrixState>;
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
    ...(s.matrices ? { matrices: cloneMatrices(s.matrices) } : {}),
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
    ...(s.matrices ? { matrices: cloneMatrices(s.matrices) } : {}),
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
