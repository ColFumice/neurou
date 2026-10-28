import type { IRCoupling, IRString, WorldIR } from './ir.js';
import { compileText } from './compiler.js';
import { serialize } from './serialize.js';

/**
 * IR 编辑操作：调律台的结构编辑都走这里。
 *
 * 设计原则：
 *   - 纯函数：输入一张图，返回一张新图（不改原对象）；
 *   - 先验证再返回：未知弦、非数值弦、越界值、两条阈值线重合都返回错误，
 *     而不是静默夹取——GUI 拿到错误可以拒绝这次手势；
 *   - 只动该动的地方：其余字段原样保留；
 *   - 编辑后的图必须仍能被序列化并重新编译（这一点由 GUI 的写回闸门与单测共同保证）。
 */

export type ThresholdName = 'verge' | 'safe';

export type EditOk = { ok: true; ir: WorldIR };
export type EditFail = { ok: false; error: string };
export type EditResult = EditOk | EditFail;

const round = (value: number): number => Math.round(value * 1000) / 1000;

function domainOf(string: IRString): { min: number; max: number } | undefined {
  if (string.domain.type !== 'number') return undefined;
  return { min: string.domain.min ?? 0, max: string.domain.max ?? 100 };
}

function fail(error: string): EditFail {
  return { ok: false, error };
}

function replaceString(ir: WorldIR, id: string, next: IRString): WorldIR {
  return { ...ir, strings: ir.strings.map((s) => (s.id === id ? next : s)) };
}

/** 改一根数值弦的基线（调律台拖弦 / 拨弦写回都用它）。 */
export function setStringBaseline(ir: WorldIR, id: string, value: number): EditResult {
  const string = ir.strings.find((s) => s.id === id);
  if (!string) return fail(`没有弦「${id}」`);
  const domain = domainOf(string);
  if (!domain) return fail(`弦「${id}」不是数值弦，不能改基线`);
  if (!Number.isFinite(value)) return fail('基线必须是有限数字');
  if (value < domain.min || value > domain.max) {
    return fail(`基线 ${value} 超出取值范围 ${domain.min}..${domain.max}`);
  }
  return { ok: true, ir: replaceString(ir, id, { ...string, baseline: round(value) }) };
}

/** 改一根数值弦的悬崖线 / 安全线。 */
export function setStringThreshold(
  ir: WorldIR,
  id: string,
  which: ThresholdName,
  value: number,
): EditResult {
  const string = ir.strings.find((s) => s.id === id);
  if (!string) return fail(`没有弦「${id}」`);
  const domain = domainOf(string);
  if (!domain) return fail(`弦「${id}」不是数值弦，不能设阈值`);
  if (!Number.isFinite(value)) return fail('阈值必须是有限数字');
  if (value < domain.min || value > domain.max) {
    return fail(`阈值 ${value} 超出取值范围 ${domain.min}..${domain.max}`);
  }
  const rounded = round(value);
  const other = which === 'verge' ? string.safe : string.verge;
  if (other !== undefined && rounded === other) {
    return fail('悬崖线与安全线不能重合——两条线之间要留出区间');
  }
  const next: IRString = { ...string, [which]: rounded };
  return { ok: true, ir: replaceString(ir, id, next) };
}

/** 改一条耦合的强度（0..2，超出视为错误）。 */
export function setCouplingStrength(ir: WorldIR, couplingId: string, strength: number): EditResult {
  const coupling = ir.couplings.find((c) => c.id === couplingId);
  if (!coupling) return fail(`没有耦合「${couplingId}」`);
  if (!Number.isFinite(strength)) return fail('强度必须是有限数字');
  if (strength < 0 || strength > 2) return fail(`强度 ${strength} 超出 0..2`);
  const next: IRCoupling = { ...coupling, strength: round(strength) };
  return {
    ok: true,
    ir: { ...ir, couplings: ir.couplings.map((c) => (c.id === couplingId ? next : c)) },
  };
}

/** 按 from→to 找耦合（GUI 手势里通常只有两端 id，没有生成 id）。 */
export function findCoupling(ir: WorldIR, from: string, to: string): IRCoupling | undefined {
  return ir.couplings.find((c) => c.from === from && c.to === to);
}

/** 按 from→to 改强度。 */
export function setCouplingStrengthBetween(
  ir: WorldIR,
  from: string,
  to: string,
  strength: number,
): EditResult {
  const coupling = findCoupling(ir, from, to);
  if (!coupling) return fail(`没有耦合「${from} → ${to}」`);
  return setCouplingStrength(ir, coupling.id, strength);
}

/**
 * 新增一条耦合（调律台 v1.5 的 Shift+Enter）。
 * 默认同向 0.2、无延迟；span 留空——写回时由 patch 插入新行。
 */
