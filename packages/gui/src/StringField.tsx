/**
 * 单弦调律台 v0.7「八弦叠影」：一张白纸，八根弦同时悬在纸上。
 *
 * - 8 类弦同时绘制：每根弦有自己的设置值 value（0..100 ↔ 基线 y 790..110），
 *   静止时像八根蛛丝；左侧 x≈64 各有一个极淡衬线类名。
 * - Tab / Shift+Tab 切焦点：焦点弦近黑、粗、带极轻的高频驻波抖动；其余七根半透明淡线。
 * - 在焦点弦曲线 ±16px 内拖动上下 = 改设置值；若按下后几乎没动（<5px/<200ms）则算点触。
 * - 点触 / 键盘 = 拨动焦点弦（局部行波、波峰更粗、运动模糊 + 黑色帧残留、触点淡字）。
 * - 干涉：每帧计算 8 根弦两两曲线交点，画「奇点」；悬停交点浮出「A × B」。
 *   焦点弦的波经过交点时把波动耦合给另一根弦（带 400ms 冷却 + 扩散光晕）。
 * - 共振：焦点弦 value 落在该类的共振点上 → 驻波泛音 + 双层虚影 + 左侧刻度；
 *   此时拨弦 = 和弦（同时激发其余七根 + 补一个高五度音）。
 * - D-膜：焦点弦两端有半透明短膜，可横向拖动改变跨度 span（0.55..1，清波重建 sim）。
 * - 紧致化结点：焦点弦 x=xL+0.62*(xR-xL) 处的小结点，悬停 + 滚轮调 micro（影响阻尼）。
 * - 对偶：焦点弦值在极值（≤2 / ≥98）时一次幅度 >170 的拨动 → 700ms 塌缩成环，
 *   结束把 value 翻到对侧（100-value）、清波、高八度拨一声。
 * - ESC 保留 v0.6 的 8 行签名波总谱（当前类实黑、Tab 可切、点行选中返回）。
 * - 纯黑白（var(--ink)/var(--paper) 与灰度），无面板/数字/其它常驻说明；
 *   canvas 透明，唯一收指针事件的元素是整屏 canvas。
 */
import { useEffect, useRef, useState } from 'react';
import type { StringKind } from '@neurou/core';
import {
  DEFAULT_VALUES,
  KEY_COUNT,
  KIND_ORDER,
  KIND_RESONANCE,
  KIND_VISUAL,
  LOGICAL_H,
  LOGICAL_W,
  STRING_N,
  StringSim,
  curveCrossings,
  keyAtPoint,
  keyByCode,
  layoutKeyboard,
  nextKind,
  resonanceOf,
  signature,
  standingOvertone,
  valueToY,
  yToValue,
  type KindVisualProfile,
  type TouchPoint,
} from './stringMath.js';
import { getStringAudio, type StringAudioState } from './stringAudio.js';
import './string-field.css';

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

type ViewMode = 'strings' | 'overview';
type Rgb = readonly [number, number, number];

/** 焦点弦：近黑、粗、带驻波抖动。 */
const FOCUS_WIDTH_BASE = 2.2;
const FOCUS_ALPHA = 0.9;
const FOCUS_JITTER_PX = 0.6;
/** 非焦点弦：各自 restWidth 的 0.85（1.3–1.7px，八根粗细不同）、基础 alpha 0.20 再按 index ±0.03。 */
const OTHER_WIDTH_SCALE = 0.85;
const OTHER_ALPHA = 0.2;
const OTHER_ALPHA_STEP = 0.03;
/** 共振态。 */
const RESONANCE_OVERTONE_PX = 1.4;
/** 线宽/alpha 的量化档数。 */
const BAND_COUNT = 9;

/** 触点淡字 / Tab 类名浮现 / 总览淡入淡出。 */
const GHOST_FADE_MS = 550;
const HINT_FADE_MS = 1400;
const OVERVIEW_FADE_MS = 180;

/** 点触判定（时间 / 位移）。 */
const TAP_MS = 200;
const TAP_MOVE_PX = 5;

/** 交互几何。 */
const VALUE_DRAG_PX = 16;
const MEMBRANE_X_PX = 40;
const MEMBRANE_Y_PX = 34;
const SPAN_MIN = 0.55;
const MICRO_STEP = 0.08;
const NODE_HOVER_PX = 22;
const CROSS_HOVER_PX = 16;
/** 行波上的交点移动极快，命中后让标签滞留一小会儿，否则几乎看不清。 */
const CROSS_HOVER_LINGER_MS = 350;
/** 交点最近 250ms 的轨迹：指针靠近「刚经过的交点」也算命中（16px 内）。 */
const CROSS_TRAIL_MS = 250;

/** 跨弦耦合。 */
const COUPLE_COOLDOWN_MS = 400;
const COUPLE_AMP_RATIO = 0.28;
const COUPLE_AMP_MIN = 8;
const COUPLE_AMP_MAX = 60;
const COUPLE_U_MIN = 10;
const RIPPLE_MS = 700;

/** 对偶翻转。 */
const DUAL_MS = 700;
const DUAL_AMP_MIN = 170;
const DUAL_LOW = 2;
const DUAL_HIGH = 98;

/** trail（只焦点弦画）。 */
const TRAIL_DECAY = 0.12;
const TRAIL_ALPHA = 0.5;
const TRAIL_BLUR_PX = 6;
const TRAIL_FRAME_BLUR_PX = 1.5;
const TRAIL_SETTLE_SECONDS = 0.55;

/** 总览。 */
const OVERVIEW_TOP = 90;
const OVERVIEW_BOTTOM = 810;
const OVERVIEW_LEFT = 160;
const OVERVIEW_RIGHT = 1280;
const OVERVIEW_WAVE_PX = 26;
const OVERVIEW_LABEL_X = 96;
const OVERVIEW_STEPS = 256;

/** 左侧常驻类名。 */
const LABEL_X = 64;
const LABEL_FONT_PX = 12;
/** 触点淡字 / Tab 类名。 */
const GHOST_FONT_PX = 30;
const GHOST_ALPHA = 0.35;
const HINT_FONT_PX = 15;
const HINT_ALPHA = 0.3;

const DEFAULT_SERIF = '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", Georgia, serif';
const FALLBACK_INK: Rgb = [11, 11, 11];

interface GhostMark {
  text: string;
  x: number;
  y: number;
  born: number;
}

interface HintMark {
  text: string;
  born: number;
}

interface Ripple {
  x: number;
  y: number;
  born: number;
}

/** 内部交点：a/b 是 KIND_ORDER 下标。 */
interface CrossingHit {
  a: number;
  b: number;
  x: number;
  y: number;
  x01: number;
  uA: number;
  uB: number;
}

interface CrossingTrailPoint {
  a: number;
  b: number;
  x: number;
  y: number;
  born: number;
}

