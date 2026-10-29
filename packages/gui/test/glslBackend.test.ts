import { describe, expect, it } from 'vitest';
import { buildGlslArtifact } from '../src/glslBackend.js';

describe('GLSL 后端（v5.7）', () => {
  it('把端口参数映射为 u0/u1 uniform，输出灰度片元', () => {
    const artifact = buildGlslArtifact({
      id: 'port:视觉:雨幕',
      name: '雨幕',
      kind: '视觉',
      params: { 强度: 40, 色温: 20, 名字: 'x' },
      texture: { pattern: '条纹', scale: 6 },
    });
    expect(artifact.fragmentSource).toContain('uniform float u0;');
    expect(artifact.fragmentSource).toContain('uniform float u1;');
    expect(artifact.fragmentSource).toContain('out vec4 outColor;');
    expect(artifact.fragmentSource).not.toContain('强度');
    expect(artifact.bindings).toEqual([
      { uniform: 'u0', param: '强度', string: '' },
      { uniform: 'u1', param: '色温', string: '' },
      { uniform: 'u2', param: '名字', string: 'x' },
    ]);
    expect(artifact.fragmentSource).toContain('uniform float uTime;');
    expect(artifact.fragmentSource).toContain('uniform sampler2D uTexture;');
    expect(artifact.fragmentSource).toContain('texture(uTexture');
    expect(artifact.vertexSource).toContain('out vec2 vUv;');
    expect(artifact.texturePattern).toBe('条纹');
    expect(artifact.textureScale).toBe(6);
  });
});
