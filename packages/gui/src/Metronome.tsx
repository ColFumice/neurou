import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'neurou.metronome';

interface Settings {
  on: boolean;
  bpm: number;
  beats: number;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { on: false, bpm: 90, beats: 1 };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      on: Boolean(parsed.on),
      bpm: Math.max(30, Math.min(240, Number(parsed.bpm) || 90)),
      beats: Math.max(1, Math.min(8, Math.round(Number(parsed.beats) || 1))),
    };
  } catch {
    return { on: false, bpm: 90, beats: 1 };
  }
}

/** F11 节拍器：可设置每响之间隔多少拍。 */
export function Metronome(): JSX.Element {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [pulse, setPulse] = useState(0);
  const [count, setCount] = useState(0);
  const contextRef = useRef<AudioContext | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'F11' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSettings((value) => ({ ...value, on: !value.on }));
        return;
      }
      if (!settingsRef.current.on) return;
      if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSettings((value) => ({
          ...value,
          beats: Math.max(1, Math.min(8, value.beats + (event.code === 'BracketRight' ? 1 : -1))),
        }));
      } else if (event.code === 'Minus' || event.code === 'Equal') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSettings((value) => ({
          ...value,
          bpm: Math.max(30, Math.min(240, value.bpm + (event.code === 'Equal' ? 5 : -5))),
        }));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    if (!settings.on) {
      setPulse(0);
      return;
    }
    let tick = 0;
    const interval = (60000 / settings.bpm) * settings.beats;
    const click = (): void => {
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = tick % 4 === 0 ? 1200 : 820;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.025, context.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.06);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.07);
      tick += 1;
      setPulse((value) => value + 1);
      setCount((value) => value + 1);
    };
    click();
    const timer = window.setInterval(click, interval);
    return () => window.clearInterval(timer);
  }, [settings.on, settings.bpm, settings.beats]);

  if (!settings.on) {
    return <div className="metronome metronome--off" data-testid="metronome" data-metronome-on="false" aria-hidden="true" />;
  }
  return (
    <div className="metronome" data-testid="metronome" data-metronome-on="true" data-metronome-bpm={settings.bpm} data-metronome-beats={settings.beats} data-metronome-pulse={pulse}>
      <div className={`metronome__dot${count % settings.beats === 0 ? ' metronome__dot--accent' : ''}`} />
      <div>
        <strong>节拍器</strong>
        <span>
          {settings.bpm} BPM · 每 {settings.beats} 拍响一次
        </span>
      </div>
      <div className="metronome__hint">F11 关闭 · [ ] 调拍间隔 · − = 调 BPM</div>
    </div>
  );
}
