import { describe, expect, it } from 'vitest';
import { compileProjectFromFiles, compileText, serialize } from '../src/index.js';

const WORLD = `世界 命名空间测试
  版本 0.1

命名空间 天气
  叙事弦 雨量
    类型 数值 0..100
    基线 40

结局 停: 当 天气.雨量 >= 100
`;

describe('字符串命名空间（v5.11）', () => {
  it('限定弦 id、保留 namespace 并可序列化', () => {
    const result = compileText(WORLD, 'namespace.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.strings[0]?.id).toBe('天气.雨量');
    expect(result.ir.strings[0]?.namespace).toBe('天气');
    const text = serialize(result.ir);
    expect(text).toContain('命名空间 天气');
    expect(text).toContain('叙事弦 雨量');
    expect(compileText(text, 'namespace-roundtrip.nro').ok).toBe(true);
  });

  it('模块里的命名空间与入口的限定引用可组合', () => {
    const result = compileProjectFromFiles('examples/entry.nro', {
      'examples/entry.nro': `引入 "lib/weather.nro"\n\n世界 模块命名空间\n  版本 0.1\n\n结局 停: 当 天气.雨量 >= 100\n`,
      'examples/lib/weather.nro': `命名空间 天气\n  叙事弦 雨量\n    类型 数值 0..100\n    基线 40\n`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.strings.map((string) => string.id)).toEqual(['天气.雨量']);
  });

  it('命名空间内拒绝非弦声明', () => {
    const bad = WORLD.replace('  叙事弦 雨量', '  实体 雨\n  叙事弦 雨量');
    const result = compileText(bad, 'namespace-bad.nro');
    expect(result.ok).toBe(false);
  });
});
