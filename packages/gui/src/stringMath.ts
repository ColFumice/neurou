/**
 * 单弦调律台的纯数学层（无 DOM、无 React，可在 node 里单测）。
 *
 * 这里只有四件事：
 *   1. 8 类弦的「振动个性」参数（波速、阻尼、拉幅、线宽、总览签名波）；
 *   2. 键盘 → 屏幕的隐形映射（数字/字母/符号 46 键，按真实键位归一化到 1440×900）；
 *   3. 触点 → 弦的振颤方向与幅度（鼠标点击与物理按键共用同一套 TouchPoint）；
 *   4. 一维弦的物理：拉弓形状（tent）、拨动激励（8 类弦的三种激励）、固定边界波方程。
 */
import type { StringKind } from '@neurou/core';

/** 调律台的逻辑画布：与旧界面一致，渲染时等比/非等比铺满视口。 */
export const LOGICAL_W = 1440;
export const LOGICAL_H = 900;
/** 弦的静息位置：正中一条横线。 */
export const STRING_CENTER_Y = LOGICAL_H / 2;
/** 物理采样点数（361 → dx = 4px）。 */
export const STRING_N = 181;
/** 数字 / 字母 / 符号三行共 46 个物理键位。 */
export const KEY_COUNT = 46;
/** 位移硬上限，防止数值爆炸。 */
const MAX_DISPLACEMENT = 460;

export const KIND_ORDER: readonly StringKind[] = [
  '叙事',
  '视觉',
  '动画',
  '物理',
  '控制',
  '空间',
  '认知',
  '关系',
] as const;

export type Excitation = 'tent' | 'double' | 'ripple';

export interface KindVisualProfile {
  kind: StringKind;
  /** 显示名（未加「弦」字，总览与 Tab 浮现用）。 */
  label: string;
  /** 波速 px/s（视觉，不是声速）。 */
  speed: number;
  /** 阻尼 1/s，越大越快停。 */
  damping: number;
  /** 静息线宽 px。 */
  restWidth: number;
  /** 波峰处额外线宽上限 px。 */
  peakWidth: number;
  /** 单次拉弦的最大位移 px。 */
  maxPull: number;
  /** 键盘/点击快速拨动时的局部激励形状。 */
  excitation: Excitation;
}

/**
 * 8 类弦的振动个性。差别必须“一眼能摸出来”：
 *   叙事 = 慢、宽、余音长；视觉 = 快、亮、碎；动画 = 规律涟漪；
 *   物理 = 重、低频、衰减慢；控制 = 紧、短促；空间 = 极宽、极慢；
 *   认知 = 细碎、即逝；关系 = 双点（两个波源）。
 *
 * v1.1 起整体放慢：波速约为原来的 0.6–0.65，阻尼同步降约 12%，
 * 让波峰爬上爬下更从容、反射更柔和（用户反馈“速度放缓/柔和”）。
 */
export const KIND_VISUAL: Record<StringKind, KindVisualProfile> = {
  叙事: { kind: '叙事', label: '叙事', speed: 820, damping: 0.48, restWidth: 1.8, peakWidth: 12, maxPull: 280, excitation: 'tent' },
  视觉: { kind: '视觉', label: '视觉', speed: 1350, damping: 1.4, restWidth: 1.6, peakWidth: 10, maxPull: 320, excitation: 'double' },
  动画: { kind: '动画', label: '动画', speed: 1120, damping: 0.8, restWidth: 1.7, peakWidth: 11, maxPull: 300, excitation: 'ripple' },
  物理: { kind: '物理', label: '物理', speed: 620, damping: 0.31, restWidth: 2.0, peakWidth: 15, maxPull: 330, excitation: 'tent' },
  控制: { kind: '控制', label: '控制', speed: 1200, damping: 1.95, restWidth: 1.6, peakWidth: 9, maxPull: 240, excitation: 'double' },
  空间: { kind: '空间', label: '空间', speed: 590, damping: 0.27, restWidth: 2.0, peakWidth: 13, maxPull: 340, excitation: 'tent' },
  认知: { kind: '认知', label: '认知', speed: 1420, damping: 2.1, restWidth: 1.5, peakWidth: 8, maxPull: 220, excitation: 'ripple' },
  关系: { kind: '关系', label: '关系', speed: 1500, damping: 0.8, restWidth: 1.8, peakWidth: 12, maxPull: 300, excitation: 'double' },
};

