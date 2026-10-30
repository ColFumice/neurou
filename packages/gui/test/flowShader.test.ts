import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { buildGlslArtifact } from '../src/glslBackend.js';

describe('流场视觉（v1.4）', () => {
  it('世界可声明「纹理 流场」', () => {
    const source = `世界 流场测试\n\n视觉弦 速度\n  类型 数值 0..100\n  基线 50\n\n视觉端口 等值线\n  参数 强度 速度\n  纹理 流场 6\n`;
    const result = compileText(source, 'flow.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.ports[0]?.texture?.pattern).toBe('流场');
  });

  it('流场片元包含 FBM 等值线与调色逻辑', () => {
    const artifact = buildGlslArtifact({
      id: 'port', name: '等值线', kind: '视觉',
      params: { 强度: '速度' },
      strings: {},
      texture: { pattern: '流场', scale: 6 },
    } as unknown as Parameters<typeof buildGlslArtifact>[0]);
    expect(artifact.texturePattern).toBe('流场');
    expect(artifact.fragmentSource).toContain('fbm');
    expect(artifact.fragmentSource).toContain('outColor');
    expect(artifact.fragmentSource).toContain('uTime');
  });
});
