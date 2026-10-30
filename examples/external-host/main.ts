/**
 * 外部 Host 示例（v6.1）
 *
 * 用法（仓库根目录）：
 *   pnpm tsx examples/external-host/main.ts
 *
 * 这个文件只依赖 @neurou/core / @neurou/engine，不读 GUI 内部状态。
 */
import { readFileSync } from 'node:fs';
import { compileText } from '@neurou/core';
import { createEngine } from '@neurou/engine';

const file = 'examples/tuner.nro';
const compiled = compileText(readFileSync(file, 'utf8'), file);
if (!compiled.ok) {
  for (const diagnostic of compiled.diagnostics.errors) {
    console.error(diagnostic.code, diagnostic.message);
  }
  process.exit(1);
}

const engine = createEngine(compiled.ir, { seed: 7 });
const before = engine.toHostSnapshot();
engine.inject('视觉.色温', 42);
engine.step();
const after = engine.toHostSnapshot();

console.log(
  JSON.stringify(
    {
      abi: after.abi,
      world: after.description.name,
      version: after.description.version,
      frames: [
        { tick: before.description.tick, values: before.values },
        { tick: after.description.tick, values: after.values },
      ],
      scenes: after.description.scenes,
      ports: after.description.ports,
    },
    null,
    2,
  ),
);
