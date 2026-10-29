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

  it('v5.12：实体也可进入命名空间', () => {
    const source = WORLD.replace(
      '  叙事弦 雨量',
      '  实体 云\n    叙事弦 密度\n      类型 数值 0..100\n      基线 10\n  叙事弦 雨量',
    );
    const result = compileText(source, 'namespace-entity.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.strings.map((string) => string.id)).toContain('天气.云.密度');
  });

  it('v5.12：规则/系统/场景也可进入命名空间', () => {
    const source = `世界 全命名空间
  版本 0.1

命名空间 天气
  叙事弦 雨量
    类型 数值 0..100
    基线 40

  系统 潮汐
    阶段 传导
    效果
      天气.雨量 += 1

  场景 夜
    启用 系统 潮汐

  力迫 久旱
    当 天气.雨量 < 20
    效果
      天气.雨量 += 5

结局 停: 当 天气.雨量 >= 100
`;
    const result = compileText(source, 'namespace-full.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.systems?.[0]?.name).toBe('天气.潮汐');
    expect(result.ir.scenes?.[0]?.systems).toEqual(['天气.潮汐']);
    expect(result.ir.rules.find((rule) => rule.kind === 'forcing')?.name).toBe('天气.久旱');
    const text = serialize(result.ir);
    expect(compileText(text, 'namespace-full-roundtrip.nro').ok).toBe(true);
  });

  it('命名空间内拒绝世界与嵌套命名空间', () => {
    const bad = `世界 外层
  版本 0.1

命名空间 天气
  世界 内层
`;
    expect(compileText(bad, 'namespace-world.nro').ok).toBe(false);
  });

  it('导出表让短名可见，未导出短名报错', () => {
    const exported = `世界 导出测试
  版本 0.1

命名空间 天气
  导出 雨量
  叙事弦 雨量
    类型 数值 0..100
    基线 40

结局 停: 当 雨量 >= 100
`;
    const result = compileText(exported, 'namespace-export.nro');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.namespaces?.[0]).toEqual({ name: '天气', exports: ['雨量'] });
    const text = serialize(result.ir);
    expect(text).toContain('导出 雨量');
    expect(compileText(text, 'namespace-export-roundtrip.nro').ok).toBe(true);

    const privateWorld = exported.replace('  导出 雨量\n', '');
    const denied = compileText(privateWorld, 'namespace-private.nro');
    expect(denied.ok).toBe(false);
  });
});
