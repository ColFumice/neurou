import type { IRSpectrum } from '@neurou/core';

/** v2.1b：把一条谱当作目标曲线，衡量模拟轨迹与它的贴合度。 */
export interface ReferenceSpec {
  spectrumId: string;
  stringId: string;
}

export interface ReferenceScore {
  spectrumId: string;
  stringId: string;
  /** 0..1，模拟值与参考值的平均绝对误差。 */
  mae: number;
  /** 0..1，均方根误差。 */
  rmse: number;
  /** 0..100，贴合度分数（越高越贴合）。 */
  score: number;
  samples: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 按谱的插值/循环把 0..1 位置映射成 0..1 归一化值。 */
export function sampleReference(spectrum: IRSpectrum, position: number): number {
  const bands = spectrum.bands;
  if (bands.length === 0) return 0;
  if (bands.length === 1) return clamp01((bands[0]! - spectrum.min) / (spectrum.max - spectrum.min || 1));
  let p = Number.isFinite(position) ? position : 0;
  p = spectrum.loop ? p - Math.floor(p) : clamp01(p);
  const at = p * (bands.length - 1);
  const i0 = Math.floor(at);
  const i1 = Math.min(bands.length - 1, i0 + 1);
  let t = at - i0;
  if (spectrum.interpolation === '平滑') t = (1 - Math.cos(Math.PI * t)) / 2;
  const span = spectrum.max - spectrum.min || 1;
  const a = clamp01((bands[i0]! - spectrum.min) / span);
  const b = clamp01((bands[i1]! - spectrum.min) / span);
  return a * (1 - t) + b * t;
}

/** 把一段归一化轨迹（0..1）与参考谱按时间位置比较。 */
export function scoreReference(series: readonly number[], spectrum: IRSpectrum): ReferenceScore {
  const n = Math.max(1, series.length);
  let sumAbs = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const target = sampleReference(spectrum, n === 1 ? 0.5 : i / (n - 1));
    const diff = (series[i] ?? 0) - target;
    sumAbs += Math.abs(diff);
    sumSq += diff * diff;
  }
  const mae = sumAbs / n;
  const rmse = Math.sqrt(sumSq / n);
  return {
    spectrumId: spectrum.id,
    stringId: '',
    mae,
    rmse,
    score: Math.max(0, Math.min(100, Math.round((1 - rmse) * 100))),
    samples: n,
  };
}
