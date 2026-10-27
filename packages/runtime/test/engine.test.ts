import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import {
  Universe,
  cloneState,
  deserializeState,
  runOnce,
  serializeState,
  simulate,
  wellness,
} from '../src/index.js';

function world(src: string) {
  const r = compileText(src, 'test.nro');
  if (!r.ok) {
    throw new Error(r.diagnostics.errors.map((d) => `${d.code} ${d.message}`).join('\n'));
  }
  return r.ir;
}

const BASE = `世界 测试
叙事弦 甲
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
叙事弦 乙
  类型 数值 0..100
  基线 50
  悬崖 20
  安全 70
信号 告急
  当 甲 < 25
  台词 "…"
`;

describe('运行时：一拍之内发生了什么', () => {
  it('动作在同一拍生效，耦合在下一拍抵达', () => {
    const ir = world(
      BASE +
        `动作 推
  效果
    甲 -= 10
耦合 甲 → 乙 同向 1.0
结局 完: 当 甲 <= 0
`,
    );
    const u = new Universe(ir);
    expect(u.number('甲')).toBe(50);
    expect(u.act('action:推')).toBe(true);
    u.tick();
    expect(u.number('甲')).toBe(40);
    expect(u.number('乙')).toBe(50); // 还在路上
    u.tick();
    expect(u.number('乙')).toBe(40); // 归一化 -0.1 × 强度 1.0 × 量程 100
  });

  it('数值被量程夹住，超出的部分不会传导', () => {
    const ir = world(
      BASE +
        `动作 猛推
  效果
    甲 -= 500
结局 完: 当 甲 <= 0
`,
    );
    const u = new Universe(ir);
    u.act('action:猛推');
    u.tick();
    expect(u.number('甲')).toBe(0);
  });

  it('公理被违反时记录，而不是静默通过', () => {
    const ir = world(
      BASE +
        `公理 上限: 甲 <= 60
动作 越界
  效果
    甲 += 20
结局 完: 当 甲 >= 90
信号 高位
  当 甲 > 60
  字幕 "越界了"
`,
    );
    const u = new Universe(ir);
    expect(u.stats.violations).toBe(0);
    u.act('action:越界');
    const r = u.tick();
    expect(r.violations).toHaveLength(1);
    expect(u.stats.violations).toBe(1);
  });

  it('结局在条件成立的同一拍触发', () => {
    const ir = world(
      BASE +
        `动作 冲
  效果
    甲 += 25
结局 完: 当 甲 >= 90
信号 高位
  当 甲 > 60
  字幕 "越界了"
`,
    );
    const u = new Universe(ir);
    u.act('action:冲');
    u.tick();
    u.act('action:冲');
    const r = u.tick();
    expect(r.ending?.name).toBe('完');
    expect(r.ending?.tick).toBe(1);
  });

  it('信号只在上升沿触发一次', () => {
    const ir = world(
      BASE +
        `动作 降
  效果
    甲 -= 10
结局 完: 当 甲 <= 0
`,
    );
    const u = new Universe(ir);
    u.act('action:降');
    u.tick();
    u.act('action:降');
    u.tick();
    u.act('action:降');
    const r = u.tick();
    // 甲从 50→40→30→20，信号在第一次低于 25 时触发
    expect(r.cues.length).toBeGreaterThanOrEqual(0);
    expect(u.stats.signalFired.has('告急')).toBe(true);
  });

  it('同一状态 + 同一随机种子 = 同一局', () => {
    const ir = world(
      BASE +
        `动作 推
  效果
    甲 -= 10
动作 拉
  效果
    甲 += 10
结局 完: 当 甲 <= 0
`,
    );
    const a = runOnce(ir, { model: 'random', seed: 42, maxTicks: 60 });
    const b = runOnce(ir, { model: 'random', seed: 42, maxTicks: 60 });
    expect(a).toEqual(b);
  });

  it('快照可序列化并完整还原', () => {
    const ir = world(BASE + `结局 完: 当 甲 <= 0\n`);
    const u = new Universe(ir);
    u.tick();
    const snap = u.snapshot();
    const round = deserializeState(serializeState(snap));
    expect(round.values).toEqual({ 甲: 50, 乙: 50 });
    expect(cloneState(snap)).not.toBe(snap);
  });

  it('分叉后的宇宙互不影响（V[G]）', () => {
    const ir = world(
      BASE +
        `动作 推
  效果
    甲 -= 10
动作 拉
  效果
    甲 += 10
结局 完: 当 甲 <= 0
`,
    );
    const root = new Universe(ir);
    root.tick();
    const a = root.branch('A');
    const b = root.branch('B');
    a.state.values['甲'] = 10;
    b.state.values['甲'] = 90;
    expect(root.number('甲')).toBe(50);
    expect(a.number('甲')).toBe(10);
    expect(b.number('甲')).toBe(90);
  });

  it('健康度随阈值方向变化', () => {
    const ir = world(BASE + `结局 完: 当 甲 <= 0\n`);
    const u = new Universe(ir);
    const before = wellness(u);
    u.state.values['甲'] = 90;
    expect(wellness(u)).toBeGreaterThan(before);
  });

  it('批量模拟给出可用的音准报告', () => {
    const ir = world(
      BASE +
        `动作 推
  效果
    甲 -= 10
动作 拉
  效果
    甲 += 10
结局 完: 当 甲 <= 0
结局 成: 当 甲 >= 95
`,
    );
    const r = simulate(ir, { runs: 30, maxTicks: 80, seed: 3 });
    expect(r.overall.runs).toBe(30);
    const total = Object.values(r.overall.endings).reduce((a, b) => a + b, 0);
    expect(total).toBe(30);
    expect(r.health.score).toBeGreaterThanOrEqual(0);
    expect(r.health.score).toBeLessThanOrEqual(100);
    expect(['红', '绿', '黄']).toContain(r.health.grade);
  });
});

