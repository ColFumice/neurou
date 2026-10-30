import type { Span } from './source.js';

/**
 * 抽象语法树。
 *
 * 注意：AST 不是产品的「唯一真源」。唯一真源是弦网络图（见 ir.ts）。
 * AST 只是文本投影解析出来的一次性形态，编译器会把它下降成图。
 * 这样未来 GUI 直接编辑图时，文本只是一种「渲染格式」，不会反过来
 * 挟持数据结构。
 */

export const STRING_KINDS = ['叙事', '视觉', '动画', '物理', '控制', '空间', '认知', '关系'] as const;
export type StringKind = (typeof STRING_KINDS)[number];

/** v5.34：弦的演奏/判定方式。尾判型才有「拉弦后松手」操作。 */
export type StringInteraction = '持续' | '头判' | '尾判';

/**
 * 弦类别 → 交互方式：
 * - 持续：按下持续发声，松手停；适合连续介质（视觉/动画/物理/空间）。
 * - 头判：按下即判定/发声，无拉弦；适合离散指令（控制）。
 * - 尾判：按住拉弦，松手才发声/判定；适合叙事、认知、关系。
 */
export const STRING_INTERACTIONS: Record<StringKind, StringInteraction> = {
  叙事: '尾判',
  视觉: '持续',
  动画: '持续',
  物理: '持续',
  控制: '头判',
  空间: '持续',
  认知: '尾判',
  关系: '尾判',
};

/** 8 类弦的固定顺序（与 STRING_KINDS 同源，供调律台等视图使用）。 */
export const KIND_ORDER = STRING_KINDS;

export const STRING_KEYWORDS: Record<string, StringKind> = {
  叙事弦: '叙事',
  视觉弦: '视觉',
  动画弦: '动画',
  物理弦: '物理',
  控制弦: '控制',
  空间弦: '空间',
  认知弦: '认知',
  关系弦: '关系',
};

export type ResponseCurve = '线性' | '缓入' | '缓出' | '阶跃';

export type BinOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '且' | '或';

export type Expr =
  | { k: 'num'; v: number; span: Span }
  | { k: 'bool'; v: boolean; span: Span }
  | { k: 'str'; v: string; span: Span }
  | { k: 'set'; items: string[]; span: Span }
  | { k: 'path'; parts: string[]; span: Span }
  | { k: 'bin'; op: BinOp; left: Expr; right: Expr; span: Span }
  | { k: 'un'; op: '-' | '+' | '非'; operand: Expr; span: Span }
  | { k: 'if'; cond: Expr; then: Expr; otherwise: Expr; span: Span }
  | { k: 'call'; name: string; args: Expr[]; span: Span };

export type DomainAst =
  | { type: 'number'; min?: number; max?: number }
  | { type: 'boolean' }
  | { type: 'enum'; values: string[] }
  | { type: 'set'; elementKind?: string }
  | { type: 'text' }
  | { type: 'ref'; entityKind?: string };

export interface EffectAst {
  k: 'set' | 'add' | 'sub' | 'apply' | 'scene';
  target?: string[];
  value?: Expr;
  chord?: string;
  /** v5.3：切换运行场景。 */
  scene?: string;
  /** v2.17：直接改关系谱标量格；target 为空。 */
  matrix?: { name: string; row: string; col: string };
  span: Span;
}

export type CueAst =
  | { k: '台词'; speaker?: string; text: string; span: Span }
  | { k: '视觉' | '音频'; param: string; value: number; span: Span }
  | { k: '触觉' | '字幕' | '提示'; text: string; span: Span };

export interface DeclBase {
  span: Span;
}

export interface WorldDecl extends DeclBase {
  k: 'world';
  name: string;
  meta: { key: string; value: string | number }[];
}

export interface StringDecl extends DeclBase {
  k: 'string';
  stringKind: StringKind;
  name: string;
  /** v5.11：编译期由命名空间写入。 */
  namespace?: string;
  domain?: DomainAst;
  baseline?: Expr;
  verge?: Expr;
  safe?: Expr;
  response?: ResponseCurve;
  visible?: boolean;
  target?: string;
  /** 音色引用：某条谱的名字（v2.0）。 */
  timbre?: string;
  /** v5.43：持续型弦的可编辑波形（0..1）。 */
  waveform?: number[];
  note?: string;
  /** 所属实体（嵌套声明时由 parser 填入） */
  owner?: string;
}

export interface EntityDecl extends DeclBase {
  k: 'entity';
  name: string;
  typeName?: string;
  strings: StringDecl[];
  fields: { key: string; value: string; span: Span }[];
}

export interface CouplingDecl extends DeclBase {
  k: 'coupling';
  from: string[];
  to: string[];
  polarity: 1 | -1;
  strength?: Expr;
  delay?: Expr;
  guard?: Expr;
  curve?: ResponseCurve;
}

