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
    mode: s.mode,
    articulation: s.articulation,
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
      mode: '固定',
    });
    expect(spectrum.span).toBeDefined();
  });

  it('省略范围 / 插值 / 循环 / 模式时取默认值，序列化也省略默认值', () => {
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
      mode: '固定',
    });
    const decl = r.program.decls.find((d) => d.k === 'spectrum');
    expect(decl?.mode).toBe('固定');

    const text = serialize(r.ir);
    expect(text).toContain('谱 默认地形');
    expect(text).toContain('  段 0 0.5 1');
    expect(text).not.toContain('范围');
    expect(text).not.toContain('插值');
    expect(text).not.toContain('循环');
    expect(text).not.toContain('模式');
  });

  it('显式写「模式 固定」与默认等价，序列化时省略', () => {
    const r = compileWorld(`${STRING}谱 显式固定
  段 0 0.5 1
  模式 固定
`);

    expect(r.ok).toBe(true);
    expect(r.ir.spectra[0]?.mode).toBe('固定');
    expect(serialize(r.ir)).not.toContain('模式');
  });

  it('「模式 受迫」可解析、编译并依次写回，往返与幂等', () => {
    const r = compileWorld(`${STRING}谱 受迫地形
  段 0.1 0.4 0.8 0.5
  范围 0..1
  插值 平滑
  循环 是
  模式 受迫
`);
    expect(r.ok).toBe(true);

    const decl = r.program.decls.find((d) => d.k === 'spectrum');
    expect(decl?.mode).toBe('受迫');
    expect(r.ir.spectra[0]).toMatchObject({
      bands: [0.1, 0.4, 0.8, 0.5],
      min: 0,
      max: 1,
      interpolation: '平滑',
      loop: true,
      mode: '受迫',
    });

    const text = serialize(r.ir);
    expect(text).toContain('  模式 受迫');
    // 模式写在谱块最后，符合规范顺序。
    expect(text.indexOf('  循环 是')).toBeLessThan(text.indexOf('  模式 受迫'));

    const again = compileText(text, 'roundtrip-mode.nro');
    expect(again.ok).toBe(true);
    expect(spectrumShape(again.ir)).toEqual(spectrumShape(r.ir));
    expect(again.ir.spectra[0]?.mode).toBe('受迫');
    expect(serialize(again.ir)).toBe(text);
    expect(serialize(r.ir)).toBe(text);
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

  it('未知模式、重复模式是语法诊断', () => {
    const unknownMode = compileWorld(`${STRING}谱 杂项
  段 0.5
  模式 随机
`);
    expect(unknownMode.ok).toBe(false);
    expect(
      unknownMode.diagnostics.errors.some(
        (d) => d.code === 'NRO1100' && d.message.includes('不认识的模式') && d.hint?.includes('固定、受迫'),
      ),
    ).toBe(true);

    const repeatedMode = compileWorld(`${STRING}谱 重复模式
  段 0.5
  模式 固定
  模式 受迫
`);
    expect(repeatedMode.ok).toBe(false);
    expect(
      repeatedMode.diagnostics.errors.some(
        (d) => d.code === 'NRO1100' && d.message.includes('「模式」只能声明一次'),
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

  it('「演奏 持续」可解析、默认拨弦、序列化保留非默认', () => {
    const sustained = compileWorld(`${STRING}谱 拉奏
  段 0 1 0.5
  演奏 持续
`);
    expect(sustained.ok).toBe(true);
    expect(sustained.ir.spectra[0]?.articulation).toBe('持续');
    const text = serialize(sustained.ir);
    expect(text).toContain('演奏 持续');
    const again = compileText(text, 'sustained.nro');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.ir.spectra[0]?.articulation).toBe('持续');
    const defaults = compileWorld(`${STRING}谱 弹奏
  段 0 1 0.5
`);
    expect(defaults.ok).toBe(true);
    expect(defaults.ir.spectra[0]?.articulation).toBe('拨弦');
    expect(serialize(defaults.ir)).not.toContain('演奏');
  });

  it('弦可以用「音色」引用一条谱，序列化后仍保留', () => {
    const src = `世界 音色测试
谱 情绪
  段 0.1 0.5 0.9
叙事弦 信任
  类型 数值 0..100
  基线 50
  音色 情绪
`;
    const r = compileText(src, 'timbre.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.strings[0]?.timbre).toBe('情绪');
    const text = serialize(r.ir);
    expect(text).toContain('音色 情绪');
    const again = compileText(text, 'timbre-roundtrip.nro');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.ir.strings[0]?.timbre).toBe('情绪');
  });

  it('音色引用不存在的谱会报 NRO2101', () => {
    const r = compileText(
      `世界 坏音色
叙事弦 信任
  类型 数值 0..100
  基线 50
  音色 不存在
`,
      'bad-timbre.nro',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.errors.some((e) => e.code === 'NRO2101')).toBe(true);
  });
});
