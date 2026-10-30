import type { IRCoupling, IRMatrix, IRRule, IRSpectrum, IRString, WorldIR } from './ir.js';
import { stringBlockLines } from './serialize.js';

/**
 * 源文本行级写回（v1.4）：只改被编辑的那几行，保留注释、空行、排版。
 *
 * 支持的编辑（调律台 GUI 能做的）：
 *   - 数值弦的 `基线` / `悬崖` / `安全`；
 *   - 已有耦合的 `强度`（行内写法或 `强度` 字段、回路块里的 `边` 行）。
 *
 * 其它结构性修改（增删弦/耦合/规则、改极性/延迟等）一律返回失败，
 * 由调用方回退到 `serialize(ir)` 的规范序列化。
 *
 * 这个函数只负责产生文本；调用方必须先 `compileText` 验证，再写文件。
 */

export type PatchResult =
  | { ok: true; text: string; changed: string[] }
  | { ok: false; reason: string };

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

interface LineInfo {
  /** 行首（含缩进）。 */
  start: number;
  /** 下一行行首（含换行符）。 */
  end: number;
  /** 内容起点。 */
  contentStart: number;
  /** 内容终点（不含 \r\n）。 */
  contentEnd: number;
}

const EOL_MARK = '\n';

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function linesIn(text: string, start: number, end: number): LineInfo[] {
  const lines: LineInfo[] = [];
  let cursor = start;
  while (cursor < end) {
    const lineStart = cursor;
    const newline = text.indexOf(EOL_MARK, lineStart);
    const lineEnd = newline === -1 ? text.length : newline + 1;
    let contentEnd = newline === -1 ? text.length : newline;
    if (contentEnd > lineStart && text[contentEnd - 1] === '\r') contentEnd -= 1;
    lines.push({ start: lineStart, end: lineEnd, contentStart: lineStart, contentEnd });
    if (newline === -1) break;
    cursor = lineEnd;
  }
  return lines;
}

function contentOf(text: string, line: LineInfo): string {
  return text.slice(line.contentStart, line.contentEnd);
}

function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => (b.start - a.start) || (b.end - a.end));
  let output = text;
  for (const edit of sorted) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

/** 不参与行级 patch 的结构字段签名；耦合单独比较（允许增删）。 */
function structuralSignature(ir: WorldIR): string {
  const payload = {
    name: ir.name,
    meta: ir.meta,
    entities: ir.entities,
    spectra: ir.spectra.map((s) => ({
      id: s.id,
      name: s.name,
      min: s.min,
      max: s.max,
      interpolation: s.interpolation,
      loop: s.loop,
      mode: s.mode,
      articulation: s.articulation,
    })),
    bgm: ir.bgm ?? null,
    systems: ir.systems ?? [],
    scenes: ir.scenes ?? [],
    ports: ir.ports ?? [],
    namespaces: ir.namespaces ?? [],
    functions: ir.functions ?? [],
    // 关系谱的格子值可做行级 patch；行/列结构、曲线或采样元数据变化
    // 都会因签名不同而回退到规范序列化（v2.3a 还没有曲线编辑手势）。
    matrices: ir.matrices.map((m) => ({
      id: m.id,
      name: m.name,
      rows: m.rows,
      cols: m.cols,
      curves: (m.curves ?? []).map((curve) => ({
        row: curve.row,
        col: curve.col,
        interpolation: curve.interpolation,
        loop: curve.loop,
        speed: curve.speed,
        phase: curve.phase,
      })),
      dynamics: m.dynamics ?? [],
      interpolation: m.interpolation ?? '线性',
      loop: m.loop === true,
      period: m.period,
      speed: m.speed ?? 1,
      phase: m.phase ?? 0,
      phaseSource: m.phaseSource,
    })),
    loops: ir.loops.map((loop) => ({ name: loop.name, polarity: loop.polarity, edgeCount: loop.edges.length })),
    rules: ir.rules.map((rule) => ({ ...rule, cost: 0, priority: 0, cooldown: 0 })),
    axioms: ir.axioms,
    signals: ir.signals,
    phases: ir.phases,
    endings: ir.endings,
  };
  // span 是源位置，patch 前后必然变化；比较语义时要去掉。
  return JSON.stringify(payload, (key, value) => (key === 'span' ? undefined : value));
}

