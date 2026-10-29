import type { LExpr } from '@neurou/core';
import { curveLocalPosition, sampleMatrixCurve, sampleSpectrum, type MatrixState, type RuntimeValue, type WorldState } from './state.js';

/** v2.7：多矩阵联动——相位源可递归，编译器已保证无环；运行时仍留深度保护。 */
export function matrixTimePosition(name: string, state: WorldState, depth = 0): number {
  const matrix = state.matrices?.[name];
  if (!matrix || matrix.period === undefined) return 0;
  let phase = matrix.phase ?? 0;
  if (matrix.phaseSource && depth < 8) {
    const source = state.matrices?.[matrix.phaseSource.matrix];
    if (source && source.period !== undefined) {
      const sourcePosition = matrixTimePosition(matrix.phaseSource.matrix, state, depth + 1);
      const curve = source.curves.find(
        (candidate) => candidate.row === matrix.phaseSource!.row && candidate.col === matrix.phaseSource!.col,
      );
      const sampled = curve
        ? sampleMatrixCurve(
            curve,
            curveLocalPosition(curve, sourcePosition),
            curve.interpolation ?? source.interpolation,
            curve.loop ?? source.loop,
          )
        : matrixCellValue(source, matrix.phaseSource.row, matrix.phaseSource.col, state);
      if (sampled !== undefined && Number.isFinite(sampled)) phase = sampled;
    }
  }
  const raw = (state.tick / matrix.period) * (matrix.speed ?? 1) + phase;
  return ((raw % 1) + 1) % 1;
}

