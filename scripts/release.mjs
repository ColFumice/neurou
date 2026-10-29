/**
 * v3.10 发布打包：把 packages/gui/dist 复制为 release/neurou/，
 * 并生成 release.json（版本/构建时间/示例世界清单）与静态托管说明。
 *
 * 运行：pnpm release
 * 产物：release/neurou/（可直接丢到任意静态文件服务器）
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'packages/gui/dist');
const out = join(root, 'release/neurou');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const worlds = readdirSync(join(root, 'examples'))
  .filter((name) => name.endsWith('.nro') && !name.startsWith('_acceptance'))
  .sort()
  .map((name) => `examples/${name}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(dist, out, { recursive: true });
if (existsSync(join(root, 'textures'))) {
  cpSync(join(root, 'textures'), join(out, 'textures'), { recursive: true });
}

const manifest = {
  name: 'neurou',
  version,
  builtAt: new Date().toISOString(),
  entry: 'index.html',
  worlds,
  url: {
    world: '?world=examples%2Ftuner.nro',
    seed: '?seed=7',
  },
  save: 'disabled',
};
writeFileSync(join(out, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(out, 'README.txt'),
  `neurou ${version} 静态发布包

1. 把本目录整个放到任意静态文件服务器（Nginx/对象存储/本地 file server）。
2. 打开 index.html。
3. 世界选择：index.html?world=examples%2Fmoon-tide.nro
4. 复现种子：index.html?seed=42
5. 生产包没有写回接口，所有调律只影响当前运行。

子路径部署：在仓库根目录用 NEUROU_BASE=/your-path/ pnpm release 重新构建。
示例世界：${worlds.join('、')}
`,
);

console.log(`release: ${out}`);
console.log(`version: ${version}`);
console.log(`worlds: ${worlds.length}`);
