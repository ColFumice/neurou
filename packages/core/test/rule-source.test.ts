import { describe, expect, it } from 'vitest';
import { compileText, patchRuleBlockText, ruleBlockText, replaceRuleBlockText } from '../src/index.js';

const WORLD = `世界 规则源
  版本 0.1

叙事弦 甲
  类型 数值 0..100
  基线 20

# 注释保留
动作 推
  当 甲 < 90
  耗时 1
  效果
    甲 += 3

力迫 崩
  当 甲 > 60
  效果
    甲 -= 5
`;

describe('规则源文本编辑（v6.7）', () => {
  it('提取并整块替换条件/效果', () => {
    const compiled = compileText(WORLD, 'rule-source.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const action = compiled.ir.rules.find((rule) => rule.kind === 'action');
    if (!action) throw new Error('action missing');
    const source = ruleBlockText(WORLD, action);
    expect(source).toContain('甲 += 3');
    const nextSource = `动作 推\n  当 甲 < 70\n  耗时 2\n  效果\n    甲 += 8\n    甲 -= 1\n`;
    const replaced = replaceRuleBlockText(WORLD, action, nextSource);
    if (!replaced.ok) throw new Error(replaced.reason);
    expect(replaced.text).toContain('# 注释保留');
    expect(replaced.text).toContain('甲 += 8');
    const next = compileText(replaced.text, 'rule-source-patched.nro');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const nextAction = next.ir.rules.find((rule) => rule.kind === 'action');
    expect(nextAction?.cost).toBe(2);
    expect(nextAction?.effects).toHaveLength(2);
  });

  it('逐行 diff 保留未改行/行尾注释', () => {
    const source = `世界 规则diff\n  版本 0.1\n\n叙事弦 甲\n  类型 数值 0..100\n  基线 20\n\n动作 推\n  当 甲 < 90 # 条件注释\n  # 效果注释\n  效果\n    甲 += 3 # 数值注释\n    甲 -= 1\n`;
    const compiled = compileText(source, 'rule-diff.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const action = compiled.ir.rules.find((rule) => rule.kind === 'action');
    if (!action) throw new Error('action missing');
    const original = ruleBlockText(source, action);
    if (!original) throw new Error('block missing');
    const nextSource = original.replace('甲 += 3', '甲 += 8');
    const patched = patchRuleBlockText(source, action, nextSource);
    if (!patched.ok) throw new Error(patched.reason);
    expect(patched.text).toContain('当 甲 < 90 # 条件注释');
    expect(patched.text).toContain('# 效果注释');
    expect(patched.text).toContain('甲 += 8 # 数值注释');
    expect(patched.text).toContain('甲 -= 1');
    expect(compileText(patched.text, 'rule-diff-patched.nro').ok).toBe(true);
  });
});