/** Tab 的顺序切换（可负向）。 */
export function nextKind(kind: StringKind, step = 1): StringKind {
  const index = KIND_ORDER.indexOf(kind);
  const base = index < 0 ? 0 : index;
  const next = (base + (step % KIND_ORDER.length) + KIND_ORDER.length) % KIND_ORDER.length;
  return KIND_ORDER[next]!;
}

/* ------------------------------------------------------------------ *
 * 键盘 → 屏幕：隐形的 46 键映射
 * ------------------------------------------------------------------ */

export interface KeyCell {
  /** 物理键位 code：Digit1 / KeyQ / Semicolon … */
  code: string;
  /** 主字符（不按 Shift）。 */
  label: string;
  /** Shift 后的符号（数字行与标点行）。 */
  shiftLabel?: string;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

interface RowSpec {
  codes: readonly string[];
  labels: readonly string[];
  shifts?: readonly string[];
  /** 相对居中位置的横向错位（keyW 的比例），模拟真实键盘的错行。 */
  shift: number;
}

const ROWS: readonly RowSpec[] = [
  {
    codes: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
    labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
    shifts: ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+'],
    shift: 0,
  },
  {
    codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
    labels: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
    shifts: ['{', '}', '|'],
    shift: 0.16,
  },
  {
    codes: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
    labels: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"],
    shifts: [':', '"'],
    shift: 0.38,
  },
  {
    codes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
    labels: ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'],
    shifts: ['<', '>', '?'],
    shift: 0.72,
  },
];

/**
 * 把键盘按真实键位归一化铺满全屏。
 * 竖排：4 行等距分布（约 y=190/364/536/710），弦在 450，
 * 所以上面两行 = 向上拨，下面两行 = 向下拨；离弦越远幅度越大。
 */
export function layoutKeyboard(width = LOGICAL_W, height = LOGICAL_H): KeyCell[] {
  const keyW = width / 15;
  const rowH = height / 5.2;
  const top = (height - rowH * ROWS.length) / 2;
  const cells: KeyCell[] = [];
  for (let row = 0; row < ROWS.length; row++) {
    const spec = ROWS[row]!;
    const span = spec.codes.length * keyW;
    const left = (width - span) / 2 + spec.shift * keyW;
    const y = top + row * rowH + rowH * 0.09;
    const h = rowH * 0.82;
    for (let col = 0; col < spec.codes.length; col++) {
      const x = left + col * keyW;
      const cell: KeyCell = {
        code: spec.codes[col]!,
        label: spec.labels[col]!,
        row,
        col,
        x,
        y,
        w: keyW,
        h,
        cx: x + keyW / 2,
        cy: y + h / 2,
      };
      const shiftLabel = spec.shifts?.[col];
      if (shiftLabel) cell.shiftLabel = shiftLabel;
      cells.push(cell);
    }
  }
  return cells;
}

export function keyByCode(keys: readonly KeyCell[], code: string): KeyCell | null {
  for (const key of keys) if (key.code === code) return key;
  return null;
}

/** 屏幕点 → 最近键位（映射是隐形的，但每个点都属于某一个键）。 */
export function keyAtPoint(keys: readonly KeyCell[], x: number, y: number): KeyCell | null {
  if (keys.length === 0) return null;
  let best: KeyCell | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    // 矩形内距离为 0；矩形外取到矩形最近边的距离。
    const dx = x < key.x ? key.x - x : x > key.x + key.w ? x - (key.x + key.w) : 0;
    const dy = y < key.y ? key.y - y : y > key.y + key.h ? y - (key.y + key.h) : 0;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * 触点：方向与幅度
 * ------------------------------------------------------------------ */

export interface TouchPoint {
  /** 逻辑坐标：弦在此 x 处被拨动。 */
  x: number;
  /** 触发点的逻辑 y。 */
  y: number;
  /** 0..LOGICAL_H*0.36，未按弦类上限裁剪。 */
  amplitude: number;
  /** -1 = 向上，1 = 向下。 */
  direction: 1 | -1;
  /** 这个触点落在哪个键位上。 */
  key: KeyCell | null;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return (min + max) / 2;
  return value < min ? min : value > max ? max : value;
}

function touchFrom(keys: readonly KeyCell[], x: number, y: number, height: number): TouchPoint {
  const cx = clamp(x, 0, LOGICAL_W);
  const cy = clamp(y, 0, height);
  const dy = cy - height / 2;
  const direction: 1 | -1 = dy < 0 ? -1 : 1;
  // 最小 14px：轻点也有形变；最大 36% 视口高：够张扬但不飞出画面。
  const amplitude = clamp(Math.abs(dy), 14, height * 0.36);
  return { x: cx, y: cy, amplitude, direction, key: keyAtPoint(keys, cx, cy) };
}

/** 鼠标/触摸点 → 触点（连续位置，不是把点击吸附到键中心）。 */
export function touchFromPoint(keys: readonly KeyCell[], x: number, y: number, height = LOGICAL_H): TouchPoint {
  return touchFrom(keys, x, y, height);
}

/** 物理按键 → 触点（键位中心，等于是“鼠标点在键位中心”）。 */
export function touchFromKey(key: KeyCell, height = LOGICAL_H): TouchPoint {
  return touchFrom([key], key.cx, key.cy, height);
}

/* ------------------------------------------------------------------ *
 * 形状：拉弓（tent）与 8 类弦的激励
 * ------------------------------------------------------------------ */

function smooth3(values: Float64Array): void {
  const n = values.length;
  if (n < 3) return;
  const copy = Float64Array.from(values);
  for (let i = 1; i < n - 1; i++) {
    values[i] = 0.25 * copy[i - 1]! + 0.5 * copy[i]! + 0.25 * copy[i + 1]!;
  }
}

/**
 * 拉弓形状：从弦的两端拉向 grab 点的一条“帐篷”，顶点做少量平滑（真实弦有弯曲刚度）。
 * `halfWidth01` 省略 = 拉到两端；给出 = 只在中心附近拉一个局部包。
 */
export function tentShape(n: number, center01: number, amplitudePx: number, halfWidth01?: number): Float32Array {
  const out = new Float32Array(n);
  const center = clamp(center01, 0, 1);
  if (n < 2 || amplitudePx === 0) return out;
  if (halfWidth01 === undefined) {
    // 全弦帐篷：两端为 0，grab 点为 amplitude；左右斜率不同（靠边时更陡）。
    const leftSpan = Math.max(center, 1e-4);
    const rightSpan = Math.max(1 - center, 1e-4);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const rise = t <= center ? 1 - (center - t) / leftSpan : 1 - (t - center) / rightSpan;
      out[i] = amplitudePx * Math.max(0, rise);
    }
    const smooth = Float64Array.from(out);
    smooth3(smooth);
    smooth3(smooth);
    for (let i = 0; i < n; i++) out[i] = smooth[i]!;
    return out;
  }
  // 局部包：raised cosine，两端导数为 0。
  const half = clamp(halfWidth01, 1 / n, 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const d = Math.abs(t - center);
    if (d >= half) continue;
    out[i] = amplitudePx * 0.5 * (1 + Math.cos((Math.PI * d) / half));
  }
  return out;
}

/** 一次“拨动”的局部激励形状（键盘 / Tab 演示 / 快速点击）。 */
export function excitationShape(
  n: number,
  center01: number,
  amplitudePx: number,
  excitation: Excitation,
): Float32Array {
  if (excitation === 'tent') return tentShape(n, center01, amplitudePx, 0.12);
  const out = new Float32Array(n);
  if (excitation === 'double') {
    addInto(out, tentShape(n, clamp(center01 - 0.045, 0, 1), amplitudePx * 0.62, 0.055));
    addInto(out, tentShape(n, clamp(center01 + 0.045, 0, 1), amplitudePx * 0.62, 0.055));
    return out;
  }
  // ripple：三个交替相位的窄包，像“动画弦”的规律涟漪。
  addInto(out, tentShape(n, clamp(center01 - 0.06, 0, 1), amplitudePx * 0.42, 0.04));
  addInto(out, tentShape(n, center01, -amplitudePx * 0.5, 0.04));
  addInto(out, tentShape(n, clamp(center01 + 0.06, 0, 1), amplitudePx * 0.42, 0.04));
  return out;
}

function addInto(target: Float32Array, source: Float32Array): void {
  for (let i = 0; i < target.length; i++) target[i] = target[i]! + source[i]!;
}

/* ------------------------------------------------------------------ *
 * 一维弦物理：固定端点 + 阻尼波方程，子步长积分保证稳定
 * ------------------------------------------------------------------ */

const SUBSTEP = 1 / 360;

export class StringSim {
  readonly n: number;
  private readonly width: number;
  /** 当前位移（px，正=向下）。 */
  private cur: Float32Array;
  /** 上一子步位移。 */
  private prev: Float32Array;
  /** 交换缓冲。 */
  private tmp: Float32Array;
  private accumulator = 0;

