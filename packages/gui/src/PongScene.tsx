import type { GameResult } from './gameSdk.js';
import { GameHost, type HostInput, type HostOverlayText, type HostViewport } from './GameHost.js';
import type { Language } from './i18n.js';
import { drawGameChrome, paintGameBackdrop, paintGameBoard } from './gameTheme.js';
import { PONG_H, PONG_MODULE, PONG_W, type PongCommand, type PongState } from './pongEngine.js';

interface PongSceneProps {
  language: Language;
  difficulty?: number;
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
): void {
  const { width, height } = viewport;
  paintGameBackdrop(ctx, width, height, 'rgba(34,40,32,.4)');
  const scale = Math.min((width * 0.62) / PONG_W, (height * 0.62) / PONG_H);
  const fieldW = PONG_W * scale;
  const fieldH = PONG_H * scale;
  const left = (width - fieldW) / 2;
  const top = (height - fieldH) / 2;
  const text = TEXT[language];

  paintGameBoard(ctx, left, top, fieldW, fieldH);
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(255,236,205,.13)';
  ctx.beginPath();
  ctx.moveTo(left + fieldW / 2, top);
  ctx.lineTo(left + fieldW / 2, top + fieldH);
  ctx.stroke();
  ctx.setLineDash([]);

  const paddleW = 2.4 * scale;
  const paddleH = 14 * scale;
  ctx.fillStyle = 'rgba(236,248,232,.92)';
  ctx.fillRect(left + 4 * scale - paddleW / 2, top + state.playerY * scale - paddleH / 2, paddleW, paddleH);
  ctx.fillStyle = 'rgba(143,206,127,.85)';
  ctx.fillRect(left + (PONG_W - 4) * scale - paddleW / 2, top + state.aiY * scale - paddleH / 2, paddleW, paddleH);
  ctx.fillStyle = '#e7c46a';
  ctx.beginPath();
  ctx.arc(left + state.ballX * scale, top + state.ballY * scale, 2.4 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,246,230,.9)';
  ctx.font = '300 28px ui-monospace, monospace';
  ctx.fillText(String(state.playerScore), left + fieldW / 2 - 46, top - 16);
  ctx.fillText(String(state.aiScore), left + fieldW / 2 + 22, top - 16);

  if (phase === 'ready') {
    ctx.fillStyle = 'rgba(255,240,220,.35)';
    ctx.font = '300 11px ui-monospace, monospace';
    ctx.fillText(text.start, 44, height - 74);
  }
}

export function PongScene({
  language,
  difficulty,
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
      difficulty={difficulty}
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
      draw={(ctx, state, viewport, phase, best) => drawPong(ctx, state, viewport, phase, best, language)}
    />
  );
}
