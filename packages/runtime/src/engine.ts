import type {
  IRAxiom,
  IRCoupling,
  IRCue,
  IREffect,
  IREnding,
  IRRule,
  IRSignal,
  IRSpectrum,
  IRString,
  WorldIR,
} from '@neurou/core';
import { evalExpr, asNumber, truthy } from './eval.js';
import {
  type RuntimeValue,
  type SpectrumMode,
  type WorldState,
  type TimelineEvent,
  clampString,
  cloneState,
  createMatrixState,
  createSpectrumState,
  createState,
  sampleMatrixCurve,
  sampleSpectrum,
} from './state.js';

export interface EmittedCue {
  tick: number;
  signal: string;
  cue: IRCue;
}

export interface AxiomViolation {
  tick: number;
  axiom: string;
  /** 违反时的完整弦值快照，便于回放定位 */
  values: Record<string, string | number | boolean | string[] | null>;
}

export interface TickResult {
  tick: number;
  cues: EmittedCue[];
  fired: string[];
  violations: AxiomViolation[];
  ending: { id: string; name: string; tick: number } | null;
  deltas: Record<string, number>;
}

export interface UniverseOptions {
  seed?: number;
  /** 打开时间线（回放/调试用）；模拟时关闭以省内存 */
  log?: boolean;
}

const MAX_CUES = 400;
const MAX_LOG = 2000;

/**
 * 受迫模式每拍向锚点衰减后保留的偏移比例。
 * 偏移 0.3 在 n 拍后剩 0.3 × 0.75ⁿ；锚点本身不参与衰减。
 */
export const FORCED_DECAY = 0.75;

/** 一条谱的只读快照（数组是防御性副本）。 */
export interface SpectrumSnapshot {
  id: string;
  mode: SpectrumMode;
  min: number;
  max: number;
  interpolation: IRSpectrum['interpolation'];
  loop: boolean;
  /** 玩家编辑的锚点（authored bands 的当前值）。 */
  anchors: number[];
  /** 当前曲线：锚点 + 尚未衰减的调制，已夹在 [min, max]。 */
  values: number[];
}

/** 调制目标：单个段下标（0 基），或闭区间 [from, to]。 */
export type SpectrumTarget = number | { from: number; to: number };

/** 谱 API 的统一结果：成功没有负载，失败带中文原因。 */
export type SpectrumResult = { ok: true } | { ok: false; error: string };

interface PendingSpectrumModulation {
  id: string;
  from: number;
  to: number;
  delta: number;
}

/**
 * 世界运行时。
 *
 * 一拍 = 一次「呼吸」：投递上一拍排队的耦合 → 执行玩家动作 → 按偏序判定力迫 →
 * 传导耦合 → 校验公理 → 判定结局 → 投射信号。
 *
 * 这个顺序是刻意的：先让世界自己动，再让玩家动，最后才让玩家看见。
 */
export class Universe {
  readonly ir: WorldIR;
  state: WorldState;

  readonly strings = new Map<string, IRString>();
  private readonly spectra = new Map<string, IRSpectrum>();
  readonly couplings: IRCoupling[];
  readonly forces: IRRule[];
  readonly chords = new Map<string, IRRule>();
  readonly actions = new Map<string, IRRule>();
  readonly signals: IRSignal[];
  readonly endings: IREnding[];
  readonly axioms: IRAxiom[];
  readonly couplingByFrom = new Map<string, IRCoupling[]>();
  private readonly actionList: IRRule[];

  private queuedAction: string | undefined;
  /** 谱调制队列：modulateSpectrum 入队，下一拍 tick 顺序应用。 */
  private pendingSpectrumModulations: PendingSpectrumModulation[] = [];
  private readonly logEnabled: boolean;

  /** 统计（每局一份） */
  readonly stats = {
    cueCount: 0,
    couplingFired: new Set<string>(),
    forcingFired: new Set<string>(),
    signalFired: new Set<string>(),
    actionUsed: new Map<string, number>(),
    actionChosen: new Map<string, number>(),
    deadStates: 0,
    violations: 0,
    crossings: new Map<string, number>(),
    ticks: 0,
  };

  private prevValues: Record<string, RuntimeValue>;
  private readonly cueBuffer: EmittedCue[] = [];
  private readonly violationBuffer: AxiomViolation[] = [];

