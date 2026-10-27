import type { IRCoupling, IRString, WorldIR } from './ir.js';

/**
 * IR 编辑操作：调律台的结构编辑都走这里。
 *
 * 设计原则：
 *   - 纯函数：输入一张图，返回一张新图（不改原对象）；
 *   - 先验证再返回：未知弦、非数值弦、越界值、两条阈值线重合都返回错误，
 *     而不是静默夹取——GUI 拿到错误可以拒绝这次手势；
 *   - 只动该动的地方：其余字段原样保留；
 *   - 编辑后的图必须仍能被序列化并重新编译（这一点由 GUI 的写回闸门与单测共同保证）。
 */

export type ThresholdName = 'verge' | 'safe';

export type EditOk = { ok: true; ir: WorldIR };
export type EditFail = { ok: false; error: string };
export type EditResult = EditOk | EditFail;

const round = (value: number): number => Math.round(value * 1000) / 1000;

function domainOf(string: IRString): { min: number; max: number } | undefined {
  if (string.domain.type !== 'number') return undefined;
  return { min: string.domain.min ?? 0, max: string.domain.max ?? 100 };
}

function fail(error: string): EditFail {
  return { ok: false, error };
}

function replaceString(ir: WorldIR, id: string, next: IRString): WorldIR {
  return { ...ir, strings: ir.strings.map((s) => (s.id === id ? next : s)) };
}

/** 改一根数值弦的基线（调律台拖弦 / 拨弦写回都用它）。 */
export function setStringBaseline(ir: WorldIR, id: string, value: number): EditResult {
  const string = ir.strings.find((s) => s.id === id);
  if (!string) return fail(`没有弦「${id}」`);
  const domain = domainOf(string);
  if (!domain) return fail(`弦「${id}」不是数值弦，不能改基线`);
  if (!Number.isFinite(value)) return fail('基线必须是有限数字');
  if (value < domain.min || value > domain.max) {
    return fail(`基线 ${value} 超出取值范围 ${domain.min}..${domain.max}`);
  }
  return { ok: true, ir: replaceString(ir, id, { ...string, baseline: round(value) }) };
}

/** 改一根数值弦的悬崖线 / 安全线。 */
export function setStringThreshold(
  ir: WorldIR,
  id: string,
  which: ThresholdName,
  value: number,
): EditResult {
  const string = ir.strings.find((s) => s.id === id);
  if (!string) return fail(`没有弦「${id}」`);
  const domain = domainOf(string);
  if (!domain) return fail(`弦「${id}」不是数值弦，不能设阈值`);
  if (!Number.isFinite(value)) return fail('阈值必须是有限数字');
  if (value < domain.min || value > domain.max) {
    return fail(`阈值 ${value} 超出取值范围 ${domain.min}..${domain.max}`);
  }
  const rounded = round(value);
  const other = which === 'verge' ? string.safe : string.verge;
  if (other !== undefined && rounded === other) {
    return fail('悬崖线与安全线不能重合——两条线之间要留出区间');
  }
  const next: IRString = { ...string, [which]: rounded };
  return { ok: true, ir: replaceString(ir, id, next) };
}

/** 改一条耦合的强度（0..2，超出视为错误）。 */
export function setCouplingStrength(ir: WorldIR, couplingId: string, strength: number): EditResult {
  const coupling = ir.couplings.find((c) => c.id === couplingId);
  if (!coupling) return fail(`没有耦合「${couplingId}」`);
  if (!Number.isFinite(strength)) return fail('强度必须是有限数字');
  if (strength < 0 || strength > 2) return fail(`强度 ${strength} 超出 0..2`);
  const next: IRCoupling = { ...coupling, strength: round(strength) };
  return {
    ok: true,
    ir: { ...ir, couplings: ir.couplings.map((c) => (c.id === couplingId ? next : c)) },
  };
}

/** 按 from→to 找耦合（GUI 手势里通常只有两端 id，没有生成 id）。 */
export function findCoupling(ir: WorldIR, from: string, to: string): IRCoupling | undefined {
  return ir.couplings.find((c) => c.from === from && c.to === to);
}

/** 按 from→to 改强度。 */
export function setCouplingStrengthBetween(
  ir: WorldIR,
  from: string,
  to: string,
  strength: number,
): EditResult {
  const coupling = findCoupling(ir, from, to);
  if (!coupling) return fail(`没有耦合「${from} → ${to}」`);
  return setCouplingStrength(ir, coupling.id, strength);
}
