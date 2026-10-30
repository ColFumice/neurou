import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { createEngine, HOST_ABI } from '../src/index.js';

const SOURCE = readFileSync('examples/vertical-slice.nro', 'utf8');

describe('垂直切片全链路（v6.2）', () => {
  it('编译出完整世界结构', () => {
    const compiled = compileText(SOURCE, 'vertical-slice.nro');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const ir = compiled.ir;
    expect(ir.strings).toHaveLength(8);
    expect(ir.spectra.map((s) => s.name)).toContain('长音');
    expect(ir.matrices.map((m) => m.name)).toContain('信任网');
    expect(ir.ports).toHaveLength(2);
    expect(ir.audioAssets).toHaveLength(1);
    expect(ir.textureAssets).toHaveLength(2);
    expect(ir.scenes?.map((s) => s.name)).toEqual(['夜', '昼']);
    expect(ir.systems?.map((s) => s.name)).toEqual(['潮汐']);
  });

  it('Engine 可驱动到结局并输出 Host 快照', () => {
    const compiled = compileText(SOURCE, 'vertical-slice.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const engine = createEngine(compiled.ir, { seed: 1 });
    const description = engine.describe();
    expect(description.abi).toBe(HOST_ABI);
    expect(description.ports.map((port) => port.kind)).toEqual(['视觉', '音频']);
    engine.inject('信任', 90);
    for (let i = 0; i < 6 && !engine.ended; i += 1) engine.step();
    expect(engine.ended).toBe(true);
    const frame = engine.observe();
    expect(frame.ended?.name).toBe('安顿');
    const snapshot = engine.toHostSnapshot();
    expect(snapshot.abi).toBe(HOST_ABI);
    expect(snapshot.values['信任']).toBeGreaterThanOrEqual(80);
  });
});
