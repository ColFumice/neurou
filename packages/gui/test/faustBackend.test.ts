import { describe, expect, it } from 'vitest';
import { buildFaustArtifact } from '../src/faustBackend.js';

describe('Faust 源码适配（v5.8）', () => {
  it('音频端口参数生成 hslider + 合法 process', () => {
    const artifact = buildFaustArtifact({
      id: 'port:音频:潮声',
      name: '潮声',
      kind: '音频',
      params: { 强度: 40, 音高: 120 },
    });
    expect(artifact.dspSource).toContain('declare name "neurou:潮声";');
    expect(artifact.dspSource).toContain('import("stdfaust.lib");');
    expect(artifact.dspSource).toContain('p0 = hslider("p0", 0.0, 0.0, 1.0, 0.001);');
    expect(artifact.dspSource).toContain('p1 = hslider("p1", 0.0, 0.0, 1.0, 0.001);');
    expect(artifact.dspSource).toContain('process = no.noise * (p0 * 0.08 + p1 * 0.08);');
    expect(artifact.dspSource).not.toContain('强度');
    expect(artifact.bindings).toEqual([
      { control: 'p0', param: '强度', string: '' },
      { control: 'p1', param: '音高', string: '' },
    ]);
  });
});
