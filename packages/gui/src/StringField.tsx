/**
 * 单弦调律台（首屏）：一张白纸，正中一根水平墨弦。
 *
 * - 静止：只有那条线。没有任何 idle 动画、面板、按钮、常驻文字；
 * - 点击/按住拖动：弦在该 x 处被拉向触点，方向=上下、幅度=离弦远近，
 *   整条弦弯成弓形（StringSim.pull），松手释放成波（物理开始 step）；
 *   快速点触（<260ms 且几乎没移动）则丢掉弓形、改注入一次纯局部 pluck，
 *   于是点击位置立刻泛起向两端传播、反射的涟漪（不是整根弦一起慢慢摆）；
 * - 物理按键（数字/字母/符号 46 键）按真实键位映射到屏幕：keydown 即一次
 *   局部拨动（StringSim.pluck），触点上浮现该键的淡字约 550ms 后消失；
 *   键盘映射完全隐形，不按键时屏幕上没有任何键位痕迹；
 * - Tab / Shift+Tab：按 8 类弦循环（KIND_VISUAL 各有一套速度/阻尼/线宽/激励），
 *   切换时弦左端上方浮现类名 1.4s，并在弦心自动演示一次 pluck；
 * - Esc：8 类弦的签名波叠成总览谱面，当前类实黑；Tab 仍切当前类，
 *   点击某一行 = 选中该类、回到单弦并拨一次；
 * - 墨色渲染：沿采样点变化的线宽（峰部更粗）+ 峰部更深 + 很淡的宽笔洇开；
 *   离屏 trailCanvas 做黑色帧残留（destination-out 淡出 + 低 alpha 重绘）；
 * - 颜色只走 var(--ink) / var(--paper) 与灰度，无彩色、无发光。
 *
 * 本组件是自包含覆盖层：唯一收指针事件的元素是整屏 canvas，
 * 其余渲染都在 canvas 内完成，不在 DOM 里留下任何常驻文字/按钮。
 */
import { useEffect, useRef, useState } from 'react';
import type { StringKind } from '@neurou/core';
import {
  KEY_COUNT,
  KIND_ORDER,
  KIND_VISUAL,
  LOGICAL_H,
  LOGICAL_W,
  STRING_CENTER_Y,
  StringSim,
  keyByCode,
  layoutKeyboard,
  nextKind,
  signature,
  touchFromKey,
  touchFromPoint,
  type KindVisualProfile,
  type TouchPoint,
} from './stringMath.js';
import { getStringAudio, type StringAudioState } from './stringAudio.js';
import './string-field.css';

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

type ViewMode = 'string' | 'overview';
type Rgb = readonly [number, number, number];

/** 键盘触点的淡字：约 550ms 消失。 */
const GHOST_FADE_MS = 550;
/** Tab 切换后类名浮现：约 1.4s 淡出。 */
const HINT_FADE_MS = 1400;
/** 总览谱面的淡入淡出。 */
const OVERVIEW_FADE_MS = 180;
/** trailCanvas 每帧被 destination-out 抹掉的比例。 */
const TRAIL_DECAY = 0.12;
/** 当前弦以多低的 alpha 写进 trailCanvas（分两层叠加，合计 ≈0.5）。 */
const TRAIL_ALPHA = 0.5;
/** 大模糊层：让帧残留融成墨晕（运动模糊），而不是一圈圈等高线。 */
const TRAIL_BLUR_PX = 6;
/** 轻模糊层：保留一点帧残留的细线（两层叠加才有「墨的残影」手感）。 */
const TRAIL_FRAME_BLUR_PX = 1.5;
/** 弦停住后拖尾再淡出多久（秒）。 */
const TRAIL_SETTLE_SECONDS = 0.55;
/**
 * 「点触」判定：按住 <260ms 且位移 <8px。
 * 点触 = 纯局部拨动：丢掉 pointerdown 的整弦弓形，重新注入一次局部 pluck（幅度 0.85×），
 * 于是点击位置立刻出现沿弦传播、两端反射的涟漪，而不是整根弦一起慢慢上下摆。
 * 拖动/长按才是「拉弓 → 释放整弦弓形」。
 */
