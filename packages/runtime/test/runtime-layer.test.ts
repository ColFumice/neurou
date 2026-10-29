import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { Universe } from '../src/index.js';

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

describe('运行层：场景/系统运行时（v5.1）', () => {
  it('初始场景进入效果、系统按阶段生效', () => {
    const result = compileText(WORLD, 'runtime-layer-runtime.nro');
    if (!result.ok) throw new Error('compile failed');
    const universe = new Universe(result.ir, { seed: 1 });
    expect(universe.sceneName).toBe('夜');
    expect(universe.number('能量')).toBe(5);
    expect(universe.activeSystems()).toEqual(['潮汐']);
    universe.tick();
    // 潮汐在传导阶段 +2
    expect(universe.number('能量')).toBe(7);
  });

  it('切换场景执行离开/进入效果并更换启用系统', () => {
    const result = compileText(WORLD, 'runtime-layer-transition.nro');
    if (!result.ok) throw new Error('compile failed');
    const universe = new Universe(result.ir, { seed: 1 });
    expect(universe.transitionScene('昼')).toBe(true);
    expect(universe.sceneName).toBe('昼');
    expect(universe.number('能量')).toBe(4); // 5 - 2 + 1
    expect(universe.activeSystems()).toEqual(['呼吸']);
    universe.tick();
    expect(universe.number('能量')).toBe(5); // 收尾 +1
  });

  it('快照恢复保留场景', () => {
    const result = compileText(WORLD, 'runtime-layer-snapshot.nro');
    if (!result.ok) throw new Error('compile failed');
    const universe = new Universe(result.ir, { seed: 1 });
    universe.transitionScene('昼');
    const restored = new Universe(result.ir, { seed: 1 });
    restored.restore(universe.snapshot());
    expect(restored.sceneName).toBe('昼');
  });

  it('系统效果在本拍收尾切换场景', () => {
    const source = `世界 切换场景运行时
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
    const result = compileText(source, 'runtime-layer-scene-switch.nro');
    if (!result.ok) throw new Error('compile failed');
    const universe = new Universe(result.ir, { seed: 1 });
    expect(universe.sceneName).toBe('夜');
    universe.tick();
    expect(universe.sceneName).toBe('昼');
    expect(universe.activeSystems()).toEqual([]);
  });
});
