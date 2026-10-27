import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import {
  FORCED_DECAY,
  Universe,
  cloneState,
  deserializeState,
  serializeState,
} from '../src/index.js';

function world(src: string) {
  const r = compileText(src, 'spectrum-runtime.nro');
  if (!r.ok) {
    throw new Error(r.diagnostics.errors.map((d) => `${d.code} ${d.message}`).join('\n'));
  }
  return r.ir;
}

const SOURCE = `世界 谱运行时

叙事弦 情绪
  类型 数值 0..1
  基线 0.5

谱 线性地形
  段 0 0.5 1
  范围 0..1

谱 平滑地形
  段 0 1
  范围 0..1
  插值 平滑

谱 循环地形
  段 0 0.5 1
  范围 0..1
  循环 是

谱 受迫地形
  段 0.2 0.5 0.8
  范围 0..1
  模式 受迫
`;

const IR = world(SOURCE);

function universe(): Universe {
  return new Universe(IR);
}

function values(u: Universe, id: string): number[] {
  return u.getSpectrum(id)?.values ?? [];
}

function anchors(u: Universe, id: string): number[] {
  return u.getSpectrum(id)?.anchors ?? [];
}

describe('谱运行时：初始化与固定模式', () => {
  it('从 WorldIR 初始化：当前值等于作者音段，元数据与模式随快照', () => {
    const u = universe();
    expect(u.getSpectrum('线性地形')).toEqual({
      id: '线性地形',
      mode: '固定',
      min: 0,
      max: 1,
      interpolation: '线性',
      loop: false,
      anchors: [0, 0.5, 1],
      values: [0, 0.5, 1],
    });
    expect(u.getSpectrum('受迫地形')).toMatchObject({
      mode: '受迫',
      anchors: [0.2, 0.5, 0.8],
      values: [0.2, 0.5, 0.8],
    });
    expect(u.getSpectrum('平滑地形')?.interpolation).toBe('平滑');
    expect(u.getSpectrum('循环地形')?.loop).toBe(true);
    expect(u.getSpectrum('不存在')).toBeUndefined();
  });

  it('getSpectrum 返回防御性副本', () => {
    const u = universe();
    const snap = u.getSpectrum('线性地形')!;
    snap.anchors[0] = 99;
    snap.values[2] = -5;
    snap.values.push(123);

    expect(u.getSpectrum('线性地形')?.anchors).toEqual([0, 0.5, 1]);
    expect(u.getSpectrum('线性地形')?.values).toEqual([0, 0.5, 1]);
  });

  it('固定模式零回复力：连续 10 拍后值仍等于锚点', () => {
    const u = universe();
    for (let i = 0; i < 10; i++) u.tick();
    expect(values(u, '线性地形')).toEqual([0, 0.5, 1]);
    expect(anchors(u, '线性地形')).toEqual([0, 0.5, 1]);
    expect(values(u, '受迫地形')).toEqual([0.2, 0.5, 0.8]);
    expect(u.number('情绪')).toBe(0.5);
  });

  it('没有谱的世界，快照里是空对象', () => {
    const ir = world(`世界 空谱
叙事弦 甲
  类型 数值 0..1
  基线 0
`);
    const u = new Universe(ir);
    expect(u.snapshot().spectra).toEqual({});
    expect(u.getSpectrum('没有')).toBeUndefined();
  });
});