export function addCoupling(
  ir: WorldIR,
  from: string,
  to: string,
  options: { strength?: number; polarity?: 1 | -1; delay?: number } = {},
): EditResult {
  if (from === to) return fail('一根弦不能耦合到自己');
  if (!ir.strings.some((s) => s.id === from)) return fail(`没有弦「${from}」`);
  if (!ir.strings.some((s) => s.id === to)) return fail(`没有弦「${to}」`);
  if (findCoupling(ir, from, to)) return fail(`已经有耦合「${from} → ${to}」`);
  const strength = options.strength ?? 0.2;
  const polarity = options.polarity ?? 1;
  const delay = options.delay ?? 0;
  if (!Number.isFinite(strength) || strength < 0 || strength > 2) return fail('耦合强度必须在 0..2 之间');
  if (polarity !== 1 && polarity !== -1) return fail('耦合极性只能是同向或反向');
  if (!Number.isInteger(delay) || delay < 0) return fail('耦合延迟必须是非负整数');
  const coupling: IRCoupling = {
    id: `c:${from}->${to}:${ir.couplings.length}`,
    from,
    to,
    polarity,
    strength: round(strength),
    delay,
    curve: '线性',
  };
  return { ok: true, ir: { ...ir, couplings: [...ir.couplings, coupling] } };
}

/** 删除一条耦合（回路里的边不能单独删，否则回路不成立）。 */
export function removeCoupling(ir: WorldIR, from: string, to: string): EditResult {
  const coupling = findCoupling(ir, from, to);
  if (!coupling) return fail(`没有耦合「${from} → ${to}」`);
  if (coupling.loop) return fail(`耦合「${from} → ${to}」属于回路「${coupling.loop}」，不能单独删除`);
  return { ok: true, ir: { ...ir, couplings: ir.couplings.filter((c) => c.id !== coupling.id) } };
}

/** 编译闸门：编辑后的图必须仍然是一个合法世界。 */
function validateWorld(ir: WorldIR): EditResult | { ok: true } {
  const compiled = compileText(serialize(ir), 'edit.nro');
  if (!compiled.ok) {
    const first = compiled.diagnostics.errors[0];
    return fail(first ? `编辑后的世界编译不过去：${first.code} ${first.message}` : '编辑后的世界编译不过去');
  }
  return { ok: true };
}

