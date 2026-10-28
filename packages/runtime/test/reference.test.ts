import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { sampleReference, scoreReference, simulate } from '../src/index.js';

const WORLD = `世界 参考谱测试
谱 目标
  段 0 1 0.2
  范围 0..1
叙事弦 情绪
  类型 数值 0..100
  基线 50
`;

const compiled = compileText(WORLD, 'reference.nro');
if (!compiled.ok) throw new Error('参考谱测试世界编译失败');
const IR = compiled.ir;
const SPECTRUM = IR.spectra[0]!;

describe('参考谱：采样与偏差', () => {
  it('按位置采样：线性中点/端点/循环', () => {
    expect(sampleReference(SPECTRUM, 0)).toBeCloseTo(0);
    expect(sampleReference(SPECTRUM, 0.25)).toBeCloseTo(0.5);
    expect(sampleReference(SPECTRUM, 0.5)).toBeCloseTo(1);
    expect(sampleReference(SPECTRUM, 1)).toBeCloseTo(0.2);
    const looped = { ...SPECTRUM, loop: true };
    expect(sampleReference(looped, 1.25)).toBeCloseTo(0.5);
  });

  it('完美轨迹得 100，偏离轨迹更低', () => {
    const target = [0, 1, 0.2];
    const perfect = scoreReference(target, SPECTRUM);
    expect(perfect.score).toBe(100);
    expect(perfect.mae).toBeCloseTo(0);
    const off = scoreReference([1, 1, 1], SPECTRUM);
    expect(off.score).toBeLessThan(perfect.score);
    expect(off.rmse).toBeGreaterThan(0);
    expect(off.spectrumId).toBe('目标');
  });
});

describe('参考谱：批量模拟集成', () => {
  it('simulate 带 reference 输出贴合度', () => {
    const result = simulate(IR, { runs: 6, maxTicks: 8, models: ['random'], seed: 3, reference: { spectrumId: '目标', stringId: '情绪' } });
    expect(result.reference).toBeDefined();
    expect(result.reference?.spectrumId).toBe('目标');
    expect(result.reference?.runs).toBeGreaterThan(0);
    expect(result.reference?.meanScore).toBeGreaterThanOrEqual(0);
    expect(result.reference?.meanScore).toBeLessThanOrEqual(100);
    expect(result.runs.every((run) => run.reference)).toBe(true);
    const dimension = result.health.dimensions.find((d) => d.key === 'reference');
    expect(dimension?.label).toBe('参考谱贴合');
    expect(dimension?.ratio).toBeCloseTo((result.reference?.meanScore ?? 0) / 100, 2);
    const withoutRef = simulate(IR, { runs: 2, maxTicks: 4, models: ['random'] });
    expect(withoutRef.health.dimensions.some((d) => d.key === 'reference')).toBe(false);
  });

  it('谱或弦不存在时报错', () => {
    expect(() => simulate(IR, { runs: 1, maxTicks: 2, models: ['random'], reference: { spectrumId: '不存在', stringId: '情绪' } })).toThrow();
    expect(() => simulate(IR, { runs: 1, maxTicks: 2, models: ['random'], reference: { spectrumId: '目标', stringId: '不存在' } })).toThrow();
  });
});
