import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GAME_MANIFEST_SCHEMA,
  buildGameManifest,
  validateGameManifest,
} from '../src/gameManifest.js';

const root = resolve(process.cwd());
const version = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version;

describe('游戏插件清单', () => {
  it('从注册表生成四款游戏', () => {
    const manifest = buildGameManifest('1.2.3');
    expect(manifest.schema).toBe(GAME_MANIFEST_SCHEMA);
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.games.map((game) => game.moduleName)).toEqual(['俄罗斯方块', '贪吃蛇', '乒乓', '打砖块']);
  });

  it('校验生成的清单', () => {
    const validation = validateGameManifest(buildGameManifest('1.2.3'));
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('拒绝错误 schema / 重复模块 / 缺字段', () => {
    expect(validateGameManifest(null).ok).toBe(false);
    expect(validateGameManifest({ schema: 'x', version: '1', games: [] }).ok).toBe(false);
    const manifest = buildGameManifest('1.2.3');
    const duplicated = { ...manifest, games: [manifest.games[0], manifest.games[0]] };
    expect(validateGameManifest(duplicated).errors.some((error) => error.includes('重复'))).toBe(true);
    const missing = { ...manifest, games: [{ id: 'x' }] };
    expect(validateGameManifest(missing).ok).toBe(false);
  });

  it('公开文件与注册表同步', () => {
    const file = readFileSync(resolve(root, 'packages/gui/public/games/manifest.json'), 'utf8');
    expect(JSON.parse(file)).toEqual(buildGameManifest(version));
  });
});