type DragKind = 'value' | 'membrane' | 'pluck';

interface PointerDrag {
  kind: DragKind;
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  startValue: number;
  side: -1 | 1;
  moved: boolean;
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp(alpha, 0, 1)})`;
}

/** 解析 CSS 颜色变量（#rgb / #rrggbb / rgb() / rgba()）成 RGB 三元组。 */
function parseCssColor(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1];
    if (!digits) return null;
    if (digits.length === 3) {
      return [
        Number.parseInt(digits[0]! + digits[0]!, 16),
        Number.parseInt(digits[1]! + digits[1]!, 16),
        Number.parseInt(digits[2]! + digits[2]!, 16),
      ];
    }
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgb) {
    const parts = rgb[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      return [clamp(parts[0]!, 0, 255), clamp(parts[1]!, 0, 255), clamp(parts[2]!, 0, 255)];
    }
  }
  return null;
}

/** 在采样数组的归一化位置 x01 处线性插值。 */
function sampleAt(samples: readonly number[], x01: number): number {
  const count = samples.length;
  if (count === 0) return 0;
  const position = clamp(x01, 0, 1) * (count - 1);
  const index = Math.floor(position);
  const frac = position - index;
  const a = samples[index] ?? 0;
  const b = samples[Math.min(count - 1, index + 1)] ?? 0;
  return a + (b - a) * frac;
}

declare global {
  interface Window {
    __neurouString?: {
      state: () => {
        kind: StringKind;
        kindIndex: number;
        mode: ViewMode;
        plucks: number;
        audio: StringAudioState;
        keyCount: number;
        overviewRows: number;
        values: number[];
        span: number;
        resonant: boolean;
        resonance: number | null;
        micro: number;
        dual: boolean;
        crossings: number;
        amplitude: number;
      };
      u: () => number[];
      curves: () => Array<{ kind: StringKind; value: number; baseline: number; samples: number[] }>;
      crossings: () => Array<{ a: StringKind; b: StringKind; x: number; y: number }>;
      lastTouch: () => {
        x: number;
        y: number;
        amplitude: number;
        direction: 1 | -1;
        keyCode: string;
      } | null;
      pluckAt: (x: number, y: number) => void;
      pressKey: (code: string) => void;
      reset: () => void;
      setValue: (kind: StringKind, value: number) => void;
      setSpan: (span: number) => void;
      setMicro: (micro: number) => void;
      rms: () => number;
    };
  }
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export function StringField(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [mode, setMode] = useState<ViewMode>('strings');
  const [focusIndex, setFocusIndex] = useState(0);
  const [plucks, setPlucks] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [resting, setResting] = useState(true);
  const [audioState, setAudioState] = useState<StringAudioState>('off');
  const [values, setValues] = useState<number[]>(() => KIND_ORDER.map((kind) => DEFAULT_VALUES[kind]));
  const [spanUi, setSpanUi] = useState(1);
  const [microUi, setMicroUi] = useState(0.5);
  const [dualUi, setDualUi] = useState(false);
  const [resonantUi, setResonantUi] = useState(false);
  const [resonanceUi, setResonanceUi] = useState<number | null>(null);
  const [crossingsCountUi, setCrossingsCountUi] = useState(0);
  const [lastKey, setLastKey] = useState('');
  const [lastAmplitude, setLastAmplitude] = useState(0);
  const [lastDirection, setLastDirection] = useState<'up' | 'down'>('down');

  useEffect(() => {
    const hostElement = hostRef.current;
    const canvasElement = canvasRef.current;
    if (!hostElement || !canvasElement) return;
    const contextMaybe = canvasElement.getContext('2d');
    if (!contextMaybe) return;
    const trailElement = document.createElement('canvas');
    const trailContextMaybe = trailElement.getContext('2d');
    if (!trailContextMaybe) return;

    // 类型收窄后的非空别名（嵌套函数里直接用）。
    const host = hostElement;
    const canvas = canvasElement;
    const ctx = contextMaybe;
    const trailCanvas = trailElement;
    const trailCtx = trailContextMaybe;

    const audio = getStringAudio();
    const keys = layoutKeyboard();
    const sims: StringSim[] = KIND_ORDER.map(() => new StringSim(STRING_N, LOGICAL_W));
    const focusDispBuf = new Float32Array(STRING_N);
    const trailDispBuf = new Float32Array(STRING_N);
    const curveBufs: number[][] = KIND_ORDER.map(() => new Array<number>(STRING_N).fill(0));

    /* —— 可变状态（闭包内，避免每帧 setState） —— */
    const valuesNow: number[] = KIND_ORDER.map((kind) => DEFAULT_VALUES[kind]);
    let focusIdx = 0;
    let modeNow: ViewMode = 'strings';
    let plucksNow = 0;
    let pullingNow = false;
    let restingNow = true;
    let spanNow = 1;
    let microNow = 0.5;
    let resonantNow = false;
    let resonanceCenterNow: number | null = null;
    let dualNow = false;
    let dualStartedAt = 0;
    let dualFromValue = 0;

    let crossingsNow: CrossingHit[] = [];
    let crossingsCountNow = 0;
    let crossingTrail: CrossingTrailPoint[] = [];
    const lastCouple: number[] = KIND_ORDER.map(() => Number.NEGATIVE_INFINITY);

    let drag: PointerDrag | null = null;
    let pointerNow: { x: number; y: number } | null = null;
    let hoverNodeNow = false;
    let hoverCrossNow: CrossingHit | null = null;
    let hoverPairNow: { a: number; b: number } | null = null;
    let hoverLatchUntil = 0;
    let ripples: Ripple[] = [];
    const ghostMarks: GhostMark[] = [];
    let hintMark: HintMark | null = null;

    let chartAlpha = 0;
    let chartTarget = 0;
    let trailActive = false;
    let trailSettle = 0;
    let lastFrame = 0;
    let requestId = 0;

    let scaleX = 1;
    let scaleY = 1;
    let ink: Rgb = FALLBACK_INK;
    let serif = DEFAULT_SERIF;
    let lastTouchNow: {
      x: number;
      y: number;
      amplitude: number;
      direction: 1 | -1;
      keyCode: string;
    } | null = null;

    /* —— 基础读取 —— */
    function kindOf(index: number): StringKind {
      return KIND_ORDER[index] ?? '叙事';
    }

    function profileOf(index: number): KindVisualProfile {
      return KIND_VISUAL[kindOf(index)];
    }

    function baselineOf(index: number): number {
      return valueToY(valuesNow[index] ?? 0);
    }

    function focusGeom(): { xL: number; xR: number; width: number } {
      const width = spanNow * LOGICAL_W;
      const xL = (LOGICAL_W - width) / 2;
      return { xL, xR: xL + width, width };
    }

    function focusBaseline(): number {
      return baselineOf(focusIdx);
    }

    /** 某根弦在屏幕 x 处的物理曲线 y。 */
    function curveYAt(index: number, screenX: number): number {
      const sim = sims[index] ?? sims[0]!;
      const baseline = baselineOf(index);
      const sp = sim.u();
      if (index === focusIdx) {
        const geom = focusGeom();
        const local = clamp(screenX - geom.xL, 0, geom.width);
        const x01 = geom.width > 0 ? local / geom.width : 0.5;
        return baseline + sampleAt(Array.from(sp), x01);
      }
      return baseline + sampleAt(Array.from(sp), clamp(screenX / LOGICAL_W, 0, 1));
    }

    /* —— UI 状态镜像 —— */
    function setPullingUi(value: boolean): void {
      if (pullingNow === value) return;
      pullingNow = value;
      setPulling(value);
    }

    function setRestingUi(value: boolean): void {
      if (restingNow === value) return;
      restingNow = value;
      setResting(value);
    }

    function setModeUi(value: ViewMode): void {
      if (modeNow === value) return;
      modeNow = value;
      setMode(value);
    }

    function bumpPlucks(): void {
      plucksNow += 1;
      setPlucks(plucksNow);
    }

    function pushGhost(text: string, x: number, y: number): void {
      if (!text) return;
      ghostMarks.push({ text, x, y, born: performance.now() });
      if (ghostMarks.length > 4) ghostMarks.splice(0, ghostMarks.length - 4);
    }

    function noteTouch(x: number, y: number, amplitude: number, direction: 1 | -1, keyCode: string): void {
      lastTouchNow = { x, y, amplitude, direction, keyCode };
      setLastKey(keyCode);
      setLastAmplitude(Math.round(amplitude * 10) / 10);
      setLastDirection(direction < 0 ? 'up' : 'down');
    }

    function applyValue(index: number, value: number): void {
      const nextValue = clamp(value, 0, 100);
      if (valuesNow[index] === nextValue) return;
      valuesNow[index] = nextValue;
      setValues(valuesNow.slice());
      if (index === focusIdx) updateResonanceUi();
    }

    function updateResonanceUi(): void {
      const info = resonanceOf(kindOf(focusIdx), valuesNow[focusIdx] ?? 0);
      if (info.resonant !== resonantNow) {
        resonantNow = info.resonant;
        setResonantUi(info.resonant);
      }
      const center = info.resonant ? info.center : null;
      if (center !== resonanceCenterNow) {
        resonanceCenterNow = center;
        setResonanceUi(center);
      }
    }

    function setSpanValue(nextSpan: number): void {
      spanNow = clamp(nextSpan, SPAN_MIN, 1);
      setSpanUi(spanNow);
      rebuildFocusSim();
    }

    function setMicroValue(nextMicro: number): void {
      microNow = clamp(nextMicro, 0, 1);
      setMicroUi(microNow);
    }

    function setCrossingsCount(value: number): void {
      if (crossingsCountNow === value) return;
      crossingsCountNow = value;
      setCrossingsCountUi(value);
    }

    /* —— 主题与画布尺寸 —— */
    function readTheme(): void {
      const style = getComputedStyle(host);
      ink = parseCssColor(style.getPropertyValue('--ink')) ?? FALLBACK_INK;
      const serifValue = style.getPropertyValue('--serif').trim();
      serif = serifValue || DEFAULT_SERIF;
    }

    function resize(): void {
      const rect = host.getBoundingClientRect();
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      trailCanvas.width = pixelWidth;
      trailCanvas.height = pixelHeight;
      scaleX = pixelWidth / LOGICAL_W;
      scaleY = pixelHeight / LOGICAL_H;
    }

    function pointToLogical(clientX: number, clientY: number): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width || 1;
      const height = rect.height || 1;
      return {
        x: clamp(((clientX - rect.left) / width) * LOGICAL_W, 0, LOGICAL_W),
        y: clamp(((clientY - rect.top) / height) * LOGICAL_H, 0, LOGICAL_H),
      };
    }

    /* —— sim 重建 —— */
    function rebuildFocusSim(): void {
      sims[focusIdx] = new StringSim(STRING_N, focusGeom().width);
      clearTrail();
      setRestingUi(true);
    }

    function changeFocus(index: number): void {
      if (index === focusIdx) return;
      // 旧焦点回归全宽（清掉它的局部波），新焦点按当前 span 重建。
      sims[focusIdx] = new StringSim(STRING_N, LOGICAL_W);
      focusIdx = clamp(index, 0, KIND_ORDER.length - 1);
      setFocusIndex(focusIdx);
      sims[focusIdx] = new StringSim(STRING_N, focusGeom().width);
      clearTrail();
      updateResonanceUi();
      setRestingUi(true);
    }

    /* —— trail —— */
    function clearTrail(): void {
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
      trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      trailActive = false;
      trailSettle = 0;
    }

    function updateTrail(): void {
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
      trailCtx.globalCompositeOperation = 'destination-out';
      trailCtx.globalAlpha = TRAIL_DECAY;
      trailCtx.fillStyle = '#000000';
      trailCtx.fillRect(0, 0, trailCanvas.width, trailCanvas.height);
      trailCtx.globalAlpha = 1;
      trailCtx.globalCompositeOperation = 'source-over';
      trailCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      const sim = sims[focusIdx]!;
      const u = sim.u();
      for (let i = 0; i < STRING_N; i += 1) trailDispBuf[i] = u[i] ?? 0;
      trailCtx.filter = `blur(${TRAIL_BLUR_PX}px)`;
      strokeFocus(trailCtx, trailDispBuf, TRAIL_ALPHA * 0.62, false);
      trailCtx.filter = `blur(${TRAIL_FRAME_BLUR_PX}px)`;
      strokeFocus(trailCtx, trailDispBuf, TRAIL_ALPHA * 0.38, false);
      trailCtx.filter = 'none';
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* —— 绘制基础 —— */

    /** 焦点弦：按 |u|/maxPull 分档的变宽墨线（trail 也用它）。 */
    function strokeFocus(
      target: CanvasRenderingContext2D,
      displacement: Float32Array,
      alphaScale: number,
      withBleed: boolean,
      baselineOffset = 0,
    ): void {
      const geom = focusGeom();
      const baseline = focusBaseline() + baselineOffset;
      const profile = profileOf(focusIdx);
      const count = displacement.length;
      if (count < 2) return;
      const stepX = geom.width / (count - 1);
      const baseWidth = Math.max(FOCUS_WIDTH_BASE, profile.restWidth);
      const maxPull = Math.max(1, profile.maxPull);
      const paths: Path2D[] = [];
      for (let band = 0; band < BAND_COUNT; band += 1) paths.push(new Path2D());
      const fullPath = new Path2D();
      let previousBand = -1;
      for (let i = 0; i < count - 1; i += 1) {
        const ua = displacement[i] ?? 0;
        const ub = displacement[i + 1] ?? 0;
        const ratio = Math.min(1, (Math.abs(ua) + Math.abs(ub)) * 0.5 / maxPull);
        let band = Math.floor(ratio * BAND_COUNT);
        if (band < 0) band = 0;
        if (band > BAND_COUNT - 1) band = BAND_COUNT - 1;
        const x1 = geom.xL + i * stepX;
        const y1 = baseline + ua;
        const x2 = geom.xL + (i + 1) * stepX;
        const y2 = baseline + ub;
        if (i === 0) fullPath.moveTo(x1, y1);
        fullPath.lineTo(x2, y2);
        const path = paths[band]!;
        if (band !== previousBand) {
          path.moveTo(x1, y1);
          path.lineTo(x2, y2);
          previousBand = band;
        } else {
          path.lineTo(x2, y2);
        }
      }
      target.lineCap = 'round';
      target.lineJoin = 'round';
      if (withBleed) {
        target.strokeStyle = rgba(ink, 0.05 * alphaScale);
        target.lineWidth = baseWidth * 3;
        target.stroke(fullPath);
      }
      for (let band = 0; band < BAND_COUNT; band += 1) {
        const ratio = BAND_COUNT <= 1 ? 1 : band / (BAND_COUNT - 1);
        target.strokeStyle = rgba(ink, (FOCUS_ALPHA - 0.02 + 0.09 * ratio) * alphaScale);
        target.lineWidth = baseWidth + profile.peakWidth * ratio * 0.9;
        target.stroke(paths[band]!);
      }
    }

    /** 非焦点弦：不同粗细 / 不同透明度的细线（有耦合波时略深一点）。 */
    function drawOtherString(index: number): void {
      const sim = sims[index]!;
      const profile = profileOf(index);
      const baseline = baselineOf(index);
      const u = sim.u();
      const count = u.length;
      const stepX = LOGICAL_W / (count - 1);
      const amplitude = sim.amplitude();
      const width = profile.restWidth * OTHER_WIDTH_SCALE;
      const baseAlpha = OTHER_ALPHA + ((index % 3) - 1) * OTHER_ALPHA_STEP;
      const alpha =
        amplitude > 1 ? Math.min(0.34, baseAlpha + (amplitude / Math.max(1, profile.maxPull)) * 0.38) : baseAlpha;
      ctx.strokeStyle = rgba(ink, alpha);
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < count; i += 1) {
        const x = i * stepX;
        const y = baseline + (u[i] ?? 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    /** 焦点弦显示位移：物理 u + 高频驻波抖动（+ 共振泛音）。 */
    function focusDisplayU(now: number, includeResonance: boolean): Float32Array {
      const sim = sims[focusIdx]!;
      const u = sim.u();
      const count = u.length;
      const resonance = includeResonance && resonantNow;
      for (let i = 0; i < count; i += 1) {
        const x01 = count > 1 ? i / (count - 1) : 0.5;
        let value = u[i] ?? 0;
        value += standingOvertone(x01, now, 3) * FOCUS_JITTER_PX;
        if (resonance) value += standingOvertone(x01, now, 5) * RESONANCE_OVERTONE_PX;
        focusDispBuf[i] = value;
      }
      return focusDispBuf;
    }

    function drawMembranes(geom: { xL: number; xR: number }): void {
      const baseline = focusBaseline();
      const alpha = drag && drag.kind === 'membrane' ? 0.42 : 0.22;
      ctx.strokeStyle = rgba(ink, alpha);
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      for (const x of [geom.xL, geom.xR]) {
        ctx.beginPath();
        ctx.moveTo(x, baseline - 12);
        ctx.lineTo(x, baseline + 12);
        ctx.stroke();
      }
    }

    function drawCompactNode(geom: { xL: number; width: number }): void {
      const nodeX = geom.xL + 0.62 * geom.width;
      const sim = sims[focusIdx]!;
      const local = nodeX - geom.xL;
      const x01 = geom.width > 0 ? local / geom.width : 0.5;
      const nodeY = focusBaseline() + sampleAt(Array.from(sim.u()), x01);
      ctx.fillStyle = rgba(ink, 0.26);
      ctx.beginPath();
      ctx.arc(nodeX, nodeY, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(ink, 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(nodeX, nodeY, 2.5, 0, Math.PI * 2);
      ctx.stroke();
      if (hoverNodeNow) {
        const radius = 6 + microNow * 8;
        ctx.strokeStyle = rgba(ink, 0.18);
        ctx.lineWidth = 1;
        for (let petal = 0; petal < 4; petal += 1) {
          const angle = -Math.PI / 2 + (petal * Math.PI) / 2 + microNow * 0.7;
          const cx = nodeX + Math.cos(angle) * radius * 0.55;
          const cy = nodeY + Math.sin(angle) * radius * 0.55;
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1.5, radius * 0.42), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    function drawResonanceTicks(): void {
      const bands = KIND_RESONANCE[kindOf(focusIdx)] ?? [];
      if (bands.length === 0) return;
      ctx.strokeStyle = rgba(ink, 0.18);
      ctx.lineWidth = 1;
      for (const band of bands) {
        const y = valueToY(band);
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(52, y);
        ctx.stroke();
      }
    }

    function drawStringLabels(): void {
      ctx.font = `${LABEL_FONT_PX}px ${serif}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < KIND_ORDER.length; i += 1) {
        ctx.fillStyle = rgba(ink, i === focusIdx ? 0.55 : 0.2);
        ctx.fillText(profileOf(i).label, LABEL_X, baselineOf(i) - 7);
      }
      ctx.textAlign = 'center';
    }

    function drawCrossings(): void {
      for (const hit of crossingsNow) {
        const involved = hit.a === focusIdx || hit.b === focusIdx;
        ctx.fillStyle = rgba(ink, involved ? 0.13 : 0.075);
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(ink, involved ? 0.09 : 0.06);
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(ink, 0.3);
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawRipples(now: number): void {
      for (const ripple of ripples) {
        const progress = (now - ripple.born) / RIPPLE_MS;
        if (progress < 0 || progress >= 1) continue;
        const radius = 6 + progress * 30;
        ctx.strokeStyle = rgba(ink, (1 - progress) * 0.18);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function drawDualRing(now: number): void {
      const progress = clamp((now - dualStartedAt) / DUAL_MS, 0, 1);
      const radius = 8 + progress * 38;
      ctx.strokeStyle = rgba(ink, 0.5 * (1 - progress * 0.45));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(LOGICAL_W / 2, focusBaseline(), radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    function drawTextOverlays(now: number): void {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const mark of ghostMarks) {
        const progress = (now - mark.born) / GHOST_FADE_MS;
        if (progress < 0 || progress >= 1) continue;
        ctx.font = `${GHOST_FONT_PX}px ${serif}`;
        ctx.fillStyle = rgba(ink, GHOST_ALPHA * Math.pow(1 - progress, 1.35));
        ctx.fillText(mark.text, mark.x, mark.y);
      }
      if (hintMark) {
        const progress = (now - hintMark.born) / HINT_FADE_MS;
        if (progress >= 0 && progress < 1) {
          const geom = focusGeom();
          ctx.font = `${HINT_FONT_PX}px ${serif}`;
          ctx.textAlign = 'left';
          ctx.fillStyle = rgba(ink, HINT_ALPHA * (1 - progress));
          ctx.fillText(hintMark.text, Math.max(40, geom.xL + 16), focusBaseline() - 28);
          ctx.textAlign = 'center';
        }
      }
      if (hoverPairNow) {
        const anchorX = (pointerNow ? pointerNow.x : (hoverCrossNow?.x ?? 0)) + 12;
        const anchorY = pointerNow ? pointerNow.y - 16 : (hoverCrossNow?.y ?? 0) - 16;
        ctx.font = `11px ${serif}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = rgba(ink, 0.35);
        ctx.fillText(`${profileOf(hoverPairNow.a).label} × ${profileOf(hoverPairNow.b).label}`, anchorX, anchorY);
        ctx.textAlign = 'center';
      }
    }

    /* —— 场景 —— */
    function renderStringsScene(now: number): void {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (trailActive) ctx.drawImage(trailCanvas, 0, 0);
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

      const geom = focusGeom();
      for (let i = 0; i < KIND_ORDER.length; i += 1) {
        if (i !== focusIdx) drawOtherString(i);
      }

      // 共振虚影（±5px 两层极淡倒影）
      if (resonantNow && !dualNow) {
        const ghostDisp = focusDisplayU(now, true);
        strokeFocus(ctx, ghostDisp, 0.07, false, -5);
        strokeFocus(ctx, ghostDisp, 0.07, false, 5);
      }

      drawMembranes(geom);
      drawCompactNode(geom);

      if (dualNow) {
        const progress = clamp((now - dualStartedAt) / DUAL_MS, 0, 1);
        const disp = focusDisplayU(now, false);
        strokeFocus(ctx, disp, 1 - progress, false);
      } else {
        const disp = focusDisplayU(now, true);
        strokeFocus(ctx, disp, 1, true);
      }

      drawCrossings();
      drawRipples(now);
      drawStringLabels();
      if (resonantNow) drawResonanceTicks();
      drawTextOverlays(now);
      if (dualNow) drawDualRing(now);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function drawOverviewScene(): void {
      const alpha = chartAlpha;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      if (alpha <= 0) return;
      const rowGap = (OVERVIEW_BOTTOM - OVERVIEW_TOP) / (KIND_ORDER.length - 1);
      for (let i = 0; i < KIND_ORDER.length; i += 1) {
        const kind = kindOf(i);
        const profile = KIND_VISUAL[kind];
        const rowY = OVERVIEW_TOP + rowGap * i;
        const active = i === focusIdx;
        ctx.font = `14px ${serif}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = rgba(ink, 0.32 * alpha);
        ctx.fillText(profile.label, OVERVIEW_LABEL_X, rowY);
        ctx.beginPath();
        for (let step = 0; step <= OVERVIEW_STEPS; step += 1) {
          const t = step / OVERVIEW_STEPS;
          const x = OVERVIEW_LEFT + (OVERVIEW_RIGHT - OVERVIEW_LEFT) * t;
          const y = rowY + signature(kind, t) * OVERVIEW_WAVE_PX;
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = rgba(ink, (active ? 0.85 : 0.12) * alpha);
        ctx.lineWidth = active ? 2.2 : 1;
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* —— 干涉 / 耦合 —— */
    function buildCrossings(): CrossingHit[] {
      const baselines = KIND_ORDER.map((_, index) => baselineOf(index));
      const curveAmp: number[] = KIND_ORDER.map(() => 0);
      for (let index = 0; index < KIND_ORDER.length; index += 1) {
        const sim = sims[index]!;
        const u = sim.u();
        const buf = curveBufs[index]!;
        if (index === focusIdx) {
          const geom = focusGeom();
          const flat = Array.from(u);
          for (let sample = 0; sample < STRING_N; sample += 1) {
            const x = (sample / (STRING_N - 1)) * LOGICAL_W;
            const t = geom.width > 0 ? (x - geom.xL) / geom.width : 0.5;
            buf[sample] = t < 0 || t > 1 ? 0 : sampleAt(flat, t);
          }
        } else {
          for (let sample = 0; sample < STRING_N; sample += 1) buf[sample] = u[sample] ?? 0;
        }
        let amp = 0;
        for (let sample = 0; sample < STRING_N; sample += 1) {
          const abs = Math.abs(buf[sample] ?? 0);
          if (abs > amp) amp = abs;
        }
        curveAmp[index] = amp;
      }
      const list: CrossingHit[] = [];
      for (let a = 0; a < KIND_ORDER.length; a += 1) {
        for (let b = a + 1; b < KIND_ORDER.length; b += 1) {
          const diff = Math.abs(baselines[a]! - baselines[b]!);
          // 基线几乎重合且两根都静止 = 两条线叠在一起，不产生「交点」（否则会刷出一整条线）。
          if (diff < 0.75 && curveAmp[a]! < 0.5 && curveAmp[b]! < 0.5) continue;
          const hits = curveCrossings(curveBufs[a]!, baselines[a]!, curveBufs[b]!, baselines[b]!);
          for (const hit of hits) {
            list.push({
              a,
              b,
              x: hit.x01 * LOGICAL_W,
              y: hit.y,
              x01: hit.x01,
              uA: sampleAt(curveBufs[a]!, hit.x01),
              uB: sampleAt(curveBufs[b]!, hit.x01),
            });
          }
        }
      }
      return list;
    }

    function coupleWaves(now: number): void {
      if (dualNow || crossingsNow.length === 0) return;
      for (const hit of crossingsNow) {
        let other = -1;
        let focusU = 0;
        if (hit.a === focusIdx) {
          other = hit.b;
          focusU = hit.uA;
        } else if (hit.b === focusIdx) {
          other = hit.a;
          focusU = hit.uB;
        }
        if (other < 0) continue;
        if (Math.abs(focusU) <= COUPLE_U_MIN) continue;
        if (now - (lastCouple[other] ?? Number.NEGATIVE_INFINITY) < COUPLE_COOLDOWN_MS) continue;
        lastCouple[other] = now;
        const otherProfile = profileOf(other);
        const away: 1 | -1 = baselineOf(other) < focusBaseline() ? -1 : 1;
        const amplitude = clamp(Math.abs(focusU) * COUPLE_AMP_RATIO, COUPLE_AMP_MIN, COUPLE_AMP_MAX);
        sims[other]!.pluck(
          { x: clamp(hit.x01 * LOGICAL_W, 0, LOGICAL_W), y: 0, amplitude, direction: away, key: null },
          otherProfile,
        );
        ripples.push({ x: hit.x, y: hit.y, born: now });
      }
    }

    /* —— 拨动 / 和弦 / 对偶 —— */
    function audioBegin(kind: StringKind, xNorm: number, yNorm: number, amplitudeNorm: number, pitchScale: number): void {
      void audio.ensureStarted();
      audio.pluck(kind, xNorm, yNorm, amplitudeNorm, pitchScale);
    }

    function chordOnPluck(center01: number, amplitude: number): void {
      for (let other = 0; other < KIND_ORDER.length; other += 1) {
        if (other === focusIdx) continue;
        let target01 = 0.5;
        for (const hit of crossingsNow) {
          if ((hit.a === focusIdx && hit.b === other) || (hit.b === focusIdx && hit.a === other)) {
            target01 = hit.x01;
            break;
          }
        }
        const otherProfile = profileOf(other);
        const away: 1 | -1 = baselineOf(other) < focusBaseline() ? -1 : 1;
        sims[other]!.pluck(
          {
            x: clamp(target01 * LOGICAL_W, 0, LOGICAL_W),
            y: 0,
            amplitude: clamp(amplitude * 0.3, 8, otherProfile.maxPull),
            direction: away,
            key: null,
          },
          otherProfile,
        );
      }
      const focusKind = kindOf(focusIdx);
      audioBegin(focusKind, clamp(center01 + 0.1, 0, 1), 0.5, 0.8, (1 / spanNow) * 1.5);
    }

    function startDual(): void {
      dualNow = true;
      dualStartedAt = performance.now();
      dualFromValue = valuesNow[focusIdx] ?? 0;
      setDualUi(true);
      drag = null;
      setPullingUi(false);
    }

    function finishDual(): void {
      const nextValue = clamp(100 - dualFromValue, 0, 100);
      valuesNow[focusIdx] = nextValue;
      setValues(valuesNow.slice());
      updateResonanceUi();
      sims[focusIdx] = new StringSim(STRING_N, focusGeom().width);
      clearTrail();
      dualNow = false;
      setDualUi(false);
      setRestingUi(true);
      audioBegin(kindOf(focusIdx), 0.5, 0.5, 0.8, (1 / spanNow) * 2);
    }

    /** 一次拨动焦点弦：screen 坐标为逻辑坐标。 */
    function pluckFocus(screenX: number, screenY: number, keyCode: string, ghostText?: string): void {
      if (dualNow) return;
      const geom = focusGeom();
      const baseline = focusBaseline();
      const profile = profileOf(focusIdx);
      const amplitude = Math.min(Math.abs(screenY - baseline), profile.maxPull);
      const direction: 1 | -1 = screenY < baseline ? -1 : 1;
      const localX = clamp(screenX - geom.xL, 0, geom.width);
      const center01 = geom.width > 0 ? localX / geom.width : 0.5;
      noteTouch(screenX, screenY, amplitude, direction, keyCode);
      bumpPlucks();
      if (ghostText) pushGhost(ghostText, screenX, screenY);
      const focusValue = valuesNow[focusIdx] ?? 0;
      if ((focusValue <= DUAL_LOW || focusValue >= DUAL_HIGH) && amplitude > DUAL_AMP_MIN) {
        startDual();
        return;
      }
      sims[focusIdx]!.pluck({ x: localX, y: screenY, amplitude, direction, key: null }, profile);
      audioBegin(
        kindOf(focusIdx),
        clamp(center01, 0, 1),
        clamp(screenY / LOGICAL_H, 0, 1),
        clamp(amplitude / Math.max(1, profile.maxPull), 0, 1),
        1 / spanNow,
      );
      if (resonantNow) chordOnPluck(center01, amplitude);
      trailSettle = 0;
      setRestingUi(false);
    }

    function demoPluck(): void {
      if (dualNow) return;
      const geom = focusGeom();
      const profile = profileOf(focusIdx);
      sims[focusIdx]!.pluck(
        { x: geom.width / 2, y: focusBaseline(), amplitude: profile.maxPull * 0.5, direction: 1, key: null },
        profile,
      );
      bumpPlucks();
      audioBegin(kindOf(focusIdx), 0.5, 0.5, 0.5, 1 / spanNow);
      trailSettle = 0;
      setRestingUi(false);
    }

    /* —— 焦点切换 / 总览 —— */
    function switchFocus(step: number, demonstrate: boolean): void {
      if (dualNow) return;
      const next = nextKind(kindOf(focusIdx), step);
      const nextIndex = KIND_ORDER.indexOf(next);
      changeFocus(nextIndex < 0 ? 0 : nextIndex);
      hintMark = { text: `${profileOf(focusIdx).label}弦`, born: performance.now() };
      if (demonstrate) demoPluck();
    }

    function enterOverview(): void {
      if (modeNow === 'overview') return;
      setModeUi('overview');
      chartTarget = 1;
      drag = null;
      setPullingUi(false);
      ghostMarks.length = 0;
      hintMark = null;
      ripples = [];
      audio.reset();
      clearTrail();
      setRestingUi(sims[focusIdx]!.resting());
    }

    function leaveOverview(): void {
      if (modeNow !== 'overview') return;
      setModeUi('strings');
      chartTarget = 0;
    }

    function toggleOverview(): void {
      if (dualNow) return;
      if (modeNow === 'overview') leaveOverview();
      else enterOverview();
    }

    function selectOverviewRow(logicalY: number): void {
      if (dualNow) return;
      const rowGap = (OVERVIEW_BOTTOM - OVERVIEW_TOP) / (KIND_ORDER.length - 1);
      const row = clamp(Math.round((logicalY - OVERVIEW_TOP) / rowGap), 0, KIND_ORDER.length - 1);
      changeFocus(row);
      setModeUi('strings');
      chartTarget = 0;
      hintMark = { text: `${profileOf(focusIdx).label}弦`, born: performance.now() };
      demoPluck();
      clearTrail();
    }

    /* —— 输入 —— */
    function onPointerDown(event: PointerEvent): void {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (drag !== null) return;
      const point = pointToLogical(event.clientX, event.clientY);
      pointerNow = point;
      if (modeNow === 'overview') {
        selectOverviewRow(point.y);
        return;
      }
      if (dualNow) return;
      event.preventDefault();
      const geom = focusGeom();
      const baseline = focusBaseline();
      const startValue = valuesNow[focusIdx] ?? 0;
      const common = {
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        startedAt: performance.now(),
        startValue,
        moved: false,
      };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      setPullingUi(true);
      // 1) 焦点弦两端的 D-膜：横向拖动改 span。
      const nearLeft = Math.abs(point.x - geom.xL) <= MEMBRANE_X_PX;
      const nearRight = Math.abs(point.x - geom.xR) <= MEMBRANE_X_PX;
      if ((nearLeft || nearRight) && Math.abs(point.y - baseline) <= MEMBRANE_Y_PX) {
        drag = {
          ...common,
          kind: 'membrane',
          side: Math.abs(point.x - geom.xL) <= Math.abs(point.x - geom.xR) ? -1 : 1,
        };
        return;
      }
      // 2) 焦点弦曲线 ±16px：上下拖动改 value；几乎没动则是点触。
      if (Math.abs(point.y - curveYAt(focusIdx, point.x)) <= VALUE_DRAG_PX) {
        drag = { ...common, kind: 'value', side: 1 };
        return;
      }
      // 3) 其它位置：点触 = 拨弦。
      drag = { ...common, kind: 'pluck', side: 1 };
    }

    function onPointerMove(event: PointerEvent): void {
      const point = pointToLogical(event.clientX, event.clientY);
      pointerNow = point;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      if (Math.hypot(dx, dy) > TAP_MOVE_PX) drag.moved = true;
      if (drag.kind === 'value') {
        applyValue(focusIdx, yToValue(valueToY(drag.startValue) + dy));
      } else if (drag.kind === 'membrane') {
        const half = LOGICAL_W / 2;
        const nextSpan = drag.side < 0 ? 1 - point.x / half : point.x / half - 1;
        const clamped = clamp(nextSpan, SPAN_MIN, 1);
        if (Math.abs(clamped - spanNow) > 0.001) {
          spanNow = clamped;
          setSpanUi(spanNow);
          rebuildFocusSim();
        }
      }
    }

    function onPointerUp(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const current = drag;
      drag = null;
      try {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      setPullingUi(false);
      const elapsed = performance.now() - current.startedAt;
      const quickTap = !current.moved && elapsed < TAP_MS;
      if (current.kind === 'value') {
        if (quickTap) {
          applyValue(focusIdx, current.startValue);
          const key = keyAtPoint(keys, current.startX, current.startY);
          pluckFocus(current.startX, current.startY, key ? key.code : '', key ? key.label : '');
        }
        return;
      }
      if (current.kind === 'pluck' && quickTap) {
        const key = keyAtPoint(keys, current.startX, current.startY);
        pluckFocus(current.startX, current.startY, key ? key.code : '', key ? key.label : '');
      }
    }

    function onWheel(event: WheelEvent): void {
      if (!hoverNodeNow || modeNow !== 'strings' || dualNow) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? 1 : -1;
      setMicroValue(microNow + direction * MICRO_STEP);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Tab') {
        event.preventDefault();
        if (dualNow) return;
        if (modeNow === 'overview') switchFocus(event.shiftKey ? -1 : 1, false);
        else switchFocus(event.shiftKey ? -1 : 1, true);
        return;
      }
      if (event.code === 'Escape') {
        event.preventDefault();
        toggleOverview();
        return;
      }
      if (modeNow === 'overview' || dualNow) return;
      const key = keyByCode(keys, event.code);
      if (!key) return;
      event.preventDefault();
      const label = event.key.length === 1 ? event.key : key.label;
      pluckFocus(key.cx, key.cy, event.code, label);
    }

    /* —— 每帧 —— */
    function stepSims(dt: number): void {
      const focusSim = sims[focusIdx]!;
      if (!dualNow && !focusSim.resting()) {
        const base = profileOf(focusIdx);
        focusSim.step(dt, { ...base, damping: base.damping * (0.45 + microNow * 1.6) });
      }
      for (let i = 0; i < KIND_ORDER.length; i += 1) {
        if (i === focusIdx) continue;
        const sim = sims[i]!;
        if (sim.resting()) continue;
        sim.step(dt, profileOf(i));
      }
    }

    function updateTrailState(dt: number): void {
      const sim = sims[focusIdx]!;
      if (!sim.resting()) {
        updateTrail();
        trailActive = true;
        trailSettle = 0;
        return;
      }
      if (!trailActive) return;
      updateTrail();
      trailSettle += dt;
      if (trailSettle >= TRAIL_SETTLE_SECONDS) clearTrail();
    }

    function updateHoverState(): void {
      if (!pointerNow || modeNow !== 'strings' || dualNow) {
        hoverNodeNow = false;
        hoverCrossNow = null;
        hoverPairNow = null;
        return;
      }
      const geom = focusGeom();
      const nodeX = geom.xL + 0.62 * geom.width;
      const nodeY = curveYAt(focusIdx, nodeX);
      hoverNodeNow = Math.hypot(pointerNow.x - nodeX, pointerNow.y - nodeY) <= NODE_HOVER_PX;

      // 交点：16px 内命中；行波上的交点移动极快，也认最近 250ms 经过的轨迹点。
      let nearest: CrossingHit | null = null;
      let bestDistance = CROSS_HOVER_PX;
      for (const hit of crossingsNow) {
        const distance = Math.hypot(pointerNow.x - hit.x, pointerNow.y - hit.y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          nearest = hit;
        }
      }
      const now = performance.now();
      if (!nearest) {
        let bestTrail: CrossingTrailPoint | null = null;
        for (const point of crossingTrail) {
          if (now - point.born > CROSS_TRAIL_MS) continue;
          const distance = Math.hypot(pointerNow.x - point.x, pointerNow.y - point.y);
          if (distance <= bestDistance) {
            bestDistance = distance;
            bestTrail = point;
          }
        }
        if (bestTrail) {
          nearest = { a: bestTrail.a, b: bestTrail.b, x: bestTrail.x, y: bestTrail.y, x01: bestTrail.x / LOGICAL_W, uA: 0, uB: 0 };
        }
      }
      if (nearest) {
        hoverCrossNow = nearest;
        hoverPairNow = { a: nearest.a, b: nearest.b };
        hoverLatchUntil = now + CROSS_HOVER_LINGER_MS;
      } else if (now > hoverLatchUntil) {
        hoverCrossNow = null;
        hoverPairNow = null;
      }
    }

    function pruneMarks(now: number): void {
      for (let i = ghostMarks.length - 1; i >= 0; i -= 1) {
        if (now - (ghostMarks[i]?.born ?? 0) >= GHOST_FADE_MS) ghostMarks.splice(i, 1);
      }
      if (hintMark && now - hintMark.born >= HINT_FADE_MS) hintMark = null;
      ripples = ripples.filter((ripple) => now - ripple.born < RIPPLE_MS);
    }

    function frame(now: number): void {
      requestId = window.requestAnimationFrame(frame);
      const dt = lastFrame > 0 ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
      lastFrame = now;

      if (chartAlpha !== chartTarget) {
        const stepSize = (dt * 1000) / OVERVIEW_FADE_MS;
        chartAlpha =
          chartTarget > chartAlpha
            ? Math.min(chartTarget, chartAlpha + stepSize)
            : Math.max(chartTarget, chartAlpha - stepSize);
      }
      pruneMarks(now);
      if (dualNow && now - dualStartedAt >= DUAL_MS) finishDual();

      if (modeNow === 'strings') {
        stepSims(dt);
        updateTrailState(dt);
      }

      if (modeNow === 'strings' && chartAlpha <= 0) {
        crossingsNow = buildCrossings();
        setCrossingsCount(crossingsNow.length);
        for (const hit of crossingsNow) {
          crossingTrail.push({ a: hit.a, b: hit.b, x: hit.x, y: hit.y, born: now });
        }
        crossingTrail = crossingTrail.filter((point) => now - point.born <= CROSS_TRAIL_MS);
        coupleWaves(now);
      } else if (crossingsCountNow !== 0) {
        crossingsNow = [];
        crossingTrail = [];
        setCrossingsCount(0);
      }
      updateHoverState();
      setRestingUi(sims[focusIdx]!.resting());

      if (modeNow === 'overview' || chartAlpha > 0) {
        drawOverviewScene();
        return;
      }
      renderStringsScene(now);
    }

    /* —— 安装：调试钩子 / 音频 / 事件 —— */
    function resetField(): void {
      audio.reset();
      for (let i = 0; i < KIND_ORDER.length; i += 1) {
        valuesNow[i] = DEFAULT_VALUES[kindOf(i)];
        sims[i] = new StringSim(STRING_N, LOGICAL_W);
      }
      focusIdx = 0;
      setFocusIndex(0);
      setValues(valuesNow.slice());
      spanNow = 1;
      setSpanUi(1);
      microNow = 0.5;
      setMicroUi(0.5);
      resonantNow = false;
      setResonantUi(false);
      resonanceCenterNow = null;
      setResonanceUi(null);
      dualNow = false;
      setDualUi(false);
      modeNow = 'strings';
      setMode('strings');
      chartAlpha = 0;
      chartTarget = 0;
      plucksNow = 0;
      setPlucks(0);
      drag = null;
      setPullingUi(false);
      ghostMarks.length = 0;
      hintMark = null;
      ripples = [];
      crossingsNow = [];
      crossingTrail = [];
      setCrossingsCount(0);
      pointerNow = null;
      hoverNodeNow = false;
      hoverCrossNow = null;
      for (let i = 0; i < lastCouple.length; i += 1) lastCouple[i] = Number.NEGATIVE_INFINITY;
      lastTouchNow = null;
      setLastKey('');
      setLastAmplitude(0);
      setLastDirection('down');
      clearTrail();
      updateResonanceUi();
      setRestingUi(true);
    }

    readTheme();
    resize();
    updateResonanceUi();

    const debugApi: NonNullable<Window['__neurouString']> = {
      state: () => ({
        kind: kindOf(focusIdx),
        kindIndex: focusIdx,
        mode: modeNow,
        plucks: plucksNow,
        audio: audio.getState(),
        keyCount: KEY_COUNT,
        overviewRows: modeNow === 'overview' ? KIND_ORDER.length : 0,
        values: valuesNow.map((value) => Math.round(value * 100) / 100),
        span: Math.round(spanNow * 100) / 100,
        resonant: resonantNow,
        resonance: resonanceCenterNow,
        micro: Math.round(microNow * 100) / 100,
        dual: dualNow,
        crossings: crossingsCountNow,
        amplitude: sims[focusIdx]!.amplitude(),
      }),
      u: () => Array.from(sims[focusIdx]!.u()),
      curves: () =>
        KIND_ORDER.map((kind, index) => ({
          kind,
          value: Math.round((valuesNow[index] ?? 0) * 100) / 100,
          baseline: Math.round(baselineOf(index) * 100) / 100,
          samples: Array.from(sims[index]!.u()),
        })),
      crossings: () =>
        crossingsNow.map((hit) => ({
          a: kindOf(hit.a),
          b: kindOf(hit.b),
          // x 用 0..1 归一化（官方验收按 x*1440 换算），y 是逻辑像素。
          x: Math.round(hit.x01 * 10000) / 10000,
          y: Math.round(hit.y * 10) / 10,
        })),
      lastTouch: () => (lastTouchNow ? { ...lastTouchNow } : null),
      pluckAt: (x: number, y: number) => {
        if (modeNow === 'overview' || chartAlpha > 0) {
          setModeUi('strings');
          chartTarget = 0;
          chartAlpha = 0;
        }
        pluckFocus(clamp(x, 0, LOGICAL_W), clamp(y, 0, LOGICAL_H), '');
      },
      pressKey: (code: string) => {
        if (code === 'Tab') {
          if (dualNow) return;
          switchFocus(1, modeNow === 'strings');
          return;
        }
        if (code === 'Escape') {
          toggleOverview();
          return;
        }
        if (modeNow === 'overview' || dualNow) return;
        const key = keyByCode(keys, code);
        if (!key) return;
        pluckFocus(key.cx, key.cy, code, key.label);
      },
      reset: () => resetField(),
      setValue: (kind: StringKind, value: number) => {
        const index = KIND_ORDER.indexOf(kind);
        if (index < 0) return;
        applyValue(index, value);
      },
      setSpan: (value: number) => setSpanValue(value),
      setMicro: (value: number) => setMicroValue(value),
      rms: () => audio.rms(),
    };
    window.__neurouString = debugApi;

    setAudioState(audio.getState());
    const unsubscribeAudio = audio.subscribe((state) => {
      setAudioState(state);
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });

    const observer = new ResizeObserver(() => {
      resize();
    });
    observer.observe(host);
    window.addEventListener('resize', resize);

    requestId = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(requestId);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
      unsubscribeAudio();
      audio.reset();
      if (window.__neurouString === debugApi) delete window.__neurouString;
    };
  }, []);

  const focusKind = KIND_ORDER[focusIndex] ?? '叙事';
  const valuesJson = JSON.stringify(values.map((value) => Math.round(value * 100) / 100));

  return (
    <div
      ref={hostRef}
      className="string-field"
      data-testid="string-field"
      data-mode={mode}
      data-kind={focusKind}
      data-kind-index={focusIndex}
      data-plucks={plucks}
      data-values={valuesJson}
      data-span={spanUi.toFixed(2)}
      data-resonant={resonantUi ? 'true' : 'false'}
      data-resonance={resonanceUi === null ? '' : String(resonanceUi)}
      data-micro={microUi.toFixed(2)}
      data-dual={dualUi ? 'true' : 'false'}
      data-crossings={crossingsCountUi}
      data-pulling={pulling ? 'true' : 'false'}
      data-resting={resting ? 'true' : 'false'}
      data-key-count={KEY_COUNT}
      data-overview-rows={mode === 'overview' ? KIND_ORDER.length : 0}
      data-audio={audioState}
      data-last-key={lastKey}
      data-last-amplitude={lastAmplitude}
      data-last-direction={lastDirection}
    >
      <canvas ref={canvasRef} className="string-canvas" data-testid="string-canvas" />
    </div>
  );
}