  constructor(world: WorldIR, opts: UniverseOptions = {}) {
    this.ir = world;
    for (const s of world.strings) this.strings.set(s.id, s);
    for (const s of world.spectra) this.spectra.set(s.id, s);
    this.couplings = world.couplings;
    this.forces = world.rules.filter((r) => r.kind === 'forcing');
    for (const r of world.rules) {
      if (r.kind === 'chord') this.chords.set(r.id, r);
      if (r.kind === 'action') this.actions.set(r.id, r);
    }
    this.actionList = [...this.actions.values()];
    this.signals = world.signals;
    this.endings = world.endings;
    this.axioms = world.axioms;
    for (const c of this.couplings) {
      const arr = this.couplingByFrom.get(c.from) ?? [];
      arr.push(c);
      this.couplingByFrom.set(c.from, arr);
    }
    this.state = createState(world, opts.seed ?? 1, opts.log ?? false);
    this.ensureSpectrumState();
    this.ensureMatrixState();
    this.logEnabled = opts.log ?? false;
    this.prevValues = { ...this.state.values };
    if (this.logEnabled) this.log({ tick: 0, kind: 'ending', id: 'world.start' });
  }

  // ---------- 读取 ----------

  get(id: string): RuntimeValue {
    return this.state.values[id] ?? null;
  }

  number(id: string): number {
    return asNumber(this.get(id));
  }

  get ended(): boolean {
    return this.state.ended !== null;
  }

  get phaseName(): string | undefined {
    return this.ir.phases[this.state.phaseIndex]?.name;
  }

  availableActions(): IRRule[] {
    if (this.ended) return [];
    if (this.state.tick < this.state.busyUntil) return [];
    return this.actionList.filter((a) => !a.guard || truthy(evalExpr(a.guard, this.state)));
  }

  /** 不考虑「动作耗时」时，玩家是否还有任何可做的事——用来区分「忙」和「死局」。 */
  private anyActionAllowed(): boolean {
    return this.actionList.some((a) => !a.guard || truthy(evalExpr(a.guard, this.state)));
  }

  /** 结构化的世界快照，给界面/CLI 渲染。 */
  view(): { id: string; name: string; kind: string; value: RuntimeValue; verge?: number; safe?: number; min?: number; max?: number }[] {
    return this.ir.strings.map((s) => {
      const d = s.domain;
      const row: { id: string; name: string; kind: string; value: RuntimeValue; verge?: number; safe?: number; min?: number; max?: number } = {
        id: s.id,
        name: s.name,
        kind: s.kind,
        value: this.get(s.id),
      };
      if (s.verge !== undefined) row.verge = s.verge;
      if (s.safe !== undefined) row.safe = s.safe;
      if (d.type === 'number') {
        if (d.min !== undefined) row.min = d.min;
        if (d.max !== undefined) row.max = d.max;
      }
      return row;
    });
  }

  /**
   * 读取一条谱的当前快照。返回的数组是副本，修改它不会影响世界。
   * 未知 id（或该谱不在当前状态里）返回 undefined。
   */
  getSpectrum(id: string): SpectrumSnapshot | undefined {
    const ir = this.spectra.get(id);
    const st = this.state.spectra?.[id];
    if (!ir || !st) return undefined;
    return {
      id: ir.id,
      mode: st.mode,
      min: ir.min,
      max: ir.max,
      interpolation: ir.interpolation,
      loop: ir.loop,
      anchors: [...st.anchors],
      values: [...st.values],
    };
  }

  /**
   * 在归一化横轴 [0, 1] 上采样一条谱的当前曲线。
   *
   * - 线性：相邻段之间直线插值；段 i 落在 i / (n - 1)；
   * - 平滑：余弦插值 t' = (1 - cos(πt)) / 2，中点和线性一致，段点处导数为 0；
   * - `loop` 为 false 时位置夹到 [0, 1]；为 true 时按周期 [0, 1) 回绕
   *   （position = 1 等价于 0，负数同样回绕）。
   *
   * 未知 id、空谱或非有限位置返回 undefined。
   */
  getSpectrumAt(id: string, position: number): number | undefined {
    const ir = this.spectra.get(id);
    const st = this.state.spectra?.[id];
    if (!ir || !st) return undefined;
    return sampleSpectrum(st, position);
  }

