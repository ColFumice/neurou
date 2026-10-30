import { describe, expect, it } from 'vitest';
import type { IRString } from '@neurou/core';
import { SUSTAINED_WAVE_BANDS, sustainedWaves } from '../src/sustainedWave.js';

const stringOf = (id: string, kind: IRString['kind'], waveform?: number[]): IRString => ({
  id,
  name: id,
  kind,
  domain: { type: 'number', min: 0, max: 100 },
  baseline: 0,
  response: '线性',
  ...(waveform ? { waveform } : {}),
});

const wave = (value: number): number[] => new Array(SUSTAINED_WAVE_BANDS).fill(value);

describe('持续弦独立波形与合奏（v5.45）', () => {
  it('同类多根弦各自保存波形', () => {
    sustainedWaves.loadFromIR([
      stringOf('视觉甲', '视觉', wave(0.2)),
      stringOf('视觉乙', '视觉', wave(0.8)),
    ]);
    expect(sustainedWaves.activeCount()).toBe(2);
    expect([...sustainedWaves.getFor('视觉甲', '视觉')]).toEqual(wave(0.2));
    expect([...sustainedWaves.getFor('视觉乙', '视觉')]).toEqual(wave(0.8));
    expect(sustainedWaves.ensemble()[0]).toBeCloseTo(0.5, 5);
  });

  it('合奏只平均当前世界真实持续弦', () => {
    sustainedWaves.loadFromIR([stringOf('物理甲', '物理', wave(0.4))]);
    expect(sustainedWaves.activeCount()).toBe(1);
    expect(sustainedWaves.ensemble()).toEqual(wave(0.4));
  });

  it('世界里没有持续弦时合奏为空', () => {
    sustainedWaves.loadFromIR([stringOf('叙事甲', '叙事'), stringOf('控制甲', '控制')]);
    expect(sustainedWaves.activeCount()).toBe(0);
    expect(sustainedWaves.ensemble().every((value) => value === 0)).toBe(true);
  });
});
