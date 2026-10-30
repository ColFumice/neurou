import { describe, expect, it } from 'vitest';
import { compileText, patchWorldText, removeAsset, renameAsset } from '../src/index.js';

const WORLD = `世界 资产管理
  版本 0.1

音频资产 雨声 "audio/rain.wav"
音频资产 钟声 "audio/clock.wav"
纹理资产 雨纹 "textures/rain.svg"

叙事弦 甲
  类型 数值 0..100
  基线 20
`;

describe('资产重命名/删除（v6.8）', () => {
  it('未引用资产可重命名和删除并写回', () => {
    const compiled = compileText(WORLD, 'assets.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const audio = compiled.ir.audioAssets?.[0];
    const second = compiled.ir.audioAssets?.[1];
    const texture = compiled.ir.textureAssets?.[0];
    if (!audio || !second || !texture) throw new Error('assets missing');
    const renamed = renameAsset(compiled.ir, 'audio', audio.id, '新雨声');
    if (!renamed.ok) throw new Error(renamed.error);
    const renamedTexture = renameAsset(renamed.ir, 'texture', texture.id, '新雨纹');
    if (!renamedTexture.ok) throw new Error(renamedTexture.error);
    const removed = removeAsset(renamedTexture.ir, 'audio', second.id);
    if (!removed.ok) throw new Error(removed.error);
    const patch = patchWorldText(WORLD, compiled.ir, removed.ir);
    if (!patch.ok) throw new Error(patch.reason);
    expect(patch.text).toContain('音频资产 新雨声 "audio/rain.wav"');
    expect(patch.text).toContain('纹理资产 新雨纹 "textures/rain.svg"');
    expect(patch.text).not.toContain('音频资产 钟声');
    const next = compileText(patch.text, 'assets-patched.nro');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ir.audioAssets).toHaveLength(1);
    expect(next.ir.audioAssets?.[0]?.name).toBe('新雨声');
    expect(next.ir.textureAssets?.[0]?.name).toBe('新雨纹');
  });

  it('被引用资产拒绝重命名/删除', () => {
    const source = `世界 引用资产\n  版本 0.1\n\n音频资产 雨声 "audio/rain.wav"\n配乐 雨声 音量 0.2 循环 是\n\n叙事弦 甲\n  类型 数值 0..100\n  基线 20\n`;
    const compiled = compileText(source, 'asset-ref.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const audio = compiled.ir.audioAssets?.[0];
    if (!audio) throw new Error('asset missing');
    expect(renameAsset(compiled.ir, 'audio', audio.id, '新雨声').ok).toBe(false);
    expect(removeAsset(compiled.ir, 'audio', audio.id).ok).toBe(false);
  });
});
