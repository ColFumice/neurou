/**
 * 谱模式：一张白纸上的极简曲线编辑器（v1.9）。
 *
 * 一条「谱」= 若干个频段值连成的曲线：x 是频段位置（均匀铺开），y 是该段的值
 * （min 在下、max 在上）。白纸 + 墨线，无面板/按钮/数字/彩色；曲线本身 + 极淡
 * 参考线 + 段点 + 左下角极淡谱名构成全部视觉。
 *
 * 交互：拖段点上下改值（显示值 ~160ms 缓动追随目标，松手才 persist 写回一次）；
 * Tab/Shift+Tab 切谱；Escape/F2 退出；←/→ 选段，↑/↓ 按 (max-min)/100 微调。
 * 只负责画布与输入：值真正写回由 App 的 onEditBand 处理。
 */
import { useEffect, useRef, useState } from 'react';
import { getStringAudio } from './stringAudio.js';
import { keyByCode, layoutKeyboard } from './stringMath.js';

/* ------------------------------------------------------------------ *
 * 类型 / Prop 契约
 * ------------------------------------------------------------------ */

export interface SpectrumView {
  id: string;
  name: string;
  bands: number[];
  min: number;
  max: number;
  interpolation: '线性' | '平滑';
  loop: boolean;
  mode: '固定' | '受迫';
  /** 演奏方式：拨弦 = 一次性；持续 = 按住循环发声（v2.0.1）。 */
  articulation: '拨弦' | '持续';
}

export interface SpectrumFieldProps {
  spectra: SpectrumView[];
  index: number;
  onCycleSpectrum: (dir: 1 | -1) => void;
  onEditBand: (spectrumId: string, bandIndex: number, value: number, persist?: boolean) => void;
  onExit: () => void;
}

interface SpectrumDebugState {
  id: string;
  name: string;
  index: number;
  count: number;
  bands: number[];
  values: number[];
  targets: number[];
  selected: number | null;
  hover: number | null;
  interpolation: '线性' | '平滑';
  loop: boolean;
  mode: '固定' | '受迫';
  articulation: '拨弦' | '持续';
}

interface BandPosition {
  x: number;
  y: number;
  value: number;
}

declare global {
  interface Window {
    __neurouSpectrum?: {
      state: () => SpectrumDebugState;
      bandPositions: () => Array<BandPosition & { index: number }>;
      setBand: (bandIndex: number, value: number) => void;
      easeTick: () => number[];
      auditions: () => number;
    };
  }
}

/* ------------------------------------------------------------------ *
 * 常量 / 手感参数
 * ------------------------------------------------------------------ */

type Rgb = readonly [number, number, number];

const LOGICAL_W = 1440;
const LOGICAL_H = 900;

/** 曲线区域（逻辑坐标）。 */
const PLOT_LEFT = 120;
const PLOT_RIGHT = 1320;
const PLOT_TOP = 140;
const PLOT_BOTTOM = 760;

/** 极淡水平参考线（min / 中 / max）。 */
const REFERENCE_ALPHA = 0.04;
const REFERENCE_STEPS = 3;

/** 曲线。 */
const CURVE_STEPS = 480;
const CURVE_ALPHA = 0.75;
const CURVE_WIDTH = 1.65;

/** 段点。 */
const BAND_RADIUS = 2.6;
const BAND_HOVER_RADIUS = 3.6;
const BAND_SELECTED_RADIUS = 4.5;
const BAND_ALPHA = 0.45;
const BAND_HOVER_ALPHA = 0.65;
const BAND_SELECTED_ALPHA = 0.95;

/** 谱名 / 多谱指示点。 */
const NAME_FONT_PX = 12;
const NAME_ALPHA = 0.25;
const NAME_Y = PLOT_BOTTOM + 38;
const DOTS_SIZE = 2;
const DOTS_GAP = 12;
const DOTS_ALPHA = 0.22;
const DOTS_CURRENT_ALPHA = 0.55;

/** 显示值缓动：每帧收敛 18%（~60fps 下约 160ms 视觉追平，任务允许「每帧 0.18」）。 */
const EASE_PER_FRAME = 0.18;
const EASE_EPSILON = 0.0005;
/** 键盘微调步长 = (max-min) / KEY_STEP_DIVISOR。 */
const KEY_STEP_DIVISOR = 100;
/** 段点命中半径（按 x 距离，宽松些）。 */
const HIT_RADIUS_PX = 40;
/** 拖动判定阈值：超过这么多像素才算改值（纯点击只选段）。 */
const DRAG_THRESHOLD_PX = 2;

