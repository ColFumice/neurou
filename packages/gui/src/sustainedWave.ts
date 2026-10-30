/**
 * v5.37：持续型弦的可编辑波形库。
 *
 * 每条持续型弦保存一条 32 段波形（0..1 采样值）；按键/鼠标在弦上写入波形。
 * 发音使用该波形；F2 谱模式试听使用所有持续型弦的合奏。
 */
import { STRING_INTERACTIONS, STRING_KINDS, type IRString, type StringKind } from '@neurou/core';

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
  private storageKey: string | null = null;

  constructor() {
    for (const kind of SUSTAINED_KINDS) this.waves.set(kind, defaultWave(kind));
  }

  /** v5.42：按世界文件持久化到 localStorage；同一世界刷新后继续使用。 */
  configure(worldFile: string): void {
    if (typeof window === 'undefined') return;
    this.storageKey = `neurou:sustained-waves:${worldFile}`;
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<StringKind, number[]>>;
      for (const kind of SUSTAINED_KINDS) {
        const bands = parsed[kind];
        if (!Array.isArray(bands) || bands.length !== SUSTAINED_WAVE_BANDS) continue;
        if (!bands.every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
        this.waves.set(kind, bands.map((value) => Math.max(0, Math.min(1, value))));
      }
    } catch {
      /* 隐私模式/坏数据：退回默认波形 */
    }
  }

  /** v5.43：从世界 IR 恢复持续弦波形（源文件优先于本地缓存）。 */
  loadFromIR(strings: readonly IRString[]): void {
    for (const kind of SUSTAINED_KINDS) {
      const found = strings.find(
        (string) => string.kind === kind && Array.isArray(string.waveform) && string.waveform.length >= 2,
      );
      if (!found?.waveform) continue;
      this.waves.set(kind, found.waveform.map((value) => Math.max(0, Math.min(1, value))));
    }
    this.persist();
  }

  reset(): void {
    for (const kind of SUSTAINED_KINDS) this.waves.set(kind, defaultWave(kind));
    this.persist();
  }

  private persist(): void {
    if (typeof window === 'undefined' || !this.storageKey) return;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(Object.fromEntries(this.waves)));
    } catch {
      /* 配额满/隐私模式：静默 */
    }
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
    this.persist();
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
