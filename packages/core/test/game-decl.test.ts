import { describe, expect, it } from 'vitest';
import { compileText } from '../src/compiler.js';
import { serialize } from '../src/serialize.js';

const SOURCE = `世界 游戏桥测试

叙事弦 信任
  类型 数值 0..100
  基线 50

结局 稳定: 当 信任 >= 40

动作 完成
  当 信任 > 20
  耗时 1
  效果
    信任 += 6

游戏 方块
  模块 俄罗斯方块
  结果弦 信任
  胜利分数 80
  胜利动作 完成
  胜利结局 稳定
  失败结局 稳定
  描述 "在调律台按 F6 进入"
`;

describe('游戏 DSL 声明', () => {
  it('解析/编译游戏声明并解析结果弦 id', () => {
    const result = compileText(SOURCE, 'game.nro');
    expect(result.ok, result.diagnostics.items.map((item) => item.message).join(' | ')).toBe(true);
    const game = result.ir.games?.[0];
    expect(game).toBeDefined();
    expect(game?.name).toBe('方块');
    expect(game?.module).toBe('俄罗斯方块');
    expect(game?.resultString).toBe('信任');
    expect(game?.resultStringId).toBe('信任');
    expect(game?.winScore).toBe(80);
    expect(game?.winAction).toBe('完成');
    expect(game?.winEnding).toBe('稳定');
    expect(game?.loseEnding).toBe('稳定');
    expect(game?.description).toContain('F6');
  });

  it('序列化往返保留游戏声明', () => {
    const first = compileText(SOURCE, 'game.nro');
    expect(first.ok).toBe(true);
    const text = serialize(first.ir);
    expect(text).toContain('游戏 方块');
    expect(text).toContain('结果弦 信任');
    expect(text).toContain('胜利动作 完成');
    expect(text).toContain('胜利结局 稳定');
    expect(text).toContain('失败结局 稳定');
    const second = compileText(text, 'roundtrip.nro');
    expect(second.ok).toBe(true);
    expect(second.ir.games?.map(({ span, ...rest }) => rest)).toEqual(
      first.ir.games?.map(({ span, ...rest }) => rest),
    );
  });

  it('不存在的结果弦/动作/结局给出诊断', () => {
    const result = compileText(
      `世界 坏游戏
叙事弦 信任
  类型 数值 0..100
游戏 方块
  结果弦 不存在
  胜利动作 没有
  胜利结局 没有结局
  失败结局 也没有
`,
      'bad.nro',
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.items.some((item) => item.message.includes('结果弦'))).toBe(true);
    expect(result.diagnostics.items.some((item) => item.message.includes('胜利动作'))).toBe(true);
    expect(result.diagnostics.items.some((item) => item.message.includes('胜利结局'))).toBe(true);
    expect(result.diagnostics.items.some((item) => item.message.includes('失败结局'))).toBe(true);
  });
});
