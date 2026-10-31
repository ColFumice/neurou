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
  /** v5.19：纯函数形参；只出现在函数体内。 */
  | { k: 'param'; name: string }
  | { k: 'bin'; op: string; l: LExpr; r: LExpr }
  | { k: 'un'; op: '-' | '+' | '非'; e: LExpr }
  | {
      k: 'call';
      fn: string;
      args: LExpr[];
      /** v5.19：用户函数调用携带可求值函数体，序列化只写函数名+实参。 */
      user?: { params: string[]; body: LExpr; name: string };
    };

export type IREffect =
  | { k: 'set' | 'add' | 'sub'; id: string; value: LExpr }
  | { k: 'matrixSet' | 'matrixAdd' | 'matrixSub'; matrix: string; row: string; col: string; value: LExpr }
  | { k: 'apply'; chord: string }
  /** v5.3：在当前 tick 收尾时切换场景。 */
  | { k: 'scene'; scene: string };

export interface IREntity {
  id: string;
  name: string;
  typeName?: string;
  fields?: Record<string, string>;
}

export interface IRString {
  /** 规范 id：全局弦为名字，实体弦为「实体.名字」 */
  id: string;
  /** v5.11：字符串命名空间；仅作为来源标记，不改变 id/运行时。 */
  namespace?: string;
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
  /** v5.43：持续型弦的可编辑波形（0..1）。 */
  waveform?: number[];
  note?: string;
  span?: Span;
}

export interface IRCoupling {
  id: string;
  from: string;
  to: string;
  /** +1 同向，-1 反向 */
  polarity: 1 | -1;
  /** 静态强度（无 strengthExpr 时使用）。 */
  strength: number;
  /** v2.5：运行期求值的强度表达式（例如查关系谱 + 此刻）。 */
  strengthExpr?: LExpr;
  /** 延迟的拍数 */
  delay: number;
  /** v2.11：运行期求值的延迟表达式（拍数，非负；四舍五入）。 */
  delayExpr?: LExpr;
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
  /** v4.3：结局专属下一章；缺省用世界元数据「下一章」。 */
  nextChapter?: string;
  /** v4.5：结局的多个出口，按声明顺序；GUI 会显示选择列表。 */
  nextChapters?: string[];
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
  interpolation: '线性' | '平滑' | '阶跃';
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
  /** v2.12：该格插值覆盖；未设时沿用矩阵级插值。 */
  interpolation?: '线性' | '平滑' | '阶跃';
  /** v2.14：该格循环覆盖；未设时沿用矩阵级循环。 */
  loop?: boolean;
  /** v2.15：该格自己的时间速度；未设时沿用矩阵级。 */
  speed?: number;
  /** v2.15：该格自己的时间相位；未设时沿用矩阵级。 */
  phase?: number;
}

export interface IRMatrixDynamic {
  row: string;
  col: string;
  expr: LExpr;
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
  /** v2.19：动态标量格；有曲线的格子不能再有动态值。 */
  dynamics?: IRMatrixDynamic[];
  interpolation: '线性' | '平滑' | '阶跃';
  loop: boolean;
  /** v2.4：曲线的世界时间周期（拍）；有它时 GUI 播放头可跟随运行时 tick。 */
  period?: number;
  /** v2.6：时间轴速度倍率，默认 1。 */
  speed: number;
  /** v2.6：时间轴相位 0..1，默认 0。 */
  phase: number;
  /** v2.7：相位源（另一张关系谱的曲线）；存在时用它采样出的 0..1 值替代 phase。 */
  phaseSource?: { matrix: string; row: string; col: string };
  span?: Span;
}

/** v3.7：外部音频资产；cue 参数名匹配时优先播放它。 */
export interface IRAudioAsset {
  id: string;
  name: string;
  /** 只允许 audio/ 下的一层文件；GUI 解析为站内路径。 */
  src: string;
}

/** v3.8：世界配乐；播放层根据它启动循环音频。 */
export interface IRBgm {
  /** 音频资产的 id/名字。 */
  asset: string;
  volume: number;
  loop: boolean;
}

/** v5.1：运行层系统。 */
export interface IRSystem {
  id: string;
  name: string;
  phase: '投递' | '输入' | '规则' | '传导' | '校验' | '终止' | '观测' | '收尾';
  every: boolean;
  guard?: LExpr;
  effects: IREffect[];
  span?: Span;
}

/** v5.1：运行层场景。 */
export interface IRPortParam {
  name: string;
  /** 已解析的弦 id。 */
  string: string;
}

