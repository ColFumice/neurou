/**
 * 基准弦的声音：Web Audio，不含 React。
 *
 * - 拨弦：Karplus-Strong 缓冲（按 音高档 + 音色档 缓存），随 x 定音高、随 y 定明暗与强弱。
 * - 持续音（drone）：把当前曲线位移的 DFT 谐波塞进 PeriodicWave，
 *   由 110Hz 振荡器 + 低通 + 极轻 gain 持续发声；曲线形状变化 = 音色变化。
 * - AnalyserNode 挂在 master 之后，`rms()` 给自动验收一个真实信号。
 *
 * 所有 AudioContext 都是懒创建：第一次 pointerdown 时才建立并 resume，
 * 没有用户手势之前绝不发声。浏览器拒绝时优雅降级（state = 'unavailable'）。
 */
import {
  WAVE_BASE_Y,
  WAVE_WIDTH,
  WAVE_Y_MAX,
  WAVE_Y_MIN,
  brightnessOf,
  displacementsToHarmonics,
  ksPluckBuffer,
  pitchForX,
} from './waveMath.js';

export type WaveAudioState = 'off' | 'running' | 'suspended' | 'unavailable';

/** 总音量（温和）。 */
const MASTER_LEVEL = 0.45;
/** drone 的持续音量。 */
const DRONE_LEVEL = 0.022;
/** drone 淡入时长（秒）。 */
const DRONE_FADE_IN = 0.8;
/** 无交互后 drone 淡出时长（秒）。 */
const DRONE_IDLE_FADE = 1.2;
/** 两次曲线→音色更新的最小间隔（毫秒）。 */
const CURVE_MIN_GAP_MS = 300;
/** 声部交叉淡化时长（秒），40–80ms。 */
const VOICE_FADE = 0.06;

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof AudioContext === 'undefined') return null;
  const win = window as unknown as { webkitAudioContext?: AudioContextCtor };
  return win.webkitAudioContext ?? AudioContext;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

interface DroneVoice {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class WaveAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Float32Array | null = null;
  private droneBus: GainNode | null = null;
  private voices: [DroneVoice, DroneVoice] | null = null;
  private activeVoice: 0 | 1 = 1;
  private status: WaveAudioState = 'off';
  private failed = false;
  private disposed = false;
  private listeners = new Set<(state: WaveAudioState) => void>();
  private bufferCache = new Map<string, AudioBuffer>();
  private activeSources = new Set<AudioBufferSourceNode>();
  private hasWaveform = false;
  private lastCurveAt = Number.NEGATIVE_INFINITY;
  private pendingCurve: number[] | null = null;
  private curveTimer: number | null = null;
  private suspendTimer: number | null = null;
  private lastSignature = '';

  /** 当前音频状态（off 表示还没被用户手势唤醒）。 */
  getState(): WaveAudioState {
    return this.status;
  }

  /** 订阅状态变化；返回退订函数。 */
  subscribe(listener: (state: WaveAudioState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 真实信号：master 后的 RMS（0..1）。没有音频时返回 0。 */
  rms(): number {
    const analyser = this.analyser;
    const data = this.analyserData;
    if (!analyser || !data || !this.ctx) return 0;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length));
  }

  /**
   * 在用户手势里调用：懒创建 AudioContext 并 resume。
   * 幂等；StrictMode 双挂载不会重复建 context（单例 + 本方法只建一次）。
   */
  async ensureStarted(): Promise<void> {
    if (this.disposed || this.failed) return;
    const existing = this.ctx;
    if (existing) {
      this.cancelSuspend();
      this.restoreMaster();
      if (existing.state !== 'running') {
        try {
          await existing.resume();
        } catch {
          /* 优雅降级：视觉照常 */
        }
      }
      this.emitState();
      return;
    }

    const Ctor = audioContextCtor();
    if (!Ctor) {
      this.failed = true;
      this.emitState();
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      this.failed = true;
      this.emitState();
      return;
    }
    this.ctx = ctx;
    ctx.onstatechange = () => this.emitState();
    try {
      this.buildGraph(ctx);
    } catch {
      this.failed = true;
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
      this.ctx = null;
      this.emitState();
      return;
    }
    try {
      await ctx.resume();
    } catch {
      /* 保持 suspended，视觉照常 */
    }
    this.restoreMaster();
    this.emitState();
  }

