import { describe, expect, it } from 'vitest';
import {
  GAME_MODULES,
  GameSession,
  TETRIS_MODULE,
  gameModuleForName,
  selectGameForFocus,
} from '../src/gameSdk.js';
import type { IRGame } from '@neurou/core';

const game = (name: string, resultString: string, id?: string): IRGame => ({
  name,
  module: '俄罗斯方块',
  resultString,
  ...(id ? { resultStringId: id } : {}),
  winScore: 100,
});

describe('Game SDK', () => {
  it('GameSession 统一开始/输入/推进/结果', () => {
    const session = new GameSession(TETRIS_MODULE, 7);
    expect(session.isStarted).toBe(false);
    expect(session.finish('exit')).toBeNull();
    session.start(7);
    session.input('hardDrop');
    const steps = session.advance(16.7);
    expect(steps).toBeGreaterThan(0);
    const result = session.finish('exit');
    expect(result?.score).toBeGreaterThan(0);
    expect(session.finish('over')).toBeNull();
  });

  it('会话存档/恢复保留状态，不匹配模块拒绝', () => {
    const session = new GameSession(TETRIS_MODULE, 21);
    session.start(21);
    session.input('hardDrop');
    session.advance(16.7);
    const save = session.save();
    expect(save).not.toBeNull();
    const next = new GameSession(TETRIS_MODULE, 1);
    expect(next.restore(save)).toBe(true);
    expect(next.state.engine.snapshot).toEqual(session.state.engine.snapshot);
    expect(next.restore({ ...(save as object), moduleId: 'other' })).toBe(false);
    expect(session.finish('over')).not.toBeNull();
  });

  it('暂停时不推进，快照包含暂停与队列', () => {
    const session = new GameSession(TETRIS_MODULE, 7);
    session.start(7);
    session.pause();
    expect(session.advance(100)).toBe(0);
    const snap = session.snapshot();
    expect(snap.paused).toBe(true);
    session.resume();
    expect(session.advance(100)).toBeGreaterThan(0);
  });

  it('模块注册表按名字/ID 查询', () => {
    expect(GAME_MODULES).toHaveLength(4);
    expect(gameModuleForName('俄罗斯方块')?.id).toBe('tetris');
    expect(gameModuleForName('tetris')?.moduleName).toBe('俄罗斯方块');
    expect(gameModuleForName('不存在')).toBeUndefined();
  });

  it('多游戏按结果弦精确匹配，其次回退第一个', () => {
    const games = [game('A', '信任'), game('B', '色温', '色温')];
    expect(selectGameForFocus(games, { id: '色温', name: '色温', kind: '视觉' })?.name).toBe('B');
    expect(selectGameForFocus(games, { id: '信任', name: '信任', kind: '叙事' })?.name).toBe('A');
    expect(selectGameForFocus(games, { id: '其他', name: '其他', kind: '物理' })?.name).toBe('A');
    expect(selectGameForFocus(undefined, { id: 'x', name: 'x', kind: '叙事' })).toBeUndefined();
  });
});