  constructor(n = STRING_N, width = LOGICAL_W) {
    this.n = Math.max(9, Math.floor(n));
    this.width = width;
    this.cur = new Float32Array(this.n);
    this.prev = new Float32Array(this.n);
    this.tmp = new Float32Array(this.n);
  }

  get dx(): number {
    return this.width / (this.n - 1);
  }

  reset(): void {
    this.cur.fill(0);
    this.prev.fill(0);
    this.tmp.fill(0);
    this.accumulator = 0;
  }

  /** 拉弓：直接覆盖成静态形状（拖动时调用，物理暂停由视图负责）。 */
  pull(touch: TouchPoint, profile: KindVisualProfile): void {
    const amplitude = Math.min(touch.amplitude, profile.maxPull) * touch.direction;
    const center = clamp(touch.x / this.width, 0.001, 0.999);
    const shape = tentShape(this.n, center, amplitude);
    this.cur.set(shape);
    this.prev.set(shape);
    this.accumulator = 0;
  }

  /** 拨动：把局部激励叠加到正在振动的弦上（保留已有波与速度）。 */
  pluck(touch: TouchPoint, profile: KindVisualProfile): void {
    const amplitude = Math.min(touch.amplitude, profile.maxPull) * touch.direction;
    const center = clamp(touch.x / this.width, 0.001, 0.999);
    const shape = excitationShape(this.n, center, amplitude, profile.excitation);
    for (let i = 1; i < this.n - 1; i++) {
      this.cur[i] = this.cur[i]! + shape[i]!;
      this.prev[i] = this.prev[i]! + shape[i]!;
    }
  }

