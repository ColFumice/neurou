import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSession, type GameModule, type GameResult } from './gameSdk.js';
import { GamePauseMenu } from './GamePauseMenu.js';
import type { Language } from './i18n.js';
import { drawGameChrome } from './gameTheme.js';
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
  difficulty?: number;
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
  difficulty,
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
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(false);
  const helpWasPlayingRef = useRef(false);

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
    drawGameChrome(ctx, width, height, {
      title: overlay.title,
      subtitle: overlay.subtitle,
      keys: overlay.keys,
      best,
      bestLabel: 'BEST',
    });
  }, [best, draw, overlay.keys, overlay.subtitle, overlay.title]);

  const startGame = useCallback(() => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 || 1;
    sessionRef.current.start(seed, { difficulty });
    lastRef.current = 0;
    setPhaseBoth('playing');
    paint();
  }, [difficulty, paint, setPhaseBoth]);

  const toggleHelp = useCallback(() => {
    if (helpOpenRef.current) {
      helpOpenRef.current = false;
      setHelpOpen(false);
      if (helpWasPlayingRef.current && phaseRef.current === 'playing') {
        sessionRef.current.resume();
      }
      helpWasPlayingRef.current = false;
      return;
    }
    helpOpenRef.current = true;
    helpWasPlayingRef.current = phaseRef.current === 'playing';
    if (helpWasPlayingRef.current) {
      sessionRef.current.pause();
    }
    setHelpOpen(true);
  }, []);

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
      const helpKey = event.code === 'KeyH' || event.key === '?';
      if (helpKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleHelp();
        return;
      }
      if (helpOpenRef.current) {
        if (event.code === 'Escape' || event.code === 'Enter') toggleHelp();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
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
  }, [commandFor, leaveToWorld, startGame, toggleHelp, togglePause]);

  useEffect(() => {
    const api = {
      snapshot: () => (debugSnapshot ? debugSnapshot(sessionRef.current.state) : sessionRef.current.state),
      phase: () => phaseRef.current,
      start: startGame,
      pause: togglePause,
      restart: startGame,
      exit: leaveToWorld,
      save: () => sessionRef.current.save(),
      help: () => helpOpenRef.current,
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
      {helpOpen ? (
        <div className="game-help" data-testid="game-help">
          <div className="game-help__title">{overlay.title} · 帮助</div>
          <div className="game-help__subtitle">{overlay.subtitle}</div>
          <div className="game-help__row">
            <span>操作</span>
            <strong>{overlay.keys}</strong>
          </div>
          <div className="game-help__row">
            <span>暂停</span>
            <strong>P · 继续 / 换游戏 / 回世界</strong>
          </div>
          <div className="game-help__row">
            <span>存档</span>
            <strong>Esc 退出后自动保存；再次进入恢复上一局</strong>
          </div>
          <div className="game-help__row">
            <span>帮助</span>
            <strong>H 或 ? 打开 · H / Esc / Enter 关闭</strong>
          </div>
          <div className="game-help__hint">关闭后回到刚才的游戏状态</div>
        </div>
      ) : null}
    </div>
  );
}
