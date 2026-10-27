import { describe, expect, it } from 'vitest';
import { compileText, serialize, type LExpr } from '../src/index.js';

/**
 * v2.1a：表达式/规则在运行时读谱 —— 内建函数 `查谱("谱名", 位置)`。
 *
 * 编译期只做三件事：第一个参数必须是谱名字符串字面量、谱必须存在、
 * 位置必须是数字；采样本身留给运行时（曲线是可变状态）。
 */

const WORLD = `世界 查谱测试
叙事弦 情绪
  类型 数值 0..1
  基线 0.5

谱 情绪地形
  段 0 1
  范围 0..1
  插值 平滑
  循环 是
`;

function compiled(body: string) {
  return compileText(WORLD + body, 'spectrum-query.nro');
}

function call(name: string, position: LExpr): LExpr {
  return { k: 'call', fn: '查谱', args: [{ k: 'const', v: name }, position] };
}

describe('查谱：编译期下降与校验', () => {
  it('在结局里降低为 number 类型的 call，参数是谱名常量与位置表达式', () => {
    const r = compiled(`结局 高: 当 查谱("情绪地形", 0.25) > 0.6
`);
    expect(r.ok).toBe(true);

    expect(r.ir.endings[0]!.guard).toEqual({
      k: 'bin',
      op: '>',
      l: call('情绪地形', { k: 'const', v: 0.25 }),
      r: { k: 'const', v: 0.6 },
    });
  });

  it('规则守卫与效果里都能用；位置可以是任意数值表达式', () => {
    const r = compiled(`力迫 推
  当 查谱("情绪地形", 情绪) >= 0.5
  效果
    情绪 += 查谱("情绪地形", 0.75)
`);
    expect(r.ok).toBe(true);

    const rule = r.ir.rules.find((x) => x.kind === 'forcing')!;
    expect(rule.guard).toEqual({
      k: 'bin',
      op: '>=',
      l: call('情绪地形', { k: 'read', id: '情绪' }),
      r: { k: 'const', v: 0.5 },
    });
    expect(rule.effects[0]).toMatchObject({
      k: 'add',
      id: '情绪',
      value: call('情绪地形', { k: 'const', v: 0.75 }),
    });
  });

  it('参数个数不是 2 时报 NRO2003', () => {
    for (const expr of ['查谱()', '查谱("情绪地形")', '查谱("情绪地形", 0.5, 1)']) {
      const r = compiled(`结局 高: 当 ${expr} > 0.5
`);
      expect(r.ok).toBe(false);
      expect(
        r.diagnostics.errors.some((d) => d.code === 'NRO2003' && d.message.includes('需要两个参数')),
      ).toBe(true);
    }
  });

  it('第一个参数必须是直接写出的谱名字符串', () => {
    for (const expr of ['查谱(0.5, 0.5)', '查谱(情绪, 0.5)']) {
      const r = compiled(`结局 高: 当 ${expr} > 0.5
`);
      expect(r.ok).toBe(false);
      expect(
        r.diagnostics.errors.some(
          (d) => d.code === 'NRO2003' && d.message.includes('第一个参数必须是直接写出的谱名字符串'),
        ),
      ).toBe(true);
    }
  });

  it('位置参数必须是数字', () => {
    const r = compiled(`结局 高: 当 查谱("情绪地形", "0.5") > 0.5
`);
    expect(r.ok).toBe(false);
    expect(
      r.diagnostics.errors.some(
        (d) => d.code === 'NRO2003' && d.message.includes('位置参数必须是数字'),
      ),
    ).toBe(true);
  });

  it('引用不存在的谱报 NRO2101，并给出近似名字建议', () => {
    const r = compiled(`结局 高: 当 查谱("情绪地型", 0.5) > 0.5
`);
    expect(r.ok).toBe(false);
    const error = r.diagnostics.errors.find((d) => d.code === 'NRO2101');
    expect(error).toBeTruthy();
    expect(error!.message).toContain('情绪地型');
    expect(error!.message).toContain('不存在的谱');
    expect(error!.hint).toContain('情绪地形');
  });

  it('未知函数建议里包含「查谱」', () => {
    const r = compiled(`结局 高: 当 查普("情绪地形", 0.5) > 0.5
`);
    expect(r.ok).toBe(false);
    const error = r.diagnostics.errors.find((d) => d.code === 'NRO2007');
    expect(error).toBeTruthy();
    expect(error!.hint).toContain('查谱');
  });

  it('表达式读取追踪会递归 call 参数：位置读取的数值弦不算死弦', () => {
    const r = compiled(`结局 平衡: 当 查谱("情绪地形", 情绪) >= 0.5
`);
    expect(r.ok).toBe(true);
    expect(
      r.diagnostics.all().some((d) => d.code === 'NRO3102' && d.message.includes('情绪')),
    ).toBe(false);
  });

  it('IR 序列化往返保留查谱调用，且序列化幂等', () => {
    const r = compiled(`结局 高: 当 查谱("情绪地形", 0.25) > 0.6
`);
    expect(r.ok).toBe(true);

    const text = serialize(r.ir);
    expect(text).toContain('查谱("情绪地形", 0.25)');

    const again = compileText(text, 'spectrum-query-roundtrip.nro');
    expect(again.ok).toBe(true);
    expect(again.ir.endings[0]!.guard).toEqual(r.ir.endings[0]!.guard);
    expect(serialize(again.ir)).toBe(text);
    expect(serialize(r.ir)).toBe(text);
  });
});