export interface LoopEdgeAst {
  from: string[];
  to: string[];
  polarity: 1 | -1;
  strength?: number;
  delay?: number;
  span: Span;
}

export interface LoopDecl extends DeclBase {
  k: 'loop';
  name: string;
  edges: LoopEdgeAst[];
}

export interface ForcingDecl extends DeclBase {
  k: 'forcing';
  name: string;
  guard?: Expr;
  effects: EffectAst[];
  irreversible: boolean;
  priority: number;
  before: string[];
  repeat: boolean;
  cooldown?: number;
  note?: string;
}

export interface ChordDecl extends DeclBase {
  k: 'chord';
  name: string;
  guard?: Expr;
  effects: EffectAst[];
  repeat: boolean;
  note?: string;
}

export interface AxiomDecl extends DeclBase {
  k: 'axiom';
  name: string;
  expr: Expr;
}

export interface SignalDecl extends DeclBase {
  k: 'signal';
  name: string;
  guard: Expr;
  cues: CueAst[];
}

export interface ActionDecl extends DeclBase {
  k: 'action';
  name: string;
  guard?: Expr;
  cost: number;
  effects: EffectAst[];
  note?: string;
}

/** v5.1：运行层阶段。默认顺序与旧固定 tick 对齐。 */
export const SYSTEM_PHASES = ['投递', '输入', '规则', '传导', '校验', '终止', '观测', '收尾'] as const;
export type SystemPhase = (typeof SYSTEM_PHASES)[number];

/** v5.1：系统是调度单元，不是弦/实体。 */
export interface SystemDecl extends DeclBase {
  k: 'system';
  name: string;
  phase: SystemPhase;
  every: boolean;
  guard?: Expr;
  effects: EffectAst[];
}

/** v5.1：场景是运行时作用域，只启用系统 + 进入/离开效果。 */
export interface SceneDecl extends DeclBase {
  k: 'scene';
  name: string;
  systems: string[];
  enter: EffectAst[];
  exit: EffectAst[];
}

/** v5.6：后端端口（GLSL/Faust 只消费端口，不进入弦网络本体）。 */
export interface PortParam {
  name: string;
  string: string;
  span: Span;
}

export interface PortDecl extends DeclBase {
  k: 'port';
  kind: '视觉' | '音频';
  name: string;
  params: PortParam[];
  /** v5.29：视觉端口的程序化纹理。 */
  texture?: { pattern: string; scale: number; span: Span };
  /** v5.30：视觉端口绑定的纹理资产名。 */
  textureAsset?: string;
  /** v6.15：音频端口参数自动化包络（0..1），周期 = bands.length * 4 拍。 */
  automation?: number[];
}

/** v5.11/v5.12：命名空间；v5.12 起接纳除世界/嵌套命名空间外的全部声明。 */
/** v5.17：用户定义纯函数；编译期内联，不进入运行时状态。 */
export interface FunctionLocal {
  name: string;
  expr: Expr;
  span: Span;
}

export interface FunctionDecl extends DeclBase {
  k: 'function';
  name: string;
  params: string[];
  /** v5.22：与 params 对齐；null 表示未标注。 */
  paramTypes: (string | null)[];
  /** v5.22：返回类型；未标注为 null。 */
  returnType: string | null;
  /** v5.23：函数局部变量，按声明顺序。 */
  locals: FunctionLocal[];
  /** v5.24：`当 … 返回 …` 的分支，按顺序短路；v5.25 支持分支局部变量。 */
  branches: { cond: Expr; body: Expr; locals: FunctionLocal[]; span: Span }[];
  /** v5.25：显式 `否则` 分支；有它时不再需要末尾无条件返回。 */
  otherwise?: { body: Expr; locals: FunctionLocal[]; span: Span };
  body?: Expr;
}

export interface NamespaceDecl extends DeclBase {
  k: 'namespace';
  name: string;
  exports: string[];
  decls: Decl[];
}

export interface PhaseAst {
  name: string;
  duration: number;
  span: Span;
}

export interface FormDecl extends DeclBase {
  k: 'form';
  name: string;
  phases: PhaseAst[];
}

export interface EndingDecl extends DeclBase {
  k: 'ending';
  name: string;
  guard: Expr;
  /** v4.3：这个结局专属的下一章（块写法）；v4.5 起可多个出口。 */
  nextChapter?: string;
  /** v4.5：结局的全部出口，按声明顺序。 */
  nextChapters?: string[];
}

/**
 * 音频资产（v3.7）：给信号 `音频` cue 用的外部音频文件。
 * 路径只允许 audio/ 下的一层 wav/mp3/ogg（vite public）。
 */
export interface AudioAssetDecl extends DeclBase {
  k: 'audio-asset';
  name: string;
  src: string;
}

/** v5.30：视觉纹理资产声明；路径由 Host 解析/加载。 */
export interface TextureAssetDecl extends DeclBase {
  k: 'texture-asset';
  name: string;
  src: string;
}

