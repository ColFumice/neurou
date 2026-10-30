import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const SOURCE = `世界 后处理
  版本 0.1

纹理资产 雨纹 "textures/rain.svg"

叙事弦 色温
  类型 数值 0..100
  基线 50

视觉端口 窗光
  参数 强度 色温
  贴图 雨纹
  后处理 暗角 0.4 颗粒 0.2 色偏 0.15
`;

describe('视觉端口后处理链（v6.16）', () => {
  it('后处理参数进入 IR/序列化并 roundtrip', () => {
    const compiled = compileText(SOURCE, 'visual-post.nro');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.ir.ports?.[0]?.post).toEqual({ vignette: 0.4, grain: 0.2, tint: 0.15 });
    const text = serialize(compiled.ir);
    expect(text).toContain('后处理 暗角 0.4 颗粒 0.2 色偏 0.15');
    const roundtrip = compileText(text, 'visual-post-roundtrip.nro');
    expect(roundtrip.ok).toBe(true);
    if (!roundtrip.ok) return;
    expect(roundtrip.ir.ports?.[0]?.post?.tint).toBe(0.15);
  });

  it('音频端口不能声明后处理，值必须在 0..1', () => {
    const badKind = SOURCE.replace('视觉端口', '音频端口').replace('  贴图 雨纹\n', '');
    expect(compileText(badKind, 'visual-post-bad-kind.nro').ok).toBe(false);
    const badValue = SOURCE.replace('暗角 0.4', '暗角 1.4');
    expect(compileText(badValue, 'visual-post-bad-value.nro').ok).toBe(false);
  });
});