function couplingKey(coupling: IRCoupling): string {
  return `${coupling.from}->${coupling.to}`;
}

function stringStructure(string: IRString): string {
  return JSON.stringify({
    name: string.name,
    kind: string.kind,
    domain: string.domain,
    response: string.response,
    owner: string.owner,
    target: string.target,
    timbre: string.timbre,
    note: string.note,
  });
}

/** 删除一整块弦声明。 */
function deleteStringEdit(text: string, string: IRString): TextEdit | { error: string } {
  if (!string.span) return { error: `弦「${string.id}」没有源位置` };
  const lines = linesIn(text, string.span.start.offset, string.span.end.offset);
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return { error: `弦「${string.id}」所在块无法识别` };
  return { start: first.start, end: last.end, text: '' };
}

/** 关系谱格子值：按行替换 `段` 行的数字，保留缩进/空白/注释。 */
function matrixValuesEdits(text: string, base: IRMatrix, edited: IRMatrix): TextEdit[] | { error: string } {
  if (!base.span) return { error: `关系谱「${base.id}」没有源位置` };
  const lines = linesIn(text, base.span.start.offset, base.span.end.offset);
  const segmentLines = lines.filter((item) => /^\s*段(?=\s|$)/.test(contentOf(text, item)));
  if (segmentLines.length !== base.rows.length || segmentLines.length !== edited.rows.length) {
    return { error: `关系谱「${base.id}」的段行数与行数不一致` };
  }
  const edits: TextEdit[] = [];
  for (let r = 0; r < segmentLines.length; r++) {
    const baseRow = base.values[r] ?? [];
    const editedRow = edited.values[r] ?? [];
    if (baseRow.length !== editedRow.length) return { error: `关系谱「${base.id}」第 ${r + 1} 行宽度变化` };
    let differs = false;
    for (let c = 0; c < baseRow.length; c++) {
      if (Math.abs((baseRow[c] ?? 0) - (editedRow[c] ?? 0)) > 1e-9) differs = true;
    }
    if (!differs) continue;
    const line = segmentLines[r]!;
    const content = contentOf(text, line);
    const prefix = /^(\s*段\s+)/.exec(content)?.[1];
    if (!prefix) return { error: `关系谱「${base.id}」的段行格式无法识别` };
    const bodyStart = prefix.length;
    const body = content.slice(bodyStart);
    const matches = [...body.matchAll(/-?\d+(?:\.\d+)?/g)];
    if (matches.length !== baseRow.length) return { error: `关系谱「${base.id}」的段行数字个数不一致` };
    let nextBody = body;
    for (let c = matches.length - 1; c >= 0; c--) {
      const match = matches[c]!;
      const at = match.index ?? 0;
      nextBody = nextBody.slice(0, at) + formatNumber(editedRow[c]!) + nextBody.slice(at + match[0].length);
    }
    edits.push({ start: line.contentStart + bodyStart, end: line.contentEnd, text: nextBody });
  }
  return edits;
}

