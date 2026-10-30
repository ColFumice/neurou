import { useEffect, useRef, useState } from 'react';

const COLS = 64;
const ROWS = 36;
const LEVELS = 9;
const STORAGE_PREFIX = 'neurou.flow:';
const RADIUS = 2.1;

interface FlowFieldProps {
  worldFile: string;
  onClose: () => void;
}

function initialField(): Float32Array {
  const values = new Float32Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const nx = x / COLS;
      const ny = y / ROWS;
      const a = Math.sin(nx * 12.0 + Math.cos(ny * 7.0) * 2.1);
      const b = Math.cos(ny * 9.0 + Math.sin(nx * 5.5) * 1.8);
      const c = Math.sin((nx + ny) * 8.0) * 0.4;
      values[y * COLS + x] = 0.5 + (a * 0.34 + b * 0.24 + c * 0.18) * 0.5;
    }
  }
  return values;
}

function loadField(key: string): Float32Array {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return initialField();
    const parsed = JSON.parse(raw) as { values?: unknown };
    if (!Array.isArray(parsed.values) || parsed.values.length !== COLS * ROWS) return initialField();
    const values = Float32Array.from(parsed.values.map((value) => Number(value)));
    if (values.some((value) => !Number.isFinite(value))) return initialField();
    return values;
  } catch {
    return initialField();
  }
}

function saveField(key: string, field: Float32Array): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify({ values: Array.from(field) }));
  } catch {
    /* 本地存储不可用时保持内存态 */
  }
}

