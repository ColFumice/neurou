/**
 * 墨晕生长 InkBloom
 * ---------------------------------------------------------------
 * 点击（视口 CSS 坐标）之后，从点处「长」出一簇湿墨：
 *   0–0.05s    种点 / 墨核 + 一团柔和墨晕，溅开几粒细墨
 *   0.05–0.85s 5–7 条主须错峰抽长（曲率、渐细、宽笔洇开），沿须带细绒
 *   0.55–0.80  生长处岔出 1–2 条细侧枝（分叉处有更黑的墨结）
 *   0.60–1.25s 须尖两波花丝绽放 + 小墨滴 / 孢子向外漂
 *   1.25–2.60s 墨化消散（主须微外扩上飘、花丝先散、墨核最后消失）
 *   2.60–2.75s 移除
 *
 * 画布透明、只画墨色（由 inverted 决定黑 / 白）——没有任何彩色。
 * 全部随机量由「spawn 序号 + 坐标」决定，同样的点击顺序可以复现同样的形状。
 *
 * 对外只有两个东西：
 *   - InkBloomHandle.spawn(x, y)  // 视口 CSS 像素
 *   - canvas.dataset.blooms / dataset.spawned  // 给验收脚本读
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import './ink-bloom.css';

export interface InkBloomHandle {
  /** 视口 CSS 像素坐标（相对窗口左上角）。 */
  spawn(x: number, y: number): void;
}

export interface InkBloomProps {
  inverted: boolean;
}

const TAU = Math.PI * 2;

/** 正常模式时间线（秒，相对簇诞生） */
const SEED_AT = 0.05;
const DISSOLVE_START = 1.25;
const DISSOLVE_END = 2.6;
const LIFE_END = 2.75;
/** prefers-reduced-motion 降级：静态 450ms + 淡出 300ms */
const RM_HOLD = 0.45;
const RM_FADE = 0.3;
const RM_LIFE_END = 0.85;
/** 同屏最多 6 簇；溢出的最旧一簇提前进入加速溶解，墨迹滞留约 380ms */
const MAX_CLUSTERS = 6;
const ACCEL_MS = 380;

const INK_DARK = '#0b0b0b';
const INK_LIGHT = '#f2f2f2';
const INK_RGB_DARK = '11, 11, 11';
const INK_RGB_LIGHT = '242, 242, 242';

/* ================================================================
   确定性随机：同样的 spawn 序号 + 坐标 → 同样的墨形，便于截图复现
   ================================================================ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(ordinal: number, x: number, y: number): number {
  let h = Math.imul(ordinal + 1, 0x9e3779b1);
  h = (h ^ Math.imul(Math.round(x * 7) + 0x27d4eb2f, 0x85ebca6b)) >>> 0;
  h = (h ^ Math.imul(Math.round(y * 13) + 0x165667b1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/* ================================================================
   几何预计算：一条须 = 一串点 + 每点宽度 + 左右笔边 + 累计弧长

   墨晕生长是「横向」的：主脊沿水平方向铺开，像墨被纸的横纹拉着走；
   上下起伏只允许 40–80px 的呼吸（峰谷），不出现长竖直主枝。
   ================================================================ */

interface BakedPath {
  xs: number[];
  ys: number[];
  ws: number[];
  /** 左右两条笔边（用宽度偏移出来，直接填充成有笔锋的墨迹） */
  lxs: number[];
  lys: number[];
  rxs: number[];
  rys: number[];
  cum: number[];
  total: number;
}

/** 由点列生成笔宽 / 弧长 / 左右笔边（填充成有笔锋的墨迹） */
function finalizePath(xs: number[], ys: number[], widthStart: number, widthEnd: number, widthSeed: number): BakedPath {
  const n = xs.length - 1;
  const ws: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n > 0 ? i / n : 0;
    // 笔锋：起笔重，收笔细；0.65 次方收得快，像一笔提起来的墨
    const taper = Math.pow(1 - t, 0.65);
    const wobble = 1 + 0.1 * Math.sin(i * 1.85 + widthSeed);
    ws.push(Math.max(0.3, widthEnd + (widthStart - widthEnd) * taper * wobble));
  }
  const cum: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const dx = xs[i]! - xs[i - 1]!;
    const dy = ys[i]! - ys[i - 1]!;
    cum.push(cum[i - 1]! + Math.hypot(dx, dy));
  }
  // 笔边：沿法线偏移半个笔宽，填充起来就是一笔有锋的墨
  const lxs: number[] = [];
  const lys: number[] = [];
  const rxs: number[] = [];
  const rys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const prev = Math.max(0, i - 1);
    const next = Math.min(n, i + 1);
    let dx = xs[next]! - xs[prev]!;
    let dy = ys[next]! - ys[prev]!;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const hw = ws[i]! * 0.5;
    lxs.push(xs[i]! - dy * hw);
    lys.push(ys[i]! + dx * hw);
    rxs.push(xs[i]! + dy * hw);
    rys.push(ys[i]! - dx * hw);
  }
  return { xs, ys, ws, lxs, lys, rxs, rys, cum, total: cum[n]! };
}

/** 把角度限制在 base ± maxSpread 内：所有副笔永远保持浅角度 */
function clampAngle(angle: number, base: number, maxSpread: number): number {
  let d = angle - base;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  if (d > maxSpread) d = maxSpread;
  else if (d < -maxSpread) d = -maxSpread;
  return base + d;
}

/**
 * 主脊：x 单调朝 side 方向铺开，y 只做上下呼吸 + 轻微整体倾斜。
 * 不会绕回来，也不会出现竖直主枝——轮廓一定是横的。
 */
