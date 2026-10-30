/**
 * v1.0 Host API 示例（v5.57）
 *
 *   pnpm tsx examples/host-api.ts
 */
import { readFileSync } from 'node:fs';
import { compileText } from '@neurou/core';
import { createEngine } from '@neurou/engine';

const source = readFileSync('examples/tuner.nro', 'utf8');
const compiled = compileText(source, 'examples/tuner.nro');
if (!compiled.ok) {
  for (const diagnostic of compiled.diagnostics.errors) {
    console.error(diagnostic.code, diagnostic.message);
  }
  process.exit(1);
}

const engine = createEngine(compiled.ir, { seed: 1 });
console.log('describe:', JSON.stringify(engine.describe(), null, 2));

for (let i = 0; i < 3; i += 1) {
  const tick = engine.step();
  const frame = engine.observe();
  console.log(`tick ${tick.tick}`, {
    phase: frame.phase,
    scene: frame.scene,
    systems: frame.activeSystems,
    ended: frame.ended,
  });
}

const snapshot = engine.snapshot();
engine.restore(snapshot);
console.log('snapshot restored at tick', engine.tick);