/** 等值线流场：可绘制的 2D 控制场 + 动态等值线渲染。 */
export function FlowField({ worldFile, onClose }: FlowFieldProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldRef = useRef<Float32Array>(loadField(worldFile));
  const cursorRef = useRef({ x: COLS / 2, y: ROWS / 2 });
  const audioRef = useRef<AudioContext | null>(null);
  const [version, setVersion] = useState(0);

  const playSound = (x: number, y: number): void => {
    try {
      const context = audioRef.current ?? new AudioContext();
      audioRef.current = context;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 160 + ((1 - y / ROWS) * 520 + (x / COLS) * 120);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.028, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.6);
    } catch {
      /* 无音频上下文时仍可绘制 */
    }
  };

  const paint = (x: number, y: number): void => {
    const field = fieldRef.current;
    const radius = RADIUS;
    const cx = Math.round(x);
    const cy = Math.round(y);
    const reach = Math.ceil(radius);
    for (let gy = Math.max(0, cy - reach); gy <= Math.min(ROWS - 1, cy + reach); gy += 1) {
      for (let gx = Math.max(0, cx - reach); gx <= Math.min(COLS - 1, cx + reach); gx += 1) {
        const dx = gx - x;
        const dy = gy - y;
        const weight = Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
        field[gy * COLS + gx] = Math.max(0, Math.min(1, (field[gy * COLS + gx] ?? 0.5) + 0.19 * weight));
      }
    }
    saveField(worldFile, field);
    setVersion((value) => value + 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Escape' || event.code === 'F10') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.code === 'KeyR') {
        event.preventDefault();
        fieldRef.current = initialField();
        saveField(worldFile, fieldRef.current);
        setVersion((value) => value + 1);
        return;
      }
      if (event.code === 'KeyS') {
        event.preventDefault();
        saveField(worldFile, fieldRef.current);
        return;
      }
      if (event.code === 'KeyX') {
        return;
      }
      const rows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
      const char = event.key.length === 1 ? event.key.toLowerCase() : '';
      const rowIndex = rows.findIndex((row) => row.includes(char));
      if (rowIndex >= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const colIndex = rows[rowIndex]!.indexOf(char);
        const x = ((colIndex + 0.5) / rows[rowIndex]!.length) * COLS;
        const y = ((rowIndex + 0.5) / rows.length) * ROWS;
        cursorRef.current = { x, y };
        paint(x, y);
        playSound(x, y);
        return;
      }
      const step = event.shiftKey ? 4 : 1;
      const cursor = cursorRef.current;
      if (event.code === 'ArrowLeft') cursor.x = Math.max(0, cursor.x - step);
      else if (event.code === 'ArrowRight') cursor.x = Math.min(COLS - 1, cursor.x + step);
      else if (event.code === 'ArrowUp') cursor.y = Math.max(0, cursor.y - step);
      else if (event.code === 'ArrowDown') cursor.y = Math.min(ROWS - 1, cursor.y + step);
      else if (event.code === 'Space' || event.code === 'Enter') {
        paint(cursor.x, cursor.y);
        playSound(cursor.x, cursor.y);
      } else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [worldFile, onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const resize = (): void => {
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    const sample = (field: Float32Array, gx: number, gy: number): number => {
      const x = Math.max(0, Math.min(COLS - 1, gx));
      const y = Math.max(0, Math.min(ROWS - 1, gy));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(COLS - 1, x0 + 1);
      const y1 = Math.min(ROWS - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;
      const a = field[y0 * COLS + x0] ?? 0.5;
      const b = field[y0 * COLS + x1] ?? 0.5;
      const c = field[y1 * COLS + x0] ?? 0.5;
      const d = field[y1 * COLS + x1] ?? 0.5;
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    };

    const draw = (now: number): void => {
      raf = window.requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#05060c');
      bg.addColorStop(1, '#080512');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = width / dpr;
      const h = height / dpr;
      const cellW = w / COLS;
      const cellH = h / ROWS;
      const t = now * 0.00016;
      const field = fieldRef.current;

      for (let level = 0; level < LEVELS; level += 1) {
        const value = 0.08 + (level / (LEVELS - 1)) * 0.84;        const hue = 180 + level * 18;
        ctx.strokeStyle = `hsla(${hue}, 92%, ${60 + (level % 3) * 6}%, ${0.72 - level * 0.03})`;
        ctx.lineWidth = 2 + 1.35 * (0.5 + 0.5 * Math.sin(t * 2.4 + level * 1.1));
        ctx.shadowBlur = 13;
        ctx.shadowColor = `hsla(${hue}, 95%, 65%, 0.62)`;
        ctx.beginPath();
        const warp = (gx: number, gy: number): number =>
          sample(
            field,
            gx + Math.sin(gy * 0.24 + t * 1.16 + level) * 3.4,
            gy + Math.cos(gx * 0.2 - t * 0.94 + level) * 2.8,
          );
        for (let gy = 0; gy < ROWS - 1; gy += 1) {
          for (let gx = 0; gx < COLS - 1; gx += 1) {
            const ax = warp(gx, gy);
            const bx = warp(gx + 1, gy);
            const cx = warp(gx + 1, gy + 1);
            const dx = warp(gx, gy + 1);
            const cross = (
              x1: number,
              y1: number,
              v1: number,
              x2: number,
              y2: number,
              v2: number,
            ): { x: number; y: number } | null => {
              if ((v1 > value) === (v2 > value)) return null;
              const ratio = (value - v1) / (v2 - v1 || 1);
              return { x: x1 + (x2 - x1) * ratio, y: y1 + (y2 - y1) * ratio };
            };
            const edges = {
              top: cross(gx, gy, ax, gx + 1, gy, bx),
              right: cross(gx + 1, gy, bx, gx + 1, gy + 1, cx),
              bottom: cross(gx + 1, gy + 1, cx, gx, gy + 1, dx),
              left: cross(gx, gy + 1, dx, gx, gy, ax),
            };
            const idx =
              (ax > value ? 1 : 0) | (bx > value ? 2 : 0) | (cx > value ? 4 : 0) | (dx > value ? 8 : 0);
            const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
            const add = (p: { x: number; y: number } | null, q: { x: number; y: number } | null): void => {
              if (p && q) segments.push([p, q]);
            };
            if (idx === 1 || idx === 14) add(edges.left, edges.top);
            else if (idx === 2 || idx === 13) add(edges.top, edges.right);
            else if (idx === 3 || idx === 12) add(edges.left, edges.right);
            else if (idx === 4 || idx === 11) add(edges.right, edges.bottom);
            else if (idx === 6 || idx === 9) add(edges.top, edges.bottom);
            else if (idx === 7 || idx === 8) add(edges.left, edges.bottom);
            else if (idx === 5) {
              add(edges.left, edges.top);
              add(edges.right, edges.bottom);
            } else if (idx === 10) {
              add(edges.top, edges.right);
              add(edges.bottom, edges.left);
            }
            for (const [p, q] of segments) {
              const x1 = p.x * cellW;
              const y1 = p.y * cellH;
              const x2 = q.x * cellW;
              const y2 = q.y * cellH;
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              const nx = -(y2 - y1);
              const ny = x2 - x1;
              const length = Math.hypot(nx, ny) || 1;
              const bend = Math.min(cellW, cellH) * 0.22 * Math.sin(t * 1.8 + gx * 0.11 + gy * 0.07);
              ctx.moveTo(x1, y1);
              ctx.quadraticCurveTo(mx + (nx / length) * bend, my + (ny / length) * bend, x2, y2);
            }
          }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    };
    raf = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const pointerToCell = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * COLS,
      y: ((event.clientY - rect.top) / rect.height) * ROWS,
    };
  };

  return (
    <div className="flow-screen" data-testid="flow-screen" data-flow-version={version}>
      <canvas
        ref={canvasRef}
        className="flow-screen__canvas"
        data-testid="flow-canvas"
        data-flow-cells={COLS * ROWS}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointerToCell(event);
          cursorRef.current = point;
          paint(point.x, point.y);
          playSound(point.x, point.y);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0) return;
          const point = pointerToCell(event);
          cursorRef.current = point;
          paint(point.x, point.y);
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="flow-screen__hud">
        <strong>声场画布</strong>
        <span>鼠标拖拽绘制 · 方向键移动 · 空格落笔 · 字母键映射声场 · S 保存 · R 重置 · F10/Esc 返回</span>
      </div>
    </div>
  );
}
