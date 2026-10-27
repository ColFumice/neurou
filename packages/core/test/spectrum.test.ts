import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileText, serialize, type WorldIR } from '../src/index.js';

const WORLD = '世界 谱测试\n';

const STRING = `叙事弦 情绪
  类型 数值 0..1
  基线 0.5
`;

function compileWorld(body: string) {
  return compileText(WORLD + body, 'spectrum.nro');
}

function spectrumShape(ir: WorldIR) {
  return ir.spectra.map((s) => ({
    id: s.id,
    name: s.name,
    bands: s.bands,
    min: s.min,
    max: s.max,
    interpolation: s.interpolation,
    loop: s.loop,
  }));
}

describe('谱：解析、编译与验证', () => {
  it('examples/spectra.nro 可编译，IR 内容完整', () => {
    const text = readFileSync(resolve('examples', 'spectra.nro'), 'utf8');
    const r = compileText(text, 'examples/spectra.nro');

    expect(r.ok).toBe(true);
    expect(r.ir.spectra).toHaveLength(1);
    expect(r.ir.stats.spectra).toBe(1);

    const spectrum = r.ir.spectra[0]!;
    expect(spectrum).toMatchObject({
      id: '情绪地形',
      name: '情绪地形',
      bands: [0.1, 0.4, 0.8, 0.5],
      min: 0,
      max: 1,
      interpolation: '平滑',
      loop: true,
    });
    expect(spectrum.span).toBeDefined();
  });

  it('省略范围 / 插值 / 循环时取默认值，序列化也省略默认值', () => {
    const r = compileWorld(`${STRING}谱 默认地形
  段 0 0.5 1
`);

    expect(r.ok).toBe(true);
    expect(r.ir.stats.spectra).toBe(1);
    expect(r.ir.spectra[0]).toMatchObject({
      bands: [0, 0.5, 1],
      min: 0,
      max: 1,
      interpolation: '线性',
      loop: false,
    });

    const text = serialize(r.ir);
    expect(text).toContain('谱 默认地形');
    expect(text).toContain('  段 0 0.5 1');
    expect(text).not.toContain('范围');
    expect(text).not.toContain('插值');
    expect(text).not.toContain('循环');
  });

  it('音段可以是负数，范围也可以是负区间', () => {
    const r = compileWorld(`${STRING}谱 双极地形
  段 -1 -0.5 0 0.5 1
  范围 -1..1
`);

    expect(r.ok).toBe(true);
    expect(r.ir.spectra[0]).toMatchObject({
      bands: [-1, -0.5, 0, 0.5, 1],
      min: -1,
      max: 1,
    });
  });

  it('空「段」是错误（NRO2100）', () => {
    const r = compileWorld(`${STRING}谱 空地形
  段
`);

    expect(r.ok).toBe(false);
    expect(
      r.diagnostics.errors.some((d) => d.code === 'NRO2100' && d.message.includes('至少需要一个音段值')),
    ).toBe(true);
  });

  it('音段值超出范围是错误，不会静默截断', () => {
    const r = compileWorld(`${STRING}谱 越界地形
  段 0.1 1.4
`);

    expect(r.ok).toBe(false);
    expect(
      r.diagnostics.errors.some(
        (d) => d.code === 'NRO2100' && d.message.includes('1.4') && d.message.includes('范围 0..1'),
      ),
    ).toBe(true);
    // IR 保留原值供预览，而不是截断到 1。
    expect(r.ir.spectra[0]?.bands).toEqual([0.1, 1.4]);
  });

  it('范围的上界必须严格大于下界', () => {
    for (const range of ['1..0', '1..1']) {
      const r = compileWorld(`${STRING}谱 坏范围
  段 0.5
  范围 ${range}
`);
      expect(r.ok).toBe(false);
      expect(
        r.diagnostics.errors.some((d) => d.code === 'NRO2100' && d.message.includes('上界必须大于下界')),
      ).toBe(true);
    }
  });

  it('同名的谱重复声明是 NRO2004', () => {
    const r = compileWorld(`${STRING}谱 重复地形
  段 0.5
谱 重复地形
  段 0.6
`);

    expect(r.ok).toBe(false);
    expect(
      r.diagnostics.errors.some((d) => d.code === 'NRO2004' && d.message.includes('重复声明')),
    ).toBe(true);
    expect(r.ir.spectra).toHaveLength(1);
    expect(r.ir.spectra[0]?.bands).toEqual([0.5]);
  });

  it('谱与弦/实体共享顶层命名空间（与声明顺序无关）', () => {
    const withString = compileWorld(`谱 撞名
  段 0.5
叙事弦 撞名
  类型 数值 0..1
  基线 0.5
`);
    expect(withString.ok).toBe(false);
    expect(
      withString.diagnostics.errors.some((d) => d.code === 'NRO2004' && d.message.includes('与同名弦冲突')),
    ).toBe(true);

    const withEntity = compileWorld(`${STRING}实体 撞名实体
  是 节点
谱 撞名实体
  段 0.5
`);
    expect(withEntity.ok).toBe(false);
    expect(
      withEntity.diagnostics.errors.some((d) => d.code === 'NRO2004' && d.message.includes('与同名实体冲突')),
    ).toBe(true);
  });

  it('未知字段、未知插值方式、未知循环值是语法诊断', () => {
    const unknownField = compileWorld(`${STRING}谱 杂项
  段 0.5
  颜色 红
`);
    expect(unknownField.ok).toBe(false);
    expect(
      unknownField.diagnostics.errors.some(
        (d) => d.code === 'NRO1100' && d.message.includes('不认识「颜色」'),
      ),
    ).toBe(true);

    const unknownInterpolation = compileWorld(`${STRING}谱 杂项
  段 0.5
  插值 三次
`);
    expect(unknownInterpolation.ok).toBe(false);
    expect(
      unknownInterpolation.diagnostics.errors.some(
        (d) => d.code === 'NRO1100' && d.message.includes('不认识的插值方式'),
      ),
    ).toBe(true);

    const unknownLoop = compileWorld(`${STRING}谱 杂项
  段 0.5
  循环 大概
`);
    expect(unknownLoop.ok).toBe(false);
    expect(
      unknownLoop.diagnostics.errors.some(
        (d) => d.code === 'NRO1100' && d.message.includes('只能写「是」或「否」'),
      ),
    ).toBe(true);
  });

  it('「段」重复或缺失都是错误', () => {
    const repeated = compileWorld(`${STRING}谱 重复段
  段 0.5
  段 0.6
`);
    expect(repeated.ok).toBe(false);
    expect(
      repeated.diagnostics.errors.some((d) => d.code === 'NRO1100' && d.message.includes('只能声明一次')),
    ).toBe(true);

    const missing = compileWorld(`${STRING}谱 缺段
  范围 0..1
`);
    expect(missing.ok).toBe(false);
    expect(
      missing.diagnostics.errors.some(
        (d) => d.code === 'NRO2100' && d.message.includes('至少需要一个音段值'),
      ),
    ).toBe(true);
  });

  it('音段数超过 256 是错误', () => {
    const bands = Array.from({ length: 257 }, () => '0.5').join(' ');
    const r = compileWorld(`${STRING}谱 超长地形
  段 ${bands}
`);

    expect(r.ok).toBe(false);
    expect(
      r.diagnostics.errors.some(
        (d) => d.code === 'NRO2100' && d.message.includes('超过') && d.message.includes('256'),
      ),
    ).toBe(true);
  });

  it('没有谱时 IR 仍是空数组（additive 字段）', () => {
    const r = compileWorld(STRING);
    expect(r.ok).toBe(true);
    expect(r.ir.spectra).toEqual([]);
    expect(r.ir.stats.spectra).toBe(0);
    expect(serialize(r.ir)).not.toContain('谱 ');
  });

  it('序列化往返保持同一张谱，且序列化幂等', () => {
    const r = compileWorld(`${STRING}谱 地形
  段 -0.5 0 0.5
  范围 -1..1
  插值 平滑
  循环 是
`);
    expect(r.ok).toBe(true);

    const text = serialize(r.ir);
    expect(text.indexOf('谱 地形')).toBeGreaterThan(text.indexOf('叙事弦 情绪'));
    expect(text).toContain('  段 -0.5 0 0.5');
    expect(text).toContain('  范围 -1..1');
    expect(text).toContain('  插值 平滑');
    expect(text).toContain('  循环 是');

    const again = compileText(text, 'roundtrip.nro');
    expect(again.ok).toBe(true);
    expect(again.ir.stats.spectra).toBe(1);
    expect(spectrumShape(again.ir)).toEqual(spectrumShape(r.ir));

    expect(serialize(again.ir)).toBe(text);
    expect(serialize(r.ir)).toBe(text);
  });

  it('注释与多余空白不影响解析', () => {
    const src = `# 顶部注释
世界 注释测试

叙事弦 情绪
  # 弦内的注释
  类型 数值 0..1
  基线 0.5

谱 带注释的地形
  段 0.1    0.4\t0.8  # 行尾注释
  范围 0 .. 1
  插值 平滑

  # 循环前的注释
  循环 是
`;
    const r = compileText(src, 'comments.nro');
    expect(r.ok).toBe(true);
    expect(r.ir.spectra[0]).toMatchObject({
      bands: [0.1, 0.4, 0.8],
      min: 0,
      max: 1,
      interpolation: '平滑',
      loop: true,
    });
  });
});