  /** 推进物理。dt 秒；内部按 1/240s 固定子步长，保证不同帧率下行为一致。 */
  step(dtSeconds: number, profile: KindVisualProfile): void {
    const dt = clamp(dtSeconds, 0, 1 / 20);
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    while (this.accumulator >= SUBSTEP) {
      this.substep(profile);
      this.accumulator -= SUBSTEP;
    }
  }

  private substep(profile: KindVisualProfile): void {
    const { n } = this;
    const cur = this.cur;
    const prev = this.prev;
    const next = this.tmp;
    // 阻尼波方程（leapfrog）：u_{n+1} = u + damp*(u - u_{n-1}) + c²·∇²u
    // 必须双缓冲读取，否则原地更新会数值爆炸。
    const damping = Math.exp(-profile.damping * SUBSTEP);
    const courant = (profile.speed * SUBSTEP) / this.dx;
    const c2 = courant * courant;
    for (let i = 1; i < n - 1; i++) {
      const u = cur[i]!;
      const laplace = cur[i - 1]! - 2 * u + cur[i + 1]!;
      let value = u + damping * (u - prev[i]!) + c2 * laplace;
      if (value > MAX_DISPLACEMENT) value = MAX_DISPLACEMENT;
      else if (value < -MAX_DISPLACEMENT) value = -MAX_DISPLACEMENT;
      next[i] = value;
    }
    next[0] = 0;
    next[n - 1] = 0;
    // 轮换三个缓冲：prev ← cur，cur ← next，next ← 旧 prev。
    this.prev = cur;
    this.cur = next;
    this.tmp = prev;
  }

  /** 当前位移（px，正=向下）；视图只读。 */
  u(): Float32Array {
    return this.cur;
  }

  amplitude(): number {
    let max = 0;
    for (let i = 0; i < this.n; i++) {
      const value = Math.abs(this.cur[i]!);
      if (value > max) max = value;
    }
    return max;
  }

  /** 最大速度 px/s（用于“是否还在动”的判定与拖尾淡出）。 */
  speed(): number {
    let max = 0;
    for (let i = 0; i < this.n; i++) {
      const value = Math.abs(this.cur[i]! - (this.prev[i] ?? 0));
      if (value > max) max = value;
    }
    return max / SUBSTEP;
  }

