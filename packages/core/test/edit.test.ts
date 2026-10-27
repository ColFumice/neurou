import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addCoupling,
  addString,
  compileText,
  findCoupling,
  removeCoupling,
  removeString,
  serialize,
  setCouplingStrength,
  setCouplingStrengthBetween,
  setStringBaseline,
  setStringThreshold,
  type WorldIR,
} from '../src/index.js';

function loadExample(file: string): WorldIR {
  // 用 git 里的干净版本，避免验收/手工测试把示例文件改脏后单测抖动。
  let text = '';
  try {
    text = execFileSync('git', ['show', `HEAD:examples/${file}`], { encoding: 'utf8' });
  } catch {
    text = readFileSync(resolve('examples', file), 'utf8');
  }
  const result = compileText(text, `examples/${file}`);
  if (!result.ok) throw new Error(`${file} 编译失败`);
  return result.ir;
}

function trust(ir: WorldIR) {
  const s = ir.strings.find((item) => item.id === '信任');
  if (!s) throw new Error('缺少信任');
  return s;
}

describe('IR 编辑：基线 / 阈值 / 耦合强度', () => {
  it('改基线是纯函数，且结果能重新编译', () => {
    const ir = loadExample('tuner.nro');
    const before = trust(ir).baseline;
    const result = setStringBaseline(ir, '信任', 42.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trust(result.ir).baseline).toBe(42.5);
    expect(trust(ir).baseline).toBe(before); // 原图没被改
    const compiled = compileText(serialize(result.ir), 'edited.nro');
    expect(compiled.ok).toBe(true);
    expect(compiled.ir.strings.find((s) => s.id === '信任')?.baseline).toBe(42.5);
  });

  it('基线越界 / 未知弦 / 非数值弦返回错误', () => {
    const ir = loadExample('tuner.nro');
    expect(setStringBaseline(ir, '信任', 101).ok).toBe(false);
    expect(setStringBaseline(ir, '信任', -1).ok).toBe(false);
    expect(setStringBaseline(ir, '不存在', 10).ok).toBe(false);

    const rain = loadExample('rain-slice.nro');
    const nonNumeric = rain.strings.find((s) => s.domain.type !== 'number');
    expect(nonNumeric).toBeDefined();
    if (nonNumeric) expect(setStringBaseline(rain, nonNumeric.id, 1).ok).toBe(false);
  });

  it('改阈值后序列化再编译仍是同一条阈值线', () => {
    const ir = loadExample('tuner.nro');
    const result = setStringThreshold(ir, '信任', 'verge', 30);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trust(result.ir).verge).toBe(30);
    const compiled = compileText(serialize(result.ir), 'edited.nro');
    expect(compiled.ok).toBe(true);
    expect(compiled.ir.strings.find((s) => s.id === '信任')?.verge).toBe(30);
  });

  it('两条阈值线不能重合，越界也不行', () => {
    const ir = loadExample('tuner.nro');
    const safe = trust(ir).safe;
    expect(safe).toBeDefined();
    expect(setStringThreshold(ir, '信任', 'verge', safe!).ok).toBe(false);
    expect(setStringThreshold(ir, '信任', 'safe', 101).ok).toBe(false);
    // 交换顺序是允许的：悬崖在安全线之上也是一种世界设计
    const swapped = setStringThreshold(ir, '信任', 'verge', 80);
    expect(swapped.ok).toBe(true);
  });

  it('改耦合强度（按 id 与按 from→to）', () => {
    const ir = loadExample('tuner.nro');
    const coupling = findCoupling(ir, '信任', '色温');
    expect(coupling).toBeDefined();
    if (!coupling) return;
    const byId = setCouplingStrength(ir, coupling.id, 0.77);
    expect(byId.ok).toBe(true);
    if (byId.ok) expect(findCoupling(byId.ir, '信任', '色温')?.strength).toBe(0.77);

    const byPair = setCouplingStrengthBetween(ir, '信任', '色温', 0.33);
    expect(byPair.ok).toBe(true);
    if (!byPair.ok) return;
    const compiled = compileText(serialize(byPair.ir), 'edited.nro');
    expect(compiled.ok).toBe(true);
    expect(findCoupling(compiled.ir, '信任', '色温')?.strength).toBe(0.33);

    expect(setCouplingStrength(ir, coupling.id, 2.5).ok).toBe(false);
    expect(setCouplingStrength(ir, coupling.id, -0.1).ok).toBe(false);
    expect(setCouplingStrengthBetween(ir, '信任', '重力', 0.3).ok).toBe(false);
  });

  it('连续编辑可以组合，且原图保持不变', () => {
    const ir = loadExample('tuner.nro');
    let current: WorldIR = ir;
    for (const [id, which, value] of [
      ['信任', 'verge', 30],
      ['信任', 'safe', 70],
      ['色温', 'verge', 40],
    ] as const) {
      const result = setStringThreshold(current, id, which, value);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      current = result.ir;
    }
    const base = setStringBaseline(current, '步态', 55);
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const compiled = compileText(serialize(base.ir), 'edited.nro');
    expect(compiled.ok).toBe(true);
    const trustCompiled = compiled.ir.strings.find((s) => s.id === '信任');
    expect(trustCompiled?.verge).toBe(30);
    expect(trustCompiled?.safe).toBe(70);
    expect(compiled.ir.strings.find((s) => s.id === '步态')?.baseline).toBe(55);
    // 原图没被污染
    expect(trust(ir).verge).toBe(25);
    expect(trust(ir).safe).toBe(75);
  });
});

