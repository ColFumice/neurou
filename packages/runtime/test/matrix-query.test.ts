import { describe, expect, it } from 'vitest';
import { compileText, type LExpr, type WorldIR } from '@neurou/core';
import {
  Universe,
  deserializeState,
  evalExpr,
  serializeState,
  type SerializedState,
  type WorldState,
} from '../src/index.js';

/**
 * v2.3a：关系谱格子曲线 + 四参数 `查关系谱(矩阵, 行, 列, 位置)` 的运行时采样。
 *
 * 表达式只拿到 WorldState，所以矩阵的标量值、曲线和采样元数据必须跟着
 * 状态走；这里同时验证采样语义、编译期回退、快照/恢复/分叉兼容性。
 */

const SOURCE = `世界 关系谱运行时
叙事弦 位置
  类型 数值 0..1
  基线 0.25

叙事弦 情绪
  类型 数值 0..1
  基线 0

关系谱 势力网
  行 信任 色温
  列 信任 色温
  段 0.2 0.4
  段 0.6 0.8
  曲线 信任 色温 0 1
  曲线 色温 信任 0 0.5 1
  插值 平滑
  循环 是

关系谱 折线网
  行 甲 乙
  列 甲 乙
  段 0.1 0.2
  段 0.3 0.4
  曲线 甲 乙 0 1

关系谱 平滑网
  行 甲
  列 乙
  段 0.9
  曲线 甲 乙 0 1
  插值 平滑

关系谱 单点网
  行 甲
  列 乙
  段 0.5
  曲线 甲 乙 0.7
  循环 是
`;

