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

export interface KindEffects {
  /** 0..1，混响发送量。 */
  reverb: number;
  /** 200..12000Hz 低通。 */
  cutoff: number;
}

interface KindBus {
  input: GainNode;
  filter: BiquadFilterNode;
  dry: GainNode;
  wet: GainNode;
  convolver: ConvolverNode;
}

/** v3.6：master 基础增益；有效增益 = 0.4 × volume（muted 时 0）。 */
const BASE_MASTER_GAIN = 0.4;

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

export const KIND_AUDIO: Record<StringKind, KindAudioProfile> = {
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

interface RetiredVoice {
  osc: OscillatorNode;
  gain: GainNode;
}

interface SustainedVoice {
  osc: OscillatorNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  baseGain: number;
  xNorm: number;
  yNorm: number;
  priority: number;
  lastWaveAt?: number;
  retires: RetiredVoice[];
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
  /** v3.7：音频资产按 src 缓存 AudioBuffer / 去重并发加载。 */
  private assetCache = new Map<string, AudioBuffer>();
  private assetLoads = new Map<string, Promise<AudioBuffer | null>>();
  /** v3.8：循环音频（context 未建时 pending，首次 ensureStarted 后自动开） */
  private loopSrc: string | null = null;
  private loopSource: AudioBufferSourceNode | null = null;
  private loopGain: GainNode | null = null;
  private loopVolume = 1;
  private loopRepeat = true;
  private loopPending: { src: string; volume: number; loop: boolean } | null = null;
  private loopToken = 0;
  private voices = new Map<number, SustainedVoice>();
  /** v6.4：持续音最多同时 12 个 voice，超出时偷最早的。 */
  private readonly maxSustainedVoices = 12;
  /** v5.34：持续型弦的按住发声。 */
  private sustainedStrings = new Map<
    number,
    { osc: OscillatorNode; gain: GainNode; pan: StereoPannerNode | null; kind: StringKind; x: number; y: number }
  >();
  private pendingSustainedStrings = new Map<number, { kind: StringKind; x: number; y: number; amplitude: number }>();
  private voiceSeq = 0;
  /** v3.6：用户音量 0..1 / 静音；context 未建时先存值，创建时应用。 */
  private volume = 1;
  private muted = false;
  /** v1.9：记忆模式的真实音频采样。 */
  private memoryRecorder: MediaRecorder | null = null;
  private memoryStream: MediaStreamAudioDestinationNode | null = null;
  private memoryChunks: Blob[] = [];
  private memoryTakes: AudioBuffer[] = [];
  private memorySources: AudioBufferSourceNode[] = [];
  /** v1.10：按弦类型分开的效果总线（F9 记忆模式）。 */
  private kindBuses = new Map<StringKind, KindBus>();
  private kindEffects = new Map<StringKind, KindEffects>();
  /** v1.15：记忆模式内按弦类型单独编辑的音色曲线。 */
  private kindTimbres = new Map<StringKind, TimbreCurve>();

  getKindTimbre(kind: StringKind): TimbreCurve | undefined {
    return this.kindTimbres.get(kind);
  }

  setKindTimbre(kind: StringKind, bands: readonly number[], smooth: boolean, loop: boolean): void {
    this.kindTimbres.set(kind, { bands: [...bands], min: 0, max: 1, smooth, loop });
    this.bufferCache.clear();
  }

  clearKindTimbre(kind: StringKind): void {
    this.kindTimbres.delete(kind);
    this.bufferCache.clear();
  }

  getState(): StringAudioState {
    return this.status;
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(value: number): void {
    const next = Number.isFinite(value) ? clamp(value, 0, 1) : this.volume;
    this.volume = next;
    this.applyMasterGain();
  }

  getMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = Boolean(muted);
    this.applyMasterGain();
  }

  /** 切换静音，返回切换后的状态。 */
  toggleMuted(): boolean {
    this.muted = !this.muted;
    this.applyMasterGain();
    return this.muted;
  }

  /** v1.9：从 master 并行录制真实界面音频，不经过合成音替代。 */
  async startMemoryRecording(): Promise<boolean> {
    await this.ensureStarted();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.failed) return false;
    if (typeof MediaRecorder === 'undefined') return false;
    if (this.memoryRecorder) return true;
    try {
      const dest = ctx.createMediaStreamDestination();
      master.connect(dest);
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = mime ? new MediaRecorder(dest.stream, { mimeType: mime }) : new MediaRecorder(dest.stream);
      this.memoryChunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.memoryChunks.push(event.data);
      };
      recorder.start(120);
      this.memoryRecorder = recorder;
      this.memoryStream = dest;
      return true;
    } catch {
      return false;
    }
  }

  memoryTakeCount(): number {
    return this.memoryTakes.length;
  }

  clearMemoryTakes(): void {
    this.memoryTakes = [];
    this.stopMemoryPlayback();
  }

  removeLastMemoryTake(): number {
    this.memoryTakes = this.memoryTakes.slice(0, -1);
    return this.memoryTakes.length;
  }

  getKindEffects(kind: StringKind): KindEffects {
    return this.kindEffects.get(kind) ?? { reverb: 0.16, cutoff: 9000 };
  }

  /** F9：调整当前弦类型的效果器总线。 */
  setKindEffects(kind: StringKind, patch: Partial<KindEffects>): KindEffects {
    const current = this.getKindEffects(kind);
    const next: KindEffects = {
      reverb: Math.max(0, Math.min(1, patch.reverb ?? current.reverb)),
      cutoff: Math.max(200, Math.min(12000, patch.cutoff ?? current.cutoff)),
    };
    this.kindEffects.set(kind, next);
    const bus = this.kindBuses.get(kind);
    if (bus) {
      const now = this.ctx?.currentTime ?? 0;
      bus.dry.gain.setTargetAtTime(1 - next.reverb * 0.55, now, 0.03);
      bus.wet.gain.setTargetAtTime(next.reverb * 0.7, now, 0.03);
      bus.filter.frequency.setTargetAtTime(next.cutoff, now, 0.03);
    }
    return next;
  }

  private outputFor(kind: StringKind): AudioNode {
    return this.kindBuses.get(kind)?.input ?? this.master ?? this.ctx!.destination;
  }

  private buildKindBuses(ctx: AudioContext, master: GainNode): void {
    const seconds = 1.8;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.2);
      }
    }
    for (const kind of Object.keys(KIND_AUDIO) as StringKind[]) {
      const input = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const convolver = ctx.createConvolver();
      convolver.buffer = impulse;
      input.connect(filter);
      filter.connect(dry);
      filter.connect(convolver);
      convolver.connect(wet);
      dry.connect(master);
      wet.connect(master);
      this.kindBuses.set(kind, { input, filter, dry, wet, convolver });
      this.setKindEffects(kind, this.kindEffects.get(kind) ?? { reverb: 0.16, cutoff: 9000 });
    }
  }

  /** 先前的采样循环直接接到 destination，不经过 master，避免被新录制再次采样。 */
  playMemoryTakes(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    this.stopMemoryPlayback();
    for (const buffer of this.memoryTakes) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(ctx.destination);
        source.start();
        this.memorySources.push(source);
      } catch {
        /* ignore */
      }
    }
    return this.memoryTakes.length;
  }

  stopMemoryPlayback(): void {
    for (const source of this.memorySources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.memorySources = [];
  }

  async stopMemoryRecording(): Promise<{ durationMs: number; takes: number } | null> {
    const recorder = this.memoryRecorder;
    const stream = this.memoryStream;
    if (!recorder) return null;
    this.memoryRecorder = null;
    this.memoryStream = null;
    try {
      if (recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });
      }
    } catch {
      /* ignore */
    }
    try {
      if (stream) this.master?.disconnect(stream);
    } catch {
      /* ignore */
    }
    const chunks = this.memoryChunks.slice();
    this.memoryChunks = [];
    if (chunks.length === 0) return null;
    try {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const data = await blob.arrayBuffer();
      const buffer = await this.ctx?.decodeAudioData(data.slice(0));
      if (!buffer || buffer.duration < 0.05) return null;
      this.memoryTakes = [...this.memoryTakes, buffer].slice(-8);
      return { durationMs: Math.round(buffer.duration * 1000), takes: this.memoryTakes.length };
    } catch {
      return null;
    }
  }

  /** 移植音频资产 / 外部 Host 也可用它确认采样循环数量。 */
  memoryTakeDurations(): number[] {
    return this.memoryTakes.map((buffer) => Math.round(buffer.duration * 1000));
  }

  private effectiveGain(): number {
    return this.muted ? 0 : BASE_MASTER_GAIN * this.volume;
  }

  /** setTargetAtTime 平滑到目标增益；context 未建时只存值。 */
  private applyMasterGain(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const target = this.effectiveGain();
    const now = ctx.currentTime;
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(target, now, 0.02);
    } catch {
      master.gain.value = target;
    }
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
      this.resumePendingLoop();
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
    master.gain.value = this.effectiveGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.16;
    // 软削波：给多振荡器叠加/快速换波再兜一层，削掉偶发尖峰。
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.15) / Math.tanh(1.15);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(compressor);
    compressor.connect(shaper);
    shaper.connect(analyser);
    analyser.connect(ctx.destination);
    this.master = master;
    this.analyser = analyser;
    this.analyserData = new Float32Array(analyser.fftSize);
    this.buildKindBuses(ctx, master);

    try {
      await ctx.resume();
    } catch {
      /* 保持 suspended：视觉照常 */
    }
    this.status = ctx.state === 'running' ? 'running' : 'suspended';
    this.emit();
    this.resumePendingLoop();
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

  /** v2.2.6：关系谱矩阵的极轻交互音（悬停/方向键切换）。 */
  matrixTick(style: 'hover' | 'nav', value: number): void {
    if (this.failed) return;
    const play = (): void => {
      const ctx = this.ctx;
      const master = this.master;
      if (!ctx || !master) return;
      const v = clamp(value, 0, 1);
      const nav = style === 'nav';
      const freq = nav ? 430 + v * 380 : 980 + v * 420;
      const osc = ctx.createOscillator();
      osc.type = nav ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const target = nav ? 0.045 : 0.012;
      const attack = nav ? 0.006 : 0.004;
      const decay = nav ? 0.1 : 0.05;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(target, ctx.currentTime + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + attack + decay);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + attack + decay + 0.02);
      osc.onended = () => {
        try {
          gain.disconnect();
        } catch {
          /* ignore */
        }
      };
    };
    if (!this.ctx) {
      void this.ensureStarted().then(play);
      return;
    }
    void this.ctx.resume().catch(() => undefined);
    play();
  }

  /** v3.5：世界「音频」cue 的短音。名字哈希定音高/seed；value 定音量/亮度；timbre 来自谱。 */
  playCue(name: string, value: number, timbre?: TimbreCurve, kind?: StringKind): void {
    if (this.failed) return;
    const run = (): void => {
      const ctx = this.ctx;
      const master = this.master;
      if (!ctx || !master) return;
      try {
        const v = clamp(value, 0, 1);
        // FNV-1a：名字 → 稳定 seed（音高/波形/微失谐）。
        let hash = 2166136261;
        for (let i = 0; i < name.length; i += 1) {
          hash ^= name.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        const seed = hash >>> 0;
        const semitone = seed % 24;
        const kindProfile = kind ? KIND_AUDIO[kind] : null;
        const octave = kindProfile?.octave ?? 1;
        const base = 110 * octave * 2 ** (semitone / 12);
        const kindBrightness = kindProfile?.brightness ?? 0.55;

        // 短 KS 拨弦缓冲：timbre 直接作为初始激励/波表，名字 seed 定噪声/音高。
        const seconds = Math.min(0.4, 0.16 + ((seed >>> 24) % 6) * 0.015 + (1 - v) * 0.04);
        const brightness = clamp(kindBrightness * 0.5 + v * 0.5, 0, 1);
        const samples = ksPluckBuffer({
          freq: base,
          seconds,
          sampleRate: ctx.sampleRate,
          brightness,
          seed,
          ...(timbre ? { timbre } : {}),
        });
        const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
        buffer.copyToChannel(samples, 0);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        const peak = 0.1 + v * 0.12 + (kindProfile?.gain ?? 0.25) * 0.05;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds + 0.02);
        source.connect(gain);
        gain.connect(master);
        source.start();
        source.stop(ctx.currentTime + seconds + 0.03);
        source.onended = () => {
          try {
            source.disconnect();
            gain.disconnect();
          } catch {
            /* ignore */
          }
        };
      } catch {
        /* 声音层静默失败，不影响画面 */
      }
    };
    if (!this.ctx) {
      void this.ensureStarted().then(run).catch(() => undefined);
      return;
    }
    void this.ctx.resume().catch(() => undefined);
    run();
  }

  /** v3.7：预加载音频资产（fetch→decodeAudioData，按 src 缓存）；失败静默。 */
  async preloadAsset(src: string): Promise<boolean> {
    if (this.failed) return false;
    await this.ensureStarted();
    const buffer = await this.loadAsset(src);
    return buffer !== null;
  }

  private async loadAsset(src: string): Promise<AudioBuffer | null> {
    if (!src) return null;
    const cached = this.assetCache.get(src);
    if (cached) return cached;
    const inflight = this.assetLoads.get(src);
    if (inflight) return inflight;
    const ctx = this.ctx;
    if (!ctx || this.failed) return null;
    const load = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(src);
        if (!response.ok) return null;
        const data = await response.arrayBuffer();
        const buffer = await ctx.decodeAudioData(data);
        if (buffer && buffer.length > 0) {
          this.assetCache.set(src, buffer);
          return buffer;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.assetLoads.delete(src);
      }
    })();
    this.assetLoads.set(src, load);
    return load;
  }

  /** v3.7：播放短音频资产，value 控 gain，经 master（受 F4 音量/静音）。失败返回 false。 */
  async playAsset(src: string, value = 0.8): Promise<boolean> {
    if (this.failed) return false;
    await this.ensureStarted();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.failed) return false;
    const buffer = await this.loadAsset(src);
    if (!buffer) return false;
    try {
      void ctx.resume().catch(() => undefined);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = Number.isFinite(value) ? clamp(value, 0, 1) : 0.8;
      source.connect(gain);
      gain.connect(master);
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
          /* ignore */
        }
      };
      source.start();
      return true;
    } catch {
      return false;
    }
  }

  /** v3.8：当前循环音频 src（pending 也算）。 */
  getLoopSrc(): string | null {
    return this.loopSrc ?? this.loopPending?.src ?? null;
  }

  /** v3.8：循环播放音频资产；context 未建时 pending，首次 ensureStarted 后自动开。 */
  async playLoop(src: string, volume = 1, loop = true): Promise<boolean> {
    if (this.failed || !src) return false;
    const nextVolume = Number.isFinite(volume) ? clamp(volume, 0, 1) : 1;
    const ctx = this.ctx;
    const master = this.master;
    // 同源不叠层：正在播放则只调 gain/loop。
    if (this.loopSrc === src && this.loopSource && this.loopGain && ctx) {
      this.loopVolume = nextVolume;
      this.loopRepeat = loop;
      try {
        this.loopGain.gain.setTargetAtTime(nextVolume, ctx.currentTime, 0.02);
        this.loopSource.loop = loop;
      } catch {
        /* ignore */
      }
      return true;
    }
    if (this.loopPending?.src === src) {
      this.loopPending = { src, volume: nextVolume, loop };
      return true;
    }
    if (!ctx || !master) {
      this.loopPending = { src, volume: nextVolume, loop };
      return true;
    }
    this.stopLoop(30);
    const token = ++this.loopToken;
    const buffer = await this.loadAsset(src);
    if (token !== this.loopToken) return false;
    if (!buffer || !this.ctx || !this.master) return false;
    try {
      void this.ctx.resume().catch(() => undefined);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      const gain = this.ctx.createGain();
      gain.gain.value = nextVolume;
      source.connect(gain);
      gain.connect(this.master);
      this.sources.add(source);
      this.loopSrc = src;
      this.loopSource = source;
      this.loopGain = gain;
      this.loopVolume = nextVolume;
      this.loopRepeat = loop;
      this.loopPending = null;
      source.onended = () => {
        this.sources.delete(source);
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
          /* ignore */
        }
        if (this.loopSource === source) {
          this.loopSrc = null;
          this.loopSource = null;
          this.loopGain = null;
        }
      };
      source.start();
      return true;
    } catch {
      return false;
    }
  }

  /** v3.8：停止循环（20–80ms 淡出），清 pending。 */
  stopLoop(fadeMs = 50): void {
    this.loopToken += 1;
    this.loopPending = null;
    this.loopSrc = null;
    const source = this.loopSource;
    const gain = this.loopGain;
    this.loopSource = null;
    this.loopGain = null;
    if (!source || !gain || !this.ctx) return;
    const ctx = this.ctx;
    const fade = clamp(Number.isFinite(fadeMs) ? fadeMs : 50, 20, 80) / 1000;
    const now = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
      gain.gain.linearRampToValueAtTime(0.0001, now + fade);
    } catch {
      /* ignore */
    }
    try {
      source.stop(now + fade + 0.02);
    } catch {
      /* already stopped */
    }
  }

  private resumePendingLoop(): void {
    const pending = this.loopPending;
    if (!pending || !this.ctx || !this.master) return;
    this.loopPending = null;
    void this.playLoop(pending.src, pending.volume, pending.loop);
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
    const effectiveTimbre = timbre ?? this.kindTimbres.get(kind);
    const timbreKey = effectiveTimbre
      ? `:t${effectiveTimbre.bands.map((v) => Math.round(v * 1000)).join('.')}${effectiveTimbre.smooth ? 's' : 'l'}${effectiveTimbre.loop ? 'o' : ''}`
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
        ...(effectiveTimbre ? { timbre: effectiveTimbre } : {}),
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
    const output = this.outputFor(kind);
    if (pan) {
      pan.pan.value = (x * 2 - 1) * 0.55;
      source.connect(gain);
      gain.connect(pan);
      pan.connect(output);
    } else {
      source.connect(gain);
      gain.connect(output);
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
    for (const id of [...this.sustainedStrings.keys()]) this.stopSustainedString(id);
    this.pendingSustainedStrings.clear();
  }

  /** v5.34：持续型弦——按下即持续发声。返回 id，可用于 stop/update。 */
  startSustainedString(kind: StringKind, xNorm: number, yNorm: number, amplitudeNorm = 0.6): number {
    const id = ++this.voiceSeq;
    const x = clamp(xNorm, 0, 1);
    const y = clamp(yNorm, 0, 1);
    this.pendingSustainedStrings.set(id, { kind, x, y, amplitude: amplitudeNorm });
    const materialize = (): void => {
      if (!this.pendingSustainedStrings.has(id)) return;
      this.pendingSustainedStrings.delete(id);
      this.materializeSustainedString(id, kind, x, y, amplitudeNorm);
    };
    if (this.ctx && this.master) materialize();
    else void this.ensureStarted().then(materialize);
    return id;
  }

  updateSustainedString(id: number, xNorm: number, yNorm: number): void {
    const pending = this.pendingSustainedStrings.get(id);
    if (pending) {
      pending.x = clamp(xNorm, 0, 1);
      pending.y = clamp(yNorm, 0, 1);
      return;
    }
    const voice = this.sustainedStrings.get(id);
    const ctx = this.ctx;
    if (!voice || !ctx) return;
    const profile = KIND_AUDIO[voice.kind];
    const x = clamp(xNorm, 0, 1);
    const y = clamp(yNorm, 0, 1);
    const freq = clamp(pitchForX(x * WAVE_WIDTH).freq * profile.octave, 30, ctx.sampleRate / 2 - 1);
    try {
      voice.osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.035);
      voice.gain.gain.setTargetAtTime(clamp(profile.gain * (0.35 + y * 0.4), 0.0005, 0.16), ctx.currentTime, 0.06);
      voice.pan?.pan.setTargetAtTime((x * 2 - 1) * 0.4, ctx.currentTime, 0.05);
      voice.x = x;
      voice.y = y;
    } catch {
      /* ignore */
    }
  }

  stopSustainedString(id: number): void {
    this.pendingSustainedStrings.delete(id);
    const voice = this.sustainedStrings.get(id);
    const ctx = this.ctx;
    if (!voice || !ctx) return;
    this.sustainedStrings.delete(id);
    try {
      const now = ctx.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
      voice.gain.gain.linearRampToValueAtTime(0.0001, now + 0.08);
      voice.osc.stop(now + 0.12);
      voice.osc.onended = () => {
        try {
          voice.osc.disconnect();
          voice.gain.disconnect();
          voice.pan?.disconnect();
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* ignore */
    }
  }

  sustainedStringCount(): number {
    return this.sustainedStrings.size + this.pendingSustainedStrings.size;
  }

  private materializeSustainedString(id: number, kind: StringKind, x: number, y: number, amplitude: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const profile = KIND_AUDIO[kind];
    const freq = clamp(pitchForX(x * WAVE_WIDTH).freq * profile.octave, 30, ctx.sampleRate / 2 - 1);
    const osc = ctx.createOscillator();
    osc.type = profile.brightness > 0.7 ? 'triangle' : 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const target = clamp(profile.gain * (0.35 + amplitude * 0.3), 0.0005, 0.16);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.055);
    const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    const output = this.outputFor(kind);
    if (pan) {
      pan.pan.value = (x * 2 - 1) * 0.4;
      osc.connect(gain);
      gain.connect(pan);
      pan.connect(output);
    } else {
      osc.connect(gain);
      gain.connect(output);
    }
    osc.start();
    this.sustainedStrings.set(id, { osc, gain, pan, kind, x, y });
  }

  /** v2.0.1：持续音色（拉奏/吹奏）——按住键时循环发声。返回 voice id。 */
  startSustainedSpectrum(
    bands: readonly number[],
    xNorm: number,
    yNorm: number,
    smooth: boolean,
    loop: boolean,
    amplitudeNorm = 0.6,
    priority = 0,
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
    const target = clamp(profile.gain * (0.4 + amplitudeNorm * 0.5), 0.02, 0.22);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.055);
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
    if (this.voices.size >= this.maxSustainedVoices) {
      let victim: number | undefined;
      let victimPriority = Number.POSITIVE_INFINITY;
      for (const [voiceId, voice] of this.voices) {
        if (voice.priority < victimPriority) {
          victim = voiceId;
          victimPriority = voice.priority;
        }
      }
      if (victim !== undefined) this.stopSustainedSpectrum(victim);
    }
    this.voices.set(id, {
      osc,
      gain,
      pan,
      baseGain: target,
      xNorm: x,
      yNorm: clamp(yNorm, 0, 1),
      priority,
      retires: [],
    });
    return id;
  }

  /** v2.3.3：节点移动时持续音高/音量跟随（音高按节点 x，音量按节点 y）。 */
  updateSustainedTone(id: number, xNorm: number, yNorm: number): void {
    const voice = this.voices.get(id);
    const ctx = this.ctx;
    if (!voice || !ctx) return;
    const x = clamp(xNorm, 0, 1);
    const y = clamp(yNorm, 0, 1);
    const profile = KIND_AUDIO['叙事'];
    const base = pitchForX(x * WAVE_WIDTH).freq * profile.octave;
    const freq = clamp(base, 30, ctx.sampleRate / 2 - 1);
    const now = ctx.currentTime;
    try {
      voice.osc.frequency.setTargetAtTime(freq, now, 0.035);
      voice.gain.gain.setTargetAtTime(clamp(voice.baseGain * (0.22 + y * 0.78), 0.0005, 0.22), now, 0.06);
      voice.pan?.pan.setTargetAtTime((x * 2 - 1) * 0.4, now, 0.05);
    } catch {
      /* ignore */
    }
    voice.xNorm = x;
    voice.yNorm = y;
  }

  /** 实时更新持续音的波形（拖段点/键盘改段值后音色跟随；交叉淡化避免爆音）。 */
  updateSustainedSpectrum(id: number, bands: readonly number[], smooth: boolean, loop: boolean): void {
    const voice = this.voices.get(id);
    const ctx = this.ctx;
    const master = this.master;
    if (!voice || !ctx || !master || bands.length < 2) return;
    const now = ctx.currentTime;
    if (voice.lastWaveAt !== undefined && now - voice.lastWaveAt < 0.07) return;
    voice.lastWaveAt = now;
    try {
      const fourier = spectrumFourier(bands, { min: 0, max: 1, smooth, loop });
      const wave = ctx.createPeriodicWave(fourier.real, fourier.imag);
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      try {
        osc.frequency.value = voice.osc.frequency.value;
      } catch {
        osc.frequency.value = 220;
      }
      const gain = ctx.createGain();
      const target = clamp(voice.baseGain * (0.22 + voice.yNorm * 0.78), 0.0005, 0.22);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(target, now + 0.05);
      if (voice.pan) gain.connect(voice.pan);
      else gain.connect(master);
      osc.connect(gain);
      osc.start();
      // 旧波淡出后停止，避免 setPeriodicWave 的相位跳变变成爆音。
      const oldOsc = voice.osc;
      const oldGain = voice.gain;
      try {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(Math.max(0.0001, oldGain.gain.value), now);
        oldGain.gain.linearRampToValueAtTime(0.0001, now + 0.05);
        oldOsc.stop(now + 0.08);
      } catch {
        /* ignore */
      }
      voice.retires.push({ osc: oldOsc, gain: oldGain });
      voice.osc = osc;
      voice.gain = gain;
      osc.onended = () => {
        try {
          gain.disconnect();
        } catch {
          /* ignore */
        }
        voice.retires = voice.retires.filter((item) => item.osc !== osc);
      };
      oldOsc.onended = () => {
        try {
          oldGain.disconnect();
        } catch {
          /* ignore */
        }
        voice.retires = voice.retires.filter((item) => item.osc !== oldOsc);
      };
    } catch {
      /* ignore */
    }
  }

  /** v6.10：当前持续 voice 的优先级快照（诊断/验收）。 */
  voicePriorities(): number[] {
    return [...this.voices.values()].map((voice) => voice.priority);
  }

  stopSustainedSpectrum(id: number): void {
    const ctx = this.ctx;
    const voice = this.voices.get(id);
    if (!voice) return;
    this.voices.delete(id);
    const end = (ctx?.currentTime ?? 0) + 0.18;
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
    for (const retired of voice.retires) {
      try {
        retired.gain.gain.cancelScheduledValues(ctx?.currentTime ?? 0);
        retired.gain.gain.setValueAtTime(Math.max(0.0001, retired.gain.gain.value), ctx?.currentTime ?? 0);
        retired.gain.gain.exponentialRampToValueAtTime(0.0001, end);
        retired.osc.stop(end + 0.02);
        retired.osc.onended = () => {
          try {
            retired.gain.disconnect();
          } catch {
            /* ignore */
          }
        };
      } catch {
        /* ignore */
      }
    }
  }
}

let instance: StringAudioEngine | null = null;

/** 单例：HMR / StrictMode 下共享同一个 AudioContext。 */
export function getStringAudio(): StringAudioEngine {
  if (!instance) instance = new StringAudioEngine();
  return instance;
}
