/**
 * 单弦调律台的声音：Web Audio，不含 React、不产生任何界面。
 *
 * - 只有一条弦：每个触点是一次拨弦（Karplus-Strong），音高随触点在弦上的位置；
 * - 8 类弦 = 8 种音色：基准八度、亮度、衰减、音量不同；
 * - 首次用户手势才创建 AudioContext；没有手势绝不发声，被浏览器拒绝时优雅降级；
 * - AnalyserNode 挂在 master 之后，`rms()` 给自动验收一个真实的非静音信号。
 */
import type { StringKind } from '@neurou/core';
import { WAVE_WIDTH, ksPluckBuffer, pitchForX, spectrumFourier } from './waveMath.js';
import type { TimbreCurve } from './stringMath.js';

export type StringAudioState = 'off' | 'running' | 'suspended' | 'unavailable';

interface KindAudioProfile {
  /** 相对五声音阶基准（110–880Hz）的八度倍数。 */
  octave: number;
  /** 0 = 闷，1 = 亮。 */
  brightness: number;
  /** 拨弦缓冲长度（秒）。 */
  seconds: number;
  /** 单次拨弦音量。 */
  gain: number;
}

const KIND_AUDIO: Record<StringKind, KindAudioProfile> = {
  叙事: { octave: 1, brightness: 0.45, seconds: 2.4, gain: 0.3 },
  视觉: { octave: 2, brightness: 0.85, seconds: 1.5, gain: 0.24 },
  动画: { octave: 1.5, brightness: 0.65, seconds: 1.1, gain: 0.22 },
  物理: { octave: 0.5, brightness: 0.35, seconds: 3.0, gain: 0.34 },
  控制: { octave: 1, brightness: 0.7, seconds: 0.7, gain: 0.2 },
  空间: { octave: 0.5, brightness: 0.3, seconds: 3.2, gain: 0.3 },
  认知: { octave: 2, brightness: 0.9, seconds: 0.6, gain: 0.18 },
  关系: { octave: 1, brightness: 0.55, seconds: 2.0, gain: 0.28 },
};

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof AudioContext === 'undefined') return null;
  const win = window as unknown as { webkitAudioContext?: AudioContextCtor };
  return win.webkitAudioContext ?? AudioContext;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class StringAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Float32Array | null = null;
  private status: StringAudioState = 'off';
  private failed = false;
  private listeners = new Set<(state: StringAudioState) => void>();
  private bufferCache = new Map<string, AudioBuffer>();
  private sources = new Set<AudioBufferSourceNode>();
  private voices = new Map<number, { osc: OscillatorNode; gain: GainNode; pan: StereoPannerNode | null }>();
  private voiceSeq = 0;

  getState(): StringAudioState {
    return this.status;
  }

  subscribe(listener: (state: StringAudioState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.status);
  }

  /** master 之后的真实 RMS（0..1）；没有音频时返回 0。 */
  rms(): number {
    const analyser = this.analyser;
    const data = this.analyserData;
    if (!analyser || !data || !this.ctx) return 0;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const value = data[i]!;
      sum += value * value;
    }
    return Math.min(1, Math.sqrt(sum / data.length));
  }

  /** 必须在用户手势里调用；幂等，StrictMode 双挂载不会建两个 context。 */
  async ensureStarted(): Promise<void> {
    if (this.failed) return;
    const existing = this.ctx;
    if (existing) {
      if (existing.state !== 'running') {
        try {
          await existing.resume();
        } catch {
          /* 保持 suspended */
        }
      }
      this.status = existing.state === 'running' ? 'running' : 'suspended';
      this.emit();
      return;
    }

    const Ctor = audioContextCtor();
    if (!Ctor) {
      this.failed = true;
      this.status = 'unavailable';
      this.emit();
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      this.failed = true;
      this.status = 'unavailable';
      this.emit();
      return;
    }
    this.ctx = ctx;
    ctx.onstatechange = () => {
      this.status = this.ctx?.state === 'running' ? 'running' : 'suspended';
      this.emit();
    };

    const master = ctx.createGain();
    master.gain.value = 0.5;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(ctx.destination);
    this.master = master;
    this.analyser = analyser;
    this.analyserData = new Float32Array(analyser.fftSize);

    try {
      await ctx.resume();
    } catch {
      /* 保持 suspended：视觉照常 */
    }
    this.status = ctx.state === 'running' ? 'running' : 'suspended';
    this.emit();
  }

  /**
   * 拨一下：xNorm、yNorm ∈ 0..1（触点在屏幕上的归一化位置）；
   * amplitudeNorm 0..1 只影响音量与轻微亮度；
   * pitchScale 用来表现 D-膜跨度（弦越短，音越高）。
   */
  pluck(kind: StringKind, xNorm: number, yNorm: number, amplitudeNorm = 0.7, pitchScale = 1, timbre?: TimbreCurve): void {
    if (this.failed) return;
    if (!this.ctx) {
      // 手势可能已经把 context 创建起来了；没有就尝一次，失败则不响。
      void this.ensureStarted().then(() => this.play(kind, xNorm, yNorm, amplitudeNorm, pitchScale, timbre));
      return;
    }
    this.play(kind, xNorm, yNorm, amplitudeNorm, pitchScale, timbre);
  }

  /** v2.0：谱模式里按下一个键，用当前谱作为音色试听。 */
  previewSpectrum(
    bands: readonly number[],
    xNorm: number,
    yNorm: number,
    smooth: boolean,
    loop: boolean,
    amplitudeNorm = 0.62,
  ): void {
    if (bands.length < 2) return;
    this.pluck('叙事', xNorm, yNorm, amplitudeNorm, 1, {
      bands: [...bands],
      min: 0,
      max: 1,
      smooth,
      loop,
    });
  }

  private play(
    kind: StringKind,
    xNorm: number,
    yNorm: number,
    amplitudeNorm: number,
    pitchScale: number,
    timbre?: TimbreCurve,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const profile = KIND_AUDIO[kind] ?? KIND_AUDIO['叙事'];
    const x = clamp(xNorm, 0, 1);
    const scale = clamp(pitchScale, 0.5, 2);
    const base = pitchForX(x * WAVE_WIDTH).freq * profile.octave * scale;
    const freq = clamp(base, 30, ctx.sampleRate / 2 - 1);
    const degree = Math.round(x * 15);
    const pitchBucket = Math.round(scale * 20);
    const amp = clamp(amplitudeNorm, 0, 1);
    const timbreKey = timbre
      ? `:t${timbre.bands.map((v) => Math.round(v * 1000)).join('.')}${timbre.smooth ? 's' : 'l'}${timbre.loop ? 'o' : ''}`
      : '';
    const cacheKey = `${kind}:${degree}:${pitchBucket}${timbreKey}`;

    let buffer = this.bufferCache.get(cacheKey);
    if (!buffer) {
      const samples = ksPluckBuffer({
        freq,
        seconds: profile.seconds,
        sampleRate: ctx.sampleRate,
        brightness: clamp(profile.brightness + (Math.abs(yNorm - 0.5) - 0.25) * 0.2, 0, 1),
        seed: degree + 1,
        ...(timbre ? { timbre } : {}),
      });
      const created = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      created.copyToChannel(samples, 0);
      this.bufferCache.set(cacheKey, created);
      if (this.bufferCache.size > 64) {
        const oldest = this.bufferCache.keys().next().value;
        if (oldest !== undefined) this.bufferCache.delete(oldest);
      }
      buffer = created;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = clamp(profile.gain * (0.5 + amp * 0.8), 0.02, 0.44);
    const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = (x * 2 - 1) * 0.55;
      source.connect(gain);
      gain.connect(pan);
      pan.connect(master);
    } else {
      source.connect(gain);
      gain.connect(master);
    }
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      try {
        gain.disconnect();
        pan?.disconnect();
      } catch {
        /* ignore */
      }
    };
    source.start();
  }

  /** 停掉正在响的拨弦（Escape / 切总览时用）。 */
  reset(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    for (const id of [...this.voices.keys()]) this.stopSustainedSpectrum(id);
  }

  /** v2.0.1：持续音色（拉奏/吹奏）——按住键时循环发声。返回 voice id。 */
  startSustainedSpectrum(
    bands: readonly number[],
    xNorm: number,
    yNorm: number,
    smooth: boolean,
    loop: boolean,
    amplitudeNorm = 0.6,
  ): number {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || bands.length < 2) return 0;
    const profile = KIND_AUDIO['叙事'];
    const x = clamp(xNorm, 0, 1);
    const base = pitchForX(x * WAVE_WIDTH).freq * profile.octave;
    const freq = clamp(base, 30, ctx.sampleRate / 2 - 1);
    const fourier = spectrumFourier(bands, { min: 0, max: 1, smooth, loop });
    const wave = ctx.createPeriodicWave(fourier.real, fourier.imag);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const target = clamp(profile.gain * (0.4 + amplitudeNorm * 0.5), 0.02, 0.3);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(target, ctx.currentTime + 0.035);
    const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = (x * 2 - 1) * 0.4;
      osc.connect(gain);
      gain.connect(pan);
      pan.connect(master);
    } else {
      osc.connect(gain);
      gain.connect(master);
    }
    osc.start();
    const id = ++this.voiceSeq;
    this.voices.set(id, { osc, gain, pan });
    return id;
  }

  /** 实时更新持续音的波形（拖段点/键盘改段值后音色跟随）。 */
  updateSustainedSpectrum(id: number, bands: readonly number[], smooth: boolean, loop: boolean): void {
    const voice = this.voices.get(id);
    const ctx = this.ctx;
    if (!voice || !ctx || bands.length < 2) return;
    const fourier = spectrumFourier(bands, { min: 0, max: 1, smooth, loop });
    try {
      voice.osc.setPeriodicWave(ctx.createPeriodicWave(fourier.real, fourier.imag));
    } catch {
      /* ignore */
    }
  }

  stopSustainedSpectrum(id: number): void {
    const ctx = this.ctx;
    const voice = this.voices.get(id);
    if (!voice) return;
    this.voices.delete(id);
    const end = (ctx?.currentTime ?? 0) + 0.12;
    try {
      voice.gain.gain.cancelScheduledValues(ctx?.currentTime ?? 0);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), ctx?.currentTime ?? 0);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, end);
      voice.osc.stop(end + 0.02);
    } catch {
      try {
        voice.osc.stop();
      } catch {
        /* ignore */
      }
    }
    voice.osc.onended = () => {      try {
        voice.gain.disconnect();
        voice.pan?.disconnect();
      } catch {
        /* ignore */
      }
    };
  }
}

let instance: StringAudioEngine | null = null;

/** 单例：HMR / StrictMode 下共享同一个 AudioContext。 */
export function getStringAudio(): StringAudioEngine {
  if (!instance) instance = new StringAudioEngine();
  return instance;
}
