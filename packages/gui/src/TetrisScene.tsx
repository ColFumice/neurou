import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSession, TETRIS_MODULE } from './gameSdk.js';
import type { Language } from './i18n.js';
import {
  BOARD_H,
  BOARD_W,
  PIECE_KINDS,
  TetrisEngine,
  shapeFor,
  type PieceKind,
  type TetrisAction,
} from './tetrisEngine.js';
import { commandForKey, shouldPreventGameKey, type TetrisKeyCommand } from './tetrisInput.js';
import './tetris.css';

type Phase = 'ready' | 'playing' | 'paused' | 'over';

const BEST_KEY = 'neurou.tetris.best';

const PIECE_COLORS: Record<PieceKind, { fill: string; glow: string }> = {
  I: { fill: '#7fd1c9', glow: 'rgba(127,209,201,.55)' },
  O: { fill: '#e7c46a', glow: 'rgba(231,196,106,.55)' },
  T: { fill: '#c79ae6', glow: 'rgba(199,154,230,.55)' },
  S: { fill: '#8fce7f', glow: 'rgba(143,206,127,.55)' },
  Z: { fill: '#e58f8f', glow: 'rgba(229,143,143,.55)' },
  J: { fill: '#85aee8', glow: 'rgba(133,174,232,.55)' },
  L: { fill: '#e8a86c', glow: 'rgba(232,168,108,.55)' },
};

