import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { createEngine } from '../src/index.js';

const SOURCE = readFileSync('examples/vertical-story.nro', 'utf8');

function playToEnd(values: Record<string, number | string>): { ending: string; ticks: number; scene?: string } {
  const compiled = compileText(SOURCE, 'vertical-story.nro');
  if (!compiled.ok) throw new Error('compile failed');
  const engine = createEngine(compiled.ir, { seed: 3 });
  for (const [id, value] of Object.entries(values)) engine.inject(id, value);
  let ticks = 0;
  while (!engine.ended && ticks < 10) {
    engine.step();
    ticks += 1;
  }
  const frame = engine.observe();
  return { ending: frame.ended?.name ?? '', ticks, scene: frame.scene };
}

describe('垂直故事两条路线（v6.14）', () => {
  it('安顿路线：高信任走到安顿', () => {
    const result = playToEnd({ 信任: 90, 恐惧: 0.1, 色温: 60 });
    expect(result.ending).toBe('安顿');
    expect(result.ticks).toBeGreaterThan(0);
    expect(result.scene).toBe('夜');
  });

  it('疏离路线：低信任/高恐惧走到疏离', () => {
    const result = playToEnd({ 信任: 5, 恐惧: 0.9, 知情: 80 });
    expect(result.ending).toBe('疏离');
    expect(result.ticks).toBeGreaterThan(0);
  });

  it('结构与内容资产完整', () => {
    const compiled = compileText(SOURCE, 'vertical-story.nro');
    if (!compiled.ok) throw new Error('compile failed');
    expect(compiled.ir.strings).toHaveLength(8);
    expect(compiled.ir.endings.map((ending) => ending.name)).toEqual(['安顿', '疏离']);
    expect(compiled.ir.scenes?.map((scene) => scene.name)).toEqual(['夜', '昼']);
    expect(compiled.ir.audioAssets).toHaveLength(2);
    expect(compiled.ir.ports).toHaveLength(2);
  });
});
