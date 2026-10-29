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
});
