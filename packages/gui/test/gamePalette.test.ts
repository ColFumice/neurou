import { describe, expect, it } from 'vitest';
import { accentFor } from '../src/gamePalette.js';

describe('每款游戏独立色板', () => {
  it('四款游戏强调色不同', () => {
    const dark = ['tetris', 'snake', 'pong', 'breakout'].map((id) => accentFor(id, 'dark'));
    expect(new Set(dark).size).toBe(4);
  });

  it('深/浅主题各有一套，未知模块回退', () => {
    expect(accentFor('pong', 'dark')).not.toBe(accentFor('pong', 'light'));
    expect(accentFor('unknown', 'dark')).toContain('rgba');
  });
});
