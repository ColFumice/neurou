import { describe, expect, it } from 'vitest';
import { compileText, type LExpr, type WorldIR } from '@neurou/core';
import {
  FORCED_DECAY,
  Universe,
  deserializeState,
  evalExpr,
  serializeState,
  type SerializedState,
  type SpectrumState,
  type WorldState,
} from '../src/index.js';

/**
 * v2.1a：`查谱("谱名", 位置)` 的运行时采样。
 *
 * 表达式只拿到 WorldState，所以插值/循环元数据必须跟着谱状态走；
 * 这里同时验证采样语义与快照/恢复/分叉的兼容性。
 */

const SOURCE = `世界 查谱运行时
叙事弦 情绪
  类型 数值 0..1
  基线 0.5

谱 线性地形
  段 0 1
  范围 0..1

谱 多段地形
  段 0 1 0
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

function world(src: string): WorldIR {
  const r = compileText(src, 'spectrum-query-runtime.nro');
  if (!r.ok) {
    throw new Error(r.diagnostics.errors.map((d) => `${d.code} ${d.message}`).join('\n'));
  }
  return r.ir;
}

const IR = world(SOURCE);

function withEnding(guard: string): WorldIR {
  return world(`${SOURCE}结局 检查: 当 ${guard}
`);
}

/** 构造一个运行时直接求值的 `查谱` 调用（相当于编译器下降的结果）。 */
function query(name: string, position: LExpr | number): LExpr {
  return {
    k: 'call',
    fn: '查谱',
    args: [{ k: 'const', v: name }, typeof position === 'number' ? { k: 'const', v: position } : position],
  };
}

describe('查谱：运行时可读（规则/结局驱动）', () => {
  it('编译后的结局按当前曲线采样：线性中点命中', () => {
    const u = new Universe(withEnding('查谱("线性地形", 0.5) >= 0.5'));
    expect(u.tick().ending).toEqual({ id: 'ending:检查', name: '检查', tick: 0 });
  });

  it('位置可以是数值弦：运行时读取当前值再采样', () => {
    const u = new Universe(withEnding('查谱("线性地形", 情绪) >= 0.5'));
    expect(u.get('情绪')).toBe(0.5);
    expect(u.tick().ending?.id).toBe('ending:检查');
  });

  it('循环回绕、负位置、端点夹住与平滑插值都按运行时语义生效', () => {
    const cases: [string, boolean][] = [
      ['查谱("循环地形", 1.25) >= 0.25', true], // 1.25 → 0.25，线性 0.25
      ['查谱("循环地形", -0.5) >= 0.5', true], // -0.5 → 0.5，中段值 0.5
      ['查谱("循环地形", 1) >= 0.5', false], // 循环下 1 等价于 0
      ['查谱("线性地形", 5) >= 0.999', true], // 非循环右侧夹到 1
      ['查谱("线性地形", -5) >= 0.001', false], // 非循环左侧夹到 0
      ['查谱("平滑地形", 0.25) < 0.2 且 查谱("平滑地形", 0.25) > 0.1', true], // 余弦缓动 ≈0.146
    ];
    for (const [guard, ends] of cases) {
      const u = new Universe(withEnding(guard));
      u.tick();
      expect(u.ended, guard).toBe(ends);
    }
  });

  it('调制后的曲线对查谱立即可见（采样共享当前 values）', () => {
    const u = new Universe(withEnding('查谱("线性地形", 0.5) >= 0.75'));
    u.tick();
    expect(u.ended).toBe(false);

    expect(u.modulateSpectrum('线性地形', 0, 0.8)).toEqual({ ok: true });
    u.tick(); // 结局先判定，调制在本拍末应用
    expect(u.ended).toBe(false);
    expect(u.getSpectrumAt('线性地形', 0.5)).toBeCloseTo(0.9);
    expect(evalExpr(query('线性地形', 0.5), u.state)).toBeCloseTo(0.9);

    u.tick();
    expect(u.ended).toBe(true);
    expect(u.state.ended?.tick).toBe(2);
  });

  it('同一世界 + 同一操作 = 同一采样与同一结局', () => {
    const run = (): Universe => {
      const u = new Universe(withEnding('查谱("线性地形", 0.5) >= 0.75'));
      u.tick();
      u.modulateSpectrum('线性地形', 0, 0.8);
      u.tick();
      u.tick();
      return u;
    };
    const a = run();
    const b = run();
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(evalExpr(query('线性地形', 0.5), a.state)).toBe(evalExpr(query('线性地形', 0.5), b.state));
    expect(a.state.ended).toEqual(b.state.ended);
    expect(a.getSpectrumAt('线性地形', 0.5)).toBe(b.getSpectrumAt('线性地形', 0.5));
  });
});

describe('查谱：采样语义与边界', () => {
  it('线性 / 平滑 / 循环 / 单段与 getSpectrumAt 逐点一致', () => {
    const u = new Universe(IR);
    const positions = [-2, -0.5, -0.25, 0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 1, 1.25, 1.5, 2.5];
    for (const name of ['线性地形', '多段地形', '平滑地形', '循环地形', '受迫地形']) {
      for (const p of positions) {
        const sampled = evalExpr(query(name, p), u.state);
        expect(sampled, `${name} @ ${p}`).toBeCloseTo(u.getSpectrumAt(name, p)!, 12);
      }
    }

    // 调制之后仍然一致。
    u.modulateSpectrum('线性地形', 0, 0.2);
    u.modulateSpectrum('循环地形', { from: 0, to: 2 }, 0.1);
    u.tick();
    for (const name of ['线性地形', '循环地形']) {
      for (const p of positions) {
        expect(evalExpr(query(name, p), u.state), `${name} @ ${p}`).toBeCloseTo(
          u.getSpectrumAt(name, p)!,
          12,
        );
      }
    }
    expect(evalExpr(query('线性地形', 0.5), u.state)).toBeCloseTo(0.6);
    expect(evalExpr(query('循环地形', 0.25), u.state)).toBeCloseTo(0.35);
  });

  it('受迫模式每拍衰减，查谱读到的是衰减后的当前值', () => {
    const u = new Universe(IR);
    u.modulateSpectrum('受迫地形', 1, 0.3);
    u.tick();
    expect(evalExpr(query('受迫地形', 0.5), u.state)).toBeCloseTo(0.8);

    u.tick();
    expect(evalExpr(query('受迫地形', 0.5), u.state)).toBeCloseTo(0.5 + 0.3 * FORCED_DECAY);
  });

  it('缺失谱 / 缺失谱状态 / 非有限位置 / 空谱都返回 0', () => {
    const u = new Universe(IR);
    expect(evalExpr(query('不存在', 0.5), u.state)).toBe(0);
    expect(evalExpr(query('线性地形', Number.NaN), u.state)).toBe(0);
    expect(evalExpr(query('线性地形', Number.POSITIVE_INFINITY), u.state)).toBe(0);

    const empty = u.snapshot();
    empty.spectra!['线性地形']!.values = [];
    expect(evalExpr(query('线性地形', 0.5), empty)).toBe(0);

    const noSpectra = u.snapshot();
    delete (noSpectra as Partial<WorldState>).spectra;
    expect(evalExpr(query('线性地形', 0.5), noSpectra)).toBe(0);
  });

  it('运行时状态缺谱时，规则/结局读 0 而不是崩溃', () => {
    const u = new Universe(withEnding('查谱("线性地形", 0.5) == 0'));
    u.tick();
    expect(u.ended).toBe(false);

    delete u.state.spectra!['线性地形'];
    u.tick();
    expect(u.ended).toBe(true);
    expect(u.state.ended?.id).toBe('ending:检查');
  });
});

describe('查谱：快照 / 恢复 / 分叉携带采样元数据', () => {
  it('快照与序列化包含 min/max/interpolation/loop', () => {
    const u = new Universe(IR);
    const snap = u.snapshot();
    expect(snap.spectra?.['循环地形']).toEqual({
      anchors: [0, 0.5, 1],
      values: [0, 0.5, 1],
      mode: '固定',
      min: 0,
      max: 1,
      interpolation: '线性',
      loop: true,
    });
    expect(snap.spectra?.['平滑地形']).toMatchObject({
      min: 0,
      max: 1,
      interpolation: '平滑',
      loop: false,
    });

    const raw = serializeState(snap);
    expect(raw.spectra?.['循环地形']).toMatchObject({ interpolation: '线性', loop: true });
    // 表达式属于 IR，不进运行时存档；新增字段只是谱状态的追加。
    expect(JSON.stringify(raw)).not.toContain('查谱');
    const round = deserializeState(raw);
    expect(round.spectra).toEqual(snap.spectra);
  });

  it('restore 与 branch 都保留元数据和当前值，之后互不影响', () => {
    const u = new Universe(IR);
    u.modulateSpectrum('循环地形', { from: 0, to: 2 }, 0.1);
    u.tick();
    const live = u.snapshot();
    expect(live.spectra?.['循环地形']?.values).toEqual([0.1, 0.6, 1]);

    const restored = new Universe(IR);
    restored.restore(deserializeState(serializeState(live)));
    expect(restored.snapshot().spectra).toEqual(live.spectra);
    expect(evalExpr(query('循环地形', 0.25), restored.state)).toBeCloseTo(0.35);
    expect(evalExpr(query('循环地形', 0.25), restored.state)).toBeCloseTo(
      restored.getSpectrumAt('循环地形', 0.25)!,
    );

    const branch = u.branch('B');
    expect(branch.snapshot().spectra).toEqual(live.spectra);
    branch.modulateSpectrum('循环地形', 0, 0.2);
    branch.tick();
    expect(branch.getSpectrum('循环地形')?.values[0]).toBeCloseTo(0.3);
    expect(u.getSpectrum('循环地形')?.values[0]).toBeCloseTo(0.1);
  });

  it('旧存档缺元数据：反序列化回退 0..1/线性/不循环，restore 再从 IR 重建', () => {
    const u = new Universe(IR);
    const raw = JSON.parse(JSON.stringify(serializeState(u.snapshot()))) as SerializedState;
    for (const st of Object.values(raw.spectra ?? {})) {
      const legacy = st as Partial<SpectrumState>;
      delete legacy.min;
      delete legacy.max;
      delete legacy.interpolation;
      delete legacy.loop;
    }

    const round = deserializeState(raw);
    expect(round.spectra?.['平滑地形']).toMatchObject({
      min: 0,
      max: 1,
      interpolation: '线性',
      loop: false,
    });
    expect(round.spectra?.['循环地形']?.loop).toBe(false);

    // restore 拿到的是旧 WorldState（字段缺失），clone 后由 IR 覆盖回退值。
    const legacyState = u.snapshot();
    for (const st of Object.values(legacyState.spectra ?? {})) {
      const partial = st as Partial<SpectrumState>;
      delete partial.min;
      delete partial.max;
      delete partial.interpolation;
      delete partial.loop;
    }
    const restored = new Universe(IR);
    restored.restore(legacyState);
    expect(restored.snapshot().spectra?.['平滑地形']).toMatchObject({
      interpolation: '平滑',
      loop: false,
    });
    expect(restored.snapshot().spectra?.['循环地形']).toMatchObject({
      interpolation: '线性',
      loop: true,
    });
    expect(evalExpr(query('循环地形', 1.25), restored.state)).toBeCloseTo(0.25);
  });
});
