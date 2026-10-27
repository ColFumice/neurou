import type { ResponseCurve, StringKind } from './ast.js';
import type { Span } from './source.js';

/**
 * 弦网络图 —— 产品的唯一真源。
 *
 * 文本语言、调律台的可视化、批量模拟、认证报告，全都是这张图的投影。
 * 这个顺序很重要：如果先定文本语法再让 GUI 去猜结构，文本形态会反复
 * 推翻图形态；反过来，图稳定之后，文本只是它的一种渲染格式。
 *
 * 图里只有五类东西：
 *   节点  —— 弦、实体、规则、信号、结局、段落
 *   边    —— 耦合、归属、触发、呈现
 *   标签  —— 弦类型、求解器、调性
 *   初值  —— 基线
 *   不变量—— 公理
 */

export type Value = number | boolean | string | string[] | null;

export type IRDomain =
  | { type: 'number'; min?: number; max?: number }
  | { type: 'boolean' }
  | { type: 'enum'; values: string[] }
  | { type: 'set'; elementKind?: string }
  | { type: 'text' }
  | { type: 'ref'; entityKind?: string };

/** 求值后的表达式（已把路径解析成弦 id）。 */
export type LExpr =
  | { k: 'const'; v: Value }
  | { k: 'read'; id: string }
  | { k: 'bin'; op: string; l: LExpr; r: LExpr }
  | { k: 'un'; op: '-' | '+' | '非'; e: LExpr }
  | { k: 'call'; fn: string; args: LExpr[] };

export type IREffect =
  | { k: 'set' | 'add' | 'sub'; id: string; value: LExpr }
  | { k: 'apply'; chord: string };

export interface IREntity {
  id: string;
  name: string;
  typeName?: string;
  fields?: Record<string, string>;
}

export interface IRString {
  /** 规范 id：全局弦为名字，实体弦为「实体.名字」 */
  id: string;
  name: string;
  kind: StringKind;
  domain: IRDomain;
  baseline: Value;
  /** 悬崖线（越过它进入危险侧） */
  verge?: number;
  /** 安全线 */
  safe?: number;
  response: ResponseCurve;
  owner?: string;
  /** 关系弦的客体 */
  target?: string;
  /** 音色引用：某条谱的 id（v2.0） */
  timbre?: string;
  note?: string;
  span?: Span;
}

export interface IRCoupling {
  id: string;
  from: string;
  to: string;
  /** +1 同向，-1 反向 */
  polarity: 1 | -1;
  strength: number;
  /** 延迟的拍数 */
  delay: number;
  curve: ResponseCurve;
  guard?: LExpr;
  /** 属于哪条回路（若有） */
  loop?: string;
  span?: Span;
}

export interface IRLoop {
  id: string;
  name: string;
  /** 组成这条回路的耦合边 id，按环顺序 */
  edges: string[];
  /** 极性乘积：+1 自我强化（正反馈），-1 自我校正（负反馈） */
  polarity: 1 | -1;
  span?: Span;
}

export type IRRuleKind = 'forcing' | 'chord' | 'action';

export interface IRRule {
  /** 规范 id：forcing:名字 / chord:名字 / action:名字 */
  id: string;
  kind: IRRuleKind;
  name: string;
  guard?: LExpr;
  effects: IREffect[];
  /** 不可逆：一旦触发，这一局不能回退 */
  irreversible: boolean;
  /** 越大越先判定 */
  priority: number;
  /** 偏序：本规则必须先于这些力迫 */
  before: string[];
  /** 是否可以在条件再次成立时重复触发 */
  repeat: boolean;
  /** 重复触发的冷却拍数；0 表示无冷却 */
  cooldown: number;
  /** 动作的耗时拍数；非动作为 0 */
  cost: number;
  note?: string;
  span?: Span;
}

export interface IRCue {
  k: '台词' | '视觉' | '音频' | '触觉' | '字幕' | '提示';
  speaker?: string;
  param?: string;
  value?: number;
  text?: string;
}

export interface IRSignal {
  id: string;
  name: string;
  guard: LExpr;
  cues: IRCue[];
  span?: Span;
}

