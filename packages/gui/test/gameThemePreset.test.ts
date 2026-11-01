import { describe, expect, it } from 'vitest';
import { GAME_THEME_DARK, GAME_THEME_LIGHT } from '../src/gameTheme.js';
import { GAME_THEME_PRESETS, applyGameThemePreset } from '../src/gameThemePreset.js';

describe('游戏主题预设', () => {
  it('默认预设不改变基础色板', () => {
    expect(applyGameThemePreset(GAME_THEME_DARK, 'default')).toEqual(GAME_THEME_DARK);
    expect(applyGameThemePreset(GAME_THEME_LIGHT, 'default')).toEqual(GAME_THEME_LIGHT);
  });

  it('极光/余烬/单色产生不同背景，深浅各一套', () => {
    const backgrounds = GAME_THEME_PRESETS.filter((preset) => preset.id !== 'default').map(
      (preset) => applyGameThemePreset(GAME_THEME_DARK, preset.id).background,
    );
    expect(new Set(backgrounds).size).toBe(3);
    expect(applyGameThemePreset(GAME_THEME_LIGHT, 'aurora').background).not.toBe(
      applyGameThemePreset(GAME_THEME_DARK, 'aurora').background,
    );
  });
});