function bakeSpine(
  rand: () => number,
  ox: number,
  oy: number,
  side: number,
  len: number,
  segments: number,
  widthStart: number,
  widthEnd: number,
): BakedPath {
  const xs: number[] = [ox];
  const ys: number[] = [oy];
  const waveAmp = 18 + rand() * 18; // 呼吸半幅 18–36px
  const waveFreq = 0.6 + rand() * 0.6; // 0.6–1.2 个波
  const phase = rand() * TAU;
  const sinPhase = Math.sin(phase);
  const tilt = (rand() - 0.5) * 58; // 整条脊的上扬 / 下沉（±29px）
  const fineAmp = 2 + rand() * 3;
  const finePhase = rand() * TAU;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    xs.push(ox + side * len * t);
    ys.push(
      oy +
        waveAmp * (Math.sin(TAU * waveFreq * t + phase) - sinPhase) +
        tilt * t * t +
        fineAmp * Math.sin(TAU * 3.3 * t + finePhase) * t,
    );
  }
  return finalizePath(xs, ys, widthStart, widthEnd, rand() * 10);
}

/**
 * 浅角度副笔（侧枝 / 花丝 / 绒 / 辅须）：方向限制在水平 ±maxSpread 内，
 * 只允许轻微起伏和小角度卷曲，保证整簇始终是横向展开的墨痕。
 */
function bakeShallow(
  rand: () => number,
  ox: number,
  oy: number,
  baseAngle: number,
  len: number,
  segments: number,
  maxSpread: number,
  widthStart: number,
  widthEnd: number,
): BakedPath {
  const xs: number[] = [ox];
  const ys: number[] = [oy];
  const step = len / segments;
  const offset = (rand() - 0.5) * 2 * maxSpread * 0.55;
  const waveAmp = maxSpread * (0.4 + rand() * 0.5);
  const waveFreq = 0.6 + rand() * 1.2;
  const phase = rand() * TAU;
  const curl = (rand() - 0.5) * maxSpread * 0.7;
  let x = ox;
  let y = oy;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const h = clampAngle(
      baseAngle + offset + curl * t + waveAmp * Math.sin(TAU * waveFreq * t + phase),
      baseAngle,
      maxSpread,
    );
    x += Math.cos(h) * step;
    y += Math.sin(h) * step;
    xs.push(x);
    ys.push(y);
  }
  return finalizePath(xs, ys, widthStart, widthEnd, rand() * 10);
}

interface Stroke extends BakedPath {
  t0: number;
  dur: number;
  alpha: number;
  /** 宽而低透明度的底笔（洇开）透明度；0 表示不画 */
  bleed: number;
  bands: number;
  filament: boolean;
  /** 溶解时向外扩张的比例（以起点为锚点） */
  expand: number;
  /** 溶解时上飘距离（px） */
  lift: number;
  /** 溶解时 alpha 的衰减指数：越大越先散（细花丝先散） */
  fadePow: number;
}

interface Spore {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  r: number;
  t0: number;
  lift: number;
  alpha: number;
  /** 少数墨滴残留到最后才淡出 */
  linger: boolean;
}

interface Speck {
  x: number;
  y: number;
  dx: number;
  dy: number;
  r: number;
  t0: number;
  alpha: number;
}

interface Cluster {
  x: number;
  y: number;
  bornAt: number;
  endAt: number;
  reduced: boolean;
  /** 主脊：横向分左右两拨铺开 */
  primaries: Stroke[];
  /** 从种点直接甩出的短辅须，撑起中心的一小团横向湿墨 */
  minor: Stroke[];
  /** 次级细须：水平方向补空隙 */
  secondary: Stroke[];
  branches: Stroke[];
  filaments: Stroke[];
  spores: Spore[];
  /** 种点周围溅开的小墨点 */
  specks: Speck[];
  /** 种点处几团不规则的湿墨池 */
  pools: Speck[];
  /** 落笔处横向偏移的几团墨晕，让外轮廓不规则 */
  lobes: Speck[];
  /** 雾状飞溅（更小更散，沿横向带） */
  spray: Speck[];
  /** 分叉处的墨结 */
  joints: Speck[];
  coreR: number;
  /** 加速溶解起点（ms）；0 表示未加速 */
  accelStart: number;
}

/* ================================================================
   一簇墨的诞生：一次性把点列 / 时间参数全部算好，rAF 里只画
   ================================================================ */

/** 主须长到某个弧长比例的时刻（生长用了 easeOutCubic，需反解） */
function timeAtFraction(s: Stroke, f: number): number {
  const grow = Math.max(0, Math.min(1, f));
  const p = 1 - Math.cbrt(1 - grow);
  return s.t0 + s.dur * p;
}

/** 主脊上的短绒：只做毛边，方向可以略大，但很短 */
function makeFuzz(rand: () => number, x: number, y: number, baseAngle: number, t0: number): Stroke {
  const path = bakeShallow(
    rand,
    x,
    y,
    baseAngle + (rand() - 0.5) * 1.7,
    3 + rand() * 9,
    2 + Math.floor(rand() * 2),
    0.9,
    0.24 + rand() * 0.12,
    0.18,
  );
  return {
    ...path,
    t0: t0 + 0.02 + rand() * 0.12,
    dur: 0.16 + rand() * 0.14,
    alpha: 0.3 + rand() * 0.2,
    bleed: 0,
    bands: 0,
    filament: true,
    expand: 0.04 + rand() * 0.06,
    lift: 3 + rand() * 5,
    fadePow: 2.1,
  };
}

/** 花丝：浅角度、极细，可以小角度卷，末端收尖 */
function makeFilament(rand: () => number, path: BakedPath, t0: number, strong: boolean): Stroke {
  return {
    ...path,
    t0,
    dur: 0.2 + rand() * 0.14,
    alpha: strong ? 0.46 + rand() * 0.16 : 0.34 + rand() * 0.16,
    bleed: 0,
    bands: 0,
    filament: true,
    expand: 0.05 + rand() * 0.1, // 溶解时整体 ×1.05–1.15
    lift: 6 + rand() * 12, // 上飘 6–18px
    fadePow: 1.8,
  };
}

