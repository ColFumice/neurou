import type { GameResult } from './gameSdk.js';
import { GameHost, type HostInput, type HostOverlayText, type HostViewport } from './GameHost.js';
import type { Language } from './i18n.js';
import { paintGameBackdrop, paintGameBoard, type GameTheme, type GameThemeName } from './gameTheme.js';
import {
  BREAKOUT_H,
  BREAKOUT_MODULE,
  BREAKOUT_W,
  BRICK_COLS,
  BRICK_ROWS,
  type BreakoutCommand,
  type BreakoutState,
} from './breakoutEngine.js';

interface BreakoutSceneProps {
  language: Language;
  theme?: GameThemeName;
  difficulty?: number;
  waves?: number;
  bindingLabel?: string;
  resume?: unknown;
  onSave?: (data: unknown | null) => void;
  onResult?: (result: GameResult) => void;
  onPickGame?: () => void;
  onExit: () => void;
}

const TEXT = {
  zh: {
    title: '打砖块',
    subtitle: 'BREAKOUT · 60Hz',
    start: 'Enter 开始',
    hint: '按 Enter 开始',
    paused: '暂停',
    pausedHint: 'P / Enter 继续',
    over: '结束',
    overHint: 'Enter 重开 · Esc 返回',
    keys: '← → 移动挡板 · P 暂停 · R 重开 · Esc 返回',
    lives: '生命',
    score: '得分',
    best: '最高分',
  },
  en: {
    title: 'BREAKOUT',
    subtitle: 'BREAKOUT · 60Hz',
    start: 'Enter to start',
    hint: 'Press Enter',
    paused: 'Paused',
    pausedHint: 'P / Enter resume',
    over: 'Game Over',
    overHint: 'Enter restart · Esc back',
    keys: '← → move · P pause · R restart · Esc back',
    lives: 'Lives',
    score: 'Score',
    best: 'Best',
  },
} as const;

function commandFor(code: string, repeat: boolean): HostInput<BreakoutCommand> | null {
  if (repeat) return null;
  switch (code) {
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

function drawBreakout(
  ctx: CanvasRenderingContext2D,
  state: BreakoutState,
  viewport: HostViewport,
  _phase: string,
  best: number,
  language: Language,
  theme: GameTheme,
): void {
  const { width, height } = viewport;
  const text = TEXT[language];
  paintGameBackdrop(ctx, width, height, theme);
  const scale = Math.min((width * 0.62) / BREAKOUT_W, (height * 0.62) / BREAKOUT_H);
  const boardW = BREAKOUT_W * scale;
  const boardH = BREAKOUT_H * scale;
  const left = (width - boardW) / 2;
  const top = (height - boardH) / 2;
  paintGameBoard(ctx, left, top, boardW, boardH, theme);

  const brickW = boardW / BRICK_COLS;
  const brickH = 4 * scale;
  state.bricks.forEach((value, index) => {
    if (!value) return;
    const row = Math.floor(index / BRICK_COLS);
    const col = index % BRICK_COLS;
    ctx.fillStyle = theme.accent;
    ctx.globalAlpha = 0.9 - row * 0.1;
    ctx.fillRect(left + col * brickW + 1, top + (5 + row * 4) * scale + 1, brickW - 2, brickH - 2);
    ctx.globalAlpha = 1;
  });

  const paddleH = 2.4 * scale;
  ctx.fillStyle = 'rgba(236,248,232,.92)';
  ctx.fillRect(left + (state.paddleX - 6) * scale, top + (BREAKOUT_H - 7) * scale, 12 * scale, paddleH);
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(left + state.ballX * scale, top + state.ballY * scale, 2.1 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.ink;
  ctx.font = `300 13px ${theme.monoFont}`;
  ctx.fillText(`${text.score} ${state.score}`, left, top - 34);
  ctx.fillText(`${text.lives} ${state.lives}`, left + boardW - 90, top - 34);
}

export function BreakoutScene({
  language,
  theme,
  difficulty,
  waves,
  bindingLabel,
  resume,
  onSave,
  onResult,
  onPickGame,
  onExit,
}: BreakoutSceneProps): JSX.Element {
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
      module={BREAKOUT_MODULE}
      language={language}
      theme={theme}
      difficulty={difficulty}
      waves={waves}
      testId="breakout-scene"
      debugKey="__neurouBreakout"
      bestKey="neurou.breakout.best"
      overlay={overlay}
      bindingLabel={bindingLabel}
      resume={resume}
      onSave={onSave}
      onResult={onResult}
      onPickGame={onPickGame}
      onExit={onExit}
      commandFor={commandFor}
      draw={(ctx, state, viewport, phase, best, themeTokens) => drawBreakout(ctx, state, viewport, phase, best, language, themeTokens)}
    />
  );
}
