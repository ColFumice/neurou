/**
 * 生成 / 校验公开游戏插件清单。
 *
 *   pnpm manifest:games         写入 packages/gui/public/games/manifest.json
 *   pnpm check:games            只校验是否与注册表一致
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildGameManifest, validateGameManifest } from '../packages/gui/src/gameManifest.js';

const root = process.cwd();
const target = resolve(root, 'packages/gui/public/games/manifest.json');
const version = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version;
const manifest = buildGameManifest(version);
const validation = validateGameManifest(manifest);
if (!validation.ok) {
  console.error('清单自身校验失败：', validation.errors);
  process.exit(1);
}
const text = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = '';
  }
  if (current !== text) {
    console.error('游戏清单已过期，请运行 pnpm manifest:games。');
    process.exit(1);
  }
  console.log(`游戏清单通过：${manifest.games.length} 个模块（v${version}）。`);
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, text, 'utf8');
console.log(`已写入 ${target}`);
