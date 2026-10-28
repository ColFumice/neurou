import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 当前值

叙事弦 潮位
  类型 数值 0..100
  基线 20

关系谱 潮汐
  行 岸边 深海
  列 岸边 深海
  段 0.2 0.7
  段 0.4 0.1
  曲线 岸边 深海 0.1 0.5 0.9
  周期 10
  速度 1.2
  相位 0.1

结局 时: 当 当前谱值("潮汐", "岸边", "深海") > 0.5
`;

describe('当前谱值：按矩阵时间轴采样（v2.13）', () => {
  it('解析/序列化并 round-trip', () => {
    const r = compileText(WORLD, 'current-value.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = serialize(r.ir);
    expect(text).toContain('当前谱值("潮汐", "岸边", "深海")');
    expect(compileText(text, 'current-value-roundtrip.nro').ok).toBe(true);
  });

  it('无周期或无曲线时报错', () => {
    const noPeriod = compileText(WORLD.replace('  周期 10\n', ''), 'current-value-no-period.nro');
    expect(noPeriod.ok).toBe(false);
    const noCurve = compileText(WORLD.replace('  曲线 岸边 深海 0.1 0.5 0.9\n', ''), 'current-value-no-curve.nro');
    expect(noCurve.ok).toBe(false);
  });
});