function buildCluster(ox: number, oy: number, seed: number, reduced: boolean, bornAt: number): Cluster {
  const rnd = mulberry32(seed);
  const primarySide = rnd() < 0.5 ? -1 : 1; // 更长、更早长出来的一侧
  const nPrimary = 5 + Math.floor(rnd() * 3); // 5–7 条主须（左右两拨）
  const nLeft = nPrimary <= 5 ? 2 : 2 + Math.floor(rnd() * (nPrimary - 4));
  const nRight = nPrimary - nLeft;

  const primaries: Stroke[] = [];
  const minor: Stroke[] = [];
  const secondary: Stroke[] = [];
  const branches: Stroke[] = [];
  const filaments: Stroke[] = [];
  const spores: Spore[] = [];
  const joints: Speck[] = [];

  for (let i = 0; i < nPrimary; i++) {
    const side = i < nLeft ? -1 : 1;
    const longSide = side === primarySide;
    // 主脊长度：长侧 150–260，短侧 90–180，合起来横向约 320–520px
    const len = longSide ? 150 + Math.pow(rnd(), 0.65) * 110 : 90 + Math.pow(rnd(), 0.7) * 90;
    const seg = Math.max(16, Math.min(32, Math.round(len / 6)));
    const baseAngle = side === 1 ? 0 : Math.PI;
    const sx = ox + (rnd() - 0.5) * 8;
    const sy = oy + (rnd() - 0.5) * 30;
    const path = bakeSpine(rnd, sx, sy, side, len, seg, 3.4 + rnd() * 1.4, 0.45);
    void nRight;

    const t0 = longSide ? 0.05 + rnd() * 0.16 : 0.1 + rnd() * 0.2;
    const dur = 0.45 + rnd() * 0.17;
    const alpha = 0.7 + rnd() * 0.12;
    const bleed = 0.08 + rnd() * 0.02;
    const primary: Stroke = {
      ...path,
      t0,
      dur,
      alpha,
      bleed,
      bands: 0,
      filament: false,
      expand: 0.03 + rnd() * 0.05, // 溶解时轻微外扩 1.03–1.08
      lift: 3 + rnd() * 7, // 上飘
      fadePow: 1.15,
    };
    primaries.push(primary);

    // —— 沿主脊的细绒：只负责毛边，不改变横向轮廓 ——
    const nFuzz = 6 + Math.floor(rnd() * 4);
    for (let h = 0; h < nFuzz; h++) {
      const f = 0.12 + rnd() * 0.82;
      const at = Math.max(2, Math.min(seg - 1, Math.round(f * seg)));
      filaments.push(makeFuzz(rnd, path.xs[at]!, path.ys[at]!, baseAngle + (rnd() - 0.5) * 1.2, timeAtFraction(primary, f)));
    }

    // —— 须尖花丝：只朝水平外侧小角度卷 ——
    const tipX = path.xs[seg]!;
    const tipY = path.ys[seg]!;
    for (let f = 0; f < 4; f++) {
      const ang = baseAngle + (rnd() - 0.5) * 0.66;
      const fPath = bakeShallow(rnd, tipX, tipY, ang, 16 + rnd() * 24, 4 + Math.floor(rnd() * 2), 0.55, 0.34 + rnd() * 0.2, 0.18);
      filaments.push(makeFilament(rnd, fPath, 0.6 + rnd() * 0.26, false));
    }
    for (let f = 0; f < 2; f++) {
      const ang = baseAngle + (rnd() - 0.5) * 0.9;
      const fPath = bakeShallow(rnd, tipX, tipY, ang, 20 + rnd() * 26, 4 + Math.floor(rnd() * 2), 0.6, 0.36 + rnd() * 0.2, 0.18);
      filaments.push(makeFilament(rnd, fPath, 0.86 + rnd() * 0.28, true));
    }

    // —— 侧枝：主须长到 55–80% 时以浅角度（|θ|≤~30°）岔出 ——
    const nBranch = rnd() < 0.55 ? 2 : 1;
    for (let b = 0; b < nBranch; b++) {
      const f = 0.55 + rnd() * 0.25;
      const at = Math.max(2, Math.min(seg - 1, Math.round(f * seg)));
      const bx = path.xs[at]!;
      const by = path.ys[at]!;
      const bLen = 20 + rnd() * 45;
      const bSeg = Math.max(7, Math.min(13, Math.round(bLen / 6)));
      const bPath = bakeShallow(
        rnd,
        bx,
        by,
        baseAngle + (rnd() - 0.5) * 1.0,
        bLen,
        bSeg,
        0.5,
        Math.max(0.9, path.ws[at]! * 0.6),
        0.32,
      );
      const bT0 = timeAtFraction(primary, f) + 0.02 + rnd() * 0.06;
      const bDur = 0.24 + rnd() * 0.18;
      branches.push({
        ...bPath,
        t0: bT0,
        dur: bDur,
        alpha: alpha * 0.92,
        bleed: bleed * 0.9,
        bands: 0,
        filament: false,
        expand: 0.03 + rnd() * 0.05,
        lift: 3 + rnd() * 6,
        fadePow: 1.4,
      });
      joints.push({ x: bx, y: by, dx: 0, dy: 0, r: 1 + rnd() * 0.8, t0: bT0, alpha: 0.55 + rnd() * 0.2 });

      // 枝尖 1 根花丝（浅角）
      const bTipX = bPath.xs[bSeg]!;
      const bTipY = bPath.ys[bSeg]!;
      const fPath = bakeShallow(
        rnd,
        bTipX,
        bTipY,
        baseAngle + (rnd() - 0.5) * 0.8,
        10 + rnd() * 16,
        3 + Math.floor(rnd() * 3),
        0.6,
        0.3 + rnd() * 0.16,
        0.17,
      );
      filaments.push(makeFilament(rnd, fPath, Math.min(1.2, bT0 + bDur + 0.04 + rnd() * 0.16), false));
    }
  }

  // —— 次级细须：水平方向的短笔，填补左右两侧的空隙 ——
  const nSecondary = 10 + Math.floor(rnd() * 3);
  for (let i = 0; i < nSecondary; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const baseAngle = side === 1 ? 0 : Math.PI;
    const len = 30 + rnd() * 90;
    const seg = Math.max(8, Math.min(15, Math.round(len / 6)));
    const path = bakeShallow(
      rnd,
      ox + (rnd() - 0.5) * 4,
      oy + (rnd() - 0.5) * 10,
      baseAngle + (rnd() - 0.5) * 0.5,
      len,
      seg,
      0.42,
      1.1 + rnd() * 0.9,
      0.28,
    );
    const t0 = 0.1 + rnd() * 0.3;
    const dur = 0.38 + rnd() * 0.2;
    const alpha = 0.5 + rnd() * 0.18;
    const stroke: Stroke = {
      ...path,
      t0,
      dur,
      alpha,
      bleed: 0.06 + rnd() * 0.03,
      bands: 0,
      filament: false,
      expand: 0.03 + rnd() * 0.05,
      lift: 3 + rnd() * 6,
      fadePow: 1.3,
    };
    secondary.push(stroke);

    const nFuzz = 2 + Math.floor(rnd() * 2);
    for (let h = 0; h < nFuzz; h++) {
      const f = 0.25 + rnd() * 0.65;
      const at = Math.max(1, Math.min(seg - 1, Math.round(f * seg)));
      filaments.push(makeFuzz(rnd, path.xs[at]!, path.ys[at]!, baseAngle + (rnd() - 0.5) * 1.2, timeAtFraction(stroke, f)));
    }
    const nT = 1 + (rnd() < 0.5 ? 1 : 0);
    for (let f = 0; f < nT; f++) {
      const ang = baseAngle + (rnd() - 0.5) * 0.7;
      const fPath = bakeShallow(rnd, path.xs[seg]!, path.ys[seg]!, ang, 10 + rnd() * 18, 3 + Math.floor(rnd() * 3), 0.55, 0.3 + rnd() * 0.16, 0.17);
      filaments.push(makeFilament(rnd, fPath, 0.7 + rnd() * 0.42, false));
    }
  }

  // —— 短辅须：种点附近甩出的水平短笔，中心是一小团横向湿墨 ——
  const nMinor = 10 + Math.floor(rnd() * 3);
  for (let i = 0; i < nMinor; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const baseAngle = side === 1 ? 0 : Math.PI;
    const len = 18 + rnd() * 62;
    const seg = Math.max(5, Math.min(11, Math.round(len / 5.5)));
    const path = bakeShallow(
      rnd,
      ox + (rnd() - 0.5) * 3,
      oy + (rnd() - 0.5) * 8,
      baseAngle + (rnd() - 0.5) * 0.7,
      len,
      seg,
      0.5,
      1.2 + rnd() * 1,
      0.26,
    );
    const t0 = 0.08 + rnd() * 0.3;
    const dur = 0.32 + rnd() * 0.2;
    const alpha = 0.48 + rnd() * 0.2;
    const stroke: Stroke = {
      ...path,
      t0,
      dur,
      alpha,
      bleed: 0.055 + rnd() * 0.03,
      bands: 0,
      filament: false,
      expand: 0.03 + rnd() * 0.05,
      lift: 3 + rnd() * 6,
      fadePow: 1.35,
    };
    minor.push(stroke);

    const nFuzz = 1 + (rnd() < 0.5 ? 1 : 0);
    for (let h = 0; h < nFuzz; h++) {
      const f = 0.3 + rnd() * 0.6;
      const at = Math.max(1, Math.min(seg - 1, Math.round(f * seg)));
      filaments.push(makeFuzz(rnd, path.xs[at]!, path.ys[at]!, baseAngle + (rnd() - 0.5) * 1.1, timeAtFraction(stroke, f)));
    }
    const ang = baseAngle + (rnd() - 0.5) * 0.8;
    const fPath = bakeShallow(rnd, path.xs[seg]!, path.ys[seg]!, ang, 8 + rnd() * 14, 3 + Math.floor(rnd() * 3), 0.55, 0.28 + rnd() * 0.16, 0.16);
    filaments.push(makeFilament(rnd, fPath, 0.66 + rnd() * 0.4, false));
  }

  // —— 孢子 / 小墨滴：主要沿水平方向缓缓向外漂（可轻微上飘） ——
  const hosts: Stroke[] = [...primaries, ...branches];
  const nSpore = 6 + Math.floor(rnd() * 4);
  for (let s = 0; s < nSpore; s++) {
    const host = hosts[Math.floor(rnd() * hosts.length)]!;
    const last = host.xs.length - 1;
    const tipX = host.xs[last]!;
    const tipY = host.ys[last]!;
    const out = tipX >= host.xs[0]! ? 1 : -1;
    const drift = out === 1 ? 0 : Math.PI;
    const ang = drift + (rnd() - 0.5) * 0.34; // 只允许 ±10°
    spores.push({
      x: tipX + Math.cos(drift) * (2 + rnd() * 7),
      y: tipY + (rnd() - 0.5) * 6,
      dirX: Math.cos(ang),
      dirY: Math.sin(ang),
      speed: 14 + rnd() * 20,
      r: s < 2 ? 1.7 + rnd() * 0.8 : 0.9 + rnd() * 1.3,
      t0: 0.62 + rnd() * 0.55,
      lift: 8 + rnd() * 14,
      alpha: 0.7 + rnd() * 0.2,
      linger: s < 2 || rnd() < 0.25,
    });
  }

  // —— 种点周围溅开的小墨点（落笔的溅射） ——
  const specks: Speck[] = [];
  const nSpeck = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < nSpeck; i++) {
    const a = rnd() * TAU;
    const d = 3 + rnd() * 16;
    specks.push({
      x: ox + Math.cos(a) * d,
      y: oy + Math.sin(a) * d * 0.5, // 溅射也偏横向
      dx: Math.cos(a) * (1.2 + rnd() * 2.6),
      dy: Math.sin(a) * (0.6 + rnd() * 1.2),
      r: 0.7 + rnd() * 1.1,
      t0: 0.02 + rnd() * 0.12,
      alpha: 0.45 + rnd() * 0.3,
    });
  }

  // —— 种点处几团不规则的湿墨池 ——
  const pools: Speck[] = [];
  const nPool = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nPool; i++) {
    pools.push({
      x: ox + (rnd() - 0.5) * 30,
      y: oy + (rnd() - 0.5) * 14,
      dx: 0,
      dy: 0,
      r: 8 + rnd() * 13,
      t0: 0.01 + rnd() * 0.05,
      alpha: 0.09 + rnd() * 0.05,
    });
  }

  // —— 落笔处横向偏移的墨晕，让横向轮廓不规则 ——
  const lobes: Speck[] = [];
  const nLobe = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nLobe; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    lobes.push({
      x: ox + side * (16 + rnd() * 34),
      y: oy + (rnd() - 0.5) * 22,
      dx: 0,
      dy: 0,
      r: 20 + rnd() * 22,
      t0: 0.06 + rnd() * 0.3,
      alpha: 0.04 + rnd() * 0.03,
    });
  }

  // —— 更细的雾状飞溅：前后两小圈，都在横向带内 ——
  const spray: Speck[] = [];
  const nSpray = 11 + Math.floor(rnd() * 6);
  for (let i = 0; i < nSpray; i++) {
    const late = i >= Math.round(nSpray * 0.55);
    const side = rnd() < 0.5 ? -1 : 1;
    spray.push({
      x: ox + side * (late ? 46 + rnd() * 82 : 20 + rnd() * 70),
      y: oy + (rnd() - 0.5) * 64,
      dx: side * (2 + rnd() * 5),
      dy: (rnd() - 0.5) * 2,
      r: 0.4 + rnd() * 0.7,
      t0: late ? 0.8 + rnd() * 0.4 : 0.05 + rnd() * 0.3,
      alpha: 0.2 + rnd() * 0.26,
    });
  }

  return {
    x: ox,
    y: oy,
    bornAt,
    endAt: bornAt + (reduced ? RM_LIFE_END * 1000 : LIFE_END * 1000),
    reduced,
    primaries,
    minor,
    secondary,
    branches,
    filaments,
    spores,
    specks,
    pools,
    lobes,
    spray,
    joints,
    coreR: 2.2 + rnd() * 1.8, // 2.2–4px 墨核
    accelStart: 0,
  };
}