  resting(epsPx = 0.2): boolean {
    return this.amplitude() < epsPx && this.speed() < 4;
  }
}

/* ------------------------------------------------------------------ *
 * 总览签名波：8 条横向细线，各自是一种“弦的声音形状”
 * ------------------------------------------------------------------ */

function gauss(x: number, center: number, spread: number): number {
  const d = (x - center) / spread;
  return Math.exp(-d * d);
}

/** x01 ∈ 0..1 → -1..1 的签名波形（总览用）。 */
export function signature(kind: StringKind, x01: number): number {
  const x = clamp(x01, 0, 1);
  switch (kind) {
    case '叙事':
      return 0.72 * gauss(x, 0.42, 0.17) + 0.18 * gauss(x, 0.7, 0.1);
    case '视觉':
      return 0.62 * Math.sin(x * Math.PI * 6) * gauss(x, 0.5, 0.34);
    case '动画':
      return 0.5 * Math.sin(x * Math.PI * 12) * gauss(x, 0.5, 0.38);
    case '物理':
      return 0.78 * Math.sin(x * Math.PI * 2) * gauss(x, 0.5, 0.5);
    case '控制':
      return 0.8 * gauss(x, 0.36, 0.025) - 0.8 * gauss(x, 0.64, 0.025);
    case '空间':
      return 0.7 * gauss(x, 0.5, 0.3);
    case '认知':
      return (
        0.55 * gauss(x, 0.3, 0.03) -
        0.62 * gauss(x, 0.48, 0.025) +
        0.5 * gauss(x, 0.64, 0.03) -
        0.3 * gauss(x, 0.78, 0.02)
      );
    case '关系':
      return 0.62 * gauss(x, 0.36, 0.09) - 0.62 * gauss(x, 0.64, 0.09);
    default:
      return 0;
  }
}

/* ------------------------------------------------------------------ *
 * v0.7 八弦叠影：设置值 = 弦基线的纵坐标
 * ------------------------------------------------------------------ */

/** value = 100 时基线的 y（屏幕上方），value = 0 时基线的 y（下方）。 */
export const VALUE_Y_TOP = 110;
export const VALUE_Y_BOTTOM = 790;
/** 1 个设置值对应多少像素。 */
export const VALUE_PX_PER_UNIT = (VALUE_Y_BOTTOM - VALUE_Y_TOP) / 100;

/** 设置值（0..100）→ 基线纵坐标；夹在画布安全区里。 */
export function valueToY(value: number): number {
  const v = clamp(value, 0, 100);
  return VALUE_Y_BOTTOM - v * VALUE_PX_PER_UNIT;
}

/** 基线纵坐标 → 设置值（0..100）。 */
export function yToValue(y: number): number {
  return clamp((VALUE_Y_BOTTOM - y) / VALUE_PX_PER_UNIT, 0, 100);
}

/**
 * 调律台的一根弦：由真实世界的 `IRString` + 运行时值投影而来。
 * `norm` ∈ 0..1 决定基线纵坐标；阈值也归一化到 0..1（共振点 = 接近阈值）。
 */
/** 谱作为音色时的曲线（v2.0）。 */
export interface TimbreCurve {
  /** 原始段值（在 min..max 范围内）。 */
  bands: number[];
  min: number;
  max: number;
  smooth: boolean;
  loop: boolean;
}

export interface Lane {
  kind: StringKind;
  /** 世界里的弦 id（实体弦为「实体.名字」）。 */
  id: string;
  /** 世界里的弦名（界面上左侧浮现的名字）。 */
  name: string;
  /** 运行时原始值。 */
  value: number;
  min: number;
  max: number;
  /** 0..1：(value - min) / (max - min)。 */
  norm: number;
  /** 悬崖线 / 安全线的归一化位置。 */
  vergeNorm?: number;
  safeNorm?: number;
  /** 悬崖线 / 安全线的原始值（阈值编辑手势用）。 */
  verge?: number;
  safe?: number;
  /** v2.0：弦引用的音色谱（没有则不改变声音）。 */
  timbre?: TimbreCurve;
}

/** 调律台读取的一份世界切片。 */
export interface PlayActionView {
  id: string;
  name: string;
  note?: string;
  /** v3.2：动作耗时拍数（0 表示立即）。 */
  cost: number;
}

export interface WorldView {
  name: string;
  tick: number;
  ended: string | null;
  /** v3.2：结局发生的拍数；未结束为 null。 */
  endedTick: number | null;
  /** v3.2：这一局已经执行过的动作次数。 */
  actionsTaken: number;
  lanes: Lane[];
  /** 世界里的耦合关系（只用于画布上编辑强度）。 */
  couplings: CouplingLane[];
  /** v3.0：当前可执行的世界动作（供可玩层选择）。 */
  actions: PlayActionView[];
}

/** 一条耦合在界面上的投影：两端用世界弦 id 表示。 */
export interface CouplingLane {
  from: string;
  to: string;
  polarity: 1 | -1;
  strength: number;
  /** 属于哪条回路（若有）。 */
  loop?: string;
}

/**
 * 每类弦的默认设置值：从上到下均匀铺开，像八根悬在纸上的蛛丝。
 * 这些值只是调律台的初始状态，不是某个世界的真实数据。
 */
export const DEFAULT_VALUES: Record<StringKind, number> = {
  叙事: 85,
  视觉: 76,
  动画: 67,
  物理: 58,
  控制: 49,
  空间: 40,
  认知: 31,
  关系: 22,
};

/**
 * 每类弦的共振点（设置值）：基线经过这些高度时进入驻波/泛音态。
 * 相当于「这根弦在这个高度上会自己唱起来」。
 */
export const KIND_RESONANCE: Record<StringKind, readonly number[]> = {
  叙事: [50],
  视觉: [33, 66],
  动画: [25, 50, 75],
  物理: [50],
  控制: [40, 80],
  空间: [50],
  认知: [66],
  关系: [33, 66],
};

/** 共振带的半宽（设置值单位）。 */
export const RESONANCE_BAND = 3.5;

export interface ResonanceInfo {
  resonant: boolean;
  /** 最近的共振点；没有则 null。 */
  center: number | null;
  /** 0..1，越接近 1 越靠近共振中心。 */
  strength: number;
}

/** 当前设置值离本类弦的共振点有多近。 */
export function resonanceOf(kind: StringKind, value: number): ResonanceInfo {
  const bands = KIND_RESONANCE[kind] ?? [];
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const band of bands) {
    const distance = Math.abs(value - band);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = band;
    }
  }
  if (best === null) return { resonant: false, center: null, strength: 0 };
  const strength = clamp(1 - bestDistance / RESONANCE_BAND, 0, 1);
  return { resonant: bestDistance <= RESONANCE_BAND, center: best, strength };
}