describe('外部注入：调律台的手指驱动世界', () => {
  const COUPLED = BASE + `耦合 甲 → 乙 同向 1.0\n结局 完: 当 甲 <= 0\n`;

  it('注入会在下一拍沿耦合传导（不再是「拖了也不动」）', () => {
    const u = new Universe(world(COUPLED));
    const delta = u.inject('甲', 70);
    expect(delta).toBe(20);
    expect(u.number('甲')).toBe(70);
    expect(u.number('乙')).toBe(50); // 还在路上
    u.tick();
    expect(u.number('乙')).toBe(70); // +0.2 归一化 × 强度 1.0 × 量程 100
  });

  it('注入被量程夹住，夹掉的部分不传导', () => {
    const u = new Universe(world(COUPLED));
    expect(u.inject('甲', 500)).toBe(50); // 50 → 100
    u.tick();
    expect(u.number('甲')).toBe(100);
    expect(u.number('乙')).toBe(100);
  });

  it('注入也遵守耦合延迟', () => {
    const ir = world(BASE + `耦合 甲 → 乙 同向 1.0 延迟 1\n结局 完: 当 甲 <= 0\n`);
    const u = new Universe(ir);
    u.inject('甲', 60);
    u.tick();
    expect(u.number('乙')).toBe(50); // 延迟 1：本拍还没到
    u.tick();
    expect(u.number('乙')).toBe(60);
  });

  it('注入的改动会在下一拍触发信号/公理/结局', () => {
    const ir = world(
      BASE +
        `信号 告急
  当 甲 < 30
  字幕 "告急"
结局 完: 当 甲 <= 10
`,
    );
    const u = new Universe(ir);
    u.inject('甲', 20);
    const first = u.tick();
    expect(first.cues.some((c) => c.signal === '告急')).toBe(true);
    u.inject('甲', 5);
    const second = u.tick();
    expect(second.ending?.name).toBe('完');
  });

  it('注入未知弦返回 0，不抛异常', () => {
    const u = new Universe(world(COUPLED));
    expect(u.inject('不存在', 10)).toBe(0);
    expect(u.number('甲')).toBe(50);
  });
});