function uniqueStringName(ir: WorldIR, base: string): string {
  if (!ir.strings.some((s) => s.id === base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}${i}`;
    if (!ir.strings.some((s) => s.id === candidate)) return candidate;
  }
  return `${base}${Date.now()}`;
}

/**
 * 新增一根同类弦（v1.6）：继承焦点弦的类型/阈值/响应，基线取当前焦点弦的值。
 * 只支持顶层数值弦；新弦没有 span，写回时由 patch 插入一整块。
 */
export function addString(ir: WorldIR, focusId: string, preferredName?: string): EditResult {
  const focus = ir.strings.find((s) => s.id === focusId);
  if (!focus) return fail(`没有弦「${focusId}」`);
  if (focus.owner) return fail('实体里的弦暂不支持新增');
  const domain = domainOf(focus);
  if (!domain || typeof focus.baseline !== 'number') return fail('只能从数值弦新增同类弦');
  const name = uniqueStringName(ir, preferredName ?? `${focus.name}新`);
  const next: IRString = {
    id: name,
    name,
    kind: focus.kind,
    domain: { ...focus.domain },
    baseline: focus.baseline,
    ...(focus.verge !== undefined ? { verge: focus.verge } : {}),
    ...(focus.safe !== undefined ? { safe: focus.safe } : {}),
    response: focus.response,
    ...(focus.target ? { target: focus.target } : {}),
  };
  const candidate: WorldIR = { ...ir, strings: [...ir.strings, next] };
  const valid = validateWorld(candidate);
  if (!valid.ok) return valid;
  return { ok: true, ir: candidate };
}

/**
 * 删除一根弦（v1.6）：只允许「没有其它引用」的弦。
 * 普通耦合会被一并删除；属于回路、或被规则/信号/公理/结局引用的弦会被编译闸门拒绝。
 */
export function removeString(ir: WorldIR, id: string): EditResult {
  const string = ir.strings.find((s) => s.id === id);
  if (!string) return fail(`没有弦「${id}」`);
  if (ir.strings.length <= 1) return fail('世界里至少要留一根弦');
  if (string.owner) return fail('实体里的弦暂不支持删除');
  const loopEdge = ir.couplings.find((c) => c.loop && (c.from === id || c.to === id));
  if (loopEdge) return fail(`弦「${id}」属于回路「${loopEdge.loop}」，不能删除（先编辑回路）`);
  const candidate: WorldIR = {
    ...ir,
    strings: ir.strings.filter((s) => s.id !== id),
    couplings: ir.couplings.filter((c) => c.from !== id && c.to !== id),
  };
  const valid = validateWorld(candidate);
  if (!valid.ok) return valid;
  return { ok: true, ir: candidate };
}

/** 改一条关系谱的某个格子（v2.2 GUI 拖动/滚轮写回）。 */
export function setMatrixCell(ir: WorldIR, id: string, row: number, col: number, value: number): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  if (!Number.isInteger(row) || row < 0 || row >= matrix.rows.length) return fail(`关系谱「${id}」没有第 ${row} 行`);
  if (!Number.isInteger(col) || col < 0 || col >= matrix.cols.length) return fail(`关系谱「${id}」没有第 ${col} 列`);
  if (!Number.isFinite(value)) return fail('关系值必须是有限数字');
  const values = matrix.values.map((line, r) => (r === row ? line.map((v, c) => (c === col ? round(value) : v)) : line));
  return { ok: true, ir: { ...ir, matrices: ir.matrices.map((m) => (m.id === id ? { ...m, values } : m)) } };
}
/** 改关系谱某格曲线的一个段值（v2.3 GUI 曲线编辑用）。 */
export function setMatrixCurveBand(
  ir: WorldIR,
  id: string,
  row: string,
  col: string,
  index: number,
  value: number,
): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  const curve = matrix.curves?.find((c) => c.row === row && c.col === col);
  if (!curve) return fail(`关系谱「${id}」的「${row} × ${col}」没有曲线`);
  if (!Number.isInteger(index) || index < 0 || index >= curve.bands.length) {
    return fail(`「${row} × ${col}」没有第 ${index} 段（共 ${curve.bands.length} 段）`);
  }
  if (!Number.isFinite(value)) return fail('段值必须是有限数字');
  const curves = (matrix.curves ?? []).map((c) =>
    c.row === row && c.col === col ? { ...c, bands: c.bands.map((b, i) => (i === index ? round(value) : b)) } : c,
  );
  return { ok: true, ir: { ...ir, matrices: ir.matrices.map((m) => (m.id === id ? { ...m, curves } : m)) } };
}

/** v2.4.1：整条替换关系谱曲线采样值（增删节点用）；保持 1..64 个有限数字。 */
export function setMatrixCurveBands(
  ir: WorldIR,
  id: string,
  row: string,
  col: string,
  bands: readonly number[],
): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  const curve = matrix.curves?.find((c) => c.row === row && c.col === col);
  if (!curve) return fail(`关系谱「${id}」的「${row} × ${col}」没有曲线`);
  if (bands.length === 0 || bands.length > 64) return fail('曲线需要 1..64 个采样点');
  if (bands.some((band) => !Number.isFinite(band))) return fail('曲线采样值必须是有限数字');
  const curves = (matrix.curves ?? []).map((c) =>
    c.row === row && c.col === col ? { ...c, bands: bands.map((band) => round(band)) } : c,
  );
  return { ok: true, ir: { ...ir, matrices: ir.matrices.map((m) => (m.id === id ? { ...m, curves } : m)) } };
}

export function setSpectrumBand(ir: WorldIR, id: string, index: number, value: number): EditResult {
  const spectrum = ir.spectra.find((s) => s.id === id);
  if (!spectrum) return fail(`没有谱「${id}」`);
  if (!Number.isInteger(index) || index < 0 || index >= spectrum.bands.length) {
    return fail(`谱「${id}」没有第 ${index} 段（共 ${spectrum.bands.length} 段）`);
  }
  if (!Number.isFinite(value)) return fail('段值必须是有限数字');
  if (value < spectrum.min || value > spectrum.max) {
    return fail(`段值 ${value} 超出范围 ${spectrum.min}..${spectrum.max}`);
  }
  const next = {
    ...spectrum,
    bands: spectrum.bands.map((band, i) => (i === index ? round(value) : band)),
  };
  return { ok: true, ir: { ...ir, spectra: ir.spectra.map((s) => (s.id === id ? next : s)) } };
}

/** v2.4.2：整条替换谱的采样值（增删节点用）；保持 1..256 段且落在范围内。 */
export function setSpectrumBands(ir: WorldIR, id: string, bands: readonly number[]): EditResult {
  const spectrum = ir.spectra.find((s) => s.id === id);
  if (!spectrum) return fail(`没有谱「${id}」`);
  if (bands.length === 0 || bands.length > 256) return fail('谱需要 1..256 个段值');
  for (const band of bands) {
    if (!Number.isFinite(band)) return fail('段值必须是有限数字');
    if (band < spectrum.min || band > spectrum.max) {
      return fail(`段值 ${band} 超出范围 ${spectrum.min}..${spectrum.max}`);
    }
  }
  const next = { ...spectrum, bands: bands.map((band) => round(band)) };
  return { ok: true, ir: { ...ir, spectra: ir.spectra.map((s) => (s.id === id ? next : s)) } };
}

// ---------- v2.4.3 关系谱行列增删/改名 ----------

function matrixReplace(ir: WorldIR, id: string, next: WorldIR['matrices'][number]): EditResult {
  return { ok: true, ir: { ...ir, matrices: ir.matrices.map((m) => (m.id === id ? next : m)) } };
}

export function addMatrixRow(ir: WorldIR, id: string, label: string, index?: number): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  if (!label.trim()) return fail('行标签不能为空');
  if (matrix.rows.includes(label)) return fail(`关系谱「${id}」已经有行「${label}」`);
  if (matrix.rows.length >= 64) return fail('关系谱最多 64 行');
  const at = index === undefined ? matrix.rows.length : Math.max(0, Math.min(matrix.rows.length, Math.trunc(index)));
  const values = matrix.values.map((row) => [...row]);
  values.splice(at, 0, matrix.cols.map(() => 0));
  return matrixReplace(ir, id, { ...matrix, rows: [...matrix.rows.slice(0, at), label, ...matrix.rows.slice(at)], values });
}

export function removeMatrixRow(ir: WorldIR, id: string, index: number): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  if (matrix.rows.length <= 1) return fail('关系谱至少保留一行');
  if (!Number.isInteger(index) || index < 0 || index >= matrix.rows.length) return fail(`关系谱「${id}」没有第 ${index} 行`);
  const label = matrix.rows[index]!;
  return matrixReplace(ir, id, {
    ...matrix,
    rows: matrix.rows.filter((_, i) => i !== index),
    values: matrix.values.filter((_, i) => i !== index),
    curves: matrix.curves.filter((curve) => curve.row !== label),
  });
}

export function addMatrixCol(ir: WorldIR, id: string, label: string, index?: number): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  if (!label.trim()) return fail('列标签不能为空');
  if (matrix.cols.includes(label)) return fail(`关系谱「${id}」已经有列「${label}」`);
  if (matrix.cols.length >= 64) return fail('关系谱最多 64 列');
  const at = index === undefined ? matrix.cols.length : Math.max(0, Math.min(matrix.cols.length, Math.trunc(index)));
  return matrixReplace(ir, id, {
    ...matrix,
    cols: [...matrix.cols.slice(0, at), label, ...matrix.cols.slice(at)],
    values: matrix.values.map((row) => [...row.slice(0, at), 0, ...row.slice(at)]),
  });
}

export function removeMatrixCol(ir: WorldIR, id: string, index: number): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  if (matrix.cols.length <= 1) return fail('关系谱至少保留一列');
  if (!Number.isInteger(index) || index < 0 || index >= matrix.cols.length) return fail(`关系谱「${id}」没有第 ${index} 列`);
  const label = matrix.cols[index]!;
  return matrixReplace(ir, id, {
    ...matrix,
    cols: matrix.cols.filter((_, i) => i !== index),
    values: matrix.values.map((row) => row.filter((_, i) => i !== index)),
    curves: matrix.curves.filter((curve) => curve.col !== label),
  });
}

export function renameMatrixRow(ir: WorldIR, id: string, index: number, label: string): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  if (!Number.isInteger(index) || index < 0 || index >= matrix.rows.length) return fail(`关系谱「${id}」没有第 ${index} 行`);
  if (!label.trim()) return fail('行标签不能为空');
  if (matrix.rows.includes(label)) return fail(`关系谱「${id}」已经有行「${label}」`);
  const old = matrix.rows[index]!;
  return matrixReplace(ir, id, {
    ...matrix,
    rows: matrix.rows.map((row, i) => (i === index ? label : row)),
    curves: matrix.curves.map((curve) => (curve.row === old ? { ...curve, row: label } : curve)),
  });
}

export function renameMatrixCol(ir: WorldIR, id: string, index: number, label: string): EditResult {
  const matrix = ir.matrices.find((m) => m.id === id);
  if (!matrix) return fail(`没有关系谱「${id}」`);
  if (!Number.isInteger(index) || index < 0 || index >= matrix.cols.length) return fail(`关系谱「${id}」没有第 ${index} 列`);
  if (!label.trim()) return fail('列标签不能为空');
  if (matrix.cols.includes(label)) return fail(`关系谱「${id}」已经有列「${label}」`);
  const old = matrix.cols[index]!;
  return matrixReplace(ir, id, {
    ...matrix,
    cols: matrix.cols.map((col, i) => (i === index ? label : col)),
    curves: matrix.curves.map((curve) => (curve.col === old ? { ...curve, col: label } : curve)),
  });
}