describe('谱运行时：固定模式调制', () => {
  it('调制排队到下一拍，且只应用一次', () => {
    const u = universe();
    expect(u.modulateSpectrum('线性地形', 0, 0.2)).toEqual({ ok: true });
    // 还没 tick：曲线不变。
    expect(values(u, '线性地形')).toEqual([0, 0.5, 1]);

    u.tick();
    expect(values(u, '线性地形')[0]).toBeCloseTo(0.2);
    expect(anchors(u, '线性地形')).toEqual([0, 0.5, 1]);

    u.tick();
    expect(values(u, '线性地形')[0]).toBeCloseTo(0.2);
  });

  it('delta 可负；闭区间一次写多个段；每次写入都夹到范围', () => {
    const u = universe();
    expect(u.modulateSpectrum('线性地形', { from: 1, to: 2 }, 0.75)).toEqual({ ok: true });
    u.tick();
    expect(values(u, '线性地形')).toEqual([0, 1, 1]);

    expect(u.modulateSpectrum('线性地形', 2, -0.25)).toEqual({ ok: true });
    u.tick();
    expect(values(u, '线性地形')[2]).toBeCloseTo(0.75);

    expect(u.modulateSpectrum('线性地形', { from: 0, to: 2 }, -1)).toEqual({ ok: true });
    u.tick();
    expect(values(u, '线性地形')).toEqual([0, 0, 0]);
  });

  it('多条调制按入队顺序应用（clamp 发生在每条之后）', () => {
    const u = universe();
    u.modulateSpectrum('线性地形', 0, 0.6);
    u.modulateSpectrum('线性地形', 0, 0.5); // 0.6 + 0.5 = 1.1 → clamp 1
    u.modulateSpectrum('线性地形', 0, -0.3); // 1 - 0.3 = 0.7
    u.tick();
    expect(values(u, '线性地形')[0]).toBeCloseTo(0.7);
  });

  it('调制会反映在 getSpectrumAt 的当前曲线上', () => {
    const u = universe();
    u.modulateSpectrum('线性地形', { from: 0, to: 2 }, 0.1);
    u.tick();
    expect(u.getSpectrumAt('线性地形', 0.25)).toBeCloseTo(0.35);
  });
});

describe('谱运行时：受迫模式', () => {
  it('每拍向锚点衰减，锚点不动；偏移按 FORCED_DECAY 收敛', () => {
    const u = universe();
    expect(u.modulateSpectrum('受迫地形', 1, 0.3)).toEqual({ ok: true });
    expect(values(u, '受迫地形')).toEqual([0.2, 0.5, 0.8]);

    // 第一拍：当前偏移为 0，先衰减再叠加，因此拿到完整的 +0.3。
    u.tick();
    expect(values(u, '受迫地形')[1]).toBeCloseTo(0.8);

    // 第二拍开始看到衰减：仍在锚点之上、但小于满额调制。
    u.tick();
    const decayed = values(u, '受迫地形')[1]!;
    expect(decayed).toBeGreaterThan(0.5);
    expect(decayed).toBeLessThan(0.8);
    expect(decayed).toBeCloseTo(0.5 + 0.3 * FORCED_DECAY);
    expect(anchors(u, '受迫地形')).toEqual([0.2, 0.5, 0.8]);

    for (let i = 0; i < 20; i++) u.tick();
    expect(Math.abs(values(u, '受迫地形')[1]! - 0.5)).toBeLessThan(1e-3);
    expect(anchors(u, '受迫地形')).toEqual([0.2, 0.5, 0.8]);
  });

  it('受迫调制的上下界都夹到范围', () => {
    const u = universe();
    u.modulateSpectrum('受迫地形', 2, 0.5); // 0.8 → clamp 1
    u.tick();
    expect(values(u, '受迫地形')[2]).toBe(1);

    u.tick();
    expect(values(u, '受迫地形')[2]).toBeCloseTo(0.8 + 0.2 * FORCED_DECAY);

    u.modulateSpectrum('受迫地形', 0, -0.5); // 0.2 → clamp 0
    u.tick();
    expect(values(u, '受迫地形')[0]).toBe(0);
    expect(anchors(u, '受迫地形')).toEqual([0.2, 0.5, 0.8]);
  });
});

