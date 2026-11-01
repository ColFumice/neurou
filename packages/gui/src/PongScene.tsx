import type { GameResult } from './gameSdk.js';
import { GameHost, type HostInput, type HostOverlayText, type HostViewport } from './GameHost.js';
import type { Language } from './i18n.js';
import { paintGameBackdrop, paintGameBoard, type GameTheme, type GameThemeName } from './gameTheme.js';
import { PONG_H, PONG_MODULE, PONG_W, type PongCommand, type PongState } from './pongEngine.js';

interface PongSceneProps {
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
    title: '乒乓',
    subtitle: 'PONG · 60Hz',
    start: 'Enter 开始',
    hint: '按 Enter 开始',
    paused: '暂停',
    pausedHint: 'P / Enter 继续',
    over: '结束',
    overHint: 'Enter 重开 · Esc 返回',
    keys: '↑/↓ 或 W/S 移动球拍 · P 暂停 · R 重开 · Esc 返回',
  },
  en: {
    title: 'PONG',
    subtitle: 'PONG · 60Hz',
    start: 'Enter to start',
    hint: 'Press Enter',
    paused: 'Paused',
    pausedHint: 'P / Enter resume',
    over: 'Game Over',
    overHint: 'Enter restart · Esc back',
    keys: '↑/↓ or W/S move · P pause · R restart · Esc back',
  },
} as const;

function commandFor(code: string, repeat: boolean): HostInput<PongCommand> | null {
  if (repeat) return null;
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return { type: 'input', input: 'up' };
    case 'ArrowDown':
    case 'KeyS':
      return { type: 'input', input: 'down' };
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

function drawPong(
  ctx: CanvasRenderingContext2D,
  state: PongState,
  viewport: HostViewport,
  phase: string,
  best: number,
  language: Language,
  theme: GameTheme,
): void {
  const { width, height } = viewport;
  paintGameBackdrop(ctx, width, height, theme);
  const scale = Math.min((width * 0.62) / PONG_W, (height * 0.62) / PONG_H);
  const fieldW = PONG_W * scale;
  const fieldH = PONG_H * scale;
  const left = (width - fieldW) / 2;
  const top = (height - fieldH) / 2;
  const text = TEXT[language];

  paintGameBoard(ctx, left, top, fieldW, fieldH, theme);
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(left + fieldW / 2, top);
  ctx.lineTo(left + fieldW / 2, top + fieldH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const paddleW = 2.4 * scale;
  const paddleH = 14 * scale;
  ctx.fillStyle = theme.ink;
  ctx.fillRect(left + 4 * scale - paddleW / 2, top + state.playerY * scale - paddleH / 2, paddleW, paddleH);
  ctx.fillStyle = 'rgba(143,206,127,.85)';
  ctx.fillRect(left + (PONG_W - 4) * scale - paddleW / 2, top + state.aiY * scale - paddleH / 2, paddleW, paddleH);
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(left + state.ballX * scale, top + state.ballY * scale, 2.4 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.ink;
  ctx.font = '300 28px ui-monospace, monospace';
  ctx.fillText(String(state.playerScore), left + fieldW / 2 - 46, top - 16);
  ctx.fillText(String(state.aiScore), left + fieldW / 2 + 22, top - 16);

  if (phase === 'ready') {
    ctx.fillStyle = theme.dim;
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.start, 44, height - 74);
  }
}

export function PongScene({
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
}: PongSceneProps): JSX.Element {
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
      module={PONG_MODULE}
      language={language}
      theme={theme}
      difficulty={difficulty}
      waves={waves}
      testId="pong-scene"
      debugKey="__neurouPong"
      bestKey="neurou.pong.best"
      overlay={overlay}
      bindingLabel={bindingLabel}
      resume={resume}
      onSave={onSave}
      onResult={onResult}
      onPickGame={onPickGame}
      onExit={onExit}
      commandFor={commandFor}
      draw={(ctx, state, viewport, phase, best, themeTokens) => drawPong(ctx, state, viewport, phase, best, language, themeTokens)}
    />
  );
}
