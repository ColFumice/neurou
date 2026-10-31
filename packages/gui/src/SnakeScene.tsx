import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSession, type GameResult } from './gameSdk.js';
import { GamePauseMenu } from './GamePauseMenu.js';
import type { Language } from './i18n.js';
import { SNAKE_H, SNAKE_MODULE, SNAKE_W, snakeInterval, snakeLevel } from './snakeEngine.js';
import './tetris.css';

type Phase = 'ready' | 'playing' | 'paused' | 'over';

const BEST_KEY = 'neurou.snake.best';
const TEXT = {
  zh: {
    title: '贪吃蛇',
    subtitle: 'SNAKE · 60Hz',
    start: 'Enter 开始',
    hint: '按 Enter 开始',
    paused: 'P / Enter 继续',
    overHint: 'Enter 重开 · Esc 返回',
    score: '得分',
    length: '长度',
    speed: '速度',
    keys: '方向键 / WASD 转向 · P 暂停 · R 重开 · Esc 返回',
    best: '最高分',
  },
  en: {
    title: 'SNAKE',
    subtitle: 'SNAKE · 60Hz',
    start: 'Enter to start',
    hint: 'Press Enter',
    paused: 'P / Enter resume',
    overHint: 'Enter restart · Esc back',
    score: 'Score',
    length: 'Length',
    speed: 'Speed',
    keys: 'Arrows / WASD · P pause · R restart · Esc back',
    best: 'Best',
  },
} as const;