const TEXT = {
  zh: {
    title: '俄罗斯方块',
    subtitle: 'BLOCKS · 60Hz',
    start: 'Enter 开始',
    restart: 'R 重开 · Esc 返回',
    pause: '暂停',
    paused: 'P / Enter 继续',
    over: '结束',
    overHint: 'Enter 重开 · Esc 返回',
    score: '得分',
    lines: '消行',
    level: '等级',
    next: '下一个',
    keys: '← → 移动 · ↑ 旋转 · ↓ 软降 · Space 硬降 · P 暂停 · Esc 返回',
    best: '最高分',
    hint: '按 Enter 开始',
  },
  en: {
    title: 'TETRIS',
    subtitle: 'BLOCKS · 60Hz',
    start: 'Enter to start',
    restart: 'R restart · Esc back',
    pause: 'Paused',
    paused: 'P / Enter resume',
    over: 'Game Over',
    overHint: 'Enter restart · Esc back',
    score: 'Score',
    lines: 'Lines',
    level: 'Level',
    next: 'Next',
    keys: '← → move · ↑ rotate · ↓ soft · Space hard · P pause · Esc back',
    best: 'Best',
    hint: 'Press Enter',
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

export interface TetrisResult {
  score: number;
  lines: number;
  level: number;
  /** over = 游戏结束；exit = 玩家主动返回。 */
  reason: 'over' | 'exit';
}

interface TetrisSceneProps {
  language: Language;
  /** 世界绑定时显示写入目标。 */
  bindingLabel?: string;
  onResult?: (result: TetrisResult) => void;
  onExit: () => void;
}

export function TetrisScene({ language, bindingLabel, onResult, onExit }: TetrisSceneProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef(new GameSession(TETRIS_MODULE, 1));
  const engineRef = useRef<TetrisEngine>(sessionRef.current.state.engine);
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

    // 纸面与暗角。
    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, width, height);
    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, 10, width * 0.5, height * 0.48, Math.max(width, height) * 0.75);
    vignette.addColorStop(0, 'rgba(38,32,26,.35)');
    vignette.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const engine = engineRef.current;
    const snapshot = engine.snapshot;
    const boardW = Math.min(width * 0.34, height * 0.62, 360);
    const cell = boardW / BOARD_W;
    const boardX = (width - boardW) / 2;
    const boardY = Math.max(110, (height - cell * BOARD_H) / 2);
    const boardH = cell * BOARD_H;

    // 棋盘底。
    ctx.save();
    ctx.fillStyle = 'rgba(255,244,224,.018)';
    ctx.strokeStyle = 'rgba(255,236,205,.16)';
    ctx.lineWidth = 1;
    ctx.fillRect(boardX, boardY, boardW, boardH);
    ctx.strokeRect(boardX + 0.5, boardY + 0.5, boardW - 1, boardH - 1);
    for (let x = 1; x < BOARD_W; x += 1) {
      const px = boardX + x * cell;
      ctx.strokeStyle = 'rgba(255,236,205,.045)';
      ctx.beginPath();
      ctx.moveTo(px, boardY);
      ctx.lineTo(px, boardY + boardH);
      ctx.stroke();
    }
    for (let y = 1; y < BOARD_H; y += 1) {
      const py = boardY + y * cell;
      ctx.strokeStyle = 'rgba(255,236,205,.045)';
      ctx.beginPath();
      ctx.moveTo(boardX, py);
      ctx.lineTo(boardX + boardW, py);
      ctx.stroke();
    }
    ctx.restore();

    const drawCell = (cx: number, cy: number, kind: PieceKind, ghost = false): void => {
      const color = PIECE_COLORS[kind];
      const x = boardX + cx * cell;
      const y = boardY + cy * cell;
      const pad = Math.max(1, cell * 0.08);
      ctx.save();
      if (ghost) {
        ctx.strokeStyle = 'rgba(255,240,220,.28)';
        ctx.setLineDash([Math.max(2, cell * 0.12), Math.max(2, cell * 0.12)]);
        ctx.strokeRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
        ctx.restore();
        return;
      }
      ctx.shadowColor = color.glow;
      ctx.shadowBlur = Math.max(4, cell * 0.28);
      ctx.fillStyle = color.fill;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + pad + 0.5, y + pad + 0.5, cell - pad * 2 - 1, cell - pad * 2 - 1);
      ctx.restore();
    };

    for (let y = 0; y < BOARD_H; y += 1) {
      for (let x = 0; x < BOARD_W; x += 1) {
        const value = snapshot.board[y]![x] ?? 0;
        if (!value) continue;
        drawCell(x, y, PIECE_KINDS[value - 1]!);
      }
    }

    const active = snapshot.active;
    if (active) {
      const shape = shapeFor(active.kind, active.rotation);
      // 幽灵落点。
      let ghost = active.y;
      while (true) {
        const candidate = { ...active, y: ghost + 1 };
        if (engine.collides(candidate)) break;
        ghost += 1;
      }
      for (let y = 0; y < shape.length; y += 1) {
        for (let x = 0; x < shape.length; x += 1) {
          if (!shape[y]![x]) continue;
          if (active.y + y >= 0) drawCell(active.x + x, active.y + y, active.kind, true);
          if (ghost + y >= 0) drawCell(active.x + x, ghost + y, active.kind, true);
        }
      }
      for (let y = 0; y < shape.length; y += 1) {
        for (let x = 0; x < shape.length; x += 1) {
          if (!shape[y]![x]) continue;
          if (active.y + y >= 0) drawCell(active.x + x, active.y + y, active.kind);
        }
      }
    }

    // HUD：左上标题/分数，右上下一块，底部键位。
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,246,230,.92)';
    ctx.font = `300 ${Math.max(22, Math.min(38, width * 0.028))}px "Microsoft YaHei", system-ui, sans-serif`;
    ctx.fillText(text.title, 42, 34);
    ctx.fillStyle = 'rgba(255,240,220,.32)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.subtitle, 44, 82);

    const hudX = Math.max(42, boardX - 170);
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,240,220,.35)';
    ctx.fillText(text.score, hudX, boardY + 10);
    ctx.fillStyle = 'rgba(255,246,230,.9)';
    ctx.font = '300 32px ui-monospace, monospace';
    ctx.fillText(String(snapshot.score), hudX, boardY + 28);
    ctx.fillStyle = 'rgba(255,240,220,.35)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.lines, hudX, boardY + 82);
    ctx.fillStyle = 'rgba(255,246,230,.8)';
    ctx.font = '300 22px ui-monospace, monospace';
    ctx.fillText(String(snapshot.lines), hudX, boardY + 100);
    ctx.fillStyle = 'rgba(255,240,220,.35)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.level, hudX, boardY + 140);
    ctx.fillStyle = 'rgba(255,246,230,.8)';
    ctx.font = '300 22px ui-monospace, monospace';
    ctx.fillText(String(snapshot.level), hudX, boardY + 158);

    const nextX = boardX + boardW + Math.max(44, width * 0.035);
    ctx.fillStyle = 'rgba(255,240,220,.35)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.next, nextX, boardY + 10);
    snapshot.queue.slice(0, 3).forEach((kind, index) => {
      const shape = shapeFor(kind, 0);
      const size = Math.min(18, cell * 0.5);
      const originX = nextX;
      const originY = boardY + 34 + index * size * 4.4;
      for (let y = 0; y < shape.length; y += 1) {
        for (let x = 0; x < shape.length; x += 1) {
          if (!shape[y]![x]) continue;
          const color = PIECE_COLORS[kind];
          ctx.fillStyle = color.fill;
          ctx.globalAlpha = 0.82;
          ctx.fillRect(originX + x * size, originY + y * size, size - 2, size - 2);
          ctx.globalAlpha = 1;
        }
      }
    });

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

  const startGame = useCallback(() => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 || 1;
    sessionRef.current.start(seed);
    engineRef.current = sessionRef.current.state.engine;
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
    const score = engineRef.current.scoreValue;
    if (score > loadBest()) {
      saveBest(score);
      setBest(score);
    }
    if (result) onResult?.(result);
    setPhaseBoth('over');
  }, [onResult, setPhaseBoth]);

  // 固定 60Hz 主循环。
  useEffect(() => {
    const frame = (time: number): void => {
      const dt = lastRef.current ? time - lastRef.current : 0;
      lastRef.current = time;
      if (phaseRef.current === 'playing') {
        const session = sessionRef.current;
        const steps = session.advance(dt);
        const engine = session.state.engine;
        engineRef.current = engine;
        if (steps > 0) {
          draw();
          if (engine.isOver) finish();
        }
      }
      rafRef.current = window.requestAnimationFrame(frame);
    };
    rafRef.current = window.requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [draw, finish]);

  // 键盘。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = commandForKey(event.code, event.repeat);
      if (!command) return;
      if (shouldPreventGameKey(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      const phaseNow = phaseRef.current;
      if (command === 'exit') {
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
  }, [onExit, startGame, togglePause]);

  // 调试/验收 API。
  useEffect(() => {
    const api = {
      snapshot: () => engineRef.current.snapshot,
      phase: () => phaseRef.current,
      start: startGame,
      pause: togglePause,
      restart: startGame,
      exit: onExit,
      best: () => loadBest(),
    };
    (window as unknown as { __neurouTetris?: typeof api }).__neurouTetris = api;
    return () => {
      delete (window as unknown as { __neurouTetris?: typeof api }).__neurouTetris;
    };
  }, [onExit, startGame, togglePause]);

  useEffect(() => {
    draw();
    const onResize = (): void => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  return (
    <div className="tetris-scene" data-testid="tetris-scene" data-tetris-phase={phase} data-tetris-score={engineRef.current.scoreValue}>
      <canvas ref={canvasRef} className="tetris-scene__canvas" />
      {phase !== 'playing' ? (
        <div className="tetris-scene__overlay" data-testid="tetris-overlay">
          <div className="tetris-scene__overlay-kicker">{phase === 'ready' ? text.subtitle : phase === 'paused' ? text.pause : text.over}</div>
          <div className="tetris-scene__overlay-title">
            {phase === 'ready' ? text.title : phase === 'paused' ? text.pause : `${text.over} · ${engineRef.current.scoreValue}`}
          </div>
          <div className="tetris-scene__overlay-hint">
            {phase === 'ready' ? text.hint : phase === 'paused' ? text.paused : text.overHint}
          </div>
          {phase === 'ready' && bindingLabel ? <div className="tetris-scene__overlay-note">{bindingLabel}</div> : null}\n          {phase === 'ready' ? <div className="tetris-scene__overlay-note">{text.restart}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
