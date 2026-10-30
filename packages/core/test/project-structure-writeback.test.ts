import { describe, expect, it } from 'vitest';
import {
  compileProjectFromFiles,
  patchWorldText,
  projectEntryView,
  type ProjectSources,
} from '../src/index.js';

const ENTRY = `引入 "mod.nro"

# 入口注释
世界 入口结构写回
  版本 0.1

叙事弦 甲
  类型 数值 0..100
  基线 20

叙事弦 乙
  类型 数值 0..100
  基线 40

谱 地形
  段 0.1 0.2 0.3
  范围 0..100

耦合 甲 → 乙 同向 0.3
`;
const MODULE = `命名空间 雨
  导出 量

  叙事弦 量
    类型 数值 0..100
    基线 40
`;

const files: ProjectSources = { 'examples/entry.nro': ENTRY, 'examples/mod.nro': MODULE };

describe('入口非弦结构写回（v6.0）', () => {
  it('入口视图只保留入口声明并重基 span', () => {
    const compiled = compileProjectFromFiles('examples/entry.nro', files);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(typeof compiled.entryOffset).toBe('number');
    const view = projectEntryView(compiled.ir, compiled.entryOffset!, ENTRY.length);
    expect(view.strings.map((s) => s.id)).toEqual(['甲', '乙']);
    expect(view.spectra.map((s) => s.name)).toEqual(['地形']);
    expect(view.couplings).toHaveLength(1);
    expect(view.strings.every((s) => (s.span?.start.offset ?? 0) < ENTRY.length)).toBe(true);
  });

  it('谱段点与耦合强度可行级写回并保留注释', () => {
    const compiled = compileProjectFromFiles('examples/entry.nro', files);
    if (!compiled.ok) throw new Error('compile failed');
    const baseView = projectEntryView(compiled.ir, compiled.entryOffset!, ENTRY.length);
    const candidate = compiled.ir;
    const edited = {
      ...baseView,
      spectra: baseView.spectra.map((s) => ({ ...s, bands: [0.9, 0.2, 0.3] })),
      couplings: baseView.couplings.map((c) => ({ ...c, strength: 0.9 })),
    };
    const patch = patchWorldText(ENTRY, baseView, edited);
    expect(patch.ok).toBe(true);
    if (!patch.ok) return;
    expect(patch.text).toContain('# 入口注释');
    expect(patch.text).toContain('引入 "mod.nro"');
    expect(patch.text).not.toContain('命名空间 雨');
    expect(patch.text).toContain('0.9');

    const next = compileProjectFromFiles('examples/entry.nro', { ...files, 'examples/entry.nro': patch.text });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ir.spectra.find((s) => s.name === '地形')?.bands[0]).toBeCloseTo(0.9, 5);
    expect(next.ir.couplings[0]?.strength).toBeCloseTo(0.9, 5);
  });
});
