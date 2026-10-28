import { describe, expect, it } from 'vitest';
import { compileText, addMatrixRow, addMatrixCol, removeMatrixRow, removeMatrixCol, renameMatrixRow, renameMatrixCol } from '../src/index.js';

const SOURCE = `世界 关系结构

叙事弦 信任
  类型 数值 0..100
  基线 50

关系谱 势力网
  行 信任 色温
  列 信任 色温
  段 1 0.3
  段 0.3 1
  曲线 信任 色温 0.2 0.5 0.8
`;

function base() {
  const r = compileText(SOURCE, 'matrix-structure.nro');
  if (!r.ok) throw new Error('compile failed');
  return r.ir;
}

describe('关系谱：行列增删/改名（v2.4.3）', () => {
  it('插行插列保持矩阵形状', () => {
    const ir = base();
    const row = addMatrixRow(ir, '势力网', '新行1');
    expect(row.ok).toBe(true);
    if (!row.ok) return;
    expect(row.ir.matrices[0]?.rows).toEqual(['信任', '色温', '新行1']);
    expect(row.ir.matrices[0]?.values[2]).toEqual([0, 0]);

    const col = addMatrixCol(row.ir, '势力网', '新列1', 1);
    expect(col.ok).toBe(true);
    if (!col.ok) return;
    expect(col.ir.matrices[0]?.cols).toEqual(['信任', '新列1', '色温']);
    expect(col.ir.matrices[0]?.values[0]).toEqual([1, 0, 0.3]);
  });

  it('删行删列会移除对应曲线', () => {
    const ir = base();
    const noRow = removeMatrixRow(ir, '势力网', 0);
    expect(noRow.ok).toBe(true);
    if (!noRow.ok) return;
    expect(noRow.ir.matrices[0]?.rows).toEqual(['色温']);
    expect(noRow.ir.matrices[0]?.curves).toHaveLength(0);
  });

  it('改名同步曲线标签，重复标签报错', () => {
    const ir = base();
    const renamed = renameMatrixCol(ir, '势力网', 1, '信赖');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.ir.matrices[0]?.curves[0]?.col).toBe('信赖');
    expect(renameMatrixRow(ir, '势力网', 1, '信任').ok).toBe(false);
  });

  it('至少保留一行/一列', () => {
    const ir = base();
    const one = removeMatrixRow(ir, '势力网', 0);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(removeMatrixRow(one.ir, '势力网', 0).ok).toBe(false);
    const oneCol = removeMatrixCol(ir, '势力网', 0);
    expect(oneCol.ok).toBe(true);
    if (!oneCol.ok) return;
    expect(removeMatrixCol(oneCol.ir, '势力网', 0).ok).toBe(false);
  });
});
