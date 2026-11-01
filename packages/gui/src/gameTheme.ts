/**
 * v1.42：游戏平台统一主题 / HUD 语言。
 * v1.48：真正的深/浅色板，不再依赖画布反相。
 *
 * 新游戏只使用这些 token 与 drawGameChrome，不再各自写一套背景/标题/页脚。
 */
export type GameThemeName = 'dark' | 'light';

export type GameThemePreference = GameThemeName | 'auto';

export function resolveGameTheme(preference: GameThemePreference): GameThemeName {
  if (preference === 'auto') {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }
  return preference;
}

const GAME_THEME_KEY = 'neurou.game.theme';

export function loadGameTheme(): GameThemePreference {
  try {
    const value = window.localStorage.getItem(GAME_THEME_KEY);
    return value === 'light' || value === 'auto' ? value : 'dark';
  } catch {
    return 'dark';
  }
}

export function saveGameTheme(theme: GameThemePreference): void {
  try {
    window.localStorage.setItem(GAME_THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export interface GameTheme {
  name: GameThemeName;
  background: string;
  ink: string;
  dim: string;
  line: string;
  boardFill: string;
  accent: string;
  vignette: string;
  titleFont: string;
  monoFont: string;
}

export const GAME_THEME_DARK: GameTheme = {
  name: 'dark',
  background: '#0a0b0d',
  ink: 'rgba(255,246,230,.92)',
  dim: 'rgba(255,240,220,.3)',
  line: 'rgba(255,236,205,.16)',
  boardFill: 'rgba(255,244,224,.018)',
  accent: 'rgba(255,160,90,.55)',
  vignette: 'rgba(38,32,26,.35)',
  titleFont: '"Microsoft YaHei", system-ui, sans-serif',
  monoFont: 'ui-monospace, monospace',
};

export const GAME_THEME_LIGHT: GameTheme = {
  name: 'light',
  background: '#f3eee4',
  ink: 'rgba(29,27,24,.92)',
  dim: 'rgba(29,27,24,.42)',
  line: 'rgba(29,27,24,.18)',
  boardFill: 'rgba(29,27,24,.035)',
  accent: 'rgba(176,92,32,.65)',
  vignette: 'rgba(190,174,150,.28)',
  titleFont: '"Microsoft YaHei", system-ui, sans-serif',
  monoFont: 'ui-monospace, monospace',
};

export const GAME_THEME = GAME_THEME_DARK;

export function themeFor(name: GameThemeName | undefined): GameTheme {
  return name === 'light' ? GAME_THEME_LIGHT : GAME_THEME_DARK;
}

/** 统一背景 + 暗角。 */
export function paintGameBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: GameTheme = GAME_THEME,
  vignetteColor?: string,
): void {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    10,
    width * 0.5,
    height * 0.48,
    Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, vignetteColor ?? theme.vignette);
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
  wave?: number;
}

/** 统一左上标题、右上/左下 HUD 与底部键位。 */
export function drawGameChrome(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  chrome: GameChrome,
  theme: GameTheme = GAME_THEME,
): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.ink;
  ctx.font = `300 ${Math.max(22, Math.min(36, width * 0.027))}px ${theme.titleFont}`;
  ctx.fillText(chrome.title, 42, 34);
  ctx.fillStyle = theme.dim;
  ctx.font = `300 11px ${theme.monoFont}`;
  ctx.fillText(chrome.subtitle, 44, 80);
  if (chrome.wave && chrome.wave > 0) {
    ctx.fillStyle = theme.accent;
    ctx.font = `300 10px ${theme.monoFont}`;
    ctx.fillText(`WAVE ${chrome.wave}`, width - 110, 44);
  }
  if (chrome.best && chrome.best > 0) {
    ctx.fillStyle = theme.dim;
    ctx.font = `300 10px ${theme.monoFont}`;
    ctx.fillText(`${chrome.bestLabel ?? 'BEST'} ${chrome.best}`, 44, height - 52);
  }
  ctx.fillStyle = theme.dim;
  ctx.font = `300 10px ${theme.monoFont}`;
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
  theme: GameTheme = GAME_THEME,
): void {
  ctx.fillStyle = theme.boardFill;
  ctx.strokeStyle = theme.line;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
}
