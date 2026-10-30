import { describe, expect, it } from 'vitest';
import type { IRString } from '@neurou/core';
import { SUSTAINED_WAVE_BANDS, sustainedWaves } from '../src/sustainedWave.js';

const stringOf = (kind: IRString['kind'], waveform?: number[]): IRString => ({
  id: kind,
  name: kind,
  kind,
  domain: { type: 'number', min: 0, max: 100 },
  baseline: 0,
  response: '线性',
  ...(waveform ? { waveform } : {}),
});

describe('持续弦合奏集合（v5.44）', () => {
  it('只平均当前世界存在的持续弦', () => {
    sustainedWaves.loadFromIR([stringOf('物理')]);
    expect(sustainedWaves.activeCount()).toBe(1);
    expect(sustainedWaves.ensemble()).toHaveLength(SUSTAINED_WAVE_BANDS);
    expect(sustainedWaves.ensemble()).toEqual(sustainedWaves.get('物理'));
  });

  it('世界里没有持续弦时合奏为空', () => {
    sustainedWaves.loadFromIR([stringOf('叙事'), stringOf('控制')]);
    expect(sustainedWaves.activeCount()).toBe(0);
    expect(sustainedWaves.ensemble().every((value) => value === 0)).toBe(true);
  });
});