/** v5.6：后端端口契约；GLSL/Faust 只消费这些类型化参数。 */
export interface IRPort {
  id: string;
  name: string;
  kind: '视觉' | '音频';
  params: IRPortParam[];
  /** v5.29：视觉端口的程序化纹理；音频端口没有。 */
  texture?: { pattern: string; scale: number };
  /** v5.30：视觉端口绑定的纹理资产。 */
  textureAsset?: { name: string; src: string };
  /** v6.15：音频端口参数自动化包络（0..1），周期 = bands.length * 4 拍。 */
  automation?: number[];
  /** v6.16：视觉端口后处理链参数（0..1）。 */
  post?: { vignette: number; grain: number; tint: number };
}

/** v5.30：视觉纹理资产。 */
export interface IRTextureAsset {
  id: string;
  name: string;
  src: string;
}

export interface IRScene {
  id: string;
  name: string;
  systems: string[];
  enter: IREffect[];
  exit: IREffect[];
  span?: Span;
}

/** v5.14：命名空间导出清单；短名引用只对导出项生效。 */
export interface IRNamespace {
  name: string;
  exports: string[];
}

/** v5.18：纯函数作者结构；运行时调用已内联，IR 保留它用于序列化/工具。 */
export interface IRFunction {
  id: string;
  name: string;
  params: string[];
  /** v5.22：与 params 对齐的类型标注；null 表示未标注。 */
  paramTypes?: (string | null)[];
  /** v5.22：返回类型标注；null/缺省表示未标注。 */
  returnType?: string | null;
  /** v5.23：局部变量源码（作者结构；运行时已展开）。 */
  locals?: { name: string; source: string }[];
  /** v5.24：当分支源码（作者结构；运行时已展开）。 */
  branches?: { condSource: string; bodySource: string; locals?: { name: string; source: string }[] }[];
  /** v5.25：显式否则分支。 */
  otherwise?: { bodySource: string; locals?: { name: string; source: string }[] };
  bodySource: string;
  /** v5.20：lower 后的函数体（含 param 节点），运行时按函数表查找。 */
  body?: LExpr;
}

/** v1.21：运行期音频覆盖层（F10/F9 可写回）。 */
export interface IRAudioConfig {
  kind: StringKind;
  reverb: number;
  cutoff: number;
  resonance: number;
  drive: number;
  lfoRate: number;
  lfoDepth: number;
  span?: Span;
}

/** v1.21：流场节点覆盖层。节点字段顺序与 FlowField FlowNode 对齐。 */
export interface IRFlowNode {
  x: number;
  y: number;
  radius: number;
  tension: number;
  depth: number;
  diffusion: number;
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  lfoRate: number;
  lfoDepth: number;
  bits: number;
  sampleRate: number;
  layer: number;
}

export interface IRFlowProfile {
  kind: StringKind;
  nodes: IRFlowNode[];
  span?: Span;
}

/** v1.33：世界内实时小游戏绑定。 */
export interface IRGame {
  name: string;
  module: string;
  resultString: string;
  /** 编译期解析出的弦 id；校验失败时缺省。 */
  resultStringId?: string;
  winScore: number;
  winAction?: string;
  winEnding?: string;
  loseEnding?: string;
  winSignal?: string;
  loseSignal?: string;
  description?: string;
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
  /** v1.21：运行期音频覆盖层。 */
  audioConfigs?: IRAudioConfig[];
  /** v1.21：流场节点覆盖层。 */
  flowProfiles?: IRFlowProfile[];
  /** v1.33：世界内实时小游戏。 */
  games?: IRGame[];
  /** v3.7：信号音频 cue 可用的资产。 */
  audioAssets?: IRAudioAsset[];
  /** v5.30：视觉端口可绑定的纹理资产。 */
  textureAssets?: IRTextureAsset[];
  /** v3.8：世界循环配乐。 */
  bgm?: IRBgm;
  /** v5.1：运行层系统；不是世界本体。 */
  systems?: IRSystem[];
  /** v5.1：运行层场景；按声明顺序，第一个是默认场景。 */
  scenes?: IRScene[];
  /** v5.6：视觉/音频后端端口；不是弦网络本体。 */
  ports?: IRPort[];
  /** v5.14：命名空间导出清单。 */
  namespaces?: IRNamespace[];
  /** v5.18：用户定义纯函数（编译期内联，IR 保留作者结构）。 */
  functions?: IRFunction[];
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