/** 驻波/泛音的高频视觉偏移（-1..1），节点数 = harmonic，用于共振态。 */
export function standingOvertone(x01: number, timeMs: number, harmonic = 5): number {
  const x = clamp(x01, 0, 1);
  // 2.8Hz（原 4.5Hz）：焦点弦的微颤与共振泛音更慢、更柔和。
  return Math.sin(Math.PI * harmonic * x) * Math.cos((timeMs / 1000) * Math.PI * 2 * 2.8);
}

export interface CurveCrossing {
  /** 采样下标（0..n-1）。 */
  index: number;
  /** 横向归一化位置 0..1。 */
  x01: number;
  /** 交点的绝对 y。 */
  y: number;
}

/**
 * 两条「基线 + 位移」曲线的交点。
 * 用相邻采样之间的线性插值求 x，用于干涉/奇点与跨弦耦合。
 */
export function curveCrossings(
  displacementsA: readonly number[],
  baselineA: number,
  displacementsB: readonly number[],
  baselineB: number,
): CurveCrossing[] {
  const n = Math.min(displacementsA.length, displacementsB.length);
  if (n < 2) return [];
  const out: CurveCrossing[] = [];
  let prevDelta = baselineA + (displacementsA[0] ?? 0) - (baselineB + (displacementsB[0] ?? 0));
  for (let i = 1; i < n; i++) {
    const delta = baselineA + (displacementsA[i] ?? 0) - (baselineB + (displacementsB[i] ?? 0));
    if (prevDelta === 0 || (prevDelta < 0) !== (delta < 0)) {
      const denom = Math.abs(prevDelta) + Math.abs(delta);
      const t = denom > 1e-9 ? Math.abs(prevDelta) / denom : 0.5;
      const x01 = (i - 1 + t) / (n - 1);
      const y = baselineA + (displacementsA[i - 1] ?? 0) + ((displacementsA[i] ?? 0) - (displacementsA[i - 1] ?? 0)) * t;
      out.push({ index: i, x01: clamp(x01, 0, 1), y });
    }
    prevDelta = delta;
  }
  return out;
}
