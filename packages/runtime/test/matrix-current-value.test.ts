import { describe, expect, it } from 'vitest';
import { compileText, type LExpr } from '@neurou/core';
import { evalExpr, Universe } from '../src/index.js';

const WORLD = `世界 当前值

叙事弦 潮位
  类型 数值 0..100
  基线 20

关系谱 潮汐
  行 岸边 深海
  列 岸边 深海
  段 0.2 0.7
  段 0.4 0.1
  曲线 岸边 深海 0.1 0.5 0.9
  周期 10
  速度 1.2
  相位 0.1
`;

const CURRENT = (): LExpr => ({
  k: 'call',
  fn: '当前谱值',
  args: [
    { k: 'const', v: '潮汐' },
    { k: 'const', v: '岸边' },
    { k: 'const', v: '深海' },
  ],
});

const EXPLICIT = (): LExpr => ({
  k: 'call',
  fn: '查关系谱',
  args: [
    { k: 'const', v: '潮汐' },
    { k: 'const', v: '岸边' },
    { k: 'const', v: '深海' },
    { k: 'call', fn: '谱位', args: [{ k: 'const', v: '潮汐' }] },
  ],
});

describe('当前谱值 runtime（v2.13）', () => {
  it('等价于用谱位显式采样', () => {
    const r = compileText(WORLD, 'current-value-runtime.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    for (let i = 0; i < 3; i++) {
      u.tick();
      expect(evalExpr(CURRENT(), u.state)).toBeCloseTo(Number(evalExpr(EXPLICIT(), u.state)), 12);
    }
  });
});
