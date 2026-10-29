import type { StringKind } from './ast.js';
import type {
  IRAxiom,
  IRCoupling,
  IRCue,
  IREffect,
  IREntity,
  IREnding,
  IRLoop,
  IRMatrix,
  IRPhase,
  IRRule,
  IRSignal,
  IRSpectrum,
  IRString,
  LExpr,
  WorldIR,
} from './ir.js';

/**
 * IR → .nro 文本（规范序列化）。
 *
 * 「图是唯一真源，文本只是它的一个投影」：这个函数就是投影的方向。
 * 它服务三个场景：
 *   1. 编辑器写回：GUI 改完图（例如拖弦改基线）后，把整张图重新排成 .nro；
 *   2. 格式化：`neurou fmt` 统一风格；
 *   3. 往返验证：compile(serialize(ir)) 必须得到同一张图。
 *
 * 规范性（canonical）：
 *   - 声明顺序固定：世界 → 实体（含实体弦）→ 全局弦 → 谱 → 关系谱 → 耦合 → 回路 → 规则 →
 *     公理 → 信号 → 曲式 → 结局；
 *   - 表达式尽量少括号，数字统一格式，空行分节；
 *   - 有些源信息 IR 不保存，无法还原（见文件末尾「有损之处」）。
 */

const KIND_KEYWORD: Record<StringKind, string> = {
  叙事: '叙事弦',
  视觉: '视觉弦',
  动画: '动画弦',
  物理: '物理弦',
  控制: '控制弦',
  空间: '空间弦',
  认知: '认知弦',
  关系: '关系弦',
};

class Writer {
  private lines: string[] = [];

  line(indent: number, text = ''): void {
    this.lines.push(text ? `${'  '.repeat(indent)}${text}` : '');
  }

  blank(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('');
  }

  toString(): string {
    while (this.lines.length > 0 && this.lines[this.lines.length - 1] === '') this.lines.pop();
    return `${this.lines.join('\n')}\n`;
  }
}

// ---------- 基元 ----------

function numberText(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`serialize: 不能序列化非有限数字 ${n}`);
  if (Object.is(n, -0)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(6)));
}

function stringText(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
}

/** 标识符可直接写；否则用引号（用于集合元素）。 */
function identText(s: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s) ? s : stringText(s);
}

/** IR 里的值 → .nro 字面量。 */
function valueText(value: unknown): string {
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'boolean') return value ? '真' : '假';
  if (typeof value === 'string') return stringText(value);
  if (Array.isArray(value)) return `{${value.map((v) => identText(String(v))).join(', ')}}`;
  if (value === null) throw new Error('serialize: null 值没有 .nro 字面量');
  throw new Error(`serialize: 无法序列化值 ${String(value)}`);
}

// ---------- 表达式 ----------

const PRECEDENCE: Record<string, number> = {
  或: 1,
  '||': 1,
  且: 2,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '%': 5,
};

function exprText(expr: LExpr, parentPrec = 0): string {
  if (expr.k === 'const') {
    return valueText(expr.v);
  }
  if (expr.k === 'read') {
    return expr.id;
  }
  if (expr.k === 'call') {
    return `${expr.fn}(${expr.args.map((a) => exprText(a)).join(', ')})`;
  }
  if (expr.k === 'un') {
    const operand = exprText(expr.e, 7);
    return `${expr.op}${operand}`;
  }
  const prec = PRECEDENCE[expr.op] ?? 3;
  const left = exprText(expr.l, prec);
  const right = exprText(expr.r, prec + 1);
  const text = `${left} ${expr.op} ${right}`;
  return prec < parentPrec ? `(${text})` : text;
}

// ---------- 弦类型 ----------

