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

/** 一个映射键按住期间改动的段（keyup 时若值变了持久化一次）。 */
interface KeyBandEdit {
  band: number;
  spectrumId: string;
  startValue: number;
  voiceId: number;
  smooth: boolean;
  loop: boolean;
}

/** 上下键惯性移动状态（速度线性加速/减速，位置逐帧连续）。 */
interface ArrowTuneState {
  band: number;
  spectrumId: string;
  dir: 1 | -1;
  velocity: number;
  held: boolean;
  startValue: number;
  /** 按住期间持续发声的 voice（松键立即停）。 */
  voiceId: number;
}

declare global {
  interface Window {
    __neurouSpectrum?: {
      state: () => SpectrumDebugState;
      bandPositions: () => Array<BandPosition & { index: number }>;
      setBand: (bandIndex: number, value: number) => void;
      easeTick: () => number[];
      auditions: () => number;
      bandTargets: () => number[];
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
/** 段点命中半径（按 x 距离，宽松些）。 */
const HIT_RADIUS_PX = 40;
/** 拖动判定阈值：超过这么多像素才算改值（纯点击只选段）。 */
const DRAG_THRESHOLD_PX = 2;

/** 上下键惯性：线性加速到 vmax=(量程)/1.1 每秒，松开 0.22s 线性减速到 0。 */
const ARROW_VMAX_SECONDS = 1.1;
const ARROW_DECEL_SECONDS = 0.22;
/** 持续音色随曲线实时更新：每 ~60ms 换一次波表。 */
const SUSTAINED_UPDATE_MS = 60;
/** 节点拖尾：最近约 450ms 的节点位置淡出。 */
const TRAIL_MS = 450;
const TRAIL_ALPHA = 0.4;
const TRAIL_SAMPLE_MS = 18;

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
  const [lastBandUi, setLastBandUi] = useState<number | null>(null);

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
    let drag: { pointerId: number; band: number; startY: number; moved: boolean; voiceId: number } | null = null;
    let spectrumKey = '';
    let auditionsNow = 0;
    let lastKeyNow = '';
    let lastBandNow: number | null = null;
    /** 节点拖尾：band → 最近 450ms 位置。 */
    const trails = new Map<number, Array<{ t: number; x: number; y: number }>>();
    let lastTrailSample = 0;
    /** 映射键按住改动中的段：keyCode → edit（持续谱带 voice）。 */
    const keyEdits = new Map<string, KeyBandEdit>();
    /** 上下键惯性状态（同一时间一段）。 */
    let arrowTune: ArrowTuneState | null = null;
    let lastVoiceUpdate = 0;
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

    function setLastBand(band: number | null): void {
      if (lastBandNow === band) return;
      lastBandNow = band;
      setLastBandUi(band);
    }

    function activeVoiceCount(): number {
      let count = 0;
      for (const edit of keyEdits.values()) if (edit.voiceId > 0) count += 1;
      return count;
    }

    /** 节点归一化：x 按段位置，y 按 min..max；用于持续音高/音量。 */
    function nodeXNorm(spectrum: SpectrumView, band: number): number {
      const count = targets.length;
      return count <= 1 ? 0.5 : clamp(bandX(spectrum, band, count) / LOGICAL_W, 0, 1);
    }

    function nodeYNorm(spectrum: SpectrumView, value: number): number {
      return clamp((value - spectrum.min) / spectrumSpan(spectrum), 0, 1);
    }

    function startNodeVoice(spectrum: SpectrumView, band: number, value: number): number {
      void audio.ensureStarted();
      const smooth = spectrum.interpolation === '平滑';
      return audio.startSustainedSpectrum(
        displayed,
        nodeXNorm(spectrum, band),
        nodeYNorm(spectrum, value),
        smooth,
        spectrum.loop,
      );
    }

    function updateNodeVoice(id: number, spectrum: SpectrumView, band: number, value: number): void {
      if (id <= 0) return;
      const smooth = spectrum.interpolation === '平滑';
      audio.updateSustainedSpectrum(id, displayed, smooth, spectrum.loop);
      audio.updateSustainedTone(id, nodeXNorm(spectrum, band), nodeYNorm(spectrum, value));
    }

    function stopNodeVoice(id: number): void {
      if (id > 0) audio.stopSustainedSpectrum(id);
    }

    function trailKey(band: number): number {
      return band;
    }

    function recordTrail(band: number, x: number, y: number, now: number): void {
      let points = trails.get(trailKey(band));
      if (!points) {
        points = [];
        trails.set(trailKey(band), points);
      }
      const last = points[points.length - 1];
      if (last && now - last.t < TRAIL_SAMPLE_MS && Math.hypot(last.x - x, last.y - y) < 1.2) return;
      points.push({ t: now, x, y });
      while (points.length > 0 && now - (points[0]?.t ?? now) > TRAIL_MS) points.shift();
      while (points.length > 80) points.shift();
    }

    function recordActiveTrails(now: number, spectrum: SpectrumView): void {
      const count = displayed.length;
      const recordBand = (band: number): void => {
        if (band < 0 || band >= count) return;
        const x = bandX(spectrum, band, count);
        const y = valueToY(spectrum, displayed[band] ?? spectrum.min);
        recordTrail(band, x, y, now);
      };
      if (drag) recordBand(drag.band);
      if (arrowTune) recordBand(arrowTune.band);
      for (const edit of keyEdits.values()) recordBand(edit.band);
      for (const [band, points] of [...trails]) {
        while (points.length > 0 && now - (points[0]?.t ?? now) > TRAIL_MS) points.shift();
        if (points.length === 0) trails.delete(band);
      }
    }

    function drawTrails(now: number): void {
      for (const points of trails.values()) {
        let prev: { x: number; y: number } | null = null;
        for (const point of points) {
          const age = clamp((now - point.t) / TRAIL_MS, 0, 1);
          const alpha = (1 - age) * TRAIL_ALPHA;
          if (alpha <= 0.004) {
            prev = null;
            continue;
          }
          if (prev) {
            ctx.strokeStyle = rgba(ink, alpha * 0.55);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(point.x, point.y);
            ctx.stroke();
          }
          ctx.fillStyle = rgba(ink, alpha);
          ctx.beginPath();
          ctx.arc(point.x, point.y, 1.3 + (1 - age) * 1.0, 0, Math.PI * 2);
          ctx.fill();
          prev = { x: point.x, y: point.y };
        }
      }
    }

    /** 拖动/方向键持续音的波形与音高音量实时跟随。 */
    function syncNodeVoices(now: number): void {
      const spectrum = currentSpectrum();
      if (!spectrum) return;
      if (drag && drag.voiceId > 0) {
        const band = drag.band;
        updateNodeVoice(drag.voiceId, spectrum, band, targets[band] ?? spectrum.min);
      }
      if (arrowTune && arrowTune.voiceId > 0) {
        updateNodeVoice(arrowTune.voiceId, spectrum, arrowTune.band, targets[arrowTune.band] ?? spectrum.min);
      }
      void now;
    }

    /** 一个映射键松开（或切谱/退出）时结算：停 voice；若段值变了持久化一次。 */
    function flushKeyEdit(code: string, persist = true): void {
      const edit = keyEdits.get(code);
      if (!edit) return;
      keyEdits.delete(code);
      if (edit.voiceId > 0) audio.stopSustainedSpectrum(edit.voiceId);
      if (persist) {
        const spectrum = currentSpectrum();
        if (spectrum) {
          const value = clamp(targets[edit.band] ?? edit.startValue, spectrum.min, spectrum.max);
          if (Math.abs(value - edit.startValue) > 1e-6) editRef.current(edit.spectrumId, edit.band, value, true);
        }
      }
      setSustainedCount(activeVoiceCount());
    }

    function flushAllKeyEdits(persist = true): void {
      for (const code of [...keyEdits.keys()]) flushKeyEdit(code, persist);
    }

    /** 持续音色：按住期间每 ~60ms 用当前显示曲线换一次波表，声音跟着曲线变。 */
    function syncSustainedVoices(now: number, force = false): void {
      if (keyEdits.size === 0) return;
      if (!force && now - lastVoiceUpdate < SUSTAINED_UPDATE_MS) return;
      lastVoiceUpdate = now;
      const spectrum = currentSpectrum();
      for (const edit of keyEdits.values()) {
        if (edit.voiceId > 0) {
          audio.updateSustainedSpectrum(edit.voiceId, displayed, edit.smooth, edit.loop);
          if (spectrum) {
            const count = displayed.length;
            const xNorm = count <= 1 ? 0.5 : clamp(bandX(spectrum, edit.band, count) / LOGICAL_W, 0, 1);
            const value = displayed[edit.band] ?? spectrum.min;
            audio.updateSustainedTone(edit.voiceId, xNorm, nodeYNorm(spectrum, value));
          }
        }
      }
    }

    /** 结算上下键惯性：松开减速到 0 / 切谱 / 退出时调用。 */
    function finalizeArrowTune(persist = true): void {
      const tune = arrowTune;
      if (!tune) return;
      arrowTune = null;
      stopNodeVoice(tune.voiceId);
      if (!persist) return;
      const value = targets[tune.band];
      if (value === undefined) return;
      if (Math.abs(value - tune.startValue) > 1e-6) editRef.current(tune.spectrumId, tune.band, value, true);
    }

    function stopDragVoice(): void {
      if (drag && drag.voiceId > 0) {
        audio.stopSustainedSpectrum(drag.voiceId);
        drag.voiceId = 0;
      }
    }

    /** key.cx → 最近段索引；key.cy → 目标值（曲线区 y 上高下低）。 */
    function nearestBandIndex(spectrum: SpectrumView, x: number): number {
      const count = targets.length;
      if (count === 0) return 0;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < count; i += 1) {
        const distance = Math.abs(x - bandX(spectrum, i, count));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      return best;
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
          stopDragVoice();
          drag = null;
          trails.clear();
          flushAllKeyEdits(true);
          finalizeArrowTune(true);
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
        stopDragVoice();
        drag = null;
        trails.clear();
        flushAllKeyEdits(true);
        finalizeArrowTune(true);
        auditionMarks.clear();
        pushUi(true);
        return spectrum;
      }
      // 外部（App）回传的新段值：非拖动、且没有键盘/方向键正在本地改值时温和跟随，不闪烁。
      if (!drag && keyEdits.size === 0 && arrowTune === null && spectrum.bands.length === targets.length) {
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

      // 最近约 450ms 的节点拖尾（线/点，从亮到透明淡出）。
      drawTrails(now);

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
      // 鼠标是「最新输入」：先把方向键惯性/映射键按住改动结算掉，避免两个 target 打架。
      finalizeArrowTune(true);
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
        stopDragVoice();
        drag = null;
        pushUi();
        return;
      }
      selected = hit;
      setLastBand(hit);
      drag = { pointerId: event.pointerId, band: hit, startY: point.y, moved: false, voiceId: 0 };
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
        // 同一拖动手势持续发声：第一次越过阈值时起 voice，之后实时跟随。
        if (drag.voiceId <= 0) drag.voiceId = startNodeVoice(spectrum, drag.band, value);
        else updateNodeVoice(drag.voiceId, spectrum, drag.band, value);
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
      stopNodeVoice(session.voiceId);
      if (!spectrum) return;
      if (!session.moved) {
        // 单击/轻触：保留短音（one-shot）。
        const band = session.band;
        const value = clamp(targets[band] ?? spectrum.min, spectrum.min, spectrum.max);
        audio.previewSpectrum(
          displayed,
          nodeXNorm(spectrum, band),
          nodeYNorm(spectrum, value),
          spectrum.interpolation === '平滑',
          spectrum.loop,
        );
        return;
      }
      const bandIndex = session.band;
      const value = clamp(targets[bandIndex] ?? spectrum.min, spectrum.min, spectrum.max);
      editRef.current(spectrum.id, bandIndex, value, true);
    }

    function onPointerCancel(event: PointerEvent): void {
      if (drag && event.pointerId === drag.pointerId) {
        stopNodeVoice(drag.voiceId);
        drag = null;
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        flushAllKeyEdits(true);
        finalizeArrowTune(true);
        auditionMarks.clear();
        cycleRef.current(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.code === 'Escape' || event.code === 'F2') {
        event.preventDefault();
        event.stopImmediatePropagation();
        flushAllKeyEdits(true);
        finalizeArrowTune(true);
        auditionMarks.clear();
        exitRef.current();
        return;
      }
      // 物理键映射：改曲线（最近段 + 按键 y 的目标值）+ 立即发声，keyup 时持久化一次。
      const auditionKey = keyByCode(keys, event.code);
      if (auditionKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const spectrum = currentSpectrum();
        if (!spectrum) return;
        finalizeArrowTune(true);
        if (keyEdits.has(event.code)) flushKeyEdit(event.code, true);
        const band = nearestBandIndex(spectrum, auditionKey.cx);
        const value = yToValue(spectrum, auditionKey.cy);
        targets[band] = value;
        selected = band;
        setLastBand(band);
        auditionsNow += 1;
        lastKeyNow = event.code;
        pushAuditionUi();
        const now = performance.now();
        auditionMarks.set(event.code, { x: auditionKey.cx, label: auditionKey.label, pressedAt: now, releasedAt: null });
        void audio.ensureStarted();
        const smooth = spectrum.interpolation === '平滑';
        const loop = spectrum.loop;
        const startValue = spectrum.bands[band] ?? value;
        if (spectrum.articulation === '持续') {
          // 持续（拉奏/吹奏）：按住期间 voice 用显示曲线实时换波表。
          const voiceId = audio.startSustainedSpectrum(displayed, auditionKey.cx / LOGICAL_W, 0.5, smooth, loop);
          keyEdits.set(event.code, { band, spectrumId: spectrum.id, startValue, voiceId, smooth, loop });
          setSustainedCount(activeVoiceCount());
          syncSustainedVoices(now, true);
        } else {
          // 拨弦：one-shot；仍记录改动，keyup 时持久化。
          audio.previewSpectrum(displayed, auditionKey.cx / LOGICAL_W, 0.5, smooth, loop);
          keyEdits.set(event.code, { band, spectrumId: spectrum.id, startValue, voiceId: 0, smooth, loop });
        }
        pushUi();
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
      // ↑/↓：按住连续 + 惯性（速度从 0 线性加速到 vmax，松开 0.22s 线性减速到 0）。
      if (selected === null) selected = 0;
      const bandIndex = selected;
      const dir: 1 | -1 = event.code === 'ArrowUp' ? 1 : -1;
      if (arrowTune && arrowTune.band === bandIndex) {
        // 反向按住：保留速度，加速度让它平滑过零；若上次的 voice 已停则重新起音。
        arrowTune.dir = dir;
        arrowTune.held = true;
        arrowTune.spectrumId = spectrum.id;
        if (arrowTune.voiceId <= 0) {
          arrowTune.voiceId = startNodeVoice(spectrum, bandIndex, targets[bandIndex] ?? spectrum.min);
        }
      } else {
        if (arrowTune) finalizeArrowTune(true);
        arrowTune = {
          band: bandIndex,
          spectrumId: spectrum.id,
          dir,
          velocity: 0,
          held: true,
          startValue: targets[bandIndex] ?? spectrum.min,
          voiceId: startNodeVoice(spectrum, bandIndex, targets[bandIndex] ?? spectrum.min),
        };
      }
      setLastBand(bandIndex);
      pushUi();
    }

    function onKeyUp(event: KeyboardEvent): void {
      const mark = auditionMarks.get(event.code);
      if (mark && mark.releasedAt === null) mark.releasedAt = performance.now();
      // 映射键松开：停 voice + 该段若变了持久化一次。
      flushKeyEdit(event.code, true);
      // ↑/↓ 松开：进入线性减速；velocity 到 0 时再持久化一次。
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        const dir: 1 | -1 = event.code === 'ArrowUp' ? 1 : -1;
        if (arrowTune && arrowTune.dir === dir) {
          arrowTune.held = false;
          // 松键立即停持续音（惯性滑行只保留视觉/数值）。
          stopNodeVoice(arrowTune.voiceId);
          arrowTune.voiceId = 0;
          if (arrowTune.velocity === 0) finalizeArrowTune(true);
        }
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
      // 上下键惯性：速度线性加速/减速，位置逐帧连续；到 min/max 停下。
      if (arrowTune && spectrum) {
        const tune = arrowTune;
        const vmax = spectrumSpan(spectrum) / ARROW_VMAX_SECONDS;
        if (tune.held) {
          const targetV = tune.dir * vmax;
          const accel = vmax / ARROW_VMAX_SECONDS;
          if (tune.velocity < targetV) tune.velocity = Math.min(targetV, tune.velocity + accel * dt);
          else if (tune.velocity > targetV) tune.velocity = Math.max(targetV, tune.velocity - accel * dt);
        } else {
          const decel = vmax / ARROW_DECEL_SECONDS;
          if (tune.velocity > 0) tune.velocity = Math.max(0, tune.velocity - decel * dt);
          else if (tune.velocity < 0) tune.velocity = Math.min(0, tune.velocity + decel * dt);
        }
        if (tune.velocity !== 0) {
          const before = targets[tune.band] ?? spectrum.min;
          const next = clamp(before + tune.velocity * dt, spectrum.min, spectrum.max);
          if (next !== before) {
            targets[tune.band] = next;
            pushUi();
          }
          if (next === spectrum.min || next === spectrum.max) tune.velocity = 0;
        }
        if (!tune.held && tune.velocity === 0) finalizeArrowTune(true);
      } else if (arrowTune) {
        finalizeArrowTune(false);
      }
      // 持续音色实时跟随显示曲线（每 ~60ms 换一次波表）。
      syncSustainedVoices(now);
      // 拖动/方向键持续音的波形与音高/音量跟随；节点拖尾采样。
      syncNodeVoices(now);
      if (spectrum) recordActiveTrails(now, spectrum);
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
      bandTargets: () => targets.map((value) => round4(value)),
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
      flushAllKeyEdits(false);
      finalizeArrowTune(false);
      stopDragVoice();
      trails.clear();
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
      data-last-band={lastBandUi === null ? '' : String(lastBandUi)}
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
