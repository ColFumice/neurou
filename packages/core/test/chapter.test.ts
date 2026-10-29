import { describe, expect, it } from 'vitest';
import { compileText } from '../src/index.js';

const WORLD = `世界 章节测试
  版本 0.1
  章节 "第一夜"
  下一章 "examples/harbor.nro"
  上一章 "examples/tuner.nro"

叙事弦 进度
  类型 数值 0..100
  基线 10

结局 完: 当 进度 >= 0
`;

describe('章节/下一章元数据（v4.0）', () => {
  it('保留在 IR.meta 中', () => {
    const result = compileText(WORLD, 'chapter.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.meta['章节']).toBe('第一夜');
    expect(result.ir.meta['下一章']).toBe('examples/harbor.nro');
    expect(result.ir.meta['上一章']).toBe('examples/tuner.nro');
  });
});
