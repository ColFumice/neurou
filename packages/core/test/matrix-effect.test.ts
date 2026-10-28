import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 矩阵写

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 网
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.5 0.7

力迫 推
  效果
    关系谱 网 甲 乙 += 0.3

结局 成: 当 查关系谱("网", "甲", "乙") >= 0.7
`;

describe('效果写关系谱（v2.17）', () => {
  it('解析/序列化矩阵效果，并阻止查表折叠', () => {
    const r = compileText(WORLD, 'matrix-effect.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const effect = r.ir.rules[0]?.effects[0];
    expect(effect && 'matrix' in effect && effect.matrix).toBe('网');
    const text = serialize(r.ir);
    expect(text).toContain('关系谱 网 甲 乙 += 0.3');
    expect(r.ir.endings[0]?.guard.k).not.toBe('const');
  });
});
