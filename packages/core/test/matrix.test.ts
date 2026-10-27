import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileText, patchWorldText, serialize, type WorldIR } from '../src/index.js';

/**
 * v2.1c：关系谱 —— 静态「行 × 列」数值矩阵 + 编译期查表 `查关系谱(...)`。
 *
 * 矩阵值不进入运行时：查表在编译期折叠成常量。行列标签只是作者可读的
 * 坐标名，不要求是弦名。
 */

const WORLD = `世界 关系谱测试
叙事弦 信任
  类型 数值 0..1
  基线 0.5
`;

const MATRIX = `关系谱 势力网
  行 信任 色温
  列 信任 色温
  段 1 0.3
  段 0.3 0
`;

function compileWorld(body: string) {
  return compileText(WORLD + body, 'matrix.nro');
}

function matrixShape(ir: WorldIR) {
  return ir.matrices.map((m) => ({
    id: m.id,
    name: m.name,
    rows: m.rows,
    cols: m.cols,
    values: m.values,
  }));
}

describe('关系谱：解析、编译与验证', () => {
  it('examples/spectra.nro 可编译，关系谱 IR 内容完整', () => {
    const text = readFileSync(resolve('examples', 'spectra.nro'), 'utf8');
    const r = compileText(text, 'examples/spectra.nro');

    expect(r.ok).toBe(true);
    expect(r.ir.matrices).toHaveLength(1);
    expect(r.ir.stats.matrices).toBe(1);

    const matrix = r.ir.matrices[0]!;
    expect(matrix).toMatchObject({
      id: '情绪关系',
      name: '情绪关系',
      rows: ['情绪强度', '余温'],
      cols: ['情绪强度', '余温'],
      values: [
        [1, 0.2],
        [0.2, 1],
      ],
    });
    expect(matrix.span).toBeDefined();
  });

  it('关系谱序列化往返保持同一张矩阵，且序列化幂等', () => {
    const text = readFileSync(resolve('examples', 'spectra.nro'), 'utf8');
    const r = compileText(text, 'examples/spectra.nro');
    expect(r.ok).toBe(true);

    const out = serialize(r.ir);
    expect(out).toContain('关系谱 情绪关系');
    expect(out).toContain('  行 情绪强度 余温');
    expect(out).toContain('  列 情绪强度 余温');
    expect(out).toContain('  段 1 0.2');
    expect(out).toContain('  段 0.2 1');

    const again = compileText(out, 'matrix-roundtrip.nro');
    expect(again.ok).toBe(true);
    expect(matrixShape(again.ir)).toEqual(matrixShape(r.ir));
    expect(again.ir.stats.matrices).toBe(1);

    expect(serialize(again.ir)).toBe(out);
    expect(serialize(r.ir)).toBe(out);
  });

  it('规范序列化把关系谱排在谱之后、耦合之前', () => {
    const r = compileWorld(`叙事弦 色温
  类型 数值 0..1
  基线 0.5
关系谱 势力网
  行 信任 色温
  列 信任 色温
  段 1 0.3
  段 0.3 0

谱 地形
  段 0 1
耦合 信任 → 色温 同向 0.2
`);
    expect(r.ok).toBe(true);

    const text = serialize(r.ir);
    expect(text.indexOf('谱 地形')).toBeLessThan(text.indexOf('关系谱 势力网'));
    expect(text.indexOf('关系谱 势力网')).toBeLessThan(text.indexOf('耦合 信任 → 色温'));
  });

  it('查关系谱在规则守卫、效果与结局里折叠成常量（与声明顺序无关）', () => {
    const r = compileWorld(`力迫 推
  当 查关系谱("势力网", "信任", "色温") >= 0.3
  效果
    信任 = 查关系谱("势力网", "色温", "信任")
结局 稳: 当 查关系谱("势力网", "信任", "信任") > 0.5

${MATRIX}`);
    expect(r.ok).toBe(true);

    const rule = r.ir.rules.find((x) => x.kind === 'forcing')!;
    expect(rule.guard).toEqual({
      k: 'bin',
      op: '>=',
      l: { k: 'const', v: 0.3 },
      r: { k: 'const', v: 0.3 },
    });
    expect(rule.effects[0]).toEqual({ k: 'set', id: '信任', value: { k: 'const', v: 0.3 } });
    expect(r.ir.endings[0]!.guard).toEqual({
      k: 'bin',
      op: '>',
      l: { k: 'const', v: 1 },
      r: { k: 'const', v: 0.5 },
    });
  });

  it('查表结果是常量，不会给任何弦制造读取', () => {
    const r = compileWorld(`${MATRIX}结局 稳: 当 查关系谱("势力网", "信任", "信任") > 0.5`);
    expect(r.ok).toBe(true);

    // 结局只用到常量；信任既没被读也没被写，仍是死弦。
    expect(
      r.diagnostics.all().some((d) => d.code === 'NRO3102' && d.message.includes('信任')),
    ).toBe(true);
  });

  it('引用不存在的关系谱报 NRO2101，并给出近似名字建议', () => {
    const r = compileWorld(`${MATRIX}结局 稳: 当 查关系谱("势力", "信任", "信任") > 0.5`);
    expect(r.ok).toBe(false);

    const error = r.diagnostics.errors.find(
      (d) => d.code === 'NRO2101' && d.message.includes('不存在的关系谱'),
    );
    expect(error).toBeTruthy();
    expect(error!.message).toContain('势力');
    expect(error!.hint).toContain('势力网');
  });

  it('行标签或列标签不存在报 NRO2101，并给出近似名字建议', () => {
    const row = compileWorld(`${MATRIX}结局 稳: 当 查关系谱("势力网", "信认", "信任") > 0.5`);
    expect(row.ok).toBe(false);
    const rowError = row.diagnostics.errors.find(
      (d) => d.code === 'NRO2101' && d.message.includes('没有行标签'),
    );
    expect(rowError).toBeTruthy();
    expect(rowError!.message).toContain('信认');
    expect(rowError!.hint).toContain('信任');

    const col = compileWorld(`${MATRIX}结局 稳: 当 查关系谱("势力网", "信任", "色度") > 0.5`);
    expect(col.ok).toBe(false);
    const colError = col.diagnostics.errors.find(
      (d) => d.code === 'NRO2101' && d.message.includes('没有列标签'),
    );
    expect(colError).toBeTruthy();
    expect(colError!.message).toContain('色度');
    expect(colError!.hint).toContain('色温');
  });

  it('三个参数都必须是直接写出的字符串字面量（NRO2003）', () => {
    for (const expr of [
      '查关系谱(0.5, "信任", "信任")',
      '查关系谱("势力网", 信任, "信任")',
      '查关系谱("势力网", "信任", 0.5)',
    ]) {
      const r = compileWorld(`${MATRIX}结局 稳: 当 ${expr} > 0.5`);
      expect(r.ok).toBe(false);
      expect(
        r.diagnostics.errors.some(
          (d) => d.code === 'NRO2003' && d.message.includes('直接写出的字符串'),
        ),
      ).toBe(true);
    }
  });

  it('参数个数不是 3 时报 NRO2003', () => {
    for (const expr of [
      '查关系谱("势力网", "信任")',
      '查关系谱("势力网", "信任", "信任", 1)',
    ]) {
      const r = compileWorld(`${MATRIX}结局 稳: 当 ${expr} > 0.5`);
      expect(r.ok).toBe(false);
      expect(
        r.diagnostics.errors.some((d) => d.code === 'NRO2003' && d.message.includes('三个参数')),
      ).toBe(true);
    }
  });

  it('同行或同列的标签重复是 NRO2100', () => {
    const dupRows = compileWorld(`关系谱 重行
  行 甲 甲
  列 乙
  段 0
  段 0
`);
    expect(dupRows.ok).toBe(false);
    expect(
      dupRows.diagnostics.errors.some(
        (d) => d.code === 'NRO2100' && d.message.includes('行标签「甲」重复'),
      ),
    ).toBe(true);

    const dupCols = compileWorld(`关系谱 重列
  行 甲
  列 乙 乙
  段 0 0
`);
    expect(dupCols.ok).toBe(false);
    expect(
      dupCols.diagnostics.errors.some(
        (d) => d.code === 'NRO2100' && d.message.includes('列标签「乙」重复'),
      ),
    ).toBe(true);
  });

  it('段数与行数、每段宽度与列数对不上都是 NRO2100', () => {
    const missingSegments = compileWorld(`关系谱 缺段
  行 甲 乙
  列 甲
  段 0
`);
    expect(missingSegments.ok).toBe(false);
    expect(
      missingSegments.diagnostics.errors.some(
        (d) =>
          d.code === 'NRO2100' &&
          d.message.includes('需要 2 条「段」') &&
          d.message.includes('写了 1 条'),
      ),
    ).toBe(true);

    const wrongWidth = compileWorld(`关系谱 窄段
  行 甲
  列 甲 乙
  段 0
`);
    expect(wrongWidth.ok).toBe(false);
    expect(
      wrongWidth.diagnostics.errors.some(
        (d) =>
          d.code === 'NRO2100' &&
          d.message.includes('第 1 条「段」有 1 个数') &&
          d.message.includes('2 个标签'),
      ),
    ).toBe(true);
  });

  it('缺少行/列标签、超过 64 个标签都是 NRO2100', () => {
    const empty = compileWorld(`关系谱 空网
  段 0
`);
    expect(empty.ok).toBe(false);
    expect(
      empty.diagnostics.errors.some(
        (d) => d.code === 'NRO2100' && d.message.includes('没有「行」标签'),
      ),
    ).toBe(true);

    const labels = Array.from({ length: 65 }, (_, i) => `甲${i}`).join(' ');
    const segments = Array.from({ length: 65 }, () => '  段 0').join('\n');
    const tooMany = compileWorld(`关系谱 太大
  行 ${labels}
  列 甲0
${segments}
`);
    expect(tooMany.ok).toBe(false);
    expect(
      tooMany.diagnostics.errors.some(
        (d) =>
          d.code === 'NRO2100' &&
          d.message.includes('65 个行标签') &&
          d.message.includes('64'),
      ),
    ).toBe(true);
  });

  it('矩阵值必须有限（NRO2100）', () => {
    const huge = '9'.repeat(400);
    const r = compileWorld(`关系谱 巨值
  行 甲
  列 甲
  段 ${huge}
`);
    expect(r.ok).toBe(false);
    expect(
      r.diagnostics.errors.some(
        (d) => d.code === 'NRO2100' && d.message.includes('不是有限数字'),
      ),
    ).toBe(true);
  });

  it('同名的关系谱重复声明是 NRO2004', () => {
    const r = compileWorld(`${MATRIX}${MATRIX}`);
    expect(r.ok).toBe(false);
    expect(
      r.diagnostics.errors.some(
        (d) => d.code === 'NRO2004' && d.message.includes('重复声明'),
      ),
    ).toBe(true);
    expect(r.ir.matrices).toHaveLength(1);
    expect(r.ir.matrices[0]?.name).toBe('势力网');
  });

  it('关系谱与谱/弦/实体共享顶层命名空间（NRO2004）', () => {
    const withSpectrum = compileWorld(`谱 撞名
  段 0 1
关系谱 撞名
  行 甲
  列 甲
  段 0
`);
    expect(withSpectrum.ok).toBe(false);
    expect(
      withSpectrum.diagnostics.errors.some(
        (d) => d.code === 'NRO2004' && d.message.includes('与同名谱冲突'),
      ),
    ).toBe(true);

    const withString = compileWorld(`关系谱 信任
  行 甲
  列 甲
  段 0
`);
    expect(withString.ok).toBe(false);
    expect(
      withString.diagnostics.errors.some(
        (d) => d.code === 'NRO2004' && d.message.includes('与同名弦冲突'),
      ),
    ).toBe(true);

    const withEntity = compileWorld(`实体 撞名实体
  是 节点
关系谱 撞名实体
  行 甲
  列 甲
  段 0
`);
    expect(withEntity.ok).toBe(false);
    expect(
      withEntity.diagnostics.errors.some(
        (d) => d.code === 'NRO2004' && d.message.includes('与同名实体冲突'),
      ),
    ).toBe(true);
  });

  it('未知字段、重复「行」/「列」是语法诊断（NRO1100）', () => {
    const unknown = compileWorld(`关系谱 杂项
  行 甲
  列 甲
  段 0
  颜色 红
`);
    expect(unknown.ok).toBe(false);
    expect(
      unknown.diagnostics.errors.some(
        (d) => d.code === 'NRO1100' && d.message.includes('不认识「颜色」'),
      ),
    ).toBe(true);

    const dupRow = compileWorld(`关系谱 重行字段
  行 甲
  行 乙
  列 甲
  段 0
`);
    expect(dupRow.ok).toBe(false);
    expect(
      dupRow.diagnostics.errors.some(
        (d) => d.code === 'NRO1100' && d.message.includes('「行」只能声明一次'),
      ),
    ).toBe(true);

    const dupCol = compileWorld(`关系谱 重列字段
  行 甲
  列 甲
  列 乙
  段 0
`);
    expect(dupCol.ok).toBe(false);
    expect(
      dupCol.diagnostics.errors.some(
        (d) => d.code === 'NRO1100' && d.message.includes('「列」只能声明一次'),
      ),
    ).toBe(true);
  });

  it('注释与多余空白不影响解析，值可以是负数', () => {
    const src = `# 顶层注释
世界 注释关系谱

叙事弦 信任
  # 弦内注释
  类型 数值 0..1
  基线 0.5

关系谱 带注释的网
  行 信任   色温\t步态  # 行尾注释
  列 信任 色温 步态
  段 -1   0.3  0  # 第一行
  段 0.3 0 0.6
  段 0 0.6 0
`;
    const r = compileText(src, 'matrix-comments.nro');
    expect(r.ok).toBe(true);
    expect(r.ir.matrices[0]).toMatchObject({
      rows: ['信任', '色温', '步态'],
      cols: ['信任', '色温', '步态'],
      values: [
        [-1, 0.3, 0],
        [0.3, 0, 0.6],
        [0, 0.6, 0],
      ],
    });
  });

  it('patch 的结构签名包含关系谱：改矩阵值必须回退整图序列化', () => {
    const source = WORLD + MATRIX;
    const base = compileText(source, 'matrix-patch.nro');
    expect(base.ok).toBe(true);

    const edited: WorldIR = {
      ...base.ir,
      matrices: base.ir.matrices.map((matrix) => ({
        ...matrix,
        values: matrix.values.map((row, i) => row.map((value, j) => (i === 0 && j === 1 ? 0.9 : value))),
      })),
    };
    expect(edited.matrices[0]?.values[0]?.[1]).toBe(0.9);

    const result = patchWorldText(source, base.ir, edited);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('结构变化');
  });
});
