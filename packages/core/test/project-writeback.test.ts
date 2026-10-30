import { describe, expect, it } from 'vitest';
import { compileProjectFromFiles, patchProjectEntry, projectEntryStrings, compileText } from '../src/index.js';

const ENTRY = `引入 "mod.nro"

# 入口注释
世界 模块写回
  版本 0.1

叙事弦 入口
  类型 数值 0..100
  基线 30

动作 推进
  效果
    入口 += 1
`;
const MODULE = `命名空间 雨
  导出 雨量

  叙事弦 雨量
    类型 数值 0..100
    基线 40
`;

describe('模块入口写回（v5.47）', () => {
  it('只取入口弦并保留模块与注释', () => {
    const files = { 'examples/entry.nro': ENTRY, 'examples/mod.nro': MODULE };
    const base = compileProjectFromFiles('examples/entry.nro', files);
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const entryStrings = projectEntryStrings('examples/entry.nro', ENTRY, base.ir);
    expect(entryStrings.map((s) => s.id)).toEqual(['入口']);
    const editedEntry = entryStrings.map((s) => ({ ...s, baseline: 55 }));
    const patch = patchProjectEntry(ENTRY, entryStrings, editedEntry);
    expect(patch.ok).toBe(true);
    if (!patch.ok) return;
    expect(patch.text).toContain('基线 55');
    expect(patch.text).toContain('引入 "mod.nro"');
    expect(patch.text).toContain('# 入口注释');
    expect(patch.text).not.toContain('命名空间 雨');
    const next = compileProjectFromFiles('examples/entry.nro', { ...files, 'examples/entry.nro': patch.text });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ir.strings.find((s) => s.id === '入口')?.baseline).toBe(55);
    expect(next.ir.strings.find((s) => s.id === '雨.雨量')?.baseline).toBe(40);
  });

  it('入口普通世界仍用原有 patch', () => {
    const single = `世界 单文件\n  版本 0.1\n\n叙事弦 甲\n  类型 数值 0..100\n  基线 10\n`;
    expect(compileText(single, 'single.nro').ok).toBe(true);
  });
});