function domainText(s: IRString): string {
  const d = s.domain;
  switch (d.type) {
    case 'number': {
      const hasMin = d.min !== undefined;
      const hasMax = d.max !== undefined;
      if (hasMin && hasMax) return `数值 ${numberText(d.min!)}..${numberText(d.max!)}`;
      if (!hasMin && hasMax) return `数值 ..${numberText(d.max!)}`;
      if (hasMin && !hasMax) throw new Error(`serialize: 数值弦「${s.id}」只有下界，.nro 无法表达`);
      return '数值';
    }
    case 'boolean':
      return '布尔';
    case 'text':
      return '文本';
    case 'enum':
      return `枚举(${d.values.map((v) => identText(v)).join(', ')})`;
    case 'set':
      return d.elementKind ? `集合(${d.elementKind})` : '集合';
    case 'ref':
      return d.entityKind ? `引用(${d.entityKind})` : '引用';
  }
}

// ---------- 弦 ----------

function stringBlock(w: Writer, s: IRString, indent: number): void {
  w.line(indent, `${KIND_KEYWORD[s.kind]} ${s.name}`);
  const inner = indent + 1;
  w.line(inner, `类型 ${domainText(s)}`);
  w.line(inner, `基线 ${valueText(s.baseline)}`);
  if (s.verge !== undefined) w.line(inner, `悬崖 ${numberText(s.verge)}`);
  if (s.safe !== undefined) w.line(inner, `安全 ${numberText(s.safe)}`);
  if (s.response !== '线性') w.line(inner, `响应 ${s.response}`);
  if (s.target) w.line(inner, `对象 ${s.target}`);
  if (s.timbre) w.line(inner, `音色 ${s.timbre}`);
  if (s.note) w.line(inner, `描述 ${stringText(s.note)}`);
  w.blank();
}

export function stringBlockLines(s: IRString): string[] {
  const lines = [
    `${KIND_KEYWORD[s.kind]} ${s.name}`,
    `  类型 ${domainText(s)}`,
    `  基线 ${valueText(s.baseline)}`,
  ];
  if (s.verge !== undefined) lines.push(`  悬崖 ${numberText(s.verge)}`);
  if (s.safe !== undefined) lines.push(`  安全 ${numberText(s.safe)}`);
  if (s.response !== '线性') lines.push(`  响应 ${s.response}`);
  if (s.target) lines.push(`  对象 ${s.target}`);
  if (s.timbre) lines.push(`  音色 ${s.timbre}`);
  if (s.note) lines.push(`  描述 ${stringText(s.note)}`);
  return lines;
}

// ---------- 实体 ----------

function entityBlock(w: Writer, entity: IREntity, strings: IRString[]): void {
  w.line(0, entity.typeName ? `实体 ${entity.name} 是 ${entity.typeName}` : `实体 ${entity.name}`);
  for (const [key, value] of Object.entries(entity.fields ?? {})) {
    // 种类已经在「是」里表达过，避免重复；若 IR 里两者不同则照原样写
    if (key === '种类' && value === entity.typeName) continue;
    w.line(1, `${key} ${value}`);
  }
  for (const s of strings) stringBlock(w, s, 1);
  w.blank();
}

// ---------- 谱 ----------

function spectrumBlock(w: Writer, spectrum: IRSpectrum): void {
  w.line(0, `谱 ${spectrum.name}`);
  // 默认值不写回：0..1 / 线性 / 不循环 / 固定模式。重新编译时由语法默认值补齐。
  const bands = spectrum.bands.map((b) => numberText(b)).join(' ');
  w.line(1, bands ? `段 ${bands}` : '段');
  if (spectrum.min !== 0 || spectrum.max !== 1) {
    w.line(1, `范围 ${numberText(spectrum.min)}..${numberText(spectrum.max)}`);
  }
  if (spectrum.interpolation !== '线性') w.line(1, `插值 ${spectrum.interpolation}`);
  if (spectrum.loop) w.line(1, '循环 是');
  if (spectrum.mode !== '固定') w.line(1, `模式 ${spectrum.mode}`);
  if (spectrum.articulation !== '拨弦') w.line(1, `演奏 ${spectrum.articulation}`);
  w.blank();
}

