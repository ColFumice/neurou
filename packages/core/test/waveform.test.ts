import { describe, expect, it } from 'vitest';
import { compileText, patchWorldText, serialize, setStringWaveform } from '../src/index.js';

const WORLD = `世界 波形
  版本 0.1

视觉弦 色温
  类型 数值 0..100
  基线 64
  波形 0.5 0.6 0.7 0.6 0.5
`;

describe('持续弦波形 IR/DSL（v5.43）', () => {
  it('波形进入 IR 并序列化 roundtrip', () => {
    const result = compileText(WORLD, 'waveform.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.strings[0]?.waveform).toEqual([0.5, 0.6, 0.7, 0.6, 0.5]);
    const text = serialize(result.ir);
    expect(text).toContain('波形 0.5 0.6 0.7 0.6 0.5');
    const roundtrip = compileText(text, 'waveform-roundtrip.nro');
    expect(roundtrip.ok).toBe(true);
    if (!roundtrip.ok) return;
    expect(roundtrip.ir.strings[0]?.waveform).toEqual([0.5, 0.6, 0.7, 0.6, 0.5]);
  });

  it('非持续弦/非法采样被拒绝，setStringWaveform 可写回', () => {
    const badKind = WORLD.replace('视觉弦', '叙事弦');
    expect(compileText(badKind, 'waveform-bad-kind.nro').ok).toBe(false);
    const badValue = WORLD.replace('0.5 0.6 0.7 0.6 0.5', '0.5 1.4');
    expect(compileText(badValue, 'waveform-bad-value.nro').ok).toBe(false);

    const result = compileText(WORLD, 'waveform-edit.nro');
    if (!result.ok) throw new Error('compile failed');
    const edited = setStringWaveform(result.ir, '色温', [0.2, 0.4, 0.6]);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.ir.strings[0]?.waveform).toEqual([0.2, 0.4, 0.6]);
    expect(serialize(edited.ir)).toContain('波形 0.2 0.4 0.6');
  });

  it('波形写回走行级 patch并保留注释', () => {
    const source = `世界 波形注释
  版本 0.1

# 保留这条注释
视觉弦 色温
  类型 数值 0..100
  基线 64
  波形 0.5 0.6 0.7 0.6 0.5
`;
    const result = compileText(source, 'waveform-patch.nro');
    if (!result.ok) throw new Error('compile failed');
    const edited = setStringWaveform(result.ir, '色温', [0.2, 0.4, 0.6]);
    if (!edited.ok) throw new Error(edited.error);
    const patch = patchWorldText(source, result.ir, edited.ir);
    expect(patch.ok).toBe(true);
    if (!patch.ok) return;
    expect(patch.text).toContain('波形 0.2 0.4 0.6');
    expect(patch.text).toContain('# 保留这条注释');
    expect(compileText(patch.text, 'waveform-patch-roundtrip.nro').ok).toBe(true);
  });
});
