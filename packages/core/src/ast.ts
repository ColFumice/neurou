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
  | { k: 'call'; name: string; args: Expr[]; span: Span };

export type DomainAst =
  | { type: 'number'; min?: number; max?: number }
  | { type: 'boolean' }
  | { type: 'enum'; values: string[] }
  | { type: 'set'; elementKind?: string }
  | { type: 'text' }
  | { type: 'ref'; entityKind?: string };

export interface EffectAst {
  k: 'set' | 'add' | 'sub' | 'apply';
  target?: string[];
  value?: Expr;
  chord?: string;
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
  domain?: DomainAst;
  baseline?: Expr;
  verge?: Expr;
  safe?: Expr;
  response?: ResponseCurve;
  visible?: boolean;
  target?: string;
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
  | EndingDecl;

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
  '曲式',
  '结局',
] as const;

export function isStringKeyword(word: string): word is keyof typeof STRING_KEYWORDS {
  return word in STRING_KEYWORDS;
}
