import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';
import { Universe } from '@neurou/runtime';

const WORLD = `世界 数学内建
  版本 0.1

叙事弦 值
  类型 数值 0..100
  基线 0

力迫 计算
  当 值 == 0
  效果
    值 = 夹紧(插值(0, 10, 0.5) + 幂(2, 3) + 平方根(16) + 正弦(0) + 余弦(0) + 向下取整(3.9) + 向上取整(3.1) + 四舍五入(3.6), 0, 100)

结局 停: 当 值 >= 100
`;

describe('数学函数内建（v5.26）', () => {
  it('确定性数学内建参与运行时', () => {
    const result = compileText(WORLD, 'math-builtins.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const universe = new Universe(result.ir, { seed: 1 });
    universe.tick();
    // 5 + 8 + 4 + 0 + 1 + 3 + 4 + 4 = 29
    expect(universe.number('值')).toBe(29);
  });

  it('序列化后 roundtrip 行为不变', () => {
    const result = compileText(WORLD, 'math-builtins-serialize.nro');
    if (!result.ok) throw new Error('compile failed');
    const text = serialize(result.ir);
    expect(text).toContain('夹紧(');
    const roundtrip = compileText(text, 'math-builtins-roundtrip.nro');
    expect(roundtrip.ok).toBe(true);
    if (!roundtrip.ok) return;
    const universe = new Universe(roundtrip.ir, { seed: 1 });
    universe.tick();
    expect(universe.number('值')).toBe(29);
  });

  it('类型错误与参数数量错误被拒绝', () => {
    const badType = WORLD.replace('正弦(0)', '正弦("x")');
    expect(compileText(badType, 'math-bad-type.nro').ok).toBe(false);
    const badArity = WORLD.replace('幂(2, 3)', '幂(2)');
    expect(compileText(badArity, 'math-bad-arity.nro').ok).toBe(false);
  });
});
