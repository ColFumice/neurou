/**
 * 外部 Host SDK 示例（v6.20）
 *
 * 用法（仓库根目录）：
 *   pnpm tsx examples/external-host/main.ts
 *
 * 只依赖 @neurou/core / @neurou/engine，不读 GUI 内部状态。
 */
import { readFileSync } from 'node:fs';
import { createExternalHost } from './sdk.js';

const file = 'examples/tuner.nro';
const host = createExternalHost(readFileSync(file, 'utf8'), file, { seed: 7 });
const before = host.snapshot();
host.inject('色温', 42);
host.step();
const after = host.snapshot();
const restored = createExternalHost(readFileSync(file, 'utf8'), file, { seed: 99 });
const restoredOk = restored.restore(after);

console.log(
  JSON.stringify(
    {
      abi: after.abi,
      world: after.description.name,
      version: after.description.version,
      ports: after.description.ports,
      scenes: after.description.scenes,
      before: { tick: before.description.tick, values: before.values },
      after: { tick: after.description.tick, values: after.values },
      restored: { ok: restoredOk, tick: restored.snapshot().description.tick, color: restored.engine.get('色温') },
    },
    null,
    2,
  ),
);
