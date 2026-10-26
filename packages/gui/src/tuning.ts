import type { IREffect, IRRule, IRSignal, IRString, LExpr, WorldIR } from '@neurou/core';
import type { WorldKey } from './worlds.js';

/**
 * 调性旋钮。
 *
 * 两条滑块不是「难度参数」：它们被编译成两根真实的弦，加上几条力迫和信号，
 * 再交给同一个运行时去跑。所以拖动滑块之后，变化是从世界里长出来的，
 * 而不是界面直接改一个数字。
 *
 * 注意：这是 GUI 层的调音层，不写进 .nro 源文件；关掉界面世界仍按原样运行。
 */

export interface Tuning {
  /** 0 = 舒缓，100 = 压力 */
  pressure: number;
  /** 0 = 温情，100 = 残酷 */
  cruelty: number;
}

export const DEFAULT_TUNING: Tuning = { pressure: 50, cruelty: 50 };

interface TuningCue {
  text: string;
  param: string;
  value: number;
}

interface TuningSpec {
  pressureTarget: string;
  crueltyTarget: string;
  pressureHigh: TuningCue;
  pressureLow: TuningCue;
  crueltyHigh: TuningCue;
  crueltyLow: TuningCue;
}

const SPECS: Record<WorldKey, TuningSpec> = {
  rain: {
    pressureTarget: '时间进度',
    crueltyTarget: '蛞蝓猫.体力',
    pressureHigh: { text: '雨点变得密集，像有人在敲铁皮。', param: '雨幕', value: 0.9 },
    pressureLow: { text: '雨声退远了一点，像有人把门掩上。', param: '雨幕', value: 0.2 },
    crueltyHigh: { text: '空气变硬了。连你自己的呼吸都像在试探。', param: '色调', value: -0.4 },
    crueltyLow: { text: '有什么松开了。你终于听见雨以外的声音。', param: '色调', value: 0.3 },
  },
  negotiation: {
    pressureTarget: '使者.耐心',
    crueltyTarget: '使者.信任',
    pressureHigh: { text: '使者：「我坐在这里，不是没有别的事。」', param: '烛光', value: -0.4 },
    pressureLow: { text: '使者：「不急。茶还没凉。」', param: '烛光', value: 0.2 },
    crueltyHigh: { text: '使者：「你说话的口气，像已经赢了。」', param: '烛光', value: -0.5 },
    crueltyLow: { text: '使者：「……谢谢。」', param: '烛光', value: 0.3 },
  },
};

const read = (id: string): LExpr => ({ k: 'read', id });
const num = (v: number): LExpr => ({ k: 'const', v });
const bin = (op: string, a: LExpr, b: LExpr): LExpr => ({ k: 'bin', op, l: a, r: b });
const add = (id: string, value: LExpr): IREffect => ({ k: 'add', id, value });

/** (v - 50) / 30：滑块偏离中线时，每两拍推一点点。 */
const above = (v: LExpr): LExpr => bin('/', bin('-', v, num(50)), num(30));
/** (50 - v) / 40：滑块低于中线时，每三拍往回拉一点点。 */
const below = (v: LExpr): LExpr => bin('/', bin('-', num(50), v), num(40));

function tuningStrings(tuning: Tuning): IRString[] {
  return [
    {
      id: '调性.压力',
      name: '压力',
      kind: '叙事',
      domain: { type: 'number', min: 0, max: 100 },
      baseline: tuning.pressure,
      response: '线性',
      owner: '调性',
    },
    {
      id: '调性.残酷',
      name: '残酷',
      kind: '叙事',
      domain: { type: 'number', min: 0, max: 100 },
      baseline: tuning.cruelty,
      response: '线性',
      owner: '调性',
    },
  ];
}

function tuningRules(spec: TuningSpec): IRRule[] {
  const pressure = read('调性.压力');
  const cruelty = read('调性.残酷');
  const rule = (name: string, guard: LExpr, effects: IREffect[], priority: number, cooldown: number): IRRule => ({
    id: `forcing:调性.${name}`,
    kind: 'forcing',
    name: `调性.${name}`,
    guard,
    effects,
    irreversible: false,
    priority,
    before: [],
    repeat: true,
    cooldown,
    cost: 0,
  });

  return [
    rule('催', bin('>', pressure, num(55)), [add(spec.pressureTarget, above(pressure))], 6, 2),
    rule('缓', bin('<', pressure, num(45)), [add(spec.pressureTarget, bin('-', num(0), below(pressure)))], 5, 3),
    rule('酷', bin('>', cruelty, num(55)), [add(spec.crueltyTarget, bin('-', num(0), above(cruelty)))], 6, 2),
    rule('柔', bin('<', cruelty, num(45)), [add(spec.crueltyTarget, below(cruelty))], 5, 3),
  ];
}

function signal(id: string, guard: LExpr, cue: TuningCue): IRSignal {
  return {
    id: `signal:调性.${id}`,
    name: `调性.${id}`,
    guard,
    cues: [
      { k: '字幕', text: cue.text },
      { k: '视觉', param: cue.param, value: cue.value },
    ],
  };
}

function tuningSignals(spec: TuningSpec): IRSignal[] {
  const pressure = read('调性.压力');
  const cruelty = read('调性.残酷');
  return [
    signal('更急', bin('>', pressure, num(78)), spec.pressureHigh),
    signal('渐缓', bin('<', pressure, num(25)), spec.pressureLow),
    signal('变冷', bin('>', cruelty, num(70)), spec.crueltyHigh),
    signal('回暖', bin('<', cruelty, num(30)), spec.crueltyLow),
  ];
}

/** 把当前旋钮值编译进世界：两根弦 + 四条力迫 + 四条信号。 */
export function tuneWorld(base: WorldIR, key: WorldKey, tuning: Tuning): WorldIR {
  const spec = SPECS[key];
  const world: WorldIR = structuredClone(base);
  world.strings = world.strings.filter((s) => !s.id.startsWith('调性.'));
  world.rules = world.rules.filter((r) => !r.id.startsWith('forcing:调性.'));
  world.signals = world.signals.filter((s) => !s.id.startsWith('signal:调性.'));
  world.strings.push(...tuningStrings(tuning));
  world.rules.push(...tuningRules(spec));
  world.signals.push(...tuningSignals(spec));
  world.stats = {
    ...world.stats,
    strings: world.strings.length,
    rules: world.rules.length,
    signals: world.signals.length,
  };
  return world;
}

/** 调性旋钮对画面的直接影响：拖动时立刻有反馈，不必等下一拍。 */
export function paletteOf(tuning: Tuning, rain: number): { tint: string; darkness: number; rain: number } {
  const p = tuning.pressure / 100;
  const c = tuning.cruelty / 100;
  return {
    tint: `rgba(${Math.round(120 + c * 90)}, ${Math.round(90 + (1 - c) * 40)}, ${Math.round(110 - c * 40)}, ${0.08 + c * 0.14})`,
    darkness: 0.08 + p * 0.24,
    rain: Math.min(1, Math.max(0.12, rain / 100 + p * 0.25)),
  };
}
