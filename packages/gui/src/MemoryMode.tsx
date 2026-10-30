import { useEffect, useRef, useState } from 'react';
import { getStringAudio } from './stringAudio.js';

interface MemoryModeProps {
  active: boolean;
  screen: string;
  onExit: () => void;
}

const NOTE_KEYS = /^[a-z0-9]$/i;

/**
 * F12 记忆模式：
 * - 录制进入→退出区间的真实界面音频；
 * - 一次区间就是一个采样循环；
 * - 再次进入时旧循环按原采样播放，新演奏继续叠加录制；
 * - 退出时断开全部循环与录音。
 */
export function MemoryMode({ active, screen, onExit }: MemoryModeProps): JSX.Element {
  const activeRef = useRef(active);
  const initialScreenRef = useRef(screen);
  const startedAtRef = useRef(0);
  const notesRef = useRef(0);
  const [takes, setTakes] = useState(0);
  const [notes, setNotes] = useState(0);
  const [lengthMs, setLengthMs] = useState(0);
  const [recording, setRecording] = useState(false);
  activeRef.current = active;

  useEffect(() => {
    if (active) initialScreenRef.current = screen;
  }, [active, screen]);

  useEffect(() => {
    if (active && screen !== initialScreenRef.current) onExit();
  }, [active, screen, onExit]);

  useEffect(() => {
    if (!active) return;
    const audio = getStringAudio();
    let cancelled = false;
    startedAtRef.current = performance.now();
    notesRef.current = 0;
    setNotes(0);
    setLengthMs(0);
    setTakes(audio.memoryTakeCount());

    void (async () => {
      await audio.ensureStarted();
      if (cancelled) return;
      const ok = await audio.startMemoryRecording();
      if (cancelled) {
        if (ok) void audio.stopMemoryRecording();
        return;
      }
      setRecording(ok);
      setTakes(audio.playMemoryTakes());
    })();

    const onKey = (event: KeyboardEvent): void => {
      if (!activeRef.current) return;
      if (!NOTE_KEYS.test(event.key) && event.code !== 'Space') return;
      if (event.repeat) return;
      notesRef.current += 1;
      setNotes(notesRef.current);
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      audio.stopMemoryPlayback();
      void audio.stopMemoryRecording().then((result) => {
        setRecording(false);
        if (result) {
          setTakes(result.takes);
          setLengthMs(result.durationMs);
        }
      });
    };
  }, [active]);

  return (
    <div
      className={`memory-mode${active ? ' memory-mode--on' : ''}`}
      data-testid="memory-mode"
      data-memory-active={active ? 'true' : 'false'}
      data-memory-takes={takes}
      data-memory-notes={notes}
      data-memory-length={Math.round(lengthMs)}
      data-memory-recording={recording ? 'true' : 'false'}
    >
      <div className="memory-mode__reveal" />
      {active ? (
        <div className="memory-mode__hud">
          <strong>记忆模式</strong>
          <span>
            {takes > 0 ? `${takes} 个真实采样循环正在叠加` : '等待第一段采样'}
            {recording ? ' · 正在录制当前界面的原始声音' : ' · 采样录制不可用'}
          </span>
          <span>F12 退出并断开 · 循环长度 = 进入至退出区间的真实采样</span>
        </div>
      ) : null}
    </div>
  );
}
