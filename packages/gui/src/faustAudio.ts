/**
 * v5.28：音频端口的 WebAudio 兜底。
 *
 * 这不是 Faust 编译器；Faust 源码仍由 faustBackend 生成。
 * 这里只把端口参数映射成一台确定性、低音量的正弦声源，供预览时试听。
 */
export interface FaustFallbackParams {
  frequency: number;
  gain: number;
}

export function faustFallbackParams(values: number[], volume: number): FaustFallbackParams {
  const first = values.find((value) => Number.isFinite(value)) ?? 0;
  const normalized = Math.min(1, Math.max(0, Math.abs(first) / 100));
  return {
    frequency: 110 + normalized * 220,
    gain: Math.max(0, Math.min(1, volume)) * 0.012,
  };
}

export class FaustFallback {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  state: 'stopped' | 'playing' | 'suspended' | 'unavailable' = 'stopped';

  start(values: number[], volume: number): void {
    const params = faustFallbackParams(values, volume);
    try {
      if (!this.context) {
        const Ctor =
          typeof window === 'undefined'
            ? undefined
            : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (!Ctor) {
          this.state = 'unavailable';
          return;
        }
        this.context = new Ctor();
      }
      const context = this.context;
      if (!context) {
        this.state = 'unavailable';
        return;
      }
      if (!this.oscillator) {
        this.oscillator = context.createOscillator();
        this.gainNode = context.createGain();
        this.oscillator.type = 'sine';
        this.oscillator.frequency.value = params.frequency;
        this.gainNode.gain.value = params.gain;
        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(context.destination);
        this.oscillator.start();
      }
      this.oscillator.frequency.setTargetAtTime(params.frequency, context.currentTime, 0.08);
      this.gainNode?.gain.setTargetAtTime(params.gain, context.currentTime, 0.12);
      void context.resume().catch(() => undefined);
      this.state = context.state === 'running' ? 'playing' : 'suspended';
    } catch {
      this.state = 'unavailable';
    }
  }

  stop(): void {
    try {
      this.oscillator?.stop();
      this.oscillator?.disconnect();
      this.gainNode?.disconnect();
      void this.context?.close();
    } catch {
      /* 已停止或上下文已关闭 */
    }
    this.context = null;
    this.oscillator = null;
    this.gainNode = null;
    this.state = 'stopped';
  }
}