/* ================================================================
   绘制
   ================================================================ */

interface Cut {
  idx: number;
  ex: number;
  ey: number;
}

function cutAt(path: BakedPath, dist: number): Cut {
  const n = path.xs.length;
  const last = n - 1;
  if (dist >= path.total) return { idx: last, ex: path.xs[last]!, ey: path.ys[last]! };
  let i = 1;
  while (i < n - 1 && path.cum[i]! < dist) i++;
  const prev = i - 1;
  const seg = path.cum[i]! - path.cum[prev]! || 1;
  const t = Math.max(0, Math.min(1, (dist - path.cum[prev]!) / seg));
  return {
    idx: prev,
    ex: path.xs[prev]! + (path.xs[i]! - path.xs[prev]!) * t,
    ey: path.ys[prev]! + (path.ys[i]! - path.ys[prev]!) * t,
  };
}

function clusterFade(c: Cluster, now: number): number {
  const age = (now - c.bornAt) / 1000;
  let fade: number;
  if (c.reduced) {
    fade = age <= RM_HOLD ? 1 : Math.max(0, 1 - (age - RM_HOLD) / RM_FADE);
  } else if (age <= DISSOLVE_START) {
    fade = 1;
  } else {
    const p = Math.min(1, (age - DISSOLVE_START) / (DISSOLVE_END - DISSOLVE_START));
    // alpha 缓出下降：先快后慢，最后一层薄雾慢慢散掉
    fade = Math.pow(1 - p, 2.6);
  }
  if (c.accelStart > 0) {
    const q = Math.min(1, Math.max(0, (now - c.accelStart) / ACCEL_MS));
    fade *= Math.pow(1 - q, 2);
  }
  return Math.max(0, Math.min(1, fade));
}