const QUICK_TAP_MS = 260;
const QUICK_TAP_MOVE_PX = 8;
const QUICK_TAP_PLUCK_RATIO = 0.85;
/** 线宽/alpha 的量化档数（足够平滑，又避免逐段 stroke 的开销）。 */
const BAND_COUNT = 9;
/**
 * 显示层平滑：对物理位移做盒式模糊（≈高斯），把理想弦的折线帐篷磨成「拉弓」的曲线。
 * 平滑强度随状态变化：拉弦时 1（弯弓），释放后 ~0.12s 内淡回 0（保留行波/折点，弦才有动感）。
 * 半径按「逻辑像素」换算成采样点，STRING_N 变化时磨圆程度不变。
 * 只影响渲染，不影响 sim 的物理与调试 u()。
 */
const DISPLAY_SMOOTH_PX = 32;
const DISPLAY_SMOOTH_PASSES = 4;
const DISPLAY_SMOOTH_TAU = 0.12;
/** 清晰墨线落两笔：静息近黑、峰部更黑（trail 层只落一笔）。 */
const SHARP_PASSES = 2;

/** 总览：8 行签名波的几何。 */
const OVERVIEW_TOP = 90;
const OVERVIEW_BOTTOM = 810;
const OVERVIEW_LEFT = 160;
const OVERVIEW_RIGHT = 1280;
const OVERVIEW_WAVE_PX = 26;
const OVERVIEW_LABEL_X = 96;
const OVERVIEW_STEPS = 256;

