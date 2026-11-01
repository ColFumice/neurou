/**
 * v1.56：每款游戏独立色板。
 *
 * 全局只决定深/浅主题；每款游戏在此基础上覆盖强调色。
 */
import type { GameThemeName } from './gameTheme.js';

export interface GameAccent {
  dark: string;
  light: string;
}

export const GAME_ACCENTS: Record<string, GameAccent> = {
  tetris: { dark: '#7fd1c9', light: '#0f766e' },
  snake: { dark: '#8fce7f', light: '#2f7d3a' },
  pong: { dark: '#e7c46a', light: '#b7791f' },
  breakout: { dark: '#e8a86c', light: '#b45309' },
  reaction: { dark: '#e79ac7', light: '#a21caf' },
  external: { dark: '#e79ac7', light: '#a21caf' },
};

export function accentFor(moduleId: string, theme: GameThemeName): string {
  return GAME_ACCENTS[moduleId]?.[theme] ?? (theme === 'light' ? 'rgba(176,92,32,.65)' : 'rgba(255,160,90,.55)');
}