  /**
   * 读取关系谱的一个格子（v2.3a，供 GUI/测试与 `查关系谱` 共用语义）。
   *
   * - 省略 `position`：返回静态 `段` 标量值；
   * - 给出 `position`：格子有曲线时按 0..1 采样（线性/平滑、夹住/回绕由
   *   矩阵级元数据决定），没有曲线时回退到标量值；
   * - 未知矩阵、行或列返回 undefined；曲线为空或位置非有限时也回退到
   *   标量值（标量非法则为 0）。
   */
  getMatrixCell(name: string, row: string, col: string, position?: number): number | undefined {
    const ir = this.ir.matrices.find((m) => m.id === name);
    const st = this.state.matrices?.[name] ?? (ir ? createMatrixState(ir) : undefined);
    if (!st) return undefined;
    const rowIndex = st.rows.indexOf(row);
    const colIndex = st.cols.indexOf(col);
    if (rowIndex < 0 || colIndex < 0) return undefined;
    const cell = st.values[rowIndex]?.[colIndex];
    const scalar = typeof cell === 'number' && Number.isFinite(cell) ? cell : 0;
    if (position === undefined) return scalar;
    const curve = st.curves.find((c) => c.row === row && c.col === col);
    if (!curve) return scalar;
    const sampled = sampleMatrixCurve(curve, position, st.interpolation, st.loop);
    return sampled === undefined ? scalar : sampled;
  }

  // ---------- 操作 ----------

  /** 选择一个动作，它会在这个世界的下一拍生效。 */
  act(actionId: string): boolean {
    const rule = this.actions.get(actionId);
    if (!rule) return false;
    if (!this.availableActions().some((a) => a.id === rule.id)) return false;
    this.queuedAction = rule.id;
    this.stats.actionChosen.set(rule.name, (this.stats.actionChosen.get(rule.name) ?? 0) + 1);
    return true;
  }

  /**
   * 外部注入：把一根弦推到一个新值（拖弦、拨弦、外部工具都走这里）。
   *
   * 和直接改 state.values 的区别：注入会把变化沿耦合排进 pending，
   * 于是下一拍邻弦会真的收到这阵涟漪——调律台的手指因此能驱动世界的数据流。
   * 返回实际发生的变化量（已被量程夹住）。
   */
  inject(id: string, value: RuntimeValue): number {
    const s = this.strings.get(id);
    if (!s) return 0;
    const before = this.state.values[id];
    switch (s.domain.type) {
      case 'number': {
        const nextNumber = typeof value === 'number' ? value : asNumber(value);
        const current = typeof before === 'number' ? before : asNumber(before ?? null);
        const next = clampString(s, nextNumber);
        this.state.values[id] = next;
        const delta = next - current;
        if (delta !== 0) this.queueFrom(id, delta, 'inject');
        return delta;
      }
      case 'boolean': {
        this.state.values[id] = truthy(value);
        return 0;
      }
      case 'set': {
        const current = before instanceof Set ? before : new Set<string>();
        if (value === null) {
          this.state.values[id] = new Set<string>();
        } else if (value instanceof Set) {
          this.state.values[id] = new Set([...value].map(String));
        } else if (Array.isArray(value)) {
          this.state.values[id] = new Set(value.map(String));
        } else {
          current.add(String(value));
          this.state.values[id] = current;
        }
        return 0;
      }
      default: {
        this.state.values[id] = value === null ? null : String(value);
        return 0;
      }
    }
  }

  /**
   * 给一条谱的指定段（或闭区间段）排队一次调制。
   *
   * 调制不会立即改变曲线：它和 inject 一样面向下一拍，`tick()` 时按入队
   * 顺序逐条应用，每条应用后夹回谱的 [min, max]。delta 可以为负。
   */
  modulateSpectrum(id: string, target: SpectrumTarget, delta: number): SpectrumResult {
    const ir = this.spectra.get(id);
    if (!ir) return { ok: false, error: `不存在的谱「${id}」。` };
    const count = ir.bands.length;

    let from: number;
    let to: number;
    if (typeof target === 'number') {
      if (!Number.isInteger(target) || target < 0 || target >= count) {
        return {
          ok: false,
          error: `谱「${id}」的频段下标 ${target} 无效：必须是 0..${count - 1} 内的整数。`,
        };
      }
      from = target;
      to = target;
    } else {
      const f = target.from;
      const t = target.to;
      if (!Number.isInteger(f) || !Number.isInteger(t) || f < 0 || t < 0 || f >= count || t >= count) {
        return {
          ok: false,
          error: `谱「${id}」的频段范围 ${String(f)}..${String(t)} 无效：必须是 0..${count - 1} 内的整数。`,
        };
      }
      if (f > t) {
        return {
          ok: false,
          error: `谱「${id}」的频段范围 ${f}..${t} 无效：起点不能大于终点。`,
        };
      }
      from = f;
      to = t;
    }

    if (!Number.isFinite(delta)) {
      return { ok: false, error: `谱「${id}」的调制量 ${String(delta)} 不是有限数字。` };
    }
    this.pendingSpectrumModulations.push({ id, from, to, delta });
    return { ok: true };
  }