/** 求值：把图上的表达式还原成一次具体的判断或数值。 */
export function evalExpr(
  e: LExpr,
  state: WorldState,
  params?: Record<string, RuntimeValue>,
): RuntimeValue {
  switch (e.k) {
    case 'const':
      return Array.isArray(e.v) ? new Set(e.v) : e.v;
    case 'read':
      return state.values[e.id] ?? null;
    case 'param':
      return params?.[e.name] ?? null;
    case 'un': {
      if (e.op === '非') return !truthy(evalExpr(e.e, state, params));
      const v = asNumber(evalExpr(e.e, state, params));
      return e.op === '-' ? -v : v;
    }
    case 'bin': {
      if (e.op === '且') return truthy(evalExpr(e.l, state, params)) && truthy(evalExpr(e.r, state, params));
      if (e.op === '或') return truthy(evalExpr(e.l, state, params)) || truthy(evalExpr(e.r, state, params));
      const l = evalExpr(e.l, state, params);
      const r = evalExpr(e.r, state, params);
      return binary(e.op, l, r);
    }
    case 'call': {
      const userCall = e.fn.startsWith('用户:');
      if (userCall) {
        const name = e.fn.slice('用户:'.length);
        const fn = state.functions?.[name];
        if (!fn) return null;
        const args = e.args.map((a: LExpr) => evalExpr(a, state, params));
        const env: Record<string, RuntimeValue> = {};
        fn.params.forEach((param, index) => {
          env[param] = args[index] ?? null;
        });
        return evalExpr(fn.body, state, env);
      }
      const args = e.args.map((a: LExpr) => evalExpr(a, state, params));
      switch (e.fn) {
        case '数量': {
          const v = args[0];
          if (v instanceof Set) return v.size;
          if (typeof v === 'string') return [...v].length;
          return 0;
        }
        case '包含': {
          const set = args[0];
          const item = args[1];
          if (set instanceof Set) return set.has(String(item));
          if (typeof set === 'string') return set.includes(String(item));
          return false;
        }
        case '空': {
          const v = args[0];
          if (v instanceof Set) return v.size === 0;
          if (typeof v === 'string') return v.length === 0;
          return v === null;
        }
        case '最小':
          return Math.min(asNumber(args[0] ?? null), asNumber(args[1] ?? null));
        case '最大':
          return Math.max(asNumber(args[0] ?? null), asNumber(args[1] ?? null));
        case '绝对值':
          return Math.abs(asNumber(args[0] ?? null));
        case '存在':
          return args[0] !== null && args[0] !== undefined;
        case '此刻':
          return state.tick;
        case '选择':
          return truthy(args[0] ?? null) ? (args[1] ?? null) : (args[2] ?? null);
        case '查谱': {
          // 第一个参数在编译期已保证是谱名字符串；运行时只按状态采样。
          // 未知谱 / 非有限位置返回 0，让规则与结局保持数值语义。
          const name = args[0];
          const st = typeof name === 'string' ? state.spectra?.[name] : undefined;
          if (!st) return 0;
          const sampled = sampleSpectrum(st, asNumber(args[1] ?? null));
          return sampled === undefined ? 0 : sampled;
        }
        case '谱位': {
          const name = args[0];
          if (typeof name !== 'string') return 0;
          return matrixTimePosition(name, state);
        }
        case '当前谱值': {
          const [name, row, col] = args;
          if (typeof name !== 'string' || typeof row !== 'string' || typeof col !== 'string') return 0;
          const matrix = state.matrices?.[name];
          if (!matrix || matrix.period === undefined) return 0;
          const curve = matrix.curves.find((candidate) => candidate.row === row && candidate.col === col);
          if (!curve) return matrixCellValue(matrix, row, col, state);
          const sampled = sampleMatrixCurve(
            curve,
            matrixTimePosition(name, state),
            curve.interpolation ?? matrix.interpolation,
            curve.loop ?? matrix.loop,
          );
          return sampled === undefined ? matrixCellValue(matrix, row, col, state) : sampled;
        }
        case '查关系谱': {
          // 三参数读取「段」的标量值；四参数在有曲线时按位置采样。
          // 编译期已经校验矩阵/标签并把无曲线格子折叠成常量；这里保留
          // 完整回退路径，方便旧快照或直接构造 LExpr 的工具。
          if (args.length < 3) return 0;
          const name = args[0];
          const row = args[1];
          const col = args[2];
          if (typeof name !== 'string' || typeof row !== 'string' || typeof col !== 'string') return 0;
          const matrix = state.matrices?.[name];
          if (!matrix) return 0;
          const scalar = matrixCellValue(matrix, row, col, state);
          if (args.length < 4) return scalar;
          const curve = matrix.curves.find((c) => c.row === row && c.col === col);
          if (!curve) return scalar;
          const sampled = sampleMatrixCurve(curve, curveLocalPosition(curve, asNumber(args[3] ?? null)), curve.interpolation ?? matrix.interpolation, curve.loop ?? matrix.loop);
          // 非有限位置或空曲线：回退到静态标量（没有标量才是 0）。
          return sampled === undefined ? scalar : sampled;
        }
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/** 关系谱某个格子的静态标量值（`段`）；标签不存在或值非有限时为 0。 */
let matrixEvalDepth = 0;

/** v2.19：读取矩阵格；动态格优先求值表达式，再回退静态标量。 */
export function matrixCellValue(matrix: MatrixState, row: string, col: string, state: WorldState): number {
  const dynamic = matrix.dynamics?.find((item) => item.row === row && item.col === col);
  if (dynamic) {
    if (matrixEvalDepth >= 8) return 0;
    matrixEvalDepth += 1;
    try {
      const value = evalExpr(dynamic.expr, state);
      return typeof value === 'number' && Number.isFinite(value) ? value : asNumber(value);
    } finally {
      matrixEvalDepth -= 1;
    }
  }
  const r = matrix.rows.indexOf(row);
  const c = matrix.cols.indexOf(col);
  if (r < 0 || c < 0) return 0;
  const value = matrix.values[r]?.[c];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** v2.19：动态格不能被效果写入；这里只是给错误信息用的判断。 */
export function isDynamicMatrixCell(matrix: MatrixState, row: string, col: string): boolean {
  return matrix.dynamics?.some((item) => item.row === row && item.col === col) === true;
}

export function binary(op: string, l: RuntimeValue, r: RuntimeValue): RuntimeValue {
  switch (op) {
    case '+':
      return asNumber(l) + asNumber(r);
    case '-':
      return asNumber(l) - asNumber(r);
    case '*':
      return asNumber(l) * asNumber(r);
    case '/': {
      const d = asNumber(r);
      return d === 0 ? 0 : asNumber(l) / d;
    }
    case '%': {
      const d = asNumber(r);
      return d === 0 ? 0 : asNumber(l) % d;
    }
    case '==':
      return equalValues(l, r);
    case '!=':
      return !equalValues(l, r);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const c = compareValues(l, r);
      if (c === undefined) return false;
      if (op === '<') return c < 0;
      if (op === '<=') return c <= 0;
      if (op === '>') return c > 0;
      return c >= 0;
    }
    default:
      return null;
  }
}

export function asNumber(v: RuntimeValue): number {
  return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
}

export function truthy(v: RuntimeValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (v instanceof Set) return v.size > 0;
  return false;
}

export function equalValues(l: RuntimeValue, r: RuntimeValue): boolean {
  if (l instanceof Set && r instanceof Set) {
    if (l.size !== r.size) return false;
    for (const x of l) if (!r.has(x)) return false;
    return true;
  }
  return l === r;
}

export function compareValues(l: RuntimeValue, r: RuntimeValue): number | undefined {
  if (typeof l === 'number' && typeof r === 'number') return l === r ? 0 : l < r ? -1 : 1;
  if (typeof l === 'string' && typeof r === 'string') return l === r ? 0 : l < r ? -1 : 1;
  if (typeof l === 'boolean' && typeof r === 'boolean') return l === r ? 0 : l ? 1 : -1;
  return undefined;
}
