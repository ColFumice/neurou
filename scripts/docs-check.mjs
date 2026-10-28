// 文档链接检查：README / CHANGELOG / docs/*.md 里的相对链接必须指向存在的文件。
// 外部 http(s)、mailto、纯锚点跳过。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const files = ['README.md', 'CHANGELOG.md'];
for (const name of readdirSync(join(root, 'docs'))) {
  if (name.endsWith('.md')) files.push(join('docs', name));
}

let checked = 0;
const broken = [];
for (const rel of files) {
  const full = join(root, rel);
  const text = readFileSync(full, 'utf8');
  const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = pattern.exec(text))) {
    let target = match[1];
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    checked += 1;
    const resolved = resolve(dirname(full), target);
    if (!existsSync(resolved)) {
      broken.push(`${rel} → ${target}`);
    } else if (statSync(resolved).isDirectory()) {
      broken.push(`${rel} → ${target}（目录，不是文件）`);
    }
  }
}

if (broken.length > 0) {
  console.error(`文档链接检查失败：${broken.length} 条`);
  for (const item of broken) console.error(`  ${item}`);
  process.exitCode = 1;
} else {
  console.log(`文档链接检查通过：${checked} 条相对链接，${files.length} 个文档。`);
}