/** v3.8：世界循环配乐；引用一个音频资产。 */
export interface BgmDecl extends DeclBase {
  k: 'bgm';
  asset: string;
  /** 0..1，默认 0.35。 */
  volume: number;
  loop: boolean;
}

/**
 * 谱：一组采样音段，描述某个维度随参数变化的曲线。
 *
 * `mode` 决定调制如何留在谱上：
 *   - `固定`（默认）：调制持久叠加，锚点即稳态；
 *   - `受迫`：调制每拍向锚点衰减，锚点本身不反弹。
 */
export interface SpectrumDecl extends DeclBase {
  k: 'spectrum';
  name: string;
  bands: number[];
  min: number;
  max: number;
  interpolation: '线性' | '平滑' | '阶跃';
  loop: boolean;
  mode: '固定' | '受迫';
  /** 演奏方式：拨弦（一次性）或持续（按住发声，v2.0.1）。 */
  articulation: '拨弦' | '持续';
}

/** 关系谱里一个格子的时间曲线（v2.3a）。 */
export interface MatrixCurveAst {
  row: string;
  col: string;
  /** 1..64 个有限采样值，位置 0..1 均匀分布。 */
  bands: number[];
  /** v2.12：该格单独覆盖矩阵级插值；未设时沿用矩阵的插值。 */
  interpolation?: '线性' | '平滑' | '阶跃';
  /** v2.14：该格单独覆盖矩阵级循环；未设时沿用矩阵的循环。 */
  loop?: boolean;
  /** v2.15：该格自己的时间速度（0.1..8），未设沿用矩阵级。 */
  speed?: number;
  /** v2.15：该格自己的时间相位（0..1），未设沿用矩阵级。 */
  phase?: number;
  span?: Span;
}

/** v2.19：关系谱格子的动态标量表达式（运行期求值）。 */
export interface MatrixDynamicAst {
  row: string;
  col: string;
  expr: Expr;
  span?: Span;
}

/**
 * 关系谱：一张「行 × 列」数值矩阵（v2.1c），v2.3a 起每个格子可以再带一条
 * 时间曲线。
 *
 * 行列标签是创作者自己定的名字（不必是弦名）。`values` 里的 `段` 永远是
 * 编译期常量，也是没有曲线时的回退值；带 `curves` 的格子可以用四参数
 * `查关系谱(矩阵, 行, 列, 位置)` 在运行时采样。
 */
export interface MatrixDecl extends DeclBase {
  k: 'matrix';
  name: string;
  rows: string[];
  cols: string[];
  values: number[][];
  curves: MatrixCurveAst[];
  /** v2.19：动态标量格表达式；同一格不能既有曲线又有动态值。 */
  dynamics: MatrixDynamicAst[];
  /** 矩阵级插值方式，默认「线性」。 */
  interpolation: '线性' | '平滑' | '阶跃';
  /** 矩阵级循环开关，默认 false。 */
  loop: boolean;
  /** v2.4：曲线的世界时间周期（拍），供 GUI 播放头与运行时同步；可选。 */
  period?: number;
  /** v2.6：时间轴速度倍率（0.1..8），默认 1。 */
  speed?: number;
  /** v2.6：时间轴相位（0..1），默认 0。 */
  phase?: number;
  /** v2.7：用另一张关系谱的曲线采样作为相位源（多矩阵联动）。 */
  phaseSource?: { matrix: string; row: string; col: string };
}

export type Decl =
  | WorldDecl
  | EntityDecl
  | StringDecl
  | CouplingDecl
  | LoopDecl
  | ForcingDecl
  | ChordDecl
  | AxiomDecl
  | SignalDecl
  | ActionDecl
  | FormDecl
  | EndingDecl
  | SpectrumDecl
  | MatrixDecl
  | AudioAssetDecl
  | TextureAssetDecl
  | BgmDecl
  | SystemDecl
  | SceneDecl
  | PortDecl
  | NamespaceDecl
  | FunctionDecl;

export interface Program {
  decls: Decl[];
  span: Span;
}

/** 全部声明关键字，用于「你是不是想写」的纠错建议。 */
export const DECL_KEYWORDS = [
  '世界',
  '实体',
  '叙事弦',
  '视觉弦',
  '动画弦',
  '物理弦',
  '控制弦',
  '空间弦',
  '认知弦',
  '关系弦',
  '耦合',
  '回路',
  '力迫',
  '和弦',
  '公理',
  '信号',
  '动作',
  '系统',
  '场景',
  '视觉端口',
  '音频端口',
  '命名空间',
  '函数',
  '曲式',
  '结局',
  '谱',
  '关系谱',
  '音频资产',
  '配乐',
] as const;

export function isStringKeyword(word: string): word is keyof typeof STRING_KEYWORDS {
  return word in STRING_KEYWORDS;
}