  /**
   * 玩家拖动一个段点：改写锚点，并把同样的位移叠加到当前值上，
   * 从而保留「锚点 + 调制」的相对偏移；结果一律夹在 [min, max]。
   * 锚点永不回弹，调制如果之后还在，会继续生效。
   */
  setSpectrumAnchor(id: string, index: number, value: number): SpectrumResult {
    const ir = this.spectra.get(id);
    const st = this.state.spectra?.[id];
    if (!ir || !st) return { ok: false, error: `不存在的谱「${id}」。` };

    if (!Number.isInteger(index) || index < 0 || index >= ir.bands.length) {
      return {
        ok: false,
        error: `谱「${id}」的频段下标 ${index} 无效：必须是 0..${ir.bands.length - 1} 内的整数。`,
      };
    }
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        error: `谱「${id}」的第 ${index + 1} 段锚点值 ${String(value)} 不是有限数字。`,
      };
    }

    const nextAnchor = clampSpectrum(ir, value);
    const oldAnchor = st.anchors[index]!;
    const oldValue = st.values[index]!;
    st.anchors[index] = nextAnchor;
    st.values[index] = clampSpectrum(ir, oldValue + (nextAnchor - oldAnchor));
    return { ok: true };
  }

  /** 把一次外部注入的变化排进耦合队列（与 tick 内 propagate 同一套公式）。 */
  private queueFrom(id: string, delta: number, detail: string): void {
    const outs = this.couplingByFrom.get(id);
    if (!outs) return;
    const from = this.strings.get(id);
    if (!from || from.domain.type !== 'number') return;
    const fromRange = rangeOf(from, 100);
    for (const c of outs) {
      if (c.guard && !truthy(evalExpr(c.guard, this.state))) continue;
      const target = this.strings.get(c.to);
      if (!target) continue;
      const targetRange = rangeOf(target, 100);
      const normalized = delta / fromRange;
      const factor = curveFactor(c.curve, Math.abs(normalized));
      const strength = c.strengthExpr ? asNumber(evalExpr(c.strengthExpr, this.state)) : c.strength;
      const applied = normalized * strength * c.polarity * factor * targetRange;
      // 下一拍抵达：state.tick 已经指向下一拍。
      this.state.pending.push({ due: this.state.tick + c.delay, id: c.to, delta: applied });
      this.stats.couplingFired.add(c.id);
      this.log({ tick: this.state.tick, kind: 'coupling', id: `${c.from}→${c.to}`, detail: `${detail} ${applied}` });
    }
  }

  /** 推进一拍。 */
  tick(): TickResult {
    const cues: EmittedCue[] = [];
    const violations: AxiomViolation[] = [];
    const fired: string[] = [];
    const deltas = new Map<string, number>();

    if (this.state.ended) {
      return { tick: this.state.tick, cues, fired, violations, ending: this.state.ended, deltas: {} };
    }

    const t = this.state.tick;
    this.prevValues = { ...this.state.values };

    // 1. 投递到期的耦合
    this.deliverPending(t, deltas);

    // 2. 玩家动作
    if (this.queuedAction) {
      const action = this.rulesById(this.queuedAction);
      this.queuedAction = undefined;
      if (action && this.stillAvailable(action)) {
        this.applyEffects(action.effects, action.name, 'action', deltas, fired);
        this.stats.actionUsed.set(action.name, (this.stats.actionUsed.get(action.name) ?? 0) + 1);
        this.state.busyUntil = t + Math.max(1, action.cost);
        this.log({ tick: t, kind: 'action', id: action.name });
      }
    }

    // 3. 力迫与带触发的和弦（已按偏序排好）
    for (const rule of this.orderedRules) {
      if (rule.kind === 'chord' && !rule.guard) continue;
      if (this.state.fired[rule.id] && !rule.repeat) continue;
      const ready = this.state.cooldownUntil[rule.id] ?? 0;
      if (t < ready) continue;
      if (rule.guard && !truthy(evalExpr(rule.guard, this.state))) continue;
      this.applyEffects(rule.effects, rule.name, rule.kind, deltas, fired);
      this.state.fired[rule.id] = true;
      if (rule.repeat && rule.cooldown > 0) this.state.cooldownUntil[rule.id] = t + rule.cooldown;
      if (rule.kind === 'forcing') this.stats.forcingFired.add(rule.name);
      fired.push(rule.name);
      this.log({ tick: t, kind: rule.kind === 'chord' ? 'chord' : 'forcing', id: rule.name });
    }

    // 4. 传导耦合：这一拍的变化，下一拍抵达邻弦
    this.propagate(deltas, t);

    // 5. 公理
    for (const ax of this.axioms) {
      if (!truthy(evalExpr(ax.expr, this.state))) {
        const v = this.snapshotValues();
        violations.push({ tick: t, axiom: ax.name, values: v });
        this.violationBuffer.push({ tick: t, axiom: ax.name, values: v });
        this.stats.violations++;
        this.log({ tick: t, kind: 'axiom', id: ax.name });
      }
    }

    // 6. 结局
    if (!this.state.ended) {
      for (const en of this.endings) {
        if (truthy(evalExpr(en.guard, this.state))) {
          this.state.ended = { id: en.id, name: en.name, tick: t };
          this.log({ tick: t, kind: 'ending', id: en.name });
          break;
        }
      }
    }

    // 7. 信号
    for (const sg of this.signals) {
      const now = truthy(evalExpr(sg.guard, this.state));
      const was = this.state.signalWas[sg.id] ?? false;
      this.state.signalWas[sg.id] = now;
      if (now && !was) {
        this.stats.signalFired.add(sg.name);
        for (const cue of sg.cues) {
          this.stats.cueCount++;
          if (this.cueBuffer.length < MAX_CUES) {
            const item: EmittedCue = { tick: t, signal: sg.name, cue };
            this.cueBuffer.push(item);
            cues.push(item);
          }
        }
        this.log({ tick: t, kind: 'signal', id: sg.name });
      }
    }

    // 8. 阈值穿越
    this.trackCrossings(t);

    // 9. 段落推进
    this.advancePhase();

    // 10. 谱：受迫模式先向锚点衰减，再按入队顺序叠加本拍调制（锚点不动）。
    this.applySpectrumTick();

    this.stats.ticks++;
    this.state.tick = t + 1;

    // 11. 死局检测：进入下一拍后仍没有任何可做的事（「忙」不算死局）
    if (!this.state.ended && !this.anyActionAllowed()) {
      this.stats.deadStates++;
    }

    return {
      tick: t,
      cues,
      fired,
      violations,
      ending: this.state.ended,
      deltas: Object.fromEntries(deltas),
    };
  }

  run(maxTicks: number): void {
    while (!this.ended && this.state.tick < maxTicks) this.tick();
  }

  // ---------- 快照 / 分叉 ----------

  snapshot(): WorldState {
    return cloneState(this.state);
  }

  restore(s: WorldState): void {
    this.state = cloneState(s);
    // 旧快照可能没有 spectra / matrices：用 IR 里的作者数据补齐，避免恢复后
    // 谱或关系谱凭空消失。旧快照的谱条目也可能缺少 v2.1a 的采样元数据，
    // 关系谱则整体是 v2.3a 新增的字段，统一从 IR 重写元数据/静态数据。
    this.ensureSpectrumState(true);
    this.ensureMatrixState(true);
  }

  /** 从当前状态分叉出一个新宇宙（力迫的 V[G]）。 */
  branch(label?: string): Universe {
    const u = new Universe(this.ir, { seed: this.state.rng, log: this.logEnabled });
    u.state = cloneState(this.state);
    u.ensureSpectrumState(true);
    u.ensureMatrixState(true);
    // 尚未 tick 的谱调制也是「当下状态」的一部分；分叉时一起带走。
    u.pendingSpectrumModulations = this.pendingSpectrumModulations.map((m) => ({ ...m }));
    if (label) u.state.branch = label;
    return u;
  }

  takeCues(): EmittedCue[] {
    return this.cueBuffer.splice(0, this.cueBuffer.length);
  }

  takeViolations(): AxiomViolation[] {
    return this.violationBuffer.splice(0, this.violationBuffer.length);
  }

  // ---------- 内部 ----------

  /**
   * 确保每条 IR 谱在当前状态里都有可变槽位（兼容没有 spectra 的旧快照）。
   *
   * `rebuildFromIR` 为 true 时（restore / branch），把 v2.1a 的采样元数据
   * 一律从 IR 重写：旧快照在 clone 时已经回退到 0..1 / 线性 / 不循环，
   * 只有 IR 知道这条谱真正的插值与循环方式。
   */
  private ensureSpectrumState(rebuildFromIR = false): void {
    if (!this.state.spectra) this.state.spectra = {};
    for (const ir of this.spectra.values()) {
      const st = this.state.spectra[ir.id];
      if (!st) {
        this.state.spectra[ir.id] = createSpectrumState(ir);
        continue;
      }
      if (rebuildFromIR) {
        st.mode = ir.mode;
        st.min = ir.min;
        st.max = ir.max;
        st.interpolation = ir.interpolation;
        st.loop = ir.loop;
        continue;
      }
      if (st.mode !== '固定' && st.mode !== '受迫') st.mode = ir.mode;
      if (typeof st.min !== 'number' || !Number.isFinite(st.min)) st.min = ir.min;
      if (typeof st.max !== 'number' || !Number.isFinite(st.max)) st.max = ir.max;
      if (st.interpolation !== '线性' && st.interpolation !== '平滑') st.interpolation = ir.interpolation;
      if (typeof st.loop !== 'boolean') st.loop = ir.loop;
    }
  }

  /**
   * 确保每条 IR 关系谱在当前状态里都有静态数据槽位（v2.3a）。
   *
   * 关系谱数据在运行时不可变，所以 `rebuildFromIR` 时直接从 IR 整体重建：
   * restore / branch 拿到旧快照（没有 `matrices`）时，曲线和采样元数据
   * 不会凭空消失。普通构造只补缺失的条目，不覆盖已有副本。
   */
  private ensureMatrixState(rebuildFromIR = false): void {
    if (!this.state.matrices) this.state.matrices = {};
    for (const ir of this.ir.matrices) {
      if (rebuildFromIR || !this.state.matrices[ir.id]) {
        this.state.matrices[ir.id] = createMatrixState(ir);
      }
    }
  }

  /**
   * 谱的一拍：
   *   1. 受迫模式的每条谱先把当前偏移乘 FORCED_DECAY 收回锚点（每拍一次）；
   *   2. 再按入队顺序应用本拍调制，每次写入都夹回范围；
   *   3. 清空队列——调制只影响下一拍。
   */
  private applySpectrumTick(): void {
    const spectra = this.state.spectra;
    if (!spectra) return;

    for (const [id, st] of Object.entries(spectra)) {
      if (st.mode !== '受迫') continue;
      const ir = this.spectra.get(id);
      if (!ir) continue;
      const n = Math.min(st.anchors.length, st.values.length);
      for (let i = 0; i < n; i++) {
        const anchor = st.anchors[i]!;
        const value = st.values[i]!;
        st.values[i] = clampSpectrum(ir, anchor + (value - anchor) * FORCED_DECAY);
      }
    }

    if (this.pendingSpectrumModulations.length === 0) return;
    for (const mod of this.pendingSpectrumModulations) {
      const st = spectra[mod.id];
      const ir = this.spectra.get(mod.id);
      if (!st || !ir) continue;
      for (let i = mod.from; i <= mod.to; i++) {
        const value = st.values[i];
        if (value === undefined) continue;
        st.values[i] = clampSpectrum(ir, value + mod.delta);
      }
    }
    this.pendingSpectrumModulations = [];
  }

  private rulesById(id: string): IRRule | undefined {
    return this.forces.find((r) => r.id === id) ?? this.chords.get(id) ?? this.actions.get(id);
  }

  private stillAvailable(rule: IRRule): boolean {
    return !rule.guard || truthy(evalExpr(rule.guard, this.state));
  }

  private get orderedRules(): IRRule[] {
    // 惰性计算：力迫按「先于」做拓扑排序，和弦/动作不参与全局顺序。
    if (!this.cachedOrder) this.cachedOrder = this.computeOrder();
    return this.cachedOrder;
  }

  private cachedOrder: IRRule[] | undefined;

  private computeOrder(): IRRule[] {
    const forces = [...this.forces];
    const byName = new Map(forces.map((f) => [f.name, f]));
    const indeg = new Map<string, number>();
    const outs = new Map<string, string[]>();
    for (const f of forces) {
      indeg.set(f.id, 0);
      outs.set(f.id, []);
    }
    for (const f of forces) {
      for (const b of f.before) {
        const target = byName.get(b);
        if (!target) continue;
        outs.get(f.id)!.push(target.id);
        indeg.set(target.id, (indeg.get(target.id) ?? 0) + 1);
      }
    }
    const ready = forces.filter((f) => (indeg.get(f.id) ?? 0) === 0);
    ready.sort((a, b) => b.priority - a.priority);
    const out: IRRule[] = [];
    while (ready.length > 0) {
      const f = ready.shift()!;
      out.push(f);
      for (const next of outs.get(f.id) ?? []) {
        indeg.set(next, (indeg.get(next) ?? 1) - 1);
        if ((indeg.get(next) ?? 0) === 0) {
          const r = forces.find((x) => x.id === next);
          if (r) ready.push(r);
        }
      }
      ready.sort((a, b) => b.priority - a.priority);
    }
    // 兜底：环或漏掉的规则按优先级补在后面（编译器本应已拦住环）
    for (const f of forces) if (!out.includes(f)) out.push(f);

    const chords = [...this.chords.values()].filter((c) => !!c.guard);
    const s = out.length + chords.length;
    void s;
    return [...out, ...chords];
  }

  private deliverPending(t: number, deltas: Map<string, number>): void {
    if (this.state.pending.length === 0) return;
    const due = this.state.pending.filter((p) => p.due <= t);
    if (due.length === 0) return;
    this.state.pending = this.state.pending.filter((p) => p.due > t);
    for (const p of due) {
      const s = this.strings.get(p.id);
      if (!s || s.domain.type !== 'number') continue;
      const before = this.number(p.id);
      const next = clampString(s, before + p.delta);
      this.state.values[p.id] = next;
      const actual = next - before;
      if (actual !== 0) deltas.set(p.id, (deltas.get(p.id) ?? 0) + actual);
    }
  }

  private applyEffects(
    effects: IREffect[],
    source: string,
    kind: 'forcing' | 'chord' | 'action',
    deltas: Map<string, number>,
    fired: string[],
  ): void {
    for (const e of effects) {
      if (e.k === 'apply') {
        const chord = this.chords.get(e.chord);
        if (!chord) continue;
        this.applyEffects(chord.effects, source, 'chord', deltas, fired);
        this.log({ tick: this.state.tick, kind: 'chord', id: chord.name, detail: `由 ${source} 施加` });
        continue;
      }
      const s = this.strings.get(e.id);
      if (!s) continue;
      const raw = evalExpr(e.value, this.state);
      const before = this.state.values[e.id];

      switch (s.domain.type) {
        case 'number': {
          const n = typeof raw === 'number' ? raw : asNumber(raw);
          const cur = typeof before === 'number' ? before : asNumber(before ?? null);
          let next: number;
          if (e.k === 'set') next = n;
          else if (e.k === 'add') next = cur + n;
          else next = cur - n;
          next = clampString(s, next);
          this.state.values[e.id] = next;
          const delta = next - cur;
          if (delta !== 0) deltas.set(e.id, (deltas.get(e.id) ?? 0) + delta);
          break;
        }
        case 'boolean': {
          if (e.k === 'set') this.state.values[e.id] = truthy(raw);
          break;
        }
        case 'set': {
          const cur = before instanceof Set ? new Set(before) : new Set<string>();
          if (e.k === 'set') {
            if (raw instanceof Set) this.state.values[e.id] = new Set([...raw].map(String));
            else if (Array.isArray(raw)) this.state.values[e.id] = new Set(raw.map(String));
            else if (raw !== null) this.state.values[e.id] = new Set([String(raw)]);
            else this.state.values[e.id] = new Set<string>();
          } else if (e.k === 'add') {
            if (raw !== null) cur.add(String(raw));
            this.state.values[e.id] = cur;
          } else {
            if (raw !== null) cur.delete(String(raw));
            this.state.values[e.id] = cur;
          }
          break;
        }
        case 'text':
        case 'enum':
        case 'ref': {
          if (e.k === 'set') this.state.values[e.id] = raw === null ? null : String(raw);
          break;
        }
      }
      this.log({
        tick: this.state.tick,
        kind: kind === 'action' ? 'action' : kind === 'chord' ? 'chord' : 'forcing',
        id: source,
        detail: `${e.id} ${e.k}`,
      });
    }
  }

  private propagate(deltas: Map<string, number>, t: number): void {
    for (const [id, delta] of deltas) {
      if (delta === 0) continue;
      const outs = this.couplingByFrom.get(id);
      if (!outs) continue;
      const from = this.strings.get(id);
      if (!from || from.domain.type !== 'number') continue;
      const fromRange = rangeOf(from, 100);
      for (const c of outs) {
        if (c.guard && !truthy(evalExpr(c.guard, this.state))) continue;
        const target = this.strings.get(c.to);
        if (!target) continue;
        const targetRange = rangeOf(target, 100);
        // 强度 = 源弦归一化变化的多少比例会传到目标弦（再换算到目标弦的量程）。
        const normalized = delta / fromRange;
        const factor = curveFactor(c.curve, Math.abs(normalized));
        const strength = c.strengthExpr ? asNumber(evalExpr(c.strengthExpr, this.state)) : c.strength;
        const applied = normalized * strength * c.polarity * factor * targetRange;
        this.state.pending.push({ due: t + 1 + c.delay, id: c.to, delta: applied });
        this.stats.couplingFired.add(c.id);
        this.log({ tick: t, kind: 'coupling', id: `${c.from}→${c.to}`, detail: String(applied) });
      }
    }
  }

  private checkEndingAfterEffects(): void {
    // 结局在 tick 内统一判定；此方法保留给外部扩展
  }

  private advancePhase(): void {
    const phases = this.ir.phases;
    if (phases.length === 0) return;
    this.state.phaseTick++;
    const cur = phases[this.state.phaseIndex]!;
    if (this.state.phaseTick >= cur.duration) {
      this.state.phaseIndex = (this.state.phaseIndex + 1) % phases.length;
      this.state.phaseTick = 0;
    }
  }

  private trackCrossings(t: number): void {
    for (const s of this.ir.strings) {
      if (s.domain.type !== 'number') continue;
      if (s.verge === undefined && s.safe === undefined) continue;
      const before = this.prevValues[s.id];
      const after = this.state.values[s.id];
      if (typeof before !== 'number' || typeof after !== 'number') continue;
      for (const [line, v] of [
        ['verge', s.verge],
        ['safe', s.safe],
      ] as const) {
        if (v === undefined) continue;
        const wasAbove = before >= v;
        const isAbove = after >= v;
        if (wasAbove !== isAbove) {
          this.stats.crossings.set(`${s.id}.${line}`, (this.stats.crossings.get(`${s.id}.${line}`) ?? 0) + 1);
          this.log({ tick: t, kind: 'signal', id: `${s.id}.${line}` });
        }
      }
    }
  }

  private snapshotValues(): AxiomViolation['values'] {
    const out: AxiomViolation['values'] = {};
    for (const [k, v] of Object.entries(this.state.values)) {
      out[k] = v instanceof Set ? [...v].sort() : v;
    }
    return out;
  }

  private log(e: TimelineEvent): void {
    if (!this.logEnabled) return;
    if (this.state.log.length < MAX_LOG) this.state.log.push(e);
  }
}

function rangeOf(s: IRString, fallback: number): number {
  const d = s.domain;
  if (d.type !== 'number') return fallback;
  if (d.min !== undefined && d.max !== undefined && d.max > d.min) return d.max - d.min;
  return fallback;
}

function clampSpectrum(spectrum: IRSpectrum, value: number): number {
  return Math.min(spectrum.max, Math.max(spectrum.min, value));
}

function curveFactor(curve: IRCoupling['curve'], magnitude: number): number {
  const m = Math.min(1, Math.max(0, magnitude));
  switch (curve) {
    case '缓入':
      return m;
    case '缓出':
      return Math.sqrt(m);
    case '阶跃':
      return m > 0 ? 1 : 0;
    default:
      return 1;
  }
}
