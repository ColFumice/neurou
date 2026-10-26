import { describe, expect, it } from 'vitest';
import { compileText } from '../src/index.js';

const codes = (src: string): string[] => compileText(src).diagnostics.all().map((d) => d.code);

const BASE = `世界 测试
`;

function world(body: string): string {
  return BASE + body;
}

describe('编译器：结构与语义检查', () => {
  it('最小的可编译世界', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
结局 完: 当 甲 <= 0
信号 告急
  当 甲 < 20
  台词 "…"
`),
      'min.nro',
    );
    expect(r.ok).toBe(true);
    expect(r.ir.strings).toHaveLength(1);
    expect(r.ir.strings[0]!.verge).toBe(20);
    expect(r.diagnostics.errors).toHaveLength(0);
  });

  it('未知名字会给出近似建议', () => {
    const r = compileText(
      world(`叙事弦 信任
  类型 数值 0..100
  基线 50
耦合 信认 → 信任
`),
    );
    const d = r.diagnostics.errors.find((x) => x.code === 'NRO2001');
    expect(d).toBeTruthy();
    expect(d!.hint).toContain('信任');
  });

  it('短名有歧义时报错并提示写全', () => {
    const r = compileText(
      world(`实体 甲
  叙事弦 信任
    类型 数值 0..100
    基线 50
实体 乙
  叙事弦 信任
    类型 数值 0..100
    基线 50
耦合 信任 → 甲.信任
`),
    );
    expect(r.diagnostics.errors.some((d) => d.code === 'NRO2002')).toBe(true);
  });

  it('类型不匹配：把集合赋给数值弦', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
动作 加
  效果
    甲 = { 一个, 两个 }
`),
    );
    expect(r.diagnostics.errors.some((d) => d.code === 'NRO2003')).toBe(true);
  });

  it('阈值落在取值范围之外', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
  悬崖 120
`),
    );
    expect(r.diagnostics.errors.some((d) => d.code === 'NRO2005')).toBe(true);
  });

  it('自我强化且无闸门的回路是错误', () => {
    const r = compileText(
      world(`叙事弦 甲
  基线 50
叙事弦 乙
  基线 50
回路 失控: 甲↓ → 乙↓ → 甲↓
`),
    );
    expect(r.diagnostics.errors.some((d) => d.code === 'NRO2102')).toBe(true);
  });

  it('带阈值的自我强化回路被接受', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
叙事弦 乙
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
回路 失控: 甲↓ → 乙↓ → 甲↓
结局 完: 当 甲 <= 0
信号 告急: 当 甲 < 20 台词 "…"
`),
    );
    expect(r.diagnostics.errors.some((d) => d.code === 'NRO2102')).toBe(false);
    expect(r.ir.loops[0]!.polarity).toBe(1);
  });

  it('自我校正回路的极性是 -1', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
叙事弦 乙
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
回路 回正: 甲↓ → 乙↑ → 甲↑
`),
    );
    expect(r.ir.loops[0]!.polarity).toBe(-1);
  });

  it('力迫会破坏公理时静态报错', () => {
    const r = compileText(
      world(`叙事弦 存活
  类型 布尔
  基线 真
公理 不可复生: 存活 == 真
力迫 死亡
  当 真
  效果
    存活 = 假
`),
    );
    expect(r.diagnostics.errors.some((d) => d.code === 'NRO2104')).toBe(true);
  });

  it('先于关系成环', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
力迫 一
  当 真
  先于 二
  效果
    甲 += 1
力迫 二
  当 真
  先于 一
  效果
    甲 += 1
`),
    );
    expect(r.diagnostics.errors.some((d) => d.code === 'NRO2103')).toBe(true);
  });

  it('和弦互相施加会报死循环', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
和弦 一
  效果
    施加 二
和弦 二
  效果
    施加 一
`),
    );
    expect(r.diagnostics.errors.some((d) => d.code === 'NRO2105')).toBe(true);
  });

  it('有阈值的弦没有信号 → 静默失败警告', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
`),
    );
    expect(r.diagnostics.all().some((d) => d.code === 'NRO3101')).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('引用类型可以指向实体名', () => {
    const r = compileText(
      world(`实体 管道
  是 区域
实体 猫
  认知弦 已知避难所
    类型 集合(区域)
    基线 { }
动作 记住
  效果
    猫.已知避难所 += 管道
`),
    );
    expect(r.ok).toBe(true);
    const effect = r.ir.rules[0]!.effects[0]!;
    expect(effect).toMatchObject({ k: 'add', id: '猫.已知避难所' });
  });

  it('坏的块不会让解析器卡死', () => {
    const r = compileText(`世界 测试
  叙事弦 甲
    类型
  力迫 坏
    当
`);
    expect(r.diagnostics.errors.length).toBeGreaterThan(0);
  });

  it('闭合回路的方向可以相反（负反馈）', () => {
    const r = compileText(
      world(`叙事弦 甲
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
叙事弦 乙
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
回路 回正: 甲↓ → 乙↑ → 甲↑
`),
    );
    expect(r.diagnostics.errors).toHaveLength(0);
  });
});
