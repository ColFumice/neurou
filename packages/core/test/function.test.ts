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
    const forcing = result.ir.rules.find((rule) => rule.kind === 'forcing');
    expect(JSON.stringify(forcing?.effects)).toContain('用户:夹紧');
    expect(JSON.stringify(forcing?.effects)).not.toContain('"user"');
    expect(result.ir.functions?.[0]?.body?.k).toBe('call');
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
    expect(text).toContain('夹紧(值 + 50, 0, 100)');
    const roundtrip = compileText(text, 'function-serialize-roundtrip.nro');
    expect(roundtrip.ok).toBe(true);
    if (!roundtrip.ok) return;
    const universe = new Universe(roundtrip.ir, { seed: 1 });
    universe.tick();
    expect(universe.number('值')).toBe(50);
  });

  it('未被世界调用的函数给 warning', () => {
    const source = `${WORLD}\n函数 废弃\n  参数 x\n  返回 x + 1\n`;
    const result = compileText(source, 'function-unused.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warnings = result.diagnostics.all().filter((warning) => warning.severity === 'warning' && warning.code === 'NRO3307');
    expect(warnings.map((warning) => warning.message).join(' ')).toContain('废弃');
    expect(warnings.map((warning) => warning.message).join(' ')).not.toContain('夹紧');
  });

  it('参数/返回类型标注可检查并序列化', () => {
    const source = WORLD.replace(
      '函数 夹紧\n  参数 x, lo, hi\n  返回 最大(lo, 最小(x, hi))',
      '函数 夹紧\n  参数 x: 数值, lo: 数值, hi: 数值\n  返回类型 数值\n  返回 最大(lo, 最小(x, hi))',
    );
    const result = compileText(source, 'function-typed.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.functions?.[0]?.paramTypes).toEqual(['数值', '数值', '数值']);
    expect(result.ir.functions?.[0]?.returnType).toBe('数值');
    const text = serialize(result.ir);
    expect(text).toContain('参数 x: 数值, lo: 数值, hi: 数值');
    expect(text).toContain('返回类型 数值');
    expect(compileText(text, 'function-typed-roundtrip.nro').ok).toBe(true);
  });

  it('类型不匹配报错', () => {
    const typed = WORLD.replace(
      '函数 夹紧\n  参数 x, lo, hi\n  返回 最大(lo, 最小(x, hi))',
      '函数 夹紧\n  参数 x: 数值, lo: 数值, hi: 数值\n  返回类型 数值\n  返回 最大(lo, 最小(x, hi))',
    );
    const badArg = typed.replace('夹紧(值 + 50, 0, 100)', '夹紧(值 + 50, "x", 100)');
    expect(compileText(badArg, 'function-bad-arg.nro').ok).toBe(false);
    const badReturn = typed.replace('返回 最大(lo, 最小(x, hi))', '返回 "不是数字"');
    expect(compileText(badReturn, 'function-bad-return.nro').ok).toBe(false);
  });

  it('局部变量与条件表达式可序列化', () => {
    const source = WORLD.replace(
      '函数 夹紧\n  参数 x, lo, hi\n  返回 最大(lo, 最小(x, hi))',
      '函数 夹紧\n  参数 x: 数值, lo: 数值, hi: 数值\n  返回类型 数值\n  局部 下限 = lo\n  局部 上限 = hi\n  返回 如果 x < 下限 那么 下限 否则 如果 x > 上限 那么 上限 否则 x',
    );
    const result = compileText(source, 'function-block.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = serialize(result.ir);
    expect(text).toContain('局部 下限 = lo');
    expect(text).toContain('如果 x < 下限 那么 下限');
    expect(compileText(text, 'function-block-roundtrip.nro').ok).toBe(true);
    const universe = new Universe(result.ir, { seed: 1 });
    universe.tick();
    expect(universe.number('值')).toBe(50);
  });

  it('当分支短路返回并可序列化', () => {
    const source = `世界 分支函数
  版本 0.1

函数 分类
  参数 x: 数值
  返回类型 文本
  当 x < 5
    返回 "小"
  当 x == 5
    返回 "中"
  返回 "大"

叙事弦 输入
  类型 数值 0..10
  基线 3

叙事弦 结果
  类型 文本
  基线 "?"

力迫 判定
  当 输入 < 5
  效果
    结果 = 分类(输入)

结局 停: 当 假
`;
    const result = compileText(source, 'function-branches.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = serialize(result.ir);
    expect(text).toContain('当 x < 5');
    expect(text).toContain('返回 "小"');
    expect(compileText(text, 'function-branches-roundtrip.nro').ok).toBe(true);
    const universe = new Universe(result.ir, { seed: 1 });
    universe.tick();
    expect(universe.get('结果')).toBe('小');
  });

  it('分支局部变量与否则块可序列化', () => {
    const source = `世界 分支作用域
  版本 0.1

函数 分类
  参数 x: 数值
  返回类型 文本
  当 x < 5
    局部 词 = "小"
    返回 词
  否则
    局部 词 = "大"
    返回 词

叙事弦 输入
  类型 数值 0..10
  基线 3

叙事弦 结果
  类型 文本
  基线 "?"

力迫 判定
  当 输入 < 5
  效果
    结果 = 分类(输入)

结局 停: 当 假
`;
    const result = compileText(source, 'function-otherwise.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = serialize(result.ir);
    expect(text).toContain('否则');
    expect(text).toContain('局部 词 = "小"');
    expect(compileText(text, 'function-otherwise-roundtrip.nro').ok).toBe(true);
    const universe = new Universe(result.ir, { seed: 1 });
    universe.tick();
    expect(universe.get('结果')).toBe('小');
  });
});
