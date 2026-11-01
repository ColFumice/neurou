/**
 * v1.57：游戏主题预设。
 *
 * 预设只覆盖基础色；每款游戏的 accent 仍由 gamePalette 决定。
 */
import type { GameTheme, GameThemeName } from './gameTheme.js';

export type GameThemePresetName = 'default' | 'aurora' | 'ember' | 'mono';

export interface GameThemePreset {
  id: GameThemePresetName;
  label: { zh: string; en: string };
  dark?: Partial<GameTheme>;
  light?: Partial<GameTheme>;
}

export const GAME_THEME_PRESETS: readonly GameThemePreset[] = [
  { id: 'default', label: { zh: '默认', en: 'Default' } },
  {
    id: 'aurora',
    label: { zh: '极光', en: 'Aurora' },
    dark: {
      background: '#07151a',
      ink: 'rgba(224,248,242,.92)',
      dim: 'rgba(210,245,235,.34)',
      line: 'rgba(140,230,210,.18)',
      boardFill: 'rgba(120,240,220,.03)',
      vignette: 'rgba(20,80,90,.38)',
    },
    light: {
      background: '#eef8f4',
      ink: 'rgba(16,42,38,.92)',
      dim: 'rgba(16,42,38,.42)',
      line: 'rgba(16,90,80,.18)',
      boardFill: 'rgba(16,90,80,.035)',
      vignette: 'rgba(120,190,175,.3)',
    },
  },
  {
    id: 'ember',
    label: { zh: '余烬', en: 'Ember' },
    dark: {
      background: '#170f0b',
      ink: 'rgba(255,235,220,.92)',
      dim: 'rgba(255,220,200,.32)',
      line: 'rgba(255,180,120,.18)',
      boardFill: 'rgba(255,180,120,.03)',
      vignette: 'rgba(90,40,20,.4)',
    },
    light: {
      background: '#fbf0e6',
      ink: 'rgba(48,26,16,.92)',
      dim: 'rgba(48,26,16,.42)',
      line: 'rgba(120,60,30,.18)',
      boardFill: 'rgba(120,60,30,.035)',
      vignette: 'rgba(210,160,120,.32)',
    },
  },
  {
    id: 'mono',
    label: { zh: '单色', en: 'Mono' },
    dark: {
      background: '#0b0b0b',
      ink: 'rgba(235,235,235,.92)',
      dim: 'rgba(220,220,220,.3)',
      line: 'rgba(220,220,220,.14)',
      boardFill: 'rgba(220,220,220,.025)',
      vignette: 'rgba(60,60,60,.35)',
    },
    light: {
      background: '#f2f2f2',
      ink: 'rgba(24,24,24,.92)',
      dim: 'rgba(24,24,24,.4)',
      line: 'rgba(24,24,24,.16)',
      boardFill: 'rgba(24,24,24,.03)',
      vignette: 'rgba(160,160,160,.28)',
    },
  },
];

const PRESET_KEY = 'neurou.game.preset';

export function loadGameThemePreset(): GameThemePresetName {
  try {
    const value = window.localStorage.getItem(PRESET_KEY);
    return GAME_THEME_PRESETS.some((preset) => preset.id === value) ? (value as GameThemePresetName) : 'default';
  } catch {
    return 'default';
  }
}

export function saveGameThemePreset(preset: GameThemePresetName): void {
  try {
    window.localStorage.setItem(PRESET_KEY, preset);
  } catch {
    /* ignore */
  }
}

export function applyGameThemePreset(base: GameTheme, presetName: GameThemePresetName): GameTheme {
  const preset = GAME_THEME_PRESETS.find((item) => item.id === presetName);
  const overrides = preset?.[base.name as GameThemeName];
  return overrides ? { ...base, ...overrides } : base;
}
