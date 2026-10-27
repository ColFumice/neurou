import { describe, expect, it } from 'vitest';
import { compileText, patchWorldText, setMatrixCell, setMatrixCurveBand } from '../src/index.js';

const SOURCE = `世界 矩阵写回
关系谱 势力网
  # 保留这行注释
  行 信任 色温
  列 信任 色温
  段 1 0.3
  段 0.3 1

叙事弦 信任
  类型 数值 0..100
  基线 50
`;

function compileS(text: string) {
  const r = compileText(text, 'matrix-edit.nro');
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('compile failed');
  return r.ir;
}

describe('关系谱：GUI 写回', () => {
  it('setMatrixCell 只改一个格子，并保持二维形状', () => {
    const ir = compileS(SOURCE);
    const result = setMatrixCell(ir, '势力网', 1, 0, 0.42);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.matrices[0]?.values).toEqual([
      [1, 0.3],
      [0.42, 1],
    ]);
  });

  it('patchWorldText 只改对应 段 行的数字并保留注释/排版', () => {
    const base = compileS(SOURCE);
    const edited = setMatrixCell(base, '势力网', 1, 0, 0.42);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const patched = patchWorldText(SOURCE, base, edited.ir);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.changed).toContain('势力网.values');
    expect(patched.text).toContain('# 保留这行注释');
    expect(patched.text).toContain('  段 1 0.3');
    expect(patched.text).toContain('  段 0.42 1');
    expect(patched.text).not.toContain('  段 0.3 1');
    const again = compileText(patched.text, 'matrix-patched.nro');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.ir.matrices[0]?.values[1]).toEqual([0.42, 1]);
  });

  it('关系谱曲线段值可改且行级写回', () => {
    const source = SOURCE.replace(
      '  段 0.3 1',
      '  段 0.3 1\n  曲线 信任 色温 0.2 0.5 0.3\n  插值 平滑',
    );
    const base = compileS(source);
    const edited = setMatrixCurveBand(base, '势力网', '信任', '色温', 1, 0.8);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.ir.matrices[0]?.curves?.[0]?.bands).toEqual([0.2, 0.8, 0.3]);
    const patched = patchWorldText(source, base, edited.ir);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.changed).toContain('势力网.curves');
    expect(patched.text).toContain('  曲线 信任 色温 0.2 0.8 0.3');
    expect(patched.text).toContain('# 保留这行注释');
    expect(setMatrixCurveBand(base, '势力网', '信任', '色温', 9, 0.2).ok).toBe(false);
  });

  it('行列越界/非有限值报错', () => {
    const ir = compileS(SOURCE);
    expect(setMatrixCell(ir, '势力网', 9, 0, 0.2).ok).toBe(false);
    expect(setMatrixCell(ir, '势力网', 0, 9, 0.2).ok).toBe(false);
    expect(setMatrixCell(ir, '势力网', 0, 0, Number.NaN).ok).toBe(false);
    expect(setMatrixCell(ir, '不存在', 0, 0, 0.2).ok).toBe(false);
  });
});
