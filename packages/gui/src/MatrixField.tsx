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
import { getStringAudio } from './stringAudio.js';
import { keyByCode, layoutKeyboard } from './stringMath.js';

/* ------------------------------------------------------------------ *
 * Props / 数据契约
 * ------------------------------------------------------------------ */

export interface MatrixCurveView {
  row: string;
  col: string;
  bands: number[];
  /** v2.10：单条曲线的插值覆盖（缺省跟随矩阵）。 */
  interpolation?: '线性' | '平滑' | '阶跃';
  /** v2.11：单条曲线的循环覆盖（缺省跟随矩阵）。 */
  loop?: boolean;
  /** v2.15：单条曲线自身的时间轴速度/相位（缺省 1 / 0）。 */
  speed?: number;
  phase?: number;
}

export interface MatrixView {
  id: string;
  name: string;
  rows: string[];
  cols: string[];
  values: number[][];
  curves: MatrixCurveView[];
  interpolation: '线性' | '平滑' | '阶跃';
  loop: boolean;
  /** 运行时拍周期（v2.3.6）：有周期时播放头与 tick 同步。 */
  period?: number;
  /** v2.6 时间轴速度倍率（默认 1）。 */
  speed: number;
  /** v2.6 时间轴相位 0..1（默认 0）。 */
  phase: number;
  /** v2.7 相位源：用另一张关系谱的曲线采样值替代静态 phase。 */
  phaseSource?: { matrix: string; row: string; col: string };
}

export interface MatrixFieldProps {
  matrices: MatrixView[];
  index: number;
  /** 运行时拍数（App 每次 tick 变化传入）。 */
  tick: number;
  onCycleMatrix: (dir: 1 | -1) => void;
  onEditCell: (matrixId: string, row: number, col: number, value: number, persist?: boolean) => void;
  onEditCurveBand: (
    matrixId: string,
    row: string,
    col: string,
    index: number,
    value: number,
    persist?: boolean,
  ) => void;
  /** 整条曲线写回（增删段点后调用；core 支持 1..64 值）。 */
  onEditCurveBands: (
    matrixId: string,
    row: string,
    col: string,
    bands: number[],
    persist?: boolean,
  ) => void;
  /** 关系谱行列结构编辑（v2.4.3，App 回传 core 修改后的世界）。 */
  onAddRow?: (matrixId: string, index: number) => void;
  onRemoveRow?: (matrixId: string, index: number) => void;
  onAddCol?: (matrixId: string, index: number) => void;
  onRemoveCol?: (matrixId: string, index: number) => void;
  onRenameRow?: (matrixId: string, index: number, label: string) => void;
  onRenameCol?: (matrixId: string, index: number, label: string) => void;
  /** 选中格曲线增删（Shift+C 切换；v2.4.4）。 */
  onAddCurve?: (matrixId: string, row: string, col: string) => void;
  onRemoveCurve?: (matrixId: string, row: string, col: string) => void;
  /** v2.8 键盘微调时间轴：速度与相位一次写回。 */
  onEditTiming?: (matrixId: string, speed: number, phase: number) => void;
  onExit: () => void;
}

interface CellPosition {
  row: number;
  col: number;
  x: number;
  y: number;
  /** 该格相对未视差位置的实际位移（含亮度差速）。 */
  dx: number;
  dy: number;
  /** 当前显示尺寸（基础尺寸 × 数值倍率 × hover/selected spring）。 */
  size: number;
  value: number;
}

interface CellRef {
  row: number;
  col: number;
}

/** 行/列标签内联改名输入框（画布上极简透明 input）。 */
interface RenameEditor {
  kind: 'row' | 'col';
  index: number;
  value: string;
  anchorX: number;
  anchorY: number;
  width: number;
  align: 'left' | 'center' | 'right';
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
  cursor: { x: number; y: number } | null;
  offset: { x: number; y: number };
  cursorVisible: boolean;
  crosshair: number;
  hoverSfx: number;
  navSfx: number;
  selectedCurve: { row: string; col: string; bands: number[] } | null;
  curveBandEdits: number;
  focus: {
    active: boolean;
    progress: number;
    cell: CellRef | null;
    curve: { row: string; col: string; bands: number[] } | null;
    bandIndex: number | null;
  };
  focusBandEdits: number;
  playing: boolean;
  playhead: number;
  playSpeed: number;
  speed: number;
  phase: number;
  effectivePhase: number;
  phaseSource: boolean;
  interpolation: '线性' | '平滑' | '阶跃';
  selectedCurveInterpolation: '线性' | '平滑' | '阶跃';
  focusCurveInterpolation: '线性' | '平滑' | '阶跃';
  selectedCurveLoop: boolean;
  focusCurveLoop: boolean;
  selectedCurveSpeed: number;
  selectedCurvePhase: number;
  selectedCurveLocalPlayhead: number;
  focusCurveSpeed: number;
  focusCurvePhase: number;
  focusCurveLocalPlayhead: number;
  tick: number;
  curveKeyEdits: number;
  curvePointAdds: number;
  curvePointRemoves: number;
  matrixRowAdds: number;
  matrixRowRemoves: number;
  matrixColAdds: number;
  matrixColRemoves: number;
  matrixRenames: number;
  matrixCurveAdds: number;
  matrixCurveRemoves: number;
  synced: boolean;
  period: number | null;
  targetPlayhead: number;
}

