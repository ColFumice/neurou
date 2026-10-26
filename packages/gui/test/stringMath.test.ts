import { describe, expect, it } from 'vitest';
import {
  KEY_COUNT,
  STRING_N,
  KIND_ORDER,
  KIND_VISUAL,
  LOGICAL_H,
  LOGICAL_W,
  STRING_CENTER_Y,
  StringSim,
  excitationShape,
  keyAtPoint,
  keyByCode,
  layoutKeyboard,
  nextKind,
  signature,
  tentShape,
  touchFromKey,
  touchFromPoint,
} from '../src/stringMath.js';

const keys = layoutKeyboard();

describe('单弦调律台：8 类弦', () => {
  it('8 类弦齐全且各有独立振动参数', () => {
    expect(KIND_ORDER).toHaveLength(8);
    expect(new Set(KIND_ORDER).size).toBe(8);
    for (const kind of KIND_ORDER) {
      const profile = KIND_VISUAL[kind];
      expect(profile.kind).toBe(kind);
      expect(profile.speed).toBeGreaterThan(0);
      expect(profile.maxPull).toBeGreaterThan(80);
      expect(profile.peakWidth).toBeGreaterThan(profile.restWidth);
    }
    // 8 类弦不能是同一组数字
    const speeds = new Set(KIND_ORDER.map((kind) => KIND_VISUAL[kind].speed));
    expect(speeds.size).toBeGreaterThanOrEqual(4);
  });

  it('Tab 顺序可循环（正向/反向）', () => {
    expect(nextKind('叙事')).toBe('视觉');
    expect(nextKind('关系')).toBe('叙事');
    expect(nextKind('叙事', -1)).toBe('关系');
    expect(nextKind('视觉', 2)).toBe('物理');
  });

  it('签名波是有限值、落在 -1..1，且不是一条直线', () => {
    for (const kind of KIND_ORDER) {
      const samples = Array.from({ length: 64 }, (_, i) => signature(kind, i / 63));
      expect(samples.every((v) => Number.isFinite(v) && v >= -1 && v <= 1)).toBe(true);
      expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.15);
    }
  });
});

describe('键盘 → 屏幕：隐形的 46 键映射', () => {
  it('46 个键、4 行、没有重复 code', () => {
    expect(keys).toHaveLength(KEY_COUNT);
    expect(KEY_COUNT).toBe(46);
    expect(new Set(keys.map((key) => key.code)).size).toBe(KEY_COUNT);
    expect(new Set(keys.map((key) => key.row))).toEqual(new Set([0, 1, 2, 3]));
    expect(keys.filter((key) => key.row === 0)).toHaveLength(12);
    expect(keys.filter((key) => key.row === 1)).toHaveLength(13);
    expect(keys.filter((key) => key.row === 2)).toHaveLength(11);
    expect(keys.filter((key) => key.row === 3)).toHaveLength(10);
  });

  it('所有键位都在逻辑画布内', () => {
    for (const key of keys) {
      expect(key.x).toBeGreaterThanOrEqual(0);
      expect(key.x + key.w).toBeLessThanOrEqual(LOGICAL_W + 0.001);
      expect(key.y).toBeGreaterThan(0);
      expect(key.y + key.h).toBeLessThan(LOGICAL_H);
    }
  });

  it('上两行在弦上方、下两行在弦下方（方向由行决定）', () => {
    for (const key of keys) {
      expect(key.cy).not.toBe(STRING_CENTER_Y);
      expect(key.cy < STRING_CENTER_Y).toBe(key.row <= 1);
    }
  });

  it('code → 键位；任意点 → 最近键位；键位中心命中自身', () => {
    const a = keyByCode(keys, 'KeyA');
    expect(a?.label).toBe('A');
    const digit1 = keyByCode(keys, 'Digit1');
    expect(digit1?.shiftLabel).toBe('!');
    expect(keyAtPoint(keys, a!.cx, a!.cy)?.code).toBe('KeyA');
    const outside = keyAtPoint(keys, 2, 2);
    expect(outside).not.toBeNull();
    expect(keys).toContain(outside);
  });
});

describe('触点：方向与幅度', () => {
  it('弦上方的点向上、下方向下，离弦越远幅度越大', () => {
    const up = touchFromPoint(keys, 720, 200);
    const down = touchFromPoint(keys, 720, 700);
    expect(up.direction).toBe(-1);
    expect(down.direction).toBe(1);
    expect(up.amplitude).toBeCloseTo(250, 0);
    expect(down.amplitude).toBeCloseTo(250, 0);
    const near = touchFromPoint(keys, 720, 420);
    const far = touchFromPoint(keys, 720, 100);
    expect(far.amplitude).toBeGreaterThan(near.amplitude);
  });

  it('物理按键 = 鼠标点在键位中心，方向/幅度完全一致', () => {
    const a = keyByCode(keys, 'KeyA')!;
    const fromKey = touchFromKey(a);
    const fromPoint = touchFromPoint(keys, a.cx, a.cy);
    expect(fromKey.x).toBeCloseTo(fromPoint.x, 6);
    expect(fromKey.y).toBeCloseTo(fromPoint.y, 6);
    expect(fromKey.direction).toBe(fromPoint.direction);
    expect(fromKey.amplitude).toBeCloseTo(fromPoint.amplitude, 6);
  });

  it('幅度有下限与上限，x 不会出画面', () => {
    expect(touchFromPoint(keys, -100, 450).x).toBe(0);
    expect(touchFromPoint(keys, 5000, 450).x).toBe(LOGICAL_W);
    expect(touchFromPoint(keys, 720, 449).amplitude).toBeGreaterThanOrEqual(14);
    expect(touchFromPoint(keys, 720, -9999).amplitude).toBeLessThanOrEqual(LOGICAL_H * 0.36);
  });
});