/** 触点浮现的键字。 */
const GHOST_FONT_PX = 30;
const GHOST_ALPHA = 0.35;
/** 类名浮现。 */
const HINT_FONT_PX = 15;
const HINT_ALPHA = 0.3;
const HINT_X = 48;
const HINT_Y = STRING_CENTER_Y - 26;

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

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function rgba(color: Rgb, alpha: number): string {
  const a = clamp(alpha, 0, 1);
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${a})`;
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
      return [
        clamp(parts[0]!, 0, 255),
        clamp(parts[1]!, 0, 255),
        clamp(parts[2]!, 0, 255),
      ];
    }
  }
  return null;
}

declare global {
  interface Window {
    __neurouString?: {
      state: () => {
        kind: StringKind;
        kindIndex: number;
        mode: ViewMode;
        pulling: boolean;
        plucks: number;
        resting: boolean;
        audio: StringAudioState;
        keyCount: number;
        amplitude: number;
        overviewRows: number;
      };
      u: () => number[];
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

  const [kindIndex, setKindIndex] = useState(0);
  const [mode, setMode] = useState<ViewMode>('string');
  const [pulling, setPulling] = useState(false);
  const [plucks, setPlucks] = useState(0);
  const [resting, setResting] = useState(true);
  const [audioState, setAudioState] = useState<StringAudioState>('off');
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

    // 类型收窄后的非空别名：嵌套函数里也能直接用（避免 hoisting 丢失收窄信息）。
    const host = hostElement;
    const canvas = canvasElement;
    const ctx = contextMaybe;
    const trailCanvas = trailElement;
    const trailCtx = trailContextMaybe;

    const audio = getStringAudio();
    const keys = layoutKeyboard();
    const sim = new StringSim();
    const smoothA = new Float32Array(sim.n);
    const smoothB = new Float32Array(sim.n);
    /** 盒式模糊半径（采样点）：按 32 逻辑像素换算，避免 STRING_N 变化时把弦磨得过头。 */
    const smoothRadius = Math.max(1, Math.round(DISPLAY_SMOOTH_PX / (LOGICAL_W / (sim.n - 1))));

    /* —— 可变状态：全部放在 ref 式闭包里，避免每帧 setState —— */
    let kindIdx = 0;
    let modeNow: ViewMode = 'string';
    let pullingNow = false;
    let plucksNow = 0;
    let restingNow = true;
    let dragPointerId: number | null = null;
    /** 本次按下的起点与时间：用来判定「点触」还是「拉弓」。 */
    let dragStartedAt = 0;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragMoved = false;
    let lastTouchNow: TouchPoint | null = null;
    let ghostMarks: GhostMark[] = [];
    let hintMark: HintMark | null = null;

    let scaleX = 1;
    let scaleY = 1;
    let ink: Rgb = FALLBACK_INK;
    let serif = DEFAULT_SERIF;

    let chartAlpha = 0;
    let chartTarget = 0;
    let frozen = false;
    let trailActive = false;
    let trailSettle = 0;
    let lastFrame = 0;
    let requestId = 0;
    /** 显示平滑强度：1=拉弓曲线，0=物理原形（保留行波折点）。 */
    let displayLevel = 0;

    function kindOf(): StringKind {
      return KIND_ORDER[kindIdx] ?? '叙事';
    }

    function profileOf(): KindVisualProfile {
      return KIND_VISUAL[kindOf()];
    }

    /* —— UI 状态镜像（只在真正变化时重渲染） —— */
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

    function noteTouch(touch: TouchPoint): void {
      lastTouchNow = touch;
      setLastKey(touch.key ? touch.key.code : '');
      setLastAmplitude(Math.round(touch.amplitude * 10) / 10);
      setLastDirection(touch.direction < 0 ? 'up' : 'down');
    }

    function pushGhost(text: string, x: number, y: number): void {
      if (!text) return;
      ghostMarks.push({ text, x, y, born: performance.now() });
      if (ghostMarks.length > 4) ghostMarks.splice(0, ghostMarks.length - 4);
      frozen = false;
    }

    function clearMarks(): void {
      ghostMarks = [];
      hintMark = null;
    }

    /* —— 主题色：从 CSS 变量读取（白纸黑墨；反色时自动跟随） —— */
    function readTheme(): void {
      const style = getComputedStyle(host);
      ink = parseCssColor(style.getPropertyValue('--ink')) ?? FALLBACK_INK;
      const serifValue = style.getPropertyValue('--serif').trim();
      serif = serifValue || DEFAULT_SERIF;
    }

    /* —— 画布尺寸：逻辑 1440×900 铺满 viewport（非等比拉伸，横线与屏宽同宽） —— */
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
      frozen = false;
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

    /* —— trailCanvas：先 destination-out 淡出，再低 alpha 重绘当前弦 —— */
    function clearTrail(): void {
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
      trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      trailActive = false;
      trailSettle = 0;
    }

    /** 单次盒式模糊（边缘复制），用于把折线帐篷磨成平滑的弓形。 */
    function boxBlur(source: Float32Array, destination: Float32Array, radius: number): void {
      const count = source.length;
      if (count === 0) return;
      const denominator = radius * 2 + 1;
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const index = Math.min(count - 1, Math.max(0, offset));
        sum += source[index] ?? 0;
      }
      for (let i = 0; i < count; i++) {
        destination[i] = sum / denominator;
        const outgoing = source[Math.min(count - 1, Math.max(0, i - radius))] ?? 0;
        const incoming = source[Math.min(count - 1, Math.max(0, i + radius + 1))] ?? 0;
        sum += incoming - outgoing;
      }
    }

    /** 渲染用位移：物理 u() 做盒式模糊后，按 displayLevel 与原始位移混合。 */
    function displayDisplacement(): Float32Array {
      boxBlur(sim.u(), smoothA, smoothRadius);
      for (let pass = 1; pass < DISPLAY_SMOOTH_PASSES; pass++) {
        if (pass % 2 === 1) boxBlur(smoothA, smoothB, smoothRadius);
        else boxBlur(smoothB, smoothA, smoothRadius);
      }
      smoothA[0] = 0;
      smoothA[smoothA.length - 1] = 0;
      if (displayLevel <= 0.001) return sim.u();
      const level = Math.min(1, displayLevel);
      if (level >= 0.999) return smoothA;
      const raw = sim.u();
      for (let i = 0; i < smoothA.length; i++) {
        smoothA[i] = (smoothA[i] ?? 0) * level + (raw[i] ?? 0) * (1 - level);
      }
      smoothA[0] = 0;
      smoothA[smoothA.length - 1] = 0;
      return smoothA;
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
      const displacement = displayDisplacement();
      const profile = profileOf();
      // 两层残影：先铺一层大模糊的墨晕（运动模糊），再叠一层轻模糊的细线（帧残留）。
      trailCtx.filter = `blur(${TRAIL_BLUR_PX}px)`;
      drawCurve(trailCtx, displacement, profile, TRAIL_ALPHA * 0.62, true, 1);
      trailCtx.filter = `blur(${TRAIL_FRAME_BLUR_PX}px)`;
      drawCurve(trailCtx, displacement, profile, TRAIL_ALPHA * 0.38, true, 1);
      trailCtx.filter = 'none';
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /**
     * 把当前位移画成一条变宽、变深的墨线。
     *
     * 每个采样段按 |u|/maxPull 归入 BAND_COUNT 个档；同档的连续段合并进一个
     * Path2D，一次 stroke 完成。这样既保留“峰更粗、峰更深”的逐点变化，
     * 又把每帧的 stroke 次数压到 10 次上下（60fps 友好）。
     */
    function drawCurve(
      target: CanvasRenderingContext2D,
      displacement: Float32Array,
      profile: KindVisualProfile,
      alphaScale: number,
      withBleed: boolean,
      sharpPasses: number,
    ): void {
      const count = displacement.length;
      if (count < 2) return;
      const stepX = LOGICAL_W / (count - 1);
      const maxPull = Math.max(1, profile.maxPull);
      const paths: Path2D[] = [];
      for (let band = 0; band < BAND_COUNT; band++) paths.push(new Path2D());
      let previousBand = -1;
      for (let i = 0; i < count - 1; i++) {
        const ua = displacement[i] ?? 0;
        const ub = displacement[i + 1] ?? 0;
        const ratio = Math.min(1, (Math.abs(ua) + Math.abs(ub)) * 0.5 / maxPull);
        let band = Math.floor(ratio * BAND_COUNT);
        if (band < 0) band = 0;
        if (band > BAND_COUNT - 1) band = BAND_COUNT - 1;
        const x1 = i * stepX;
        const y1 = STRING_CENTER_Y + ua;
        const x2 = (i + 1) * stepX;
        const y2 = STRING_CENTER_Y + ub;
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

      // 很淡的宽笔洇开（宽 ×3，alpha≈0.06）
      if (withBleed) {
        for (let band = 0; band < BAND_COUNT; band++) {
          const ratio = BAND_COUNT <= 1 ? 1 : band / (BAND_COUNT - 1);
          target.strokeStyle = rgba(ink, 0.06 * alphaScale);
          target.lineWidth = (profile.restWidth + profile.peakWidth * ratio) * 3;
          target.stroke(paths[band]!);
        }
      }

      // 清晰层：静息 alpha 0.55 → 峰部 0.95；线宽 restWidth → restWidth+peakWidth。
      // 落 SHARP_PASSES 笔：让静息线也足够近黑（单笔 0.55 在纸上只是中灰）。
      for (let pass = 0; pass < sharpPasses; pass++) {
        for (let band = 0; band < BAND_COUNT; band++) {
          const ratio = BAND_COUNT <= 1 ? 1 : band / (BAND_COUNT - 1);
          target.strokeStyle = rgba(ink, (0.55 + 0.4 * ratio) * alphaScale);
          target.lineWidth = profile.restWidth + profile.peakWidth * ratio;
          target.stroke(paths[band]!);
        }
      }
    }

    function drawOverlays(now: number): void {
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
          ctx.font = `${HINT_FONT_PX}px ${serif}`;
          ctx.textAlign = 'left';
          ctx.fillStyle = rgba(ink, HINT_ALPHA * (1 - progress));
          ctx.fillText(hintMark.text, HINT_X, HINT_Y);
        }
      }
      ctx.textAlign = 'center';
    }

    function renderString(now: number, withTrail: boolean): void {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (withTrail) ctx.drawImage(trailCanvas, 0, 0);
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      drawCurve(ctx, displayDisplacement(), profileOf(), 1, true, SHARP_PASSES);
      drawOverlays(now);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function drawOverviewScene(): void {
      const alpha = chartAlpha;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      if (alpha <= 0) return;
      const rowGap = (OVERVIEW_BOTTOM - OVERVIEW_TOP) / (KIND_ORDER.length - 1);
      for (let i = 0; i < KIND_ORDER.length; i++) {
        const kind = KIND_ORDER[i]!;
        const profile = KIND_VISUAL[kind];
        const rowY = OVERVIEW_TOP + rowGap * i;
        const active = i === kindIdx;

        ctx.font = `14px ${serif}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = rgba(ink, 0.32 * alpha);
        ctx.fillText(profile.label, OVERVIEW_LABEL_X, rowY);

        ctx.beginPath();
        for (let s = 0; s <= OVERVIEW_STEPS; s++) {
          const t = s / OVERVIEW_STEPS;
          const x = OVERVIEW_LEFT + (OVERVIEW_RIGHT - OVERVIEW_LEFT) * t;
          const y = rowY + signature(kind, t) * OVERVIEW_WAVE_PX;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = rgba(ink, (active ? 0.85 : 0.12) * alpha);
        ctx.lineWidth = active ? 2.2 : 1;
        ctx.stroke();
      }
      ctx.textAlign = 'center';
    }

    function pruneMarks(now: number): void {
      if (ghostMarks.length > 0) {
        const kept: GhostMark[] = [];
        for (const mark of ghostMarks) if (now - mark.born < GHOST_FADE_MS) kept.push(mark);
        ghostMarks = kept;
      }
      if (hintMark && now - hintMark.born >= HINT_FADE_MS) hintMark = null;
    }

    /* —— 交互 —— */

    function audioBegin(touch: TouchPoint): void {
      void audio.ensureStarted();
      const profile = profileOf();
      audio.pluck(
        kindOf(),
        touch.x / LOGICAL_W,
        touch.y / LOGICAL_H,
        clamp(touch.amplitude / Math.max(1, profile.maxPull), 0, 1),
      );
    }

    function enterOverview(): void {
      if (modeNow === 'overview') return;
      setModeUi('overview');
      chartTarget = 1;
      sim.reset();
      clearTrail();
      dragPointerId = null;
      setPullingUi(false);
      clearMarks();
      audio.reset();
      setRestingUi(true);
      frozen = false;
    }

    function leaveOverview(): void {
      if (modeNow !== 'overview') return;
      setModeUi('string');
      chartTarget = 0;
      frozen = false;
    }

    function toggleOverview(): void {
      if (modeNow === 'overview') leaveOverview();
      else enterOverview();
    }

    /** Tab / Shift+Tab：切换 8 类弦；单弦视图下自动在弦心演示一次 pluck。 */
    function switchKind(step: number, demonstrate: boolean): void {
      const next = nextKind(kindOf(), step);
      const nextIndex = KIND_ORDER.indexOf(next);
      kindIdx = nextIndex < 0 ? 0 : nextIndex;
      setKindIndex(kindIdx);
      const profile = KIND_VISUAL[next];
      if (modeNow === 'string') {
        hintMark = { text: `${profile.label}弦`, born: performance.now() };
      }
      if (demonstrate) {
        sim.reset();
        const touch = touchFromPoint(keys, LOGICAL_W / 2, STRING_CENTER_Y + profile.maxPull * 0.5);
        sim.pluck(touch, profile);
        bumpPlucks();
        audioBegin(touch);
        trailSettle = 0;
        setRestingUi(false);
      }
      frozen = false;
    }

    function handleTab(backwards: boolean): void {
      const step = backwards ? -1 : 1;
      if (modeNow === 'overview') switchKind(step, false);
      else switchKind(step, true);
    }

    /** 总览里点某一行：选中该类、回到单弦、拨一次。 */
    function selectOverviewRow(logicalY: number): void {
      const rowGap = (OVERVIEW_BOTTOM - OVERVIEW_TOP) / (KIND_ORDER.length - 1);
      const row = clamp(Math.round((logicalY - OVERVIEW_TOP) / rowGap), 0, KIND_ORDER.length - 1);
      const kind = KIND_ORDER[row]!;
      kindIdx = row;
      setKindIndex(row);
      const profile = KIND_VISUAL[kind];
      setModeUi('string');
      chartTarget = 0;
      sim.reset();
      clearTrail();
      const touch = touchFromPoint(keys, LOGICAL_W / 2, STRING_CENTER_Y + profile.maxPull * 0.5);
      sim.pluck(touch, profile);
      noteTouch(touch);
      bumpPlucks();
      audioBegin(touch);
      hintMark = { text: `${profile.label}弦`, born: performance.now() };
      trailSettle = 0;
      setRestingUi(false);
      frozen = false;
    }

    /** 一次“拨动”：键盘、调试 pressKey 共用；直接走 StringSim.pluck。 */
    function triggerKey(code: string, label: string): void {
      if (code === 'Tab') {
        handleTab(false);
        return;
      }
      if (code === 'Escape') {
        toggleOverview();
        return;
      }
      if (modeNow === 'overview') return;
      const key = keyByCode(keys, code);
      if (!key) return;
      const touch = touchFromKey(key);
      sim.pluck(touch, profileOf());
      noteTouch(touch);
      pushGhost(label || key.label, touch.x, touch.y);
      bumpPlucks();
      audioBegin(touch);
      trailSettle = 0;
      setRestingUi(false);
    }

    function pluckAtPoint(x: number, y: number): void {
      if (modeNow === 'overview' || chartAlpha > 0) {
        setModeUi('string');
        chartTarget = 0;
        chartAlpha = 0;
      }
      const touch = touchFromPoint(keys, x, y);
      sim.pluck(touch, profileOf());
      noteTouch(touch);
      bumpPlucks();
      trailSettle = 0;
      setRestingUi(false);
      frozen = false;
    }

    function resetField(): void {
      sim.reset();
      audio.reset();
      clearTrail();
      dragPointerId = null;
      setPullingUi(false);
      displayLevel = 0;
      clearMarks();
      // 回到最初的状态：叙事弦、单弦视图、无波、计数归零。
      kindIdx = 0;
      setKindIndex(0);
      chartAlpha = 0;
      chartTarget = 0;
      setModeUi('string');
      plucksNow = 0;
      setPlucks(0);
      lastTouchNow = null;
      setLastKey('');
      setLastAmplitude(0);
      setLastDirection('down');
      setRestingUi(true);
      frozen = false;
      lastFrame = 0;
    }

    function onPointerDown(event: PointerEvent): void {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (dragPointerId !== null) return;
      const point = pointToLogical(event.clientX, event.clientY);
      if (modeNow === 'overview') {
        selectOverviewRow(point.y);
        return;
      }
      event.preventDefault();
      dragPointerId = event.pointerId;
      dragStartedAt = performance.now();
      dragStartX = point.x;
      dragStartY = point.y;
      dragMoved = false;
      displayLevel = 1;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* 某些环境不支持指针捕获：window 上的 move/up 仍能收到 */
      }
      const touch = touchFromPoint(keys, point.x, point.y);
      sim.pull(touch, profileOf());
      clearTrail();
      setPullingUi(true);
      noteTouch(touch);
      pushGhost(touch.key ? touch.key.label : '', touch.x, touch.y);
      audioBegin(touch);
      setRestingUi(false);
      frozen = false;
    }

    function onPointerMove(event: PointerEvent): void {
      if (dragPointerId === null || event.pointerId !== dragPointerId) return;
      const point = pointToLogical(event.clientX, event.clientY);
      const dx = point.x - dragStartX;
      const dy = point.y - dragStartY;
      if (dx * dx + dy * dy > QUICK_TAP_MOVE_PX * QUICK_TAP_MOVE_PX) dragMoved = true;
      const touch = touchFromPoint(keys, point.x, point.y);
      sim.pull(touch, profileOf());
      noteTouch(touch);
      frozen = false;
    }

    function onPointerUp(event: PointerEvent): void {
      if (dragPointerId === null || event.pointerId !== dragPointerId) return;
      // 点触（<260ms 且几乎没动）= 纯局部拨动；拖动/长按 = 拉弓释放整弦弓形。
      const quickTap = event.type === 'pointerup' && !dragMoved && performance.now() - dragStartedAt < QUICK_TAP_MS;
      dragPointerId = null;
      dragMoved = false;
      try {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      const point = pointToLogical(event.clientX, event.clientY);
      const touch = touchFromPoint(keys, point.x, point.y);
      const profile = profileOf();
      if (quickTap) {
        // 丢掉这一下按出来的整弦弓形，只留一次干净的局部拨动（弦心泛起向两端传播的行波）。
        // 不把弓形写进 trailCanvas：点触的观感必须是纯局部涟漪，不能留下弓形的残影。
        clearTrail();
        sim.reset();
        displayLevel = 0;
        sim.pluck(
          {
            x: touch.x,
            y: touch.y,
            amplitude: touch.amplitude * QUICK_TAP_PLUCK_RATIO,
            direction: touch.direction,
            key: touch.key,
          },
          profile,
        );
      } else {
        sim.pull(touch, profile);
      }
      noteTouch(touch);
      setPullingUi(false);
      bumpPlucks();
      trailSettle = 0;
      setRestingUi(false);
      frozen = false;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Tab') {
        event.preventDefault();
        handleTab(event.shiftKey);
        return;
      }
      if (event.code === 'Escape') {
        event.preventDefault();
        toggleOverview();
        return;
      }
      if (modeNow === 'overview') return;
      const key = keyByCode(keys, event.code);
      if (!key) return;
      event.preventDefault();
      const label = event.key.length === 1 ? event.key : key.label;
      triggerKey(event.code, label);
    }

    /* —— 每帧 —— */

    function frame(now: number): void {
      requestId = window.requestAnimationFrame(frame);
      const dt = lastFrame > 0 ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
      lastFrame = now;

      if (chartAlpha !== chartTarget) {
        const step = (dt * 1000) / OVERVIEW_FADE_MS;
        chartAlpha =
          chartTarget > chartAlpha
            ? Math.min(chartTarget, chartAlpha + step)
            : Math.max(chartTarget, chartAlpha - step);
        frozen = false;
      }

      pruneMarks(now);

      // 显示平滑强度：拉弦 → 1（弓形），释放后指数回落到 0（保留行波折点）。
      const smoothingTarget = pullingNow ? 1 : 0;
      if (displayLevel !== smoothingTarget) {
        displayLevel += (smoothingTarget - displayLevel) * (1 - Math.exp(-dt / DISPLAY_SMOOTH_TAU));
        if (Math.abs(displayLevel - smoothingTarget) < 0.002) displayLevel = smoothingTarget;
        frozen = false;
      }

      if (modeNow === 'overview' || chartAlpha > 0) {
        if (chartAlpha === chartTarget && frozen) return;
        drawOverviewScene();
        frozen = chartAlpha === chartTarget;
        return;
      }

      if (pullingNow) {
        renderString(now, false);
        frozen = false;
        return;
      }

      const profile = profileOf();
      if (!sim.resting()) {
        sim.step(dt, profile);
        updateTrail();
        trailActive = true;
        trailSettle = 0;
        renderString(now, true);
        setRestingUi(false);
        frozen = false;
        return;
      }

      if (trailActive) {
        updateTrail();
        trailSettle += dt;
        renderString(now, true);
        frozen = false;
        if (trailSettle >= TRAIL_SETTLE_SECONDS) {
          clearTrail();
          setRestingUi(true);
        }
        return;
      }

      setRestingUi(true);
      const hasOverlay = ghostMarks.length > 0 || hintMark !== null;
      if (hasOverlay) {
        renderString(now, false);
        frozen = false;
        return;
      }
      if (!frozen) {
        renderString(now, false);
        frozen = true;
      }
    }

    /* —— 安装：主题、尺寸、初始一帧、事件、调试钩子 —— */
    readTheme();
    resize();
    renderString(performance.now(), false);
    frozen = true;

    const debugApi: NonNullable<Window['__neurouString']> = {
      state: () => ({
        kind: kindOf(),
        kindIndex: kindIdx,
        mode: modeNow,
        pulling: pullingNow,
        plucks: plucksNow,
        resting: restingNow,
        audio: audio.getState(),
        keyCount: KEY_COUNT,
        amplitude: sim.amplitude(),
        overviewRows: modeNow === 'overview' ? KIND_ORDER.length : 0,
      }),
      u: () => Array.from(sim.u()),
      lastTouch: () =>
        lastTouchNow
          ? {
              x: lastTouchNow.x,
              y: lastTouchNow.y,
              amplitude: lastTouchNow.amplitude,
              direction: lastTouchNow.direction,
              keyCode: lastTouchNow.key ? lastTouchNow.key.code : '',
            }
          : null,
      pluckAt: (x: number, y: number) => {
        pluckAtPoint(
          clamp(Number.isFinite(x) ? x : LOGICAL_W / 2, 0, LOGICAL_W),
          clamp(Number.isFinite(y) ? y : STRING_CENTER_Y, 0, LOGICAL_H),
        );
      },
      pressKey: (code: string) => {
        triggerKey(code, '');
      },
      reset: () => resetField(),
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
      unsubscribeAudio();
      audio.reset();
      if (window.__neurouString === debugApi) delete window.__neurouString;
    };
  }, []);

  const kind = KIND_ORDER[kindIndex] ?? '叙事';

  return (
    <div
      ref={hostRef}
      className="string-field"
      data-testid="string-field"
      data-mode={mode}
      data-kind={kind}
      data-kind-index={kindIndex}
      data-plucks={plucks}
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
