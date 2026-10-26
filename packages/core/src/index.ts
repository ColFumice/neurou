/**
 * neurou core —— 语言前端与弦网络图。
 *
 * 编译流水线：
 *   源码 → 词法 → 语法 → 名字解析/类型检查 → 结构分析 → 弦网络图（IR）
 *
 * 图是唯一真源；文本只是它的一个投影。运行时、模拟器、未来的调律台，
 * 都只读这张图。
 */

export { SourceFile, type Position, type Span } from './source.js';
export {
  DiagnosticBag,
  formatDiagnostic,
  type Diagnostic,
  type DiagnosticTier,
  type Severity,
} from './diagnostics.js';
export { tokenize, type Token, type TokenKind } from './lexer.js';
export * from './ast.js';
export * from './ir.js';
export { parse } from './parser.js';
export { compile, compileText, kindSolver, suggestName, type CompileResult } from './compiler.js';