export interface IRAxiom {
  id: string;
  name: string;
  expr: LExpr;
  span?: Span;
}

export interface IREnding {
  id: string;
  name: string;
  guard: LExpr;
  span?: Span;
}

export interface IRPhase {
  id: string;
  name: string;
  /** 段落长度，单位：拍 */
  duration: number;
}

/**
 * 谱：一组采样音段 + 插值方式 + 调制模式。
 * 运行时读取见 packages/runtime/src/engine.ts。
 */
export interface IRSpectrum {
  id: string;
  name: string;
  bands: number[];
  min: number;
  max: number;
  interpolation: '线性' | '平滑';
  loop: boolean;
  /** 调制模式：固定（持久叠加）或受迫（每拍衰减回锚点）。 */
  mode: '固定' | '受迫';
  /** 演奏方式：拨弦（一次性）或持续（按住发声）。 */
  articulation: '拨弦' | '持续';
  span?: Span;
}

/** 关系谱里一个格子的时间曲线（v2.3a）；标签定位到 rows/cols。 */
export interface IRMatrixCurve {
  row: string;
  col: string;
  /** 1..64 个有限采样值，位置 0..1 均匀分布。 */
  bands: number[];
}

/**
 * 关系谱：一张「行 × 列」数值矩阵（v2.1c），v2.3a 起格子可以带时间曲线。
 *
 * `values`（`段`）始终保留，是所有格子的标量回退值；没有曲线的格子由
 * `查关系谱` 在编译期折叠成该值（三参数恒如此，四参数也如此），有曲线的
 * 格子由四参数版本在运行时采样。曲线和采样元数据随 WorldState 复制，
 * 保证规则/结局只凭状态就能求值。
 */
export interface IRMatrix {
  id: string;
  name: string;
  rows: string[];
  cols: string[];
  values: number[][];
  curves: IRMatrixCurve[];
  interpolation: '线性' | '平滑';
  loop: boolean;
  span?: Span;
}

export interface WorldIR {
  format: 'neurou/ir-0.1';
  name: string;
  meta: Record<string, string | number>;
  entities: IREntity[];
  strings: IRString[];
  spectra: IRSpectrum[];
  matrices: IRMatrix[];
  couplings: IRCoupling[];
  loops: IRLoop[];
  rules: IRRule[];
  axioms: IRAxiom[];
  signals: IRSignal[];
  phases: IRPhase[];
  endings: IREnding[];
  /** 编译期统计，供引擎盖与认证报告使用 */
  stats: {
    strings: number;
    spectra: number;
    matrices: number;
    couplings: number;
    loops: number;
    rules: number;
    signals: number;
    endings: number;
  };
}

export function isNumericString(s: IRString): boolean {
  return s.domain.type === 'number';
}

/** 弦的「好的方向」：+1 越高越好，-1 越低越好，0 无偏好。 */
export function preferenceOf(s: IRString): 1 | -1 | 0 {
  if (s.domain.type !== 'number') return 0;
  if (s.verge === undefined || s.safe === undefined) return 0;
  // 悬崖在低处 → 越高越好；悬崖在高处 → 越低越好
  return s.verge < s.safe ? 1 : -1;
}

/** 把弦的当前值归一化到 0..1 的「健康位置」。 */
export function wellnessOf(s: IRString, value: number): number {
  const pref = preferenceOf(s);
  if (pref === 0) return 0.5;
  const min = s.domain.type === 'number' && s.domain.min !== undefined ? s.domain.min : 0;
  const max = s.domain.type === 'number' && s.domain.max !== undefined ? s.domain.max : 100;
  const span = max - min || 1;
  const t = (value - min) / span;
  return pref === 1 ? t : 1 - t;
}

/** 生成一个可读的弦值快照，用于报告与存档。 */
export function stateSignature(world: WorldIR, values: Record<string, Value>): string {
  return world.strings
    .map((s) => {
      const v = values[s.id];
      if (Array.isArray(v)) return `${s.id}=[${[...v].sort().join(',')}]`;
      if (typeof v === 'number') return `${s.id}=${Math.round(v * 100) / 100}`;
      return `${s.id}=${String(v)}`;
    })
    .join(';');
}