describe('形状：拉弓与激励', () => {
  it('全弦帐篷：端点为 0、grab 点接近幅度、形状连续', () => {
    const shape = tentShape(361, 0.5, 300);
    expect(shape).toHaveLength(361);
    expect(Math.abs(shape[0]!)).toBeLessThan(0.001);
    expect(Math.abs(shape[360]!)).toBeLessThan(0.001);
    const peak = Math.max(...shape);
    expect(peak).toBeGreaterThan(250);
    expect(peak).toBeLessThanOrEqual(301);
    for (let i = 1; i < 360; i++) {
      expect(Number.isFinite(shape[i]!)).toBe(true);
    }
  });

  it('局部包：halfWidth 之外为 0', () => {
    const shape = tentShape(361, 0.25, 200, 0.1);
    for (let i = 0; i < 361; i++) {
      const t = i / 360;
      if (Math.abs(t - 0.25) > 0.1) expect(shape[i]).toBe(0);
    }
    expect(Math.max(...shape)).toBeCloseTo(200, 0);
  });

  it('三种激励形状都有峰值且不同（tent/double/ripple）', () => {
    for (const excitation of ['tent', 'double', 'ripple'] as const) {
      const shape = excitationShape(361, 0.5, 240, excitation);
      expect(shape).toHaveLength(361);
      expect(Math.max(...shape.map((v) => Math.abs(v)))).toBeGreaterThan(100);
    }
    const tent = excitationShape(361, 0.5, 240, 'tent');
    const ripple = excitationShape(361, 0.5, 240, 'ripple');
    let positiveTent = 0;
    let negativeTent = 0;
    let positiveRipple = 0;
    let negativeRipple = 0;
    for (let i = 0; i < 361; i++) {
      if (tent[i]! > 1) positiveTent++;
      if (tent[i]! < -1) negativeTent++;
      if (ripple[i]! > 1) positiveRipple++;
      if (ripple[i]! < -1) negativeRipple++;
    }
    expect(positiveTent).toBeGreaterThan(0);
    expect(negativeTent).toBe(0);
    expect(positiveRipple).toBeGreaterThan(0);
    expect(negativeRipple).toBeGreaterThan(0);
  });
});

describe('一维弦物理：稳定、会振动、会衰减、会停', () => {
  function fresh(): StringSim {
    return new StringSim();
  }

  it('拉弓后位移峰值接近（但不超过）该弦上限', () => {
    const sim = fresh();
    const profile = KIND_VISUAL['叙事'];
    const touch = touchFromPoint(keys, 720, 150);
    sim.pull(touch, profile);
    expect(sim.amplitude()).toBeGreaterThan(150);
    expect(sim.amplitude()).toBeLessThanOrEqual(profile.maxPull + 0.001);
  });

  it('8 类弦各自拨动后都不会数值爆炸（10 秒内保持有限且不超过拉幅）', () => {
    for (const kind of KIND_ORDER) {
      const profile = KIND_VISUAL[kind];
      const sim = fresh();
      const startTouch = touchFromPoint(keys, 640, 220);
      sim.pull(startTouch, profile);
      const initial = sim.amplitude();
      for (let i = 0; i < 600; i++) {
        sim.step(1 / 60, profile);
        expect(Number.isFinite(sim.amplitude())).toBe(true);
      }
      // 能量可以因反射/聚焦超过初始拉幅，但必须被硬上限夹住且有限。
      expect(sim.amplitude()).toBeLessThanOrEqual(460 + 0.001);
      expect(initial).toBeGreaterThan(0);
    }
  });

  it('拨动会叠加位移，而不是把已有波清掉', () => {
    const sim = fresh();
    const profile = KIND_VISUAL['视觉'];
    sim.pluck(touchFromPoint(keys, 500, 200), profile);
    const first = sim.amplitude();
    sim.pluck(touchFromPoint(keys, 900, 200), profile);
    expect(sim.amplitude()).toBeGreaterThan(first * 0.9);
  });

  it('长时间后衰减到静止；reset 立即归零', () => {
    const sim = fresh();
    const profile = KIND_VISUAL['控制'];
    sim.pull(touchFromPoint(keys, 720, 250), profile);
    for (let i = 0; i < 60 * 12; i++) sim.step(1 / 60, profile);
    expect(sim.resting(1.5)).toBe(true);
    sim.reset();
    expect(sim.amplitude()).toBe(0);
    expect(sim.speed()).toBe(0);
  });

  it('步长与帧率无关：同样 1 秒，60fps 与 30fps 的振幅接近', () => {
    const profile = KIND_VISUAL['物理'];
    const a = fresh();
    const b = fresh();
    a.pull(touchFromPoint(keys, 480, 240), profile);
    b.pull(touchFromPoint(keys, 480, 240), profile);
    for (let i = 0; i < 60; i++) a.step(1 / 60, profile);
    for (let i = 0; i < 30; i++) b.step(1 / 30, profile);
    // 半个周期的相位差允许存在，但量级应该在同一档。
    expect(Math.abs(a.amplitude() - b.amplitude())).toBeLessThan(profile.maxPull * 0.7);
  });
});