  /** 一次拨弦：音高随 x、明暗/强弱随 y、pan 随 x。 */
  pluck(x: number, y: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.disposed) return;

    const px = clamp(x, 0, WAVE_WIDTH);
    const py = clamp(y, WAVE_Y_MIN, WAVE_Y_MAX);
    const { freq, degree } = pitchForX(px);
    // 向上（y 小）= 更亮更响；向下（y 大）= 闷一点。
    const lift = clamp((WAVE_BASE_Y - py) / (WAVE_BASE_Y - WAVE_Y_MIN), -0.354, 1);
    const brightness = clamp(0.55 + lift * 0.45, 0.18, 1);
    const tier = Math.round(brightness * 4) / 4;
    const key = `${degree}:${tier}`;

    let buffer = this.bufferCache.get(key);
    if (!buffer) {
      const data = ksPluckBuffer({
        freq,
        seconds: 1.5,
        sampleRate: ctx.sampleRate,
        brightness: tier,
        seed: degree * 31 + Math.round(tier * 4) + 7,
      });
      buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.copyToChannel(data, 0);
      this.bufferCache.set(key, buffer);
    }

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 950 + brightness * 4700;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.26 + Math.max(0, lift) * 0.13;
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp((px / WAVE_WIDTH - 0.5) * 1.2, -0.6, 0.6);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(master);
    source.start(now + 0.004);
    source.stop(now + buffer.duration + 0.06);
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
        panner.disconnect();
      } catch {
        /* ignore */
      }
    };
    // 防止连点堆积：太多同时发声时掐掉最早的。
    if (this.activeSources.size > 14) {
      const oldest = this.activeSources.values().next().value;
      if (oldest) {
        try {
          oldest.stop();
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * 用当前曲线的位移采样更新 drone 音色。
   * 内部节流：两次真实更新至少隔 300ms（调用方还会再做 250ms 去抖）。
   */
  updateCurve(displacements: readonly number[]): void {
    if (!this.ctx || this.disposed) return;
    const now = performance.now();
    const wait = CURVE_MIN_GAP_MS - (now - this.lastCurveAt);
    if (Number.isFinite(wait) && wait > 0) {
      this.pendingCurve = Array.from(displacements);
      if (this.curveTimer === null) {
        this.curveTimer = window.setTimeout(() => {
          this.curveTimer = null;
          const pending = this.pendingCurve;
          this.pendingCurve = null;
          if (pending) this.applyCurve(pending);
        }, Math.ceil(wait));
      }
      return;
    }
    this.applyCurve(Array.from(displacements));
  }

  /** 重新唤醒 drone（用户又碰了东西）。 */
  wake(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    this.cancelSuspend();
    this.restoreMaster();
    if (this.hasWaveform) this.fadeBus(DRONE_LEVEL, DRONE_FADE_IN);
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {
        /* ignore */
      });
    }
    this.emitState();
  }

  /** 25s 无交互：drone 淡出到 0（不 suspend，点一下就能醒来）。 */
  idle(): void {
    if (!this.ctx || this.disposed) return;
    this.fadeBus(0, DRONE_IDLE_FADE);
  }

  /** Escape：全淡出 → suspend。下一次手势会重新 resume。 */
  reset(): void {
    if (this.disposed) return;
    this.clearCurveTimer();
    this.pendingCurve = null;
    this.lastSignature = '';
    this.hasWaveform = false;
    const ctx = this.ctx;
    if (!ctx) {
      this.emitState();
      return;
    }
    this.fadeBus(0, 0.3);
    const master = this.master;
    if (master) {
      const now = ctx.currentTime;
      const g = master.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.0001, now + 0.3);
    }
    this.cancelSuspend();
    this.suspendTimer = window.setTimeout(() => {
      this.suspendTimer = null;
      const context = this.ctx;
      if (!context || this.disposed) return;
      // 让这次手势之前的拨弦彻底停下，避免 resume 后回魂。
      for (const source of [...this.activeSources]) {
        try {
          source.stop();
        } catch {
          /* ignore */
        }
      }
      this.activeSources.clear();
      const masterNode = this.master;
      if (masterNode) {
        const now = context.currentTime;
        masterNode.gain.cancelScheduledValues(now);
        masterNode.gain.setValueAtTime(MASTER_LEVEL, now);
      }
      if (context.state === 'running') {
        void context
          .suspend()
          .then(() => this.emitState())
          .catch(() => this.emitState());
      } else {
        this.emitState();
      }
    }, 420);
  }

  /** HMR/测试清理用；组件卸载时不要调用（StrictMode 会误杀）。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearCurveTimer();
    if (this.suspendTimer !== null) {
      window.clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    for (const source of [...this.activeSources]) {
      try {
        source.stop();
      } catch {
        /* ignore */
      }
    }
    this.activeSources.clear();
    this.bufferCache.clear();
    this.listeners.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.analyserData = null;
    this.droneBus = null;
    this.voices = null;
    this.status = 'off';
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    }
  }

  /* ---------------------------------------------------------------- */

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = MASTER_LEVEL;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.24;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.4;

    master.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(ctx.destination);

    this.master = master;
    this.analyser = analyser;
    this.analyserData = new Float32Array(analyser.fftSize);

    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(master);
    this.droneBus = bus;

    const first = this.makeVoice(ctx, bus);
    const second = this.makeVoice(ctx, bus);
    this.voices = [first, second];
  }

  private makeVoice(ctx: AudioContext, destination: AudioNode): DroneVoice {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 110;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    osc.start();
    return { osc, filter, gain };
  }

  private applyCurve(displacements: readonly number[]): void {
    const ctx = this.ctx;
    const voices = this.voices;
    if (!ctx || !voices || this.disposed) return;
    this.lastCurveAt = performance.now();

    const spectrum = displacementsToHarmonics(displacements, 32);
    const brightness = brightnessOf(displacements);
    const hasShape = spectrum.energy > 1e-7;
    this.hasWaveform = hasShape;
    const signature = `${spectrum.energy.toFixed(4)}|${brightness.toFixed(3)}|${displacements.length}`;
    if (hasShape && signature === this.lastSignature) return;
    this.lastSignature = signature;

    const next: 0 | 1 = this.activeVoice === 0 ? 1 : 0;
    const voice = voices[next];
    const now = ctx.currentTime;
    try {
      if (hasShape) {
        const wave = ctx.createPeriodicWave(spectrum.real, spectrum.imag, {
          disableNormalization: false,
        });
        voice.osc.setPeriodicWave(wave);
      } else {
        voice.osc.type = 'sine';
      }
    } catch {
      // 极端系数下退回正弦，保证不断声。
      try {
        voice.osc.type = 'sine';
      } catch {
        /* ignore */
      }
    }
    voice.filter.frequency.cancelScheduledValues(now);
    voice.filter.frequency.setTargetAtTime(900 + brightness * 800, now, 0.08);

    this.crossfadeTo(next);
    this.fadeBus(hasShape ? DRONE_LEVEL : 0, hasShape ? DRONE_FADE_IN : 0.9);
  }

  private crossfadeTo(index: 0 | 1): void {
    const ctx = this.ctx;
    const voices = this.voices;
    if (!ctx || !voices) return;
    const now = ctx.currentTime;
    for (let i = 0; i < voices.length; i++) {
      const g = voices[i]!.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(i === index ? 1 : 0, now + VOICE_FADE);
    }
    this.activeVoice = index;
  }

  private fadeBus(target: number, seconds: number): void {
    const ctx = this.ctx;
    const bus = this.droneBus;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const g = bus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(clamp(target, 0, 1), now + Math.max(0.01, seconds));
  }

  private restoreMaster(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const g = master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(MASTER_LEVEL, now);
  }

  private cancelSuspend(): void {
    if (this.suspendTimer !== null) {
      window.clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
  }

  private clearCurveTimer(): void {
    if (this.curveTimer !== null) {
      window.clearTimeout(this.curveTimer);
      this.curveTimer = null;
    }
  }

  private computeState(): WaveAudioState {
    if (this.failed) return 'unavailable';
    const ctx = this.ctx;
    if (!ctx) return 'off';
    if (ctx.state === 'running') return 'running';
    if (ctx.state === 'suspended') return 'suspended';
    return 'unavailable';
  }

  private emitState(): void {
    const next = this.computeState();
    if (next === this.status) return;
    this.status = next;
    for (const listener of this.listeners) listener(next);
  }
}

let shared: WaveAudioEngine | null = null;

/** 全局唯一的音频引擎：StrictMode 双挂载、HMR 重挂都复用它。 */
export function getWaveAudio(): WaveAudioEngine {
  if (!shared) shared = new WaveAudioEngine();
  return shared;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    shared?.dispose();
    shared = null;
  });
}
