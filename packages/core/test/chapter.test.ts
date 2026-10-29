import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

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

  it('结局专属下一章优先保留并可序列化', () => {
    const source = WORLD.replace(
      '结局 完: 当 进度 >= 0',
      '结局 完:\n  当 进度 >= 0\n  下一章 "examples/lighthouse.nro"',
    );
    const result = compileText(source, 'chapter-ending-next.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.endings[0]?.nextChapter).toBe('examples/lighthouse.nro');
    const text = serialize(result.ir);
    expect(text).toContain('下一章 "examples/lighthouse.nro"');
    expect(compileText(text, 'chapter-ending-next-roundtrip.nro').ok).toBe(true);
  });

  it('拒绝非法的结局下一章路径', () => {
    const source = WORLD.replace(
      '结局 完: 当 进度 >= 0',
      '结局 完:\n  当 进度 >= 0\n  下一章 "../escape.nro"',
    );
    const result = compileText(source, 'chapter-ending-bad.nro');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.errors.some((e) => e.code === 'NRO2101')).toBe(true);
  });
});
