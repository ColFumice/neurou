import { describe, expect, it } from 'vitest';
import { compileText, serialize, setMatrixCell } from '../src/index.js';

const WORLD = `世界 动态值

叙事弦 信任
  类型 数值 0..100
  基线 50

叙事弦 情绪
  类型 数值 0..100
  基线 20

关系谱 网
  行 信任 情绪
  列 信任 情绪
  段 0.2 0.5
  段 0.5 0.7
  动态 信任 情绪 信任 / 100 + 0.1

结局 看: 当 查关系谱("网", "信任", "情绪") > 0.3
`;

describe('关系谱动态值表达式（v2.19）', () => {
  it('解析/IR/序列化并阻止查表折叠', () => {
    const r = compileText(WORLD, 'matrix-dynamic.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.matrices[0]?.dynamics?.[0]?.row).toBe('信任');
    const text = serialize(r.ir);
    expect(text).toContain('动态 信任 情绪 信任 / 100 + 0.1');
    expect(compileText(text, 'matrix-dynamic-roundtrip.nro').ok).toBe(true);
    expect(r.ir.endings[0]?.guard.k).not.toBe('const');
  });

  it('同格不能同时有曲线和动态值', () => {
    const source = WORLD.replace('  动态 信任 情绪', '  曲线 信任 情绪 0 1\n  动态 信任 情绪');
    const r = compileText(source, 'matrix-dynamic-conflict.nro');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.errors.some((e) => e.code === 'NRO2100')).toBe(true);
  });

  it('效果不能写动态格', () => {
    const source = `${WORLD.replace('结局 看: 当 查关系谱("网", "信任", "情绪") > 0.3\n', '')}力迫 改\n  效果\n    关系谱 网 信任 情绪 += 0.1\n`;
    const r = compileText(source, 'matrix-dynamic-effect.nro');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.errors.some((e) => e.code === 'NRO2100')).toBe(true);
  });

  it('GUI 编辑接口拒绝改动态格', () => {
    const r = compileText(WORLD, 'matrix-dynamic-edit.nro');
    if (!r.ok) throw new Error('compile failed');
    expect(setMatrixCell(r.ir, '网', 0, 1, 0.9).ok).toBe(false);
  });
});
