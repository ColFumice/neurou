import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';
import { Universe } from '@neurou/runtime';

const WORLD = `世界 函数测试
  版本 0.1

函数 夹紧
  参数 x, lo, hi
  返回 最大(lo, 最小(x, hi))

叙事弦 值
  类型 数值 0..100
  基线 0

力迫 调
  当 值 < 70
  效果
    值 = 夹紧(值 + 50, 0, 100)
  可重复

结局 停: 当 值 >= 70
`;

describe('用户纯函数（v5.17）', () => {
  it('函数在编译期内联并参与运行时', () => {
    const result = compileText(WORLD, 'function.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.functions?.[0]).toMatchObject({
      name: '夹紧',
      params: ['x', 'lo', 'hi'],
    });
    expect(serialize(result.ir)).toContain('函数 夹紧');
    const universe = new Universe(result.ir, { seed: 1 });
    universe.tick();
    expect(universe.number('值')).toBe(50);
    universe.tick();
    expect(universe.number('值')).toBe(100);
    expect(universe.ended).toBe(true);
  });

  it('函数可以调用其他用户函数', () => {
    const source = WORLD.replace(
      '函数 夹紧\n  参数 x, lo, hi\n  返回 最大(lo, 最小(x, hi))',
      '函数 双倍\n  参数 x\n  返回 x * 2\n\n函数 夹紧\n  参数 x, lo, hi\n  返回 最大(lo, 最小(双倍(x), hi))',
    );
    const result = compileText(source, 'function-nested.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const universe = new Universe(result.ir, { seed: 1 });
    universe.tick();
    expect(universe.number('值')).toBe(100); // 双倍(50)=100，夹紧到 hi=100
    expect(universe.ended).toBe(true);
  });

  it('拒绝参数数量错误与递归', () => {
    const wrongArity = WORLD.replace('夹紧(值 + 50, 0, 100)', '夹紧(值 + 50, 0)');
    expect(compileText(wrongArity, 'function-arity.nro').ok).toBe(false);
    const recursive = WORLD.replace(
      '函数 夹紧\n  参数 x, lo, hi\n  返回 最大(lo, 最小(x, hi))',
      '函数 夹紧\n  参数 x, lo, hi\n  返回 夹紧(x, lo, hi)',
    );
    expect(compileText(recursive, 'function-recursive.nro').ok).toBe(false);
  });

  it('序列化后调用已内联，行为不变', () => {
    const result = compileText(WORLD, 'function-serialize.nro');
    if (!result.ok) throw new Error('compile failed');
    const text = serialize(result.ir);
    expect(text).toContain('参数 x, lo, hi');
    expect(text).toContain('返回 最大(lo, 最小(x, hi))');
    const roundtrip = compileText(text, 'function-serialize-roundtrip.nro');
    expect(roundtrip.ok).toBe(true);
    if (!roundtrip.ok) return;
    const universe = new Universe(roundtrip.ir, { seed: 1 });
    universe.tick();
    expect(universe.number('值')).toBe(50);
  });
});
