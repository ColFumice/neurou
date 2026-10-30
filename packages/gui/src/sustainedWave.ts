/**
 * 持续型弦的可编辑波形库。
 *
 * v5.45：每根持续型弦独立一条 32 段波形（按弦 id 保存），
 * 不再按“弦类别”共享；F2 合奏平均当前世界所有持续弦。
 */
import { STRING_INTERACTIONS, STRING_KINDS, type IRString, type StringKind } from '@neurou/core';

export const SUSTAINED_WAVE_BANDS = 48;
export const SUSTAINED_KINDS = STRING_KINDS.filter((kind) => STRING_INTERACTIONS[kind] === '持续');

interface WaveEntry {
  kind: StringKind;
  waveform: number[];
}

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

function sanitize(bands: unknown): number[] | null {
  if (!Array.isArray(bands) || bands.length !== SUSTAINED_WAVE_BANDS) return null;
  if (!bands.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  return bands.map((value) => Math.max(0, Math.min(1, value)));
}

export type WavePreset = '正弦' | '三角' | '方波' | '柔波';

function presetWave(kind: StringKind, preset: WavePreset): number[] {
  const bands: number[] = [];
  for (let i = 0; i < SUSTAINED_WAVE_BANDS; i += 1) {
    const x = i / (SUSTAINED_WAVE_BANDS - 1);
    const phase = x * Math.PI * 2;
    const hard = preset === '方波';
    const raw =
      preset === '正弦'
        ? Math.sin(phase)
        : preset === '三角'
          ? 2 * Math.abs(2 * (x - Math.floor(x + 0.5))) - 1
          : hard
            ? Math.sign(Math.sin(phase)) || 1
            : Math.sin(phase) + Math.sin(phase * 2) * 0.35;
    const smooth = hard ? Math.tanh(raw * 3) : raw;
    const bright = kind === '视觉' || kind === '动画' ? 1 : 0.85;
    bands.push(0.5 + smooth * 0.3 * bright);
  }
  return bands;
}

class SustainedWaveBank {
  private readonly waves = new Map<string, WaveEntry>();
  private activeIds: string[] = [];
  private storageKey: string | null = null;

  configure(worldFile: string): void {
    if (typeof window === 'undefined') return;
    this.storageKey = `neurou:sustained-waves:${worldFile}`;
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        strings?: Record<string, { kind?: StringKind; waveform?: unknown }>;
      } & Partial<Record<StringKind, unknown>>;
      if (parsed.strings) {
        for (const [id, entry] of Object.entries(parsed.strings)) {
          const kind = entry.kind;
          if (!kind || !SUSTAINED_KINDS.includes(kind)) continue;
          const waveform = sanitize(entry.waveform);
          if (waveform) this.waves.set(id, { kind, waveform });
        }
        return;
      }
      // v5.42 旧格式：按类别保存。
      for (const kind of SUSTAINED_KINDS) {
        const waveform = sanitize(parsed[kind]);
        if (waveform) this.waves.set(`kind:${kind}`, { kind, waveform });
      }
    } catch {
      /* 隐私模式/坏数据：退回默认波形 */
    }
  }

  /** 从世界 IR 恢复：源文件波形优先，否则保留本地的同名弦缓存/默认波形。 */
  loadFromIR(strings: readonly IRString[]): void {
    const next = new Map<string, WaveEntry>();
    const ids: string[] = [];
    for (const string of strings) {
      if (STRING_INTERACTIONS[string.kind] !== '持续') continue;
      const existing = this.waves.get(string.id) ?? this.waves.get(`kind:${string.kind}`);
      const explicit = Array.isArray(string.waveform) ? sanitize(string.waveform) : null;
      next.set(string.id, {
        kind: string.kind,
        waveform: explicit ?? existing?.waveform ?? defaultWave(string.kind),
      });
      ids.push(string.id);
    }
    this.waves.clear();
    for (const [id, entry] of next) this.waves.set(id, entry);
    this.activeIds = ids;
    this.persist();
  }

  reset(): void {
    for (const [id, entry] of this.waves) {
      this.waves.set(id, { kind: entry.kind, waveform: defaultWave(entry.kind) });
    }
    this.persist();
  }

  private persistTimer: number | null = null;

  private persist(): void {
    if (typeof window === 'undefined' || !this.storageKey) return;
    if (this.persistTimer !== null) return;
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      this.writePersistence();
    }, 80);
  }

  /** 立即落盘（卸载/显式保存时使用）。 */
  flushPersistence(): void {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.writePersistence();
  }

  private writePersistence(): void {
    if (typeof window === 'undefined' || !this.storageKey) return;
    try {
      const strings = Object.fromEntries([...this.waves.entries()].map(([id, entry]) => [id, entry]));
      window.localStorage.setItem(this.storageKey, JSON.stringify({ strings }));
    } catch {
      /* 配额满/隐私模式：静默 */
    }
  }

  /** 取某根弦的波形；缺失时按类别建默认波形。 */
  getFor(id: string, kind: StringKind): readonly number[] {
    const existing = this.waves.get(id);
    if (existing) return existing.waveform;
    const waveform = defaultWave(kind);
    this.waves.set(id, { kind, waveform });
    return waveform;
  }

  /** 在 x01 处写入平滑波峰；amp 0..1，sign=±1。 */
  editAtString(id: string, kind: StringKind, x01: number, amp: number, sign: 1 | -1): readonly number[] {
    const entry = this.waves.get(id) ?? { kind, waveform: defaultWave(kind) };
    const bands = [...entry.waveform];
    const center = Math.max(0, Math.min(bands.length - 1, x01 * (bands.length - 1)));
    const target = 0.5 + sign * Math.max(0, Math.min(1, amp)) * 0.42;
    for (let i = 0; i < bands.length; i += 1) {
      const distance = Math.abs(i - center);
      const weight = Math.exp(-((distance / 2.2) ** 2));
      if (weight < 0.02) continue;
      bands[i] = (bands[i] ?? 0.5) * (1 - weight * 0.55) + target * weight * 0.55;
    }
    this.waves.set(id, { kind, waveform: bands });
    this.persist();
    return bands;
  }

  resetString(id: string, kind: StringKind): readonly number[] {
    const waveform = defaultWave(kind);
    this.waves.set(id, { kind, waveform });
    this.persist();
    return waveform;
  }

  applyPreset(id: string, kind: StringKind, preset: WavePreset): readonly number[] {
    const waveform = presetWave(kind, preset);
    this.waves.set(id, { kind, waveform });
    this.persist();
    return waveform;
  }

  /** 编辑器直接写入一根弦的完整波形。 */
  setWaveformString(id: string, kind: StringKind, values: readonly number[]): readonly number[] {
    const waveform = (sanitize([...values]) ?? defaultWave(kind));
    this.waves.set(id, { kind, waveform });
    this.persist();
    return waveform;
  }

  /** F2 合奏：当前世界所有持续型弦逐点平均。 */
  ensemble(): number[] {
    const out = new Array<number>(SUSTAINED_WAVE_BANDS).fill(0);
    const ids = this.activeIds.filter((id) => this.waves.has(id));
    if (ids.length === 0) return out;
    for (const id of ids) {
      const wave = this.waves.get(id)?.waveform;
      if (!wave) continue;
      for (let i = 0; i < SUSTAINED_WAVE_BANDS; i += 1) {
        out[i] = (out[i] ?? 0) + (wave[i] ?? 0.5) / ids.length;
      }
    }
    return out;
  }

  activeCount(): number {
    return this.activeIds.length;
  }
}

export const sustainedWaves = new SustainedWaveBank();
