import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 纹理端口
  版本 0.1

叙事弦 雨量
  类型 数值 0..100
  基线 30

视觉端口 雨幕
  参数 强度 雨量
  纹理 条纹 6
`;

describe('视觉端口程序化纹理（v5.29）', () => {
  it('纹理图案进入 IR 并序列化', () => {
    const result = compileText(WORLD, 'texture-port.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.ports?.[0]?.texture).toEqual({ pattern: '条纹', scale: 6 });
    const text = serialize(result.ir);
    expect(text).toContain('纹理 条纹 6');
    expect(compileText(text, 'texture-port-roundtrip.nro').ok).toBe(true);
  });

  it('音频端口不能声明纹理', () => {
    const source = WORLD.replace('视觉端口 雨幕', '音频端口 雨幕');
    expect(compileText(source, 'texture-audio-port.nro').ok).toBe(false);
  });

  it('纹理资产进入 IR、端口与序列化', () => {
    const source = `世界 纹理资产端口
  版本 0.1

纹理资产 雨纹 "textures/rain.svg"

叙事弦 雨量
  类型 数值 0..100
  基线 30

视觉端口 雨幕
  参数 强度 雨量
  贴图 雨纹
`;
    const result = compileText(source, 'texture-asset.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.textureAssets?.[0]).toMatchObject({ name: '雨纹', src: 'textures/rain.svg' });
    expect(result.ir.ports?.[0]?.textureAsset).toEqual({ name: '雨纹', src: 'textures/rain.svg' });
    const text = serialize(result.ir);
    expect(text).toContain('纹理资产 雨纹 "textures/rain.svg"');
    expect(text).toContain('贴图 雨纹');
    expect(compileText(text, 'texture-asset-roundtrip.nro').ok).toBe(true);
  });

  it('缺失/非法纹理资产被拒绝', () => {
    const missing = WORLD.replace('  纹理 条纹 6', '  贴图 不存在');
    expect(compileText(missing, 'texture-asset-missing.nro').ok).toBe(false);
    const badPath = `世界 坏路径
  版本 0.1

纹理资产 雨纹 "../rain.png"

叙事弦 雨量
  类型 数值 0..100
  基线 30

视觉端口 雨幕
  参数 强度 雨量
`;
    expect(compileText(badPath, 'texture-asset-bad-path.nro').ok).toBe(false);
  });
});
