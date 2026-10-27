import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileText, serialize, type WorldIR } from '../src/index.js';

const EXAMPLES = ['core-test.nro', 'rain-slice.nro', 'negotiation.nro', 'tuner.nro'];

function compileExample(file: string): { text: string; ir: WorldIR } {
  const text = readFileSync(resolve('examples', file), 'utf8');
  const result = compileText(text, `examples/${file}`);
  if (!result.ok) {
    throw new Error(
      `${file} 编译失败：\n${result.diagnostics.errors.map((d) => `${d.code} ${d.message}`).join('\n')}`,
    );
  }
  return { text, ir: result.ir };
}

/** 去掉 span / 生成 id 等易变字段，得到可比较的语义结构。 */
function semanticIR(ir: WorldIR): unknown {
  const strings = [...ir.strings]
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      domain: s.domain,
      baseline: s.baseline,
      verge: s.verge,
      safe: s.safe,
      response: s.response,
      owner: s.owner,
      target: s.target,
      note: s.note,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const entities = [...ir.entities]
    .map((e) => ({ id: e.id, name: e.name, typeName: e.typeName, fields: e.fields }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const couplings = [...ir.couplings]
    .map((c) => ({
      from: c.from,
      to: c.to,
      polarity: c.polarity,
      strength: c.strength,
      delay: c.delay,
      curve: c.curve,
      guard: c.guard,
      loop: c.loop,
    }))
    .sort((a, b) => `${a.from}|${a.to}|${a.loop ?? ''}`.localeCompare(`${b.from}|${b.to}|${b.loop ?? ''}`));

  const byId = new Map(ir.couplings.map((c) => [c.id, c]));
  const loops = [...ir.loops]
    .map((l) => ({
      name: l.name,
      polarity: l.polarity,
      edges: l.edges.map((id) => {
        const c = byId.get(id);
        if (!c) throw new Error(`回路边 ${id} 不存在`);
        return { from: c.from, to: c.to, polarity: c.polarity, strength: c.strength, delay: c.delay };
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rules = [...ir.rules]
    .map((r) => ({
      kind: r.kind,
      name: r.name,
      guard: r.guard,
      effects: r.effects,
      irreversible: r.irreversible,
      priority: r.priority,
      before: r.before,
      repeat: r.repeat,
      cooldown: r.cooldown,
      cost: r.cost,
      note: r.note,
    }))
    .sort((a, b) => `${a.kind}|${a.name}`.localeCompare(`${b.kind}|${b.name}`));

  const signals = [...ir.signals]
    .map((s) => ({ name: s.name, guard: s.guard, cues: s.cues }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const axioms = [...ir.axioms]
    .map((a) => ({ name: a.name, expr: a.expr }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const endings = [...ir.endings]
    .map((e) => ({ name: e.name, guard: e.guard }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const phases = ir.phases.map((p) => ({ name: p.name, duration: p.duration }));

  const meta = Object.fromEntries(Object.entries(ir.meta).sort(([a], [b]) => a.localeCompare(b)));

  return { name: ir.name, meta, entities, strings, couplings, loops, rules, axioms, signals, phases, endings };
}

describe('IR → .nro 序列化', () => {
  for (const file of EXAMPLES) {
    it(`${file}：往返编译得到同一张图，且序列化幂等`, () => {
      const { ir } = compileExample(file);
      const text = serialize(ir);
      expect(text).toContain(`世界 ${ir.name}`);

      const again = compileText(text, `serialized/${file}`);
      expect(again.ok).toBe(true);
      expect(again.diagnostics.errors).toHaveLength(0);

      expect(semanticIR(again.ir)).toEqual(semanticIR(ir));
      expect(serialize(again.ir)).toBe(text);
    });
  }

  it('改基线后序列化，再编译确实改到了图（写回的核心）', () => {
    const { ir } = compileExample('tuner.nro');
    const edited: WorldIR = {
      ...ir,
      strings: ir.strings.map((s) => (s.id === '信任' ? { ...s, baseline: 33 } : s)),
    };
    const text = serialize(edited);
    const compiled = compileText(text, 'edited.nro');
    expect(compiled.ok).toBe(true);
    const trust = compiled.ir.strings.find((s) => s.id === '信任');
    expect(trust?.baseline).toBe(33);
  });

  it('改耦合强度后也被正确写出', () => {
    const { ir } = compileExample('tuner.nro');
    const edited: WorldIR = {
      ...ir,
      couplings: ir.couplings.map((c) => (c.from === '信任' && c.to === '色温' ? { ...c, strength: 0.77 } : c)),
    };
    const compiled = compileText(serialize(edited), 'edited.nro');
    expect(compiled.ok).toBe(true);
    const coupling = compiled.ir.couplings.find((c) => c.from === '信任' && c.to === '色温');
    expect(coupling?.strength).toBe(0.77);
  });

  it('空图的序列化不会崩，但编译会按 NRO2009 拒绝（空世界不合法）', () => {
    const base = compileExample('core-test.nro').ir;
    const empty: WorldIR = {
      ...base,
      entities: [],
      strings: [],
      spectra: [],
      couplings: [],
      loops: [],
      rules: [],
      axioms: [],
      signals: [],
      phases: [],
      endings: [],
      stats: { strings: 0, spectra: 0, couplings: 0, loops: 0, rules: 0, signals: 0, endings: 0 },
    };
    const text = serialize(empty);
    expect(text).toContain(`世界 ${base.name}`);
    const compiled = compileText(text, 'empty.nro');
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.errors.some((d) => d.code === 'NRO2009')).toBe(true);
  });
});