describe('谱运行时：getSpectrumAt', () => {
  it('线性插值：段点与中点精确，端点外夹住', () => {
    const u = universe();
    expect(u.getSpectrumAt('线性地形', 0)).toBe(0);
    expect(u.getSpectrumAt('线性地形', 0.25)).toBeCloseTo(0.25);
    expect(u.getSpectrumAt('线性地形', 0.5)).toBeCloseTo(0.5);
    expect(u.getSpectrumAt('线性地形', 0.75)).toBeCloseTo(0.75);
    expect(u.getSpectrumAt('线性地形', 1)).toBe(1);
    // loop = false：范围外夹到端点。
    expect(u.getSpectrumAt('线性地形', -0.5)).toBe(0);
    expect(u.getSpectrumAt('线性地形', 1.5)).toBe(1);
  });

  it('平滑插值使用余弦曲线，中点与线性一致、其余位置不同', () => {
    const u = universe();
    expect(u.getSpectrumAt('平滑地形', 0.5)).toBeCloseTo(0.5);

    const smooth = u.getSpectrumAt('平滑地形', 0.25)!;
    expect(smooth).toBeCloseTo((1 - Math.cos(Math.PI / 4)) / 2);
    expect(Math.abs(smooth - 0.25)).toBeGreaterThan(0.05);
    expect(u.getSpectrumAt('平滑地形', 0.75)).toBeCloseTo(1 - smooth);
  });

  it('循环谱按周期回绕；未知 id / 非有限位置返回 undefined', () => {
    const u = universe();
    expect(u.getSpectrumAt('循环地形', 1.25)).toBeCloseTo(0.25);
    expect(u.getSpectrumAt('循环地形', 2.5)).toBeCloseTo(0.5);
    expect(u.getSpectrumAt('循环地形', -0.5)).toBeCloseTo(0.5);
    expect(u.getSpectrumAt('循环地形', 1)).toBe(0);

    expect(u.getSpectrumAt('不存在', 0.5)).toBeUndefined();
    expect(u.getSpectrumAt('线性地形', Number.NaN)).toBeUndefined();
    expect(u.getSpectrumAt('线性地形', Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('谱运行时：锚点编辑', () => {
  it('setSpectrumAnchor 保留当前调制偏移并夹到范围', () => {
    const u = universe();
    u.modulateSpectrum('线性地形', 1, 0.2);
    u.tick();
    expect(values(u, '线性地形')[1]).toBeCloseTo(0.7);

    expect(u.setSpectrumAnchor('线性地形', 1, 0.6)).toEqual({ ok: true });
    expect(anchors(u, '线性地形')[1]).toBeCloseTo(0.6);
    expect(values(u, '线性地形')[1]).toBeCloseTo(0.8); // 偏移 +0.2 保留

    // 固定模式：后续拍不会回弹。
    u.tick();
    expect(values(u, '线性地形')[1]).toBeCloseTo(0.8);

    // 锚点越界先夹到 1；当前值 0.8 + 位移 0.4 → clamp 1。
    expect(u.setSpectrumAnchor('线性地形', 1, 1.5)).toEqual({ ok: true });
    expect(anchors(u, '线性地形')[1]).toBe(1);
    expect(values(u, '线性地形')[1]).toBe(1);
  });

  it('setSpectrumAnchor 校验 id / 下标 / 有限值', () => {
    const u = universe();
    for (const call of [
      () => u.setSpectrumAnchor('不存在', 0, 0.5),
      () => u.setSpectrumAnchor('线性地形', -1, 0.5),
      () => u.setSpectrumAnchor('线性地形', 3, 0.5),
      () => u.setSpectrumAnchor('线性地形', 1.5, 0.5),
      () => u.setSpectrumAnchor('线性地形', 0, Number.NaN),
      () => u.setSpectrumAnchor('线性地形', 0, Number.POSITIVE_INFINITY),
    ]) {
      const r = call();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
    // 失败的编辑不改状态。
    expect(anchors(u, '线性地形')).toEqual([0, 0.5, 1]);
    expect(values(u, '线性地形')).toEqual([0, 0.5, 1]);
  });
});

describe('谱运行时：调制校验与确定性', () => {
  it('modulateSpectrum 校验 id / 下标 / 区间 / delta', () => {
    const u = universe();
    const bad: Parameters<Universe['modulateSpectrum']>[] = [
      ['不存在', 0, 0.1],
      ['线性地形', -1, 0.1],
      ['线性地形', 3, 0.1],
      ['线性地形', 0.5, 0.1],
      ['线性地形', { from: 2, to: 1 }, 0.1],
      ['线性地形', { from: 0, to: 3 }, 0.1],
      ['线性地形', { from: -1, to: 1 }, 0.1],
      ['线性地形', { from: 0, to: 1.5 }, 0.1],
      ['线性地形', 0, Number.NaN],
      ['线性地形', 0, Number.POSITIVE_INFINITY],
    ];
    for (const [id, target, delta] of bad) {
      const r = u.modulateSpectrum(id, target, delta);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }

    // 失败的调制没有入队。
    u.tick();
    expect(values(u, '线性地形')).toEqual([0, 0.5, 1]);
  });

  it('同一世界 + 同一操作 = 同一谱状态；快照/序列化/恢复都包含谱', () => {
    const run = (u: Universe): void => {
      u.modulateSpectrum('受迫地形', { from: 0, to: 2 }, 0.2);
      u.tick();
      u.modulateSpectrum('线性地形', 1, -0.1);
      u.tick();
      u.setSpectrumAnchor('线性地形', 0, 0.25);
    };
    const a = universe();
    const b = universe();
    run(a);
    run(b);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.getSpectrum('线性地形')).toEqual(b.getSpectrum('线性地形'));

    const snap = a.snapshot();
    const cloned = cloneState(snap);
    expect(cloned.spectra).toEqual(snap.spectra);
    expect(cloned.spectra).not.toBe(snap.spectra);
    expect(cloned.spectra?.['线性地形']).not.toBe(snap.spectra?.['线性地形']);

    const round = deserializeState(serializeState(snap));
    expect(round.spectra).toEqual(snap.spectra);

    const restored = universe();
    restored.restore(round);
    expect(restored.getSpectrum('线性地形')).toEqual(a.getSpectrum('线性地形'));
    expect(restored.getSpectrum('受迫地形')).toEqual(a.getSpectrum('受迫地形'));
  });

  it('restore 旧快照（没有 spectra 字段）时从 IR 重建谱', () => {
    const u = universe();
    u.modulateSpectrum('线性地形', 0, 0.4);
    u.tick();

    const oldSnapshot = u.snapshot();
    delete oldSnapshot.spectra;
    const restored = universe();
    restored.restore(oldSnapshot);
    expect(restored.getSpectrum('线性地形')?.values).toEqual([0, 0.5, 1]);
  });

  it('分叉带走谱状态与尚未 tick 的调制，之后互不影响', () => {
    const root = universe();
    root.modulateSpectrum('线性地形', 0, 0.4);
    root.tick();

    const a = root.branch('A');
    const b = root.branch('B');
    a.modulateSpectrum('线性地形', 0, 0.2);
    b.modulateSpectrum('线性地形', 0, -0.4);
    a.tick();
    b.tick();

    expect(values(root, '线性地形')[0]).toBeCloseTo(0.4);
    expect(values(a, '线性地形')[0]).toBeCloseTo(0.6);
    expect(values(b, '线性地形')[0]).toBeCloseTo(0);

    // 分叉时队列里还没 tick 的调制也会被复制。
    const queued = root.branch('C');
    queued.modulateSpectrum('受迫地形', 0, 0.1);
    const forked = queued.branch('D');
    forked.tick();
    expect(values(forked, '受迫地形')[0]).toBeCloseTo(0.3);
    expect(values(queued, '受迫地形')[0]).toBeCloseTo(0.2);
  });
});
