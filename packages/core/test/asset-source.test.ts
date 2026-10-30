import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileText, patchWorldText, setAssetSource } from '../src/index.js';

const SOURCE = readFileSync('examples/vertical-slice.nro', 'utf8');

describe('资源 src 写回（v6.4）', () => {
  it('音频/纹理资产路径走行级 patch 并可重编译', () => {
    const compiled = compileText(SOURCE, 'vertical-slice.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const audio = compiled.ir.audioAssets?.[0];
    const texture = compiled.ir.textureAssets?.[0];
    if (!audio || !texture) throw new Error('assets missing');
    const withAudio = setAssetSource(compiled.ir, 'audio', audio.id, 'audio/clock.wav');
    if (!withAudio.ok) throw new Error(withAudio.error);
    const withTexture = setAssetSource(withAudio.ir, 'texture', texture.id, 'textures/rain.svg');
    if (!withTexture.ok) throw new Error(withTexture.error);
    const patch = patchWorldText(SOURCE, compiled.ir, withTexture.ir);
    if (!patch.ok) throw new Error(patch.reason);
    expect(patch.text).toContain('音频资产 雨声 "audio/clock.wav"');
    const next = compileText(patch.text, 'vertical-slice-patched.nro');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ir.audioAssets?.[0]?.src).toBe('audio/clock.wav');
  });
});
