import type { IRCoupling, IRString, WorldIR } from './ir.js';

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
    strings: ir.strings.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      domain: s.domain,
      response: s.response,
      owner: s.owner,
      target: s.target,
      note: s.note,
    })),
    loops: ir.loops.map((loop) => ({ name: loop.name, polarity: loop.polarity, edgeCount: loop.edges.length })),
    rules: ir.rules,
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

function couplingStructure(coupling: IRCoupling): string {
  return JSON.stringify({
    polarity: coupling.polarity,
    delay: coupling.delay,
    curve: coupling.curve,
    guard: coupling.guard,
    loop: coupling.loop,
  });
}

/** 删除一条耦合声明所占的整行（行内写法或块写法）。 */
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
  if (baseIR.strings.length !== editedIR.strings.length) {
    return { ok: false, reason: '编辑涉及增删弦，需要回退规范序列化' };
  }

  // SourceFile 在编译时把 CRLF 统一成 LF，span 偏移也随之基于 LF；
  // 这里同样先统一，patch 结果按 LF 写出（注释、缩进、空行保持不变）。
  const normalized = baseText.replace(/\r\n?/g, '\n');
  const eol = '\n';
  const edits: TextEdit[] = [];
  const changed: string[] = [];

  for (const edited of editedIR.strings) {
    const base = baseIR.strings.find((s) => s.id === edited.id);
    if (!base) return { ok: false, reason: `弦「${edited.id}」是新增的，无法行级写回` };
    const fields: { key: 'verge' | 'safe' | 'baseline'; label: '基线' | '悬崖' | '安全' }[] = [
      { key: 'baseline', label: '基线' },
      { key: 'verge', label: '悬崖' },
      { key: 'safe', label: '安全' },
    ];
    for (const field of fields) {
      const before = base[field.key];
      const after = edited[field.key];
      if (typeof before !== 'number' || typeof after !== 'number') {
        if (before !== after) return { ok: false, reason: `弦「${edited.id}」的${field.label}不是数字，无法行级写回` };
        continue;
      }
      if (Math.abs(before - after) < 1e-9) continue;
      const result = stringFieldEdit(normalized, base, field.label, after, eol);
      if ('error' in result) return { ok: false, reason: result.error };
      edits.push(result);
      changed.push(`${edited.id}.${field.key}`);
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
    if (Math.abs(base.strength - edited.strength) < 1e-9) continue;
    const result = couplingStrengthEdit(normalized, base, edited.strength);
    if ('error' in result) return { ok: false, reason: result.error };
    edits.push(result);
    changed.push(`${base.from}→${base.to}.strength`);
  }

  for (const [key, edited] of editedCouplings) {
    if (baseCouplings.has(key)) continue;
    if (edited.loop) return { ok: false, reason: '还不能把新耦合直接加进回路' };
    added.push({ from: edited.from, to: edited.to, polarity: edited.polarity, strength: edited.strength });
    changed.push(`${edited.from}→${edited.to}.added`);
  }
  if (added.length > 0) {
    edits.push(insertCouplingsEdit(normalized, baseIR, added, eol));
  }

  if (edits.length === 0) return { ok: true, text: normalized, changed: [] };
  return { ok: true, text: applyEdits(normalized, edits), changed };
}
