import { useEffect, useRef, useState } from 'react';

interface MemoryModeProps {
  active: boolean;
  screen: string;
  worldFile: string;
  onExit: () => void;
}

interface Note {
  offsetMs: number;
  freq: number;
  gain: number;
}

interface Take {
  lengthMs: number;
  notes: Note[];
}

const NOTE_KEYS = /^[a-z0-9]$/i;
const STORAGE_PREFIX = 'neurou.memory:';

function loadTakes(key: string): Take[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { takes?: unknown };
    if (!Array.isArray(parsed.takes)) return [];
    return parsed.takes
      .filter((take): take is Take => {
        if (typeof take !== 'object' || take === null) return false;
        const item = take as Take;
        return typeof item.lengthMs === 'number' && Array.isArray(item.notes);
      })
      .slice(-8);
  } catch {
    return [];
  }
}

function saveTakes(key: string, takes: Take[]): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify({ takes: takes.slice(-8) }));
  } catch {
    /* 本地存储不可用时保持内存态 */
  }
}

/**
 * F12 记忆模式：
 * - 进入与退出之间严格记录每次键击的相对时间；
 * - 该区间成为一个循环；
 * - 再次进入时，先前循环会按原时间刻同时播放，新演奏叠加录制；
 * - 退出时断开全部声部。
 */
export function MemoryMode({ active, screen, worldFile, onExit }: MemoryModeProps): JSX.Element {
  const contextRef = useRef<AudioContext | null>(null);
  const activeRef = useRef(active);
  const takesRef = useRef<Take[]>(loadTakes(worldFile));
  const sessionStartRef = useRef(0);
  const sessionNotesRef = useRef<Note[]>([]);
  const timersRef = useRef<number[]>([]);
  const initialScreenRef = useRef(screen);
  const [takes, setTakes] = useState(takesRef.current.length);
  const [notes, setNotes] = useState(0);
  const [lengthMs, setLengthMs] = useState(0);
  activeRef.current = active;

  useEffect(() => {
    if (active) initialScreenRef.current = screen;
  }, [active, screen]);

  useEffect(() => {
    if (active && screen !== initialScreenRef.current) onExit();
  }, [active, screen, onExit]);

  useEffect(() => {
    if (!active) return;
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    void context.resume();
    sessionStartRef.current = performance.now();
    sessionNotesRef.current = [];
    setNotes(0);
    setLengthMs(0);
    setTakes(takesRef.current.length);

    const playNote = (note: Note, when = 0): void => {
      const oscillator = context.createOscillator();
      const amp = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = note.freq;
      const start = context.currentTime + Math.max(0, when);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(note.gain, start + 0.025);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
      oscillator.connect(amp).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.6);
    };

    const schedule = (): void => {
      for (const take of takesRef.current) {
        const cycle = (): void => {
          if (!activeRef.current) return;
          for (const note of take.notes) {
            const timer = window.setTimeout(() => {
              if (activeRef.current) playNote(note);
            }, note.offsetMs);
            timersRef.current.push(timer);
          }
          const next = window.setTimeout(cycle, take.lengthMs + 20);
          timersRef.current.push(next);
        };
        cycle();
      }
    };
    schedule();

    const onKey = (event: KeyboardEvent): void => {
      if (!activeRef.current) return;
      if (!NOTE_KEYS.test(event.key) && event.code !== 'Space') return;
      if (event.repeat) return;
      const now = performance.now();
      const offsetMs = Math.max(0, now - sessionStartRef.current);
      const index = typeof event.key === 'string' ? event.key.toLowerCase().charCodeAt(0) : 32;
      const note: Note = {
        offsetMs,
        freq: 170 + ((index * 37) % 660),
        gain: 0.04,
      };
      sessionNotesRef.current.push(note);
      setNotes(sessionNotesRef.current.length);
      playNote(note);
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
      const elapsed = Math.max(280, performance.now() - sessionStartRef.current);
      if (sessionNotesRef.current.length > 0) {
        takesRef.current = [...takesRef.current, { lengthMs: elapsed, notes: [...sessionNotesRef.current] }].slice(-8);
        saveTakes(worldFile, takesRef.current);
      }
      setTakes(takesRef.current.length);
      setNotes(sessionNotesRef.current.length);
      setLengthMs(elapsed);
    };
  }, [active, worldFile]);

  return (
    <div
      className={`memory-mode${active ? ' memory-mode--on' : ''}`}
      data-testid="memory-mode"
      data-memory-active={active ? 'true' : 'false'}
      data-memory-takes={takes}
      data-memory-notes={notes}
      data-memory-length={Math.round(lengthMs)}
    >
      <div className="memory-mode__reveal" />
      {active ? (
        <div className="memory-mode__hud">
          <strong>记忆模式</strong>
          <span>
            {takes > 0 ? `${takes} 个旧循环正在按原时间刻叠加` : '等待第一段演奏'} · 本循环已录 {notes} 音
          </span>
          <span>F12 退出并断开 · 循环长度 = 进入至退出区间</span>
        </div>
      ) : null}
    </div>
  );
}
