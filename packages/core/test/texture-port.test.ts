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
});