/** 关系谱曲线的段值：按行替换 `曲线 行 列 ...` 里的数字，保留行内其余内容。 */
function matrixCurveBandsEdits(text: string, base: IRMatrix, edited: IRMatrix): TextEdit[] | { error: string } {
  if (!base.span) return { error: `关系谱「${base.id}」没有源位置` };
  const lines = linesIn(text, base.span.start.offset, base.span.end.offset);
  const curveLines = lines.filter((item) => /^\s*曲线(?=\s|$)/.test(contentOf(text, item)));
  const edits: TextEdit[] = [];
  for (const editedCurve of edited.curves ?? []) {
    const baseCurve = (base.curves ?? []).find((c) => c.row === editedCurve.row && c.col === editedCurve.col);
    if (!baseCurve) continue;
    let differs = baseCurve.bands.length !== editedCurve.bands.length;
    if (!differs) {
      differs = baseCurve.bands.some((band, i) => Math.abs(band - (editedCurve.bands[i] ?? 0)) > 1e-9);
    }
    if (!differs) continue;
    const line = curveLines.find((item) => {
      const tokens = contentOf(text, item).trim().split(/\s+/);
      return tokens[1] === editedCurve.row && tokens[2] === editedCurve.col;
    });
    if (!line) return { error: `关系谱「${base.id}」的曲线行无法定位` };
    const content = contentOf(text, line);
    const tokens = content.trim().split(/\s+/);
    const prefix = new RegExp(`^(\\s*曲线\\s+${escapeRegExp(tokens[1]!)}\\s+${escapeRegExp(tokens[2]!)}\\s*)`);
    const head = prefix.exec(content)?.[1];
    if (!head) return { error: `关系谱「${base.id}」的曲线行格式无法识别` };
    const tail = content.slice(head.length);
    // 保留行尾注释；数字段整段重写，因此增删节点也能行级写回。
    const comment = /\s*(#.*)$/.exec(tail)?.[1] ?? '';
    const body = editedCurve.bands.map((band) => formatNumber(band)).join(' ');
    edits.push({ start: line.contentStart + head.length, end: line.contentEnd, text: `${body}${comment ? ` ${comment}` : ''}` });
  }
  return edits;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在最后一块弦声明之后插入新弦块。 */
function insertStringsEdit(
  text: string,
  baseIR: WorldIR,
  added: IRString[],
  eol: string,
): TextEdit {
  const spans = baseIR.strings.filter((s) => s.span).map((s) => s.span!.end.offset);
  const pos = spans.length > 0 ? Math.max(...spans) : 0;
  const newline = text.indexOf('\n', pos);
  const at = newline === -1 ? text.length : newline + 1;
  const prefix = at === text.length && !text.endsWith('\n') ? eol : '';
  const block = added.map((s) => stringBlockLines(s).join(eol)).join(eol + eol) + eol;
  return { start: at, end: at, text: `${prefix}${block}` };
}

function couplingStructure(coupling: IRCoupling): string {
  return JSON.stringify({
    polarity: coupling.polarity,
    delay: coupling.delay,
    delayExpr: coupling.delayExpr,
    curve: coupling.curve,
    guard: coupling.guard,
    strengthExpr: coupling.strengthExpr,
    loop: coupling.loop,
  });
}

/** 替换一条谱 `段 …` 行里的数字，保留缩进、数字间空白与行尾注释。 */
function spectrumBandsEdit(text: string, base: IRSpectrum, edited: IRSpectrum): TextEdit | { error: string } {
  if (!base.span) return { error: `谱「${base.id}」没有源位置` };
  const lines = linesIn(text, base.span.start.offset, base.span.end.offset);
  const line = lines.find((item) => /^\s*段(?=\s|$)/.test(contentOf(text, item)));
  if (!line) return { error: `谱「${base.id}」没有「段」行，无法写回` };
  const content = contentOf(text, line);
  const prefix = /^(\s*段\s+)/.exec(content)?.[1];
  if (!prefix) return { error: `谱「${base.id}」的「段」行格式无法识别` };
  const bodyStart = prefix.length;
  // 数字段整体重写，允许增删节点；保留行尾注释。
  const tail = content.slice(bodyStart);
  const comment = /\s*(#.*)$/.exec(tail)?.[1] ?? '';
  const nextBody = edited.bands.map((band) => formatNumber(band)).join(' ') + (comment ? ` ${comment}` : '');
  return {
    start: line.contentStart + bodyStart,
    end: line.contentEnd,
    text: nextBody,
  };
}
function deleteCouplingEdit(text: string, coupling: IRCoupling): TextEdit | { error: string } {
  if (!coupling.span) return { error: `耦合「${coupling.from} → ${coupling.to}」没有源位置` };
  const lines = linesIn(text, coupling.span.start.offset, coupling.span.end.offset);
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return { error: `耦合「${coupling.from} → ${coupling.to}」所在行无法识别` };
  return { start: first.start, end: last.end, text: '' };
}

/** 在已有耦合声明之后（没有则首个顶层段之前/文件末尾）插入新耦合行。 */
function insertCouplingsEdit(
  text: string,
  baseIR: WorldIR,
  added: { from: string; to: string; polarity: 1 | -1; strength: number }[],
  eol: string,
): TextEdit {
  const lines = added.map(
    (c) => `耦合 ${c.from} → ${c.to} ${c.polarity === 1 ? '同向' : '反向'} ${formatNumber(c.strength)}`,
  );
  const block = lines.join(eol) + eol;
  const spans = baseIR.couplings.filter((c) => !c.loop && c.span).map((c) => c.span!.end.offset);
  if (spans.length > 0) {
    const pos = Math.max(...spans);
    const newline = text.indexOf('\n', pos);
    const at = newline === -1 ? text.length : newline + 1;
    const prefix = at === text.length && !text.endsWith('\n') ? eol : '';
    return { start: at, end: at, text: `${prefix}${block}` };
  }
  // 没有普通耦合：插在第一个顶层的「回路/力迫/规则/结局/信号/相位/实体」段之前，否则文末。
  const top = /^(回路|力迫|规则|结局|信号|相位|实体)/;
  let cursor = 0;
  let at = text.length;
  while (cursor < text.length) {
    const newline = text.indexOf('\n', cursor);
    const lineEnd = newline === -1 ? text.length : newline;
    const content = text.slice(cursor, lineEnd).trimStart();
    if (top.test(content)) {
      at = cursor;
      break;
    }
    if (newline === -1) break;
    cursor = newline + 1;
  }
  const prefix = at === text.length && !text.endsWith('\n') ? eol : '';
  return { start: at, end: at, text: `${prefix}${block}` };
}

function stringFieldEdit(
  text: string,
  string: IRString,
  field: '基线' | '悬崖' | '安全',
  value: number,
  eol: string,
): TextEdit | { error: string } {
  if (!string.span) return { error: `弦「${string.id}」没有源位置，无法行级写回` };
  const lines = linesIn(text, string.span.start.offset, string.span.end.offset);
  const target = lines.find((line) => new RegExp(`^\\s*${field}(?=\\s|$)`).test(contentOf(text, line)));
  const formatted = formatNumber(value);
  if (target) {
    const content = contentOf(text, target);
    const match = new RegExp(`^(\\s*${field}\\s+)(-?\\d+(?:\\.\\d+)?)(\\s*(?:#.*)?)$`).exec(content);
    if (!match) return { error: `弦「${string.id}」的「${field}」行格式无法识别` };
    const replacement = `${match[1]}${formatted}${match[3]}`;
    return {
      start: target.contentStart,
      end: target.contentEnd,
      text: replacement,
    };
  }
  if (field !== '基线') {
    return { error: `弦「${string.id}」没有「${field}」行，无法行级添加阈值` };
  }
  // 没有基线行：插在「类型」行后面，缩进与类型行一致。
  const typeLine = lines.find((line) => /^\s*类型(?=\s|$)/.test(contentOf(text, line)));
  if (!typeLine) return { error: `弦「${string.id}」没有「类型」行，无法插入基线` };
  const indent = /^(\s*)/.exec(contentOf(text, typeLine))?.[1] ?? '  ';
  const needsBreak = typeLine.end === text.length && !text.endsWith('\n');
  return {
    start: typeLine.end,
    end: typeLine.end,
    text: `${needsBreak ? eol : ''}${indent}${field} ${formatted}${eol}`,
  };
}

function stringWaveformEdit(
  text: string,
  string: IRString,
  waveform: readonly number[],
  eol: string,
): TextEdit | { error: string } {
  if (!string.span) return { error: `弦「${string.id}」没有源位置，无法行级写回波形` };
  const lines = linesIn(text, string.span.start.offset, string.span.end.offset);
  const body = waveform.map((value) => formatNumber(value)).join(' ');
  const target = lines.find((line) => /^\s*波形(?=\s|$)/.test(contentOf(text, line)));
  if (target) {
    const content = contentOf(text, target);
    const match = /^(\s*波形\s+)([^#]*?)(\s*(?:#.*)?)$/.exec(content);
    if (!match) return { error: `弦「${string.id}」的「波形」行格式无法识别` };
    return {
      start: target.contentStart,
      end: target.contentEnd,
      text: `${match[1]}${body}${match[3]}`,
    };
  }
  const anchor =
    lines.find((line) => /^\s*基线(?=\s|$)/.test(contentOf(text, line))) ??
    lines.find((line) => /^\s*类型(?=\s|$)/.test(contentOf(text, line)));
  if (!anchor) return { error: `弦「${string.id}」没有「基线」或「类型」行，无法插入波形` };
  const indent = /^(\s*)/.exec(contentOf(text, anchor))?.[1] ?? '  ';
  const needsBreak = anchor.end === text.length && !text.endsWith('\n');
  return {
    start: anchor.end,
    end: anchor.end,
    text: `${needsBreak ? eol : ''}${indent}波形 ${body}${eol}`,
  };
}

/** v6.7：提取一条规则/动作的源块。 */
export function ruleBlockText(text: string, rule: IRRule): string | null {
  if (!rule.span) return null;
  const start = rule.span.start.offset;
  const end = ruleBlockEnd(text, start);
  return text.slice(start, end);
}

/** v6.7：整块替换规则源文本；调用方必须重新编译校验。 */
export function replaceRuleBlockText(
  text: string,
  rule: IRRule,
  nextSource: string,
): PatchResult {
  if (!rule.span) return { ok: false, reason: `规则「${rule.id}」没有源位置` };
  if (!nextSource.trim()) return { ok: false, reason: '规则源文本不能为空' };
  const start = rule.span.start.offset;
  const end = ruleBlockEnd(text, start);
  const original = text.slice(start, end);
  const trailing = /\r?\n$/.test(original) ? '\n' : '';
  return {
    ok: true,
    text: `${text.slice(0, start)}${nextSource.trimEnd()}${trailing}${text.slice(end)}`,
    changed: [rule.id],
  };
}

function ruleBlockEnd(text: string, start: number): number {
  let pos = text.indexOf('\n', start);
  if (pos < 0) return text.length;
  pos += 1;
  while (pos < text.length) {
    const end = text.indexOf('\n', pos);
    const lineEnd = end < 0 ? text.length : end;
    const line = text.slice(pos, lineEnd);
    if (line.trim() === '' || /^\S/.test(line)) return pos;
    if (end < 0) return text.length;
    pos = end + 1;
  }
  return text.length;
}

function assetDeclarationEdit(
  text: string,
  label: '音频资产' | '纹理资产',
  name: string,
  nextName: string | null,
): TextEdit | { error: string } {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^([ \\t]*${label}[ \\t]+)(${escaped})([ \\t]+"[^"]*"[ \\t]*(?:#.*)?)$`, 'm');
  const match = pattern.exec(text);
  if (!match) return { error: `找不到${label}「${name}」的声明行` };
  if (nextName === null) {
    const end = text.indexOf('\n', match.index + match[0].length);
    return {
      start: match.index,
      end: end < 0 ? text.length : end + 1,
      text: '',
    };
  }
  const start = match.index + (match[1]?.length ?? 0);
  return { start, end: start + (match[2]?.length ?? 0), text: nextName };
}

function assetSrcEdit(
  text: string,
  label: '音频资产' | '纹理资产',
  name: string,
  src: string,
  eol: string,
): TextEdit | { error: string } {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(\\s*${label}\\s+${escaped}\\s+)"([^"]*)"(\\s*(?:#.*)?)$`, 'm');
  const match = pattern.exec(text);
  if (!match) return { error: `找不到${label}「${name}」的声明行` };
  const start = match.index + (match[1]?.length ?? 0);
  const end = start + (match[2]?.length ?? 0) + 2;
  return { start, end, text: `"${src}"` };
}

function ruleNumberFieldEdit(
  text: string,
  rule: IRRule,
  label: string,
  value: number,
  eol: string,
): TextEdit | { error: string } {
  if (!rule.span) return { error: `规则「${rule.id}」没有源位置` };
  const lines = linesIn(text, rule.span.start.offset, ruleBlockEnd(text, rule.span.start.offset));
  const target = lines.find((line) => new RegExp(`^\\s*${label}(?=\\s|$)`).test(contentOf(text, line)));
  if (!target) {
    const last = lines[lines.length - 1];
    if (!last) return { error: `规则「${rule.id}」没有可插入字段的位置` };
    return {
      start: last.end,
      end: last.end,
      text: `${eol}  ${label} ${formatNumber(value)}`,
    };
  }
  const content = contentOf(text, target);
  const match = new RegExp(`^(\\s*${label}\\s+)(-?\\d+(?:\\.\\d+)?)(\\s*(?:#.*)?)$`).exec(content);
  if (!match) return { error: `规则「${rule.id}」的「${label}」行格式无法识别` };
  return {
    start: target.contentStart,
    end: target.contentEnd,
    text: `${match[1]}${formatNumber(value)}${match[3]}`,
  };
}

function couplingStrengthEdit(
  text: string,
  coupling: IRCoupling,
  strength: number,
): TextEdit | { error: string } {
  if (!coupling.span) return { error: `耦合「${coupling.from} → ${coupling.to}」没有源位置` };
  const lines = linesIn(text, coupling.span.start.offset, coupling.span.end.offset);
  const formatted = formatNumber(strength);
  for (const line of lines) {
    const content = contentOf(text, line);
    if (!/同向|反向/.test(content)) continue;
    if (/^\s*回路/.test(content) && content.includes(':')) {
      return { error: '链式回路的边没有独立强度，无法行级写回' };
    }
    const byField = /(\s强度\s+)(-?\d+(?:\.\d+)?)/.exec(content);
    if (byField) {
      const start = line.contentStart + byField.index + byField[1]!.length;
      return { start, end: start + byField[2]!.length, text: formatted };
    }
    const byPolarity = /(同向|反向)(\s+)(-?\d+(?:\.\d+)?)/.exec(content);
    if (byPolarity) {
      const start = line.contentStart + byPolarity.index + byPolarity[1]!.length + byPolarity[2]!.length;
      return { start, end: start + byPolarity[3]!.length, text: formatted };
    }
    const insertAfter = /(同向|反向)/.exec(content);
    if (insertAfter) {
      const at = line.contentStart + insertAfter.index + insertAfter[1]!.length;
      return { start: at, end: at, text: ` ${formatted}` };
    }
  }
  return { error: `耦合「${coupling.from} → ${coupling.to}」所在行没有极性标记，无法写回强度` };
}

export function patchWorldText(baseText: string, baseIR: WorldIR, editedIR: WorldIR): PatchResult {
  if (structuralSignature(baseIR) !== structuralSignature(editedIR)) {
    return { ok: false, reason: '编辑涉及结构变化，需要回退规范序列化' };
  }

  // SourceFile 在编译时把 CRLF 统一成 LF，span 偏移也随之基于 LF；
  // 这里同样先统一，patch 结果按 LF 写出（注释、缩进、空行保持不变）。
  const normalized = baseText.replace(/\r\n?/g, '\n');
  const eol = '\n';
  const edits: TextEdit[] = [];
  const changed: string[] = [];

  const baseStrings = new Map(baseIR.strings.map((s) => [s.id, s]));
  const editedStrings = new Map(editedIR.strings.map((s) => [s.id, s]));
  const addedStrings: IRString[] = [];

  for (const [id, base] of baseStrings) {
    const edited = editedStrings.get(id);
    if (!edited) {
      const result = deleteStringEdit(normalized, base);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${id}.removed`);
      continue;
    }
    if (stringStructure(base) !== stringStructure(edited)) {
      return { ok: false, reason: `弦「${id}」的名字/类型/取值域/响应发生变化，需要回退规范序列化` };
    }
    const fields: { key: 'verge' | 'safe' | 'baseline'; label: '基线' | '悬崖' | '安全' }[] = [
      { key: 'baseline', label: '基线' },
      { key: 'verge', label: '悬崖' },
      { key: 'safe', label: '安全' },
    ];
    for (const field of fields) {
      const before = base[field.key];
      const after = edited[field.key];
      if (typeof before !== 'number' || typeof after !== 'number') {
        if (before !== after) return { ok: false, reason: `弦「${id}」的${field.label}不是数字，无法行级写回` };
        continue;
      }
      if (Math.abs(before - after) < 1e-9) continue;
      const result = stringFieldEdit(normalized, base, field.label, after, eol);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${id}.${field.key}`);
    }
    const beforeWave = base.waveform ?? [];
    const afterWave = edited.waveform ?? [];
    const waveChanged =
      beforeWave.length !== afterWave.length ||
      beforeWave.some((value, index) => Math.abs(value - (afterWave[index] ?? 0)) > 1e-9);
    if (waveChanged) {
      const result = stringWaveformEdit(normalized, base, afterWave, eol);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${id}.waveform`);
    }
  }

  for (const [id, edited] of editedStrings) {
    if (baseStrings.has(id)) continue;
    if (edited.owner) return { ok: false, reason: '实体里的弦暂不支持新增' };
    addedStrings.push(edited);
    changed.push(`${id}.added`);
  }
  if (addedStrings.length > 0) {
    edits.push(insertStringsEdit(normalized, baseIR, addedStrings, eol));
  }

  // 资产：按顺序比较，支持改路径、改名、删除未引用资产。
  const baseAudioAssets = baseIR.audioAssets ?? [];
  const editedAudioAssets = editedIR.audioAssets ?? [];
  if (editedAudioAssets.length > baseAudioAssets.length) {
    return { ok: false, reason: '音频资产新增需要回退规范序列化' };
  }
  for (let index = 0; index < editedAudioAssets.length; index += 1) {
    const base = baseAudioAssets[index]!;
    const edited = editedAudioAssets[index]!;
    if (base.name !== edited.name) {
      const result = assetDeclarationEdit(normalized, '音频资产', base.name, edited.name);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${edited.id}.rename`);
    }
    if (base.src !== edited.src) {
      const result = assetSrcEdit(normalized, '音频资产', edited.name, edited.src, eol);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${edited.id}.src`);
    }
  }
  for (let index = editedAudioAssets.length; index < baseAudioAssets.length; index += 1) {
    const result = assetDeclarationEdit(normalized, '音频资产', baseAudioAssets[index]!.name, null);
    if ('error' in result) return { ok: false, reason: result.error };
    edits.push(result);
    changed.push(`${baseAudioAssets[index]!.id}.removed`);
  }
  const baseTextureAssets = baseIR.textureAssets ?? [];
  const editedTextureAssets = editedIR.textureAssets ?? [];
  if (editedTextureAssets.length > baseTextureAssets.length) {
    return { ok: false, reason: '纹理资产新增需要回退规范序列化' };
  }
  for (let index = 0; index < editedTextureAssets.length; index += 1) {
    const base = baseTextureAssets[index]!;
    const edited = editedTextureAssets[index]!;
    if (base.name !== edited.name) {
      const result = assetDeclarationEdit(normalized, '纹理资产', base.name, edited.name);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${edited.id}.rename`);
    }
    if (base.src !== edited.src) {
      const result = assetSrcEdit(normalized, '纹理资产', edited.name, edited.src, eol);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${edited.id}.src`);
    }
  }
  for (let index = editedTextureAssets.length; index < baseTextureAssets.length; index += 1) {
    const result = assetDeclarationEdit(normalized, '纹理资产', baseTextureAssets[index]!.name, null);
    if ('error' in result) return { ok: false, reason: result.error };
    edits.push(result);
    changed.push(`${baseTextureAssets[index]!.id}.removed`);
  }

  // 规则数值字段：耗时 / 优先级 / 每（结构本身仍由签名保护）。
  for (const edited of editedIR.rules) {
    const base = baseIR.rules.find((rule) => rule.id === edited.id);
    if (!base) return { ok: false, reason: `规则「${edited.id}」是新增的，需要回退规范序列化` };
    const fields: { key: 'cost' | 'priority' | 'cooldown'; label: string }[] = [
      { key: 'cost', label: '耗时' },
      { key: 'priority', label: '优先级' },
      { key: 'cooldown', label: '每' },
    ];
    for (const field of fields) {
      const before = base[field.key];
      const after = edited[field.key];
      if (Math.abs(before - after) < 1e-9) continue;
      const result = ruleNumberFieldEdit(normalized, base, field.label, after, eol);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${edited.id}.${field.key}`);
    }
  }
  for (const base of baseIR.rules) {
    if (!editedIR.rules.some((rule) => rule.id === base.id)) {
      return { ok: false, reason: `规则「${base.id}」被删除，需要回退规范序列化` };
    }
  }

  for (const edited of editedIR.spectra) {
    const base = baseIR.spectra.find((s) => s.id === edited.id);
    if (!base) return { ok: false, reason: `谱「${edited.id}」是新增的，需要回退规范序列化` };
    let differs = base.bands.length !== edited.bands.length;
    for (let i = 0; i < edited.bands.length; i++) {
      if (Math.abs((base.bands[i] ?? 0) - (edited.bands[i] ?? 0)) > 1e-9) {
        differs = true;
        break;
      }
    }
    if (!differs) continue;
    const result = spectrumBandsEdit(normalized, base, edited);
    if ('error' in result) return { ok: false, reason: result.error };
    edits.push(result);
    changed.push(`${edited.id}.bands`);
  }

  for (const edited of editedIR.matrices) {
    const base = baseIR.matrices.find((m) => m.id === edited.id);
    if (!base) return { ok: false, reason: `关系谱「${edited.id}」是新增的，需要回退规范序列化` };
    let valuesDiffer = false;
    for (let r = 0; r < edited.values.length; r++) {
      const row = edited.values[r] ?? [];
      const before = base.values[r] ?? [];
      if (row.length !== before.length) valuesDiffer = true;
      for (let c = 0; c < row.length; c++) {
        if (Math.abs((row[c] ?? 0) - (before[c] ?? 0)) > 1e-9) valuesDiffer = true;
      }
    }
    let curvesDiffer = false;
    for (const curve of edited.curves ?? []) {
      const before = (base.curves ?? []).find((c) => c.row === curve.row && c.col === curve.col);
      if (!before || before.bands.length !== curve.bands.length) {
        curvesDiffer = true;
        continue;
      }
      for (let i = 0; i < before.bands.length; i++) {
        if (Math.abs((before.bands[i] ?? 0) - (curve.bands[i] ?? 0)) > 1e-9) curvesDiffer = true;
      }
    }
    if (!valuesDiffer && !curvesDiffer) continue;
    if (valuesDiffer) {
      const result = matrixValuesEdits(normalized, base, edited);
      if ('error' in result) return { ok: false, reason: result.error };
      for (const edit of result) edits.push(edit);
      changed.push(`${edited.id}.values`);
    }
    if (curvesDiffer) {
      const result = matrixCurveBandsEdits(normalized, base, edited);
      if ('error' in result) return { ok: false, reason: result.error };
      for (const edit of result) edits.push(edit);
      changed.push(`${edited.id}.curves`);
    }
  }

  const baseCouplings = new Map(baseIR.couplings.map((c) => [couplingKey(c), c]));
  const editedCouplings = new Map(editedIR.couplings.map((c) => [couplingKey(c), c]));
  const added: { from: string; to: string; polarity: 1 | -1; strength: number }[] = [];

  for (const [key, base] of baseCouplings) {
    const edited = editedCouplings.get(key);
    if (!edited) {
      if (base.loop) return { ok: false, reason: `耦合「${base.from} → ${base.to}」属于回路，不能单独删除` };
      const result = deleteCouplingEdit(normalized, base);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${base.from}→${base.to}.removed`);
      continue;
    }
    if (couplingStructure(base) !== couplingStructure(edited)) {
      return { ok: false, reason: `耦合「${base.from} → ${base.to}」的极性/延迟/曲线/回路发生变化，需要回退规范序列化` };
    }
    if (base.strengthExpr) {
      return { ok: false, reason: `耦合「${base.from} → ${base.to}」的强度是表达式，需要回退规范序列化` };
    }
    if (Math.abs(base.strength - edited.strength) < 1e-9) continue;
    const result = couplingStrengthEdit(normalized, base, edited.strength);
    if ('error' in result) return { ok: false, reason: result.error };
    edits.push(result);
    changed.push(`${base.from}→${base.to}.strength`);
  }

  for (const [key, edited] of editedCouplings) {
    if (baseCouplings.has(key)) continue;
    if (edited.loop) return { ok: false, reason: '还不能把新耦合直接加进回路' };
    if (edited.strengthExpr) return { ok: false, reason: '表达式强度的新耦合需要回退规范序列化' };
    added.push({ from: edited.from, to: edited.to, polarity: edited.polarity, strength: edited.strength });
    changed.push(`${edited.from}→${edited.to}.added`);
  }
  if (added.length > 0) {
    edits.push(insertCouplingsEdit(normalized, baseIR, added, eol));
  }

  if (edits.length === 0) return { ok: true, text: normalized, changed: [] };
  return { ok: true, text: applyEdits(normalized, edits), changed };
}