// ---------- 关系谱 ----------

function matrixBlock(w: Writer, matrix: IRMatrix): void {
  w.line(0, `关系谱 ${matrix.name}`);
  w.line(1, matrix.rows.length > 0 ? `行 ${matrix.rows.join(' ')}` : '行');
  w.line(1, matrix.cols.length > 0 ? `列 ${matrix.cols.join(' ')}` : '列');
  for (const row of matrix.values) {
    w.line(1, row.length > 0 ? `段 ${row.map((b) => numberText(b)).join(' ')}` : '段');
  }
  // v2.3a：曲线按作者声明顺序写回；矩阵级默认值（线性/不循环）不写。
  for (const curve of matrix.curves ?? []) {
    const bands = curve.bands.map((b) => numberText(b)).join(' ');
    const interpolation = curve.interpolation ? `插值 ${curve.interpolation} ` : '';
    const loop = curve.loop !== undefined ? `循环 ${curve.loop ? '是' : '否'} ` : '';
    const speed = curve.speed !== undefined ? `速度 ${numberText(curve.speed)} ` : '';
    const phase = curve.phase !== undefined ? `相位 ${numberText(curve.phase)} ` : '';
    w.line(1, `曲线 ${curve.row} ${curve.col} ${interpolation}${loop}${speed}${phase}${bands}`);
  }
  for (const dynamic of matrix.dynamics ?? []) {
    w.line(1, `动态 ${dynamic.row} ${dynamic.col} ${exprText(dynamic.expr)}`);
  }
  if ((matrix.interpolation ?? '线性') !== '线性') w.line(1, `插值 ${matrix.interpolation}`);
  if (matrix.loop) w.line(1, '循环 是');
  if (matrix.period !== undefined) w.line(1, `周期 ${numberText(matrix.period)}`);
  if ((matrix.speed ?? 1) !== 1) w.line(1, `速度 ${numberText(matrix.speed)}`);
  if ((matrix.phase ?? 0) !== 0) w.line(1, `相位 ${numberText(matrix.phase)}`);
  if (matrix.phaseSource) w.line(1, `相位源 ${matrix.phaseSource.matrix} ${matrix.phaseSource.row} ${matrix.phaseSource.col}`);
  w.blank();
}

// ---------- 耦合 ----------

function couplingLine(c: IRCoupling): string {
  const parts = [`耦合 ${c.from} → ${c.to}`, c.polarity === -1 ? '反向' : '同向'];
  parts.push(`强度 ${c.strengthExpr ? exprText(c.strengthExpr) : numberText(c.strength)}`);
  if (c.delayExpr) parts.push(`延迟 ${exprText(c.delayExpr)}`);
  else if (c.delay !== 0) parts.push(`延迟 ${numberText(c.delay)}`);
  if (c.curve !== '线性') parts.push(`曲线 ${c.curve}`);
  if (c.guard) parts.push(`当 ${exprText(c.guard)}`);
  return parts.join(' ');
}

// ---------- 回路 ----------

function loopBlock(w: Writer, loop: IRLoop, byId: Map<string, IRCoupling>): void {
  w.line(0, `回路 ${loop.name}`);
  for (const edgeId of loop.edges) {
    const c = byId.get(edgeId);
    if (!c) throw new Error(`serialize: 回路「${loop.name}」引用了不存在的耦合 ${edgeId}`);
    if (c.guard) throw new Error(`serialize: 回路「${loop.name}」的边带条件，.nro 回路块无法表达`);
    if (c.curve !== '线性') throw new Error(`serialize: 回路「${loop.name}」的边带曲线，.nro 回路块无法表达`);
    const parts = [`边 ${c.from} → ${c.to}`, c.polarity === -1 ? '反向' : '同向', numberText(c.strength)];
    if (c.delay !== 0) parts.push(`延迟 ${numberText(c.delay)}`);
    w.line(1, parts.join(' '));
  }
  w.blank();
}

