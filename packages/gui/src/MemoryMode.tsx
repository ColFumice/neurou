import { useEffect, useRef } from 'react';

interface MemoryModeProps {
  active: boolean;
  screen: string;
  onExit: () => void;
}

const NOTE_KEYS = /^[a-z0-9]$/i;

/**
 * F12 记忆模式：右上角反色圆扩散/收缩；
 * 录制该界面上的键盘演奏为循环声部，切换界面自动退出。
 */
export function MemoryMode({ active, screen, onExit }: MemoryModeProps): JSX.Element {
  const contextRef = useRef<AudioContext | null>(null);
  const loopRef = useRef<number>(0);
  const tracksRef = useRef<Array<{ freq: number; gain: number }>>([]);
  const initialScreenRef = useRef(screen);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (active) initialScreenRef.current = screen;
  }, [active, screen]);

  useEffect(() => {
    if (!active) return;
    if (screen !== initialScreenRef.current) {
      onExit();
    }
  }, [active, screen, onExit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'F12' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onExit();
        return;
      }
      if (!activeRef.current) return;
      if (!NOTE_KEYS.test(event.key) && event.code !== 'Space') return;
      if (event.repeat) return;
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      void context.resume();
      const index = typeof event.key === 'string' ? event.key.toLowerCase().charCodeAt(0) : 32;
      const freq = 180 + ((index * 37) % 640);
      const gain = 0.045;
      tracksRef.current.push({ freq, gain });
      if (tracksRef.current.length > 24) tracksRef.current.shift();
      const oscillator = context.createOscillator();
      const amp = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;
      amp.gain.setValueAtTime(0.0001, context.currentTime);
      amp.gain.exponentialRampToValueAtTime(gain, context.currentTime + 0.02);
      amp.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
      oscillator.connect(amp).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.4);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, onExit]);

  useEffect(() => {
    if (!active) {
      window.clearInterval(loopRef.current);
      tracksRef.current = [];
      return;
    }
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    void context.resume();
    const playLoop = (): void => {
      const tracks = tracksRef.current;
      if (tracks.length === 0) return;
      const now = context.currentTime;
      for (const track of tracks.slice(-8)) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.value = track.freq;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(track.gain * 0.6, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 1.2);
      }
    };
    loopRef.current = window.setInterval(playLoop, 1800);
    return () => {
      window.clearInterval(loopRef.current);
    };
  }, [active]);

  return (
    <div className={`memory-mode${active ? ' memory-mode--on' : ''}`} data-testid="memory-mode" data-memory-active={active ? 'true' : 'false'}>
      <div className="memory-mode__reveal" />
      {active ? (
        <div className="memory-mode__hud">
          <strong>记忆模式</strong>
          <span>F12 退出 · 当前界面演奏会叠加为循环声部 · 切换界面自动退出</span>
        </div>
      ) : null}
    </div>
  );
}