/**
 * 一笔墨：预计算好的左右笔边直接填充成有笔锋的实心笔画（起笔粗、收笔尖），
 * 下面叠一条更宽的极淡底笔做洇开；细须（花丝 / 绒）退化为一条线。
 * 溶解阶段（dr→1）所有须以起点为锚点微外扩、上飘，宽笔继续变宽变淡。
 */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  age: number,
  fade: number,
  dr: number,
  reduced: boolean,
  ink: string,
): void {
  const raw = reduced ? 1 : (age - s.t0) / s.dur;
  if (raw <= 0) return;
  const p = Math.min(1, raw);
  const grow = reduced ? 1 : 1 - Math.pow(1 - p, 3);
  const dist = s.total * grow;
  if (dist <= 0.01) return;
  const cut = cutAt(s, dist);
  const tipIdx = s.xs.length - 1;
  const idx = cut.idx;

  // 溶解阶段：所有须以各自起点为锚点轻微外扩 + 上飘（花丝扩得更多）
  const active = !reduced;
  const scale = active ? 1 + s.expand * dr : 1;
  const lift = active ? s.lift * dr : 0;
  const ax = s.xs[0]!;
  const ay = s.ys[0]!;
  const tx = (x: number): number => (active ? ax + (x - ax) * scale : x);
  const ty = (y: number): number => (active ? ay + (y - ay) * scale - lift : y);
  const ex = cut.ex;
  const ey = cut.ey;

  const reveal = reduced ? 1 : Math.min(1, p * 9);
  const bodyA = Math.min(1, s.alpha * Math.pow(fade, s.fadePow) * reveal);
  // 宽笔（洇开）比笔芯散得慢，最后留下一层雾
  const bleedA = s.bleed > 0 ? s.bleed * Math.pow(fade, 0.45) * reveal : 0;
  if (bodyA <= 0.003 && bleedA <= 0.003) return;

  // 当前笔尖处的半宽与法线（用于把多边形收口）
  const pIdx = Math.min(idx + 1, tipIdx);
  const hw = ((s.ws[idx]! + s.ws[pIdx]!) * 0.5) * 0.5;
  let sdx = s.xs[pIdx]! - s.xs[idx]!;
  let sdy = s.ys[pIdx]! - s.ys[idx]!;
  if (sdx === 0 && sdy === 0) {
    sdx = s.xs[tipIdx]! - s.xs[tipIdx - 1]!;
    sdy = s.ys[tipIdx]! - s.ys[tipIdx - 1]!;
  }
  const sl = Math.hypot(sdx, sdy) || 1;
  const nx = -sdy / sl;
  const ny = sdx / sl;

  const wide = s.ws[0]! > 0.75;

  // 宽笔洇开：沿中线的宽而淡的一层（溶解时更宽更淡）
  if (bleedA > 0.003 && wide) {
    ctx.beginPath();
    ctx.moveTo(tx(s.xs[0]!), ty(s.ys[0]!));
    for (let i = 1; i <= idx; i++) ctx.lineTo(tx(s.xs[i]!), ty(s.ys[i]!));
    ctx.lineTo(tx(ex), ty(ey));
    let wsum = 0;
    for (let i = 0; i <= idx; i++) wsum += s.ws[i]!;
    ctx.lineWidth = Math.max(0.9, (wsum / (idx + 1)) * 3 * (1 + 0.8 * dr));
    ctx.strokeStyle = ink;
    ctx.globalAlpha = bleedA;
    ctx.stroke();
  }

  if (bodyA <= 0.003) return;

  if (!wide) {
    // 细须（花丝 / 绒）：一条线足够
    ctx.beginPath();
    ctx.moveTo(tx(s.xs[0]!), ty(s.ys[0]!));
    for (let i = 1; i <= idx; i++) ctx.lineTo(tx(s.xs[i]!), ty(s.ys[i]!));
    ctx.lineTo(tx(ex), ty(ey));
    let wsum = 0;
    for (let i = 0; i <= idx; i++) wsum += s.ws[i]!;
    ctx.lineWidth = Math.max(0.2, wsum / (idx + 1));
    ctx.strokeStyle = ink;
    ctx.globalAlpha = bodyA;
    ctx.stroke();
  } else {
    const poly = (f: number): void => {
      ctx.beginPath();
      const l0x = s.xs[0]! + (s.lxs[0]! - s.xs[0]!) * f;
      const l0y = s.ys[0]! + (s.lys[0]! - s.ys[0]!) * f;
      ctx.moveTo(tx(l0x), ty(l0y));
      for (let i = 1; i <= idx; i++) {
        const x = s.xs[i]! + (s.lxs[i]! - s.xs[i]!) * f;
        const y = s.ys[i]! + (s.lys[i]! - s.ys[i]!) * f;
        ctx.lineTo(tx(x), ty(y));
      }
      ctx.lineTo(tx(ex + nx * hw * f), ty(ey + ny * hw * f));
      ctx.lineTo(tx(ex - nx * hw * f), ty(ey - ny * hw * f));
      for (let i = idx; i >= 0; i--) {
        const x = s.xs[i]! + (s.rxs[i]! - s.xs[i]!) * f;
        const y = s.ys[i]! + (s.rys[i]! - s.ys[i]!) * f;
        ctx.lineTo(tx(x), ty(y));
      }
      ctx.closePath();
    };

    ctx.fillStyle = ink;
    // 柔边（更宽更淡）→ 墨色主体；边缘自然是软的
    poly(1.85);
    ctx.globalAlpha = bodyA * 0.24;
    ctx.fill();
    poly(1);
    ctx.globalAlpha = bodyA;
    ctx.fill();

    // 粗笔加一道更窄更黑的骨线：边缘柔、骨力在中间
    if (s.ws[0]! > 1.2 && !s.filament) {
      ctx.beginPath();
      ctx.moveTo(tx(s.xs[0]!), ty(s.ys[0]!));
      for (let i = 1; i <= idx; i++) ctx.lineTo(tx(s.xs[i]!), ty(s.ys[i]!));
      ctx.lineTo(tx(ex), ty(ey));
      ctx.lineWidth = Math.max(0.3, s.ws[0]! * 0.3);
      ctx.strokeStyle = ink;
      ctx.globalAlpha = Math.min(1, bodyA * 1.12);
      ctx.stroke();
    }
  }

  // 生长中的笔尖有一小滴墨，像被拖出来的
  if (!reduced && !s.filament && p < 0.999) {
    ctx.globalAlpha = Math.min(0.6, bodyA + 0.22);
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(tx(ex), ty(ey), 1.2, 0, TAU);
    ctx.fill();
  }
}