// ---------- 规则 ----------

function effectLine(e: IREffect): string {
  if (e.k === 'apply') {
    const name = e.chord.startsWith('chord:') ? e.chord.slice('chord:'.length) : e.chord;
    return `施加 ${name}`;
  }
  if ('matrix' in e) {
    const op = e.k === 'matrixSet' ? '=' : e.k === 'matrixAdd' ? '+=' : '-=';
    return `关系谱 ${e.matrix} ${e.row} ${e.col} ${op} ${exprText(e.value)}`;
  }
  const op = e.k === 'set' ? '=' : e.k === 'add' ? '+=' : '-=';
  return `${e.id} ${op} ${exprText(e.value)}`;
}

function ruleBlock(w: Writer, rule: IRRule): void {
  const keyword = rule.kind === 'forcing' ? '力迫' : rule.kind === 'chord' ? '和弦' : '动作';
  w.line(0, `${keyword} ${rule.name}`);
  if (rule.guard) w.line(1, `当 ${exprText(rule.guard)}`);
  w.line(1, '效果');
  for (const e of rule.effects) w.line(2, effectLine(e));
  if (rule.kind === 'forcing') {
    if (rule.irreversible) w.line(1, '不可逆');
    if (rule.priority !== 0) w.line(1, `优先级 ${numberText(rule.priority)}`);
    if (rule.before.length > 0) w.line(1, `先于 ${rule.before.join(', ')}`);
    if (rule.repeat) w.line(1, '可重复');
    if (rule.repeat && rule.cooldown > 0) w.line(1, `每 ${numberText(rule.cooldown)}`);
  }
  if (rule.kind === 'chord' && rule.repeat) w.line(1, '可重复');
  if (rule.kind === 'action' && rule.cost !== 1) w.line(1, `耗时 ${numberText(rule.cost)}`);
  if (rule.note) w.line(1, `描述 ${stringText(rule.note)}`);
  w.blank();
}

// ---------- 信号 / 公理 / 结局 / 曲式 ----------

function cueLine(cue: IRCue): string {
  if (cue.k === '台词') {
    const speaker = cue.speaker ? `${cue.speaker}: ` : '';
    return `台词 ${speaker}${stringText(cue.text ?? '')}`;
  }
  if (cue.k === '视觉' || cue.k === '音频') {
    return `${cue.k} ${cue.param ?? '强度'} ${numberText(cue.value ?? 0)}`;
  }
  return `${cue.k} ${stringText(cue.text ?? '')}`;
}

function signalBlock(w: Writer, signal: IRSignal): void {
  w.line(0, `信号 ${signal.name}`);
  w.line(1, `当 ${exprText(signal.guard)}`);
  for (const cue of signal.cues) w.line(1, cueLine(cue));
  w.blank();
}

function axiomLine(a: IRAxiom): string {
  return `公理 ${a.name}: ${exprText(a.expr)}`;
}

function endingLine(e: IREnding): string {
  return `结局 ${e.name}: 当 ${exprText(e.guard)}`;
}

function phasesBlock(w: Writer, phases: IRPhase[]): void {
  // IR 不保留曲式名，这里用一个固定名；重新编译后 phases 不变即可。
  w.line(0, '曲式 曲式');
  for (const phase of phases) w.line(1, `段落 ${phase.name} 时长 ${numberText(phase.duration)}`);
  w.blank();
}

// ---------- 入口 ----------

const META_ORDER = ['版本', '调性', '种子', '作者', '描述', '章节', '上一章', '下一章'] as const;

