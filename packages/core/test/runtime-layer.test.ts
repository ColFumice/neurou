import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 运行层测试
  版本 0.1

叙事弦 能量
  类型 数值 0..100
  基线 0

系统 潮汐
  阶段 传导
  当 能量 > 0
  效果
    能量 += 2

系统 呼吸
  阶段 收尾
  效果
    能量 += 1

场景 夜
  启用 系统 潮汐
  进入
    能量 += 5
  离开
    能量 -= 2

场景 昼
  启用 系统 呼吸
  进入
    能量 += 1
`;

describe('运行层：系统/场景 IR（v5.1）', () => {
  it('解析、编译并序列化系统与场景', () => {
    const result = compileText(WORLD, 'runtime-layer.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.systems?.map((system) => [system.name, system.phase])).toEqual([
      ['潮汐', '传导'],
      ['呼吸', '收尾'],
    ]);
    expect(result.ir.scenes?.map((scene) => [scene.name, scene.systems])).toEqual([
      ['夜', ['潮汐']],
      ['昼', ['呼吸']],
    ]);
    const text = serialize(result.ir);
    expect(text).toContain('系统 潮汐');
    expect(text).toContain('场景 夜');
    expect(text).toContain('启用 系统 潮汐');
    expect(compileText(text, 'runtime-layer-roundtrip.nro').ok).toBe(true);
  });

  it('拒绝不存在的系统与非法阶段', () => {
    const badScene = WORLD.replace('启用 系统 潮汐', '启用 系统 不存在');
    const badStage = WORLD.replace('阶段 传导', '阶段 乱写');
    const sceneResult = compileText(badScene, 'runtime-layer-bad-scene.nro');
    const stageResult = compileText(badStage, 'runtime-layer-bad-stage.nro');
    expect(sceneResult.ok).toBe(false);
    expect(stageResult.ok).toBe(false);
  });

  it('支持初始场景与切换场景效果', () => {
    const source = `世界 切换场景测试
  版本 0.1
  初始场景 "夜"

叙事弦 标记
  类型 数值 0..10
  基线 0

系统 换景
  阶段 收尾
  效果
    切换场景 昼

场景 夜
  启用 系统 换景

场景 昼
`;
    const result = compileText(source, 'runtime-layer-scene-effect.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.meta['初始场景']).toBe('夜');
    expect(result.ir.systems?.[0]?.effects[0]).toEqual({ k: 'scene', scene: '昼' });
    const text = serialize(result.ir);
    expect(text).toContain('切换场景 昼');
    expect(compileText(text, 'runtime-layer-scene-effect-roundtrip.nro').ok).toBe(true);
  });

  it('拒绝不存在的切换场景目标', () => {
    const source = WORLD.replace(
      '    能量 += 2',
      '    能量 += 2\n    切换场景 不存在',
    );
    const result = compileText(source, 'runtime-layer-bad-scene-effect.nro');
    expect(result.ok).toBe(false);
  });

  it('解析视觉/音频端口并序列化', () => {
    const source = `${WORLD}\n视觉端口 雨幕\n  参数 强度 能量\n  参数 浓度 能量\n\n音频端口 潮声\n  参数 潮位 能量\n`;
    const result = compileText(source, 'runtime-layer-ports.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.ports?.map((port) => [port.kind, port.name])).toEqual([
      ['视觉', '雨幕'],
      ['音频', '潮声'],
    ]);
    expect(result.ir.ports?.[0]?.params.map((param) => [param.name, param.string])).toEqual([
      ['强度', '能量'],
      ['浓度', '能量'],
    ]);
    const text = serialize(result.ir);
    expect(text).toContain('视觉端口 雨幕');
    expect(text).toContain('音频端口 潮声');
    expect(compileText(text, 'runtime-layer-ports-roundtrip.nro').ok).toBe(true);
  });

  it('拒绝绑定不存在弦的端口', () => {
    const source = `${WORLD}\n视觉端口 雨幕\n  参数 强度 不存在\n`;
    const result = compileText(source, 'runtime-layer-bad-port.nro');
    expect(result.ok).toBe(false);
  });
});
