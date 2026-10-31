import type { GameResult } from './gameSdk.js';
import { SNAKE_MODULE } from './snakeEngine.js';
import { GameHost, type HostInput, type HostOverlayText, type HostViewport } from './GameHost.js';
import type { Language } from './i18n.js';
import {
  SNAKE_H,
  SNAKE_W,
  snakeInterval,
  snakeLevel,
  type SnakeCommand,
  type SnakeState,
} from './snakeEngine.js';

interface SnakeSceneProps {
  language: Language;
  bindingLabel?: string;
  resume?: unknown;
  onSave?: (data: unknown | null) => void;
  onResult?: (result: GameResult) => void;
  onPickGame?: () => void;
  onExit: () => void;
}

const TEXT = {
  zh: {
    title: '贪吃蛇',
    subtitle: 'SNAKE · 60Hz',
    start: 'Enter 开始',
    hint: '按 Enter 开始',
    paused: '暂停',
    pausedHint: 'P / Enter 继续',
    over: '结束',
    overHint: 'Enter 重开 · Esc 返回',
    keys: '方向键 / WASD 转向 · P 暂停 · R 重开 · Esc 返回',
    score: '得分',
    length: '长度',
    speed: '速度',
    best: '最高分',
  },
  en: {
    title: 'SNAKE',
    subtitle: 'SNAKE · 60Hz',
    start: 'Enter to start',
    hint: 'Press Enter',
    paused: 'Paused',
    pausedHint: 'P / Enter resume',
    over: 'Game Over',
    overHint: 'Enter restart · Esc back',
    keys: 'Arrows / WASD · P pause · R restart · Esc back',
    score: 'Score',
    length: 'Length',
    speed: 'Speed',
    best: 'Best',
  },
} as const;

function commandFor(code: string, repeat: boolean): HostInput<SnakeCommand> | null {
  if (repeat) return null;
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return { type: 'input', input: 'up' };
    case 'ArrowDown':
    case 'KeyS':
      return { type: 'input', input: 'down' };
    case 'ArrowLeft':
    case 'KeyA':
      return { type: 'input', input: 'left' };
    case 'ArrowRight':
    case 'KeyD':
      return { type: 'input', input: 'right' };
    case 'KeyP':
      return { type: 'pause' };
    case 'KeyR':
      return { type: 'restart' };
    case 'Escape':
      return { type: 'exit' };
    case 'Enter':
    case 'NumpadEnter':
      return { type: 'confirm' };
    default:
      return null;
  }
}

function drawSnake(
  ctx: CanvasRenderingContext2D,
  state: SnakeState,
  viewport: HostViewport,
  _phase: string,
  best: number,
  language: Language,
): void {
  const { width, height } = viewport;
  const text = TEXT[language];
  ctx.fillStyle = '#0a0b0d';
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.45, 10, width * 0.5, height * 0.45, Math.max(width, height) * 0.8);
  vignette.addColorStop(0, 'rgba(34,40,32,.4)');
  vignette.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

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

  ctx.save();
  ctx.shadowColor = 'rgba(231,196,106,.7)';
  ctx.shadowBlur = cell * 0.8;
  ctx.fillStyle = '#e7c46a';
  ctx.beginPath();
  ctx.arc(boardX + state.food.x * cell + cell / 2, boardY + state.food.y * cell + cell / 2, cell * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

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

  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,246,230,.92)';
  ctx.font = `300 ${Math.max(22, Math.min(36, width * 0.027))}px "Microsoft YaHei", system-ui, sans-serif`;
  ctx.fillText(text.title, 42, 34);
  ctx.fillStyle = 'rgba(255,240,220,.32)';
  ctx.font = '300 11px ui-monospace, monospace';
  ctx.fillText(text.subtitle, 44, 82);
  const hudX = Math.max(42, boardX - 170);
  ctx.fillStyle = 'rgba(255,240,220,.35)';
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
  ctx.fillStyle = 'rgba(255,240,220,.2)';
  ctx.fillText(`${snakeInterval(state)}ms`, 44, height - 74);
}

export function SnakeScene({
  language,
  bindingLabel,
  resume,
  onSave,
  onResult,
  onPickGame,
  onExit,
}: SnakeSceneProps): JSX.Element {
  const text = TEXT[language];
  const overlay: HostOverlayText = {
    title: text.title,
    subtitle: text.subtitle,
    start: text.start,
    hint: text.hint,
    paused: text.paused,
    pausedHint: text.pausedHint,
    over: text.over,
    overHint: text.overHint,
    keys: text.keys,
  };
  return (
    <GameHost
      module={SNAKE_MODULE}
      language={language}
      testId="snake-scene"
      debugKey="__neurouSnake"
      bestKey="neurou.snake.best"
      overlay={overlay}
      bindingLabel={bindingLabel}
      resume={resume}
      onSave={onSave}
      onResult={onResult}
      onPickGame={onPickGame}
      onExit={onExit}
      commandFor={commandFor}
      draw={(ctx, state, viewport, phase, best) => drawSnake(ctx, state, viewport, phase, best, language)}
    />
  );
}
