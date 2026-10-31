import type { GameResult } from './gameSdk.js';
import { TETRIS_MODULE, type TetrisModuleState } from './gameSdk.js';
import { GameHost, type HostInput, type HostOverlayText, type HostViewport } from './GameHost.js';
import type { Language } from './i18n.js';
import { paintGameBackdrop } from './gameTheme.js';
import {
  BOARD_H,
  BOARD_W,
  PIECE_KINDS,
  shapeFor,
  type PieceKind,
  type TetrisAction,
} from './tetrisEngine.js';
import './tetris.css';

interface TetrisSceneProps {
  language: Language;
  difficulty?: number;
  bindingLabel?: string;
  resume?: unknown;
  onSave?: (data: unknown | null) => void;
  onResult?: (result: GameResult) => void;
  onPickGame?: () => void;
  onExit: () => void;
}

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
    hint: '按 Enter 开始',
    paused: '暂停',
    pausedHint: 'P / Enter 继续',
    over: '结束',
    overHint: 'Enter 重开 · Esc 返回',
    keys: '← → 移动 · ↑ 旋转 · ↓ 软降 · Space 硬降 · P 暂停 · Esc 返回',
    score: '得分',
    lines: '消行',
    level: '等级',
    next: '下一个',
    best: '最高分',
  },
  en: {
    title: 'TETRIS',
    subtitle: 'BLOCKS · 60Hz',
    start: 'Enter to start',
    hint: 'Press Enter',
    paused: 'Paused',
    pausedHint: 'P / Enter resume',
    over: 'Game Over',
    overHint: 'Enter restart · Esc back',
    keys: '← → move · ↑ rotate · ↓ soft · Space hard · P pause · Esc back',
    score: 'Score',
    lines: 'Lines',
    level: 'Level',
    next: 'Next',
    best: 'Best',
  },
} as const;

function commandFor(code: string, repeat: boolean): HostInput<TetrisAction> | null {
  switch (code) {
    case 'ArrowLeft':
    case 'KeyA':
      return repeat ? null : { type: 'input', input: 'left' };
    case 'ArrowRight':
    case 'KeyD':
      return repeat ? null : { type: 'input', input: 'right' };
    case 'ArrowUp':
    case 'KeyW':
    case 'KeyX':
      return repeat ? null : { type: 'input', input: 'rotateCW' };
    case 'KeyZ':
    case 'ControlLeft':
      return repeat ? null : { type: 'input', input: 'rotateCCW' };
    case 'ArrowDown':
    case 'KeyS':
      return { type: 'input', input: 'softDrop' };
    case 'Space':
      return repeat ? null : { type: 'input', input: 'hardDrop' };
    case 'KeyP':
      return repeat ? null : { type: 'pause' };
    case 'KeyR':
      return repeat ? null : { type: 'restart' };
    case 'Escape':
      return repeat ? null : { type: 'exit' };
    case 'Enter':
    case 'NumpadEnter':
      return repeat ? null : { type: 'confirm' };
    default:
      return null;
  }
}

function drawTetris(
  ctx: CanvasRenderingContext2D,
  state: TetrisModuleState,
  viewport: HostViewport,
  _phase: string,
  best: number,
  language: Language,
): void {
  const { width, height } = viewport;
  const text = TEXT[language];
  const engine = state.engine;
  const snapshot = engine.snapshot;
  ctx.clearRect(0, 0, width, height);
  paintGameBackdrop(ctx, width, height);

  const boardW = Math.min(width * 0.34, height * 0.62, 360);
  const cell = boardW / BOARD_W;
  const boardX = (width - boardW) / 2;
  const boardY = Math.max(110, (height - cell * BOARD_H) / 2);
  const boardH = cell * BOARD_H;
  ctx.fillStyle = 'rgba(255,244,224,.018)';
  ctx.strokeStyle = 'rgba(255,236,205,.16)';
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

  const drawCell = (cx: number, cy: number, kind: PieceKind, ghost = false): void => {
    const color = PIECE_COLORS[kind];
    const x = boardX + cx * cell;
    const y = boardY + cy * cell;
    const pad = Math.max(1, cell * 0.08);
    if (ghost) {
      ctx.strokeStyle = 'rgba(255,240,220,.28)';
      ctx.setLineDash([Math.max(2, cell * 0.12), Math.max(2, cell * 0.12)]);
      ctx.strokeRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
      ctx.setLineDash([]);
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
    ctx.shadowBlur = 0;
  };

  for (let y = 0; y < BOARD_H; y += 1) {
    for (let x = 0; x < BOARD_W; x += 1) {
      const value = snapshot.board[y]![x] ?? 0;
      if (value) drawCell(x, y, PIECE_KINDS[value - 1]!);
    }
  }
  const active = snapshot.active;
  if (active) {
    const shape = shapeFor(active.kind, active.rotation);
    let ghost = active.y;
    while (!engine.collides({ ...active, y: ghost + 1 })) ghost += 1;
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

  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,246,230,.92)';
  ctx.font = `300 ${Math.max(22, Math.min(38, width * 0.028))}px "Microsoft YaHei", system-ui, sans-serif`;
  ctx.fillText(text.title, 42, 34);
  ctx.fillStyle = 'rgba(255,240,220,.32)';
  ctx.font = '300 11px ui-monospace, monospace';
  ctx.fillText(text.subtitle, 44, 82);
  const hudX = Math.max(42, boardX - 170);
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
    for (let y = 0; y < shape.length; y += 1) {
      for (let x = 0; x < shape.length; x += 1) {
        if (!shape[y]![x]) continue;
        ctx.fillStyle = PIECE_COLORS[kind].fill;
        ctx.globalAlpha = 0.82;
        ctx.fillRect(nextX + x * size, boardY + 34 + index * size * 4.4 + y * size, size - 2, size - 2);
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
}

export function TetrisScene({
  language,
  difficulty,
  bindingLabel,
  resume,
  onSave,
  onResult,
  onPickGame,
  onExit,
}: TetrisSceneProps): JSX.Element {
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
      module={TETRIS_MODULE}
      language={language}
      difficulty={difficulty}
      testId="tetris-scene"
      debugKey="__neurouTetris"
      bestKey={BEST_KEY}
      overlay={overlay}
      bindingLabel={bindingLabel}
      resume={resume}
      onSave={onSave}
      onResult={onResult}
      onPickGame={onPickGame}
      onExit={onExit}
      commandFor={commandFor}
      draw={(ctx, state, viewport, phase, best) => drawTetris(ctx, state, viewport, phase, best, language)}
      debugSnapshot={(state) => state.engine.snapshot}
    />
  );
}
