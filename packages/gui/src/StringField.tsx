/**
 * 单弦调律台 v0.8「世界驱动的八弦叠影」：一张白纸，八根弦同时悬在纸上，
 * 每根弦 = 一个真实世界里的数值弦（基线纵坐标 = 归一化值）。
 *
 * 与 v0.7 的区别：
 * - 值唯一真源是 props.view.lanes：不再本地维护 values；
 * - 拖弦写回世界（onInject(raw)），世界逐拍传导后回传新 view；
 * - 世界逐拍变化（view.tick 且 |Δnorm|>0.001）→ 对应弦注入视觉波；
 * - 共振改为「接近该弦的悬崖/安全阈值（±0.035 norm）」；
 * - 对偶翻转把真实值翻到对侧；
 * - 左侧标签 = 世界里的弦名（lane.name）。
 *
 * 视觉/音频全部沿用 v0.7：八弦蛛丝、焦点弦近黑 + 高频微颤、波峰加粗、
 * 运动模糊 + 黑色帧残留、干涉奇点/悬停标签、跨弦耦合、共振虚影/泛音/和弦、
 * D-膜 span、紧致化结点 micro、对偶塌缩、ESC 总谱。
 */
import { useEffect, useRef, useState } from 'react';
import { STRING_INTERACTIONS, type StringInteraction, type StringKind } from '@neurou/core';
import {
  KIND_ORDER,
  KIND_VISUAL,
  LOGICAL_H,
  LOGICAL_W,
  STRING_N,
  StringSim,
  curveCrossings,
  keyAtPoint,
  keyByCode,
  layoutKeyboard,
  signature,
  standingOvertone,
  valueToY,
  yToValue,
  type KindVisualProfile,
  type Lane,
  type TimbreCurve,
  type WorldView,
} from './stringMath.js';
import { getStringAudio, type StringAudioState } from './stringAudio.js';
import { sustainedWaves } from './sustainedWave.js';
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
/** 非焦点弦：各自 restWidth 的 0.85、基础 alpha 0.20 再按 index ±0.03。 */
const OTHER_WIDTH_SCALE = 0.85;
const OTHER_ALPHA = 0.2;
const OTHER_ALPHA_STEP = 0.03;
/** 共振虚影。 */
const RESONANCE_OVERTONE_PX = 1.4;
/** 线宽/alpha 的量化档数。 */
const BAND_COUNT = 9;

/** 触点淡字 / Tab 弦名浮现 / 总览淡入淡出。 */
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
const CROSS_HOVER_LINGER_MS = 350;
const CROSS_TRAIL_MS = 250;
/** 共振带：距离悬崖/安全阈值的归一化距离。 */
const RESONANCE_BAND_NORM = 0.035;
/** 一次拨动推动真实值约 8% 量程。 */
const PLUCK_WORLD_RATIO = 0.08;

/** 跨弦耦合。 */
const COUPLE_COOLDOWN_MS = 400;
const COUPLE_AMP_RATIO = 0.28;
const COUPLE_AMP_MIN = 8;
const COUPLE_AMP_MAX = 60;
const COUPLE_U_MIN = 10;
const RIPPLE_MS = 700;

/** 焦点弦的耦合标记（画布左侧可滚轮调强度的竖线）。 */
const COUPLING_X = 30;
const COUPLING_SLOT_PX = 3.5;
const COUPLING_HOVER_X_MIN = 18;
const COUPLING_HOVER_X_MAX = 44;
const COUPLING_HOVER_DY = 14;
const COUPLING_STEP = 0.05;
const COUPLING_MAX = 2;
const COUPLING_INSET_PX = 10;

/** 按住绷弦：鼠标长按不动 ≥HOLD_MS 后钉成波峰。 */
const HOLD_MS = 180;
/** v5.35：键盘按下即显示拉弦，不再等长按计时。 */
const KEYBOARD_HOLD_MS = 0;
/** 平滑正弦峰的半宽（halfWidth）。 */
const PIN_RADIUS_PX = 44;

/** 世界逐拍 → 视觉波。 */
const TICK_WAVE_RATIO = 1.6;
const TICK_WAVE_MIN = 6;
const TICK_WAVE_MAX = 90;

/** 对偶翻转。 */
const DUAL_MS = 700;
const DUAL_AMP_MIN = 170;
const DUAL_LOW = 0.02;
const DUAL_HIGH = 0.98;

/** trail（只焦点弦画）。 */
const TRAIL_FEED_MS = 180;
const TRAIL_FADE_TAU_SECONDS = 0.12;
const TRAIL_ALPHA = 0.5;
const TRAIL_BLUR_PX = 6;
const TRAIL_FRAME_BLUR_PX = 1.5;
const TRAIL_SETTLE_SECONDS = 0.6;

/** 总览。 */
const OVERVIEW_TOP = 90;
const OVERVIEW_BOTTOM = 810;
const OVERVIEW_LEFT = 160;
const OVERVIEW_RIGHT = 1280;
const OVERVIEW_WAVE_PX = 26;
const OVERVIEW_LABEL_X = 96;
const OVERVIEW_STEPS = 256;

/** 左侧常驻弦名。 */
const LABEL_X = 64;
const LABEL_FONT_PX = 12;
/** 触点淡字 / Tab 弦名。 */
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

/** 内部交点：a/b 是 lanes 下标。 */
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

type DragKind = 'value' | 'membrane' | 'pluck' | 'threshold' | 'coupling';

type ThresholdName = 'verge' | 'safe';

/** 鼠标按住绷弦状态（键盘按住按 keyCode 各存一份）。 */
interface MouseHold {
  pointerId: number;
  x: number;
  y: number;
  startedAt: number;
}

/** 键盘按住（到 HOLD_MS 才变成可见的 pin；每个 keyCode 独立一份）。 */
interface KeyboardHold {
  code: string;
  label: string;
  x: number;
  y: number;
  startedAt: number;
  interaction: StringInteraction;
}

/** 当前可见的 pin（鼠标 + 所有到时的键盘按住）。 */
interface PinView {
  source: 'mouse' | 'keyboard';
  code: string;
  x: number;
  y: number;
}

/** 焦点弦的一条耦合标记（内部几何）。 */
interface CouplingMark {
  from: string;
  to: string;
  strength: number;
  partnerName: string;
  x: number;
  yTop: number;
  yBottom: number;
  midY: number;
  focusY: number;
}

interface PointerDrag {
  kind: DragKind;
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  startNorm: number;
  laneKind: StringKind;
  laneMin: number;
  laneMax: number;
  /** 拖动开始时的焦点 lane 下标（阈值拖动按它反算 raw）。 */
  laneIndex: number;
  /** 阈值拖动：拖的是悬崖还是安全线。 */
  thresholdWhich?: ThresholdName;
  side: -1 | 1;
  moved: boolean;
}