describe('IR 编辑：增删耦合', () => {
  it('新增非回路耦合，默认同向 0.2，能重新编译', () => {
    const ir = loadExample('tuner.nro');
    const result = addCoupling(ir, '信任', '步态');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = findCoupling(result.ir, '信任', '步态');
    expect(added?.polarity).toBe(1);
    expect(added?.strength).toBe(0.2);
    expect(added?.delay).toBe(0);
    expect(added?.loop).toBeUndefined();
    const compiled = compileText(serialize(result.ir), 'added.nro');
    expect(compiled.ok).toBe(true);
    expect(findCoupling(compiled.ir, '信任', '步态')?.strength).toBe(0.2);
  });

  it('新增耦合带自定义强度/极性', () => {
    const ir = loadExample('tuner.nro');
    const result = addCoupling(ir, '色温', '恐惧', { strength: 0.55, polarity: -1, delay: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = findCoupling(result.ir, '色温', '恐惧');
    expect(added?.strength).toBe(0.55);
    expect(added?.polarity).toBe(-1);
    expect(added?.delay).toBe(2);
    const compiled = compileText(serialize(result.ir), 'added.nro');
    expect(compiled.ok).toBe(true);
  });

  it('拒绝自耦合、未知弦、重复耦合、越界强度', () => {
    const ir = loadExample('tuner.nro');
    expect(addCoupling(ir, '信任', '信任').ok).toBe(false);
    expect(addCoupling(ir, '信任', '不存在').ok).toBe(false);
    expect(addCoupling(ir, '信任', '恐惧').ok).toBe(false);
    expect(addCoupling(ir, '信任', '步态', { strength: 3 }).ok).toBe(false);
  });

  it('删除普通耦合；回路边不能单独删除', () => {
    const ir = loadExample('tuner.nro');
    const removed = removeCoupling(ir, '信任', '恐惧');
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(findCoupling(removed.ir, '信任', '恐惧')).toBeUndefined();
    expect(removeCoupling(ir, '信任', '色温').ok).toBe(false); // 回路边
    expect(removeCoupling(ir, '信任', '不存在').ok).toBe(false);
  });
});

describe('IR 编辑：增删弦', () => {
  it('新增同类弦：继承类型/阈值/响应，名字唯一，编译通过', () => {
    const ir = loadExample('tuner.nro');
    const result = addString(ir, '信任');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.strings).toHaveLength(9);
    const added = result.ir.strings[8];
    expect(added?.name).toBe('信任新');
    expect(added?.kind).toBe('叙事');
    expect(added?.baseline).toBe(55);
    expect(added?.verge).toBe(25);
    expect(added?.safe).toBe(75);
    const compiled = compileText(serialize(result.ir), 'added-string.nro');
    expect(compiled.ok).toBe(true);
    expect(compiled.ir.strings).toHaveLength(9);
  });

  it('新增两次名字自动去重', () => {
    const ir = loadExample('tuner.nro');
    const first = addString(ir, '信任');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = addString(first.ir, '信任');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(new Set(second.ir.strings.map((s) => s.id)).size).toBe(10);
  });

  it('删除刚加的无引用弦；被规则/信号/结局引用的弦会被拒绝', () => {
    const ir = loadExample('tuner.nro');
    const added = addString(ir, '信任');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const newName = added.ir.strings[8]!.id;
    const removed = removeString(added.ir, newName);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.ir.strings).toHaveLength(8);
    // 信任被力迫/信号/结局引用，删除必须失败
    const refused = removeString(ir, '信任');
    expect(refused.ok).toBe(false);
    // 回路里的弦也不能删
    expect(removeString(ir, '色温').ok).toBe(false);
  });
});
