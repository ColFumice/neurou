import { describe, expect, it } from 'vitest';
import { compileText, suggestName } from '../src/index.js';

const BASE = `世界 提示

叙事弦 甲
  类型 数值 0..100
  基线 50
`;

describe('错误文案提示（v2.18.4）', () => {
  it('谱插值拼错时提示阶跃', () => {
    const r = compileText(`${BASE}谱 测试\n  段 0 1\n  范围 0..1\n  插值 阶越\n`, 'hint-interpolation.nro');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const hint = r.diagnostics.errors.flatMap((e) => e.hint ? [e.hint] : []).join(' ');
    expect(hint).toContain('阶跃');
  });

  it('关系谱字段拼错时给出最近字段', () => {
    const r = compileText(
      `${BASE}关系谱 网\n  行 甲 乙\n  列 甲 乙\n  段 0.2 0.5\n  段 0.5 0.7\n  周其 10\n`,
      'hint-field.nro',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const hint = r.diagnostics.errors.flatMap((e) => e.hint ? [e.hint] : []).join(' ');
    expect(hint).toContain('周期');
  });

  it('曲线修饰写错时提示可用修饰', () => {
    const r = compileText(
      `${BASE}关系谱 网\n  行 甲 乙\n  列 甲 乙\n  段 0.2 0.5\n  段 0.5 0.7\n  曲线 甲 乙 修饰 0 1\n`,
      'hint-curve.nro',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const hint = r.diagnostics.errors.flatMap((e) => e.hint ? [e.hint] : []).join(' ');
    expect(hint).toContain('插值');
    expect(hint).toContain('循环');
  });

  it('suggestName 仍从 core 导出', () => {
    expect(suggestName('周其', ['周期', '速度'])).toBe('周期');
  });
});