function world(src: string): WorldIR {
  const r = compileText(src, 'matrix-query-runtime.nro');
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

function withForcing(guard: string, effect: string): WorldIR {
  return world(`${SOURCE}力迫 采样
  当 ${guard}
  效果
    ${effect}
`);
}

/** 构造一个运行时直接求值的 `查关系谱` 调用（相当于编译器下降的结果）。 */
function query(name: string, row: string, col: string, position?: LExpr | number): LExpr {
  const args: LExpr[] = [
    { k: 'const', v: name },
    { k: 'const', v: row },
    { k: 'const', v: col },
  ];
  if (position !== undefined) {
    args.push(typeof position === 'number' ? { k: 'const', v: position } : position);
  }
  return { k: 'call', fn: '查关系谱', args };
}

describe('查关系谱：运行时采样语义', () => {
  it('线性、平滑、循环、夹住与单点曲线逐点正确', () => {
    const u = new Universe(IR);

    // 标量值：省略位置时读「段」。
    expect(u.getMatrixCell('势力网', '信任', '色温')).toBe(0.4);
    expect(u.getMatrixCell('折线网', '甲', '乙')).toBe(0.2);

    // 线性 + 不循环：位置夹到 [0, 1]。
    expect(u.getMatrixCell('折线网', '甲', '乙', 0.25)).toBeCloseTo(0.25, 12);
    expect(u.getMatrixCell('折线网', '甲', '乙', 5)).toBe(1);
    expect(u.getMatrixCell('折线网', '甲', '乙', -5)).toBe(0);

    // 平滑插值：t' = (1 - cos(πt)) / 2。
    expect(u.getMatrixCell('平滑网', '甲', '乙', 0.25)).toBeCloseTo(
      (1 - Math.cos(Math.PI * 0.25)) / 2,
      12,
    );
    expect(u.getMatrixCell('平滑网', '甲', '乙', 0.5)).toBeCloseTo(0.5, 12);

    // 循环：1.25 → 0.25；-0.5 → 0.5。
    expect(u.getMatrixCell('势力网', '色温', '信任', 1.25)).toBeCloseTo(0.25, 12);
    expect(u.getMatrixCell('势力网', '色温', '信任', -0.5)).toBeCloseTo(0.5, 12);

    // 单段曲线：任意有限位置都是该段值。
    expect(u.getMatrixCell('单点网', '甲', '乙', 0)).toBe(0.7);
    expect(u.getMatrixCell('单点网', '甲', '乙', 0.42)).toBe(0.7);
    expect(u.getMatrixCell('单点网', '甲', '乙', 99)).toBe(0.7);

    // 未知矩阵/标签返回 undefined。
    expect(u.getMatrixCell('不存在', '甲', '乙', 0.5)).toBeUndefined();
    expect(u.getMatrixCell('势力网', '不存在', '色温', 0.5)).toBeUndefined();
    expect(u.getMatrixCell('势力网', '信任', '不存在', 0.5)).toBeUndefined();
  });

  it('非有限位置与空曲线回退到标量值，缺失矩阵/状态回退到 0', () => {
    const u = new Universe(IR);
    expect(evalExpr(query('势力网', '信任', '色温', 0.5), u.state)).toBeCloseTo(0.5, 12);

    // 非有限位置：曲线采不出来，回退「段」标量 0.4。
    expect(evalExpr(query('势力网', '信任', '色温', Number.NaN), u.state)).toBe(0.4);
    expect(u.getMatrixCell('势力网', '信任', '色温', Number.POSITIVE_INFINITY)).toBe(0.4);

    // 空曲线：同样回退标量。
    const emptyCurve = u.snapshot();
    emptyCurve.matrices!['势力网']!.curves[0]!.bands = [];
    expect(evalExpr(query('势力网', '信任', '色温', 0.5), emptyCurve)).toBe(0.4);

    // 缺曲线条目（没有曲线的格子）：回退标量。
    const noCurve = u.snapshot();
    noCurve.matrices!['势力网']!.curves = [];
    expect(evalExpr(query('势力网', '信任', '色温', 0.5), noCurve)).toBe(0.4);

    // 旧状态没有 matrices：返回 0 而不是崩溃。
    const noMatrices = u.snapshot();
    delete (noMatrices as Partial<WorldState>).matrices;
    expect(evalExpr(query('势力网', '信任', '色温', 0.5), noMatrices)).toBe(0);

    // 未知矩阵返回 0。
    expect(evalExpr(query('不存在', '信任', '色温', 0.5), u.state)).toBe(0);

    // 三参数运行时调用读标量（即使该格子有曲线）。
    expect(evalExpr(query('势力网', '信任', '色温'), u.state)).toBe(0.4);
  });

  it('evalExpr 与 getMatrixCell 在所有采样点一致', () => {
    const u = new Universe(IR);
    const positions = [-2, -0.5, -0.25, 0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 1, 1.25, 1.5, 2.5];
    const cells: [string, string, string][] = [
      ['势力网', '信任', '色温'],
      ['势力网', '色温', '信任'],
      ['折线网', '甲', '乙'],
      ['平滑网', '甲', '乙'],
      ['单点网', '甲', '乙'],
    ];
    for (const [name, row, col] of cells) {
      for (const position of positions) {
        expect(evalExpr(query(name, row, col, position), u.state), `${name} ${row}×${col} @ ${position}`).toBeCloseTo(
          u.getMatrixCell(name, row, col, position)!,
          12,
        );
      }
    }
  });

  it('动态规则与结局按当前位置读到曲线值', () => {
    const ending = new Universe(withEnding('查关系谱("势力网", "信任", "色温", 位置) > 0.4'));
    expect(evalExpr(query('势力网', '信任', '色温', 0.5), ending.state)).toBeCloseTo(0.5, 12);
    expect(ending.tick().ending).toBeNull(); // 位置 0.25 → 平滑值约 0.146
    ending.inject('位置', 0.5);
    expect(ending.tick().ending).toEqual({ id: 'ending:检查', name: '检查', tick: 1 });

    const rule = new Universe(
      withForcing(
        '查关系谱("势力网", "信任", "色温", 位置) > 0.4',
        '情绪 = 查关系谱("势力网", "信任", "色温", 位置)',
      ),
    );
    rule.tick();
    expect(rule.get('情绪')).toBe(0);
    rule.inject('位置', 0.5);
    rule.tick();
    expect(rule.get('情绪')).toBeCloseTo(0.5, 12);
    expect(rule.state.fired['forcing:采样']).toBe(true);
  });

  it('同一世界 + 同一操作 = 同一采样与同一结局（确定性）', () => {
    const run = (): Universe => {
      const u = new Universe(withEnding('查关系谱("势力网", "信任", "色温", 位置) > 0.4'));
      u.tick();
      u.inject('位置', 0.5);
      u.tick();
      return u;
    };
    const a = run();
    const b = run();
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.state.ended).toEqual(b.state.ended);
    for (const position of [0, 0.25, 0.5, 1, 1.25]) {
      expect(a.getMatrixCell('势力网', '信任', '色温', position)).toBe(
        b.getMatrixCell('势力网', '信任', '色温', position),
      );
    }
  });
});

