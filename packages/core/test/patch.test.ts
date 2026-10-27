import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  compileText,
  patchWorldText,
  setCouplingStrengthBetween,
  setStringBaseline,
  setStringThreshold,
  type WorldIR,
} from '../src/index.js';

function readCommitted(file: string): string {
  try {
    return execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function loadTuner(): { text: string; ir: WorldIR } {
  const text = readCommitted('examples/tuner.nro');
  const compiled = compileText(text, 'examples/tuner.nro');
  if (!compiled.ok) throw new Error('tuner.nro 编译失败');
  return { text, ir: compiled.ir };
}

function commentLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => /^\s*#/.test(line)).length;
}

function editedIr(ir: WorldIR, edit: (copy: WorldIR) => ReturnType<typeof setStringBaseline>): WorldIR {
  const result = edit(ir);
  if (!result.ok) throw new Error(result.error);
  return result.ir;
}

describe('源文本行级写回（保留注释与排版）', () => {
  it('只改基线行，注释/空行/顺序全部保留', () => {
    const { text, ir } = loadTuner();
    const edited = editedIr(ir, (copy) => setStringBaseline(copy, '信任', 42.5));
    const result = patchWorldText(text, ir, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('基线 42.5');
    expect(result.text).not.toContain('由 neurou 序列化器生成');
    expect(commentLines(result.text)).toBe(commentLines(text));
    expect(result.text.startsWith('# 八弦调律台的默认世界')).toBe(true);
    const compiled = compileText(result.text, 'patched.nro');
    expect(compiled.ok).toBe(true);
    expect(compiled.ir.strings.find((s) => s.id === '信任')?.baseline).toBe(42.5);
  });

  it('基线 + 悬崖 + 安全三条线一次 patch', () => {
    const { text, ir } = loadTuner();
    let edited = editedIr(ir, (copy) => setStringBaseline(copy, '信任', 40));
    edited = editedIr(edited, (copy) => setStringThreshold(copy, '信任', 'verge', 30));
    edited = editedIr(edited, (copy) => setStringThreshold(copy, '信任', 'safe', 70));
    const result = patchWorldText(text, ir, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toHaveLength(3);
    const compiled = compileText(result.text, 'patched.nro');
    expect(compiled.ok).toBe(true);
    const trust = compiled.ir.strings.find((s) => s.id === '信任');
    expect(trust?.baseline).toBe(40);
    expect(trust?.verge).toBe(30);
    expect(trust?.safe).toBe(70);
    expect(commentLines(result.text)).toBe(commentLines(text));
  });

  it('行内耦合强度（信任→恐惧）可 patch', () => {
    const { text, ir } = loadTuner();
    const edited = editedIr(ir, (copy) => setCouplingStrengthBetween(copy, '信任', '恐惧', 0.66));
    const result = patchWorldText(text, ir, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toMatch(/耦合 信任 → 恐惧 反向 0\.66/);
    const compiled = compileText(result.text, 'patched.nro');
    expect(compiled.ok).toBe(true);
    const coupling = compiled.ir.couplings.find((c) => c.from === '信任' && c.to === '恐惧');
    expect(coupling?.strength).toBe(0.66);
  });

  it('回路块里的边强度可 patch', () => {
    const { text, ir } = loadTuner();
    const edited = editedIr(ir, (copy) => setCouplingStrengthBetween(copy, '信任', '色温', 0.65));
    const result = patchWorldText(text, ir, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('边 信任 → 色温 同向 0.65');
    const compiled = compileText(result.text, 'patched.nro');
    expect(compiled.ok).toBe(true);
    expect(compiled.ir.couplings.find((c) => c.from === '信任' && c.to === '色温')?.strength).toBe(0.65);
  });

  it('链式回路的边没有独立强度：拒绝 patch，交回规范序列化', () => {
    const text = execFileSync('git', ['show', 'HEAD:examples/rain-slice.nro'], { encoding: 'utf8' });
    const compiled = compileText(text, 'rain-slice.nro');
    expect(compiled.ok).toBe(true);
    const chainCoupling = compiled.ir.couplings.find((c) => c.loop !== undefined);
    expect(chainCoupling).toBeDefined();
    if (!chainCoupling) return;
    const edited = editedIr(compiled.ir, (copy) =>
      setCouplingStrengthBetween(copy, chainCoupling.from, chainCoupling.to, chainCoupling.strength + 0.1),
    );
    const result = patchWorldText(text, compiled.ir, edited);
    expect(result.ok).toBe(false);
  });

  it('没有变化时原样返回', () => {
    const { text, ir } = loadTuner();
    const result = patchWorldText(text, ir, ir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe(text);
  });

  it('结构性变化（增删耦合）拒绝 patch', () => {
    const { text, ir } = loadTuner();
    const edited: WorldIR = {
      ...ir,
      couplings: ir.couplings.slice(1),
    };
    const result = patchWorldText(text, ir, edited);
    expect(result.ok).toBe(false);
  });

  it('CRLF 源文本会被统一成 LF 再 patch（span 与编译一致）', () => {
    const { text, ir } = loadTuner();
    const crlf = text.replace(/\r?\n/g, '\r\n');
    const compiled = compileText(crlf, 'crlf.nro');
    expect(compiled.ok).toBe(true);
    const edited = editedIr(compiled.ir, (copy) => setStringBaseline(copy, '信任', 44));
    const result = patchWorldText(crlf, compiled.ir, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('基线 44');
    expect(result.text).not.toContain('\r');
    const recompiled = compileText(result.text, 'crlf-patched.nro');
    expect(recompiled.ok).toBe(true);
    expect(recompiled.ir.strings.find((s) => s.id === '信任')?.baseline).toBe(44);
  });
});
