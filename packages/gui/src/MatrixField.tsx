/**
 * 关系谱（矩阵）模式：近黑底 + 灰阶编码的极简矩阵编辑器（v2.2）。
 *
 * 一张「关系谱」= 行 × 列 的 0..1 数值矩阵。整屏近黑 #0a0a0a，只用灰阶：
 * 格子亮度编码数值，行列标签是低透明白字；没有面板/按钮/常驻数字，只有选中时
 * 底部一行极淡的「行 × 列   值」。交互全部带 iOS 感弹簧/缓动：悬停/选中缩放、
 * 选中框弹簧滑动、拖动改值缓动、进入/切换/退出淡入缩放。
 *
 * 组件只负责画布与输入：值真正写回由 App 的 onEditCell 处理。
 */
import { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ *
 * Props / 数据契约
 * ------------------------------------------------------------------ */

export interface MatrixView {
  id: string;
  name: string;
  rows: string[];
  cols: string[];
  values: number[][];
}

export interface MatrixFieldProps {
  matrices: MatrixView[];
  index: number;
  onCycleMatrix: (dir: 1 | -1) => void;
  onEditCell: (matrixId: string, row: number, col: number, value: number, persist?: boolean) => void;
  onExit: () => void;
}

interface CellPosition {
  row: number;
  col: number;
  x: number;
  y: number;
  value: number;
}

interface CellRef {
  row: number;
  col: number;
}

interface MatrixDebugState {
  id: string;
  name: string;
  index: number;
  count: number;
  rows: string[];
  cols: string[];
  values: number[][];
  targets: number[][];
  selected: CellRef | null;
  hover: CellRef | null;
  cellEdits: number;
}

declare global {
  interface Window {
    __neurouMatrix?: {
      state: () => MatrixDebugState;
      cellPositions: () => CellPosition[];
      setCell: (row: number, col: number, value: number) => void;
    };
  }
}

/* ------------------------------------------------------------------ *
 * 视觉 / 手感参数
 * ------------------------------------------------------------------ */

const LOGICAL_W = 1440;
const LOGICAL_H = 900;

/** 背景：近黑，不刺眼。 */
const BG_RGB: readonly [number, number, number] = [10, 10, 10];
/** 标签白（#f5f5f5）。 */
const LABEL_RGB: readonly [number, number, number] = [245, 245, 245];
/** 格子亮度：0 → #151515，1 → #d8d8d8。 */
const CELL_DARK_RGB: readonly [number, number, number] = [21, 21, 21];
const CELL_LIGHT_RGB: readonly [number, number, number] = [216, 216, 216];

const LABEL_ALPHA = 0.25;
const LABEL_ACTIVE_ALPHA = 0.55;
const LABEL_HOVER_ALPHA = 0.4;
const ROW_LABEL_FONT_PX = 13;
const COL_LABEL_FONT_PX = 13;
const LABEL_GAP = 18;

const NAME_FONT_PX = 12;
const NAME_ALPHA = 0.3;
const SUMMARY_FONT_PX = 13;
const SUMMARY_ALPHA = 0.28;

const CELL_RADIUS_MAX = 13;
const CELL_RADIUS_MIN = 8;
const CELL_TARGET_SIZE = 144;
const CELL_MIN_SIZE = 24;
const CELL_GAP_MIN = 6;
const CELL_GAP_MAX = 14;

/** iOS 感弹簧：response 0.32s、damping 0.82。 */
const SPRING_RESPONSE = 0.32;
const SPRING_DAMPING = 0.82;
const SPRING_EPSILON = 0.0004;

/** 单元格缩放目标。 */
const SCALE_BASE = 1;
const SCALE_SELECTED = 1.1;
const SCALE_HOVER = 1.06;
const SCALE_NEIGHBOR = 1.01;

/** 数值缓动（约 180ms 时间常数）。 */
const VALUE_EASE_TAU_S = 0.18;
const VALUE_EPSILON = 0.0004;

/** 进入 / 切换 / 退出的淡入缩放：260ms ease-out。 */
const FADE_MS = 260;
const FADE_SCALE_FROM = 0.98;

/** 交互灵敏度。 */
const DRAG_VALUE_PER_PX = 1 / 220;
const WHEEL_STEP = 0.02;
const KEY_STEP = 0.02;

const DEFAULT_SERIF = '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", Georgia, serif';

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function rgba(color: readonly [number, number, number], alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp(alpha, 0, 1)})`;
}

function rgbGrey(level: number): string {
  const value = Math.round(clamp(level, 0, 255));
  return `rgb(${value}, ${value}, ${value})`;
}

/** 数值 → 格子灰阶亮度（0 → 21，1 → 216）。 */
function cellGrey(value: number): string {
  return rgbGrey(lerp(CELL_DARK_RGB[0], CELL_LIGHT_RGB[0], clamp(value, 0, 1)));
}

function easeOutCubic(t: number): number {
  const value = clamp(t, 0, 1);
  return 1 - (1 - value) * (1 - value) * (1 - value);
}

function toCellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function sameCell(a: CellRef | null, b: CellRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.row === b.row && a.col === b.col;
}

/** 单个标量弹簧（积分式，dt 变化下稳定）。 */
class Spring {
  value: number;
  velocity = 0;
  target: number;

  constructor(value: number) {
    this.value = value;
    this.target = value;
  }

  step(dt: number): void {
    const omega = (2 * Math.PI) / SPRING_RESPONSE;
    const zeta = SPRING_DAMPING;
    const acceleration = -omega * omega * (this.value - this.target) - 2 * zeta * omega * this.velocity;
    this.velocity += acceleration * dt;
    this.value += this.velocity * dt;
    if (Math.abs(this.value - this.target) < SPRING_EPSILON && Math.abs(this.velocity) < SPRING_EPSILON) {
      this.value = this.target;
      this.velocity = 0;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 布局
 * ------------------------------------------------------------------ */

interface MatrixLayout {
  cell: number;
  gap: number;
  radius: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

function layoutOf(rows: number, cols: number): MatrixLayout {
  const gap = clamp(CELL_GAP_MAX - Math.max(rows, cols) * 0.25, CELL_GAP_MIN, CELL_GAP_MAX);
  const availableW = LOGICAL_W - 2 * 150;
  const availableH = LOGICAL_H - 2 * 120 - 40;
  const byWidth = (availableW - (cols - 1) * gap) / Math.max(1, cols);
  const byHeight = (availableH - (rows - 1) * gap) / Math.max(1, rows);
  const cell = clamp(Math.min(CELL_TARGET_SIZE, byWidth, byHeight), CELL_MIN_SIZE, CELL_TARGET_SIZE);
  const width = cols * cell + Math.max(0, cols - 1) * gap;
  const height = rows * cell + Math.max(0, rows - 1) * gap;
  const left = (LOGICAL_W - width) / 2;
  // 视觉上让矩阵略偏下，给顶部列标签留白；底部留出 summary。
  const top = (LOGICAL_H - height) / 2 + 8;
  const radius = clamp(cell * 0.2, CELL_RADIUS_MIN, CELL_RADIUS_MAX);
  return { cell, gap, radius, left, top, width, height };
}

function cellCenter(layout: MatrixLayout, row: number, col: number): { x: number; y: number } {
  return {
    x: layout.left + col * (layout.cell + layout.gap) + layout.cell / 2,
    y: layout.top + row * (layout.cell + layout.gap) + layout.cell / 2,
  };
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export function MatrixField({ matrices, index, onCycleMatrix, onEditCell, onExit }: MatrixFieldProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const matricesRef = useRef<MatrixView[]>(matrices);
  const indexRef = useRef<number>(index);
  const cycleRef = useRef(onCycleMatrix);
  const editRef = useRef(onEditCell);
  const exitRef = useRef(onExit);
  matricesRef.current = matrices;
  indexRef.current = index;
  cycleRef.current = onCycleMatrix;
  editRef.current = onEditCell;
  exitRef.current = onExit;

  const matrixCount = matrices.length;
  const safeIndex = matrixCount > 0 ? Math.min(Math.max(index, 0), matrixCount - 1) : 0;
  const current = matrices[safeIndex] ?? null;

  const [valuesUi, setValuesUi] = useState<number[][]>([]);
  const [selectedUi, setSelectedUi] = useState<CellRef | null>(null);
  const [cellEditsUi, setCellEditsUi] = useState(0);

  const valuesJson = JSON.stringify(valuesUi.map((row) => row.map((value) => round4(value))));
  const selectedAttr = selectedUi === null ? '' : `${selectedUi.row},${selectedUi.col}`;

  useEffect(() => {
    const hostElement = hostRef.current;
    const canvasElement = canvasRef.current;
    if (!hostElement || !canvasElement) return;
    const ctxMaybe = canvasElement.getContext('2d');
    if (!ctxMaybe) return;

    const host = hostElement;
    const canvas = canvasElement;
    const ctx = ctxMaybe;

    /* —— 可变状态 —— */
    let displayed: number[][] = [];
    let targets: number[][] = [];
    let selected: CellRef | null = null;
    let hover: CellRef | null = null;
    let drag: {
      pointerId: number;
      row: number;
      col: number;
      startY: number;
      startValue: number;
      moved: boolean;
    } | null = null;
    let matrixKey = '';
    let layout = layoutOf(1, 1);
    let cellEditsNow = 0;
    let scaleX = 1;
    let scaleY = 1;

    let scales: Spring[][] = [];
    let selectionX = new Spring(0);
    let selectionY = new Spring(0);
    let fadeStart = performance.now();
    let closing: { start: number; done: boolean } | null = null;
    let lastFrame = 0;
    let requestId = 0;

    function currentMatrix(): MatrixView | null {
      const list = matricesRef.current;
      if (list.length === 0) return null;
      const safe = clamp(indexRef.current, 0, list.length - 1);
      return list[safe] ?? null;
    }

    function matrixRows(matrix: MatrixView): number {
      return matrix.values.length;
    }

    function matrixCols(matrix: MatrixView): number {
      return matrix.values[0]?.length ?? 0;
    }

    function clampValue(value: number): number {
      return clamp(value, 0, 1);
    }

    function pushUi(force = false): void {
      setValuesUi((previous) => {
        if (!force && previous.length === displayed.length) {
          let same = true;
          for (let r = 0; r < displayed.length && same; r += 1) {
            const prevRow = previous[r] ?? [];
            const nextRow = displayed[r] ?? [];
            if (prevRow.length !== nextRow.length) same = false;
            else {
              for (let c = 0; c < nextRow.length; c += 1) {
                if (Math.abs((prevRow[c] ?? 0) - (nextRow[c] ?? 0)) >= VALUE_EPSILON) {
                  same = false;
                  break;
                }
              }
            }
          }
          if (same) return previous;
        }
        return displayed.map((row) => row.slice());
      });
      setSelectedUi((previous) => (sameCell(previous, selected) ? previous : selected));
    }

    function bumpCellEdits(): void {
      cellEditsNow += 1;
      setCellEditsUi(cellEditsNow);
    }

    function resetScales(rows: number, cols: number): void {
      scales = [];
      for (let r = 0; r < rows; r += 1) {
        const row: Spring[] = [];
        for (let c = 0; c < cols; c += 1) row.push(new Spring(SCALE_BASE));
        scales.push(row);
      }
    }

    function snapSelectionToSelected(dt: number): void {
      if (!selected) return;
      const center = cellCenter(layout, selected.row, selected.col);
      selectionX.target = center.x;
      selectionY.target = center.y;
      selectionX.step(dt);
      selectionY.step(dt);
    }

    /** 矩阵切换 / 首次加载：快照新矩阵、清交互、重启淡入。 */
    function syncMatrix(now: number): MatrixView | null {
      const matrix = currentMatrix();
      if (!matrix) {
        if (matrixKey !== '') {
          matrixKey = '';
          displayed = [];
          targets = [];
          selected = null;
          hover = null;
          drag = null;
          scales = [];
          pushUi(true);
        }
        return null;
      }
      const rows = matrixRows(matrix);
      const cols = matrixCols(matrix);
      const key = `${matrix.id}::${rows}x${cols}`;
      if (key !== matrixKey) {
        matrixKey = key;
        layout = layoutOf(rows, cols);
        displayed = matrix.values.map((row) => row.slice(0, cols).map((value) => clampValue(value)));
        targets = displayed.map((row) => row.slice());
        selected = rows > 0 && cols > 0 ? { row: 0, col: 0 } : null;
        hover = null;
        drag = null;
        resetScales(rows, cols);
        const center = selected ? cellCenter(layout, selected.row, selected.col) : { x: LOGICAL_W / 2, y: LOGICAL_H / 2 };
        selectionX = new Spring(center.x);
        selectionY = new Spring(center.y);
        fadeStart = now;
        pushUi(true);
        return matrix;
      }
      // App 回传的新值：非拖动时跟随（拖动中本地 target 优先）。
      if (!drag && matrix.values.length === targets.length) {
        let changed = false;
        for (let r = 0; r < targets.length; r += 1) {
          const nextRow = matrix.values[r] ?? [];
          const targetRow = targets[r] ?? [];
          for (let c = 0; c < targetRow.length; c += 1) {
            const next = clampValue(nextRow[c] ?? 0);
            if (Math.abs(next - (targetRow[c] ?? next)) > 1e-6) {
              targetRow[c] = next;
              changed = true;
            }
          }
        }
        if (changed) pushUi();
      }
      return matrix;
    }

    /* —— 尺寸 / 坐标 —— */
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

    function cellAt(logicalX: number, logicalY: number): CellRef | null {
      const matrix = currentMatrix();
      if (!matrix) return null;
      const rows = matrixRows(matrix);
      const cols = matrixCols(matrix);
      const half = layout.cell / 2;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const center = cellCenter(layout, r, c);
          if (Math.abs(logicalX - center.x) <= half && Math.abs(logicalY - center.y) <= half) {
            return { row: r, col: c };
          }
        }
      }
      return null;
    }

    /* —— 输入 —— */
    function onPointerDown(event: PointerEvent): void {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const matrix = currentMatrix();
      if (!matrix) return;
      const point = pointToLogical(event.clientX, event.clientY);
      const cell = cellAt(point.x, point.y);
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      if (!cell) {
        selected = null;
        drag = null;
        pushUi();
        return;
      }
      selected = cell;
      pushUi();
      drag = {
        pointerId: event.pointerId,
        row: cell.row,
        col: cell.col,
        startY: point.y,
        startValue: targets[cell.row]?.[cell.col] ?? 0,
        moved: false,
      };
    }

    function onPointerMove(event: PointerEvent): void {
      const matrix = currentMatrix();
      if (!matrix) return;
      const point = pointToLogical(event.clientX, event.clientY);
      if (!drag) {
        const cell = cellAt(point.x, point.y);
        if (!sameCell(cell, hover)) {
          hover = cell;
          pushUi();
        }
        return;
      }
      if (event.pointerId !== drag.pointerId) return;
      if (Math.abs(point.y - drag.startY) > 2) drag.moved = true;
      if (!drag.moved) return;
      const next = clampValue(drag.startValue - (point.y - drag.startY) * DRAG_VALUE_PER_PX);
      const rowTargets = (targets[drag.row] ??= []);
      rowTargets[drag.col] = next;
      pushUi();
    }

    function onPointerUp(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const matrix = currentMatrix();
      const session = drag;
      drag = null;
      try {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      if (!matrix || !session.moved) return;
      const value = clampValue(targets[session.row]?.[session.col] ?? 0);
      editRef.current(matrix.id, session.row, session.col, value, true);
      bumpCellEdits();
    }

    function onPointerCancel(event: PointerEvent): void {
      if (drag && event.pointerId === drag.pointerId) drag = null;
    }

    /** 双击格子 → 归零（persist）。 */
    function onDoubleClick(event: MouseEvent): void {
      const matrix = currentMatrix();
      if (!matrix) return;
      const point = pointToLogical(event.clientX, event.clientY);
      const cell = cellAt(point.x, point.y);
      if (!cell) return;
      event.preventDefault();
      selected = cell;
      const rowTargets = (targets[cell.row] ??= []);
      rowTargets[cell.col] = 0;
      drag = null;
      pushUi();
      editRef.current(matrix.id, cell.row, cell.col, 0, true);
      bumpCellEdits();
    }

    function onWheel(event: WheelEvent): void {
      const matrix = currentMatrix();
      if (!matrix) return;
      event.preventDefault();
      const target = hover ?? selected;
      if (!target) return;
      const currentValue = targets[target.row]?.[target.col] ?? 0;
      const next = clampValue(currentValue + (event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP));
      const rowTargets = (targets[target.row] ??= []);
      rowTargets[target.col] = next;
      selected = target;
      pushUi();
      editRef.current(matrix.id, target.row, target.col, next, true);
      bumpCellEdits();
    }

    function adjustSelectedValue(delta: number): void {
      const matrix = currentMatrix();
      if (!matrix) return;
      const cell = selected ?? hover;
      if (!cell) return;
      const currentValue = targets[cell.row]?.[cell.col] ?? 0;
      const next = clampValue(currentValue + delta);
      const rowTargets = (targets[cell.row] ??= []);
      rowTargets[cell.col] = next;
      selected = cell;
      pushUi();
      editRef.current(matrix.id, cell.row, cell.col, next, true);
      bumpCellEdits();
    }

    function startClosing(now: number): void {
      if (closing) return;
      closing = { start: now, done: false };
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cycleRef.current(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.code === 'F3' || event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        startClosing(performance.now());
        return;
      }
      const matrix = currentMatrix();
      if (!matrix) return;
      const rows = matrixRows(matrix);
      const cols = matrixCols(matrix);
      if (rows === 0 || cols === 0) return;
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const current = selected ?? { row: 0, col: 0 };
        if (event.shiftKey && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
          adjustSelectedValue(event.code === 'ArrowUp' ? KEY_STEP : -KEY_STEP);
          return;
        }
        let next = current;
        if (event.code === 'ArrowLeft') next = { row: current.row, col: Math.max(0, current.col - 1) };
        else if (event.code === 'ArrowRight') next = { row: current.row, col: Math.min(cols - 1, current.col + 1) };
        else if (event.code === 'ArrowUp') next = { row: Math.max(0, current.row - 1), col: current.col };
        else next = { row: Math.min(rows - 1, current.row + 1), col: current.col };
        selected = next;
        pushUi();
        return;
      }
      if (event.code === 'Equal' || event.code === 'NumpadAdd') {
        event.preventDefault();
        event.stopImmediatePropagation();
        adjustSelectedValue(KEY_STEP);
        return;
      }
      if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        event.preventDefault();
        event.stopImmediatePropagation();
        adjustSelectedValue(-KEY_STEP);
        return;
      }
    }

    /* —— 绘制 —— */
    function drawCell(centerX: number, centerY: number, value: number, scale: number, selectedCell: boolean): void {
      const size = layout.cell * scale;
      const radius = layout.radius * (0.85 + scale * 0.15);
      ctx.fillStyle = cellGrey(value);
      ctx.beginPath();
      ctx.roundRect(centerX - size / 2, centerY - size / 2, size, size, radius);
      ctx.fill();
      if (selectedCell) {
        ctx.strokeStyle = rgba(LABEL_RGB, 0.55);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    function drawSummary(matrix: MatrixView): void {
      if (!selected) return;
      const rowName = matrix.rows[selected.row] ?? '';
      const colName = matrix.cols[selected.col] ?? '';
      const value = displayed[selected.row]?.[selected.col] ?? 0;
      ctx.font = `${SUMMARY_FONT_PX}px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(LABEL_RGB, SUMMARY_ALPHA);
      ctx.fillText(`${rowName} × ${colName}    ${value.toFixed(2)}`, LOGICAL_W / 2, LOGICAL_H - 46);
    }

    function draw(matrix: MatrixView | null, now: number): void {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = rgbGrey(BG_RGB[0]);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!matrix) return;
      // 高 DPI：把逻辑坐标映射到物理像素，否则内容会缩在左上角（Retina 一半大小）。
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

      const rows = matrixRows(matrix);
      const cols = matrixCols(matrix);
      if (rows === 0 || cols === 0) return;

      const fadeProgress = easeOutCubic((now - fadeStart) / FADE_MS);
      const closingProgress = closing ? easeOutCubic((now - closing.start) / FADE_MS) : 0;
      const alpha = fadeProgress * (1 - closingProgress);
      const scale = lerp(FADE_SCALE_FROM, 1, fadeProgress) * (1 - 0.02 * closingProgress);

      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.translate(LOGICAL_W / 2, LOGICAL_H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-LOGICAL_W / 2, -LOGICAL_H / 2);

      // 格子（含逐格弹簧缩放；选中格额外描边）
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const center = cellCenter(layout, r, c);
          const spring = scales[r]?.[c];
          const value = displayed[r]?.[c] ?? 0;
          const isSelected = selected !== null && selected.row === r && selected.col === c;
          drawCell(center.x, center.y, value, spring?.value ?? SCALE_BASE, isSelected);
        }
      }

      // 选中框：弹簧滑动位置（比格子略大一点）
      if (selected) {
        const size = layout.cell * 1.06;
        const radius = layout.radius + 2;
        ctx.strokeStyle = rgba(LABEL_RGB, 0.7);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(selectionX.value - size / 2, selectionY.value - size / 2, size, size, radius);
        ctx.stroke();
      }

      // 行标签（左侧）
      ctx.font = `${ROW_LABEL_FONT_PX}px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < rows; r += 1) {
        const center = cellCenter(layout, r, 0);
        const active = selected?.row === r;
        const hovering = hover?.row === r;
        ctx.fillStyle = rgba(LABEL_RGB, active ? LABEL_ACTIVE_ALPHA : hovering ? LABEL_HOVER_ALPHA : LABEL_ALPHA);
        ctx.fillText(matrix.rows[r] ?? '', layout.left - LABEL_GAP, center.y);
      }

      // 列标签（上方）
      ctx.font = `${COL_LABEL_FONT_PX}px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'center';
      for (let c = 0; c < cols; c += 1) {
        const center = cellCenter(layout, 0, c);
        const active = selected?.col === c;
        const hovering = hover?.col === c;
        ctx.fillStyle = rgba(LABEL_RGB, active ? LABEL_ACTIVE_ALPHA : hovering ? LABEL_HOVER_ALPHA : LABEL_ALPHA);
        ctx.fillText(matrix.cols[c] ?? '', center.x, layout.top - LABEL_GAP - COL_LABEL_FONT_PX / 2);
      }

      // 左下极淡矩阵名
      ctx.font = `${NAME_FONT_PX}px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = rgba(LABEL_RGB, NAME_ALPHA);
      ctx.fillText(matrix.name, 64, LOGICAL_H - 46);

      // 底部选中格：行 × 列 + 极淡数值
      drawSummary(matrix);

      // 多矩阵指示点（右下，当前略深；不显示数字）
      const total = matricesRef.current.length;
      if (total > 1) {
        const activeIndex = clamp(indexRef.current, 0, total - 1);
        const startX = LOGICAL_W - 64 - (total - 1) * 12;
        for (let i = 0; i < total; i += 1) {
          ctx.fillStyle = rgba(LABEL_RGB, i === activeIndex ? 0.55 : 0.22);
          ctx.beginPath();
          ctx.arc(startX + i * 12, LOGICAL_H - 46, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    /* —— 每帧 —— */
    function frame(now: number): void {
      requestId = window.requestAnimationFrame(frame);
      const dt = lastFrame > 0 ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
      lastFrame = now;

      const matrix = syncMatrix(now);
      const rows = targets.length;
      const cols = targets[0]?.length ?? 0;

      // 数值缓动（约 180ms）
      if (rows > 0) {
        const factor = 1 - Math.exp(-dt / VALUE_EASE_TAU_S);
        let changed = false;
        for (let r = 0; r < rows; r += 1) {
          const targetRow = targets[r] ?? [];
          const displayRow = displayed[r] ?? [];
          for (let c = 0; c < targetRow.length; c += 1) {
            const currentValue = displayRow[c] ?? 0;
            const targetValue = targetRow[c] ?? currentValue;
            const delta = targetValue - currentValue;
            if (Math.abs(delta) < VALUE_EPSILON) {
              if (currentValue !== targetValue) {
                displayRow[c] = targetValue;
                changed = true;
              }
            } else {
              displayRow[c] = currentValue + delta * factor;
              changed = true;
            }
          }
          displayed[r] = displayRow;
        }
        if (changed) pushUi();
      }

      // 逐格弹簧：选中 1.10、悬停 1.06、相邻 1.01；选中框弹簧滑动。
      if (matrix && rows > 0 && cols > 0) {
        for (let r = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1) {
            const spring = scales[r]?.[c];
            if (!spring) continue;
            const isSelected = selected !== null && selected.row === r && selected.col === c;
            const isHover = hover !== null && hover.row === r && hover.col === c;
            const isNeighbor =
              selected !== null && Math.abs(selected.row - r) + Math.abs(selected.col - c) === 1;
            spring.target = isSelected ? SCALE_SELECTED : isHover ? SCALE_HOVER : isNeighbor ? SCALE_NEIGHBOR : SCALE_BASE;
            spring.step(dt);
          }
        }
        snapSelectionToSelected(dt);
      }

      draw(matrix, now);

      // 退出动画结束 → 通知 App
      if (closing && !closing.done && now - closing.start >= FADE_MS) {
        closing.done = true;
        exitRef.current();
      }
    }

    /* —— 调试 / 验收钩子 —— */
    function buildState(): MatrixDebugState {
      const matrix = currentMatrix();
      const count = matricesRef.current.length;
      const safe = count > 0 ? clamp(indexRef.current, 0, count - 1) : 0;
      return {
        id: matrix?.id ?? '',
        name: matrix?.name ?? '',
        index: safe,
        count,
        rows: matrix ? matrix.rows.slice() : [],
        cols: matrix ? matrix.cols.slice() : [],
        values: displayed.map((row) => row.map((value) => round4(value))),
        targets: targets.map((row) => row.map((value) => round4(value))),
        selected,
        hover,
        cellEdits: cellEditsNow,
      };
    }

    const debugApi: NonNullable<Window['__neurouMatrix']> = {
      state: () => buildState(),
      cellPositions: () => {
        const matrix = currentMatrix();
        if (!matrix) return [];
        const result: CellPosition[] = [];
        for (let r = 0; r < displayed.length; r += 1) {
          for (let c = 0; c < (displayed[r]?.length ?? 0); c += 1) {
            const center = cellCenter(layout, r, c);
            result.push({
              row: r,
              col: c,
              x: Math.round(center.x * 100) / 100,
              y: Math.round(center.y * 100) / 100,
              value: round4(displayed[r]?.[c] ?? 0),
            });
          }
        }
        return result;
      },
      setCell: (row: number, col: number, value: number) => {
        const matrix = currentMatrix();
        if (!matrix) return;
        const r = Math.floor(row);
        const c = Math.floor(col);
        if (r < 0 || r >= targets.length || c < 0 || c >= (targets[r]?.length ?? 0)) return;
        const next = clampValue(value);
        targets[r] = targets[r] ?? [];
        targets[r][c] = next;
        pushUi();
        editRef.current(matrix.id, r, c, next, false);
      },
    };

    window.__neurouMatrix = debugApi;
    resize();
    syncMatrix(performance.now());
    pushUi(true);
    fadeStart = performance.now();

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
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
      window.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      if (window.__neurouMatrix === debugApi) delete window.__neurouMatrix;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="matrix-field"
      data-screen="matrix"
      data-matrix-id={current?.id ?? ''}
      data-matrix-name={current?.name ?? ''}
      data-matrix-index={safeIndex}
      data-matrix-count={matrixCount}
      data-cell-values={valuesJson}
      data-selected={selectedAttr}
      data-cell-edits={cellEditsUi}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#0a0a0a',
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
