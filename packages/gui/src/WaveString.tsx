/**
 * 基准弦：贯穿屏幕的横向墨弦（调律台的参考弦 / 单弦琴）。
 *
 * - 点击弦上任意位置：该处被拉向点击位置，多次点击用 PCHIP 拟合出一条丝滑曲线；
 * - 同时拨弦发声（音高随 x 的五声音阶、明暗随 y），曲线形状持续驱动一个极轻的 drone；
 * - 每次点击沿弦注入一个衰减小波包，无交互时也有 ≤1.2px 的极慢呼吸；
 * - Escape 清空控制点，弦回到直线，drone 淡出并 suspend。
 *
 * 自包含覆盖层：只有弦的热区 path 接收指针事件，其余全部 pointer-events: none，
 * 颜色走 var(--ink)/var(--paper)，随 .ink-app.is-inverted 自动反色。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  WAVE_BASE_Y,
  WAVE_HEIGHT,
  WAVE_WIDTH,
  WAVE_X_MAX,
  WAVE_X_MIN,
  WAVE_Y_MAX,
  WAVE_Y_MIN,
  breathOffsetAt,
  clampY,
  curveDisplacements,
  curveYAt,
  fitCurve,
  insertPoint,
  pluckOffsetAt,
  samplesToPath,
  type CurveSample,
  type PluckPacket,
  type WavePoint,
} from './waveMath.js';
import { getWaveAudio, type WaveAudioEngine, type WaveAudioState } from './waveAudio.js';
import './wave-string.css';

declare global {
  interface Window {
    __neurouWave?: {
      plucks: number;
      points: number;
      audioState: WaveAudioState;
      rms: () => number;
      reset: () => void;
    };
  }
}

/** 曲线评估采样数（要求 240+）。 */
const SAMPLE_COUNT = 300;
/** 控制点弹性逼近的时间常数（秒），约 120–200ms 到位。 */
const SPRING_TAU = 0.045;
/** 25s 无交互后 drone 淡出。 */
const IDLE_MS = 25_000;
/** 点击/拖动结束后延迟多久再更新 drone 音色。 */
const DRONE_DEBOUNCE_MS = 250;
/** 同时存在的波包上限。 */
const MAX_PLUCKS = 8;
/**
 * 可点击塑形带：从 y=724 到屏幕底部的整条横向带。
 * 724 在「压力」弦的热区（≈683–717）之下，不会抢掉既有拖动交互；
 * 墨晕也只会在带外出现。
 */
const STRIP_TOP = 724;
const STRIP_HEIGHT = WAVE_HEIGHT - STRIP_TOP;

interface VisualPoint {
  x: number;
  targetY: number;
  y: number;
}

