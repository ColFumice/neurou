import { describe, expect, it } from 'vitest';
import { compileText, type LExpr } from '@neurou/core';
import { evalExpr, Universe } from '../src/index.js';

const WORLD = `世界 联动

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 源谱
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.4 0.6
  曲线 甲 乙 0 1
  周期 10

关系谱 从谱
  行 丙 丁
  列 丙 丁
  段 0.3 0.5
  段 0.5 0.7
  曲线 丙 丁 0 1
  周期 20
  相位 0.3
  相位源 源谱 甲 乙
`;

const POS = (name: string): LExpr => ({ k: 'call', fn: '谱位', args: [{ k: 'const', v: name }] });

describe('谱位：多矩阵联动（v2.7）', () => {
  it('从谱的相位来自源谱曲线，而不是自己的静态相位', () => {
    const r = compileText(WORLD, 'phase-source-runtime.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = new Universe(r.ir, { seed: 1 });
    const before = evalExpr(POS('从谱'), u.state);
    expect(before).toBeCloseTo(0);
    u.tick();
    const sourcePos = evalExpr(POS('源谱'), u.state);
    const expected = ((((u.state.tick / 20) + sourcePos) % 1) + 1) % 1;
    expect(evalExpr(POS('从谱'), u.state)).toBeCloseTo(expected);
    expect(evalExpr(POS('从谱'), u.state)).not.toBeCloseTo(0.35, 6);
  });
});