/** 按键反馈：键位 x 处极淡短竖线 + 底部该键字符；拨弦 300ms 淡出，持续按住保持。 */
const FEEDBACK_LINE_ALPHA = 0.2;
const FEEDBACK_LABEL_ALPHA = 0.3;
const FEEDBACK_LINE_TOP = 800;
const FEEDBACK_LINE_BOTTOM = 818;
const FEEDBACK_LABEL_FONT_PX = 11;
const FEEDBACK_LABEL_Y = 840;
const FEEDBACK_FADE_MS = 300;

const DEFAULT_SERIF = '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", Georgia, serif';
const FALLBACK_INK: Rgb = [11, 11, 11];
const FALLBACK_PAPER: Rgb = [250, 250, 250];

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

function formatBandList(values: readonly number[]): string {
  return JSON.stringify(values.map((value) => round4(value)));
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export function SpectrumField({ spectra, index, onCycleSpectrum, onEditBand, onExit }: SpectrumFieldProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectraRef = useRef<SpectrumView[]>(spectra);
  const indexRef = useRef<number>(index);
  const cycleRef = useRef(onCycleSpectrum);
  const editRef = useRef(onEditBand);
  const exitRef = useRef(onExit);
  spectraRef.current = spectra;
  indexRef.current = index;
  cycleRef.current = onCycleSpectrum;
  editRef.current = onEditBand;
  exitRef.current = onExit;

  const spectrumCount = spectra.length;
  const safeSpectrumIndex = spectrumCount > 0 ? Math.min(Math.max(index, 0), spectrumCount - 1) : 0;
  const current = spectra[safeSpectrumIndex] ?? null;
  const [valuesUi, setValuesUi] = useState<number[]>([]);
  const [targetsUi, setTargetsUi] = useState<number[]>([]);
  const [selectedUi, setSelectedUi] = useState<number | null>(null);
  const [hoverUi, setHoverUi] = useState<number | null>(null);
  const [auditionsUi, setAuditionsUi] = useState(0);
  const [lastKeyUi, setLastKeyUi] = useState('');
  const [sustainedCountUi, setSustainedCountUi] = useState(0);

  const bandsJson = formatBandList(valuesUi);
  const targetsJson = formatBandList(targetsUi);

  useEffect(() => {
    const hostElement = hostRef.current;
    const canvasElement = canvasRef.current;
    if (!hostElement || !canvasElement) return;
    const contextMaybe = canvasElement.getContext('2d');
    if (!contextMaybe) return;

    const host = hostElement;
    const canvas = canvasElement;
    const ctx = contextMaybe;
    const audio = getStringAudio();
    const keys = layoutKeyboard();

    /* —— 可变状态 —— */
    let displayed: number[] = [];
    let targets: number[] = [];
    let selected: number | null = null;
    let hover: number | null = null;
    let drag: { pointerId: number; band: number; startY: number; moved: boolean } | null = null;
    let spectrumKey = '';
    let auditionsNow = 0;
    let lastKeyNow = '';
    /** 持续音（拉奏/吹奏）：keyCode → audio voice id，多键各自独立。 */
    const sustainedVoices = new Map<string, number>();
    /** 按键反馈：keyCode → 位置/字符/按下与松开时间（松开后 300ms 淡出）。 */
    const auditionMarks = new Map<
      string,
      { x: number; label: string; pressedAt: number; releasedAt: number | null }
    >();
    let scaleX = 1;
    let scaleY = 1;
    let ink: Rgb = FALLBACK_INK;
    let paper: Rgb = FALLBACK_PAPER;
    let serif = DEFAULT_SERIF;
    let lastFrame = 0;
    let requestId = 0;

    function currentSpectrum(): SpectrumView | null {
      const list = spectraRef.current;
      if (list.length === 0) return null;
      const safeIndex = clamp(indexRef.current, 0, list.length - 1);
      return list[safeIndex] ?? null;
    }

    function spectrumSpan(spectrum: SpectrumView): number {
      const span = spectrum.max - spectrum.min;
      return Math.abs(span) > 1e-9 ? span : 1;
    }

    function valueToY(spectrum: SpectrumView, value: number): number {
      const norm = clamp((value - spectrum.min) / spectrumSpan(spectrum), 0, 1);
      return PLOT_BOTTOM - norm * (PLOT_BOTTOM - PLOT_TOP);
    }

    function yToValue(spectrum: SpectrumView, y: number): number {
      const ratio = (PLOT_BOTTOM - y) / (PLOT_BOTTOM - PLOT_TOP);
      return clamp(spectrum.min + clamp(ratio, 0, 1) * spectrumSpan(spectrum), spectrum.min, spectrum.max);
    }

    function bandX(spectrum: SpectrumView, bandIndex: number, count: number): number {
      if (count <= 1) return (PLOT_LEFT + PLOT_RIGHT) / 2;
      const t = spectrum.loop ? bandIndex / count : bandIndex / (count - 1);
      return PLOT_LEFT + clamp(t, 0, 1) * (PLOT_RIGHT - PLOT_LEFT);
    }

    function smoothStep(value: number): number {
      return 0.5 - 0.5 * Math.cos(Math.PI * clamp(value, 0, 1));
    }

    function sampleCurve(spectrum: SpectrumView, values: readonly number[], t: number): number {
      const count = values.length;
      if (count === 0) return spectrum.min;
      if (count === 1) return values[0] ?? spectrum.min;
      if (spectrum.loop) {
        const scaled = clamp(t, 0, 1) * count;
        const i0 = Math.floor(scaled) % count;
        const i1 = (i0 + 1) % count;
        const raw = scaled - Math.floor(scaled);
        const u = spectrum.interpolation === '平滑' ? smoothStep(raw) : raw;
        const a = values[i0] ?? spectrum.min;
        const b = values[i1] ?? spectrum.min;
        return a + (b - a) * u;
      }
      const pos = clamp(t, 0, 1) * (count - 1);
      const i0 = Math.min(count - 1, Math.floor(pos));
      const i1 = Math.min(count - 1, i0 + 1);
      const raw = pos - i0;
      const u = spectrum.interpolation === '平滑' ? smoothStep(raw) : raw;
      const a = values[i0] ?? spectrum.min;
      const b = values[i1] ?? spectrum.min;
      return a + (b - a) * u;
    }

    function pushUi(force = false): void {
      setValuesUi((previous) => {
        if (!force && previous.length === displayed.length && previous.every((value, i) => Math.abs(value - (displayed[i] ?? 0)) < EASE_EPSILON)) {
          return previous;
        }
        return displayed.slice();
      });
      setTargetsUi((previous) => {
        if (!force && previous.length === targets.length && previous.every((value, i) => Math.abs(value - (targets[i] ?? 0)) < 1e-6)) {
          return previous;
        }
        return targets.slice();
      });
      setSelectedUi((previous) => (previous === selected ? previous : selected));
      setHoverUi((previous) => (previous === hover ? previous : hover));
    }

    function pushAuditionUi(): void {
      setAuditionsUi(auditionsNow);
      setLastKeyUi(lastKeyNow);
    }

    function setSustainedCount(value: number): void {
      setSustainedCountUi(value);
    }

    /** 停掉全部持续音（Tab/切谱/Esc/卸载时调用）。 */
    function stopAllSustained(updateUi = true): void {
      for (const id of sustainedVoices.values()) audio.stopSustainedSpectrum(id);
      sustainedVoices.clear();
      if (updateUi) setSustainedCount(0);
    }

    /** 谱切换 / 频段数量变化时：快照到新谱、清掉选中/hover/拖动。 */
    function syncSpectrum(): SpectrumView | null {
      const list = spectraRef.current;
      const spectrum = currentSpectrum();
      if (!spectrum) {
        if (spectrumKey !== '') {
          spectrumKey = '';
          displayed = [];
          targets = [];
          selected = null;
          hover = null;
          drag = null;
          stopAllSustained();
          auditionMarks.clear();
          pushUi(true);
        }
        return null;
      }
      const safeIndex = clamp(indexRef.current, 0, list.length - 1);
      const key = `${safeIndex}::${spectrum.id}::${spectrum.bands.length}`;
      if (key !== spectrumKey) {
        spectrumKey = key;
        targets = spectrum.bands.map((value) => clamp(value, spectrum.min, spectrum.max));
        displayed = targets.slice();
        selected = null;
        hover = null;
        drag = null;
        stopAllSustained();
        auditionMarks.clear();
        pushUi(true);
        return spectrum;
      }
      // 外部（App）回传的新段值：非拖动时温和跟随，不闪烁。
      if (!drag && spectrum.bands.length === targets.length) {
        let changed = false;
        for (let i = 0; i < targets.length; i += 1) {
          const next = clamp(spectrum.bands[i] ?? spectrum.min, spectrum.min, spectrum.max);
          if (Math.abs(next - (targets[i] ?? next)) > 1e-6) {
            targets[i] = next;
            changed = true;
          }
        }
        if (changed) pushUi();
      }
      return spectrum;
    }

    /* —— 主题 / 尺寸 —— */
    function readTheme(): void {
      const style = getComputedStyle(host);
      ink = parseCssColor(style.getPropertyValue('--ink')) ?? FALLBACK_INK;
      paper = parseCssColor(style.getPropertyValue('--paper')) ?? FALLBACK_PAPER;
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

    /** 找离鼠标 x 最近的段点（宽松命中半径）。 */
    function hitBand(spectrum: SpectrumView, logicalX: number): number | null {
      const count = targets.length;
      if (count === 0) return null;
      let best = -1;
      let bestDistance = HIT_RADIUS_PX;
      for (let i = 0; i < count; i += 1) {
        const distance = Math.abs(logicalX - bandX(spectrum, i, count));
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      return best >= 0 ? best : null;
    }

    /* —— 绘制 —— */
    function draw(spectrum: SpectrumView | null, now: number): void {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      if (!spectrum) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        return;
      }

      // 极淡水平参考线（min / 中 / max）
      ctx.strokeStyle = rgba(ink, REFERENCE_ALPHA);
      ctx.lineWidth = 1;
      for (let step = 0; step < REFERENCE_STEPS; step += 1) {
        const ratio = REFERENCE_STEPS <= 1 ? 0.5 : step / (REFERENCE_STEPS - 1);
        const y = PLOT_BOTTOM - ratio * (PLOT_BOTTOM - PLOT_TOP);
        ctx.beginPath();
        ctx.moveTo(PLOT_LEFT, y);
        ctx.lineTo(PLOT_RIGHT, y);
        ctx.stroke();
      }

      // 曲线（480 点采样）
      ctx.strokeStyle = rgba(ink, CURVE_ALPHA);
      ctx.lineWidth = CURVE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let step = 0; step <= CURVE_STEPS; step += 1) {
        const t = step / CURVE_STEPS;
        const x = PLOT_LEFT + t * (PLOT_RIGHT - PLOT_LEFT);
        const value = sampleCurve(spectrum, displayed, t);
        const y = valueToY(spectrum, value);
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 段点
      const count = displayed.length;
      for (let i = 0; i < count; i += 1) {
        const x = bandX(spectrum, i, count);
        const y = valueToY(spectrum, displayed[i] ?? spectrum.min);
        const isSelected = selected === i;
        const isHover = hover === i;
        const radius = isSelected ? BAND_SELECTED_RADIUS : isHover ? BAND_HOVER_RADIUS : BAND_RADIUS;
        const alpha = isSelected ? BAND_SELECTED_ALPHA : isHover ? BAND_HOVER_ALPHA : BAND_ALPHA;
        ctx.fillStyle = rgba(ink, alpha);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 左下极淡谱名
      ctx.font = `${NAME_FONT_PX}px ${serif}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(ink, NAME_ALPHA);
      ctx.fillText(spectrum.name, PLOT_LEFT, NAME_Y);

      // 多谱指示点（右下，当前略深）
      const total = spectraRef.current.length;
      if (total > 1) {
        const activeIndex = clamp(indexRef.current, 0, total - 1);
        const startX = PLOT_RIGHT - (total - 1) * DOTS_GAP;
        for (let i = 0; i < total; i += 1) {
          ctx.fillStyle = rgba(ink, i === activeIndex ? DOTS_CURRENT_ALPHA : DOTS_ALPHA);
          ctx.beginPath();
          ctx.arc(startX + i * DOTS_GAP, NAME_Y, DOTS_SIZE, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // 按键反馈：键位 x 处极淡短竖线 + 底部该键字符（拨弦 300ms 淡出，持续按住保持）
      if (auditionMarks.size > 0) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        for (const [code, mark] of [...auditionMarks]) {
          const fade = mark.releasedAt === null ? 1 : Math.max(0, 1 - (now - mark.releasedAt) / FEEDBACK_FADE_MS);
          if (fade <= 0) {
            auditionMarks.delete(code);
            continue;
          }
          const x = clamp(mark.x, 0, LOGICAL_W);
          ctx.strokeStyle = rgba(ink, FEEDBACK_LINE_ALPHA * fade);
          ctx.beginPath();
          ctx.moveTo(x, FEEDBACK_LINE_TOP);
          ctx.lineTo(x, FEEDBACK_LINE_BOTTOM);
          ctx.stroke();
          ctx.font = `${FEEDBACK_LABEL_FONT_PX}px ${serif}`;
          ctx.fillStyle = rgba(ink, FEEDBACK_LABEL_ALPHA * fade);
          ctx.fillText(mark.label, x, FEEDBACK_LABEL_Y);
        }
      }
      ctx.textAlign = 'center';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* —— 输入 —— */
    function onPointerDown(event: PointerEvent): void {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const spectrum = currentSpectrum();
      if (!spectrum) return;
      const point = pointToLogical(event.clientX, event.clientY);
      const hit = hitBand(spectrum, point.x);
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      if (hit === null) {
        selected = null;
        drag = null;
        pushUi();
        return;
      }
      selected = hit;
      drag = { pointerId: event.pointerId, band: hit, startY: point.y, moved: false };
      pushUi();
    }

    function onPointerMove(event: PointerEvent): void {
      const spectrum = currentSpectrum();
      if (!spectrum) return;
      const point = pointToLogical(event.clientX, event.clientY);
      const hit = hitBand(spectrum, point.x);
      if (hit !== hover) {
        hover = hit;
        canvas.style.cursor = hit === null ? 'default' : 'ns-resize';
        pushUi();
      }
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (Math.abs(point.y - drag.startY) > DRAG_THRESHOLD_PX) drag.moved = true;
      if (!drag.moved) return;
      const value = yToValue(spectrum, point.y);
      if (drag.band >= 0 && drag.band < targets.length) {
        targets[drag.band] = value;
        pushUi();
      }
    }

    function onPointerUp(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const spectrum = currentSpectrum();
      const session = drag;
      drag = null;
      try {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      if (!spectrum || !session.moved) return;
      const bandIndex = session.band;
      const value = clamp(targets[bandIndex] ?? spectrum.min, spectrum.min, spectrum.max);
      editRef.current(spectrum.id, bandIndex, value, true);
    }

    function onPointerCancel(event: PointerEvent): void {
      if (drag && event.pointerId === drag.pointerId) drag = null;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopAllSustained();
        auditionMarks.clear();
        cycleRef.current(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.code === 'Escape' || event.code === 'F2') {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopAllSustained();
        auditionMarks.clear();
        exitRef.current();
        return;
      }
      // 试听：复用 46 键物理映射（Tab/Esc/F2/方向键已在上面排除，修饰键在上面提前返回）。
      const auditionKey = keyByCode(keys, event.code);
      if (auditionKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const spectrum = currentSpectrum();
        if (!spectrum) return;
        auditionsNow += 1;
        lastKeyNow = event.code;
        pushAuditionUi();
        const now = performance.now();
        auditionMarks.set(event.code, { x: auditionKey.cx, label: auditionKey.label, pressedAt: now, releasedAt: null });
        void audio.ensureStarted();
        const xNorm = auditionKey.cx / LOGICAL_W;
        if (spectrum.articulation === '持续') {
          // 持续（拉奏/吹奏）：按 keyCode 各持一个循环 voice，松手才停。
          const voiceId = audio.startSustainedSpectrum(
            spectrum.bands,
            xNorm,
            0.5,
            spectrum.interpolation === '平滑',
            spectrum.loop,
          );
          if (voiceId > 0) {
            sustainedVoices.set(event.code, voiceId);
            setSustainedCount(sustainedVoices.size);
          }
        } else {
          audio.previewSpectrum(
            spectrum.bands,
            xNorm,
            0.5,
            spectrum.interpolation === '平滑',
            spectrum.loop,
          );
        }
        return;
      }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        return;
      }
      const spectrum = currentSpectrum();
      const count = targets.length;
      if (!spectrum || count === 0) return;
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        const step = event.code === 'ArrowRight' ? 1 : -1;
        const next = selected === null ? (step > 0 ? 0 : count - 1) : ((selected + step) % count + count) % count;
        selected = next;
        pushUi();
        return;
      }
      // ↑/↓ 微调选中段的值（步长 = 量程/100），persist=true
      if (selected === null) selected = 0;
      const step = spectrumSpan(spectrum) / KEY_STEP_DIVISOR;
      const direction = event.code === 'ArrowUp' ? 1 : -1;
      const bandIndex = selected;
      const nextValue = clamp((targets[bandIndex] ?? spectrum.min) + direction * step, spectrum.min, spectrum.max);
      targets[bandIndex] = nextValue;
      pushUi();
      editRef.current(spectrum.id, bandIndex, nextValue, true);
    }

    function onKeyUp(event: KeyboardEvent): void {
      const mark = auditionMarks.get(event.code);
      if (mark && mark.releasedAt === null) mark.releasedAt = performance.now();
      const voiceId = sustainedVoices.get(event.code);
      if (voiceId !== undefined) {
        audio.stopSustainedSpectrum(voiceId);
        sustainedVoices.delete(event.code);
        setSustainedCount(sustainedVoices.size);
      }
    }

    /* —— 每帧：缓动 + 绘制 —— */
    function frame(now: number): void {
      requestId = window.requestAnimationFrame(frame);
      const dt = lastFrame > 0 ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
      lastFrame = now;
      const spectrum = syncSpectrum();
      if (targets.length > 0) {
        // 每帧收敛 18%（帧率变化时按 dt 折算，保持同样的手感）。
        const factor = 1 - Math.pow(1 - EASE_PER_FRAME, dt * 60);
        let changed = false;
        for (let i = 0; i < targets.length; i += 1) {
          const currentValue = displayed[i] ?? targets[i] ?? 0;
          const targetValue = targets[i] ?? currentValue;
          const delta = targetValue - currentValue;
          if (Math.abs(delta) < EASE_EPSILON) {
            if (currentValue !== targetValue) {
              displayed[i] = targetValue;
              changed = true;
            }
          } else {
            displayed[i] = currentValue + delta * factor;
            changed = true;
          }
        }
        if (changed) pushUi();
      }
      draw(spectrum, now);
    }

    /* —— 调试 / 验收钩子 —— */
    function buildState(): SpectrumDebugState {
      const spectrum = currentSpectrum();
      const count = spectraRef.current.length;
      const safeIndex = count > 0 ? clamp(indexRef.current, 0, count - 1) : 0;
      return {
        id: spectrum?.id ?? '',
        name: spectrum?.name ?? '',
        index: safeIndex,
        count,
        bands: spectrum ? spectrum.bands.slice() : [],
        values: displayed.map((value) => round4(value)),
        targets: targets.map((value) => round4(value)),
        selected,
        hover,
        interpolation: spectrum?.interpolation ?? '线性',
        loop: spectrum?.loop ?? false,
        mode: spectrum?.mode ?? '固定',
        articulation: spectrum?.articulation ?? '拨弦',
      };
    }

    const debugApi: NonNullable<Window['__neurouSpectrum']> = {
      state: () => buildState(),
      bandPositions: () => {
        const spectrum = currentSpectrum();
        if (!spectrum) return [];
        const count = displayed.length;
        return displayed.map((value, i) => ({
          index: i,
          x: Math.round(bandX(spectrum, i, count) * 100) / 100,
          y: Math.round(valueToY(spectrum, value) * 100) / 100,
          value: round4(value),
        }));
      },
      setBand: (bandIndex: number, value: number) => {
        const spectrum = currentSpectrum();
        if (!spectrum) return;
        const safeIndex = Math.floor(bandIndex);
        if (safeIndex < 0 || safeIndex >= targets.length) return;
        const nextValue = clamp(value, spectrum.min, spectrum.max);
        targets[safeIndex] = nextValue;
        pushUi();
        editRef.current(spectrum.id, safeIndex, nextValue, false);
      },
      easeTick: () => {
        for (let i = 0; i < targets.length; i += 1) displayed[i] = targets[i] ?? displayed[i] ?? 0;
        pushUi(true);
        return displayed.map((value) => round4(value));
      },
      auditions: () => auditionsNow,
    };

    window.__neurouSpectrum = debugApi;

    readTheme();
    resize();
    syncSpectrum();
    pushUi(true);

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

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
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      stopAllSustained(false);
      auditionMarks.clear();
      if (window.__neurouSpectrum === debugApi) delete window.__neurouSpectrum;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="spectrum-field"
      data-screen="spectrum"
      data-spectrum-id={current?.id ?? ''}
      data-spectrum-name={current?.name ?? ''}
      data-spectrum-index={safeSpectrumIndex}
      data-spectrum-count={spectrumCount}
      data-band-values={bandsJson}
      data-band-targets={targetsJson}
      data-band-selected={selectedUi === null ? '' : String(selectedUi)}
      data-hover-band={hoverUi === null ? '' : String(hoverUi)}
      data-auditions={auditionsUi}
      data-last-key={lastKeyUi}
      data-articulation={current?.articulation ?? '拨弦'}
      data-sustained-count={sustainedCountUi}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--paper, #fafafa)',
        touchAction: 'none',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