interface DragState {
  pointerId: number;
  pointX: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 变宽墨线：沿曲线采样算切线法向，按局部纵向位移给 1.5–3.4px 的粗细，
 * 生成一条填充的 ribbon path。
 */
function ribbonPathOf(samples: readonly CurveSample[]): string {
  const count = samples.length;
  if (count < 2) return '';
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < count; i++) {
    const point = samples[i]!;
    const prev = samples[Math.max(0, i - 1)]!;
    const next = samples[Math.min(count - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const displacement = Math.abs(point.y - WAVE_BASE_Y);
    // 静息 2.3px；局部形变越大越粗，最大 4px（中部厚、两端渐细）。
    const width = 2.3 + Math.min(1.7, displacement * 0.018);
    top.push(`${round2(point.x + nx * width * 0.5)} ${round2(point.y + ny * width * 0.5)}`);
    bottom.push(`${round2(point.x - nx * width * 0.5)} ${round2(point.y - ny * width * 0.5)}`);
  }
  return `M ${top.join(' L ')} L ${bottom.reverse().join(' L ')} Z`;
}

export function WaveString(): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lineRef = useRef<SVGPathElement | null>(null);
  const bleedRef = useRef<SVGPathElement | null>(null);
  const flowRef = useRef<SVGPathElement | null>(null);
  const hitRef = useRef<SVGPathElement | null>(null);
  const dotsRef = useRef<SVGGElement | null>(null);

  const targetsRef = useRef<WavePoint[]>([]);
  const visualsRef = useRef<VisualPoint[]>([]);
  const plucksRef = useRef<PluckPacket[]>([]);
  const pluckCountRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const pendingDragRef = useRef<{ pointX: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const droneTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const reducedRef = useRef(false);
  const audioRef = useRef<WaveAudioEngine>(getWaveAudio());
  const resetRef = useRef<() => void>(() => {});

  const [points, setPoints] = useState(0);
  const [plucks, setPlucks] = useState(0);
  const [audioState, setAudioState] = useState<WaveAudioState>(() => audioRef.current.getState());

  useEffect(() => {
    const audio = audioRef.current;
    const sync = (state: WaveAudioState) => setAudioState(state);
    const unsubscribe = audio.subscribe(sync);
    sync(audio.getState());
    return unsubscribe;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const hook = {
      get plucks(): number {
        return pluckCountRef.current;
      },
      get points(): number {
        return targetsRef.current.length;
      },
      get audioState(): WaveAudioState {
        return audio.getState();
      },
      rms: () => audio.rms(),
      reset: () => resetRef.current(),
    };
    window.__neurouWave = hook;
    return () => {
      if (window.__neurouWave === hook) delete window.__neurouWave;
    };
  }, []);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyMotion = () => {
      reducedRef.current = motion.matches;
    };
    applyMotion();
    motion.addEventListener('change', applyMotion);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetRef.current();
    };
    const onAnyPointerDown = () => {
      touchIdle();
      audioRef.current.wake();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onAnyPointerDown, { passive: true });

    lastFrameRef.current = performance.now();
    const frame = (now: number) => {
      rafRef.current = window.requestAnimationFrame(frame);
      renderFrame(now);
    };
    rafRef.current = window.requestAnimationFrame(frame);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onAnyPointerDown);
      motion.removeEventListener('change', applyMotion);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (droneTimerRef.current !== null) {
        window.clearTimeout(droneTimerRef.current);
        droneTimerRef.current = null;
      }
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, []);

  /* ---------------------------------------------------------------- *
   * 每帧渲染
   * ---------------------------------------------------------------- */

  function renderFrame(now: number): void {
    const dt = clampRange((now - lastFrameRef.current) / 1000, 0.001, 0.06);
    lastFrameRef.current = now;
    const reduced = reducedRef.current;
    const visuals = visualsRef.current;
    const targets = targetsRef.current;

    // 拖动只改 y（16ms 节流的落地端：每帧最多应用一次）。
    const pending = pendingDragRef.current;
    if (pending) {
      pendingDragRef.current = null;
      const target = targets.find((p) => Math.abs(p.x - pending.pointX) < 0.5);
      if (target) {
        target.y = clampY(pending.y);
        const visual = visuals.find((v) => Math.abs(v.x - pending.pointX) < 0.5);
        if (visual) visual.targetY = target.y;
      }
    }

    // 临界阻尼的指数等价：120–200ms 内收敛，不抖。
    for (const visual of visuals) {
      if (reduced) {
        visual.y = visual.targetY;
        continue;
      }
      visual.y += (visual.targetY - visual.y) * (1 - Math.exp(-dt / SPRING_TAU));
      if (Math.abs(visual.targetY - visual.y) < 0.02) visual.y = visual.targetY;
    }

    // Escape 后目标点已清空：视觉点回落到基准线后移除。
    if (
      targets.length === 0 &&
      visuals.length > 0 &&
      visuals.every((visual) => Math.abs(visual.y - WAVE_BASE_Y) < 0.05)
    ) {
      visuals.length = 0;
    }

    // 波包老化。
    if (plucksRef.current.length > 0) {
      plucksRef.current = plucksRef.current.filter((packet) => now - packet.at < 1100);
    }

    const controlPoints: WavePoint[] = visuals.map((visual) => ({ x: visual.x, y: visual.y }));
    const samples = fitCurve(controlPoints, SAMPLE_COUNT, WAVE_BASE_Y);
    const decorated: CurveSample[] = new Array(samples.length);
    let peakDisplacement = 0;
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]!;
      let displacement = sample.y - WAVE_BASE_Y;
      if (!reduced) {
        displacement +=
          pluckOffsetAt(plucksRef.current, sample.x, now) + breathOffsetAt(now, sample.x);
      }
      decorated[i] = { x: sample.x, y: WAVE_BASE_Y + displacement };
      const magnitude = Math.abs(displacement);
      if (magnitude > peakDisplacement) peakDisplacement = magnitude;
    }

    const centerPath = samplesToPath(decorated);
    const line = lineRef.current;
    if (line) {
      line.setAttribute('d', ribbonPathOf(decorated));
      // 静息 0.72；有形变时最多加深到 0.9（远看要压得住）。
      // 用 inline style 而不是 presentation attribute：CSS 里的初始值会覆盖 attribute。
      const opacity = 0.72 + 0.18 * Math.min(1, peakDisplacement / 48);
      line.style.fillOpacity = opacity.toFixed(3);
    }
    if (bleedRef.current) bleedRef.current.setAttribute('d', centerPath);
    if (flowRef.current) flowRef.current.setAttribute('d', centerPath);
    if (hitRef.current) hitRef.current.setAttribute('d', centerPath);

    updateDots(visuals);
  }

  function updateDots(visuals: readonly VisualPoint[]): void {
    const group = dotsRef.current;
    if (!group) return;
    const visible = targetsRef.current.length > 0 ? visuals.length : 0;
    while (group.childElementCount > visible) group.lastElementChild?.remove();
    while (group.childElementCount < visible) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'ink-wave-dot');
      dot.setAttribute('r', '1.1');
      group.appendChild(dot);
    }
    for (let i = 0; i < visible; i++) {
      const dot = group.children[i] as SVGCircleElement | undefined;
      const visual = visuals[i];
      if (!dot || !visual) continue;
      dot.setAttribute('cx', String(round2(visual.x)));
      dot.setAttribute('cy', String(round2(visual.y)));
    }
  }

  /* ---------------------------------------------------------------- *
   * 交互
   * ---------------------------------------------------------------- */

  function viewPoint(event: ReactPointerEvent<SVGElement>): WavePoint {
    const svg = svgRef.current;
    if (!svg) return { x: WAVE_WIDTH / 2, y: WAVE_BASE_Y };
    const rect = svg.getBoundingClientRect();
    const x = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * WAVE_WIDTH : WAVE_WIDTH / 2;
    const y =
      rect.height > 0 ? ((event.clientY - rect.top) / rect.height) * WAVE_HEIGHT : WAVE_BASE_Y;
    return { x, y };
  }

  /** 与点击位置最近的控制点（insertPoint 合并/插入后的那个）。 */
  function pickedPoint(targets: readonly WavePoint[], x: number): WavePoint | null {
    let best: WavePoint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const point of targets) {
      const distance = Math.abs(point.x - x);
      if (distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** 逻辑控制点变了 → 同步视觉点（新点从当前曲线高度开始，不做跳变）。 */
  function syncVisuals(targets: readonly WavePoint[], previousPoints: readonly WavePoint[]): void {
    const previous = new Map<number, VisualPoint>();
    for (const visual of visualsRef.current) previous.set(visual.x, visual);
    const nextVisuals: VisualPoint[] = [];
    for (const target of targets) {
      const existing = previous.get(target.x);
      if (existing) {
        existing.targetY = target.y;
        nextVisuals.push(existing);
        continue;
      }
      const startY = reducedRef.current
        ? target.y
        : curveYAt(previousPoints, target.x, WAVE_BASE_Y);
      nextVisuals.push({ x: target.x, y: startY, targetY: target.y });
    }
    visualsRef.current = nextVisuals;
  }

  function spawnPluck(x: number, y: number): void {
    const clampedX = clampRange(x, WAVE_X_MIN, WAVE_X_MAX);
    const clampedY = clampRange(y, WAVE_Y_MIN, WAVE_Y_MAX);
    const packet: PluckPacket = {
      x: clampedX,
      at: performance.now(),
      amplitude: 10 + Math.random() * 5,
      sign: clampedY >= WAVE_BASE_Y ? 1 : -1,
    };
    plucksRef.current = [...plucksRef.current, packet].slice(-MAX_PLUCKS);
    pluckCountRef.current += 1;
    setPlucks(pluckCountRef.current);
  }

  function touchIdle(): void {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      audioRef.current.idle();
    }, IDLE_MS);
  }

  function scheduleDroneUpdate(): void {
    if (droneTimerRef.current !== null) window.clearTimeout(droneTimerRef.current);
    droneTimerRef.current = window.setTimeout(() => {
      droneTimerRef.current = null;
      audioRef.current.updateCurve(curveDisplacements(targetsRef.current, 256, WAVE_BASE_Y));
    }, DRONE_DEBOUNCE_MS);
  }

  function resetScene(): void {
    targetsRef.current = [];
    for (const visual of visualsRef.current) visual.targetY = WAVE_BASE_Y;
    pendingDragRef.current = null;
    dragRef.current = null;
    plucksRef.current = [];
    if (droneTimerRef.current !== null) {
      window.clearTimeout(droneTimerRef.current);
      droneTimerRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setPoints(0);
    audioRef.current.reset();
  }
  resetRef.current = resetScene;

  function handlePointerDown(event: ReactPointerEvent<SVGElement>): void {
    event.stopPropagation();
    event.preventDefault();
    const view = viewPoint(event);
    const previousPoints: WavePoint[] = visualsRef.current.map((visual) => ({
      x: visual.x,
      y: visual.y,
    }));
    const nextTargets = insertPoint(targetsRef.current, view.x, view.y);
    targetsRef.current = nextTargets;
    syncVisuals(nextTargets, previousPoints);
    setPoints(nextTargets.length);

    const clampedX = clampRange(view.x, WAVE_X_MIN, WAVE_X_MAX);
    const picked = pickedPoint(nextTargets, clampedX);
    dragRef.current = { pointerId: event.pointerId, pointX: picked ? picked.x : clampedX };
    pendingDragRef.current = null;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* input capture 不可用时仍可点击 */
    }

    // 第一次 pointerdown 才建 AudioContext；随后拨弦。
    audioRef.current.ensureStarted().catch(() => {});
    audioRef.current.pluck(view.x, view.y);
    spawnPluck(view.x, view.y);
    touchIdle();
    scheduleDroneUpdate();
  }

  function handlePointerMove(event: ReactPointerEvent<SVGElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pendingDragRef.current = { pointX: drag.pointX, y: viewPoint(event).y };
  }

  function finishDrag(event: ReactPointerEvent<SVGElement>): void {
    if (!dragRef.current) return;
    dragRef.current = null;
    pendingDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    touchIdle();
    scheduleDroneUpdate();
  }

  return (
    <svg
      ref={svgRef}
      className="ink-wave"
      data-testid="ink-wave"
      data-wave-points={points}
      data-wave-plucks={plucks}
      data-wave-audio={audioState}
      viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path ref={bleedRef} className="ink-wave-bleed" />
      <path ref={flowRef} className="ink-wave-flow" />
      <path ref={lineRef} className="ink-wave-line" />
      <g ref={dotsRef} className="ink-wave-dots" />
      <text className="ink-wave-name" x={24} y={WAVE_BASE_Y - 18}>
        基准弦
      </text>
      {/* 整条底带都可点击塑形：y=724..900，不会盖住上方「压力」弦的热区。 */}
      <rect
        className="ink-wave-strip"
        data-wave-strip="true"
        x={0}
        y={STRIP_TOP}
        width={WAVE_WIDTH}
        height={STRIP_HEIGHT}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
      {/* 曲线本身的细热区（strip 已经覆盖它，保留是为了契约与悬停手感一致）。 */}
      <path
        ref={hitRef}
        className="ink-wave-hit"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      />
    </svg>
  );
}