function loadBest(): number {
  try {
    return Number(window.localStorage.getItem(BEST_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    /* ignore */
  }
}

function commandFor(code: string, repeat: boolean): 'up' | 'down' | 'left' | 'right' | 'pause' | 'restart' | 'exit' | 'confirm' | null {
  if (repeat) return null;
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'ArrowLeft':
    case 'KeyA':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
    case 'KeyP':
      return 'pause';
    case 'KeyR':
      return 'restart';
    case 'Escape':
      return 'exit';
    case 'Enter':
    case 'NumpadEnter':
      return 'confirm';
    default:
      return null;
  }
}

interface SnakeSceneProps {
  language: Language;
  resume?: unknown;
  onSave?: (data: unknown | null) => void;
  bindingLabel?: string;
  onResult?: (result: GameResult) => void;
  onPickGame?: () => void;
  onExit: () => void;
}

export function SnakeScene({ language, resume, onSave, bindingLabel, onResult, onPickGame, onExit }: SnakeSceneProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef(new GameSession(SNAKE_MODULE, 1));
  const phaseRef = useRef<Phase>('ready');
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [best, setBest] = useState(() => loadBest());
  const text = TEXT[language];

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const draw = useCallback(() => {
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
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, width, height);
    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.45, 10, width * 0.5, height * 0.45, Math.max(width, height) * 0.8);
    vignette.addColorStop(0, 'rgba(34,40,32,.4)');
    vignette.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const state = sessionRef.current.state;
    const cell = Math.min((width * 0.5) / SNAKE_W, (height * 0.66) / SNAKE_H);
    const boardW = cell * SNAKE_W;
    const boardH = cell * SNAKE_H;
    const boardX = (width - boardW) / 2;
    const boardY = Math.max(100, (height - boardH) / 2);

    ctx.fillStyle = 'rgba(255,244,224,.018)';
    ctx.strokeStyle = 'rgba(255,236,205,.16)';
    ctx.fillRect(boardX, boardY, boardW, boardH);
    ctx.strokeRect(boardX + 0.5, boardY + 0.5, boardW - 1, boardH - 1);
    ctx.strokeStyle = 'rgba(255,236,205,.045)';
    for (let x = 1; x < SNAKE_W; x += 1) {
      const px = boardX + x * cell;
      ctx.beginPath();
      ctx.moveTo(px, boardY);
      ctx.lineTo(px, boardY + boardH);
      ctx.stroke();
    }
    for (let y = 1; y < SNAKE_H; y += 1) {
      const py = boardY + y * cell;
      ctx.beginPath();
      ctx.moveTo(boardX, py);
      ctx.lineTo(boardX + boardW, py);
      ctx.stroke();
    }

    // Food
    const foodX = boardX + state.food.x * cell + cell * 0.24;
    const foodY = boardY + state.food.y * cell + cell * 0.24;
    ctx.save();
    ctx.shadowColor = 'rgba(231,196,106,.7)';
    ctx.shadowBlur = cell * 0.8;
    ctx.fillStyle = '#e7c46a';
    ctx.beginPath();
    ctx.arc(foodX + cell * 0.24, foodY + cell * 0.24, cell * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Snake
    state.body.forEach((segment, index) => {
      const x = boardX + segment.x * cell;
      const y = boardY + segment.y * cell;
      const pad = Math.max(1, cell * 0.12);
      ctx.fillStyle = index === 0 ? 'rgba(236,248,232,.98)' : `rgba(143,206,127,${Math.max(0.32, 0.9 - index * 0.02)})`;
      ctx.fillRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
      if (index === 0) {
        ctx.fillStyle = '#0a0b0d';
        const eye = Math.max(1.5, cell * 0.1);
        ctx.fillRect(x + cell * 0.32, y + cell * 0.3, eye, eye);
        ctx.fillRect(x + cell * 0.58, y + cell * 0.3, eye, eye);
      }
    });

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,246,230,.92)';
    ctx.font = `300 ${Math.max(22, Math.min(36, width * 0.027))}px "Microsoft YaHei", system-ui, sans-serif`;
    ctx.fillText(text.title, 42, 34);
    ctx.fillStyle = 'rgba(255,240,220,.32)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.subtitle, 44, 82);

    const hudX = Math.max(42, boardX - 170);
    ctx.fillStyle = 'rgba(255,240,220,.35)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.score, hudX, boardY + 10);
    ctx.fillStyle = 'rgba(255,246,230,.9)';
    ctx.font = '300 32px ui-monospace, monospace';
    ctx.fillText(String(state.score), hudX, boardY + 28);
    ctx.fillStyle = 'rgba(255,240,220,.35)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.length, hudX, boardY + 82);
    ctx.fillStyle = 'rgba(255,246,230,.8)';
    ctx.font = '300 22px ui-monospace, monospace';
    ctx.fillText(String(state.body.length), hudX, boardY + 100);
    ctx.fillStyle = 'rgba(255,240,220,.35)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.speed, hudX, boardY + 140);
    ctx.fillStyle = 'rgba(255,246,230,.8)';
    ctx.font = '300 22px ui-monospace, monospace';
    ctx.fillText(String(snakeLevel(state)), hudX, boardY + 158);

    if (best > 0) {
      ctx.fillStyle = 'rgba(255,240,220,.3)';
      ctx.font = '300 10px ui-monospace, monospace';
      ctx.fillText(`${text.best} ${best}`, 44, height - 52);
    }
    ctx.fillStyle = 'rgba(255,240,220,.28)';
    ctx.font = '300 10px ui-monospace, monospace';
    ctx.fillText(text.keys, 44, height - 30);
    ctx.restore();
  }, [best, text]);

  useEffect(() => {
    if (!resume) return;
    if (sessionRef.current.restore(resume)) {
      setPhaseBoth('paused');
      draw();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGame = useCallback(() => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 || 1;
    sessionRef.current.start(seed);
    lastRef.current = 0;
    setPhaseBoth('playing');
    draw();
  }, [draw, setPhaseBoth]);

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
    const result = sessionRef.current.finish('over');
    const score = sessionRef.current.module.score(sessionRef.current.state);
    if (score > loadBest()) {
      saveBest(score);
      setBest(score);
    }
    onSave?.(null);
    if (result) onResult?.(result);
    setPhaseBoth('over');
  }, [onResult, onSave, setPhaseBoth]);

  useEffect(() => {
    const frame = (time: number): void => {
      const dt = lastRef.current ? time - lastRef.current : 0;
      lastRef.current = time;
      if (phaseRef.current === 'playing') {
        const steps = sessionRef.current.advance(dt);
        if (steps > 0) {
          draw();
          if (sessionRef.current.module.isOver(sessionRef.current.state)) finish();
        }
      }
      rafRef.current = window.requestAnimationFrame(frame);
    };
    rafRef.current = window.requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [draw, finish]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = commandFor(event.code, event.repeat);
      if (!command) return;
      if (event.code.startsWith('Arrow') || event.code === 'Space' || event.code.startsWith('Key') || event.code === 'Escape' || event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      const phaseNow = phaseRef.current;
      if (command === 'exit') {
        if (phaseNow !== 'ready') onSave?.(sessionRef.current.save());
        const result = phaseNow !== 'ready' ? sessionRef.current.finish('exit') : null;
        if (result) onResult?.(result);
        onExit();
        return;
      }
      if (command === 'confirm') {
        if (phaseNow === 'ready' || phaseNow === 'over') startGame();
        else if (phaseNow === 'paused') togglePause();
        return;
      }
      if (command === 'restart') {
        startGame();
        return;
      }
      if (command === 'pause') {
        togglePause();
        return;
      }
      if (phaseNow !== 'playing') return;
      sessionRef.current.input(command);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onExit, onSave, startGame, togglePause]);

  useEffect(() => {
    const api = {
      snapshot: () => sessionRef.current.state,
      phase: () => phaseRef.current,
      start: startGame,
      pause: togglePause,
      restart: startGame,
      exit: onExit,
      interval: () => snakeInterval(sessionRef.current.state),
    };
    (window as unknown as { __neurouSnake?: typeof api }).__neurouSnake = api;
    return () => {
      delete (window as unknown as { __neurouSnake?: typeof api }).__neurouSnake;
    };
  }, [onExit, onSave, startGame, togglePause]);

  useEffect(() => {
    draw();
    const onResize = (): void => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  const leaveToWorld = (): void => {
    onSave?.(sessionRef.current.save());
    const result = sessionRef.current.finish('exit');
    if (result) onResult?.(result);
    onExit();
  };

  const leaveToPicker = (): void => {
    onSave?.(sessionRef.current.save());
    onPickGame?.();
  };

  return (
    <div className="tetris-scene snake-scene" data-testid="snake-scene" data-snake-phase={phase}>
      <canvas ref={canvasRef} className="tetris-scene__canvas" />
      {phase !== 'playing' ? (
        <div className="tetris-scene__overlay" data-testid="snake-overlay">
          <div className="tetris-scene__overlay-kicker">{phase === 'ready' ? text.subtitle : phase === 'paused' ? 'PAUSED' : 'GAME OVER'}</div>
          <div className="tetris-scene__overlay-title">
            {phase === 'ready' ? text.title : phase === 'paused' ? 'Paused' : `Game Over · ${sessionRef.current.state.score}`}
          </div>
          <div className="tetris-scene__overlay-hint">
            {phase === 'ready' ? text.hint : phase === 'paused' ? text.paused : text.overHint}
          {phase === 'paused' ? <GamePauseMenu language={language} onResume={togglePause} onSwitch={leaveToPicker} onWorld={leaveToWorld} /> : null}
          </div>
          {phase === 'ready' && bindingLabel ? <div className="tetris-scene__overlay-note">{bindingLabel}</div> : null}
          {phase === 'ready' ? <div className="tetris-scene__overlay-note">{text.start}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