declare global {
  interface Window {
    __neurouMatrix?: {
      state: () => MatrixDebugState;
      cellPositions: () => CellPosition[];
      curvePositions: () => Array<{ index: number; x: number; y: number; value: number }>;
      focusCurvePositions: () => Array<{ index: number; x: number; y: number; value: number }>;
      labelPositions: () => Array<{ kind: 'row' | 'col'; index: number; x: number; y: number; width: number }>;
      playhead: () => number;
      sampleSelectedCurve: (t: number) => number;
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

/** 视差：矩阵整体沿「光标相对屏幕中心」的方向平移，位移 = 距离 × PARALLAX。 */
const PARALLAX = 0.08;
/** 视差 spring：更缓一点（response 0.4s / damping 0.9）。 */
const PARALLAX_SPRING_RESPONSE = 0.4;
const PARALLAX_SPRING_DAMPING = 0.9;
/** 滚轮编辑后短暂冻结视差，避免读数时矩阵漂移。 */
const WHEEL_FREEZE_MS = 280;
/** 自定义光标：1px 全屏白十字 + 22px/3px 粗准星（中心留 4px 空隙），difference 自动反色。 */
const CURSOR_ARM_PX = 11;
const CURSOR_CENTER_GAP_PX = 4;
const CURSOR_THIN_WIDTH = 1;
const CURSOR_THICK_WIDTH = 3;
/** 贯穿全屏的细十字半透明；准星保持满强度。 */
const CURSOR_LINE_ALPHA = 0.5;
const CURSOR_RETICLE_ALPHA = 1;
const CURSOR_FADE_MS = 160;
/** 方向键移动时十字光标收拢 220ms；鼠标再动时展开 260ms。 */
const CURSOR_COLLAPSE_MS = 220;
const CURSOR_EXPAND_MS = 260;
/** 命中容差：视差弹簧还没追上时也能稳定点到目标格。 */
const HIT_TOLERANCE_PX = 10;

/** 选中框：外扩 padding 9px、线宽 2、圆角略增；用 difference 白描边，深浅底都可见。 */
const SELECTION_RING_PADDING = 9;
const SELECTION_RING_WIDTH = 2;
const SELECTION_RING_RADIUS_EXTRA = 4;

/** 每格曲线：格内极淡 sparkline + 选中曲线格底部无面板编辑器。 */
const CURVE_EDITOR_LEFT = 200;
const CURVE_EDITOR_RIGHT = 1240;
const CURVE_EDITOR_TOP = 770;
const CURVE_EDITOR_BOTTOM = 860;
const CURVE_EDITOR_FADE_MS = 250;
const CURVE_EDITOR_SAMPLES = 120;
const CURVE_SPARK_SAMPLES = 24;
const CURVE_SPARK_ALPHA = 0.22;
const CURVE_SPARK_HOVER_ALPHA = 0.3;
const CURVE_LINE_ALPHA = 0.42;
const CURVE_POINT_ALPHA = 0.7;
const CURVE_POINT_RADIUS = 4.6;
const CURVE_POINT_SELECTED_RADIUS = 6.4;
const CURVE_HIT_RADIUS = 16;
const CURVE_VALUE_EASE_TAU_S = 0.12;

/** 曲线播放头：矩阵有曲线时自动播放归一化 t（8s 循环）。 */
const PLAY_DURATION_MS = 8000;
const PLAYHEAD_LINE_ALPHA = 0.14;
const PLAYHEAD_DOT_ALPHA = 0.85;
const PLAYHEAD_DOT_RADIUS = 2.8;
const SPARK_PLAYHEAD_RADIUS = 1.6;
/** 播放速度惯性：0→1 加速 0.35s；1→0 减速 0.28s。 */
const PLAY_ACCEL_SECONDS = 0.35;
const PLAY_DECEL_SECONDS = 0.28;
/** 与运行时 tick 同步时，播放头用约 0.35s 平滑追随（480ms 一跳变连续）。 */
const SYNCED_FOLLOW_SECONDS = 0.35;
/** 曲线节点拖尾：最近约 450ms 的位置淡出。 */
const CURVE_TRAIL_MS = 450;
const CURVE_TRAIL_ALPHA = 0.36;
const CURVE_TRAIL_SAMPLE_MS = 18;
/** 持续 voice 波形/音高更新间隔；按键标记松开后淡出时长。 */
const SUSTAINED_UPDATE_MS = 60;
const FEEDBACK_FADE_MS = 300;
/** Space 长按阈值：开门手势按住 >=280ms 松手时自动关窗（曲线保留，不删除）。 */
const SPACE_LONG_PRESS_MS = 280;

/** 聚焦编辑：双击曲线格（或选中后 Enter）用 iOS spring 放大成中央大圆角矩形。 */
const FOCUS_PANEL_WIDTH = 960;
const FOCUS_PANEL_HEIGHT = 480;
const FOCUS_PANEL_RADIUS = 30;
const FOCUS_REST_ALPHA = 0.12;
const FOCUS_SPRING_RESPONSE = 0.42;
const FOCUS_SPRING_DAMPING = 0.86;
const FOCUS_GRAPH_INSET_X = 90;
const FOCUS_GRAPH_INSET_TOP = 150;
const FOCUS_GRAPH_INSET_BOTTOM = 80;
const FOCUS_POINT_RADIUS = 4;
const FOCUS_POINT_SELECTED_RADIUS = 7;
const FOCUS_ARROW_ACCEL_SECONDS = 1.2;
const FOCUS_ARROW_DECEL_SECONDS = 0.22;
const FOCUS_VALUE_EASE_TAU_S = 0.12;

/** 伪 3D：越白的格子略大（0.94..1.05），且视差移动更快（0.78..1.22 × 组 offset）。 */
const CELL_VALUE_SCALE_MIN = 0.94;
const CELL_VALUE_SCALE_MAX = 1.05;
const CELL_PARALLAX_BASE = 0.78;
const CELL_PARALLAX_SPAN = 0.44;

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

/** 亮度 → 尺寸倍率（0.94..1.05）。 */
function valueScale(value: number): number {
  return lerp(CELL_VALUE_SCALE_MIN, CELL_VALUE_SCALE_MAX, clamp(value, 0, 1));
}

/** 亮度 → 视差差速倍率（0.78..1.22）。 */
function valueParallaxFactor(value: number): number {
  return CELL_PARALLAX_BASE + clamp(value, 0, 1) * CELL_PARALLAX_SPAN;
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
  response: number;
  damping: number;

  constructor(value: number, response = SPRING_RESPONSE, damping = SPRING_DAMPING) {
    this.value = value;
    this.target = value;
    this.response = response;
    this.damping = damping;
  }

  step(dt: number): void {
    const omega = (2 * Math.PI) / this.response;
    const zeta = this.damping;
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

export function MatrixField({
  matrices,
  index,
  tick,
  onCycleMatrix,
  onEditCell,
  onEditCurveBand,
  onEditCurveBands,
  onAddRow,
  onRemoveRow,
  onAddCol,
  onRemoveCol,
  onRenameRow,
  onRenameCol,
  onAddCurve,
  onRemoveCurve,
  onEditTiming,
  onExit,
}: MatrixFieldProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const matricesRef = useRef<MatrixView[]>(matrices);
  const indexRef = useRef<number>(index);
  const tickRef = useRef<number>(tick);
  const cycleRef = useRef(onCycleMatrix);
  const editRef = useRef(onEditCell);
  const curveEditRef = useRef(onEditCurveBand);
  const curveBandsEditRef = useRef(onEditCurveBands);
  const addRowRef = useRef(onAddRow);
  const removeRowRef = useRef(onRemoveRow);
  const addColRef = useRef(onAddCol);
  const removeColRef = useRef(onRemoveCol);
  const renameRowRef = useRef(onRenameRow);
  const renameColRef = useRef(onRenameCol);
  const addCurveRef = useRef(onAddCurve);
  const removeCurveRef = useRef(onRemoveCurve);
  const editTimingRef = useRef(onEditTiming);
  const exitRef = useRef(onExit);
  matricesRef.current = matrices;
  indexRef.current = index;
  tickRef.current = tick;
  cycleRef.current = onCycleMatrix;
  editRef.current = onEditCell;
  curveEditRef.current = onEditCurveBand;
  curveBandsEditRef.current = onEditCurveBands;
  addRowRef.current = onAddRow;
  removeRowRef.current = onRemoveRow;
  addColRef.current = onAddCol;
  removeColRef.current = onRemoveCol;
  renameRowRef.current = onRenameRow;
  renameColRef.current = onRenameCol;
  addCurveRef.current = onAddCurve;
  removeCurveRef.current = onRemoveCurve;
  editTimingRef.current = onEditTiming;
  exitRef.current = onExit;

  const matrixCount = matrices.length;
  const safeIndex = matrixCount > 0 ? Math.min(Math.max(index, 0), matrixCount - 1) : 0;
  const current = matrices[safeIndex] ?? null;

  const [valuesUi, setValuesUi] = useState<number[][]>([]);
  const [selectedUi, setSelectedUi] = useState<CellRef | null>(null);
  const [cellEditsUi, setCellEditsUi] = useState(0);
  const [cursorUi, setCursorUi] = useState<{ x: number; y: number } | null>({
    x: LOGICAL_W / 2,
    y: LOGICAL_H / 2,
  });
  const [offsetUi, setOffsetUi] = useState({ x: 0, y: 0 });
  const [cursorVisibleUi, setCursorVisibleUi] = useState(true);
  const [crosshairUi, setCrosshairUi] = useState(1);
  const [hoverSfxUi, setHoverSfxUi] = useState(0);
  const [navSfxUi, setNavSfxUi] = useState(0);
  const [selectedCurveUi, setSelectedCurveUi] = useState<number[] | null>(null);
  const [curveBandEditsUi, setCurveBandEditsUi] = useState(0);
  const [focusUi, setFocusUi] = useState(false);
  const [focusCellUi, setFocusCellUi] = useState('');
  const [focusCurveUi, setFocusCurveUi] = useState('');
  const [focusBandEditsUi, setFocusBandEditsUi] = useState(0);
  const [playingUi, setPlayingUi] = useState(false);
  const [playheadUi, setPlayheadUi] = useState(0);
  const [playSpeedUi, setPlaySpeedUi] = useState(0);
  const [effectivePhaseUi, setEffectivePhaseUi] = useState(0);
  const [curveKeyEditsUi, setCurveKeyEditsUi] = useState(0);
  const [curvePointAddsUi, setCurvePointAddsUi] = useState(0);
  const [curvePointRemovesUi, setCurvePointRemovesUi] = useState(0);
  const [matrixRowAddsUi, setMatrixRowAddsUi] = useState(0);
  const [matrixRowRemovesUi, setMatrixRowRemovesUi] = useState(0);
  const [matrixColAddsUi, setMatrixColAddsUi] = useState(0);
  const [matrixColRemovesUi, setMatrixColRemovesUi] = useState(0);
  const [matrixRenamesUi, setMatrixRenamesUi] = useState(0);
  const [matrixCurveAddsUi, setMatrixCurveAddsUi] = useState(0);
  const [matrixCurveRemovesUi, setMatrixCurveRemovesUi] = useState(0);
  const [renameEditor, setRenameEditor] = useState<RenameEditor | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCommitRef = useRef<(value: string) => void>(() => {});
  const renameCancelRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!renameEditor) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renameEditor]);

  const valuesJson = JSON.stringify(valuesUi.map((row) => row.map((value) => round4(value))));
  const selectedAttr = selectedUi === null ? '' : `${selectedUi.row},${selectedUi.col}`;
  const offsetAttr = JSON.stringify([
    Math.round(offsetUi.x * 100) / 100,
    Math.round(offsetUi.y * 100) / 100,
  ]);
  const cursorAttr =
    cursorUi === null ? '' : `${Math.round(cursorUi.x)},${Math.round(cursorUi.y)}`;
  const curveCount = current?.curves?.length ?? 0;
  const selectedCurveAttr =
    selectedCurveUi === null ? '' : JSON.stringify(selectedCurveUi.map((value) => round4(value)));
  const focusAttr = focusUi ? 'true' : 'false';
  const periodValue =
    current && typeof current.period === 'number' && Number.isFinite(current.period) && current.period > 0
      ? current.period
      : null;
  const syncedAttr = periodValue !== null ? 'true' : 'false';
  const periodAttr = periodValue !== null ? String(periodValue) : '';
  const timeSpeedValue =
    current && typeof current.speed === 'number' && Number.isFinite(current.speed) ? current.speed : 1;
  const phaseSourceAttr = current && current.phaseSource ? 'true' : 'false';
  const timeSpeedAttr = String(Math.round(timeSpeedValue * 10000) / 10000);
  const timePhaseAttr = effectivePhaseUi.toFixed(4);
  useEffect(() => {
    const hostElement = hostRef.current;
    const canvasElement = canvasRef.current;
    if (!hostElement || !canvasElement) return;
    const ctxMaybe = canvasElement.getContext('2d');
    if (!ctxMaybe) return;

    const host = hostElement;
    const canvas = canvasElement;
    const ctx = ctxMaybe;
    const audio = getStringAudio();

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
    /** 光标（逻辑屏幕坐标）；null = 指针不在页面内。初始在屏幕中心。 */
    let cursor: { x: number; y: number } | null = { x: LOGICAL_W / 2, y: LOGICAL_H / 2 };
    let cursorUiNow: { x: number; y: number } | null = { x: LOGICAL_W / 2, y: LOGICAL_H / 2 };
    let cursorActive = true;
    let cursorFade = 1;
    /** 十字光标展开/收拢比例（0 = 隐藏，1 = 全屏）。 */
    let crosshairScale = 1;
    let crosshairAnim: { from: number; to: number; start: number; duration: number } | null = null;
    let cursorVisible = true;
    let crosshairUiNow = 1;
    /** hover / nav 音效计数。 */
    let hoverSfxNow = 0;
    let navSfxNow = 0;
    /** 每格曲线：当前选中格的曲线数据 + 底部编辑器动画/拖拽状态。 */
    let curveIdentity = '';
    let curveMatrixId = '';
    let curveRow = '';
    let curveCol = '';
    let curveBands: number[] = [];
    let curveTargets: number[] = [];
    let curveActive = false;
    let curveAlpha = 0;
    let curveFadeStart = 0;
    let curveFadeTarget = 0;
    let curveDrag: {
      pointerId: number;
      index: number;
      startY: number;
      startValue: number;
      moved: boolean;
      voiceId: number;
    } | null = null;
    let curveSelectedIndex: number | null = null;
    let curvePointScales: Spring[] = [];
    let curveBandEditsNow = 0;
    let curveUiNow: number[] | null = null;
    /** 聚焦编辑：spring 进度、聚焦格/曲线、大曲线拖点/方向键惯性。 */
    const focusSpring = new Spring(0, FOCUS_SPRING_RESPONSE, FOCUS_SPRING_DAMPING);
    let focusTargetActive = false;
    let focusCell: CellRef | null = null;
    let focusRow = '';
    let focusCol = '';
    let focusMatrixId = '';
    let focusCurveBands: number[] = [];
    let focusCurveTargets: number[] = [];
    let focusSelectedIndex: number | null = null;
    let focusPointScales: Spring[] = [];
    let focusStartRect = { x: LOGICAL_W / 2, y: LOGICAL_H / 2, size: 144 };
    let focusDrag: {
      pointerId: number;
      index: number;
      startY: number;
      startValue: number;
      moved: boolean;
      voiceId: number;
    } | null = null;
    let focusArrow: {
      dir: 1 | -1;
      velocity: number;
      held: boolean;
      startValue: number;
      voiceId: number;
    } | null = null;
    let focusBandEditsNow = 0;
    let focusUiNow = false;
    let focusCellUiNow = '';
    let focusCurveUiNow = '';
    /** 曲线播放头：playing + 归一化 t（0..1，8s 循环）。 */
    let playing = true;
    let playhead = 0;
    let playSpeed = 0;
    /** 键盘连续微调时间轴时的本地乐观值（App props 追上后失效）。 */
    let timingPending: { matrixId: string; speed: number; phase: number } | null = null;
    let syncedTargetPlayhead = 0;
    let playingUiNow = false;
    let playheadUiNow = 0;
    let playSpeedUiNow = 0;
    let effectivePhaseUiNow = 0;
    /** 46 键 → 关系谱曲线段映射；多键各自一个 voice。 */
    const keys = layoutKeyboard();
    const curveKeyEdits = new Map<
      string,
      {
        context: 'curve' | 'focus';
        matrixId: string;
        row: string;
        col: string;
        band: number;
        startValue: number;
        targets: number[];
        voiceId: number;
        smooth: boolean;
        loop: boolean;
      }
    >();
    let curveKeyEditsNow = 0;
    let lastCurveVoiceUpdate = 0;
    let lastCurveNodeVoiceUpdate = 0;
    /** 曲线段点增删计数。 */
    let curvePointAddsNow = 0;
    let curvePointRemovesNow = 0;
    /** 关系谱结构编辑计数 + 当前改名目标。 */
    let matrixRowAddsNow = 0;
    let matrixRowRemovesNow = 0;
    let matrixColAddsNow = 0;
    let matrixColRemovesNow = 0;
    let matrixRenamesNow = 0;
    let matrixCurveAddsNow = 0;
    let matrixCurveRemovesNow = 0;
    /** 加/删格曲线时 sparkline/角标 250ms 淡入淡出；加曲线后自动聚焦。 */
    const curveCellAlphas = new Map<string, number>();
    let pendingFocusAfterAdd = false;
    let pendingFocusAt = 0;
    /** Space 开门手势起点：长按松手时关窗（只关窗，曲线保留）。 */
    let spaceOpenStarted = 0;
    let renameTarget: { kind: 'row' | 'col'; index: number; matrixId: string; original: string } | null = null;
    /** 键盘/拖动的极简按键标记（松开后 300ms 淡出）。 */
    const curveKeyMarks = new Map<string, { context: 'curve' | 'focus'; x: number; label: string; releasedAt: number | null }>();
    /** 节点拖尾：context:band → 最近 450ms 位置。 */
    const curveTrails = new Map<string, Array<{ t: number; x: number; y: number }>>();
    let lastTrailSample = 0;
    /** 拖动/滚轮冻结期间缓存各格亮度差速倍率，让所有格子位置一起静止。 */
    let frozenFactors: number[][] | null = null;
    /** 滚轮编辑后短暂冻结视差。 */
    let wheelFreezeUntil = 0;
    /** 视差弹簧：content 整体平移（response .4s / damping .9）。 */
    const parallaxX = new Spring(0, PARALLAX_SPRING_RESPONSE, PARALLAX_SPRING_DAMPING);
    const parallaxY = new Spring(0, PARALLAX_SPRING_RESPONSE, PARALLAX_SPRING_DAMPING);
    let offsetUiNow = { x: 0, y: 0 };

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

    function matrixTimeSpeed(matrix: MatrixView | null): number {
      return matrix && typeof matrix.speed === 'number' && Number.isFinite(matrix.speed) ? matrix.speed : 1;
    }

    function matrixTimePhase(matrix: MatrixView | null): number {
      return matrix && typeof matrix.phase === 'number' && Number.isFinite(matrix.phase)
        ? (((matrix.phase % 1) + 1) % 1)
        : 0;
    }

    function wrap01(value: number): number {
      if (!Number.isFinite(value)) return 0;
      return ((value % 1) + 1) % 1;
    }

    /** ]/[ 速度 ±0.2（0.2..4）；Shift+]/[ 相位 ±0.05（wrap）。 */
    function adjustMatrixTiming(deltaSpeed: number, deltaPhase: number): void {
      if (focusIsOpen() || curveDrag !== null || focusDrag !== null || curveKeyEdits.size > 0) return;
      const matrix = currentMatrix();
      if (!matrix || !editTimingRef.current) return;
      let speed = matrixTimeSpeed(matrix);
      let phase = matrixTimePhase(matrix);
      if (timingPending && timingPending.matrixId === matrix.id) {
        const propsMatchPending =
          Math.abs(matrixTimeSpeed(matrix) - timingPending.speed) < 1e-4 &&
          Math.abs(matrixTimePhase(matrix) - timingPending.phase) < 1e-4;
        if (!propsMatchPending) {
          speed = timingPending.speed;
          phase = timingPending.phase;
        }
      }
      speed = clamp(speed + deltaSpeed, 0.2, 4);
      phase = wrap01(phase + deltaPhase);
      timingPending = { matrixId: matrix.id, speed, phase };
      editTimingRef.current(matrix.id, speed, phase);
    }

    /** v2.7 有效相位：有 phaseSource 时递归采样源矩阵曲线，否则用静态 phase。 */
    function effectivePhaseOf(
      matrix: MatrixView | null,
      tick: number,
      depth = 0,
      visited: Set<string> = new Set(),
    ): number {
      if (!matrix) return 0;
      const source = matrix.phaseSource;
      if (!source) return matrixTimePhase(matrix);
      if (depth >= 8 || visited.has(matrix.id)) return matrixTimePhase(matrix);
      visited.add(matrix.id);
      const sourceMatrix = matricesRef.current.find(
        (candidate) => candidate.id === source.matrix || candidate.name === source.matrix,
      );
      if (!sourceMatrix) return matrixTimePhase(matrix);
      const sourcePeriod =
        typeof sourceMatrix.period === 'number' &&
        Number.isFinite(sourceMatrix.period) &&
        sourceMatrix.period > 0
          ? sourceMatrix.period
          : null;
      if (sourcePeriod === null) return matrixTimePhase(matrix);
      const sourcePhase = effectivePhaseOf(sourceMatrix, tick, depth + 1, visited);
      const position = wrap01((tick / sourcePeriod) * matrixTimeSpeed(sourceMatrix) + sourcePhase);
      const curve = sourceMatrix.curves?.find(
        (candidate) => candidate.row === source.row && candidate.col === source.col,
      );
      if (!curve || curve.bands.length < 2) return matrixTimePhase(matrix);
      return clamp(sampleCurveAt(sourceMatrix, curve, position), 0, 1);
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

    function updateCursorUi(point: { x: number; y: number } | null): void {
      if (point === null) {
        if (cursorUiNow !== null) {
          cursorUiNow = null;
          setCursorUi(null);
        }
        return;
      }
      if (cursorUiNow && Math.abs(cursorUiNow.x - point.x) < 0.3 && Math.abs(cursorUiNow.y - point.y) < 0.3) {
        return;
      }
      cursorUiNow = { x: point.x, y: point.y };
      setCursorUi(cursorUiNow);
    }

    function setCursorVisibleState(value: boolean): void {
      if (cursorVisible === value) return;
      cursorVisible = value;
      setCursorVisibleUi(value);
    }

    function pushCrosshairUi(): void {
      const rounded = Math.round(crosshairScale * 100) / 100;
      if (Math.abs(rounded - crosshairUiNow) < 0.005) return;
      crosshairUiNow = rounded;
      setCrosshairUi(rounded);
    }

    function animateCrosshair(to: number, duration: number, now: number): void {
      crosshairAnim = { from: crosshairScale, to, start: now, duration };
      if (to > 0) setCursorVisibleState(true);
    }

    /** 鼠标移动/点击：十字光标从当前位置展开恢复（0→1，约 260ms）。 */
    function expandCursor(): void {
      cursorActive = true;
      cursorFade = 1;
      if (crosshairAnim && crosshairAnim.to > 0.999) return;
      if (!cursorVisible || crosshairScale < 0.999) {
        animateCrosshair(1, CURSOR_EXPAND_MS, performance.now());
      } else {
        setCursorVisibleState(true);
      }
    }

    /** 方向键移动选中：十字光标以当前光标位置为中心收拢（1→0，约 220ms）后隐藏。 */
    function collapseCursor(): void {
      if (!cursorVisible && crosshairScale <= 0.002) return;
      if (crosshairAnim && crosshairAnim.to <= 0.001) return;
      animateCrosshair(0, CURSOR_COLLAPSE_MS, performance.now());
    }

    function bumpHoverSfx(): void {
      hoverSfxNow += 1;
      setHoverSfxUi(hoverSfxNow);
    }

    function bumpNavSfx(): void {
      navSfxNow += 1;
      setNavSfxUi(navSfxNow);
    }

    /* —— 每格曲线 —— */
    function smoothstep(t: number): number {
      const value = clamp(t, 0, 1);
      return value * value * (3 - 2 * value);
    }

    function sampleCurveBands(
      matrix: MatrixView,
      bands: readonly number[],
      t: number,
      interpolation: '线性' | '平滑' | '阶跃' = matrix.interpolation,
      loop: boolean = matrix.loop,
    ): number {
      const count = bands.length;
      if (count === 0) return 0;
      if (count === 1) return clampValue(bands[0] ?? 0);
      if (interpolation === '阶跃') {
        const index = Math.min(count - 1, Math.floor(clamp(t, 0, 1) * count));
        return clampValue(bands[index] ?? 0);
      }
      if (loop) {
        const scaled = clamp(t, 0, 1) * count;
        const i0 = Math.floor(scaled) % count;
        const i1 = (i0 + 1) % count;
        const raw = scaled - Math.floor(scaled);
        const u = interpolation === '平滑' ? smoothstep(raw) : raw;
        const a = bands[i0] ?? 0;
        const b = bands[i1] ?? 0;
        return clampValue(a + (b - a) * u);
      }
      const pos = clamp(t, 0, 1) * (count - 1);
      const i0 = Math.min(count - 1, Math.floor(pos));
      const i1 = Math.min(count - 1, i0 + 1);
      const raw = pos - i0;
      const u = interpolation === '平滑' ? smoothstep(raw) : raw;
      const a = bands[i0] ?? 0;
      const b = bands[i1] ?? 0;
      return clampValue(a + (b - a) * u);
    }

    /** 阶跃曲线路径：n 个等宽平台 + 垂直跳变。 */
    function traceStepPath(
      values: readonly number[],
      xStart: number,
      xEnd: number,
      yForValue: (value: number) => number,
    ): void {
      const count = values.length;
      if (count === 0) return;
      const width = xEnd - xStart;
      ctx.beginPath();
      for (let i = 0; i < count; i += 1) {
        const x0 = xStart + (i / count) * width;
        const x1 = xStart + ((i + 1) / count) * width;
        const y = yForValue(values[i] ?? 0);
        if (i === 0) ctx.moveTo(x0, y);
        else ctx.lineTo(x0, y);
        ctx.lineTo(x1, y);
        if (i < count - 1) ctx.lineTo(x1, yForValue(values[i + 1] ?? 0));
      }
    }

    function selectedCurveInfo(matrix: MatrixView | null): MatrixCurveView | null {
      if (!matrix || !selected) return null;
      const row = matrix.rows[selected.row] ?? '';
      const col = matrix.cols[selected.col] ?? '';
      return matrix.curves?.find((curve) => curve.row === row && curve.col === col) ?? null;
    }

    function curveInterpolation(
      matrix: MatrixView,
      curve: MatrixCurveView | null | undefined,
    ): '线性' | '平滑' | '阶跃' {
      return curve?.interpolation ?? matrix.interpolation;
    }

    function focusCurveInterpolation(matrix: MatrixView): '线性' | '平滑' | '阶跃' {
      const curve = matrix.curves?.find((candidate) => candidate.row === focusRow && candidate.col === focusCol);
      return curveInterpolation(matrix, curve);
    }

    function curveLoopOf(matrix: MatrixView, curve: MatrixCurveView | null | undefined): boolean {
      return curve?.loop ?? matrix.loop;
    }

    function focusCurveLoop(matrix: MatrixView): boolean {
      const curve = matrix.curves?.find((candidate) => candidate.row === focusRow && candidate.col === focusCol);
      return curveLoopOf(matrix, curve);
    }

    function curveSpeedOf(curve: MatrixCurveView | null | undefined): number {
      return curve && typeof curve.speed === 'number' && Number.isFinite(curve.speed) && curve.speed > 0
        ? curve.speed
        : 1;
    }

    function curvePhaseOf(curve: MatrixCurveView | null | undefined): number {
      return curve && typeof curve.phase === 'number' && Number.isFinite(curve.phase)
        ? wrap01(curve.phase)
        : 0;
    }

    /** 矩阵时间位置 → 曲线自己的本地位置（未 clamp/wrap）。 */
    function curveLocalPosition(matrix: MatrixView, curve: MatrixCurveView | null, t: number): number {
      return t * curveSpeedOf(curve) + curvePhaseOf(curve);
    }

    /** 本地位置映射到 0..1 的显示位置：循环 wrap，非循环 clamp。 */
    function curveDisplayPosition(matrix: MatrixView, curve: MatrixCurveView | null, t: number): number {
      const raw = curveLocalPosition(matrix, curve, t);
      return curveLoopOf(matrix, curve) ? wrap01(raw) : clamp(raw, 0, 1);
    }

    function sampleCurveAt(matrix: MatrixView, curve: MatrixCurveView | null, t: number): number {
      if (!curve) return 0;
      return sampleCurveBands(
        matrix,
        curve.bands,
        curveLocalPosition(matrix, curve, t),
        curveInterpolation(matrix, curve),
        curveLoopOf(matrix, curve),
      );
    }

    function focusCurveInfo(matrix: MatrixView): MatrixCurveView | null {
      return (
        matrix.curves?.find((candidate) => candidate.row === focusRow && candidate.col === focusCol) ?? null
      );
    }

    function sampleFocusCurveAt(matrix: MatrixView, t: number): number {
      const curve = focusCurveInfo(matrix);
      if (!curve) return 0;
      return sampleCurveBands(
        matrix,
        curve.bands,
        curveLocalPosition(matrix, curve, t),
        curveInterpolation(matrix, curve),
        curveLoopOf(matrix, curve),
      );
    }

    function focusCurveDisplayPosition(matrix: MatrixView, t: number): number {
      return curveDisplayPosition(matrix, focusCurveInfo(matrix), t);
    }

    function curveForCell(matrix: MatrixView, row: string, col: string): MatrixCurveView | null {
      return matrix.curves?.find((curve) => curve.row === row && curve.col === col) ?? null;
    }

    function curvePointX(
      matrix: MatrixView,
      index: number,
      count: number,
      loop: boolean = curveLoopOf(matrix, selectedCurveInfo(matrix)),
    ): number {
      if (count <= 1) return (CURVE_EDITOR_LEFT + CURVE_EDITOR_RIGHT) / 2;
      const ratio = loop ? index / count : index / (count - 1);
      return lerp(CURVE_EDITOR_LEFT, CURVE_EDITOR_RIGHT, clamp(ratio, 0, 1));
    }

    function curveValueToY(value: number): number {
      return lerp(CURVE_EDITOR_BOTTOM, CURVE_EDITOR_TOP, clamp(value, 0, 1));
    }

    function curveEditorContains(point: { x: number; y: number }): boolean {
      return (
        point.x >= CURVE_EDITOR_LEFT &&
        point.x <= CURVE_EDITOR_RIGHT &&
        point.y >= CURVE_EDITOR_TOP - 6 &&
        point.y <= CURVE_EDITOR_BOTTOM + 6
      );
    }

    function pushCurveUi(force = false): void {
      const next = curveActive && curveBands.length > 0 ? curveBands.map((value) => round4(value)) : null;
      const same = JSON.stringify(next) === JSON.stringify(curveUiNow);
      if (same && !force) return;
      curveUiNow = next;
      setSelectedCurveUi(next);
    }

    function bumpCurveBandEdits(): void {
      curveBandEditsNow += 1;
      setCurveBandEditsUi(curveBandEditsNow);
    }

    /** 选中格曲线出现/消失/外部更新：维护底部编辑器数据与 200ms 淡入淡出。 */
    function syncCurveEditor(now: number, matrix: MatrixView | null): void {
      const desired = selectedCurveInfo(matrix);
      if (matrix && desired && desired.bands.length > 0) {
        const identity = `${matrix.id}|${desired.row}|${desired.col}`;
        if (!curveActive || identity !== curveIdentity) {
          curveIdentity = identity;
          curveMatrixId = matrix.id;
          curveRow = desired.row;
          curveCol = desired.col;
          curveTargets = desired.bands.map((value) => clampValue(value));
          curveBands = curveTargets.slice();
          curveSelectedIndex = null;
          curvePointScales = curveTargets.map(() => new Spring(1));
          curveFadeStart = now;
          curveFadeTarget = 1;
          curveActive = true;
          curveAlpha = Math.max(curveAlpha, 0);
          pushCurveUi(true);
        } else if (!curveDrag && !hasCurveKeyEdit('curve') && desired.bands.length === curveTargets.length) {
          let changed = false;
          for (let i = 0; i < desired.bands.length; i += 1) {
            const next = clampValue(desired.bands[i] ?? 0);
            if (Math.abs(next - (curveTargets[i] ?? next)) > 1e-6) {
              curveTargets[i] = next;
              changed = true;
            }
          }
          if (changed) pushCurveUi();
        }
      } else if (curveActive) {
        curveActive = false;
        curveFadeStart = now;
        curveFadeTarget = 0;
        pushCurveUi(true);
      }
    }

    /** 每帧：曲线淡入淡出、数值缓动与段点 spring。 */
    function stepCurveEditor(now: number, dt: number): void {
      if (curveActive || curveAlpha > 0.001 || curveFadeTarget > 0) {
        const t = clamp((now - curveFadeStart) / CURVE_EDITOR_FADE_MS, 0, 1);
        curveAlpha = curveFadeTarget === 1 ? easeOutCubic(t) : 1 - easeOutCubic(t);
        if (curveFadeTarget === 0 && curveAlpha <= 0.001) {
          curveAlpha = 0;
          curveBands = [];
          curveTargets = [];
          curveIdentity = '';
          curveSelectedIndex = null;
          curvePointScales = [];
        }
      }
      if (curveBands.length > 0) {
        const factor = 1 - Math.exp(-dt / CURVE_VALUE_EASE_TAU_S);
        let changed = false;
        for (let i = 0; i < curveTargets.length; i += 1) {
          const currentValue = curveBands[i] ?? 0;
          const targetValue = curveTargets[i] ?? currentValue;
          const delta = targetValue - currentValue;
          if (Math.abs(delta) < 0.0002) {
            if (currentValue !== targetValue) {
              curveBands[i] = targetValue;
              changed = true;
            }
          } else {
            curveBands[i] = currentValue + delta * factor;
            changed = true;
          }
        }
        if (changed) pushCurveUi();
        for (let i = 0; i < curvePointScales.length; i += 1) {
          const spring = curvePointScales[i];
          if (!spring) continue;
          spring.target = i === curveSelectedIndex ? 1.35 : 1;
          spring.step(dt);
        }
      }
    }

    /* —— 聚焦编辑（双击/Enter 放大到中央大圆角矩形） —— */
    function focusPanelRect(progress: number): { left: number; top: number; width: number; height: number; radius: number } {
      const p = clamp(progress, 0, 1);
      const targetLeft = (LOGICAL_W - FOCUS_PANEL_WIDTH) / 2;
      const targetTop = (LOGICAL_H - FOCUS_PANEL_HEIGHT) / 2;
      const startLeft = focusStartRect.x - focusStartRect.size / 2;
      const startTop = focusStartRect.y - focusStartRect.size / 2;
      return {
        left: lerp(startLeft, targetLeft, p),
        top: lerp(startTop, targetTop, p),
        width: lerp(focusStartRect.size, FOCUS_PANEL_WIDTH, p),
        height: lerp(focusStartRect.size, FOCUS_PANEL_HEIGHT, p),
        radius: lerp(layout.radius + 4, FOCUS_PANEL_RADIUS, p),
      };
    }

    function focusGraphRect(progress: number): { left: number; top: number; right: number; bottom: number } {
      const panel = focusPanelRect(progress);
      return {
        left: panel.left + FOCUS_GRAPH_INSET_X,
        top: panel.top + FOCUS_GRAPH_INSET_TOP,
        right: panel.left + panel.width - FOCUS_GRAPH_INSET_X,
        bottom: panel.top + panel.height - FOCUS_GRAPH_INSET_BOTTOM,
      };
    }

    function focusCurvePointX(
      matrix: MatrixView,
      index: number,
      count: number,
      loop: boolean = focusCurveLoop(matrix),
    ): number {
      const graph = focusGraphRect(focusSpring.value);
      if (count <= 1) return (graph.left + graph.right) / 2;
      const ratio = loop ? index / count : index / (count - 1);
      return lerp(graph.left, graph.right, clamp(ratio, 0, 1));
    }

    function focusValueToY(value: number): number {
      const graph = focusGraphRect(focusSpring.value);
      return lerp(graph.bottom, graph.top, clamp(value, 0, 1));
    }

    function focusCurvePositionsData(): Array<{ index: number; x: number; y: number; value: number }> {
      const matrix = currentMatrix();
      if (!matrix || focusCurveBands.length < 2) return [];
      const count = focusCurveBands.length;
      return focusCurveBands.map((value, index) => ({
        index,
        x: Math.round(focusCurvePointX(matrix, index, count) * 100) / 100,
        y: Math.round(focusValueToY(value) * 100) / 100,
        value: round4(value),
      }));
    }

    function bumpFocusBandEdits(): void {
      focusBandEditsNow += 1;
      setFocusBandEditsUi(focusBandEditsNow);
    }

    function pushFocusUi(force = false): void {
      const active = focusTargetActive;
      const cellAttr = active && focusCell ? `${focusCell.row},${focusCell.col}` : '';
      const curveAttr =
        active && focusCurveBands.length > 0
          ? JSON.stringify(focusCurveBands.map((value) => round4(value)))
          : '';
      let changed = force;
      if (focusUiNow !== active) {
        focusUiNow = active;
        setFocusUi(active);
        changed = true;
      }
      if (focusCellUiNow !== cellAttr) {
        focusCellUiNow = cellAttr;
        setFocusCellUi(cellAttr);
        changed = true;
      }
      if (focusCurveUiNow !== curveAttr) {
        focusCurveUiNow = curveAttr;
        setFocusCurveUi(curveAttr);
        changed = true;
      }
      void changed;
    }

    function focusIsOpen(): boolean {
      return focusTargetActive || focusSpring.value > 0.01;
    }

    /** 曲线播放头：每帧只在数值/播放状态变化时同步 React 数据属性。 */
    function pushPlayUi(force = false): void {
      const hasCurves = (currentMatrix()?.curves?.length ?? 0) > 0;
      const nextPlaying = hasCurves ? playing : false;
      if (playingUiNow !== nextPlaying) {
        playingUiNow = nextPlaying;
        setPlayingUi(nextPlaying);
      }
      const rounded = Math.round(clamp(playhead, 0, 1) * 1000) / 1000;
      if (force || Math.abs(rounded - playheadUiNow) >= 0.005) {
        playheadUiNow = rounded;
        setPlayheadUi(rounded);
      }
      const roundedSpeed = Math.round(clamp(playSpeed, 0, 1) * 1000) / 1000;
      if (force || Math.abs(roundedSpeed - playSpeedUiNow) >= 0.005) {
        playSpeedUiNow = roundedSpeed;
        setPlaySpeedUi(roundedSpeed);
      }
    }

    function pushEffectivePhase(value: number, force = false): void {
      const rounded = Math.round(wrap01(value) * 10000) / 10000;
      if (force || Math.abs(rounded - effectivePhaseUiNow) >= 0.0005) {
        effectivePhaseUiNow = rounded;
        setEffectivePhaseUi(rounded);
      }
    }

    /* —— 关系谱曲线键盘映射 + 节点拖尾 —— */
    function curveKeyboardContext(): {
      context: 'curve' | 'focus';
      matrix: MatrixView;
      matrixId: string;
      row: string;
      col: string;
      targets: number[];
      bands: number[];
      smooth: boolean;
      loop: boolean;
    } | null {
      const matrix = currentMatrix();
      if (!matrix) return null;
      if (focusTargetActive && focusCurveTargets.length > 1) {
        return {
          context: 'focus',
          matrix,
          matrixId: focusMatrixId || matrix.id,
          row: focusRow,
          col: focusCol,
          targets: focusCurveTargets,
          bands: focusCurveBands,
          smooth: focusCurveInterpolation(matrix) === '平滑',
          loop: focusCurveLoop(matrix),
        };
      }
      const curve = selectedCurveInfo(matrix);
      if (curve && curveTargets.length > 1) {
        return {
          context: 'curve',
          matrix,
          matrixId: curveMatrixId || matrix.id,
          row: curveRow || curve.row,
          col: curveCol || curve.col,
          targets: curveTargets,
          bands: curveBands,
          smooth: curveInterpolation(matrix, curve) === '平滑',
          loop: curveLoopOf(matrix, curve),
        };
      }
      return null;
    }

    function curveKeyboardBandX(context: 'curve' | 'focus', matrix: MatrixView, index: number, count: number): number {
      return context === 'focus' ? focusCurvePointX(matrix, index, count) : curvePointX(matrix, index, count);
    }

    function curveKeyboardBandY(context: 'curve' | 'focus', value: number): number {
      return context === 'focus' ? focusValueToY(value) : curveValueToY(value);
    }

    function trailKey(context: 'curve' | 'focus', band: number): string {
      return `${context}:${band}`;
    }

    function recordCurveTrail(context: 'curve' | 'focus', band: number, x: number, y: number, now: number): void {
      const key = trailKey(context, band);
      let points = curveTrails.get(key);
      if (!points) {
        points = [];
        curveTrails.set(key, points);
      }
      const last = points[points.length - 1];
      if (last && now - last.t < CURVE_TRAIL_SAMPLE_MS && Math.hypot(last.x - x, last.y - y) < 1.5) return;
      points.push({ t: now, x, y });
      while (points.length > 0 && now - (points[0]?.t ?? now) > CURVE_TRAIL_MS) points.shift();
      while (points.length > 80) points.shift();
    }

    function pruneCurveTrails(now: number): void {
      for (const [key, points] of [...curveTrails]) {
        while (points.length > 0 && now - (points[0]?.t ?? now) > CURVE_TRAIL_MS) points.shift();
        if (points.length === 0) curveTrails.delete(key);
      }
    }

    /** 绘制 450ms 淡出拖尾（点 + 极淡连线），颜色只用灰阶。 */
    function drawCurveTrail(context: 'curve' | 'focus', now: number): void {
      for (const [key, points] of curveTrails) {
        if (!key.startsWith(`${context}:`)) continue;
        if (points.length === 0) continue;
        let prev: { x: number; y: number; alpha: number } | null = null;
        for (const point of points) {
          const age = clamp((now - point.t) / CURVE_TRAIL_MS, 0, 1);
          const alpha = (1 - age) * CURVE_TRAIL_ALPHA;
          if (alpha <= 0.004) {
            prev = null;
            continue;
          }
          if (prev && Math.hypot(prev.x - point.x, prev.y - point.y) < 60) {
            ctx.strokeStyle = rgba(LABEL_RGB, alpha * 0.5);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(point.x, point.y);
            ctx.stroke();
          }
          ctx.fillStyle = rgba(LABEL_RGB, alpha);
          ctx.beginPath();
          ctx.arc(point.x, point.y, 1.2 + (1 - age) * 0.8, 0, Math.PI * 2);
          ctx.fill();
          prev = { x: point.x, y: point.y, alpha };
        }
      }
    }

    /** 记录当前正在被拖动/键盘调整的曲线节点位置（每帧调用）。 */
    function recordActiveCurveTrails(now: number): void {
      const matrix = currentMatrix();
      if (!matrix) return;
      if (curveDrag && curveBands.length > 1) {
        const count = curveBands.length;
        const index = curveDrag.index;
        const x = curvePointX(matrix, index, count);
        const y = curveValueToY(curveBands[index] ?? 0);
        recordCurveTrail('curve', index, x, y, now);
      }
      if (focusDrag && focusCurveBands.length > 1) {
        const count = focusCurveBands.length;
        const index = focusDrag.index;
        const x = focusCurvePointX(matrix, index, count);
        const y = focusValueToY(focusCurveBands[index] ?? 0);
        recordCurveTrail('focus', index, x, y, now);
      }
      if (focusArrow && focusSelectedIndex !== null && focusCurveBands.length > 1) {
        const count = focusCurveBands.length;
        const index = focusSelectedIndex;
        const x = focusCurvePointX(matrix, index, count);
        const y = focusValueToY(focusCurveBands[index] ?? 0);
        recordCurveTrail('focus', index, x, y, now);
      }
      for (const edit of curveKeyEdits.values()) {
        const count = edit.context === 'focus' ? focusCurveBands.length : curveBands.length;
        if (count <= 1) continue;
        const value = edit.context === 'focus' ? (focusCurveBands[edit.band] ?? 0) : (curveBands[edit.band] ?? 0);
        recordCurveTrail(
          edit.context,
          edit.band,
          curveKeyboardBandX(edit.context, matrix, edit.band, count),
          curveKeyboardBandY(edit.context, value),
          now,
        );
      }
      pruneCurveTrails(now);
    }

    function bumpCurveKeyEdits(): void {
      curveKeyEditsNow += 1;
      setCurveKeyEditsUi(curveKeyEditsNow);
    }

    function flushCurveKeyEdit(code: string, persist = true): void {
      const edit = curveKeyEdits.get(code);
      if (!edit) return;
      curveKeyEdits.delete(code);
      audio.stopSustainedSpectrum(edit.voiceId);
      const mark = curveKeyMarks.get(code);
      if (mark) mark.releasedAt = performance.now();
      if (!persist) return;
      const value = clampValue(edit.targets[edit.band] ?? edit.startValue);
      if (Math.abs(value - edit.startValue) > 1e-6) {
        curveEditRef.current?.(edit.matrixId, edit.row, edit.col, edit.band, value, true);
        bumpCurveKeyEdits();
      }
    }

    function flushAllCurveKeyEdits(persist = true): void {
      for (const code of [...curveKeyEdits.keys()]) flushCurveKeyEdit(code, persist);
    }

    function hasCurveKeyEdit(context: 'curve' | 'focus'): boolean {
      for (const edit of curveKeyEdits.values()) if (edit.context === context) return true;
      return false;
    }

    /** 46 键按下：最近段 + key.cy 目标值；持续发声，keyup 持久化一次。 */
    function beginCurveKeyEdit(code: string, key: ReturnType<typeof layoutKeyboard>[number]): boolean {
      // 同一键的 repeat / 二次按下不重启 voice。
      if (curveKeyEdits.has(code)) return false;
      const context = curveKeyboardContext();
      if (!context) return false;
      const count = context.targets.length;
      if (count === 0) return false;
      let index = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < count; i += 1) {
        const distance = Math.abs(key.cx - curveKeyboardBandX(context.context, context.matrix, i, count));
        if (distance < bestDistance) {
          bestDistance = distance;
          index = i;
        }
      }
      const value = clampValue(1 - key.cy / LOGICAL_H);
      const startValue = context.targets[index] ?? 0;
      if (Math.abs(value - startValue) < 1e-6) {
        // 仍播放一次声音，但不产生改动。
      }
      // 跳跃前先记录旧位置，拖尾能连上。
      const now = performance.now();
      recordCurveTrail(
        context.context,
        index,
        curveKeyboardBandX(context.context, context.matrix, index, count),
        curveKeyboardBandY(context.context, startValue),
        now,
      );
      context.targets[index] = value;
      if (context.context === 'focus') {
        focusSelectedIndex = index;
        pushFocusUi(true);
      } else {
        curveSelectedIndex = index;
        pushCurveUi(true);
      }
      const xNorm = count <= 1 ? 0.5 : index / (count - 1);
      void audio.ensureStarted();
      const voiceId = audio.startSustainedSpectrum(context.bands, xNorm, value, context.smooth, context.loop);
      curveKeyEdits.set(code, {
        context: context.context,
        matrixId: context.matrixId,
        row: context.row,
        col: context.col,
        band: index,
        startValue,
        targets: context.targets,
        voiceId,
        smooth: context.smooth,
        loop: context.loop,
      });
      curveKeyMarks.set(code, {
        context: context.context,
        x: key.cx,
        label: key.label,
        releasedAt: null,
      });
      return true;
    }

    /** 每 ~60ms 用当前显示曲线更新所有键盘 voice 的波形/音高音量。 */
    function updateCurveKeyVoices(now: number, force = false): void {
      if (curveKeyEdits.size === 0) return;
      if (!force && now - lastCurveVoiceUpdate < SUSTAINED_UPDATE_MS) return;
      lastCurveVoiceUpdate = now;
      const matrix = currentMatrix();
      if (!matrix) return;
      for (const edit of curveKeyEdits.values()) {
        const bands = edit.context === 'focus' ? focusCurveBands : curveBands;
        const count = bands.length;
        if (edit.voiceId > 0 && count >= 2) {
          audio.updateSustainedSpectrum(edit.voiceId, bands, edit.smooth, edit.loop);
          const value = edit.targets[edit.band] ?? 0;
          const xNorm = count <= 1 ? 0.5 : edit.band / (count - 1);
          audio.updateSustainedTone(edit.voiceId, xNorm, value);
        }
      }
      void matrix;
    }

    function drawCurveKeyMarks(context: 'curve' | 'focus', now: number): void {
      if (curveKeyMarks.size === 0) return;
      ctx.save();
      ctx.font = `10px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const [code, mark] of [...curveKeyMarks]) {
        if (mark.context !== context) continue;
        const fade =
          mark.releasedAt === null ? 1 : Math.max(0, 1 - (now - mark.releasedAt) / FEEDBACK_FADE_MS);
        if (fade <= 0) {
          curveKeyMarks.delete(code);
          continue;
        }
        ctx.fillStyle = rgba(LABEL_RGB, 0.28 * fade);
        ctx.beginPath();
        ctx.arc(clamp(mark.x, 0, LOGICAL_W), 742, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(LABEL_RGB, 0.22 * fade);
        ctx.fillText(mark.label, clamp(mark.x, 12, LOGICAL_W - 12), 730);
      }
      ctx.restore();
    }

    /** 曲线节点持续音：鼠标拖动 / 聚焦 ↑↓ 调值共用（同一手势只 start/stop 一次）。 */
    function curveVoiceXNorm(index: number, count: number): number {
      return count <= 1 ? 0.5 : clamp(index / (count - 1), 0, 1);
    }

    function startCurveNodeVoice(context: 'curve' | 'focus', index: number, value: number): number {
      const matrix = currentMatrix();
      const bands = context === 'focus' ? focusCurveBands : curveBands;
      if (!matrix || bands.length < 2) return 0;
      const mode =
        context === 'focus'
          ? focusCurveInterpolation(matrix)
          : curveInterpolation(matrix, selectedCurveInfo(matrix));
      void audio.ensureStarted();
      const loop = context === 'focus' ? focusCurveLoop(matrix) : curveLoopOf(matrix, selectedCurveInfo(matrix));
      return audio.startSustainedSpectrum(
        bands,
        curveVoiceXNorm(index, bands.length),
        clampValue(value),
        mode === '平滑',
        loop,
      );
    }

    function updateCurveNodeVoice(id: number, context: 'curve' | 'focus', index: number, value: number): void {
      if (id <= 0) return;
      const matrix = currentMatrix();
      const bands = context === 'focus' ? focusCurveBands : curveBands;
      if (!matrix || bands.length < 2) return;
      const mode =
        context === 'focus'
          ? focusCurveInterpolation(matrix)
          : curveInterpolation(matrix, selectedCurveInfo(matrix));
      const loop = context === 'focus' ? focusCurveLoop(matrix) : curveLoopOf(matrix, selectedCurveInfo(matrix));
      audio.updateSustainedSpectrum(id, bands, mode === '平滑', loop);
      audio.updateSustainedTone(id, curveVoiceXNorm(index, bands.length), clampValue(value));
    }

    function stopCurveNodeVoice(id: number): void {
      if (id > 0) audio.stopSustainedSpectrum(id);
    }

    function stopCurveGestureVoices(): void {
      if (curveDrag && curveDrag.voiceId > 0) {
        stopCurveNodeVoice(curveDrag.voiceId);
        curveDrag.voiceId = 0;
      }
      if (focusDrag && focusDrag.voiceId > 0) {
        stopCurveNodeVoice(focusDrag.voiceId);
        focusDrag.voiceId = 0;
      }
      if (focusArrow && focusArrow.voiceId > 0) {
        stopCurveNodeVoice(focusArrow.voiceId);
        focusArrow.voiceId = 0;
      }
    }

    /** 拖动中每 ~60ms 更新一次曲线波形与音高/音量。 */
    function updateCurveDragVoices(now: number, force = false): void {
      if (!curveDrag && !focusDrag && !focusArrow) return;
      if (!force && now - lastCurveNodeVoiceUpdate < SUSTAINED_UPDATE_MS) return;
      lastCurveNodeVoiceUpdate = now;
      if (curveDrag && curveDrag.voiceId > 0) {
        updateCurveNodeVoice(curveDrag.voiceId, 'curve', curveDrag.index, curveTargets[curveDrag.index] ?? 0);
      }
      if (focusDrag && focusDrag.voiceId > 0) {
        updateCurveNodeVoice(focusDrag.voiceId, 'focus', focusDrag.index, focusCurveTargets[focusDrag.index] ?? 0);
      }
      if (focusArrow && focusArrow.voiceId > 0 && focusSelectedIndex !== null) {
        updateCurveNodeVoice(
          focusArrow.voiceId,
          'focus',
          focusSelectedIndex,
          focusCurveTargets[focusSelectedIndex] ?? 0,
        );
      }
    }

    function bumpCurvePointAdds(): void {
      curvePointAddsNow += 1;
      setCurvePointAddsUi(curvePointAddsNow);
    }

    function bumpCurvePointRemoves(): void {
      curvePointRemovesNow += 1;
      setCurvePointRemovesUi(curvePointRemovesNow);
    }

    function curvePointHitQuick(matrix: MatrixView, x: number, y: number): boolean {
      const count = curveBands.length;
      for (let i = 0; i < count; i += 1) {
        const px = curvePointX(matrix, i, count);
        const py = curveValueToY(curveBands[i] ?? 0);
        if (Math.hypot(x - px, y - py) <= CURVE_HIT_RADIUS) return true;
      }
      return false;
    }

    function curvePointHitFocus(matrix: MatrixView, x: number, y: number): boolean {
      const count = focusCurveBands.length;
      for (let i = 0; i < count; i += 1) {
        const px = focusCurvePointX(matrix, i, count);
        const py = focusValueToY(focusCurveBands[i] ?? 0);
        if (Math.hypot(x - px, y - py) <= CURVE_HIT_RADIUS) return true;
      }
      return false;
    }

    function curveInsertIndex(
      matrix: MatrixView,
      count: number,
      t: number,
      loop: boolean = curveLoopOf(matrix, selectedCurveInfo(matrix)),
    ): number {
      return loop
        ? clamp(Math.round(t * count), 0, count)
        : clamp(Math.round(t * (count - 1)), 0, count);
    }

    /** 底部编辑器空白处双击：插入节点并一次整条写回。 */
    function addQuickCurvePoint(matrix: MatrixView, point: { x: number; y: number }): boolean {
      if (!curveActive || curveTargets.length < 2 || curveTargets.length >= 64) return false;
      if (curvePointHitQuick(matrix, point.x, point.y)) return false;
      const count = curveTargets.length;
      const t = clamp((point.x - CURVE_EDITOR_LEFT) / (CURVE_EDITOR_RIGHT - CURVE_EDITOR_LEFT), 0, 1);
      const index = curveInsertIndex(matrix, count, t);
      const value = clampValue((CURVE_EDITOR_BOTTOM - point.y) / (CURVE_EDITOR_BOTTOM - CURVE_EDITOR_TOP));
      const next = curveTargets.slice();
      next.splice(index, 0, value);
      curveTargets = next;
      curveBands = next.slice();
      curvePointScales.splice(index, 0, new Spring(0));
      curveSelectedIndex = index;
      curveBandsEditRef.current?.(
        curveMatrixId || matrix.id,
        curveRow || (matrix.rows[selected?.row ?? 0] ?? ''),
        curveCol || (matrix.cols[selected?.col ?? 0] ?? ''),
        next.map((band) => round4(band)),
        true,
      );
      bumpCurvePointAdds();
      pushCurveUi(true);
      return true;
    }

    /** 聚焦大曲线空白处双击：插入节点并一次整条写回。 */
    function addFocusCurvePoint(matrix: MatrixView, point: { x: number; y: number }): boolean {
      if (!focusTargetActive || focusCurveTargets.length < 2 || focusCurveTargets.length >= 64) return false;
      if (curvePointHitFocus(matrix, point.x, point.y)) return false;
      const graph = focusGraphRect(focusSpring.value);
      const count = focusCurveTargets.length;
      const t = clamp((point.x - graph.left) / (graph.right - graph.left), 0, 1);
      const index = curveInsertIndex(matrix, count, t, focusCurveLoop(matrix));
      const value = clampValue((graph.bottom - point.y) / (graph.bottom - graph.top));
      const next = focusCurveTargets.slice();
      next.splice(index, 0, value);
      focusCurveTargets = next;
      focusCurveBands = next.slice();
      focusPointScales.splice(index, 0, new Spring(0));
      focusSelectedIndex = index;
      curveBandsEditRef.current?.(focusMatrixId, focusRow, focusCol, next.map((band) => round4(band)), true);
      bumpCurvePointAdds();
      pushFocusUi(true);
      return true;
    }

    function removeQuickCurvePoint(): boolean {
      if (!curveActive || curveTargets.length <= 2 || curveSelectedIndex === null) return false;
      const index = curveSelectedIndex;
      const next = curveTargets.slice();
      next.splice(index, 1);
      curveTargets = next;
      curveBands = next.slice();
      if (curvePointScales.length > index) curvePointScales.splice(index, 1);
      curveSelectedIndex = Math.min(index, next.length - 1);
      curveBandsEditRef.current?.(
        curveMatrixId,
        curveRow,
        curveCol,
        next.map((band) => round4(band)),
        true,
      );
      bumpCurvePointRemoves();
      pushCurveUi(true);
      return true;
    }

    function removeFocusCurvePoint(): boolean {
      if (!focusTargetActive || focusCurveTargets.length <= 2 || focusSelectedIndex === null) return false;
      const index = focusSelectedIndex;
      const next = focusCurveTargets.slice();
      next.splice(index, 1);
      focusCurveTargets = next;
      focusCurveBands = next.slice();
      if (focusPointScales.length > index) focusPointScales.splice(index, 1);
      focusSelectedIndex = Math.min(index, next.length - 1);
      curveBandsEditRef.current?.(focusMatrixId, focusRow, focusCol, next.map((band) => round4(band)), true);
      bumpCurvePointRemoves();
      pushFocusUi(true);
      return true;
    }

    function removeSelectedCurvePoint(): boolean {
      if (focusTargetActive && focusSelectedIndex !== null) return removeFocusCurvePoint();
      if (curveSelectedIndex !== null) return removeQuickCurvePoint();
      return false;
    }

    function finalizeFocusArrow(persist = true): void {
      const arrow = focusArrow;
      if (!arrow) return;
      stopCurveNodeVoice(arrow.voiceId);
      focusArrow = null;
      const index = focusSelectedIndex;
      if (!persist || index === null || !focusTargetActive) return;
      const value = clampValue(focusCurveTargets[index] ?? arrow.startValue);
      if (Math.abs(value - arrow.startValue) > 1e-6) {
        curveEditRef.current?.(focusMatrixId, focusRow, focusCol, index, value, true);
        bumpFocusBandEdits();
      }
    }

    function beginFocus(matrix: MatrixView, now: number): void {
      if (focusTargetActive || !selected) return;
      const curve = selectedCurveInfo(matrix);
      if (!curve || curve.bands.length === 0) return;
      focusTargetActive = true;
      focusCell = selected;
      focusRow = curve.row;
      focusCol = curve.col;
      focusMatrixId = matrix.id;
      focusCurveBands = curve.bands.map((value) => clampValue(value));
      focusCurveTargets = focusCurveBands.slice();
      focusSelectedIndex = 0;
      focusPointScales = focusCurveBands.map(() => new Spring(1));
      const value = displayed[selected.row]?.[selected.col] ?? 0;
      const base = cellCenter(layout, selected.row, selected.col);
      const factor = frozenFactors?.[selected.row]?.[selected.col] ?? valueParallaxFactor(value);
      focusStartRect = {
        x: base.x + parallaxX.value * factor,
        y: base.y + parallaxY.value * factor,
        size: cellDisplaySize(selected.row, selected.col, value),
      };
      focusSpring.target = 1;
      hover = null;
      pushUi();
      pushFocusUi(true);
      void now;
    }

    function closeFocus(): void {
      if (!focusTargetActive && focusSpring.value < 0.01) return;
      flushAllCurveKeyEdits(true);
      stopCurveGestureVoices();
      finalizeFocusArrow(true);
      focusTargetActive = false;
      focusSpring.target = 0;
      focusDrag = null;
      pushFocusUi(true);
    }

    function stepFocus(now: number, dt: number): void {
      focusSpring.step(dt);
      if (!focusTargetActive && focusSpring.value < 0.01 && focusCell !== null) {
        focusSpring.value = 0;
        focusSpring.velocity = 0;
        stopCurveGestureVoices();
        focusCell = null;
        focusCurveBands = [];
        focusCurveTargets = [];
        focusSelectedIndex = null;
        focusPointScales = [];
        focusDrag = null;
        finalizeFocusArrow(false);
        pushFocusUi(true);
      }
      if (focusCurveBands.length > 0) {
        const factor = 1 - Math.exp(-dt / FOCUS_VALUE_EASE_TAU_S);
        let changed = false;
        for (let i = 0; i < focusCurveTargets.length; i += 1) {
          const currentValue = focusCurveBands[i] ?? 0;
          const targetValue = focusCurveTargets[i] ?? currentValue;
          const delta = targetValue - currentValue;
          if (Math.abs(delta) < 0.0002) {
            if (currentValue !== targetValue) {
              focusCurveBands[i] = targetValue;
              changed = true;
            }
          } else {
            focusCurveBands[i] = currentValue + delta * factor;
            changed = true;
          }
        }
        if (changed) pushFocusUi();
        for (let i = 0; i < focusPointScales.length; i += 1) {
          const spring = focusPointScales[i];
          if (!spring) continue;
          spring.target = i === focusSelectedIndex ? 1.35 : 1;
          spring.step(dt);
        }
      }
      // ↑/↓ 按住连续调值：线性加速到 vmax，松开线性减速到 0，到界停下。
      if (focusArrow && focusSelectedIndex !== null) {
        const vmax = 1 / FOCUS_ARROW_ACCEL_SECONDS;
        const targetV = focusArrow.dir * vmax;
        if (focusArrow.held) {
          const accel = vmax / FOCUS_ARROW_ACCEL_SECONDS;
          if (focusArrow.velocity < targetV) focusArrow.velocity = Math.min(targetV, focusArrow.velocity + accel * dt);
          else if (focusArrow.velocity > targetV) focusArrow.velocity = Math.max(targetV, focusArrow.velocity - accel * dt);
        } else {
          const decel = vmax / FOCUS_ARROW_DECEL_SECONDS;
          if (focusArrow.velocity > 0) focusArrow.velocity = Math.max(0, focusArrow.velocity - decel * dt);
          else if (focusArrow.velocity < 0) focusArrow.velocity = Math.min(0, focusArrow.velocity + decel * dt);
        }
        if (focusArrow.velocity !== 0) {
          const index = focusSelectedIndex;
          const before = focusCurveTargets[index] ?? 0;
          const next = clampValue(before + focusArrow.velocity * dt);
          if (next !== before) {
            focusCurveTargets[index] = next;
            pushFocusUi();
          }
          if (next <= 0 || next >= 1) focusArrow.velocity = 0;
        }
        if (!focusArrow.held && focusArrow.velocity === 0) finalizeFocusArrow(true);
      }
      void now;
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
      // 选中框跟「组 offset」（不跟格子的亮度差速）。
      selectionX.target = center.x + parallaxX.value;
      selectionY.target = center.y + parallaxY.value;
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
          playhead = 0;
          playing = false;
          pushEffectivePhase(0, true);
          pushPlayUi(true);
          pushUi(true);
        }
        return null;
      }
      const rows = matrixRows(matrix);
      const cols = matrixCols(matrix);
      // 只用矩阵 id 作为身份键：行/列增删改由下面 structure 分支平滑同步。
      const key = matrix.id;
      if (key !== matrixKey) {
        matrixKey = key;
        flushAllCurveKeyEdits(true);
        stopCurveGestureVoices();
        curveTrails.clear();
        curveCellAlphas.clear();
        pendingFocusAfterAdd = false;
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
        // 有 curve 的矩阵自动播放播放头；有 period 的矩阵与运行时 tick 同步。
        const period =
          typeof matrix.period === 'number' && Number.isFinite(matrix.period) && matrix.period > 0
            ? matrix.period
            : null;
        playSpeed = 0;
        const effectiveAtEntry = effectivePhaseOf(matrix, tickRef.current);
        playhead =
          period !== null
            ? wrap01((tickRef.current / period) * matrixTimeSpeed(matrix) + effectiveAtEntry)
            : effectiveAtEntry;
        pushEffectivePhase(effectiveAtEntry, true);
        playing = (matrix.curves?.length ?? 0) > 0;
        pushPlayUi(true);
        pushUi(true);
        return matrix;
      }
      // 关系谱行列增删（v2.4.3）：重排布局、保留选中并夹住，整体淡入过渡。
      const structural =
        matrix.values.length !== targets.length ||
        (matrix.values[0]?.length ?? 0) !== (targets[0]?.length ?? 0);
      if (structural) {
        flushAllCurveKeyEdits(true);
        stopCurveGestureVoices();
        curveTrails.clear();
        curveCellAlphas.clear();
        pendingFocusAfterAdd = false;
        layout = layoutOf(rows, cols);
        displayed = matrix.values.map((row) => row.slice(0, cols).map((value) => clampValue(value)));
        targets = displayed.map((row) => row.slice());
        if (selected) {
          selected = {
            row: Math.min(selected.row, Math.max(0, rows - 1)),
            col: Math.min(selected.col, Math.max(0, cols - 1)),
          };
        } else if (rows > 0 && cols > 0) {
          selected = { row: 0, col: 0 };
        }
        if (hover) {
          hover = {
            row: Math.min(hover.row, Math.max(0, rows - 1)),
            col: Math.min(hover.col, Math.max(0, cols - 1)),
          };
        }
        drag = null;
        resetScales(rows, cols);
        const center = selected
          ? cellCenter(layout, selected.row, selected.col)
          : { x: LOGICAL_W / 2, y: LOGICAL_H / 2 };
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

    /** 每格当前显示尺寸：基础尺寸 × 亮度倍率 × hover/selected spring。 */
    function cellDisplaySize(row: number, col: number, value: number): number {
      const spring = scales[row]?.[col];
      return layout.cell * valueScale(value) * (spring?.value ?? SCALE_BASE);
    }

    /** 屏幕坐标 → 格子：按绘制顺序（大→小）命中最上层的大格。 */
    function cellAtScreen(logicalX: number, logicalY: number, useParallax: boolean): CellRef | null {
      const matrix = currentMatrix();
      if (!matrix) return null;
      const rows = matrixRows(matrix);
      const cols = matrixCols(matrix);
      const groupX = useParallax ? parallaxX.value : 0;
      const groupY = useParallax ? parallaxY.value : 0;
      const candidates: Array<{ row: number; col: number; size: number; centerX: number; centerY: number }> = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const value = displayed[r]?.[c] ?? 0;
          const factor = frozenFactors?.[r]?.[c] ?? valueParallaxFactor(value);
          const center = cellCenter(layout, r, c);
          candidates.push({
            row: r,
            col: c,
            size: cellDisplaySize(r, c, value),
            centerX: center.x + groupX * factor,
            centerY: center.y + groupY * factor,
          });
        }
      }
      // 大格先命中：重叠区命中最上层大格。
      candidates.sort((a, b) => b.size - a.size);
      for (const candidate of candidates) {
        const half = candidate.size / 2 + HIT_TOLERANCE_PX;
        if (Math.abs(logicalX - candidate.centerX) <= half && Math.abs(logicalY - candidate.centerY) <= half) {
          return { row: candidate.row, col: candidate.col };
        }
      }
      return null;
    }

    /** 屏幕坐标 → 格子：先按当前视差命中，视差弹簧未追上时退回未平移坐标。 */
    function cellAtPointer(logicalX: number, logicalY: number): CellRef | null {
      return cellAtScreen(logicalX, logicalY, true) ?? cellAtScreen(logicalX, logicalY, false);
    }

    /* —— 输入 —— */
    function onPointerDown(event: PointerEvent): void {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const matrix = currentMatrix();
      if (!matrix) return;
      const point = pointToLogical(event.clientX, event.clientY);
      cursor = point;
      cursorActive = true;
      cursorFade = 1;
      expandCursor();
      updateCursorUi(point);
      // 新手势开始前，先停掉上一条手势的持续音（保证同一手势只 start/stop 一次）。
      stopCurveGestureVoices();
      // 聚焦模式：只接受大曲线段点拖动，矩阵手势全部隐藏。
      if (focusIsOpen()) {
        event.preventDefault();
        if (focusTargetActive && focusCurveTargets.length > 0 && focusSpring.value > 0.6) {
          const graph = focusGraphRect(focusSpring.value);
          if (
            point.x >= graph.left - CURVE_HIT_RADIUS &&
            point.x <= graph.right + CURVE_HIT_RADIUS &&
            point.y >= graph.top - CURVE_HIT_RADIUS &&
            point.y <= graph.bottom + CURVE_HIT_RADIUS
          ) {
            const count = focusCurveTargets.length;
            let best = 0;
            let bestDistance = Number.POSITIVE_INFINITY;
            for (let i = 0; i < count; i += 1) {
              const distance = Math.abs(point.x - focusCurvePointX(matrix, i, count));
              if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
              }
            }
            try {
              canvas.setPointerCapture(event.pointerId);
            } catch {
              /* ignore */
            }
            focusSelectedIndex = best;
            focusDrag = {
              pointerId: event.pointerId,
              index: best,
              startY: point.y,
              startValue: focusCurveTargets[best] ?? 0,
              moved: false,
              voiceId: startCurveNodeVoice('focus', best, focusCurveTargets[best] ?? 0),
            };
            pushFocusUi(true);
          }
        }
        return;
      }
      // 底部曲线编辑器：只有编辑器区域内的 pointerdown 才拦截矩阵手势。
      const curve = selectedCurveInfo(matrix);
      if (curve && curveEditorContains(point)) {
        event.preventDefault();
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        syncCurveEditor(performance.now(), matrix);
        if (curveTargets.length === 0) {
          curveTargets = curve.bands.map((value) => clampValue(value));
          curveBands = curveTargets.slice();
          curvePointScales = curveTargets.map(() => new Spring(1));
        }
        const count = curveTargets.length;
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < count; i += 1) {
          const distance = Math.abs(point.x - curvePointX(matrix, i, count));
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        }
        curveSelectedIndex = best;
        curveDrag = {
          pointerId: event.pointerId,
          index: best,
          startY: point.y,
          startValue: curveTargets[best] ?? 0,
          moved: false,
          voiceId: startCurveNodeVoice('curve', best, curveTargets[best] ?? 0),
        };
        pushCurveUi(true);
        return;
      }
      const cell = cellAtPointer(point.x, point.y);
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
      cursor = point;
      cursorActive = true;
      cursorFade = 1;
      expandCursor();
      updateCursorUi(point);
      // 聚焦模式：拖动大曲线段点 / 其余矩阵 hover 全部隐藏。
      if (focusIsOpen()) {
        if (focusDrag && event.pointerId === focusDrag.pointerId) {
          if (Math.abs(point.y - focusDrag.startY) > 2) focusDrag.moved = true;
          const graph = focusGraphRect(focusSpring.value);
          const value = clampValue((graph.bottom - point.y) / (graph.bottom - graph.top));
          focusCurveTargets[focusDrag.index] = value;
          if (focusDrag.voiceId > 0) updateCurveNodeVoice(focusDrag.voiceId, 'focus', focusDrag.index, value);
          pushFocusUi(true);
        }
        return;
      }
      // 拖动曲线段点：垂直改该段 0..1。
      if (curveDrag && event.pointerId === curveDrag.pointerId) {
        if (Math.abs(point.y - curveDrag.startY) > 2) curveDrag.moved = true;
        const value = clampValue((CURVE_EDITOR_BOTTOM - point.y) / (CURVE_EDITOR_BOTTOM - CURVE_EDITOR_TOP));
        curveTargets[curveDrag.index] = value;
        if (curveDrag.voiceId > 0) updateCurveNodeVoice(curveDrag.voiceId, 'curve', curveDrag.index, value);
        pushCurveUi(true);
        return;
      }
      if (!drag) {
        const cell = cellAtPointer(point.x, point.y);
        if (!sameCell(cell, hover)) {
          hover = cell;
          pushUi();
          if (cell) {
            // 鼠标进入不同格子：轻音一次性（同格内不重复）。
            const value = displayed[cell.row]?.[cell.col] ?? 0;
            audio.matrixTick('hover', value);
            bumpHoverSfx();
          }
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

    function onPointerLeave(): void {
      // 指针离开页面：十字线收拢淡出（位置停在最后处），视差回中；data-cursor 置空。
      cursorActive = false;
      collapseCursor();
      updateCursorUi(null);
      if (hover !== null) {
        hover = null;
        pushUi();
      }
    }

    function onPointerUp(event: PointerEvent): void {
      if (focusDrag && event.pointerId === focusDrag.pointerId) {
        const session = focusDrag;
        focusDrag = null;
        stopCurveNodeVoice(session.voiceId);
        try {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        if (session.moved && focusTargetActive) {
          const value = clampValue(focusCurveTargets[session.index] ?? session.startValue);
          curveEditRef.current?.(focusMatrixId, focusRow, focusCol, session.index, value, true);
          bumpFocusBandEdits();
        }
        return;
      }
      if (curveDrag && event.pointerId === curveDrag.pointerId) {
        const session = curveDrag;
        curveDrag = null;
        stopCurveNodeVoice(session.voiceId);
        try {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        if (session.moved) {
          const value = clampValue(curveTargets[session.index] ?? session.startValue);
          curveEditRef.current?.(curveMatrixId, curveRow, curveCol, session.index, value, true);
          bumpCurveBandEdits();
        }
        return;
      }
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
      if (curveDrag && event.pointerId === curveDrag.pointerId) {
        stopCurveNodeVoice(curveDrag.voiceId);
        curveDrag = null;
      }
      if (focusDrag && event.pointerId === focusDrag.pointerId) {
        stopCurveNodeVoice(focusDrag.voiceId);
        focusDrag = null;
      }
    }

    /** 双击：曲线编辑器空白插点；有曲线矩阵格 → 聚焦；无曲线格 → 归零。 */
    function onDoubleClick(event: MouseEvent): void {
      const matrix = currentMatrix();
      if (!matrix) return;
      const point = pointToLogical(event.clientX, event.clientY);
      if (focusIsOpen()) {
        if (focusTargetActive && focusCurveTargets.length >= 2) {
          const graph = focusGraphRect(focusSpring.value);
          if (
            point.x >= graph.left - CURVE_HIT_RADIUS &&
            point.x <= graph.right + CURVE_HIT_RADIUS &&
            point.y >= graph.top - CURVE_HIT_RADIUS &&
            point.y <= graph.bottom + CURVE_HIT_RADIUS
          ) {
            event.preventDefault();
            addFocusCurvePoint(matrix, point);
          }
        }
        return;
      }
      // 行列标签双击 → 内联极简 input 改名。
      const labelHit = labelAtPoint(matrix, point);
      if (labelHit) {
        event.preventDefault();
        openRenameEditor(matrix, labelHit);
        return;
      }
      const selectedCurve = selectedCurveInfo(matrix);
      if (selectedCurve && curveEditorContains(point)) {
        event.preventDefault();
        addQuickCurvePoint(matrix, point);
        return;
      }
      const cell = cellAtPointer(point.x, point.y);
      if (!cell) return;
      event.preventDefault();
      selected = cell;
      pushUi();
      const curve = curveForCell(matrix, matrix.rows[cell.row] ?? '', matrix.cols[cell.col] ?? '');
      if (curve && curve.bands.length > 0) {
        beginFocus(matrix, performance.now());
        return;
      }
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
      if (focusIsOpen()) return; // 聚焦内矩阵滚轮无效。
      wheelFreezeUntil = performance.now() + WHEEL_FREEZE_MS;
      const point = pointToLogical(event.clientX, event.clientY);
      cursor = point;
      cursorActive = true;
      cursorFade = 1;
      expandCursor();
      updateCursorUi(point);
      const target = cellAtPointer(point.x, point.y) ?? hover ?? selected;
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

    /* —— 关系谱行列结构编辑 / 内联改名 —— */
    function bumpRowAdds(): void {
      matrixRowAddsNow += 1;
      setMatrixRowAddsUi(matrixRowAddsNow);
    }
    function bumpRowRemoves(): void {
      matrixRowRemovesNow += 1;
      setMatrixRowRemovesUi(matrixRowRemovesNow);
    }
    function bumpColAdds(): void {
      matrixColAddsNow += 1;
      setMatrixColAddsUi(matrixColAddsNow);
    }
    function bumpColRemoves(): void {
      matrixColRemovesNow += 1;
      setMatrixColRemovesUi(matrixColRemovesNow);
    }
    function bumpRenames(): void {
      matrixRenamesNow += 1;
      setMatrixRenamesUi(matrixRenamesNow);
    }

    function bumpMatrixCurveAdds(): void {
      matrixCurveAddsNow += 1;
      setMatrixCurveAddsUi(matrixCurveAddsNow);
    }

    function bumpMatrixCurveRemoves(): void {
      matrixCurveRemovesNow += 1;
      setMatrixCurveRemovesUi(matrixCurveRemovesNow);
    }

    /** Space：未聚焦时无曲线→添加并自动聚焦、有曲线→打开聚焦；已聚焦→只关闭聚焦，绝不删除曲线。 */
    function toggleFocusForSpace(): void {
      const matrix = currentMatrix();
      if (!matrix) return;
      if (focusTargetActive || focusIsOpen()) {
        spaceOpenStarted = 0;
        closeFocus();
        return;
      }
      if (!selected) return;
      if (curveDrag !== null || curveKeyEdits.size > 0) return;
      spaceOpenStarted = performance.now();
      const row = matrix.rows[selected.row] ?? '';
      const col = matrix.cols[selected.col] ?? '';
      const existing = matrix.curves?.some((curve) => curve.row === row && curve.col === col) ?? false;
      if (existing) {
        beginFocus(matrix, performance.now());
      } else if (addCurveRef.current) {
        addCurveRef.current(matrix.id, row, col);
        bumpMatrixCurveAdds();
        pendingFocusAfterAdd = true;
        pendingFocusAt = performance.now() + 180;
      }
    }

    /** Shift+Space：显式移除选中格（或当前聚焦格）曲线；移除后退出聚焦。 */
    function removeSelectedCellCurve(): void {
      const matrix = currentMatrix();
      if (!matrix) return;
      if (!removeCurveRef.current) return;
      if (focusTargetActive) {
        removeCurveRef.current(focusMatrixId, focusRow, focusCol);
        bumpMatrixCurveRemoves();
        pendingFocusAfterAdd = false;
        closeFocus();
        return;
      }
      if (focusIsOpen() || !selected) return;
      const row = matrix.rows[selected.row] ?? '';
      const col = matrix.cols[selected.col] ?? '';
      const existing = matrix.curves?.some((curve) => curve.row === row && curve.col === col) ?? false;
      if (!existing) return;
      removeCurveRef.current(matrix.id, row, col);
      bumpMatrixCurveRemoves();
      pendingFocusAfterAdd = false;
    }

    function addRowStructure(): void {
      const matrix = currentMatrix();
      if (!matrix || matrix.rows.length >= 64 || !addRowRef.current) return;
      const index = selected ? Math.min(matrix.rows.length, selected.row + 1) : matrix.rows.length;
      addRowRef.current(matrix.id, index);
      bumpRowAdds();
    }

    function removeRowStructure(): void {
      const matrix = currentMatrix();
      if (!matrix || !selected || matrix.rows.length <= 1 || !removeRowRef.current) return;
      removeRowRef.current(matrix.id, selected.row);
      bumpRowRemoves();
    }

    function addColStructure(): void {
      const matrix = currentMatrix();
      if (!matrix || matrix.cols.length >= 64 || !addColRef.current) return;
      const index = selected ? Math.min(matrix.cols.length, selected.col + 1) : matrix.cols.length;
      addColRef.current(matrix.id, index);
      bumpColAdds();
    }

    function removeColStructure(): void {
      const matrix = currentMatrix();
      if (!matrix || !selected || matrix.cols.length <= 1 || !removeColRef.current) return;
      removeColRef.current(matrix.id, selected.col);
      bumpColRemoves();
    }

    function labelAtPoint(
      matrix: MatrixView,
      point: { x: number; y: number },
    ): {
      kind: 'row' | 'col';
      index: number;
      label: string;
      anchorX: number;
      anchorY: number;
      width: number;
      align: 'left' | 'center' | 'right';
    } | null {
      ctx.save();
      // 行标签（右侧对齐在 layout.left - LABEL_GAP）
      ctx.font = `${ROW_LABEL_FONT_PX}px ${DEFAULT_SERIF}`;
      for (let r = 0; r < matrix.rows.length; r += 1) {
        const label = matrix.rows[r] ?? '';
        const center = cellCenter(layout, r, 0);
        const x = layout.left - LABEL_GAP + parallaxX.value;
        const y = center.y + parallaxY.value;
        const width = ctx.measureText(label).width;
        if (point.x >= x - width - 14 && point.x <= x + 14 && Math.abs(point.y - y) <= 16) {
          ctx.restore();
          return {
            kind: 'row',
            index: r,
            label,
            anchorX: x,
            anchorY: y,
            width: Math.max(120, width + 50),
            align: 'right',
          };
        }
      }
      // 列标签（居中在格子上方）
      ctx.font = `${COL_LABEL_FONT_PX}px ${DEFAULT_SERIF}`;
      for (let c = 0; c < matrix.cols.length; c += 1) {
        const label = matrix.cols[c] ?? '';
        const center = cellCenter(layout, 0, c);
        const x = center.x + parallaxX.value;
        const y = layout.top - LABEL_GAP - COL_LABEL_FONT_PX / 2 + parallaxY.value;
        const width = ctx.measureText(label).width;
        if (Math.abs(point.x - x) <= width / 2 + 14 && Math.abs(point.y - y) <= 16) {
          ctx.restore();
          return {
            kind: 'col',
            index: c,
            label,
            anchorX: x,
            anchorY: y,
            width: Math.max(120, width + 50),
            align: 'center',
          };
        }
      }
      ctx.restore();
      return null;
    }

    function openRenameEditor(
      matrix: MatrixView,
      hit: NonNullable<ReturnType<typeof labelAtPoint>>,
    ): void {
      renameTarget = {
        kind: hit.kind,
        index: hit.index,
        matrixId: matrix.id,
        original: hit.label,
      };
      setRenameEditor({
        kind: hit.kind,
        index: hit.index,
        value: hit.label,
        anchorX: hit.anchorX,
        anchorY: hit.anchorY,
        width: hit.width,
        align: hit.align,
      });
    }

    renameCommitRef.current = (value: string): void => {
      const target = renameTarget;
      renameTarget = null;
      setRenameEditor(null);
      if (!target) return;
      const next = value.trim();
      if (!next || next === target.original) return;
      if (target.kind === 'row') renameRowRef.current?.(target.matrixId, target.index, next);
      else renameColRef.current?.(target.matrixId, target.index, next);
      bumpRenames();
    };
    renameCancelRef.current = (): void => {
      renameTarget = null;
      setRenameEditor(null);
    };

    function onKeyDown(event: KeyboardEvent): void {
      const targetEl = event.target as HTMLElement | null;
      if (targetEl && (targetEl.tagName === 'INPUT' || targetEl.isContentEditable)) return;
      // Ctrl+Enter / Ctrl+Shift+Enter：插行/列；Ctrl+Backspace / Ctrl+Shift+Backspace：删行/列。
      if (event.ctrlKey && !event.metaKey && !event.altKey) {
        if (focusIsOpen() || curveDrag !== null || curveKeyEdits.size > 0) return;
        if (event.code === 'Enter') {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.shiftKey) addColStructure();
          else addRowStructure();
          return;
        }
        if (event.code === 'Backspace') {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (event.shiftKey) removeColStructure();
          else removeRowStructure();
          return;
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // ]/[ 速度 ±0.2；Shift+]/[ 相位 ±0.05（聚焦内不响应，交给曲线键盘映射）。
      if (
        (event.code === 'BracketRight' || event.code === 'BracketLeft') &&
        !focusIsOpen()
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const dir = event.code === 'BracketRight' ? 1 : -1;
        if (event.shiftKey) adjustMatrixTiming(0, dir * 0.05);
        else adjustMatrixTiming(dir * 0.2, 0);
        return;
      }
      // Space：只打开/关闭聚焦（无曲线时添加一次）；Shift+Space：显式移除曲线。
      if (event.code === 'Space') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat) return;
        if (event.shiftKey) removeSelectedCellCurve();
        else toggleFocusForSpace();
        return;
      }
      // P：播放/暂停（保留 playSpeed 惯性；与 Space 解耦）。
      if (event.code === 'KeyP' && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const matrix = currentMatrix();
        if (matrix && (matrix.curves?.length ?? 0) > 0) {
          playing = !playing;
          pushPlayUi(true);
        }
        return;
      }
      if (event.code === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        flushAllCurveKeyEdits(true);
        if (focusIsOpen()) closeFocus();
        cycleRef.current(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.code === 'F3') {
        event.preventDefault();
        event.stopImmediatePropagation();
        flushAllCurveKeyEdits(true);
        startClosing(performance.now());
        return;
      }
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        flushAllCurveKeyEdits(true);
        if (focusIsOpen()) {
          closeFocus();
          return;
        }
        startClosing(performance.now());
        return;
      }
      if (event.code === 'Enter' && !focusTargetActive) {
        const matrix = currentMatrix();
        if (matrix && selectedCurveInfo(matrix)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          beginFocus(matrix, performance.now());
          return;
        }
      }
      // 46 键映射：底部曲线编辑器可见或聚焦大曲线打开时改最近段（不影响 Enter/Space/方向键等）。
      if (!event.repeat && !event.shiftKey) {
        const mappedKey = keyByCode(keys, event.code);
        if (mappedKey && curveKeyboardContext()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          beginCurveKeyEdit(event.code, mappedKey);
          return;
        }
      }
      // Delete/Backspace：删除当前选中曲线段点（最少保留 2 个）。
      if (!event.repeat && (event.code === 'Delete' || event.code === 'Backspace')) {
        if (removeSelectedCurvePoint()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      if (focusIsOpen()) {
        // 聚焦内：←/→ 切段点，↑/↓ 按住连续调值；矩阵手势全部隐藏。
        if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
          event.preventDefault();
          event.stopImmediatePropagation();
          const count = focusCurveTargets.length;
          if (count > 0) {
            const step = event.code === 'ArrowRight' ? 1 : -1;
            focusSelectedIndex = clamp((focusSelectedIndex ?? 0) + step, 0, count - 1);
            pushFocusUi(true);
          }
          return;
        }
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
          event.preventDefault();
          event.stopImmediatePropagation();
          const count = focusCurveTargets.length;
          if (count === 0) return;
          if (focusSelectedIndex === null) focusSelectedIndex = 0;
          const dir: 1 | -1 = event.code === 'ArrowUp' ? 1 : -1;
          if (!focusArrow) {
            focusArrow = {
              dir,
              velocity: 0,
              held: true,
              startValue: focusCurveTargets[focusSelectedIndex] ?? 0,
              voiceId: startCurveNodeVoice('focus', focusSelectedIndex, focusCurveTargets[focusSelectedIndex] ?? 0),
            };
          } else {
            focusArrow.dir = dir;
            focusArrow.held = true;
            if (focusArrow.voiceId <= 0) {
              focusArrow.voiceId = startCurveNodeVoice(
                'focus',
                focusSelectedIndex,
                focusCurveTargets[focusSelectedIndex] ?? 0,
              );
            }
          }
          pushFocusUi();
          return;
        }
        if (event.code === 'Equal' || event.code === 'Minus' || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract') {
          return;
        }
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
        const moved = !sameCell(next, current);
        selected = next;
        pushUi();
        if (moved) {
          // 方向键切换选中：十字光标收拢隐藏 + nav 音效。
          collapseCursor();
          const value = displayed[next.row]?.[next.col] ?? 0;
          audio.matrixTick('nav', value);
          bumpNavSfx();
        }
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

    function onKeyUp(event: KeyboardEvent): void {
      if (event.code === 'Space') {
        // 长按开门后松手：只关窗，曲线保持不变；短按保持当前的开关结果。
        if (spaceOpenStarted > 0) {
          const duration = performance.now() - spaceOpenStarted;
          spaceOpenStarted = 0;
          if (duration >= SPACE_LONG_PRESS_MS) {
            pendingFocusAfterAdd = false;
            if (focusIsOpen()) closeFocus();
          }
        }
        return;
      }
      if (curveKeyEdits.has(event.code)) {
        flushCurveKeyEdit(event.code, true);
        return;
      }
      if (event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return;
      if (!focusArrow) return;
      const dir: 1 | -1 = event.code === 'ArrowUp' ? 1 : -1;
      if (focusArrow.dir !== dir) return;
      // 松键立即停持续音；惯性减速只保留视觉/数值。
      stopCurveNodeVoice(focusArrow.voiceId);
      focusArrow.voiceId = 0;
      focusArrow.held = false;
      if (focusArrow.velocity === 0) finalizeFocusArrow(true);
    }

    /* —— 绘制 —— */
    function drawCell(
      centerX: number,
      centerY: number,
      value: number,
      scale: number,
      selectedCell: boolean,
      curve: MatrixCurveView | null,
      hovered: boolean,
      matrix: MatrixView,
      curveAlpha: number,
    ): void {
      const size = layout.cell * scale;
      const radius = layout.radius * (0.85 + scale * 0.15);
      ctx.fillStyle = cellGrey(value);
      ctx.beginPath();
      ctx.roundRect(centerX - size / 2, centerY - size / 2, size, size, radius);
      ctx.fill();
      // 格内底部极淡 sparkline（不改变填充/尺寸/图层/差速）。
      if (curve && curve.bands.length > 1 && curveAlpha > 0.004) {
        const x0 = centerX - size * 0.3;
        const x1 = centerX + size * 0.3;
        const y0 = centerY + size * 0.38;
        const y1 = centerY + size * 0.2;
        ctx.strokeStyle = rgba(
          LABEL_RGB,
          (hovered ? CURVE_SPARK_HOVER_ALPHA : CURVE_SPARK_ALPHA) * curveAlpha,
        );
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const curveMode = curveInterpolation(matrix, curve);
        if (curveMode === '阶跃') {
          traceStepPath(curve.bands, x0, x1, (bandValue) => lerp(y0, y1, bandValue));
        } else {
          ctx.beginPath();
          for (let step = 0; step <= CURVE_SPARK_SAMPLES; step += 1) {
            const t = step / CURVE_SPARK_SAMPLES;
            const sample = sampleCurveBands(matrix, curve.bands, t, curveMode, curveLoopOf(matrix, curve));
            const x = lerp(x0, x1, t);
            const y = lerp(y0, y1, sample);
            if (step === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        // 播放头：沿 sparkline 移动的小亮点（显示曲线本地位置）。
        const playSample = sampleCurveAt(matrix, curve, playhead);
        const playX = lerp(x0, x1, curveDisplayPosition(matrix, curve, playhead));
        const playY = lerp(y0, y1, playSample);
        ctx.fillStyle = rgba(LABEL_RGB, PLAYHEAD_DOT_ALPHA * curveAlpha);
        ctx.beginPath();
        ctx.arc(playX, playY, SPARK_PLAYHEAD_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        // 有曲线的格子右上角极淡角标（小点 + 短刻度），hover 略亮。
        const markerX = centerX + size * 0.3;
        const markerY = centerY - size * 0.32;
        ctx.fillStyle = rgba(LABEL_RGB, (hovered ? 0.4 : 0.22) * curveAlpha);
        ctx.beginPath();
        ctx.arc(markerX, markerY, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = rgba(LABEL_RGB, (hovered ? 0.4 : 0.22) * curveAlpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(markerX + 3, markerY);
        ctx.lineTo(markerX + 9, markerY);
        ctx.stroke();
      }
      if (selectedCell) {
        ctx.strokeStyle = rgba(LABEL_RGB, 0.55);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    function drawSummary(matrix: MatrixView, offsetX: number, offsetY: number): void {
      if (!selected) return;
      const rowName = matrix.rows[selected.row] ?? '';
      const colName = matrix.cols[selected.col] ?? '';
      const value = displayed[selected.row]?.[selected.col] ?? 0;
      ctx.font = `${SUMMARY_FONT_PX}px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(LABEL_RGB, SUMMARY_ALPHA);
      ctx.fillText(
        `${rowName} × ${colName}    ${value.toFixed(2)}`,
        LOGICAL_W / 2 + offsetX,
        LOGICAL_H - 46 + offsetY,
      );
    }

    /** 自定义光标：全屏 1px 十字 + 22px/3px 粗准星（中心 4px 空隙）；difference 自动反色。
     *  spread 0..1：方向键移动时以光标位置为中心收拢（长度 1→0）。
     *  showFullLines=false：聚焦编辑时隐藏全屏贯穿线，只留准星（更极简）。 */
    function drawCursor(pos: { x: number; y: number }, fade: number, spread: number, showFullLines: boolean): void {
      const spreadValue = clamp(spread, 0, 1);
      if (spreadValue <= 0.002) return;
      // 对齐物理像素中心，避免 1px 线跨两行抗锯齿后 only 50% 强度（difference 会变成半灰）。
      const snappedX = (Math.floor(pos.x * scaleX) + scaleX / 2) / scaleX;
      const snappedY = (Math.floor(pos.y * scaleY) + scaleY / 2) / scaleY;
      const arm = CURSOR_ARM_PX * spreadValue;
      const gap = (CURSOR_CENTER_GAP_PX / 2) * spreadValue;
      ctx.save();
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ctx.globalCompositeOperation = 'difference';
      ctx.strokeStyle = '#ffffff';
      if (showFullLines) {
        ctx.globalAlpha = clamp(fade, 0, 1) * CURSOR_LINE_ALPHA;
        ctx.lineWidth = CURSOR_THIN_WIDTH;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(snappedX - snappedX * spreadValue, snappedY);
        ctx.lineTo(snappedX + (LOGICAL_W - snappedX) * spreadValue, snappedY);
        ctx.moveTo(snappedX, snappedY - snappedY * spreadValue);
        ctx.lineTo(snappedX, snappedY + (LOGICAL_H - snappedY) * spreadValue);
        ctx.stroke();
      }
      // 准星满强度，只有贯穿线是半透明。
      if (arm > 0.4) {
        ctx.globalAlpha = clamp(fade, 0, 1) * CURSOR_RETICLE_ALPHA;
        ctx.lineWidth = CURSOR_THICK_WIDTH;
        ctx.beginPath();
        ctx.moveTo(snappedX - arm, snappedY);
        ctx.lineTo(snappedX - Math.min(gap, arm), snappedY);
        ctx.moveTo(snappedX + Math.min(gap, arm), snappedY);
        ctx.lineTo(snappedX + arm, snappedY);
        ctx.moveTo(snappedX, snappedY - arm);
        ctx.lineTo(snappedX, snappedY - Math.min(gap, arm));
        ctx.moveTo(snappedX, snappedY + Math.min(gap, arm));
        ctx.lineTo(snappedX, snappedY + arm);
        ctx.stroke();
      }
      ctx.restore();
    }

    /** 选中曲线格 → 矩阵下方无面板曲线编辑器（淡入淡出 200ms、段点 spring）。 */
    function drawCurveEditor(matrix: MatrixView, now: number, contentAlpha: number): void {
      if (focusIsOpen()) return;
      if (curveAlpha <= 0.004 || curveBands.length < 2) return;
      const editorAlpha = clamp(contentAlpha * curveAlpha, 0, 1);
      if (editorAlpha <= 0.004) return;
      const t = clamp((now - curveFadeStart) / CURVE_EDITOR_FADE_MS, 0, 1);
      const editorScale = lerp(0.98, 1, easeOutCubic(t));
      const centerX = (CURVE_EDITOR_LEFT + CURVE_EDITOR_RIGHT) / 2;
      const centerY = (CURVE_EDITOR_TOP + CURVE_EDITOR_BOTTOM) / 2;
      ctx.save();
      ctx.globalAlpha = editorAlpha;
      ctx.translate(centerX, centerY);
      ctx.scale(editorScale, editorScale);
      ctx.translate(-centerX, -centerY);

      // 极淡曲线
      ctx.strokeStyle = rgba(LABEL_RGB, CURVE_LINE_ALPHA);
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const curveMode = curveInterpolation(matrix, selectedCurveInfo(matrix));
      if (curveMode === '阶跃') {
        traceStepPath(curveBands, CURVE_EDITOR_LEFT, CURVE_EDITOR_RIGHT, (value) => curveValueToY(value));
      } else {
        ctx.beginPath();
        for (let step = 0; step <= CURVE_EDITOR_SAMPLES; step += 1) {
          const ratio = step / CURVE_EDITOR_SAMPLES;
          const x = lerp(CURVE_EDITOR_LEFT, CURVE_EDITOR_RIGHT, ratio);
          const y = curveValueToY(
            sampleCurveBands(matrix, curveBands, ratio, curveMode, curveLoopOf(matrix, selectedCurveInfo(matrix))),
          );
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // 450ms 节点拖尾 + 播放头（显示曲线本地位置）。
      drawCurveTrail('curve', now);
      const selected = selectedCurveInfo(matrix);
      const playX = lerp(CURVE_EDITOR_LEFT, CURVE_EDITOR_RIGHT, curveDisplayPosition(matrix, selected, playhead));
      ctx.strokeStyle = rgba(LABEL_RGB, PLAYHEAD_LINE_ALPHA);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(playX, CURVE_EDITOR_TOP);
      ctx.lineTo(playX, CURVE_EDITOR_BOTTOM);
      ctx.stroke();

      // 段点（选中点更大，spring 缩放）
      const count = curveBands.length;
      for (let i = 0; i < count; i += 1) {
        const x = curvePointX(matrix, i, count);
        const y = curveValueToY(curveBands[i] ?? 0);
        const spring = curvePointScales[i];
        const scaleValue = spring?.value ?? 1;
        const radius = (i === curveSelectedIndex ? CURVE_POINT_SELECTED_RADIUS : CURVE_POINT_RADIUS) * scaleValue;
        ctx.fillStyle = rgba(LABEL_RGB, CURVE_POINT_ALPHA);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      // 播放头亮点画在段点之上，保证可见。
      const playSample = sampleCurveAt(matrix, selected, playhead);
      ctx.fillStyle = rgba(LABEL_RGB, PLAYHEAD_DOT_ALPHA);
      ctx.beginPath();
      ctx.arc(playX, curveValueToY(playSample), PLAYHEAD_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      drawCurveKeyMarks('curve', now);
      ctx.restore();
    }

    /** 聚焦编辑：中央大圆角矩形 + 大曲线（spring 放大/缩回）。 */
    function drawFocusPanel(matrix: MatrixView, now: number, contentAlpha: number): void {
      const progress = clamp(focusSpring.value, 0, 1);
      if (progress <= 0.002 || !focusCell) return;
      const panel = focusPanelRect(progress);
      const value = displayed[focusCell.row]?.[focusCell.col] ?? 0;
      const panelAlpha = clamp(contentAlpha * clamp(progress * 1.25, 0, 1), 0, 1);
      if (panelAlpha <= 0.002) return;
      ctx.save();
      ctx.globalAlpha = panelAlpha;
      // 大圆角矩形：近黑 #121212 + 极淡边。
      ctx.fillStyle = '#121212';
      ctx.beginPath();
      ctx.roundRect(panel.left, panel.top, panel.width, panel.height, panel.radius);
      ctx.fill();
      ctx.strokeStyle = rgba(LABEL_RGB, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(panel.left, panel.top, panel.width, panel.height, panel.radius);
      ctx.stroke();
      // 大曲线（progress > 0.35 才出现，避免放大中途闪烁）
      if (progress > 0.35 && focusCurveBands.length > 1) {
        const graph = focusGraphRect(progress);
        ctx.strokeStyle = rgba(LABEL_RGB, 0.55);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const focusMode = focusCurveInterpolation(matrix);
        if (focusMode === '阶跃') {
          traceStepPath(focusCurveBands, graph.left, graph.right, (value) =>
            lerp(graph.bottom, graph.top, value),
          );
        } else {
          ctx.beginPath();
          for (let step = 0; step <= CURVE_EDITOR_SAMPLES; step += 1) {
            const ratio = step / CURVE_EDITOR_SAMPLES;
            const x = lerp(graph.left, graph.right, ratio);
            const y = lerp(
              graph.bottom,
              graph.top,
              sampleCurveBands(matrix, focusCurveBands, ratio, focusMode, focusCurveLoop(matrix)),
            );
            if (step === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        // 450ms 节点拖尾（大曲线下方）+ 播放头（显示曲线本地位置）。
        drawCurveTrail('focus', now);
        const playX = lerp(graph.left, graph.right, focusCurveDisplayPosition(matrix, playhead));
        ctx.strokeStyle = rgba(LABEL_RGB, PLAYHEAD_LINE_ALPHA);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(playX, graph.top);
        ctx.lineTo(playX, graph.bottom);
        ctx.stroke();
        const count = focusCurveBands.length;
        for (let i = 0; i < count; i += 1) {
          const x = focusCurvePointX(matrix, i, count);
          const y = focusValueToY(focusCurveBands[i] ?? 0);
          const spring = focusPointScales[i];
          const scaleValue = spring?.value ?? 1;
          const radius =
            (i === focusSelectedIndex ? FOCUS_POINT_SELECTED_RADIUS : FOCUS_POINT_RADIUS) * scaleValue;
          ctx.fillStyle = rgba(LABEL_RGB, CURVE_POINT_ALPHA);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        // 聚焦播放头亮点（大曲线继续播放，显示本地位置）。
        const focusPlaySample = sampleFocusCurveAt(matrix, playhead);
        ctx.fillStyle = rgba(LABEL_RGB, PLAYHEAD_DOT_ALPHA);
        ctx.beginPath();
        ctx.arc(playX, lerp(graph.bottom, graph.top, focusPlaySample), PLAYHEAD_DOT_RADIUS + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      // 底部极淡「行 × 列」
      if (progress > 0.6) {
        const rowName = matrix.rows[focusCell.row] ?? '';
        const colName = matrix.cols[focusCell.col] ?? '';
        ctx.font = `${NAME_FONT_PX}px ${DEFAULT_SERIF}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = rgba(LABEL_RGB, NAME_ALPHA);
        ctx.fillText(`${rowName} × ${colName}`, panel.left + panel.width / 2, panel.top + panel.height - 34);
      }
      drawCurveKeyMarks('focus', now);
      ctx.restore();
      void now;
      void value;
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
      const focusRestFactor = 1 - (1 - FOCUS_REST_ALPHA) * clamp(focusSpring.value, 0, 1);

      ctx.save();
      ctx.globalAlpha = clamp(alpha * focusRestFactor, 0, 1);
      // 淡入缩放绕屏幕中心；组视差在下面按元素分别叠加（格子还要叠亮度差速）。
      ctx.translate(LOGICAL_W / 2, LOGICAL_H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-LOGICAL_W / 2, -LOGICAL_H / 2);

      // 格子：按当前显示尺寸从小到大绘制（大格后画、盖住小格）；选中描边随格一起画，不强制置顶。
      const cells: Array<{
        row: number;
        col: number;
        value: number;
        size: number;
        centerX: number;
        centerY: number;
        isSelected: boolean;
      }> = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const base = cellCenter(layout, r, c);
          const value = displayed[r]?.[c] ?? 0;
          const factor = frozenFactors?.[r]?.[c] ?? valueParallaxFactor(value);
          cells.push({
            row: r,
            col: c,
            value,
            size: cellDisplaySize(r, c, value),
            centerX: base.x + parallaxX.value * factor,
            centerY: base.y + parallaxY.value * factor,
            isSelected: selected !== null && selected.row === r && selected.col === c,
          });
        }
      }
      cells.sort((a, b) => a.size - b.size || a.row - b.row || a.col - b.col);
      for (const cell of cells) {
        const curve = curveForCell(matrix, matrix.rows[cell.row] ?? '', matrix.cols[cell.col] ?? '');
        const hovered = hover !== null && hover.row === cell.row && hover.col === cell.col;
        const curveAlpha = curve ? (curveCellAlphas.get(`${cell.row},${cell.col}`) ?? 0) : 0;
        drawCell(
          cell.centerX,
          cell.centerY,
          cell.value,
          cell.size / layout.cell,
          cell.isSelected,
          curve,
          hovered,
          matrix,
          curveAlpha,
        );
      }

      // 选中框：所有格子之后画（即使被大格盖住也能看见）；difference 白描边适配深浅底；
      // 在行列标签/矩阵名/summary/自定义光标之前。外扩 9px、线宽 2、圆角略增。
      if (selected) {
        const selectedValue = displayed[selected.row]?.[selected.col] ?? 0;
        const selectedSize = cellDisplaySize(selected.row, selected.col, selectedValue);
        const ringSize = selectedSize + SELECTION_RING_PADDING * 2;
        const radius = layout.radius + SELECTION_RING_RADIUS_EXTRA;
        ctx.save();
        ctx.globalCompositeOperation = 'difference';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = SELECTION_RING_WIDTH;
        ctx.beginPath();
        ctx.roundRect(selectionX.value - ringSize / 2, selectionY.value - ringSize / 2, ringSize, ringSize, radius);
        ctx.stroke();
        ctx.restore();
      }

      // 选中的曲线格：矩阵下方出现无面板的底部曲线编辑器。
      drawCurveEditor(matrix, now, alpha);

      // 行标签（左侧）：跟组 offset
      ctx.font = `${ROW_LABEL_FONT_PX}px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < rows; r += 1) {
        const center = cellCenter(layout, r, 0);
        const active = selected?.row === r;
        const hovering = hover?.row === r;
        ctx.fillStyle = rgba(LABEL_RGB, active ? LABEL_ACTIVE_ALPHA : hovering ? LABEL_HOVER_ALPHA : LABEL_ALPHA);
        ctx.fillText(matrix.rows[r] ?? '', layout.left - LABEL_GAP + parallaxX.value, center.y + parallaxY.value);
      }

      // 列标签（上方）：跟组 offset
      ctx.font = `${COL_LABEL_FONT_PX}px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'center';
      for (let c = 0; c < cols; c += 1) {
        const center = cellCenter(layout, 0, c);
        const active = selected?.col === c;
        const hovering = hover?.col === c;
        ctx.fillStyle = rgba(LABEL_RGB, active ? LABEL_ACTIVE_ALPHA : hovering ? LABEL_HOVER_ALPHA : LABEL_ALPHA);
        ctx.fillText(
          matrix.cols[c] ?? '',
          center.x + parallaxX.value,
          layout.top - LABEL_GAP - COL_LABEL_FONT_PX / 2 + parallaxY.value,
        );
      }

      // 左下极淡矩阵名：跟组 offset
      ctx.font = `${NAME_FONT_PX}px ${DEFAULT_SERIF}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = rgba(LABEL_RGB, NAME_ALPHA);
      ctx.fillText(matrix.name, 64 + parallaxX.value, LOGICAL_H - 46 + parallaxY.value);

      // 底部选中格：行 × 列 + 极淡数值
      drawSummary(matrix, parallaxX.value, parallaxY.value);

      // 多矩阵指示点（右下，当前略深；不显示数字）
      const total = matricesRef.current.length;
      if (total > 1) {
        const activeIndex = clamp(indexRef.current, 0, total - 1);
        const startX = LOGICAL_W - 64 - (total - 1) * 12 + parallaxX.value;
        for (let i = 0; i < total; i += 1) {
          ctx.fillStyle = rgba(LABEL_RGB, i === activeIndex ? 0.55 : 0.22);
          ctx.beginPath();
          ctx.arc(startX + i * 12, LOGICAL_H - 46 + parallaxY.value, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();

      // 聚焦编辑面板（矩阵淡到 α.12，面板画在其上）。
      drawFocusPanel(matrix, now, alpha);

      // 自定义光标画在最上层，不受矩阵视差影响（difference 反色）。
      if (cursor && cursorVisible && (cursorActive || cursorFade > 0)) {
        drawCursor(cursor, cursorFade, crosshairScale, true);
      }
    }

    /* —— 每帧 —— */
    function frame(now: number): void {
      requestId = window.requestAnimationFrame(frame);
      const dt = lastFrame > 0 ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
      lastFrame = now;

      const matrix = syncMatrix(now);
      const rows = targets.length;
      const cols = targets[0]?.length ?? 0;
      if (timingPending && (!matrix || timingPending.matrixId !== matrix.id)) timingPending = null;
      syncCurveEditor(now, matrix);
      stepCurveEditor(now, dt);
      stepFocus(now, dt);

      // 加曲线后自动聚焦；格曲线 sparkline/角标 250ms 淡入淡出。
      if (pendingFocusAfterAdd && now >= pendingFocusAt && matrix && !focusTargetActive) {
        const added = selectedCurveInfo(matrix);
        if (added && added.bands.length > 0) {
          pendingFocusAfterAdd = false;
          beginFocus(matrix, now);
        }
      }
      const curveFadeFactor = 1 - Math.exp(-dt / (CURVE_EDITOR_FADE_MS / 1000));
      if (matrix) {
        for (let r = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1) {
            const key = `${r},${c}`;
            const hasCurve = curveForCell(matrix, matrix.rows[r] ?? '', matrix.cols[c] ?? '') !== null;
            const currentAlpha = curveCellAlphas.get(key) ?? (hasCurve ? 0 : 1);
            const targetAlpha = hasCurve ? 1 : 0;
            const nextAlpha = currentAlpha + (targetAlpha - currentAlpha) * curveFadeFactor;
            if (!hasCurve && nextAlpha < 0.002) curveCellAlphas.delete(key);
            else curveCellAlphas.set(key, nextAlpha);
          }
        }
      }

      // 播放头：有 period 的矩阵与运行时 tick 同步；否则保持自由 8s 循环 + 惯性。
      const hasCurves = matrix !== null && (matrix.curves?.length ?? 0) > 0;
      const playFrozen = drag !== null || curveDrag !== null || focusDrag !== null || now < wheelFreezeUntil;
      const period =
        matrix && typeof matrix.period === 'number' && Number.isFinite(matrix.period) && matrix.period > 0
          ? matrix.period
          : null;
      const effectivePhase = matrix ? effectivePhaseOf(matrix, tickRef.current) : 0;
      pushEffectivePhase(effectivePhase);
      if (period !== null) {
        // 同步模式：目标 = (tick/period * speed + 有效相位) mod 1，约 0.35s 平滑追随。
        syncedTargetPlayhead = wrap01(
          (tickRef.current / period) * matrixTimeSpeed(matrix) + effectivePhase,
        );
        playSpeed = 0;
        if (!playFrozen && playing) {
          const delta = ((((syncedTargetPlayhead - playhead + 0.5) % 1) + 1) % 1) - 0.5;
          const factor = 1 - Math.exp(-dt / SYNCED_FOLLOW_SECONDS);
          playhead = wrap01(playhead + delta * factor);
        }
      } else {
        syncedTargetPlayhead = 0;
        const targetSpeed = hasCurves && playing ? 1 : 0;
        if (playFrozen) {
          playSpeed = 0;
        } else if (hasCurves) {
          if (targetSpeed > playSpeed) {
            playSpeed = Math.min(targetSpeed, playSpeed + dt / PLAY_ACCEL_SECONDS);
          } else if (targetSpeed < playSpeed) {
            playSpeed = Math.max(targetSpeed, playSpeed - dt / PLAY_DECEL_SECONDS);
          }
        }
        if (!hasCurves) {
          playSpeed = 0;
          playhead = 0;
        } else if (playSpeed > 0) {
          const freeRate = (dt / (PLAY_DURATION_MS / 1000)) * playSpeed * matrixTimeSpeed(matrix);
          playhead = wrap01(playhead + freeRate);
        }
      }
      pushPlayUi();
      updateCurveKeyVoices(now);
      updateCurveDragVoices(now);
      recordActiveCurveTrails(now);

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

      // 视差弹簧：光标相对屏幕中心的方向，位移与距离成比例；拖拽/滚轮/聚焦时冻结。
      const frozen = drag !== null || now < wheelFreezeUntil || focusIsOpen();
      if (frozen) {
        // 真正冻结：target 与速度都锁在当前位置，拖拽/滚轮时矩阵不漂。
        parallaxX.target = parallaxX.value;
        parallaxY.target = parallaxY.value;
        parallaxX.velocity = 0;
        parallaxY.velocity = 0;
      } else if (cursor && cursorActive) {
        parallaxX.target = (cursor.x - LOGICAL_W / 2) * PARALLAX;
        parallaxY.target = (cursor.y - LOGICAL_H / 2) * PARALLAX;
      } else {
        parallaxX.target = 0;
        parallaxY.target = 0;
      }
      parallaxX.step(dt);
      parallaxY.step(dt);
      if (frozen) {
        if (!frozenFactors) {
          frozenFactors = displayed.map((row) => row.map((value) => valueParallaxFactor(clampValue(value))));
        }
      } else {
        frozenFactors = null;
      }
      if (
        Math.abs(parallaxX.value - offsetUiNow.x) > 0.1 ||
        Math.abs(parallaxY.value - offsetUiNow.y) > 0.1
      ) {
        offsetUiNow = { x: parallaxX.value, y: parallaxY.value };
        setOffsetUi(offsetUiNow);
      }
      // 指针离开后十字线淡出。
      if (!cursorActive) cursorFade = Math.max(0, cursorFade - dt / (CURSOR_FADE_MS / 1000));
      // 十字光标收拢/展开（方向键 220ms 收拢后隐藏；鼠标再动 260ms 展开）。
      if (crosshairAnim) {
        const t = clamp((now - crosshairAnim.start) / crosshairAnim.duration, 0, 1);
        crosshairScale = lerp(crosshairAnim.from, crosshairAnim.to, easeOutCubic(t));
        if (t >= 1) {
          crosshairScale = crosshairAnim.to;
          crosshairAnim = null;
          if (crosshairScale <= 0.002) setCursorVisibleState(false);
        }
        pushCrosshairUi();
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
      const period =
        matrix && typeof matrix.period === 'number' && Number.isFinite(matrix.period) && matrix.period > 0
          ? matrix.period
          : null;
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
        cursor: cursor && cursorActive ? { x: Math.round(cursor.x * 10) / 10, y: Math.round(cursor.y * 10) / 10 } : null,
        offset: { x: Math.round(parallaxX.value * 10) / 10, y: Math.round(parallaxY.value * 10) / 10 },
        cursorVisible,
        crosshair: Math.round(crosshairScale * 1000) / 1000,
        hoverSfx: hoverSfxNow,
        navSfx: navSfxNow,
        selectedCurve:
          curveActive && curveBands.length > 0
            ? { row: curveRow, col: curveCol, bands: curveBands.map((value) => round4(value)) }
            : null,
        curveBandEdits: curveBandEditsNow,
        focus: {
          active: focusTargetActive,
          progress: Math.round(clamp(focusSpring.value, 0, 1) * 1000) / 1000,
          cell: focusCell,
          curve:
            focusTargetActive && focusCurveBands.length > 0
              ? { row: focusRow, col: focusCol, bands: focusCurveBands.map((value) => round4(value)) }
              : null,
          bandIndex: focusSelectedIndex,
        },
        focusBandEdits: focusBandEditsNow,
        playing: (matrix?.curves?.length ?? 0) > 0 ? playing : false,
        playhead: Math.round(clamp(playhead, 0, 1) * 10000) / 10000,
        playSpeed: Math.round(clamp(playSpeed, 0, 1) * 1000) / 1000,
        speed: matrixTimeSpeed(matrix),
        phase: matrixTimePhase(matrix),
        effectivePhase: matrix ? effectivePhaseOf(matrix, tickRef.current) : 0,
        phaseSource: Boolean(matrix?.phaseSource),
        interpolation: matrix?.interpolation ?? '线性',
        selectedCurveInterpolation: matrix
          ? curveInterpolation(matrix, selectedCurveInfo(matrix))
          : '线性',
        focusCurveInterpolation: matrix ? focusCurveInterpolation(matrix) : '线性',
        selectedCurveLoop: matrix ? curveLoopOf(matrix, selectedCurveInfo(matrix)) : true,
        focusCurveLoop: matrix ? focusCurveLoop(matrix) : true,
        selectedCurveSpeed: matrix ? curveSpeedOf(selectedCurveInfo(matrix)) : 1,
        selectedCurvePhase: matrix ? curvePhaseOf(selectedCurveInfo(matrix)) : 0,
        selectedCurveLocalPlayhead: matrix
          ? curveDisplayPosition(matrix, selectedCurveInfo(matrix), playhead)
          : 0,
        focusCurveSpeed: matrix ? curveSpeedOf(focusCurveInfo(matrix)) : 1,
        focusCurvePhase: matrix ? curvePhaseOf(focusCurveInfo(matrix)) : 0,
        focusCurveLocalPlayhead: matrix ? focusCurveDisplayPosition(matrix, playhead) : 0,
        tick: tickRef.current,
        curveKeyEdits: curveKeyEditsNow,
        curvePointAdds: curvePointAddsNow,
        curvePointRemoves: curvePointRemovesNow,
        matrixRowAdds: matrixRowAddsNow,
        matrixRowRemoves: matrixRowRemovesNow,
        matrixColAdds: matrixColAddsNow,
        matrixColRemoves: matrixColRemovesNow,
        matrixRenames: matrixRenamesNow,
        matrixCurveAdds: matrixCurveAddsNow,
        matrixCurveRemoves: matrixCurveRemovesNow,
        synced: period !== null,
        period,
        targetPlayhead: Math.round(clamp(syncedTargetPlayhead, 0, 1) * 10000) / 10000,
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
            const value = displayed[r]?.[c] ?? 0;
            const factor = frozenFactors?.[r]?.[c] ?? valueParallaxFactor(value);
            const dx = parallaxX.value * factor;
            const dy = parallaxY.value * factor;
            result.push({
              row: r,
              col: c,
              x: Math.round((center.x + dx) * 100) / 100,
              y: Math.round((center.y + dy) * 100) / 100,
              dx: Math.round(dx * 100) / 100,
              dy: Math.round(dy * 100) / 100,
              size: Math.round(cellDisplaySize(r, c, value) * 100) / 100,
              value: round4(value),
            });
          }
        }
        return result;
      },
      curvePositions: () => {
        const matrix = currentMatrix();
        if (!matrix || curveBands.length < 2) return [];
        const count = curveBands.length;
        return curveBands.map((value, index) => ({
          index,
          x: Math.round(curvePointX(matrix, index, count) * 100) / 100,
          y: Math.round(curveValueToY(value) * 100) / 100,
          value: round4(value),
        }));
      },
      focusCurvePositions: () => focusCurvePositionsData(),
      sampleSelectedCurve: (t: number) => {
        const matrix = currentMatrix();
        const curve = selectedCurveInfo(matrix);
        if (!matrix || !curve) return 0;
        return sampleCurveAt(matrix, curve, t);
      },
      labelPositions: () => {
        const matrix = currentMatrix();
        if (!matrix) return [];
        const result: Array<{ kind: 'row' | 'col'; index: number; x: number; y: number; width: number }> = [];
        ctx.save();
        ctx.font = `${ROW_LABEL_FONT_PX}px ${DEFAULT_SERIF}`;
        for (let r = 0; r < matrix.rows.length; r += 1) {
          const center = cellCenter(layout, r, 0);
          result.push({
            kind: 'row',
            index: r,
            x: Math.round((layout.left - LABEL_GAP + parallaxX.value) * 100) / 100,
            y: Math.round((center.y + parallaxY.value) * 100) / 100,
            width: Math.round(ctx.measureText(matrix.rows[r] ?? '').width * 100) / 100,
          });
        }
        ctx.font = `${COL_LABEL_FONT_PX}px ${DEFAULT_SERIF}`;
        for (let c = 0; c < matrix.cols.length; c += 1) {
          const center = cellCenter(layout, 0, c);
          result.push({
            kind: 'col',
            index: c,
            x: Math.round((center.x + parallaxX.value) * 100) / 100,
            y: Math.round((layout.top - LABEL_GAP - COL_LABEL_FONT_PX / 2 + parallaxY.value) * 100) / 100,
            width: Math.round(ctx.measureText(matrix.cols[c] ?? '').width * 100) / 100,
          });
        }
        ctx.restore();
        return result;
      },
      playhead: () => Math.round(clamp(playhead, 0, 1) * 10000) / 10000,
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
    document.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('blur', onPointerLeave);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
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
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      flushAllCurveKeyEdits(false);
      stopCurveGestureVoices();
      curveKeyMarks.clear();
      curveTrails.clear();
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
      data-matrix-offset={offsetAttr}
      data-cursor={cursorAttr}
      data-cursor-visible={cursorVisibleUi ? 'true' : 'false'}
      data-crosshair={crosshairUi.toFixed(2)}
      data-hover-sfx={hoverSfxUi}
      data-nav-sfx={navSfxUi}
      data-curve-count={curveCount}
      data-selected-curve={selectedCurveAttr}
      data-curve-band-edits={curveBandEditsUi}
      data-focus={focusAttr}
      data-focus-cell={focusCellUi}
      data-focus-curve={focusCurveUi}
      data-focus-band-edits={focusBandEditsUi}
      data-playing={playingUi ? 'true' : 'false'}
      data-playhead={playheadUi.toFixed(4)}
      data-play-speed={playSpeedUi.toFixed(3)}
      data-synced={syncedAttr}
      data-period={periodAttr}
      data-time-speed={timeSpeedAttr}
      data-time-phase={timePhaseAttr}
      data-phase-source={phaseSourceAttr}
      data-curve-key-edits={curveKeyEditsUi}
      data-curve-point-adds={curvePointAddsUi}
      data-curve-point-removes={curvePointRemovesUi}
      data-matrix-row-adds={matrixRowAddsUi}
      data-matrix-row-removes={matrixRowRemovesUi}
      data-matrix-col-adds={matrixColAddsUi}
      data-matrix-col-removes={matrixColRemovesUi}
      data-matrix-renames={matrixRenamesUi}
      data-matrix-curve-adds={matrixCurveAddsUi}
      data-matrix-curve-removes={matrixCurveRemovesUi}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#0a0a0a',
        touchAction: 'none',
        overflow: 'hidden',
        cursor: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', cursor: 'none' }}
      />
      {renameEditor ? (
        <input
          ref={renameInputRef}
          data-testid="matrix-rename-input"
          value={renameEditor.value}
          spellCheck={false}
          onChange={(event) =>
            setRenameEditor((previous) => (previous ? { ...previous, value: event.target.value } : previous))
          }
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              renameCommitRef.current(renameEditor.value);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              renameCancelRef.current();
            }
          }}
          onBlur={() => renameCommitRef.current(renameEditor.value)}
          style={{
            position: 'absolute',
            left: `${(renameEditor.anchorX / LOGICAL_W) * 100}%`,
            top: `${(renameEditor.anchorY / LOGICAL_H) * 100}%`,
            width: `${renameEditor.width}px`,
            transform:
              renameEditor.align === 'right'
                ? 'translate(-100%, -50%)'
                : renameEditor.align === 'center'
                  ? 'translate(-50%, -50%)'
                  : 'translateY(-50%)',
            textAlign: renameEditor.align,
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid rgba(245, 245, 245, 0.22)',
            borderRadius: 0,
            color: '#f5f5f5',
            fontFamily: DEFAULT_SERIF,
            fontSize: `${ROW_LABEL_FONT_PX}px`,
            lineHeight: 1.2,
            padding: '0 0 3px',
            margin: 0,
            outline: 'none',
            caretColor: '#f5f5f5',
            zIndex: 2,
            cursor: 'text',
            pointerEvents: 'auto',
          }}
        />
      ) : null}
    </div>
  );
}