function drawCluster(ctx: CanvasRenderingContext2D, c: Cluster, now: number, inverted: boolean): void {
  const age = (now - c.bornAt) / 1000;
  const fade = clusterFade(c, now);
  if (fade <= 0.004) return;
  const reduced = c.reduced;
  const dr = reduced
    ? Math.max(0, Math.min(1, (age - RM_HOLD) / RM_FADE))
    : Math.max(0, Math.min(1, (age - DISSOLVE_START) / (DISSOLVE_END - DISSOLVE_START)));
  const ink = inverted ? INK_LIGHT : INK_DARK;
  const inkRgb = inverted ? INK_RGB_LIGHT : INK_RGB_DARK;
  const appear = reduced ? 1 : Math.min(1, age / SEED_AT);
  // reduced-motion 下所有「漂移 / 外扩」都冻结，只保留整体淡出
  const motion = reduced ? 0 : dr;

  // 种点墨晕：落笔时先扩散（半径 20→46），随后随整簇散掉
  const spread = reduced ? 1 : 1 - Math.pow(1 - Math.min(1, age / 1.05), 3);
  const haloR = 20 + spread * 26 + motion * 12;
  const haloA = (0.06 + 0.025 * appear) * Math.pow(fade, 0.8) * appear;
  if (haloA > 0.003) {
    const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, haloR);
    grad.addColorStop(0, `rgba(${inkRgb}, ${(haloA * 1.5).toFixed(4)})`);
    grad.addColorStop(0.22, `rgba(${inkRgb}, ${(haloA * 0.95).toFixed(4)})`);
    grad.addColorStop(0.52, `rgba(${inkRgb}, ${(haloA * 0.4).toFixed(4)})`);
    grad.addColorStop(0.78, `rgba(${inkRgb}, ${(haloA * 0.12).toFixed(4)})`);
    grad.addColorStop(1, `rgba(${inkRgb}, 0)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.fillRect(c.x - haloR, c.y - haloR, haloR * 2, haloR * 2);
  }

  // 落笔偏移的几团墨晕：慢慢铺开，像墨在纸里洇
  for (const l of c.lobes) {
    const t = age - l.t0;
    if (!reduced && t <= 0) continue;
    const a = l.alpha * Math.min(1, t / 0.25) * Math.pow(fade, 0.85);
    if (a <= 0.003) continue;
    const lr = l.r * (1 + 0.35 * motion);
    const lob = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, lr);
    lob.addColorStop(0, `rgba(${inkRgb}, ${a.toFixed(4)})`);
    lob.addColorStop(0.6, `rgba(${inkRgb}, ${(a * 0.5).toFixed(4)})`);
    lob.addColorStop(1, `rgba(${inkRgb}, 0)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = lob;
    ctx.fillRect(l.x - lr, l.y - lr, lr * 2, lr * 2);
  }

  // 种点处不规则的湿墨：几团叠在一起，先扩散再随整簇散掉
  for (const p of c.pools) {
    const t = age - p.t0;
    if (!reduced && t <= 0) continue;
    const a = p.alpha * Math.min(1, t / 0.12) * Math.pow(fade, 0.95);
    if (a <= 0.003) continue;
    const pr = p.r * (1 + 0.55 * motion);
    const pool = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pr);
    pool.addColorStop(0, `rgba(${inkRgb}, ${a.toFixed(4)})`);
    pool.addColorStop(0.6, `rgba(${inkRgb}, ${(a * 0.55).toFixed(4)})`);
    pool.addColorStop(1, `rgba(${inkRgb}, 0)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pool;
    ctx.fillRect(p.x - pr, p.y - pr, pr * 2, pr * 2);
  }

  ctx.fillStyle = ink;

  // 雾状飞溅：落笔瞬间散开，随后慢慢淡掉
  for (const sp of c.spray) {
    const t = age - sp.t0;
    if (!reduced && t <= 0) continue;
    const pop = reduced ? 1 : Math.min(1, t / 0.16);
    const px = sp.x + sp.dx * Math.min(t, 1.4);
    const py = sp.y + sp.dy * Math.min(t, 1.4) - 3 * motion;
    const a = sp.alpha * pop * Math.pow(fade, 0.7);
    if (a <= 0.004) continue;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(px, py, sp.r * (0.6 + 0.4 * pop), 0, TAU);
    ctx.fill();
  }

  // 种点溅开的小墨点
  for (const sp of c.specks) {
    const t = age - sp.t0;
    if (!reduced && t <= 0) continue;
    const pop = reduced ? 1 : Math.min(1, t / 0.12);
    const px = sp.x + sp.dx * Math.min(t, 1.2);
    const py = sp.y + sp.dy * Math.min(t, 1.2) - 4 * motion;
    const a = sp.alpha * pop * Math.pow(fade, 0.8);
    if (a <= 0.004) continue;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(px, py, sp.r * (0.6 + 0.4 * pop), 0, TAU);
    ctx.fill();
  }

  for (const s of c.minor) drawStroke(ctx, s, age, fade, dr, reduced, ink);
  for (const s of c.secondary) drawStroke(ctx, s, age, fade, dr, reduced, ink);
  for (const s of c.primaries) drawStroke(ctx, s, age, fade, dr, reduced, ink);
  for (const j of c.joints) {
    const t = age - j.t0;
    if (!reduced && t <= 0) continue;
    const a = j.alpha * Math.min(1, t / 0.1) * Math.pow(fade, 1.2);
    if (a <= 0.004) continue;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(j.x, j.y - 2 * dr, j.r, 0, TAU);
    ctx.fill();
  }
  for (const s of c.branches) drawStroke(ctx, s, age, fade, dr, reduced, ink);
  for (const s of c.filaments) drawStroke(ctx, s, age, fade, dr, reduced, ink);

  // 孢子 / 小墨滴：先向外漂，溶解时随雾上飘消散；个别残留到最后
  for (const sp of c.spores) {
    const t = age - sp.t0;
    if (!reduced && t <= 0) continue;
    const pop = reduced ? 1 : Math.min(1, t / 0.18);
    const driftT = reduced ? 0 : Math.min(t, 1.8);
    const px = sp.x + sp.dirX * sp.speed * driftT;
    const py = sp.y + sp.dirY * sp.speed * driftT - sp.lift * motion;
    const a = sp.alpha * pop * Math.pow(fade, sp.linger ? 0.3 : 0.85);
    if (a <= 0.004) continue;
    const r = sp.r * (0.55 + 0.45 * pop) * (1 - 0.22 * motion);
    ctx.fillStyle = ink;
    if (sp.r > 1.25) {
      ctx.globalAlpha = a * 0.1;
      ctx.beginPath();
      ctx.arc(px, py, r * 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fill();
  }

  // 落笔中心的湿墨：一小团更黑的墨池，最后才散
  const poolA = 0.18 * appear * Math.pow(fade, 1.1);
  if (poolA > 0.003) {
    const poolR = c.coreR * 3.8 * (1 + 0.4 * motion);
    const pool = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, poolR);
    pool.addColorStop(0, `rgba(${inkRgb}, ${(poolA * 1.6).toFixed(4)})`);
    pool.addColorStop(0.55, `rgba(${inkRgb}, ${(poolA * 0.7).toFixed(4)})`);
    pool.addColorStop(1, `rgba(${inkRgb}, 0)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pool;
    ctx.fillRect(c.x - poolR, c.y - poolR, poolR * 2, poolR * 2);
  }

  // 墨核：最先出现，最后 150ms 才消失
  const coreFade = reduced ? fade : Math.pow(Math.max(0, 1 - dr), 0.85);
  const coreA = 0.85 * appear * coreFade;
  if (coreA > 0.004) {
    const r = c.coreR * (0.5 + 0.5 * appear) * (1 + 0.12 * motion);
    ctx.fillStyle = ink;
    ctx.globalAlpha = coreA;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = Math.min(1, coreA * 0.9);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 0.55, 0, TAU);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

/* ================================================================
   引擎：canvas 尺寸 / rAF / 簇生命周期 / dataset 指标
   ================================================================ */

interface BloomEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr: number;
  cssW: number;
  cssH: number;
  inverted: boolean;
  reduced: boolean;
  clusters: Cluster[];
  /** 溢出时被提前溶解的最旧簇：不再计入 blooms，但墨迹继续淡出 */
  ghosts: Cluster[];
  spawned: number;
  raf: number;
  spawn: (viewportX: number, viewportY: number) => void;
  setInverted: (value: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

function syncData(eng: BloomEngine): void {
  const blooms = String(eng.clusters.length);
  const spawned = String(eng.spawned);
  if (eng.canvas.dataset.blooms !== blooms) eng.canvas.dataset.blooms = blooms;
  if (eng.canvas.dataset.spawned !== spawned) eng.canvas.dataset.spawned = spawned;
}

function createEngine(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): BloomEngine {
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)');

  const eng: BloomEngine = {
    canvas,
    ctx,
    dpr: 1,
    cssW: 0,
    cssH: 0,
    inverted: false,
    reduced: mql.matches,
    clusters: [],
    ghosts: [],
    spawned: 0,
    raf: 0,
    spawn: () => undefined,
    setInverted: () => undefined,
    resize: () => undefined,
    dispose: () => undefined,
  };

  // 窗宽变化：重建画布尺寸，保留正在消散的墨晕（坐标是视口坐标，墨迹会
  // 继续按原轨迹消散；一簇活不过 2.75s，不值得做缩放重排）。
  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || canvas.clientWidth || window.innerWidth || 1));
    const h = Math.max(1, Math.round(rect.height || canvas.clientHeight || window.innerHeight || 1));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (w === eng.cssW && h === eng.cssH && dpr === eng.dpr) return;
    eng.cssW = w;
    eng.cssH = h;
    eng.dpr = dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (eng.clusters.length + eng.ghosts.length === 0) ctx.clearRect(0, 0, w, h);
  };

  const loop = (now: number): void => {
    eng.raf = 0;
    const { cssW, cssH, dpr } = eng;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.clearRect(0, 0, cssW, cssH);

    const inverted = eng.inverted;
    for (const c of eng.clusters) drawCluster(ctx, c, now, inverted);
    for (const c of eng.ghosts) drawCluster(ctx, c, now, inverted);

    eng.clusters = eng.clusters.filter((c) => now < c.endAt);
    eng.ghosts = eng.ghosts.filter((c) => now < c.endAt);
    ctx.globalAlpha = 1;
    syncData(eng);

    if (eng.clusters.length + eng.ghosts.length > 0) {
      eng.raf = requestAnimationFrame(loop);
    } else {
      // 收尾：清空画布，读像素时保证完全透明
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      syncData(eng);
    }
  };

  const spawn = (viewportX: number, viewportY: number): void => {
    const rect = canvas.getBoundingClientRect();
    const x = viewportX - rect.left;
    const y = viewportY - rect.top;
    eng.spawned += 1;
    const now = performance.now();
    const cluster = buildCluster(x, y, seedFor(eng.spawned, viewportX, viewportY), eng.reduced, now);

    // 同屏最多 6 簇：溢出的最旧一簇转为加速溶解的「墨迹」，
    // 不硬切、不占 blooms 名额。
    if (eng.clusters.length >= MAX_CLUSTERS) {
      const victim = eng.clusters.shift();
      if (victim) {
        victim.accelStart = now;
        victim.endAt = Math.min(victim.endAt, now + ACCEL_MS + 20);
        eng.ghosts.push(victim);
      }
    }
    eng.clusters.push(cluster);
    syncData(eng);
    if (!eng.raf) eng.raf = requestAnimationFrame(loop);
  };

  const onMql = (): void => {
    eng.reduced = mql.matches;
  };
  const onResize = (): void => {
    resize();
  };

  eng.resize = resize;
  eng.spawn = spawn;
  eng.setInverted = (value: boolean): void => {
    eng.inverted = value;
  };
  eng.dispose = (): void => {
    if (eng.raf) cancelAnimationFrame(eng.raf);
    eng.raf = 0;
    window.removeEventListener('resize', onResize);
    mql.removeEventListener('change', onMql);
    eng.clusters = [];
    eng.ghosts = [];
    eng.spawned = 0;
    eng.canvas.dataset.blooms = '0';
    eng.canvas.dataset.spawned = '0';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1;
    canvas.height = 1;
  };

  window.addEventListener('resize', onResize);
  mql.addEventListener('change', onMql);
  resize();
  canvas.dataset.blooms = '0';
  canvas.dataset.spawned = '0';
  return eng;
}

/* ================================================================
   React 包装
   ================================================================ */

export const InkBloom = forwardRef<InkBloomHandle, InkBloomProps>(function InkBloom({ inverted }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<BloomEngine | null>(null);
  const invertedRef = useRef(inverted);
  invertedRef.current = inverted;

  // StrictMode 会 mount → cleanup → mount：cleanup 里必须取消 rAF、
  // 移除 resize / media 监听并清空状态，否则会跑出双份动画。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const engine = createEngine(canvas, ctx);
    engine.setInverted(invertedRef.current);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setInverted(inverted);
  }, [inverted]);

  useImperativeHandle(
    ref,
    () => ({
      spawn: (x: number, y: number) => {
        engineRef.current?.spawn(x, y);
      },
    }),
    [],
  );

  return <canvas ref={canvasRef} className="ink-bloom" data-testid="ink-blooms" aria-hidden="true" />;
});
