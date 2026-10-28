import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 曲线循环覆盖

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 网
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.5 0.7
  曲线 甲 乙 循环 否 0 1
  循环 是
  周期 10
`;

describe('单条曲线循环覆盖（v2.14）', () => {
  it('解析/IR/序列化保留曲线级循环', () => {
    const r = compileText(WORLD, 'curve-loop.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.matrices[0]?.curves[0]?.loop).toBe(false);
    const text = serialize(r.ir);
    expect(text).toContain('曲线 甲 乙 循环 否 0 1');
    expect(compileText(text, 'curve-loop-roundtrip.nro').ok).toBe(true);
  });
});