function worldHeader(w: Writer, ir: WorldIR): void {
  w.line(0, `# 由 neurou 序列化器生成：${ir.name}`);
  w.line(0, `世界 ${ir.name}`);
  const keys = [...META_ORDER.filter((k) => k in ir.meta), ...Object.keys(ir.meta).filter((k) => !META_ORDER.includes(k as (typeof META_ORDER)[number]))];
  for (const key of keys) {
    const value = ir.meta[key];
    if (value === undefined) continue;
    if (key === '版本' || key === '种子') {
      w.line(1, typeof value === 'number' ? `${key} ${numberText(value)}` : `${key} ${String(value)}`);
    } else if (key === '调性') {
      w.line(1, `${key} ${String(value)}`);
    } else if (key === '作者' || key === '描述' || key === '章节' || key === '上一章' || key === '下一章') {
      w.line(1, `${key} ${stringText(String(value))}`);
    } else {
      throw new Error(`serialize: 世界里未知的元数据字段「${key}」`);
    }
  }
  w.blank();
}

/**
 * 把弦网络图序列化为规范 .nro 文本。
 *
 * 有损之处（IR 不保存，无法还原）：
 *   - 注释、空行、原始缩进；
 *   - 表达式的原写法（这里输出的是求值后的结构，例如括号位置可能不同）；
 *   - 曲式的名字（IR 只保存 phases 列表）；
 *   - 弦的 `可见`（IR 没有该字段）；
 *   - 耦合的 `描述`、源文件顺序。
 */
export function serialize(ir: WorldIR): string {
  const w = new Writer();
  worldHeader(w, ir);

  for (const asset of ir.audioAssets ?? []) {
    w.line(0, `音频资产 ${asset.name} "${asset.src}"`);
  }
  if ((ir.audioAssets ?? []).length > 0) w.blank();
  if (ir.bgm) {
    w.line(0, `配乐 ${ir.bgm.asset} 音量 ${numberText(ir.bgm.volume)} 循环 ${ir.bgm.loop ? '是' : '否'}`);
    w.blank();
  }

  const stringsByOwner = new Map<string, IRString[]>();
  const globals: IRString[] = [];
  for (const s of ir.strings) {
    if (s.owner) {
      const list = stringsByOwner.get(s.owner) ?? [];
      list.push(s);
      stringsByOwner.set(s.owner, list);
    } else {
      globals.push(s);
    }
  }

  for (const entity of ir.entities) {
    entityBlock(w, entity, stringsByOwner.get(entity.name) ?? []);
    stringsByOwner.delete(entity.name);
  }
  // 找不到宿主实体的弦按全局处理，避免丢数据
  for (const leftovers of stringsByOwner.values()) globals.push(...leftovers);
  for (const s of globals) stringBlock(w, s, 0);
  if (globals.length > 0) w.blank();

  for (const spectrum of ir.spectra) spectrumBlock(w, spectrum);
  for (const matrix of ir.matrices) matrixBlock(w, matrix);

  const byId = new Map(ir.couplings.map((c) => [c.id, c]));
  const loopCouplingIds = new Set(ir.couplings.filter((c) => c.loop).map((c) => c.id));
  const plainCouplings = ir.couplings.filter((c) => !loopCouplingIds.has(c.id));
  for (const c of plainCouplings) w.line(0, couplingLine(c));
  if (plainCouplings.length > 0) w.blank();

  for (const loop of ir.loops) loopBlock(w, loop, byId);

  for (const rule of ir.rules) ruleBlock(w, rule);

  for (const axiom of ir.axioms) {
    w.line(0, axiomLine(axiom));
    w.blank();
  }
  for (const signal of ir.signals) signalBlock(w, signal);
  if (ir.phases.length > 0) phasesBlock(w, ir.phases);
  for (const ending of ir.endings) {
    if (ending.nextChapter) {
      w.line(0, `结局 ${ending.name}:`);
      w.line(1, `当 ${exprText(ending.guard)}`);
      w.line(1, `下一章 ${stringText(ending.nextChapter)}`);
    } else {
      w.line(0, endingLine(ending));
    }
    w.blank();
  }

  return w.toString();
}