describe('查关系谱：快照 / 恢复 / 分叉携带矩阵数据', () => {
  it('快照与序列化包含标量、曲线和采样元数据', () => {
    const u = new Universe(IR);
    const snapshot = u.snapshot();
    expect(snapshot.matrices?.['势力网']).toEqual({
      rows: ['信任', '色温'],
      cols: ['信任', '色温'],
      values: [
        [0.2, 0.4],
        [0.6, 0.8],
      ],
      curves: [
        { row: '信任', col: '色温', bands: [0, 1] },
        { row: '色温', col: '信任', bands: [0, 0.5, 1] },
      ],
      interpolation: '平滑',
      loop: true,
      speed: 1,
      phase: 0,
    });
    expect(snapshot.matrices?.['折线网']).toMatchObject({
      interpolation: '线性',
      loop: false,
    });

    const raw = serializeState(snapshot);
    expect(raw.matrices?.['势力网']).toMatchObject({ interpolation: '平滑', loop: true });
    // 表达式属于 IR，不进运行时存档；矩阵状态只是新增字段。
    expect(JSON.stringify(raw)).not.toContain('查关系谱');
    const round = deserializeState(raw);
    expect(round.matrices).toEqual(snapshot.matrices);
  });

  it('restore 与 branch 都保留矩阵数据，且分叉互不影响', () => {
    const u = new Universe(IR);
    const live = u.snapshot();

    const restored = new Universe(IR);
    restored.restore(deserializeState(serializeState(live)));
    expect(restored.snapshot().matrices).toEqual(live.matrices);
    expect(restored.getMatrixCell('势力网', '信任', '色温', 0.5)).toBeCloseTo(0.5, 12);
    expect(evalExpr(query('势力网', '信任', '色温', 0.5), restored.state)).toBeCloseTo(0.5, 12);

    const branch = u.branch('B');
    expect(branch.snapshot().matrices).toEqual(live.matrices);
    branch.state.matrices!['势力网']!.curves[0]!.bands[1] = 99;
    expect(branch.getMatrixCell('势力网', '信任', '色温', 0.5)).toBeCloseTo(49.5, 12);
    expect(u.getMatrixCell('势力网', '信任', '色温', 0.5)).toBeCloseTo(0.5, 12);
  });

  it('旧存档缺 matrices：反序列化保留缺省，restore 再从 IR 重建', () => {
    const u = new Universe(IR);
    const raw = JSON.parse(JSON.stringify(serializeState(u.snapshot()))) as SerializedState;
    delete raw.matrices;
    const round = deserializeState(raw);
    expect(round.matrices).toBeUndefined();
    expect(evalExpr(query('势力网', '信任', '色温', 0.5), round)).toBe(0);

    const legacy = u.snapshot();
    delete (legacy as Partial<WorldState>).matrices;
    const restored = new Universe(IR);
    restored.restore(legacy);
    expect(restored.snapshot().matrices?.['势力网']).toMatchObject({
      interpolation: '平滑',
      loop: true,
    });
    expect(restored.getMatrixCell('势力网', '信任', '色温', 0.5)).toBeCloseTo(0.5, 12);

    // 只有部分字段的旧矩阵条目：restore 用 IR 重写曲线和元数据。
    const partial = u.snapshot();
    const matrix = partial.matrices!['势力网']!;
    delete (matrix as { curves?: unknown }).curves;
    delete (matrix as { interpolation?: unknown }).interpolation;
    delete (matrix as { loop?: unknown }).loop;
    const repaired = new Universe(IR);
    repaired.restore(partial);
    expect(repaired.snapshot().matrices?.['势力网']?.curves).toHaveLength(2);
    expect(repaired.snapshot().matrices?.['势力网']?.interpolation).toBe('平滑');
    expect(repaired.snapshot().matrices?.['势力网']?.loop).toBe(true);
  });

  it('没有关系谱的世界，快照里是空对象', () => {
    const ir = world(`世界 空矩阵
叙事弦 甲
  类型 数值 0..1
  基线 0
`);
    const u = new Universe(ir);
    expect(u.snapshot().matrices).toEqual({});
    expect(u.getMatrixCell('没有', '甲', '乙', 0.5)).toBeUndefined();
  });
});
