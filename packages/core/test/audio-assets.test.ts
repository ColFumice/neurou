import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 音频资产测试
  版本 0.1

音频资产 钟声采样 "audio/clock.wav"

叙事弦 钟声
  类型 数值 0..100
  基线 20
  悬崖 5
  安全 90

信号 响
  当 钟声 > 30
  音频 钟声采样 0.8

动作 敲
  当 钟声 < 90
  效果
    钟声 += 40
`;

const BGM_WORLD = WORLD.replace('音频资产 钟声采样 "audio/clock.wav"', '音频资产 钟声采样 "audio/clock.wav"\n配乐 钟声采样 音量 0.25 循环 是');

describe('音频资产（v3.7）', () => {
  it('解析/IR/序列化并保留路径', () => {
    const result = compileText(WORLD, 'audio-asset.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.audioAssets).toEqual([
      { id: '钟声采样', name: '钟声采样', src: 'audio/clock.wav' },
    ]);
    const text = serialize(result.ir);
    expect(text).toContain('音频资产 钟声采样 "audio/clock.wav"');
    expect(compileText(text, 'audio-asset-roundtrip.nro').ok).toBe(true);
  });

  it('拒绝目录穿越/非 audio 路径', () => {
    const bad = WORLD.replace('audio/clock.wav', '../outside.wav');
    const result = compileText(bad, 'audio-asset-bad.nro');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.errors.some((e) => e.code === 'NRO2108')).toBe(true);
  });

  it('拒绝重复资产名', () => {
    const bad = WORLD.replace('信号 响', '音频资产 钟声采样 "audio/rain.wav"\n\n信号 响');
    const result = compileText(bad, 'audio-asset-dup.nro');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.errors.some((e) => e.code === 'NRO2004')).toBe(true);
  });
});

describe('世界配乐（v3.8）', () => {
  it('解析/IR/序列化配乐', () => {
    const result = compileText(BGM_WORLD, 'bgm.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.bgm).toEqual({ asset: '钟声采样', volume: 0.25, loop: true });
    const text = serialize(result.ir);
    expect(text).toContain('配乐 钟声采样 音量 0.25 循环 是');
    expect(compileText(text, 'bgm-roundtrip.nro').ok).toBe(true);
  });

  it('拒绝不存在的配乐资产', () => {
    const bad = BGM_WORLD.replace('配乐 钟声采样', '配乐 不存在');
    const result = compileText(bad, 'bgm-missing.nro');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.errors.some((e) => e.code === 'NRO2101')).toBe(true);
  });

  it('拒绝越界音量', () => {
    const bad = BGM_WORLD.replace('音量 0.25', '音量 2');
    const result = compileText(bad, 'bgm-volume.nro');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.errors.some((e) => e.code === 'NRO2100')).toBe(true);
  });
});