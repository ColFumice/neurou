import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { Universe } from '../src/index.js';

const BASE = `世界 动态强度

叙事弦 甲
  类型 数值 0..100
  基线 50

叙事弦 乙
  类型 数值 0..100
  基线 50
`;

function run(coupling: string): number {
  const r = compileText(BASE + coupling, 'dynamic-coupling.nro');
  if (!r.ok) throw new Error('compile failed');
  const u = new Universe(r.ir, { seed: 1 });
  u.inject('甲', 70);
  u.tick();
  return u.number('乙');
}

describe('耦合：运行期强度表达式（v2.5）', () => {
  it('表达式强度参与传导（与同值静态强度一致）', () => {
    expect(run('耦合 甲 → 乙 同向 0.5\n')).toBeCloseTo(60);
    expect(run('耦合 甲 → 乙 同向 0.5 + 此刻 * 0\n')).toBeCloseTo(60);
  });

  it('表达式延迟与同值静态延迟一致（v2.11）', () => {
    const dynamic = compileText(BASE + '耦合 甲 → 乙 同向 1.0 延迟 2 + 此刻 * 0\n', 'dynamic-delay-runtime.nro');
    if (!dynamic.ok) throw new Error('compile failed');
    const u = new Universe(dynamic.ir, { seed: 1 });
    u.inject('甲', 70);
    u.tick();
    expect(u.number('乙')).toBe(50);
    u.tick();
    expect(u.number('乙')).toBe(50);
    u.tick();
    expect(u.number('乙')).toBeCloseTo(70);
  });
});
