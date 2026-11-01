/**
 * v1.52：游戏插件清单。
 *
 * 这是给外部工具 / 文档 / 编辑器读取的公开清单；
 * 运行时的 GameModule 仍然由 SDK 内置注册表提供。
 */
import { GAME_MODULES, type GameModuleInfo } from './gameSdk.js';

export const GAME_MANIFEST_SCHEMA = 'neurou.games/1';

export interface GameManifest {
  schema: typeof GAME_MANIFEST_SCHEMA;
  version: string;
  games: GameModuleInfo[];
}

export function buildGameManifest(version = '0.0.0'): GameManifest {
  return {
    schema: GAME_MANIFEST_SCHEMA,
    version,
    games: GAME_MODULES.map((game) => ({
      id: game.id,
      moduleName: game.moduleName,
      title: { ...game.title },
      description: { ...game.description },
      controls: { ...game.controls },
    })),
  };
}

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
  manifest?: GameManifest;
}

function isTextPair(value: unknown): value is { zh: string; en: string } {
  if (!value || typeof value !== 'object') return false;
  const pair = value as { zh?: unknown; en?: unknown };
  return typeof pair.zh === 'string' && pair.zh.length > 0 && typeof pair.en === 'string' && pair.en.length > 0;
}

/** 校验外部传入的清单；不抛异常，返回错误列表。 */
export function validateGameManifest(value: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') {
    return { ok: false, errors: ['清单必须是对象'] };
  }
  const manifest = value as Partial<GameManifest>;
  if (manifest.schema !== GAME_MANIFEST_SCHEMA) {
    errors.push(`schema 必须是 ${GAME_MANIFEST_SCHEMA}`);
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    errors.push('version 必须是非空字符串');
  }
  if (!Array.isArray(manifest.games) || manifest.games.length === 0) {
    errors.push('games 必须是非空数组');
  } else {
    const ids = new Set<string>();
    const modules = new Set<string>();
    manifest.games.forEach((game, index) => {
      if (!game || typeof game !== 'object') {
        errors.push(`games[${index}] 必须是对象`);
        return;
      }
      if (typeof game.id !== 'string' || game.id.length === 0) errors.push(`games[${index}].id 必须是非空字符串`);
      else if (ids.has(game.id)) errors.push(`games[${index}].id 重复：${game.id}`);
      else ids.add(game.id);
      if (typeof game.moduleName !== 'string' || game.moduleName.length === 0) {
        errors.push(`games[${index}].moduleName 必须是非空字符串`);
      } else if (modules.has(game.moduleName)) {
        errors.push(`games[${index}].moduleName 重复：${game.moduleName}`);
      } else {
        modules.add(game.moduleName);
      }
      if (!isTextPair(game.title)) errors.push(`games[${index}].title 需要 zh/en`);
      if (!isTextPair(game.description)) errors.push(`games[${index}].description 需要 zh/en`);
      if (!isTextPair(game.controls)) errors.push(`games[${index}].controls 需要 zh/en`);
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], manifest: manifest as GameManifest };
}