export interface StringFieldProps {
  view: WorldView;
  /** persist=true 表示这是用户手势（拖弦松手/拨弦/对偶），App 会 debounce 写回 .nro。 */
  onInject: (kind: StringKind, value: number, persist?: boolean) => void;
  /** 拖动焦点弦的悬崖/安全刻度 → 改 IR 阈值（App 会编译校验 + 写回）。 */
  onEditThreshold?: (kind: StringKind, which: ThresholdName, value: number, persist?: boolean) => void;
  /** 同类多根弦：←/→ 在同类实例间切换（App 维护 selected 并回传新 lane）。 */
  onCycleString?: (kind: StringKind, dir: 1 | -1) => void;
  /** 滚轮调焦点弦的一条耦合强度（0..2，App 会 debounce 写回）。 */
  onEditCoupling?: (from: string, to: string, strength: number, persist?: boolean) => void;
  /** Shift+Enter：在焦点弦与 link 目标之间增删一条耦合（App 判断 add/remove 并写回）。 */
  onToggleCoupling?: (fromId: string, toId: string) => void;
  /** Alt+Enter：以焦点弦为模板新增一条同类弦（App/core 决定名字/基线/阈值）。 */
  onAddString?: (focusId: string) => void;
  /** Alt+Backspace：删除焦点弦（App 校验引用/回路，失败写 data-save-error）。 */
  onRemoveString?: (focusId: string) => void;
  /** v5.43：持续型弦波形写入世界 IR（App debounce 写回 .nro）。 */
  onEditWaveform?: (stringId: string, waveform: number[]) => void;
  /** v3.0 可玩层：执行一个世界动作（App 排队到下一拍）。 */
  onPerformAction?: (id: string) => void;
  /** v3.0 可玩层：结局后重开世界。 */
  onRestart?: () => void;
  /** v3.0 重开信号：变化时清本地 sim/拖尾/动作 UI。 */
  resetSignal?: number;
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

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
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
        world: string;
        tick: number;
        ended: string | null;
        kind: StringKind;
        kindIndex: number;
        mode: ViewMode;
        plucks: number;
        audio: StringAudioState;
        keyCount: number;
        overviewRows: number;
        values: number[];
        norms: number[];
        lanes: Array<{ kind: StringKind; id: string; name: string; value: number; min: number; max: number }>;
        span: number;
        resonant: boolean;
        resonance: number | null;
        micro: number;
        dual: boolean;
        crossings: number;
        amplitude: number;
      };
      u: () => number[];
      curves: () => Array<{ kind: StringKind; name: string; value: number; baseline: number; samples: number[] }>;
      crossings: () => Array<{ a: string; b: string; x: number; y: number }>;
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
      /** 改焦点弦阈值（debug 注入，persist=false，不落盘）。 */
      setThreshold: (kind: StringKind, which: ThresholdName, value: number) => void;
      thresholds: () => Array<{
        kind: StringKind;
        verge: number | null;
        safe: number | null;
        vergeNorm: number | null;
        safeNorm: number | null;
      }>;
      /** 当前焦点弦的耦合标记（验收拿坐标用）。 */
      couplingMarks: () => Array<{
        from: string;
        to: string;
        strength: number;
        x: number;
        y: number;
        partnerName: string;
      }>;
      /** 改一条耦合强度（debug 注入，persist=false，不落盘）。 */
      setCoupling: (from: string, to: string, strength: number) => void;
      /** 按住绷弦状态（验收用）。 */
      pinInfo: () => {
        active: boolean;
        x: number;
        y: number;
        amplitude: number;
        direction: 1 | -1;
        heldMs: number;
      };
      /** v5.34：持续型弦当前发声音数（验收用）。 */
      sustainedStrings: () => number;
      /** v5.35：焦点弦当前显示波形的峰谷差（验收用）。 */
      focusWaveSpread: () => number;
      /** 增删耦合的 link 目标（验收用）。 */
      linkTarget: () => { index: number; id: string; name: string; existing: boolean } | null;
      /** 当前所有可见 pin（鼠标 + 多键键盘，验收用）。 */
      pins: () => Array<{
        source: 'mouse' | 'keyboard';
        code: string;
        x: number;
        y: number;
        amplitude: number;
        direction: 1 | -1;
        heldMs: number;
      }>;
      rms: () => number;
      /** v2.17：拖尾层状态（验收/诊断用）。 */
      trail: () => {
        active: boolean;
        settle: number;
        alphaPixels: number;
        maxAlpha: number;
        simResting: boolean;
      };
    };
  }
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export function StringField({
  view,
  onInject,
  onEditThreshold,
  onCycleString,
  onEditCoupling,
  onToggleCoupling,
  onAddString,
  onRemoveString,
  onEditWaveform,
  onPerformAction,
  onRestart,
  resetSignal,
}: StringFieldProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<WorldView>(view);
  const injectRef = useRef(onInject);
  const waveformEditRef = useRef(onEditWaveform);
  const thresholdEditRef = useRef(onEditThreshold);
  const cycleRef = useRef(onCycleString);
  const couplingEditRef = useRef(onEditCoupling);
  const toggleCouplingRef = useRef(onToggleCoupling);
  const addStringRef = useRef(onAddString);
  const removeStringRef = useRef(onRemoveString);
  const performActionRef = useRef(onPerformAction);
  const restartRef = useRef(onRestart);
  const performActionUiRef = useRef<(index: number) => void>(() => {});
  const closeActionsUiRef = useRef<() => void>(() => {});
  const resetSignalRef = useRef<number | undefined>(resetSignal);
  viewRef.current = view;
  injectRef.current = onInject;
  waveformEditRef.current = onEditWaveform;
  thresholdEditRef.current = onEditThreshold;
  cycleRef.current = onCycleString;
  couplingEditRef.current = onEditCoupling;
  toggleCouplingRef.current = onToggleCoupling;
  addStringRef.current = onAddString;
  removeStringRef.current = onRemoveString;
  performActionRef.current = onPerformAction;
  restartRef.current = onRestart;
  resetSignalRef.current = resetSignal;

  const laneCount = view.lanes.length;
  const [focusIndex, setFocusIndex] = useState(0);
  const safeFocus = laneCount > 0 ? Math.min(focusIndex, laneCount - 1) : 0;
  const focusLane = view.lanes[safeFocus] ?? null;
  const focusKind = focusLane ? focusLane.kind : '叙事';

  const actions = view.actions ?? [];
  const [touchMode, setTouchMode] = useState(false);
  const touchModeRef = useRef(false);
  touchModeRef.current = touchMode;
  const [actionOpen, setActionOpen] = useState(false);
  const [actionSelected, setActionSelected] = useState(0);
  const [lastAction, setLastAction] = useState('');
  const safeActionSelected = actions.length > 0 ? Math.min(actionSelected, actions.length - 1) : 0;
  const selectedAction = actions[safeActionSelected];
  const selectedActionNote = selectedAction?.note ?? '';
  const selectedActionCost = selectedAction?.cost ?? 0;
  const selectedActionDetail = [selectedActionNote, selectedActionCost > 0 ? `耗时 ${selectedActionCost} 拍` : '']
    .filter(Boolean)
    .join(' · ');
  const endingTick = view.endedTick ?? view.tick;
  const endingStats =
    view.ended && view.actionsTaken > 0
      ? `第 ${endingTick} 拍 · ${view.actionsTaken} 个动作`
      : view.ended
        ? `第 ${endingTick} 拍`
        : '';

  const [mode, setMode] = useState<ViewMode>('strings');
  const [plucks, setPlucks] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [resting, setResting] = useState(true);
  const [audioState, setAudioState] = useState<StringAudioState>('off');
  const [spanUi, setSpanUi] = useState(1);
  const [microUi, setMicroUi] = useState(0.5);
  const [dualUi, setDualUi] = useState(false);
  const [resonantUi, setResonantUi] = useState(false);
  const [resonanceUi, setResonanceUi] = useState<number | null>(null);
  const [crossingsCountUi, setCrossingsCountUi] = useState(0);
  const [lastKey, setLastKey] = useState('');
  const [lastAmplitude, setLastAmplitude] = useState(0);
  const [lastDirection, setLastDirection] = useState<'up' | 'down'>('down');
  const [holding, setHolding] = useState(false);
  const [heldAmplitude, setHeldAmplitude] = useState(0);
  const [heldCount, setHeldCount] = useState(0);
  const [linkTargetName, setLinkTargetName] = useState('');

  // v3.3：粗指针/触控检测（手机底部 16% 长按动作层、触控列表点击）。
  useEffect(() => {
    const update = (): void => {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const next = coarse || navigator.maxTouchPoints > 0;
      touchModeRef.current = next;
      setTouchMode(next);
    };
    update();
    const media = window.matchMedia('(pointer: coarse)');
    const onChange = (): void => update();
    media.addEventListener?.('change', onChange);
    window.addEventListener('resize', update);
    return () => {
      media.removeEventListener?.('change', onChange);
      window.removeEventListener('resize', update);
    };
  }, []);

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
    const focusDispBuf = new Float32Array(STRING_N);
    /** v5.39：持续波形平滑显示缓存 + 拖尾帧。 */
    const sustainedDisplayWaves = new Map<string, Float32Array>();
    const sustainedDrawTrail: Float32Array[] = [];
    let sustainedTrailKind: string | null = null;
    let sustainedWaveFrameAt = 0;
    let lastWaveCommitAt = 0;
    const trailDispBuf = new Float32Array(STRING_N);
    const curveBufs: number[][] = [];
    let sims: StringSim[] = [];

    /* —— 可变状态（闭包内，避免每帧 setState） —— */
    let lanesNow: Lane[] = [];
    let laneKey = '';
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
    let dualLaneIndex = 0;
    let lastWorldTick = -1;
    let prevNorms: number[] = [];

    let crossingsNow: CrossingHit[] = [];
    let crossingsCountNow = 0;
    let crossingTrail: CrossingTrailPoint[] = [];
    const lastCouple: number[] = [];

    let drag: PointerDrag | null = null;
    let pointerNow: { x: number; y: number } | null = null;
    /** 按住绷弦：鼠标 pin 与按 keyCode 独立的多枚键盘 pin 共存。 */
    let mouseHold: MouseHold | null = null;
    /** v5.36：鼠标持续型弦的声源 id。 */
    let mouseSustainId: number | null = null;
    const keyHolds = new Map<string, KeyboardHold>();
    /** v5.34：持续型弦按住期间的声音 id。 */
    const sustainedKeyVoices = new Map<string, number>();
    let pinsNow: PinView[] = [];
    let holdingNow = false;
    let heldAmplitudeNow = 0;
    let heldCountNow = 0;
    let hoverNodeNow = false;
    let hoverCrossNow: CrossingHit | null = null;
    let hoverPairNow: { a: number; b: number } | null = null;
    /** 鼠标悬停在焦点弦的哪条阈值刻线上（verge/safe）。 */
    let hoverThresholdNow: ThresholdName | null = null;
    /** 焦点弦的耦合标记（每帧按 view.couplings + lanes 重建）。 */
    let couplingMarksNow: CouplingMark[] = [];
    /** 当前 hover 的耦合标记。 */
    let hoverCouplingNow: CouplingMark | null = null;
    /** 滚轮连续调强度时的本地暂存（快速滚轮可能早于 view 回传）。 */
    let couplingPending: { from: string; to: string; value: number; at: number } | null = null;
    /** 增删耦合的 link 目标（lanes 下标，null = 非 link 模式）。 */
    let linkTargetIndex: number | null = null;
    let hoverLatchUntil = 0;
    let ripples: Ripple[] = [];
    const ghostMarks: GhostMark[] = [];
    let hintMark: HintMark | null = null;

    let chartAlpha = 0;
    let chartTarget = 0;
    let trailActive = false;
    let trailSettle = 0;
    /** 最近一次用户拨/拖弦的 trail 续画截止时间（此后只衰减不重画）。 */
    let trailFeedUntil = 0;
    let actionsOpenNow = false;
    let actionSelectedNow = 0;
    let lastActionAt = 0;
    let lastResetSignal = resetSignalRef.current;
    /** v3.3：触控底部 16% 长按动作层。 */
    let touchHoldTimer = 0;
    let touchHoldStart: { pointerId: number; x: number; y: number } | null = null;
    let lastFrame = 0;
    let requestId = 0;

    let scaleX = 1;
    let scaleY = 1;
    let ink: Rgb = FALLBACK_INK;
    let paper: Rgb = [250, 250, 250];
    let serif = DEFAULT_SERIF;
    let lastTouchNow: {
      x: number;
      y: number;
      amplitude: number;
      direction: 1 | -1;
      keyCode: string;
    } | null = null;

    /* —— 基础读取 —— */
    function laneAt(index: number): Lane | null {
      return lanesNow[index] ?? null;
    }

    function kindOf(index: number): StringKind {
      return lanesNow[index]?.kind ?? '叙事';
    }

    function interactionOf(index: number): StringInteraction {
      return STRING_INTERACTIONS[kindOf(index)] ?? '尾判';
    }

    function commitWaveform(bands: readonly number[], force = false): void {
      const lane = laneAt(focusIdx);
      if (!lane) return;
      const now = performance.now();
      if (!force && now - lastWaveCommitAt < 90) return;
      lastWaveCommitAt = now;
      waveformEditRef.current?.(lane.id, [...bands]);
    }

    function profileOf(index: number): KindVisualProfile {
      return KIND_VISUAL[kindOf(index)];
    }

    function baselineOf(index: number): number {
      return valueToY((lanesNow[index]?.norm ?? 0) * 100);
    }

    function focusGeom(): { xL: number; xR: number; width: number } {
      const width = spanNow * LOGICAL_W;
      const xL = (LOGICAL_W - width) / 2;
      return { xL, xR: xL + width, width };
    }

    function focusBaseline(): number {
      return baselineOf(focusIdx);
    }

    /** 某根 lane 在屏幕 x 处的物理曲线 y。 */
    function curveYAt(index: number, screenX: number): number {
      const sim = sims[index];
      const baseline = baselineOf(index);
      if (!sim) return baseline;
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

    function setHoldingUi(value: boolean): void {
      if (holdingNow === value) return;
      holdingNow = value;
      setHolding(value);
    }

    function setHeldAmplitudeUi(value: number): void {
      const rounded = Math.round(value * 10) / 10;
      if (Math.abs(rounded - heldAmplitudeNow) < 0.1) return;
      heldAmplitudeNow = rounded;
      setHeldAmplitude(rounded);
    }

    /** pin 的带符号屏幕位移：负 = 基线上方（向上拉），与物理 u 方向一致。 */
    function pinAmplitudeAt(pinY: number): number {
      const profile = profileOf(focusIdx);
      return clamp(pinY - focusBaseline(), -profile.maxPull, profile.maxPull);
    }

    function setHeldCountUi(value: number): void {
      if (heldCountNow === value) return;
      heldCountNow = value;
      setHeldCount(value);
    }

    function updateHeldState(): void {
      if (pinsNow.length === 0) {
        setHoldingUi(false);
        setHeldAmplitudeUi(0);
        setHeldCountUi(0);
        return;
      }
      setHoldingUi(true);
      setHeldCountUi(pinsNow.length);
      let maxAmplitude = 0;
      for (const pin of pinsNow) maxAmplitude = Math.max(maxAmplitude, Math.abs(pinAmplitudeAt(pin.y)));
      setHeldAmplitudeUi(maxAmplitude);
    }

    /** 清掉所有按住 pin（切焦点/总览/对偶/复位时调用）。 */
    function clearHold(): void {
      mouseHold = null;
      if (mouseSustainId !== null) {
        audio.stopSustainedSpectrum(mouseSustainId);
        mouseSustainId = null;
      }
      keyHolds.clear();
      for (const id of sustainedKeyVoices.values()) audio.stopSustainedSpectrum(id);
      sustainedKeyVoices.clear();
      pinsNow = [];
      setHoldingUi(false);
      setHeldAmplitudeUi(0);
      setHeldCountUi(0);
    }

    /** 焦点 → 目标方向是否已有一条耦合（方向敏感）。 */
    function hasDirectionalCoupling(fromId: string, toId: string): boolean {
      return viewRef.current.couplings.some((coupling) => coupling.from === fromId && coupling.to === toId);
    }

    function setLinkTarget(index: number | null): void {
      const next = index === null || !lanesNow[index] ? null : index;
      linkTargetIndex = next;
      setLinkTargetName(next === null ? '' : lanesNow[next]!.name);
    }

    function clearLinkTarget(): void {
      if (linkTargetIndex === null && linkTargetName === '') return;
      linkTargetIndex = null;
      setLinkTargetName('');
    }

    /** Shift+↑/↓：在「其它 lanes」里循环选目标（不切焦点、不触发同类切换）。 */
    function cycleLinkTarget(step: 1 | -1): void {
      const count = lanesNow.length;
      if (count <= 1) return;
      const others: number[] = [];
      for (let i = 0; i < count; i += 1) {
        if (i !== focusIdx) others.push(i);
      }
      if (others.length === 0) return;
      if (linkTargetIndex === null) {
        setLinkTarget(step > 0 ? others[0]! : others[others.length - 1]!);
        return;
      }
      const current = others.indexOf(linkTargetIndex);
      const next = current < 0 ? 0 : ((current + step) % others.length + others.length) % others.length;
      setLinkTarget(others[next]!);
    }

    function linkTargetInfo(): { index: number; id: string; name: string; existing: boolean } | null {
      if (linkTargetIndex === null) return null;
      const target = lanesNow[linkTargetIndex];
      const focusLane = laneAt(focusIdx);
      if (!target || !focusLane) return null;
      return {
        index: linkTargetIndex,
        id: target.id,
        name: target.name,
        existing: hasDirectionalCoupling(focusLane.id, target.id),
      };
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

    /** 共振：焦点 lane 接近悬崖线 / 安全线（±0.035 norm）。 */
    function updateResonanceFromLanes(): void {
      const lane = laneAt(focusIdx);
      let best: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      if (lane) {
        for (const threshold of [lane.vergeNorm, lane.safeNorm]) {
          if (typeof threshold !== 'number' || !Number.isFinite(threshold)) continue;
          const distance = Math.abs(lane.norm - threshold);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = threshold;
          }
        }
      }
      const resonant = best !== null && bestDistance <= RESONANCE_BAND_NORM;
      if (resonant !== resonantNow) {
        resonantNow = resonant;
        setResonantUi(resonant);
      }
      const center = resonant && best !== null ? Math.round(best * 1000) / 10 : null;
      if (center !== resonanceCenterNow) {
        resonanceCenterNow = center;
        setResonanceUi(center);
      }
    }

    /* —— 主题与画布尺寸 —— */
    function readTheme(): void {
      const style = getComputedStyle(host);
      ink = parseCssColor(style.getPropertyValue('--ink')) ?? FALLBACK_INK;
      paper = parseCssColor(style.getPropertyValue('--paper')) ?? paper;
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
      // DPR/resize 后拖尾画布被重置：同步清空状态，避免旧 feed 继续画。
      clearTrail();
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

    /* —— lane 运行时同步（世界可能换世界 / 增减弦） —— */
    function syncLanes(): void {
      const current = viewRef.current;
      const key = `${current.name}|${current.lanes.map((lane) => lane.id).join('|')}`;
      if (key !== laneKey) {
        laneKey = key;
        lanesNow = current.lanes.slice();
        sims = lanesNow.map(() => new StringSim(STRING_N, LOGICAL_W));
        curveBufs.length = 0;
        for (let i = 0; i < lanesNow.length; i += 1) curveBufs.push(new Array<number>(STRING_N).fill(0));
        lastCouple.length = 0;
        for (let i = 0; i < lanesNow.length; i += 1) lastCouple.push(Number.NEGATIVE_INFINITY);
        prevNorms = lanesNow.map((lane) => lane.norm);
        lastWorldTick = current.tick;
        focusIdx = 0;
        setFocusIndex(0);
        crossingsNow = [];
        crossingTrail = [];
        ripples = [];
        ghostMarks.length = 0;
        hintMark = null;
        drag = null;
        setPullingUi(false);
        clearTrail();
        setCrossingsCount(0);
        updateResonanceFromLanes();
        setRestingUi(true);
        return;
      }
      lanesNow = current.lanes;
      if (focusIdx >= lanesNow.length) {
        focusIdx = 0;
        setFocusIndex(0);
        updateResonanceFromLanes();
      }
    }

    /** 世界每走一拍：值变化 → 对应弦注入视觉波（只视觉，不写回世界）。 */
    function processWorldTick(current: WorldView): void {
      if (lastWorldTick < 0) {
        lastWorldTick = current.tick;
        prevNorms = current.lanes.map((lane) => lane.norm);
        return;
      }
      if (current.tick === lastWorldTick) return;
      for (let i = 0; i < current.lanes.length; i += 1) {
        const lane = current.lanes[i]!;
        const sim = sims[i];
        if (!sim) continue;
        const previous = prevNorms[i] ?? lane.norm;
        const delta = lane.norm - previous;
        if (Math.abs(delta) <= 0.001) continue;
        const profile = KIND_VISUAL[lane.kind];
        const amplitude = clamp(Math.abs(delta) * profile.maxPull * TICK_WAVE_RATIO, TICK_WAVE_MIN, TICK_WAVE_MAX);
        const direction: 1 | -1 = delta > 0 ? -1 : 1;
        const geom = i === focusIdx ? focusGeom() : { xL: 0, width: LOGICAL_W };
        sim.pluck({ x: geom.width / 2, y: 0, amplitude, direction, key: null }, profile);
        if (i === focusIdx) setRestingUi(false);
      }
      lastWorldTick = current.tick;
      prevNorms = current.lanes.map((lane) => lane.norm);
    }

    /* —— sim 重建 —— */
    function rebuildFocusSim(): void {
      if (!sims[focusIdx]) return;
      sims[focusIdx] = new StringSim(STRING_N, focusGeom().width);
      clearTrail();
      setRestingUi(true);
    }

    function changeFocus(index: number): void {
      if (!lanesNow.length) return;
      const next = clamp(index, 0, lanesNow.length - 1);
      if (next === focusIdx) return;
      clearHold();
      clearLinkTarget();
      if (sims[focusIdx]) sims[focusIdx] = new StringSim(STRING_N, LOGICAL_W);
      focusIdx = next;
      setFocusIndex(focusIdx);
      if (sims[focusIdx]) sims[focusIdx] = new StringSim(STRING_N, focusGeom().width);
      clearTrail();
      updateResonanceFromLanes();
      setRestingUi(true);
    }

    /* —— trail —— */
    function clearTrail(): void {
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
      trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      trailActive = false;
      trailSettle = 0;
      trailFeedUntil = 0;
    }

    /** 只衰减：用 destination-out 按帧时间把拖尾擦到透明。 */
    function fadeTrail(dt: number): void {
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
      trailCtx.globalCompositeOperation = 'destination-out';
      trailCtx.globalAlpha = 1 - Math.exp(-Math.max(0, dt) / TRAIL_FADE_TAU_SECONDS);
      trailCtx.fillStyle = '#000000';
      trailCtx.fillRect(0, 0, trailCanvas.width, trailCanvas.height);
      trailCtx.globalAlpha = 1;
      trailCtx.globalCompositeOperation = 'source-over';
    }

    /** 仅在用户拨/拖弦后的短窗口内续画当前波形；不因世界 tick 无限续命。 */
    function drawTrail(): void {
      trailCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      const sim = sims[focusIdx];
      if (!sim) return;
      const u = sim.u();
      for (let i = 0; i < STRING_N; i += 1) trailDispBuf[i] = u[i] ?? 0;
      trailCtx.filter = `blur(${TRAIL_BLUR_PX}px)`;
      strokeFocus(trailCtx, trailDispBuf, TRAIL_ALPHA * 0.62, false);
      trailCtx.filter = `blur(${TRAIL_FRAME_BLUR_PX}px)`;
      strokeFocus(trailCtx, trailDispBuf, TRAIL_ALPHA * 0.38, false);
      trailCtx.filter = 'none';
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function feedTrail(ms = TRAIL_FEED_MS): void {
      trailFeedUntil = Math.max(trailFeedUntil, performance.now() + ms);
      trailSettle = 0;
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
      const sim = sims[index];
      if (!sim) return;
      const profile = profileOf(index);
      const baseline = baselineOf(index);
      const u = sim.u();
      const count = u.length;
      const stepX = LOGICAL_W / (count - 1);
      const amplitude = sim.amplitude();
      const isLinkTarget = linkTargetIndex === index;
      const width = Math.max(profile.restWidth * OTHER_WIDTH_SCALE, isLinkTarget ? 1.6 : 0);
      const baseAlpha = OTHER_ALPHA + ((index % 3) - 1) * OTHER_ALPHA_STEP;
      const alpha = isLinkTarget
        ? 0.55
        : amplitude > 1
          ? Math.min(0.34, baseAlpha + (amplitude / Math.max(1, profile.maxPull)) * 0.38)
          : baseAlpha;
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

    /** 焦点弦显示位移：物理波 + 微颤/泛音；有 pin 时用余弦窗口与物理波交叉淡化到静态 pin 形状。 */
    function focusDisplayU(now: number, includeResonance: boolean): Float32Array {
      const sim = sims[focusIdx];
      const u = sim ? sim.u() : new Float32Array(STRING_N);
      const count = u.length;
      const resonance = includeResonance && resonantNow;
      const geom = focusGeom();
      const sustainedFocus = interactionOf(focusIdx) === '持续';
      const sustainedKind = kindOf(focusIdx);
      const sustainedLane = laneAt(focusIdx);
      const sustainedId = sustainedLane?.id ?? sustainedKind;
      const sustainedProfile = profileOf(focusIdx);
      let sustainedWave: readonly number[] | Float32Array = sustainedWaves.getFor(sustainedId, sustainedKind);
      if (sustainedFocus) {
        let display = sustainedDisplayWaves.get(sustainedId);
        if (!display) {
          display = new Float32Array(sustainedWave.length);
          display.set(sustainedWave);
          sustainedDisplayWaves.set(sustainedId, display);
        }
        if (now - sustainedWaveFrameAt > 8) {
          const dt = Math.min(0.1, Math.max(0.008, (now - sustainedWaveFrameAt) / 1000));
          sustainedWaveFrameAt = now;
          const ease = 1 - Math.exp(-dt * 9);
          for (let i = 0; i < display.length; i += 1) {
            display[i] = (display[i] ?? 0.5) + ((sustainedWave[i] ?? 0.5) - (display[i] ?? 0.5)) * ease;
          }
        }
        sustainedWave = display;
      }
      const smoothSample = (wave: ArrayLike<number>, x: number): number => {
        const position = x * (wave.length - 1);
        const index = Math.floor(position);
        const t = position - index;
        const p0 = wave[Math.max(0, index - 1)] ?? 0.5;
        const p1 = wave[index] ?? 0.5;
        const p2 = wave[Math.min(wave.length - 1, index + 1)] ?? 0.5;
        const p3 = wave[Math.min(wave.length - 1, index + 2)] ?? 0.5;
        return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
      };
      for (let i = 0; i < count; i += 1) {
        const x01 = count > 1 ? i / (count - 1) : 0.5;
        if (sustainedFocus) {
          // v5.37/v5.39：持续型弦显示可编辑波形；Catmull-Rom 平滑连接 + 缓动变形。
          const sample = smoothSample(sustainedWave, x01);
          const envelope = Math.pow(Math.sin(Math.PI * x01), 0.45);
          focusDispBuf[i] = (sample - 0.5) * 2 * sustainedProfile.maxPull * 0.62 * envelope;
          continue;
        }
        let value = u[i] ?? 0;
        value += standingOvertone(x01, now, 3) * FOCUS_JITTER_PX;
        if (resonance) value += standingOvertone(x01, now, 5) * RESONANCE_OVERTONE_PX;
        if (pinsNow.length > 0) {
          const screenX = geom.xL + x01 * geom.width;
          for (const pin of pinsNow) {
            const distance = Math.abs(screenX - pin.x);
            if (distance >= PIN_RADIUS_PX) continue;
            // 余弦窗口：中心完全由 pin amplitude 决定（静态），窗口边缘平滑并入物理波。
            const weight = 0.5 * (1 + Math.cos((Math.PI * distance) / PIN_RADIUS_PX));
            value = value * (1 - weight) + pinAmplitudeAt(pin.y) * weight;
          }
        }
        focusDispBuf[i] = value;
      }
      return focusDispBuf;
    }

    /** 按住期间整条焦点弦用单一路径、常态宽度（不额外加粗/加黑）。 */
    function strokeFocusUniform(disp: Float32Array): void {
      const geom = focusGeom();
      const baseline = focusBaseline();
      const profile = profileOf(focusIdx);
      const count = disp.length;
      if (count < 2) return;
      const stepX = geom.width / (count - 1);
      ctx.strokeStyle = rgba(ink, FOCUS_ALPHA);
      ctx.lineWidth = Math.max(FOCUS_WIDTH_BASE, profile.restWidth);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < count; i += 1) {
        const x = geom.xL + i * stepX;
        const y = baseline + (disp[i] ?? 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    /** 每个可见 pin 的峰顶小圆点（不再画张力线/加粗峰）。 */
    function drawPinDots(): void {
      const geom = focusGeom();
      const baseline = focusBaseline();
      ctx.fillStyle = rgba(ink, 0.55);
      for (const pin of pinsNow) {
        const x = clamp(pin.x, geom.xL, geom.xR);
        const y = baseline + pinAmplitudeAt(pin.y);
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
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
      const sim = sims[focusIdx];
      if (!sim) return;
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

    /** 阈值（悬崖/安全线）：原始值 + 归一化位置。 */
    function thresholdInfoAt(index: number, which: ThresholdName): { raw: number; norm: number } | null {
      const lane = laneAt(index);
      if (!lane) return null;
      const raw = which === 'verge' ? lane.verge : lane.safe;
      const norm = which === 'verge' ? lane.vergeNorm : lane.safeNorm;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
      if (typeof norm !== 'number' || !Number.isFinite(norm)) return null;
      return { raw, norm };
    }

    /** 命中测试：左侧 x∈[30,66]、距刻度 y ±12 内，取最近的一条。 */
    function thresholdHitAt(point: { x: number; y: number }): ThresholdName | null {
      if (point.x < 30 || point.x > 66) return null;
      let best: ThresholdName | null = null;
      let bestDistance = 12;
      for (const which of ['verge', 'safe'] as const) {
        const info = thresholdInfoAt(focusIdx, which);
        if (!info) continue;
        const distance = Math.abs(point.y - valueToY(info.norm * 100));
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = which;
        }
      }
      return best;
    }

    /** 屏幕 y → 新阈值 raw：clamp 到值域，且与另一条阈值至少留 0.5 个单位。 */
    function thresholdRawFromY(index: number, screenY: number, which: ThresholdName): number {
      const lane = laneAt(index);
      if (!lane) return 0;
      const norm = clamp(yToValue(clamp(screenY, 0, LOGICAL_H)) / 100, 0, 1);
      let raw = clamp(lane.min + norm * (lane.max - lane.min), lane.min, lane.max);
      const other = which === 'verge' ? lane.safe : lane.verge;
      if (typeof other === 'number' && Number.isFinite(other)) {
        const gap = 0.5;
        if (Math.abs(raw - other) < gap) {
          raw = raw >= other ? Math.min(other + gap, lane.max) : Math.max(other - gap, lane.min);
        }
      }
      return raw;
    }

    function drawThresholds(): void {
      const lane = laneAt(focusIdx);
      if (!lane) return;
      for (const which of ['verge', 'safe'] as const) {
        const info = thresholdInfoAt(focusIdx, which);
        if (!info) continue;
        const y = valueToY(info.norm * 100);
        const hovered =
          hoverThresholdNow === which || (drag !== null && drag.kind === 'threshold' && drag.thresholdWhich === which);
        if (hovered) {
          ctx.save();
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = rgba(ink, 0.05);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(LOGICAL_W, y);
          ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle = rgba(ink, hovered ? 0.55 : 0.22);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(56, y);
        ctx.stroke();
      }
    }

    /** 焦点 lane 的耦合标记：每条 from/to 等于焦点 lane.id 的耦合画一条左侧竖线。 */
    function buildCouplingMarks(): CouplingMark[] {
      const current = viewRef.current;
      const focusLane = laneAt(focusIdx);
      if (!focusLane || !current.couplings || current.couplings.length === 0) return [];
      const indexById = new Map<string, number>();
      for (let i = 0; i < lanesNow.length; i += 1) indexById.set(lanesNow[i]!.id, i);
      const focusY = baselineOf(focusIdx);
      const marks: CouplingMark[] = [];
      let slot = 0;
      for (const coupling of current.couplings) {
        let partnerId: string | null = null;
        if (coupling.from === focusLane.id) partnerId = coupling.to;
        else if (coupling.to === focusLane.id) partnerId = coupling.from;
        if (!partnerId) continue;
        const partnerIndex = indexById.get(partnerId);
        if (partnerIndex === undefined) continue;
        const partnerY = baselineOf(partnerIndex);
        const top = Math.min(focusY, partnerY) + COUPLING_INSET_PX;
        const bottom = Math.max(focusY, partnerY) - COUPLING_INSET_PX;
        let yTop = top;
        let yBottom = bottom;
        if (yBottom <= yTop) {
          const mid = (focusY + partnerY) / 2;
          yTop = mid - 4;
          yBottom = mid + 4;
        }
        const x = COUPLING_X + slot * COUPLING_SLOT_PX;
        marks.push({
          from: coupling.from,
          to: coupling.to,
          strength: coupling.strength,
          partnerName: lanesNow[partnerIndex]!.name,
          x,
          yTop,
          yBottom,
          midY: (yTop + yBottom) / 2,
          focusY,
        });
        slot += 1;
      }
      // view 已回传我们刚调到的强度 → 清掉本地暂存。
      if (couplingPending !== null) {
        const pending = couplingPending;
        const matched = marks.find((mark) => mark.from === pending.from && mark.to === pending.to);
        if (matched && Math.abs(matched.strength - pending.value) < 0.005) couplingPending = null;
      }
      return marks;
    }

    /** 命中耦合标记：x∈[18,44]、|y−中点|≤14，取最近的一条。 */
    function couplingHitAt(point: { x: number; y: number }): CouplingMark | null {
      if (point.x < COUPLING_HOVER_X_MIN || point.x > COUPLING_HOVER_X_MAX) return null;
      let best: CouplingMark | null = null;
      let bestDy = COUPLING_HOVER_DY;
      for (const mark of couplingMarksNow) {
        const dy = Math.abs(point.y - mark.midY);
        if (dy <= bestDy) {
          bestDy = dy;
          best = mark;
        }
      }
      return best;
    }

    function drawCouplings(): void {
      for (const mark of couplingMarksNow) {
        const hovered =
          hoverCouplingNow !== null && hoverCouplingNow.from === mark.from && hoverCouplingNow.to === mark.to;
        ctx.strokeStyle = rgba(ink, hovered ? 0.35 : 0.1);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(mark.x, mark.yTop);
        ctx.lineTo(mark.x, mark.yBottom);
        ctx.stroke();
        // 焦点端的小圆点
        ctx.fillStyle = rgba(ink, hovered ? 0.45 : 0.25);
        ctx.beginPath();
        ctx.arc(mark.x, mark.focusY, 1.5, 0, Math.PI * 2);
        ctx.fill();
        if (hovered) {
          ctx.font = `11px ${serif}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          // 伙伴名压在左侧弦名标签附近：先用纸色描一圈，避免两段文字糊在一起。
          ctx.strokeStyle = rgba(paper, 1);
          ctx.lineWidth = 3;
          ctx.strokeText(mark.partnerName, 50, mark.midY);
          ctx.fillStyle = rgba(ink, 0.35);
          ctx.fillText(mark.partnerName, 50, mark.midY);
          ctx.textAlign = 'center';
        }
      }
    }

    function drawStringLabels(): void {
      ctx.font = `${LABEL_FONT_PX}px ${serif}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < lanesNow.length; i += 1) {
        const lane = lanesNow[i]!;
        const labelY = baselineOf(i) - 7;
        // 耦合 hover 时伙伴名（x≈50）会压到左侧弦名标签上：把重叠的那一行标签暂时让开。
        if (hoverCouplingNow && Math.abs(labelY - hoverCouplingNow.midY) < LABEL_FONT_PX) continue;
        ctx.fillStyle = rgba(ink, i === focusIdx ? 0.55 : 0.2);
        ctx.fillText(lane.name, LABEL_X, labelY);
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
        const labelA = lanesNow[hoverPairNow.a]?.name ?? '';
        const labelB = lanesNow[hoverPairNow.b]?.name ?? '';
        const anchorX = (pointerNow ? pointerNow.x : (hoverCrossNow?.x ?? 0)) + 12;
        const anchorY = pointerNow ? pointerNow.y - 16 : (hoverCrossNow?.y ?? 0) - 16;
        ctx.font = `11px ${serif}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = rgba(ink, 0.35);
        ctx.fillText(`${labelA} × ${labelB}`, anchorX, anchorY);
        ctx.textAlign = 'center';
      }
    }

    /** 右侧的 link 连接线：已有该方向耦合 → 实线 α.30；没有 → 分段虚线 α.12。 */
    function drawLinkTarget(): void {
      if (linkTargetIndex === null) return;
      const target = lanesNow[linkTargetIndex];
      const focusLane = laneAt(focusIdx);
      if (!target || !focusLane) return;
      const x = LOGICAL_W - 260;
      const yFocus = focusBaseline();
      const yTarget = baselineOf(linkTargetIndex);
      const existing = hasDirectionalCoupling(focusLane.id, target.id);
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(ink, existing ? 0.3 : 0.12);
      if (!existing) ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x, yFocus);
      ctx.lineTo(x, yTarget);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(ink, existing ? 0.3 : 0.16);
      for (const y of [yFocus, yTarget]) {
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + 4, y);
        ctx.stroke();
      }
    }

    /* —— 场景 —— */
    function renderStringsScene(now: number): void {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (trailActive) ctx.drawImage(trailCanvas, 0, 0);
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

      const geom = focusGeom();
      for (let i = 0; i < lanesNow.length; i += 1) {
        if (i !== focusIdx) drawOtherString(i);
      }

      // 共振虚影（±5px 两层极淡倒影）；按住 pin 时关掉，避免静态峰被重影干扰。
      if (resonantNow && !dualNow && pinsNow.length === 0) {
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
        const sustainedDraw = interactionOf(focusIdx) === '持续';
        if (sustainedDraw) {
          const kind = kindOf(focusIdx);
          const laneId = laneAt(focusIdx)?.id ?? kind;
          if (sustainedTrailKind !== laneId) {
            sustainedDrawTrail.length = 0;
            sustainedTrailKind = laneId;
          }
          sustainedDrawTrail.unshift(disp.slice());
          if (sustainedDrawTrail.length > 9) sustainedDrawTrail.pop();
          ctx.save();
          for (let i = Math.min(7, sustainedDrawTrail.length - 1); i >= 1; i -= 1) {
            const trail = sustainedDrawTrail[i];
            if (!trail) continue;
            ctx.filter = `blur(${2 + i * 1.4}px)`;
            strokeFocus(ctx, trail, 0.075 * (1 - i / 9), false);
          }
          ctx.filter = 'none';
          strokeFocus(ctx, disp, 1, false);
          ctx.restore();
        } else if (pinsNow.length > 0) {
          // 按住期间：整条焦点弦单一路径、常态宽度；只留峰顶圆点。
          strokeFocusUniform(disp);
          drawPinDots();
        } else {
          strokeFocus(ctx, disp, 1, true);
        }
      }

      drawCrossings();
      drawRipples(now);
      drawStringLabels();
      drawCouplings();
      drawThresholds();
      drawLinkTarget();
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
      const focusKindNow = kindOf(focusIdx);
      const rowGap = (OVERVIEW_BOTTOM - OVERVIEW_TOP) / (KIND_ORDER.length - 1);
      for (let i = 0; i < KIND_ORDER.length; i += 1) {
        const kind = KIND_ORDER[i]!;
        const profile = KIND_VISUAL[kind];
        const rowY = OVERVIEW_TOP + rowGap * i;
        const active = kind === focusKindNow;
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
      const baselines: number[] = [];
      const curveAmp: number[] = [];
      for (let index = 0; index < lanesNow.length; index += 1) {
        const sim = sims[index];
        const buf = curveBufs[index] ?? new Array<number>(STRING_N).fill(0);
        curveBufs[index] = buf;
        if (sim) {
          const u = sim.u();
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
        } else {
          buf.fill(0);
        }
        let amp = 0;
        for (let sample = 0; sample < STRING_N; sample += 1) {
          const abs = Math.abs(buf[sample] ?? 0);
          if (abs > amp) amp = abs;
        }
        baselines.push(baselineOf(index));
        curveAmp.push(amp);
      }
      const list: CrossingHit[] = [];
      for (let a = 0; a < lanesNow.length; a += 1) {
        for (let b = a + 1; b < lanesNow.length; b += 1) {
          const diff = Math.abs(baselines[a]! - baselines[b]!);
          // 基线几乎重合且两根都静止 = 两条线叠在一起，不产生「交点」。
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
        const otherSim = sims[other];
        if (!otherSim) continue;
        otherSim.pluck(
          { x: clamp(hit.x01 * LOGICAL_W, 0, LOGICAL_W), y: 0, amplitude, direction: away, key: null },
          otherProfile,
        );
        ripples.push({ x: hit.x, y: hit.y, born: now });
      }
    }

    /* —— 拨动 / 和弦 / 对偶 —— */
    function audioBegin(
      kind: StringKind,
      xNorm: number,
      yNorm: number,
      amplitudeNorm: number,
      pitchScale: number,
      timbre?: TimbreCurve,
    ): void {
      void audio.ensureStarted();
      audio.pluck(kind, xNorm, yNorm, amplitudeNorm, pitchScale, timbre);
    }

    function chordOnPluck(center01: number, amplitude: number): void {
      for (let other = 0; other < lanesNow.length; other += 1) {
        if (other === focusIdx) continue;
        const otherSim = sims[other];
        if (!otherSim) continue;
        let target01 = 0.5;
        for (const hit of crossingsNow) {
          if ((hit.a === focusIdx && hit.b === other) || (hit.b === focusIdx && hit.a === other)) {
            target01 = hit.x01;
            break;
          }
        }
        const otherProfile = profileOf(other);
        const away: 1 | -1 = baselineOf(other) < focusBaseline() ? -1 : 1;
        otherSim.pluck(
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
      audioBegin(kindOf(focusIdx), clamp(center01 + 0.1, 0, 1), 0.5, 0.8, (1 / spanNow) * 1.5, laneAt(focusIdx)?.timbre);
    }

    function startDual(persist = true): void {
      const lane = laneAt(focusIdx);
      if (!lane) return;
      clearHold();
      clearLinkTarget();
      dualNow = true;
      dualStartedAt = performance.now();
      dualLaneIndex = focusIdx;
      setDualUi(true);
      drag = null;
      setPullingUi(false);
      // 立刻把真实值翻到对侧（世界下一拍照常传导）。
      const flippedNorm = clamp(1 - lane.norm, 0, 1);
      injectRef.current(lane.kind, lane.min + flippedNorm * (lane.max - lane.min), persist);
    }

    function finishDual(): void {
      const index = dualLaneIndex;
      if (sims[index]) {
        sims[index] = new StringSim(STRING_N, index === focusIdx ? focusGeom().width : LOGICAL_W);
      }
      clearTrail();
      dualNow = false;
      setDualUi(false);
      setRestingUi(true);
      audioBegin(kindOf(index), 0.5, 0.5, 0.8, (1 / spanNow) * 2, laneAt(index)?.timbre);
    }

    /** 拨动焦点弦：视觉波 + 推动真实值约 8% 量程。persist=true = 用户手势（要落盘）。 */
    function pluckFocus(
      screenX: number,
      screenY: number,
      keyCode: string,
      ghostText?: string,
      pushWorld = true,
      persist = true,
      playAudio = true,
    ): void {
      if (dualNow) return;
      const lane = laneAt(focusIdx);
      if (!lane) return;
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
      if ((lane.norm <= DUAL_LOW || lane.norm >= DUAL_HIGH) && amplitude > DUAL_AMP_MIN) {
        startDual(persist);
        return;
      }
      sims[focusIdx]?.pluck({ x: localX, y: screenY, amplitude, direction, key: null }, profile);
      if (pushWorld) {
        // 值变大 = 基线上移；direction=-1 是向上拨 → 推高值。
        const deltaNorm = -direction * (amplitude / Math.max(1, profile.maxPull)) * PLUCK_WORLD_RATIO;
        const nextNorm = clamp(lane.norm + deltaNorm, 0, 1);
        injectRef.current(lane.kind, lane.min + nextNorm * (lane.max - lane.min), persist);
      }
      if (playAudio) {
        audioBegin(
          lane.kind,
          clamp(center01, 0, 1),
          clamp(screenY / LOGICAL_H, 0, 1),
          clamp(amplitude / Math.max(1, profile.maxPull), 0, 1),
          1 / spanNow,
          lane.timbre,
        );
      }
      if (resonantNow) chordOnPluck(center01, amplitude);
      feedTrail();
      setRestingUi(false);
    }

    /** Tab / 总览点行：只演示视觉拨弦，不写世界。 */
    function demoPluck(): void {
      if (dualNow) return;
      const sim = sims[focusIdx];
      const lane = laneAt(focusIdx);
      if (!sim || !lane) return;
      const geom = focusGeom();
      const profile = profileOf(focusIdx);
      sim.pluck(
        { x: geom.width / 2, y: focusBaseline(), amplitude: profile.maxPull * 0.5, direction: 1, key: null },
        profile,
      );
      bumpPlucks();
      audioBegin(lane.kind, 0.5, 0.5, 0.5, 1 / spanNow, lane.timbre);
      feedTrail();
      setRestingUi(false);
    }

    /* —— 焦点切换 / 总览 —— */
    function switchFocus(step: number, demonstrate: boolean): void {
      if (dualNow || lanesNow.length === 0) return;
      const count = lanesNow.length;
      const next = ((focusIdx + (step % count)) + count) % count;
      changeFocus(next);
      hintMark = { text: lanesNow[focusIdx]?.name ?? '', born: performance.now() };
      if (demonstrate) demoPluck();
    }

    function enterOverview(): void {
      if (modeNow === 'overview') return;
      clearHold();
      clearLinkTarget();
      setModeUi('overview');
      chartTarget = 1;
      drag = null;
      setPullingUi(false);
      ghostMarks.length = 0;
      hintMark = null;
      ripples = [];
      audio.reset();
      clearTrail();
      const sim = sims[focusIdx];
      setRestingUi(sim ? sim.resting() : true);
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
      const kind = KIND_ORDER[row]!;
      const laneIndex = lanesNow.findIndex((lane) => lane.kind === kind);
      setModeUi('strings');
      chartTarget = 0;
      if (laneIndex < 0) return;
      changeFocus(laneIndex);
      hintMark = { text: lanesNow[focusIdx]?.name ?? '', born: performance.now() };
      demoPluck();
      clearTrail();
    }

    /* —— 输入 —— */
    function cancelTouchHold(): void {
      if (touchHoldTimer) {
        window.clearTimeout(touchHoldTimer);
        touchHoldTimer = 0;
      }
      touchHoldStart = null;
    }

    function onPointerDown(event: PointerEvent): void {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (drag !== null) return;
      const point = pointToLogical(event.clientX, event.clientY);
      pointerNow = point;
      const isTouch = touchModeRef.current && event.pointerType === 'touch';
      // 点击画布即收起动作列表（触控点列表外只关闭，不拨弦）。
      if (actionsOpenNow) {
        closeActions();
        if (isTouch) return;
      }
      // v3.3 触控：底部 16% 区域长按 ≥650ms 打开动作列表；该区域不拨弦/不绷弦。
      if (isTouch && modeNow === 'strings' && !dualNow && point.y >= LOGICAL_H * 0.84) {
        event.preventDefault();
        cancelTouchHold();
        touchHoldStart = { pointerId: event.pointerId, x: point.x, y: point.y };
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        touchHoldTimer = window.setTimeout(() => {
          touchHoldTimer = 0;
          if (touchHoldStart && modeNow === 'strings' && !dualNow && !viewRef.current.ended) openActions();
        }, 650);
        return;
      }
      if (modeNow === 'overview') {
        selectOverviewRow(point.y);
        return;
      }
      if (dualNow) return;
      const lane = laneAt(focusIdx);
      if (!lane) return;
      event.preventDefault();
      const geom = focusGeom();
      const baseline = focusBaseline();
      const common = {
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        startedAt: performance.now(),
        startNorm: lane.norm,
        laneKind: lane.kind,
        laneMin: lane.min,
        laneMax: lane.max,
        laneIndex: focusIdx,
        moved: false,
      };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      setPullingUi(true);
      // 1) 左侧阈值刻度（悬崖/安全线）：上下拖动改 IR 阈值。
      if (thresholdEditRef.current) {
        const which = thresholdHitAt(point);
        if (which) {
          drag = { ...common, kind: 'threshold', side: 1, thresholdWhich: which };
          return;
        }
      }
      // 2) 焦点弦的耦合标记：消费掉点击（滚轮调强度，点击不拨弦/不改值）。
      if (couplingEditRef.current && couplingHitAt(point)) {
        drag = { ...common, kind: 'coupling', side: 1 };
        return;
      }
      // 3) 焦点弦两端的 D-膜：横向拖动改 span。
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
      // 3) 焦点弦曲线 ±16px：上下拖动改真实值；几乎没动则是点触。
      if (Math.abs(point.y - curveYAt(focusIdx, point.x)) <= VALUE_DRAG_PX) {
        drag = { ...common, kind: 'value', side: 1 };
        return;
      }
      // 4) 其它位置：点触 = 拨弦；按弦类别分为头判/持续/尾判。
      const interaction = interactionOf(focusIdx);
      if (interaction === '头判') {
        pluckFocus(point.x, point.y, '', '', true, true, true);
        return;
      }
      drag = { ...common, kind: 'pluck', side: 1 };
      if (interaction === '持续') {
        mouseHold = {
          pointerId: event.pointerId,
          x: point.x,
          y: point.y,
          startedAt: performance.now(),
        };
        const kind = kindOf(focusIdx);
        const laneId = laneAt(focusIdx)?.id ?? kind;
        const profile = profileOf(focusIdx);
        const amplitude = clamp(Math.abs(point.y - focusBaseline()) / Math.max(1, profile.maxPull), 0, 1);
        const direction: 1 | -1 = point.y < focusBaseline() ? -1 : 1;
        sustainedWaves.editAtString(laneId, kind, clamp(point.x / LOGICAL_W, 0, 1), amplitude, direction);
        commitWaveform(sustainedWaves.getFor(laneId, kind), true);
        mouseSustainId = audio.startSustainedSpectrum(
          sustainedWaves.getFor(laneId, kind),
          clamp(point.x / LOGICAL_W, 0, 1),
          clamp(point.y / LOGICAL_H, 0, 1),
          true,
          true,
          amplitude,
        );
        updateHoldState(performance.now());
      }
    }

    function onPointerMove(event: PointerEvent): void {
      const point = pointToLogical(event.clientX, event.clientY);
      pointerNow = point;
      // 底部 16% 长按期间移动超过阈值 → 取消长按（仍不拨弦）。
      if (touchHoldStart && event.pointerId === touchHoldStart.pointerId) {
        const distance = Math.hypot(point.x - touchHoldStart.x, point.y - touchHoldStart.y);
        if (distance > TAP_MOVE_PX) cancelTouchHold();
        return;
      }
      // 绷住后 pin 跟着指针走（不转成取值拖动）。
      if (mouseHold && event.pointerId === mouseHold.pointerId) {
        mouseHold.x = point.x;
        mouseHold.y = point.y;
        if (mouseSustainId !== null) {
          const kind = kindOf(focusIdx);
          const laneId = laneAt(focusIdx)?.id ?? kind;
          const profile = profileOf(focusIdx);
          const amplitude = clamp(Math.abs(point.y - focusBaseline()) / Math.max(1, profile.maxPull), 0, 1);
          const direction: 1 | -1 = point.y < focusBaseline() ? -1 : 1;
          const waveBands = sustainedWaves.editAtString(laneId, kind, clamp(point.x / LOGICAL_W, 0, 1), amplitude, direction);
          commitWaveform(waveBands);
          audio.updateSustainedSpectrum(mouseSustainId, sustainedWaves.getFor(laneId, kind), true, true);
          audio.updateSustainedTone(mouseSustainId, clamp(point.x / LOGICAL_W, 0, 1), clamp(point.y / LOGICAL_H, 0, 1));
        }
        updateHeldState();
        return;
      }
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const distance = Math.hypot(dx, dy);
      if (!drag.moved && distance <= TAP_MOVE_PX) return;
      drag.moved = true;
      if (drag.kind === 'value') {
        const startY = valueToY(drag.startNorm * 100);
        const nextNorm = clamp(yToValue(startY + dy) / 100, 0, 1);
        const raw = drag.laneMin + nextNorm * (drag.laneMax - drag.laneMin);
        // 拖动过程中不落盘，只在松手时 persist 一次。
        injectRef.current(drag.laneKind, raw, false);
      } else if (drag.kind === 'membrane') {
        const half = LOGICAL_W / 2;
        const nextSpan = drag.side < 0 ? 1 - point.x / half : point.x / half - 1;
        const clamped = clamp(nextSpan, SPAN_MIN, 1);
        if (Math.abs(clamped - spanNow) > 0.001) {
          spanNow = clamped;
          setSpanUi(spanNow);
          rebuildFocusSim();
        }
      } else if (drag.kind === 'threshold') {
        const which = drag.thresholdWhich ?? 'verge';
        const raw = thresholdRawFromY(drag.laneIndex, point.y, which);
        // 拖动过程中不落盘，松手时再 persist。
        thresholdEditRef.current?.(kindOf(drag.laneIndex), which, raw, false);
      }
    }

    function onPointerUp(event: PointerEvent): void {
      if (touchHoldStart && event.pointerId === touchHoldStart.pointerId) {
        cancelTouchHold();
        try {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }
      if (!drag || event.pointerId !== drag.pointerId) return;
      const current = drag;
      drag = null;
      try {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      setPullingUi(false);
      // v5.36：持续型鼠标松手只停止持续声源，不做拨弦判定。
      if (mouseSustainId !== null) {
        const kind = kindOf(focusIdx);
        commitWaveform(sustainedWaves.getFor(laneAt(focusIdx)?.id ?? kind, kind), true);
        audio.stopSustainedSpectrum(mouseSustainId);
        mouseSustainId = null;
        mouseHold = null;
        pinsNow = pinsNow.filter((pin) => pin.source !== 'mouse');
        updateHeldState();
        return;
      }
      // 鼠标松手：若已绷住则以 pin 当前位移拨一次；键盘 pin 不受影响（共存）。
      if (mouseHold && mouseHold.pointerId === current.pointerId) {
        const session = mouseHold;
        mouseHold = null;
        pinsNow = pinsNow.filter((pin) => pin.source !== 'mouse');
        updateHeldState();
        const key = keyAtPoint(keys, session.x, session.y);
        pluckFocus(session.x, session.y, key ? key.code : '', key ? key.label : '');
        return;
      }
      // 阈值拖动：按松手时的最终坐标再提交一次，并标记为用户手势（要落盘）。
      if (current.kind === 'threshold') {
        const which = current.thresholdWhich ?? 'verge';
        const point = pointToLogical(event.clientX, event.clientY);
        const raw = thresholdRawFromY(current.laneIndex, point.y, which);
        thresholdEditRef.current?.(kindOf(current.laneIndex), which, raw, true);
        return;
      }
      const elapsed = performance.now() - current.startedAt;
      const quickTap = !current.moved && elapsed < TAP_MS;
      if (quickTap) {
        if (current.kind === 'value' || current.kind === 'pluck') {
          const key = keyAtPoint(keys, current.startX, current.startY);
          pluckFocus(current.startX, current.startY, key ? key.code : '', key ? key.label : '');
        }
        return;
      }
      // 拖动结束：按松手时的最终位置再注入一次，并标记为用户手势（要落盘）。
      if (current.kind === 'value') {
        const point = pointToLogical(event.clientX, event.clientY);
        const dy = point.y - current.startY;
        const startY = valueToY(current.startNorm * 100);
        const nextNorm = clamp(yToValue(startY + dy) / 100, 0, 1);
        const raw = current.laneMin + nextNorm * (current.laneMax - current.laneMin);
        injectRef.current(current.laneKind, raw, true);
      }
    }

    function onWheel(event: WheelEvent): void {
      if (modeNow !== 'strings' || dualNow) return;
      // 结点滚轮优先。
      if (hoverNodeNow) {
        event.preventDefault();
        const direction = event.deltaY > 0 ? 1 : -1;
        setMicroValue(microNow + direction * MICRO_STEP);
        return;
      }
      // 耦合标记：滚轮 ±0.05 调强度（clamp 0..2，两位小数），每次都是用户手势（persist=true）。
      const mark = hoverCouplingNow;
      if (mark && couplingEditRef.current) {
        event.preventDefault();
        const now = performance.now();
        const base =
          couplingPending !== null &&
          couplingPending.from === mark.from &&
          couplingPending.to === mark.to &&
          now - couplingPending.at < 800
            ? couplingPending.value
            : clamp(mark.strength, 0, COUPLING_MAX);
        const direction = event.deltaY > 0 ? -1 : 1;
        const next = Math.round(clamp(base + direction * COUPLING_STEP, 0, COUPLING_MAX) * 100) / 100;
        couplingPending = { from: mark.from, to: mark.to, value: next, at: now };
        couplingEditRef.current(mark.from, mark.to, next, true);
      }
    }

    /* —— v3.0 可玩层：动作选择 / 结局 —— */
    function actionList(): Array<{ id: string; name: string; note?: string }> {
      return viewRef.current.actions ?? [];
    }

    function setActionsOpenUi(open: boolean): void {
      if (actionsOpenNow === open) return;
      actionsOpenNow = open;
      setActionOpen(open);
    }

    function setActionSelectedUi(index: number): void {
      const list = actionList();
      const next = list.length > 0 ? clamp(index, 0, list.length - 1) : 0;
      if (next === actionSelectedNow) return;
      actionSelectedNow = next;
      setActionSelected(next);
    }

    function openActions(): void {
      if (actionsOpenNow) return;
      if (!actionList().length || viewRef.current.ended) return;
      if (modeNow !== 'strings' || dualNow) return;
      setActionSelectedUi(0);
      setActionsOpenUi(true);
    }

    function closeActions(): void {
      setActionsOpenUi(false);
    }

    /** 执行动作：关闭列表 + 400ms 防连发；真正规则执行交给 App/运行时。 */
    function performActionAt(index: number): void {
      const list = actionList();
      const action = list[index];
      if (!action || !performActionRef.current) return;
      const now = performance.now();
      if (now - lastActionAt < 400) return;
      lastActionAt = now;
      setLastAction(action.name);
      closeActions();
      performActionRef.current(action.id);
    }

    function resetLocalForRestart(clearLastAction: boolean): void {
      closeActions();
      resetField();
      if (clearLastAction) setLastAction('');
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) return;
      // Alt+Enter / Alt+Backspace：增删弦（Alt 组合优先于普通按键，避免被 alt 守卫吞掉）。
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.code === 'Enter' || event.code === 'Backspace') {
          event.preventDefault();
          if (modeNow === 'strings' && !dualNow) {
            const focusLane = laneAt(focusIdx);
            if (focusLane) {
              if (event.code === 'Enter') addStringRef.current?.(focusLane.id);
              else removeStringRef.current?.(focusLane.id);
            }
          }
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // v3.0 结局后 R 重开：清本地 sim/拖尾/动作 UI，再交给 App 重建运行时。
      if (viewRef.current.ended && event.code === 'KeyR') {
        event.preventDefault();
        resetLocalForRestart(true);
        restartRef.current?.();
        return;
      }
      if (event.code === 'Tab') {
        event.preventDefault();
        if (dualNow) return;
        if (modeNow === 'overview') switchFocus(event.shiftKey ? -1 : 1, false);
        else switchFocus(event.shiftKey ? -1 : 1, true);
        return;
      }
      if (event.code === 'Escape') {
        event.preventDefault();
        if (actionsOpenNow) {
          closeActions();
          return;
        }
        if (linkTargetIndex !== null) {
          clearLinkTarget();
          return;
        }
        toggleOverview();
        return;
      }
      if (modeNow === 'overview' || dualNow) return;
      // v3.0 Enter：打开动作列表；列表打开时 Enter 执行当前项。A 始终只走 46 键拨弦。
      if (event.code === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (actionsOpenNow) performActionAt(actionSelectedNow);
        else if (actionList().length > 0 && !viewRef.current.ended) openActions();
        return;
      }
      // 动作列表打开时，↑/↓/1..9 专用于选择/执行；其它 46 键继续正常拨弦。
      if (actionsOpenNow && !event.shiftKey) {
        const list = actionList();
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
          event.preventDefault();
          setActionSelectedUi(actionSelectedNow + (event.code === 'ArrowDown' ? 1 : -1));
          return;
        }
        if (event.code.startsWith('Digit')) {
          const index = Number(event.code.slice(5)) - 1;
          if (Number.isInteger(index) && index >= 0 && index < list.length) {
            event.preventDefault();
            performActionAt(index);
            return;
          }
        }
      }
      // 增删耦合：Shift+↑/↓ 选目标，Shift+Enter 切换关系。
      if (event.shiftKey && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
        event.preventDefault();
        cycleLinkTarget(event.code === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.shiftKey && event.code === 'Enter') {
        event.preventDefault();
        const info = linkTargetInfo();
        const focusLane = laneAt(focusIdx);
        if (info && focusLane) toggleCouplingRef.current?.(focusLane.id, info.id);
        return;
      }
      // 同类多根弦：←/→ 切换实例（只换 App 的 selected，不改焦点类别、不拨弦）。
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        if (drag !== null) return;
        cycleRef.current?.(kindOf(focusIdx), event.code === 'ArrowRight' ? 1 : -1);
        return;
      }
      const key = keyByCode(keys, event.code);
      if (!key) return;
      event.preventDefault();
      const label = event.key.length === 1 ? event.key : key.label;
      const interaction = interactionOf(focusIdx);
      if (interaction === '头判') {
        // 头判：按下即发声/判定，不进入按住拉弦。
        pluckFocus(key.cx, key.cy, event.code, label, true, true, true);
        return;
      }
      const profile = profileOf(focusIdx);
      const baseline = focusBaseline();
      const amplitude = Math.min(Math.abs(key.cy - baseline), profile.maxPull);
      const direction: 1 | -1 = key.cy < baseline ? -1 : 1;
      noteTouch(key.cx, key.cy, amplitude, direction, event.code);
      if (!keyHolds.has(event.code)) {
        keyHolds.set(event.code, {
          code: event.code,
          label,
          x: key.cx,
          y: key.cy,
          startedAt: performance.now(),
          interaction,
        });
        if (interaction === '持续') {
          const kind = kindOf(focusIdx);
          const laneId = laneAt(focusIdx)?.id ?? kind;
          const amp = clamp(amplitude / Math.max(1, profile.maxPull), 0, 1);
          const waveBands = sustainedWaves.editAtString(laneId, kind, clamp(key.cx / LOGICAL_W, 0, 1), amp, direction);
          commitWaveform(waveBands, true);
          const id = audio.startSustainedSpectrum(
            sustainedWaves.getFor(laneId, kind),
            clamp(key.cx / LOGICAL_W, 0, 1),
            clamp(key.cy / LOGICAL_H, 0, 1),
            true,
            true,
            amp,
          );
          sustainedKeyVoices.set(event.code, id);
        }
        updateHoldState(performance.now());
      }
    }

    function onKeyUp(event: KeyboardEvent): void {
      const session = keyHolds.get(event.code);
      if (!session) return;
      keyHolds.delete(event.code);
      pinsNow = pinsNow.filter((pin) => !(pin.source === 'keyboard' && pin.code === event.code));
      updateHeldState();
      if (session.interaction === '持续') {
        const id = sustainedKeyVoices.get(event.code);
        if (id !== undefined) audio.stopSustainedSpectrum(id);
        sustainedKeyVoices.delete(event.code);
        return;
      }
      // 尾判：松手才发声/判定；头判在 keydown 已经完成，不会进入这里。
      pluckFocus(session.x, session.y, session.code, session.label, true, true, true);
    }

    /* —— 每帧 —— */
    function stepSims(dt: number): void {
      const focusSim = sims[focusIdx];
      if (focusSim && !dualNow && !focusSim.resting()) {
        const base = profileOf(focusIdx);
        focusSim.step(dt, { ...base, damping: base.damping * (0.45 + microNow * 1.6) });
      }
      for (let i = 0; i < sims.length; i += 1) {
        if (i === focusIdx) continue;
        const sim = sims[i];
        if (!sim || sim.resting()) continue;
        sim.step(dt, profileOf(i));
      }
    }

    function updateTrailState(dt: number, now: number): void {
      // 只有用户拨/拖弦后的短窗口续画；释手后只衰减，不因世界 tick / 弦继续振动无限续命。
      const feeding = now < trailFeedUntil || drag !== null || mouseHold !== null;
      if (feeding) {
        trailActive = true;
        trailSettle = 0;
        fadeTrail(dt);
        drawTrail();
        return;
      }
      if (!trailActive) return;
      fadeTrail(dt);
      trailSettle += dt;
      if (trailSettle >= TRAIL_SETTLE_SECONDS) clearTrail();
    }

    function updateHoverState(): void {
      if (!pointerNow || modeNow !== 'strings' || dualNow) {
        hoverNodeNow = false;
        hoverCrossNow = null;
        hoverPairNow = null;
        hoverThresholdNow = null;
        hoverCouplingNow = null;
        return;
      }
      hoverThresholdNow = drag === null ? thresholdHitAt(pointerNow) : null;
      hoverCouplingNow = drag === null ? couplingHitAt(pointerNow) : null;
      const geom = focusGeom();
      const nodeX = geom.xL + 0.62 * geom.width;
      const nodeY = curveYAt(focusIdx, nodeX);
      hoverNodeNow = Math.hypot(pointerNow.x - nodeX, pointerNow.y - nodeY) <= NODE_HOVER_PX;

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
          nearest = {
            a: bestTrail.a,
            b: bestTrail.b,
            x: bestTrail.x,
            y: bestTrail.y,
            x01: bestTrail.x / LOGICAL_W,
            uA: 0,
            uB: 0,
          };
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

    /** 按住绷弦：鼠标 pin 与多枚键盘 pin 共存，各自到 HOLD_MS 后可见。 */
    function updateHoldState(now: number): void {
      if (modeNow !== 'strings' || dualNow) {
        if (mouseHold !== null || keyHolds.size > 0 || pinsNow.length > 0) clearHold();
        return;
      }
      if (
        !mouseHold &&
        drag &&
        drag.kind === 'pluck' &&
        !drag.moved &&
        now - drag.startedAt >= HOLD_MS &&
        interactionOf(focusIdx) === '尾判'
      ) {
        const point = pointerNow ?? { x: drag.startX, y: drag.startY };
        mouseHold = {
          pointerId: drag.pointerId,
          x: point.x,
          y: point.y,
          startedAt: drag.startedAt,
        };
      }
      const nextPins: PinView[] = [];
      if (mouseHold) nextPins.push({ source: 'mouse', code: '', x: mouseHold.x, y: mouseHold.y });
      for (const hold of keyHolds.values()) {
        if (now - hold.startedAt >= KEYBOARD_HOLD_MS) {
          nextPins.push({ source: 'keyboard', code: hold.code, x: hold.x, y: hold.y });
        }
      }
      pinsNow = nextPins;
      updateHeldState();
    }

    function frame(now: number): void {
      requestId = window.requestAnimationFrame(frame);
      const dt = lastFrame > 0 ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
      lastFrame = now;

      // v3.0：App 重开信号 / 结局 / 动作列表变化时维护本地可玩层状态。
      if (resetSignalRef.current !== lastResetSignal) {
        lastResetSignal = resetSignalRef.current;
        resetLocalForRestart(true);
      }
      if (actionsOpenNow) {
        if (viewRef.current.ended || actionList().length === 0 || modeNow !== 'strings' || dualNow) closeActions();
        else setActionSelectedUi(actionSelectedNow);
      }

      if (chartAlpha !== chartTarget) {
        const stepSize = (dt * 1000) / OVERVIEW_FADE_MS;
        chartAlpha =
          chartTarget > chartAlpha
            ? Math.min(chartTarget, chartAlpha + stepSize)
            : Math.max(chartTarget, chartAlpha - stepSize);
      }
      pruneMarks(now);

      syncLanes();
      const currentView = viewRef.current;
      processWorldTick(currentView);
      updateResonanceFromLanes();
      if (dualNow && now - dualStartedAt >= DUAL_MS) finishDual();

      if (modeNow === 'strings') {
        stepSims(dt);
        updateTrailState(dt, now);
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
      couplingMarksNow = buildCouplingMarks();
      updateHoverState();
      updateHoldState(now);
      const focusSim = sims[focusIdx];
      setRestingUi(focusSim ? focusSim.resting() : true);

      if (modeNow === 'overview' || chartAlpha > 0) {
        drawOverviewScene();
        return;
      }
      renderStringsScene(now);
    }

    /* —— 本地复位（不动世界值） —— */
    function resetField(): void {
      audio.reset();
      clearHold();
      clearLinkTarget();
      for (let i = 0; i < sims.length; i += 1) {
        if (sims[i]) sims[i] = new StringSim(STRING_N, LOGICAL_W);
      }
      focusIdx = 0;
      setFocusIndex(0);
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
      hoverPairNow = null;
      hoverThresholdNow = null;
      hoverCouplingNow = null;
      couplingPending = null;
      hoverLatchUntil = 0;
      for (let i = 0; i < lastCouple.length; i += 1) lastCouple[i] = Number.NEGATIVE_INFINITY;
      lastTouchNow = null;
      setLastKey('');
      setLastAmplitude(0);
      setLastDirection('down');
      clearTrail();
      updateResonanceFromLanes();
      setRestingUi(true);
    }

    /* —— 调试钩子 —— */
    function laneDebug(): Array<{ kind: StringKind; id: string; name: string; value: number; min: number; max: number }> {
      return lanesNow.map((lane) => ({
        kind: lane.kind,
        id: lane.id,
        name: lane.name,
        value: round4(lane.value),
        min: lane.min,
        max: lane.max,
      }));
    }

    const debugApi: NonNullable<Window['__neurouString']> = {
      state: () => ({
        world: viewRef.current.name,
        tick: viewRef.current.tick,
        ended: viewRef.current.ended,
        kind: kindOf(focusIdx),
        kindIndex: focusIdx,
        mode: modeNow,
        plucks: plucksNow,
        audio: audio.getState(),
        keyCount: 46,
        overviewRows: modeNow === 'overview' ? KIND_ORDER.length : 0,
        values: lanesNow.map((lane) => round4(lane.value)),
        norms: lanesNow.map((lane) => round4(lane.norm)),
        lanes: laneDebug(),
        span: Math.round(spanNow * 100) / 100,
        resonant: resonantNow,
        resonance: resonanceCenterNow,
        micro: Math.round(microNow * 100) / 100,
        dual: dualNow,
        crossings: crossingsCountNow,
        amplitude: sims[focusIdx]?.amplitude() ?? 0,
      }),
      u: () => Array.from(sims[focusIdx]?.u() ?? []),
      curves: () =>
        lanesNow.map((lane, index) => ({
          kind: lane.kind,
          name: lane.name,
          value: round4(lane.value),
          baseline: Math.round(baselineOf(index) * 100) / 100,
          samples: Array.from(sims[index]?.u() ?? []),
        })),
      crossings: () =>
        crossingsNow.map((hit) => ({
          a: lanesNow[hit.a]?.name ?? '',
          b: lanesNow[hit.b]?.name ?? '',
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
        pluckFocus(clamp(x, 0, LOGICAL_W), clamp(y, 0, LOGICAL_H), '', undefined, false, false);
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
        pluckFocus(key.cx, key.cy, code, key.label, true, false);
      },
      reset: () => resetField(),
      setValue: (kind: StringKind, value: number) => {
        const lane = lanesNow.find((item) => item.kind === kind);
        if (!lane) return;
        injectRef.current(lane.kind, clamp(value, lane.min, lane.max), false);
      },
      setSpan: (value: number) => setSpanValue(value),
      setMicro: (value: number) => setMicroValue(value),
      setThreshold: (kind: StringKind, which: ThresholdName, value: number) => {
        const lane = lanesNow.find((item) => item.kind === kind);
        if (!lane) return;
        thresholdEditRef.current?.(lane.kind, which, clamp(value, lane.min, lane.max), false);
      },
      thresholds: () =>
        lanesNow.map((lane) => ({
          kind: lane.kind,
          verge: typeof lane.verge === 'number' ? round4(lane.verge) : null,
          safe: typeof lane.safe === 'number' ? round4(lane.safe) : null,
          vergeNorm: typeof lane.vergeNorm === 'number' ? round4(lane.vergeNorm) : null,
          safeNorm: typeof lane.safeNorm === 'number' ? round4(lane.safeNorm) : null,
        })),
      couplingMarks: () =>
        couplingMarksNow.map((mark) => ({
          from: mark.from,
          to: mark.to,
          strength: round4(mark.strength),
          x: Math.round(mark.x * 100) / 100,
          y: Math.round(mark.midY * 100) / 100,
          partnerName: mark.partnerName,
        })),
      setCoupling: (from: string, to: string, strength: number) => {
        const exists = viewRef.current.couplings.some(
          (coupling) =>
            (coupling.from === from && coupling.to === to) || (coupling.from === to && coupling.to === from),
        );
        if (!exists) return;
        couplingEditRef.current?.(from, to, Math.round(clamp(strength, 0, COUPLING_MAX) * 100) / 100, false);
      },
      pinInfo: () => {
        const pin = pinsNow[0];
        if (!pin) return { active: false, x: 0, y: 0, amplitude: 0, direction: 1, heldMs: 0 };
        const signed = pinAmplitudeAt(pin.y);
        const startedAt =
          pin.source === 'mouse'
            ? (mouseHold?.startedAt ?? performance.now())
            : (keyHolds.get(pin.code)?.startedAt ?? performance.now());
        return {
          active: true,
          x: Math.round(pin.x * 10) / 10,
          y: Math.round(pin.y * 10) / 10,
          amplitude: Math.round(Math.abs(signed) * 10) / 10,
          direction: signed < 0 ? -1 : 1,
          heldMs: Math.round(performance.now() - startedAt),
        };
      },
      sustainedStrings: () => sustainedKeyVoices.size + (mouseSustainId !== null ? 1 : 0),
      focusWaveSpread: () => {
        const disp = focusDisplayU(performance.now(), false);
        let low = Number.POSITIVE_INFINITY;
        let high = Number.NEGATIVE_INFINITY;
        for (const value of disp) {
          low = Math.min(low, value);
          high = Math.max(high, value);
        }
        return high - low;
      },
      pins: () =>
        pinsNow.map((pin) => {
          const signed = pinAmplitudeAt(pin.y);
          const startedAt =
            pin.source === 'mouse'
              ? (mouseHold?.startedAt ?? performance.now())
              : (keyHolds.get(pin.code)?.startedAt ?? performance.now());
          return {
            source: pin.source,
            code: pin.code,
            x: Math.round(pin.x * 10) / 10,
            y: Math.round(pin.y * 10) / 10,
            amplitude: Math.round(Math.abs(signed) * 10) / 10,
            direction: (signed < 0 ? -1 : 1) as 1 | -1,
            heldMs: Math.round(performance.now() - startedAt),
          };
        }),
      linkTarget: () => linkTargetInfo(),
      trail: () => {
        const sim = sims[focusIdx];
        let alphaPixels = 0;
        let maxAlpha = 0;
        try {
          const data = trailCtx.getImageData(0, 0, trailCanvas.width, trailCanvas.height).data;
          for (let i = 3; i < data.length; i += 4) {
            const alpha = data[i] ?? 0;
            if (alpha > 2) alphaPixels += 1;
            if (alpha > maxAlpha) maxAlpha = alpha;
          }
        } catch {
          /* 调试采样失败不影响画面 */
        }
        return {
          active: trailActive,
          settle: Math.round(trailSettle * 1000) / 1000,
          alphaPixels,
          maxAlpha,
          simResting: sim ? sim.resting() : true,
        };
      },
      rms: () => audio.rms(),
    };
    window.__neurouString = debugApi;
    performActionUiRef.current = performActionAt;
    closeActionsUiRef.current = closeActions;

    readTheme();
    resize();
    syncLanes();
    updateResonanceFromLanes();

    setAudioState(audio.getState());
    const unsubscribeAudio = audio.subscribe((state) => {
      setAudioState(state);
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
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
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('wheel', onWheel);
      unsubscribeAudio();
      audio.reset();
      if (window.__neurouString === debugApi) delete window.__neurouString;
    };
  }, []);

  const normsJson = JSON.stringify(view.lanes.map((lane) => round4(lane.norm)));
  const valuesJson = JSON.stringify(view.lanes.map((lane) => round4(lane.value)));
  const kindsJson = JSON.stringify(view.lanes.map((lane) => lane.kind));
  const thresholdsJson = JSON.stringify(
    view.lanes.map((lane) => ({
      kind: lane.kind,
      verge: typeof lane.verge === 'number' ? round4(lane.verge) : null,
      safe: typeof lane.safe === 'number' ? round4(lane.safe) : null,
      vergeNorm: typeof lane.vergeNorm === 'number' ? round4(lane.vergeNorm) : null,
      safeNorm: typeof lane.safeNorm === 'number' ? round4(lane.safeNorm) : null,
    })),
  );
  const couplingsJson = JSON.stringify(view.couplings ?? []);

  return (
    <div
      ref={hostRef}
      className="string-field"
      data-testid="string-field"
      data-world={view.name}
      data-tick={view.tick}
      data-ended={view.ended ?? ''}
      data-mode={mode}
      data-kind={focusKind}
      data-kind-index={safeFocus}
      data-plucks={plucks}
      data-values={valuesJson}
      data-norms={normsJson}
      data-kinds={kindsJson}
      data-thresholds={thresholdsJson}
      data-couplings={couplingsJson}
      data-lane-count={laneCount}
      data-span={spanUi.toFixed(2)}
      data-resonant={resonantUi ? 'true' : 'false'}
      data-resonance={resonanceUi === null ? '' : resonanceUi.toFixed(1)}
      data-micro={microUi.toFixed(2)}
      data-dual={dualUi ? 'true' : 'false'}
      data-crossings={crossingsCountUi}
      data-pulling={pulling ? 'true' : 'false'}
      data-holding={holding ? 'true' : 'false'}
      data-held-amplitude={heldAmplitude.toFixed(1)}
      data-held-count={heldCount}
      data-link-target={linkTargetName}
      data-focus-id={focusLane?.id ?? ''}
      data-resting={resting ? 'true' : 'false'}
      data-key-count={46}
      data-overview-rows={mode === 'overview' ? KIND_ORDER.length : 0}
      data-audio={audioState}
      data-last-key={lastKey}
      data-last-amplitude={lastAmplitude}
      data-last-direction={lastDirection}
      data-action-count={actions.length}
      data-action-open={actionOpen ? 'true' : 'false'}
      data-action-selected={actionOpen ? String(safeActionSelected) : ''}
      data-last-action={lastAction}
      data-ending={view.ended ?? ''}
      data-ending-tick={view.endedTick === null ? '' : view.endedTick}
      data-ending-actions={view.actionsTaken}
      data-action-note={selectedActionNote}
      data-action-cost={selectedActionCost}
      data-touch={touchMode ? 'true' : 'false'}
    >
      <canvas ref={canvasRef} className="string-canvas" data-testid="string-canvas" />
      {actionOpen && !view.ended && mode === 'strings' ? (
        <div
          data-testid="string-actions"
          className="string-actions"
          style={{
            position: 'absolute',
            left: '50%',
            top: '58%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '9px',
            pointerEvents: touchMode ? 'auto' : 'none',
            fontFamily: 'var(--serif)',
            fontSize: '13px',
            letterSpacing: '0.06em',
            lineHeight: 1.55,
            color: 'var(--ink)',
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeActionsUiRef.current();
          }}
        >
          {actions.map((action, index) => (
            <span
              key={action.id}
              className={`string-action-row${index === safeActionSelected ? ' string-action-row--selected' : ''}`}
              style={{
                opacity: index === safeActionSelected ? 0.9 : 0.35,
                fontSize: index === safeActionSelected ? '14px' : '13px',
                letterSpacing: index === safeActionSelected ? '0.12em' : '0.06em',
                pointerEvents: touchMode ? 'auto' : 'none',
              }}
              onClick={(event) => {
                event.stopPropagation();
                performActionUiRef.current(index);
              }}
            >
              {index + 1}. {action.name}
            </span>
          ))}
          {selectedActionDetail ? (
            <div
              data-testid="string-action-note"
              className="string-action-note"
              style={{
                opacity: 0.2,
                fontSize: '11px',
                letterSpacing: '0.04em',
                marginTop: '2px',
                maxWidth: '46em',
              }}
            >
              {selectedActionDetail}
            </div>
          ) : null}
        </div>
      ) : null}
      {view.ended ? (
        <div
          data-testid="string-ending"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            fontFamily: 'var(--serif)',
            color: 'var(--ink)',
            userSelect: 'none',
          }}
        >
          <div style={{ fontSize: '28px', letterSpacing: '0.14em', opacity: 0.3 }}>{view.ended}</div>
          {endingStats ? (
            <div
              data-testid="string-ending-stats"
              className="string-ending-stats"
              style={{ marginTop: '10px', fontSize: '12px', letterSpacing: '0.08em', opacity: 0.16 }}
            >
              {endingStats}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
