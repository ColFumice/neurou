/**
 * v5.37：持续型弦的可编辑波形库。
 *
 * 每条持续型弦保存一条 32 段波形（0..1 采样值）；按键/鼠标在弦上写入波形。
 * 发音使用该波形；F2 谱模式试听使用所有持续型弦的合奏。
 */
import { STRING_INTERACTIONS, STRING_KINDS, type StringKind } from '@neurou/core';

export const SUSTAINED_WAVE_BANDS = 32;
export const SUSTAINED_KINDS = STRING_KINDS.filter((kind) => STRING_INTERACTIONS[kind] === '持续');

function defaultWave(kind: StringKind): number[] {
  const brightness: Record<string, number> = { 视觉: 0.85, 动画: 0.65, 物理: 0.35, 空间: 0.3 };
  const bright = brightness[kind] ?? 0.5;
  const bands: number[] = [];
  for (let i = 0; i < SUSTAINED_WAVE_BANDS; i += 1) {
    const x = i / (SUSTAINED_WAVE_BANDS - 1);
    const primary = Math.sin(x * Math.PI * 2);
    const harmonic = bright > 0.7 ? Math.sin(x * Math.PI * 4) * 0.35 : 0;
    bands.push(0.5 + (primary + harmonic) * 0.28);
  }
  return bands;
}

class SustainedWaveBank {
  private readonly waves = new Map<StringKind, number[]>();

  constructor() {
    for (const kind of SUSTAINED_KINDS) this.waves.set(kind, defaultWave(kind));
  }

  get(kind: StringKind): readonly number[] {
    return this.waves.get(kind) ?? defaultWave('视觉');
  }

  /** 在 x01 处写入一个平滑波峰；amp 0..1，sign=±1。 */
  editAt(kind: StringKind, x01: number, amp: number, sign: 1 | -1): readonly number[] {
    const bands = [...(this.waves.get(kind) ?? defaultWave(kind))];
    const center = Math.max(0, Math.min(bands.length - 1, x01 * (bands.length - 1)));
    const target = 0.5 + sign * Math.max(0, Math.min(1, amp)) * 0.42;
    for (let i = 0; i < bands.length; i += 1) {
      const distance = Math.abs(i - center);
      const weight = Math.exp(-((distance / 2.2) ** 2));
      if (weight < 0.02) continue;
      bands[i] = (bands[i] ?? 0.5) * (1 - weight * 0.55) + target * weight * 0.55;
    }
    this.waves.set(kind, bands);
    return bands;
  }

  ensemble(): number[] {
    const out = new Array<number>(SUSTAINED_WAVE_BANDS).fill(0);
    if (SUSTAINED_KINDS.length === 0) return out;
    for (const kind of SUSTAINED_KINDS) {
      const wave = this.get(kind);
      for (let i = 0; i < SUSTAINED_WAVE_BANDS; i += 1) out[i] = (out[i] ?? 0) + (wave[i] ?? 0.5) / SUSTAINED_KINDS.length;
    }
    return out;
  }
}

export const sustainedWaves = new SustainedWaveBank();
