import type { SourceFile, Span } from './source.js';

/**
 * 三级诊断——这是 neurou 与通用语言编译器最大的差别。
 *
 * 语法级：糖衣拼错了，指到那一行。
 * 语义级：规则之间的关系坏了（回路死锁、公理矛盾、力迫冲突），指向整组声明。
 * 体验级：规则跑得通，但玩家感知不到（静默失败、体验过载、结局同质）。
 *
 * 每一级出现的位置不同，因为修改它的地方不同。
 */

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticTier = 'syntax' | 'semantic' | 'experience';

export interface Diagnostic {
  code: string;
  severity: Severity;
  tier: DiagnosticTier;
  /** 人话。默认路径下玩家/创作者直接看到的就是这一句。 */
  message: string;
  /** 一句话怎么改。可选，但强烈建议每个 error 都带。 */
  hint?: string;
  span?: Span;
  file?: string;
  /** 诊断关联的声明名（用于结构区高亮） */
  related?: string[];
}

export class DiagnosticBag {
  private readonly items: Diagnostic[] = [];

  add(d: Diagnostic): void {
    this.items.push(d);
  }

  error(code: string, tier: DiagnosticTier, message: string, opts: Partial<Omit<Diagnostic, 'code' | 'severity' | 'tier' | 'message'>> = {}): void {
    this.items.push({ code, severity: 'error', tier, message, ...opts });
  }

  warn(code: string, tier: DiagnosticTier, message: string, opts: Partial<Omit<Diagnostic, 'code' | 'severity' | 'tier' | 'message'>> = {}): void {
    this.items.push({ code, severity: 'warning', tier, message, ...opts });
  }

  info(code: string, tier: DiagnosticTier, message: string, opts: Partial<Omit<Diagnostic, 'code' | 'severity' | 'tier' | 'message'>> = {}): void {
    this.items.push({ code, severity: 'info', tier, message, ...opts });
  }

  all(): readonly Diagnostic[] {
    return this.items;
  }

  get errors(): Diagnostic[] {
    return this.items.filter((d) => d.severity === 'error');
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }

  count(severity: Severity): number {
    return this.items.filter((d) => d.severity === severity).length;
  }

  merge(other: DiagnosticBag): void {
    for (const d of other.items) this.items.push(d);
  }

  sorted(): Diagnostic[] {
    const rank: Record<DiagnosticTier, number> = { syntax: 0, semantic: 1, experience: 2 };
    const sev: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
    return [...this.items].sort((a, b) => {
      if (a.severity !== b.severity) return sev[a.severity] - sev[b.severity];
      if (a.tier !== b.tier) return rank[a.tier] - rank[b.tier];
      const la = a.span?.start.line ?? 1e9;
      const lb = b.span?.start.line ?? 1e9;
      return la - lb;
    });
  }
}

const TIER_LABEL: Record<DiagnosticTier, string> = {
  syntax: '语法',
  semantic: '语义',
  experience: '体验',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  error: '错误',
  warning: '警告',
  info: '提示',
};

/** 渲染一条诊断（带源码行与插入符）。 */
export function formatDiagnostic(file: SourceFile | undefined, d: Diagnostic): string {
  const head = `${SEVERITY_LABEL[d.severity]}[${TIER_LABEL[d.tier]}/${d.code}] ${d.message}`;
  const lines: string[] = [head];
  if (file && d.span) {
    const lineNo = d.span.start.line;
    const lineText = file.lineText(lineNo);
    const lineLabel = String(lineNo + 1).padStart(4, ' ');
    lines.push(`  ${lineLabel} │ ${lineText}`);
    const startCol = d.span.start.column;
    const endCol = d.span.end.line === lineNo ? d.span.end.column : lineText.length;
    const width = Math.max(1, endCol - startCol);
    lines.push(`       │ ${' '.repeat(startCol)}${'^'.repeat(width)}`);
  }
  if (d.hint) lines.push(`       → ${d.hint}`);
  return lines.join('\n');
}
