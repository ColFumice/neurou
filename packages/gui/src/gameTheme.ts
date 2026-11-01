/**
 * v1.42：游戏平台统一主题 / HUD 语言。
 *
 * 新游戏只使用这些 token 与 drawGameChrome，不再各自写一套背景/标题/页脚。
 */
export type GameThemeName = 'dark' | 'light';

const GAME_THEME_KEY = 'neurou.game.theme';

export function loadGameTheme(): GameThemeName {
  try {
    return window.localStorage.getItem(GAME_THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function saveGameTheme(theme: GameThemeName): void {
  try {
    window.localStorage.setItem(GAME_THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export interface GameTheme {
  background: string;
  ink: string;
  dim: string;
  line: string;
  accent: string;
  titleFont: string;
  monoFont: string;
}

export const GAME_THEME: GameTheme = {
  background: '#0a0b0d',
  ink: 'rgba(255,246,230,.92)',
  dim: 'rgba(255,240,220,.3)',
  line: 'rgba(255,236,205,.16)',
  accent: 'rgba(255,160,90,.55)',
  titleFont: '"Microsoft YaHei", system-ui, sans-serif',
  monoFont: 'ui-monospace, monospace',
};

/** 统一背景 + 暗角。 */
export function paintGameBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vignetteColor = 'rgba(38,32,26,.35)',
): void {
  ctx.fillStyle = GAME_THEME.background;
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    10,
    width * 0.5,
    height * 0.48,
    Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, vignetteColor);
  vignette.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export interface GameChrome {
  title: string;
  subtitle: string;
  keys: string;
  best?: number;
  bestLabel?: string;
}

/** 统一左上标题、右上/左下 HUD 与底部键位。 */
export function drawGameChrome(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  chrome: GameChrome,
): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.fillStyle = GAME_THEME.ink;
  ctx.font = `300 ${Math.max(22, Math.min(36, width * 0.027))}px ${GAME_THEME.titleFont}`;
  ctx.fillText(chrome.title, 42, 34);
  ctx.fillStyle = GAME_THEME.dim;
  ctx.font = `300 11px ${GAME_THEME.monoFont}`;
  ctx.fillText(chrome.subtitle, 44, 80);
  if (chrome.best && chrome.best > 0) {
    ctx.fillStyle = GAME_THEME.dim;
    ctx.font = `300 10px ${GAME_THEME.monoFont}`;
    ctx.fillText(`${chrome.bestLabel ?? 'BEST'} ${chrome.best}`, 44, height - 52);
  }
  ctx.fillStyle = GAME_THEME.dim;
  ctx.font = `300 10px ${GAME_THEME.monoFont}`;
  ctx.fillText(chrome.keys, 44, height - 30);
  ctx.restore();
}

/** 统一网格底板。 */
export function paintGameBoard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = 'rgba(255,244,224,.018)';
  ctx.strokeStyle = GAME_THEME.line;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
}
