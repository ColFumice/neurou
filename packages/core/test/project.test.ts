import { describe, expect, it } from 'vitest';
import { compileProject, compileProjectFromFiles, ProjectError } from '../src/index.js';

const RAIN_MODULE = `叙事弦 雨量
  类型 数值 0..100
  基线 40
`;

const TIDE_MODULE = `引入 "rain.nro"

系统 潮汐
  阶段 传导
  效果
    雨量 += 2
`;

const ENTRY = `引入 "lib/tide.nro"

世界 模块测试
  版本 0.1

结局 停: 当 雨量 >= 100
`;

describe('模块/引入（v5.9）', () => {
  it('按依赖顺序合并多文件并解析相对路径', () => {
    const result = compileProjectFromFiles('examples/entry.nro', {
      'examples/entry.nro': ENTRY,
      'examples/lib/tide.nro': TIDE_MODULE,
      'examples/lib/rain.nro': RAIN_MODULE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.strings.map((string) => string.id)).toContain('雨量');
    expect(result.ir.systems?.[0]?.name).toBe('潮汐');
    expect(result.ir.endings[0]?.name).toBe('停');
  });

  it('通过 readFile 回调编译项目', () => {
    const files: Record<string, string> = {
      'examples/entry2.nro': ENTRY,
      'examples/lib/tide.nro': TIDE_MODULE,
      'examples/lib/rain.nro': RAIN_MODULE,
    };
    const result = compileProject('examples/entry2.nro', (path) => files[path] ?? '');
    expect(result.ok).toBe(true);
  });

  it('拒绝循环引入、缺失模块和模块内世界声明', () => {
    expect(() =>
      compileProjectFromFiles('a.nro', {
        'a.nro': '引入 "b.nro"\n世界 A\n',
        'b.nro': '引入 "a.nro"\n叙事弦 x\n  类型 数值 0..10\n  基线 0\n',
      }),
    ).toThrow(ProjectError);
    expect(() => compileProjectFromFiles('a.nro', { 'a.nro': '引入 "missing.nro"\n世界 A\n' })).toThrow(ProjectError);
    expect(() =>
      compileProjectFromFiles('a.nro', {
        'a.nro': '引入 "mod.nro"\n世界 A\n',
        'mod.nro': '世界 不能这样\n',
      }),
    ).toThrow(ProjectError);
  });
});
