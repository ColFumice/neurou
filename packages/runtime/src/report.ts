import type { WorldIR } from '@neurou/core';
import { preferenceOf } from '@neurou/core';
import type { BatchResult, HealthReport, ModelStats, RunSummary } from './simulate.js';

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  magenta: '\u001b[35m',
  gray: '\u001b[90m',
  white: '\u001b[97m',
};

export interface RenderOptions {
  color?: boolean;
}

export function renderBatchReport(result: BatchResult, opts: RenderOptions = {}): string {
  const color = opts.color ?? false;
  const p = (code: string, s: string): string => (color ? `${code}${s}${ANSI.reset}` : s);
  const out: string[] = [];
  const ir = result.ir;

  out.push('');
  out.push(p(ANSI.bold + ANSI.cyan, `  雨若 · 音准仪    ${ir.name}`));
  out.push(p(ANSI.gray, `  ${'─'.repeat(56)}`));
  const tonality = ir.meta['调性'] ?? '未定';
  out.push(
    `  ${p(ANSI.dim, '调性')} ${String(tonality)}    ${p(ANSI.dim, '弦')} ${ir.stats.strings}    ${p(ANSI.dim, '耦合')} ${ir.stats.couplings}    ${p(ANSI.dim, '回路')} ${ir.stats.loops}    ${p(ANSI.dim, '规则')} ${ir.stats.rules}    ${p(ANSI.dim, '信号')} ${ir.stats.signals}    ${p(ANSI.dim, '结局')} ${ir.stats.endings}`,
  );
  out.push(
    p(
      ANSI.gray,
      `  ${result.options.runs} 局 × ${result.options.models.length} 模型 · 拍数上限 ${result.options.maxTicks} · 用时 ${result.elapsedMs}ms`,
    ),
  );

  out.push('');
  out.push(renderHealth(result.health, p, color));

  out.push('');
  out.push(p(ANSI.bold, '  命运分布'));
  const total = Math.max(1, result.overall.runs);
  const sorted = Object.entries(result.overall.endings).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    const pct = count / total;
    const marker = name === '超时' ? p(ANSI.yellow, '○') : p(ANSI.green, '●');
    out.push(`  ${marker} ${name.padEnd(6, '　')} ${bar(pct, 30, p)} ${(pct * 100).toFixed(0).padStart(3)}%  ${p(ANSI.gray, `${count} 局`)}`);
  }
  if (sorted.length === 1) {
    out.push(p(ANSI.yellow, '  ⚠ 只有一种结局：回路可能把世界锁死在同一个吸引子上。'));
  }

  out.push('');
  out.push(p(ANSI.bold, '  维度'));
  for (const d of result.health.dimensions) {
    const mark = d.ratio >= 0.8 ? p(ANSI.green, '●') : d.ratio >= 0.5 ? p(ANSI.yellow, '◐') : p(ANSI.red, '○');
    out.push(`  ${mark} ${d.label.padEnd(7, '　')} ${String(d.value).padStart(4)}  ${p(ANSI.gray, d.detail)}`);
  }

  out.push('');
  out.push(p(ANSI.bold, '  模型对照'));
  out.push(p(ANSI.gray, `  ${'模型'.padEnd(8)} ${'平均拍数'.padEnd(9)} ${'结局数'.padEnd(7)} 主要结局`));
  for (const m of result.models) {
    const top = Object.entries(m.endings).sort((a, b) => b[1] - a[1])[0];
    out.push(
      `  ${modelLabel(m.model).padEnd(9, '　')} ${String(m.meanTicks).padEnd(10)} ${String(m.distinctOutcomes).padEnd(8)} ${top ? `${top[0]} ${Math.round((top[1] / Math.max(1, m.runs)) * 100)}%` : '—'}`,
    );
  }

  if (ir.loops.length > 0) {
    out.push('');
    out.push(p(ANSI.bold, '  回路'));
    for (const loop of ir.loops) {
      const kind = loop.polarity === 1 ? p(ANSI.magenta, '自我强化') : p(ANSI.cyan, '自我校正');
      const nodes = [...new Set(loop.edges.map((id) => ir.couplings.find((c) => c.id === id)).filter((c) => !!c).flatMap((c) => [c.from, c.to]))];
      out.push(`  ${loop.name.padEnd(6, '　')} ${kind}  ${p(ANSI.gray, nodes.join(' → '))}`);
    }
  }

  if (ir.strings.length > 0) {
    out.push('');
    out.push(p(ANSI.bold, '  弦'));
    for (const s of ir.strings) {
      const pref = preferenceOf(s);
      const dir = pref === 1 ? '越高越好' : pref === -1 ? '越低越好' : '无方向';
      const thr =
        s.verge !== undefined || s.safe !== undefined
          ? `  悬崖 ${s.verge ?? '—'} / 安全 ${s.safe ?? '—'}`
          : '';
      out.push(`  ${s.id.padEnd(10, '　')} ${p(ANSI.dim, `[${s.kind}弦·${dir}]`)}${p(ANSI.gray, thr)}`);
    }
  }

  const issues = collectIssues(result);
  if (issues.length > 0) {
    out.push('');
    out.push(p(ANSI.bold, '  需要看的'));
    for (const line of issues) out.push(`  ${line}`);
  }

  if (result.health.notes.length > 0) {
    out.push('');
    out.push(p(ANSI.bold, '  音准师的备注'));
    for (const n of result.health.notes) out.push(`  ${p(ANSI.gray, '·')} ${n}`);
  }

  out.push('');
  out.push(p(ANSI.gray, `  绿区 60–85 是刻意的：100 分意味着没有意外。`));
  out.push('');
  return out.join('\n');
}

