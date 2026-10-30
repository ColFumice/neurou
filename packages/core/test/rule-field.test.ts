import { describe, expect, it } from 'vitest';
import { compileText, patchWorldText, setRuleNumberField } from '../src/index.js';

const WORLD = `世界 规则字段
  版本 0.1

叙事弦 甲
  类型 数值 0..100
  基线 20

动作 推
  当 甲 < 90
  耗时 2
  效果
    甲 += 3

动作 等
  效果
    甲 += 1

力迫 崩
  当 甲 > 60
  效果
    甲 -= 5
  优先级 4
`;

describe('规则数值字段写回（v6.3）', () => {
  it('耗时/优先级修改走行级 patch 并可重编译', () => {
    const compiled = compileText(WORLD, 'rules.nro');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const action = compiled.ir.rules.find((rule) => rule.kind === 'action');
    const forcing = compiled.ir.rules.find((rule) => rule.kind === 'forcing');
    if (!action || !forcing) throw new Error('rules missing');
    const withAction = setRuleNumberField(compiled.ir, action.id, 'cost', 3);
    if (!withAction.ok) throw new Error(withAction.error);
    const withForcing = setRuleNumberField(withAction.ir, forcing.id, 'priority', 9);
    if (!withForcing.ok) throw new Error(withForcing.error);
    const patch = patchWorldText(WORLD, compiled.ir, withForcing.ir);
    if (!patch.ok) throw new Error(patch.reason);
    expect(patch.ok).toBe(true);
    expect(patch.text).toContain('耗时 3');
    expect(patch.text).toContain('优先级 9');
    const next = compileText(patch.text, 'rules-patched.nro');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ir.rules.find((rule) => rule.kind === 'action')?.cost).toBe(3);
    expect(next.ir.rules.find((rule) => rule.kind === 'forcing')?.priority).toBe(9);
  });

  it('缺失数值行可插入', () => {
    const compiled = compileText(WORLD, 'rules-insert.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const wait = compiled.ir.rules.find((rule) => rule.kind === 'action' && rule.name === '等');
    if (!wait) throw new Error('rule missing');
    const edited = setRuleNumberField(compiled.ir, wait.id, 'cost', 2);
    if (!edited.ok) throw new Error(edited.error);
    const patch = patchWorldText(WORLD, compiled.ir, edited.ir);
    if (!patch.ok) throw new Error(patch.reason);
    expect(patch.text).toContain('耗时 2');
    const next = compileText(patch.text, 'rules-insert-patched.nro');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ir.rules.find((rule) => rule.name === '等')?.cost).toBe(2);
  });
});
