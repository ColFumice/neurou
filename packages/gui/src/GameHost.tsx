import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSession, type GameModule, type GameResult } from './gameSdk.js';
import { GamePauseMenu } from './GamePauseMenu.js';
import type { Language } from './i18n.js';
import './tetris.css';

export type HostPhase = 'ready' | 'playing' | 'paused' | 'over';

export type HostInput<C> =
  | { type: 'input'; input: C }
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'exit' }
  | { type: 'confirm' };

export interface HostOverlayText {
  title: string;
  subtitle: string;
  start: string;
  hint: string;
  paused: string;
  pausedHint: string;
  over: string;
  overHint: string;
  keys: string;
}

export interface HostViewport {
  width: number;
  height: number;
  dpr: number;
}

interface GameHostProps<S, C> {
  module: GameModule<S, C>;
  language: Language;
  testId: string;
  debugKey: string;
  bestKey?: string;
  overlay: HostOverlayText;
  bindingLabel?: string;
  resume?: unknown;
  onSave?: (data: unknown | null) => void;
  onResult?: (result: GameResult) => void;
  onPickGame?: () => void;
  onExit: () => void;
  commandFor: (code: string, repeat: boolean) => HostInput<C> | null;
  draw: (ctx: CanvasRenderingContext2D, state: S, viewport: HostViewport, phase: HostPhase, best: number) => void;
  debugSnapshot?: (state: S) => unknown;
}

function loadBest(key?: string): number {
  if (!key) return 0;
  try {
    return Number(window.localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(key: string | undefined, value: number): void {
  if (!key) return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

/**
 * v1.40：通用实时游戏宿主。
 * 负责 Canvas、60Hz 会话、输入、暂停/重启/退出、结果、存档、暂停菜单。
 * 新游戏只需要 GameModule + commandFor + draw。
 */
export function GameHost<S, C>({
  module,
  language,
  testId,
  debugKey,
  bestKey,
  overlay,
  bindingLabel,
  resume,
  onSave,
  onResult,
  onPickGame,
  onExit,
  commandFor,
  draw,
  debugSnapshot,
}: GameHostProps<S, C>): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef(new GameSession(module, 1));
  const phaseRef = useRef<HostPhase>('ready');
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const [phase, setPhase] = useState<HostPhase>('ready');
  const [best, setBest] = useState(() => loadBest(bestKey));

  const setPhaseBoth = useCallback((next: HostPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, sessionRef.current.state, { width, height, dpr }, phaseRef.current, best);
  }, [best, draw]);

  const startGame = useCallback(() => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 || 1;
    sessionRef.current.start(seed);
    lastRef.current = 0;
    setPhaseBoth('playing');
    paint();
  }, [paint, setPhaseBoth]);

  const togglePause = useCallback(() => {
    if (phaseRef.current === 'playing') {
      sessionRef.current.pause();
      setPhaseBoth('paused');
    } else if (phaseRef.current === 'paused') {
      sessionRef.current.resume();
      setPhaseBoth('playing');
      lastRef.current = 0;
    }
  }, [setPhaseBoth]);

  const finish = useCallback(() => {
    const score = sessionRef.current.module.score(sessionRef.current.state);
    if (score > loadBest(bestKey)) {
      saveBest(bestKey, score);
      setBest(score);
    }
    onSave?.(null);
    const result = sessionRef.current.finish('over');
    if (result) onResult?.(result);
    setPhaseBoth('over');
  }, [bestKey, onResult, onSave, setPhaseBoth]);

  const leaveToWorld = useCallback(() => {
    onSave?.(sessionRef.current.save());
    const result = sessionRef.current.finish('exit');
    if (result) onResult?.(result);
    onExit();
  }, [onExit, onResult, onSave]);

  const leaveToPicker = useCallback(() => {
    onSave?.(sessionRef.current.save());
    onPickGame?.();
  }, [onPickGame, onSave]);

  useEffect(() => {
    if (!resume) return;
    if (sessionRef.current.restore(resume)) {
      setPhaseBoth('paused');
      paint();
    }
    // resume 只读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const frame = (time: number): void => {
      const dt = lastRef.current ? time - lastRef.current : 0;
      lastRef.current = time;
      if (phaseRef.current === 'playing') {
        const steps = sessionRef.current.advance(dt);
        if (steps > 0) {
          paint();
          if (sessionRef.current.module.isOver(sessionRef.current.state)) finish();
        }
      }
      rafRef.current = window.requestAnimationFrame(frame);
    };
    rafRef.current = window.requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [finish, paint]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = commandFor(event.code, event.repeat);
      if (!command) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const phaseNow = phaseRef.current;
      if (command.type === 'exit') {
        leaveToWorld();
        return;
      }
      if (command.type === 'confirm') {
        if (phaseNow === 'ready' || phaseNow === 'over') startGame();
        else if (phaseNow === 'paused') togglePause();
        return;
      }
      if (command.type === 'restart') {
        startGame();
        return;
      }
      if (command.type === 'pause') {
        togglePause();
        return;
      }
      if (phaseNow === 'playing') sessionRef.current.input(command.input);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [commandFor, leaveToWorld, startGame, togglePause]);

  useEffect(() => {
    const api = {
      snapshot: () => (debugSnapshot ? debugSnapshot(sessionRef.current.state) : sessionRef.current.state),
      phase: () => phaseRef.current,
      start: startGame,
      pause: togglePause,
      restart: startGame,
      exit: leaveToWorld,
      save: () => sessionRef.current.save(),
    };
    (window as unknown as Record<string, unknown>)[debugKey] = api;
    return () => {
      delete (window as unknown as Record<string, unknown>)[debugKey];
    };
  }, [debugKey, debugSnapshot, leaveToWorld, startGame, togglePause]);

  useEffect(() => {
    paint();
    const onResize = (): void => paint();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paint]);

  const showOverlay = phase !== 'playing';
  return (
    <div className="tetris-scene" data-testid={testId} data-phase={phase}>
      <canvas ref={canvasRef} className="tetris-scene__canvas" />
      {showOverlay ? (
        <div className="tetris-scene__overlay">
          <div className="tetris-scene__overlay-kicker">
            {phase === 'ready' ? overlay.subtitle : phase === 'paused' ? overlay.paused : overlay.over}
          </div>
          <div className="tetris-scene__overlay-title">
            {phase === 'ready'
              ? overlay.title
              : phase === 'paused'
                ? overlay.paused
                : `${overlay.over} · ${sessionRef.current.module.score(sessionRef.current.state)}`}
          </div>
          <div className="tetris-scene__overlay-hint">
            {phase === 'ready' ? overlay.hint : phase === 'paused' ? overlay.pausedHint : overlay.overHint}
          </div>
          {phase === 'ready' && bindingLabel ? <div className="tetris-scene__overlay-note">{bindingLabel}</div> : null}
          {phase === 'ready' ? <div className="tetris-scene__overlay-note">{overlay.start}</div> : null}
          {phase === 'paused' ? (
            <GamePauseMenu
              language={language}
              onResume={togglePause}
              onSwitch={leaveToPicker}
              onWorld={leaveToWorld}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
