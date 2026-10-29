import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { createEngine, type SceneFrame } from '../src/index.js';

const WORLD = `世界 门面测试
  版本 0.1

叙事弦 能量
  类型 数值 0..100
  基线 0

系统 潮汐
  阶段 传导
  效果
    能量 += 2

场景 夜
  启用 系统 潮汐
  进入
    能量 += 5

场景 昼
  启用 系统 潮汐
  进入
    能量 += 1
`;

describe('Engine facade（v5.2）', () => {
  it('通过 facade 驱动、观测与订阅', () => {
    const result = compileText(WORLD, 'engine-facade.nro');
    if (!result.ok) throw new Error('compile failed');
    const engine = createEngine(result.ir, { seed: 1 });
    const frames: SceneFrame[] = [];
    const unsubscribe = engine.subscribe((frame) => frames.push(frame));

    expect(engine.sceneName).toBe('夜');
    expect(engine.get('能量')).toBe(5);
    engine.step();
    expect(engine.get('能量')).toBe(7);
    expect(engine.observe().activeSystems).toEqual(['潮汐']);
    expect(engine.observe().scene).toBe('夜');
    expect(frames).toHaveLength(1);
    unsubscribe();
    engine.step();
    expect(frames).toHaveLength(1);
  });

  it('通过 facade 切换场景并恢复快照', () => {
    const result = compileText(WORLD, 'engine-facade-scene.nro');
    if (!result.ok) throw new Error('compile failed');
    const engine = createEngine(result.ir, { seed: 1 });
    const snapshot = engine.snapshot();
    expect(engine.transitionScene('昼')).toBe(true);
    expect(engine.sceneName).toBe('昼');
    expect(engine.get('能量')).toBe(6); // 5 + 1
    engine.restore(snapshot);
    expect(engine.sceneName).toBe('夜');
    expect(engine.get('能量')).toBe(5);
  });

  it('replaceWorld 保留 tick/值并补新弦基线', () => {
    const result = compileText(WORLD, 'engine-facade-hot.nro');
    if (!result.ok) throw new Error('compile failed');
    const engine = createEngine(result.ir, { seed: 1 });
    engine.step();
    expect(engine.tick).toBe(1);
    expect(engine.get('能量')).toBe(7);

    const updated = WORLD.replace('  基线 0', '  基线 10').replace(
      '系统 潮汐',
      '叙事弦 新弦\n  类型 数值 0..10\n  基线 7\n\n系统 潮汐',
    );
    const next = compileText(updated, 'engine-facade-hot-v2.nro');
    if (!next.ok) throw new Error('compile v2 failed');
    engine.replaceWorld(next.ir);
    expect(engine.tick).toBe(1);
    expect(engine.get('能量')).toBe(7);
    expect(engine.get('新弦')).toBe(7);
    expect(engine.sceneName).toBe('夜');
  });

  it('observe 投影视觉/音频端口值', () => {
    const source = `${WORLD}\n视觉端口 雨幕\n  参数 强度 能量\n\n音频端口 潮声\n  参数 潮位 能量\n`;
    const result = compileText(source, 'engine-facade-ports.nro');
    if (!result.ok) throw new Error('compile failed');
    const engine = createEngine(result.ir, { seed: 1 });
    const frame = engine.observe();
    expect(frame.ports['port:视觉:雨幕']?.params['强度']).toBe(5);
    expect(frame.ports['port:音频:潮声']?.params['潮位']).toBe(5);
  });
});