function renderHealth(h: HealthReport, p: (c: string, s: string) => string, color: boolean): string {
  const colorCode = h.grade === '红' ? ANSI.red : h.grade === '绿' ? ANSI.green : ANSI.yellow;
  const gradeText = h.grade === '红' ? '红区 · 还站不稳' : h.grade === '绿' ? '绿区 · 可以发布' : '黄区 · 过于均衡';
  const lines: string[] = [];
  lines.push(
    `  ${p(ANSI.bold + colorCode, `音准 ${String(h.score).padStart(3)}/100`)}  ${bar(h.score / 100, 28, p)}  ${p(colorCode, gradeText)}`,
  );
  lines.push(`  ${p(ANSI.gray, h.verdict)}`);
  void color;
  return lines.join('\n');
}

function collectIssues(result: BatchResult): string[] {
  const issues: string[] = [];
  const o = result.overall;
  if (o.violations > 0) issues.push(`✗ 公理违反 ${o.violations} 次——某个规则在把世界推到自相矛盾。`);
  if (o.deadStateRuns > 0) issues.push(`✗ ${o.deadStateRuns} 局的玩家陷入「无事可做」。`);
  if (o.deadForcings.length > 0) issues.push(`○ 从未触发的力迫：${o.deadForcings.join('、')}`);
  if (o.deadSignals.length > 0) issues.push(`○ 从未被感知的信号：${o.deadSignals.join('、')}`);
  if (o.unusedActions.length > 0) issues.push(`○ 从未被选中的动作：${o.unusedActions.join('、')}`);
  if (o.distinctOutcomes <= 1) issues.push('○ 结局没有分歧——试着让一条回路更陡，或者加一个反向的出口。');
  if (result.overall.attractors.length > 0 && o.runs > 0) {
    const top = o.attractors[0]!;
    if (top.count / o.runs > 0.8) issues.push(`○ ${Math.round((top.count / o.runs) * 100)}% 的局收敛到同一个终局。`);
  }
  return issues;
}

export function renderRun(run: RunSummary): string {
  const lines = [
    `${modelLabel(run.model)} · ${run.ending} · ${run.ticks} 拍 · 信号 ${run.cues} 次${run.violations > 0 ? ` · 公理违反 ${run.violations}` : ''}`,
    `  触发力迫：${run.firedForcings.join('、') || '无'}`,
    `  使用动作：${run.usedActions.join('、') || '无'}`,
  ];
  return lines.join('\n');
}

export function modelLabel(m: string): string {
  switch (m) {
    case 'random':
      return '随机';
    case 'greedy':
      return '贪心';
    case 'learner':
      return '学习';
    default:
      return '整体';
  }
}

export function bar(ratio: number, width: number, p?: (c: string, s: string) => string): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * width);
  const full = '█'.repeat(filled);
  const rest = '░'.repeat(Math.max(0, width - filled));
  return p ? `${p(ANSI.green, full)}${p(ANSI.gray, rest)}` : `${full}${rest}`;
}

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return w;
}

/** 按终端显示宽度补齐（中文按两列算）。 */
export function padDisplay(s: string, width: number): string {
  const w = displayWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}

/** 一段可读的弦状态条：用于交互游玩时逐拍显示。 */
export function stateLines(world: WorldIR, view: { id: string; value: unknown; verge?: number; safe?: number; min?: number; max?: number }[]): string[] {
  const lines: string[] = [];
  for (const row of view) {
    if (typeof row.value !== 'number') continue;
    const min = row.min ?? 0;
    const max = row.max ?? 100;
    const t = max > min ? (row.value - min) / (max - min) : 0;
    const s = world.strings.find((x) => x.id === row.id);
    const pref = s ? preferenceOf(s) : 0;
    const danger = pref === 1 ? t < 0.3 : pref === -1 ? t > 0.7 : false;
    lines.push(
      `  ${padDisplay(row.id, 16)} ${bar(t, 16)} ${String(Math.round(row.value * 10) / 10).padStart(6)}${danger ? '  ⚠' : ''}`,
    );
  }
  return lines;
}

export { ANSI };
