/**
 * 八弦调律台 v1.1 验收：GUI 接回真实世界 + 写回 + 阈值编辑 + 任意世界/同类多根弦。
 *
 * 核心断言：
 *   - 8 根弦的值来自 examples/tuner.nro 的运行时，而不是本地演示数据；
 *   - 拖弦/拨弦通过 Universe.inject 写回世界，下一拍沿耦合传导；
 *   - 世界的逐拍变化会变成弦上的视觉波；
 *   - 共振点 = 接近悬崖/安全阈值，而不是预设的数字；
 *   - 阈值可拖、写回有编译闸门、Ctrl+Z 可撤销；
 *   - `?world=` 打开任意示例世界，写回目标跟随；同类多根弦用左右方向键切换。
 *
 * 运行：node scripts/gui-test.mjs（需要 127.0.0.1:5188 的 dev server）
 * 结果：artifacts/string-test.json + artifacts/9x-*.png
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const URL = 'http://127.0.0.1:5188/';
const WORLD_PATH = 'examples/tuner.nro';
const TEMP_TUNER = 'examples/_acceptance-tuner.nro';
const TEMP_TWO = 'examples/_acceptance-two.nro';
const TEMP_FILES = [TEMP_TUNER, TEMP_TWO];
const TWO_WORLD_SOURCE = `世界 双弦测试
  版本 0.1

实体 对手
  是 角色

叙事弦 甲
  类型 数值 0..100
  基线 40
  悬崖 20
  安全 80

叙事弦 乙
  类型 数值 0..100
  基线 70
  悬崖 20
  安全 82

关系弦 丙
  类型 数值 0..1
  基线 0.5
  悬崖 0.8
  安全 0.2
  对象 对手
`;
const cleanupTempFiles = () => {
  for (const file of TEMP_FILES) {
    try {
      unlinkSync(file);
    } catch {
      /* 不存在就算了 */
    }
  }
};
process.on('exit', cleanupTempFiles);
const gitRestoreWorld = () => {
  try {
    execFileSync('git', ['checkout', '--', WORLD_PATH], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
// 自愈：如果上次验收把 tuner.nro 写脏了，先用 git 恢复干净基线，保证验收可重复。
gitRestoreWorld();
const worldBackup = readFileSync(WORLD_PATH, 'utf8');
const restoreWorld = () => {
  if (gitRestoreWorld()) return;
  try {
    writeFileSync(WORLD_PATH, worldBackup, 'utf8');
  } catch {
    /* ignore */
  }
};
process.on('exit', restoreWorld);

const results = [];
const consoleErrors = [];

const parseTrustBaseline = (text) => {
  // 兼容 Windows autocrlf 读出来的 CRLF 与写回的 LF。
  const match = /叙事弦 信任\r?\n(?:[^\r\n]*\r?\n)*?  基线 ([\d.]+)/.exec(text);
  return match ? Number(match[1]) : NaN;
};
const commentCount = (text) => text.split(/\r?\n/).filter((line) => /^\s*#/.test(line)).length;
const originalCommentCount = commentCount(worldBackup);

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// 与 examples/tuner.nro 一致：8 类弦各一根（KIND_ORDER 顺序）。
const VALUES = [55, 64, 50, 72, 44, 36, 28, 0.58];
const NAMES = ['信任', '色温', '步态', '重力', '灵敏度', '连通', '知情', '恐惧'];
const KINDS = ['叙事', '视觉', '动画', '物理', '控制', '空间', '认知', '关系'];
const VALUE_TOP = 110;
const VALUE_BOTTOM = 790;
const RANGES = [
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 1],
];
const valueToY = (value, i) => {
  const [min, max] = RANGES[i];
  const norm = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  return VALUE_BOTTOM - norm * (VALUE_BOTTOM - VALUE_TOP);
};
const normOf = (value, i) => {
  const [min, max] = RANGES[i];
  return Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
};

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(900);

const field = page.locator('[data-testid="string-field"]');
const app = page.locator('[data-testid="ink-app"]');
const attr = async (name) => field.getAttribute(name);
const appAttr = async (name) => app.getAttribute(name);
const state = () => page.evaluate(() => window.__neurouString.state());
const curves = () => page.evaluate(() => window.__neurouString.curves());
const lastTouch = () => page.evaluate(() => window.__neurouString.lastTouch());
const rms = () => page.evaluate(() => window.__neurouString.rms());
const valuesOf = async () => JSON.parse(String((await attr('data-values')) ?? '[]'));
const normsOf = async () => JSON.parse(String((await attr('data-norms')) ?? '[]'));
const thresholdsOf = async () => JSON.parse(String((await attr('data-thresholds')) ?? '[]'));
const couplingsOf = async () => JSON.parse(String((await attr('data-couplings')) ?? '[]'));
const readCouplingStrengthFromFile = (from, to) => {
  const text = readFileSync(WORLD_PATH, 'utf8');
  const pattern = new RegExp(`(?:耦合|边) ${from} → ${to}[^\\r\\n]*?(?:强度 )?([\\d.]+)`);
  const match = pattern.exec(text);
  return match ? Number(match[1]) : NaN;
};
const readThresholdFromFile = (which) => {
  const text = readFileSync(WORLD_PATH, 'utf8');
  const pattern = new RegExp(
    `叙事弦 信任\\r?\\n(?:[^\\r\\n]*\\r?\\n)*?  ${which === 'verge' ? '悬崖' : '安全'} ([\\d.]+)`,
  );
  const match = pattern.exec(text);
  return match ? Number(match[1]) : NaN;
};
const hash = async () => createHash('sha256').update(await page.screenshot()).digest('hex').slice(0, 10);
const resetLocal = async () => {
  await page.evaluate(() => window.__neurouString.reset());
  await page.waitForTimeout(260);
};

const canvasStats = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="string-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let ink = 0;
    let colored = 0;
    let minY = height;
    let maxY = -1;
    const rowsMid = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] <= 10) continue;
        ink++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x >= 300 && x < 1200) rowsMid[y]++;
        if (Math.abs(data[i] - data[i + 1]) > 1 || Math.abs(data[i + 1] - data[i + 2]) > 1) colored++;
      }
    }
    return { w: width, h: height, ink, colored, rows: rowsMid, bbox: { y: minY, h: maxY - minY + 1 } };
  });

const countRowBands = (rows, threshold = 200, gapTolerance = 10) => {
  const bands = [];
  let current = null;
  let gap = 0;
  for (let y = 0; y < rows.length; y++) {
    const hit = rows[y] > threshold;
    if (hit) {
      if (!current) current = { start: y, end: y, ink: rows[y] };
      else current.end = y;
      current.ink += rows[y];
      gap = 0;
    } else if (current) {
      gap++;
      if (gap > gapTolerance) {
        bands.push(current);
        current = null;
        gap = 0;
      }
    }
  }
  if (current) bands.push(current);
  return bands;
};

const rowInk = (yLogical, half = 2) =>
  page.evaluate(
    ({ y, half }) => {
      const canvas = document.querySelector('[data-testid="string-canvas"]');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      let count = 0;
      for (let row = Math.max(0, y - half); row <= Math.min(canvas.height - 1, y + half); row++) {
        for (let x = 300; x < 1200; x++) {
          sum += data[(row * canvas.width + x) * 4 + 3];
          count++;
        }
      }
      return sum / Math.max(1, count);
    },
    { y: Math.round(yLogical), half },
  );

// ============ 1. 世界接线：8 根弦来自 tuner.nro ============
check('首屏是八弦场', (await page.locator('[data-testid="string-field"]').count()) === 1);
check('没有按钮/输入框/面板', (await page.locator('button, input, textarea, select, .panel').count()) === 0);
check('没有任何常驻 DOM 文字', (await page.evaluate(() => document.body.innerText.trim())) === '');
check('GUI 读的是真实世界', (await attr('data-world')) === '调律台', String(await attr('data-world')));
check('弦的数量 = 世界里的 8 类弦', Number(await attr('data-lane-count')) === 8, String(await attr('data-lane-count')));
check('lane 顺序 = KIND_ORDER', JSON.stringify(JSON.parse(String(await attr('data-kinds')))) === JSON.stringify(KINDS));
const initialValues = await valuesOf();
check(
  '8 个值是 tuner.nro 的运行时初值',
  initialValues.every((v, i) => Math.abs(v - VALUES[i]) < 1e-6),
  JSON.stringify(initialValues),
);
const initialThresholds = await thresholdsOf();
check(
  'data-thresholds 是 8 条弦的悬崖/安全线',
  initialThresholds.length === 8 &&
    initialThresholds[0].verge === 25 &&
    initialThresholds[0].safe === 75 &&
    Math.abs(initialThresholds[0].vergeNorm - 0.25) < 1e-6,
  JSON.stringify(initialThresholds[0]),
);
check('世界逐拍在走', Number(await attr('data-tick')) >= 0, `tick=${await attr('data-tick')}`);
check('世界没有结束', (await attr('data-ended')) === '', String(await attr('data-ended')));
check('有 46 键隐形键盘', (await attr('data-key-count')) === '46');
check('默认焦点是叙事弦（信任）', (await attr('data-kind')) === '叙事' && (await attr('data-kind-index')) === '0');
await resetLocal();

const restStats = await canvasStats();
const restBands = restStats ? countRowBands(restStats.rows) : [];
check('画布上画出 8 条基线', restBands.length === 8, restBands.map((b) => `${b.start}-${b.end}`).join(' | '));
const expectedYs = initialValues.map((v, i) => valueToY(v, i));
const centers = restBands.map((b) => (b.start + b.end) / 2);
check(
  '基线纵坐标 = 世界值的归一化投影',
  expectedYs.every((expected) => centers.some((center) => Math.abs(center - expected) <= 7)),
  `期望 ${expectedYs.map((y) => Math.round(y)).join(',')} / 实测 ${centers.map((y) => Math.round(y)).join(',')}`,
);
check('没有彩色像素', restStats !== null && restStats.colored === 0, `${restStats?.colored}`);
const focusInk = await rowInk(expectedYs[0]);
const otherInk = await rowInk(expectedYs[1]);
check('焦点弦明显比其它弦黑', focusInk > otherInk * 2, `${focusInk.toFixed(1)} vs ${otherInk.toFixed(1)}`);
const idleA = await hash();
await page.waitForTimeout(360);
const idleB = await hash();
check('焦点弦高频微颤（两帧不同）', idleA !== idleB, `${idleA} / ${idleB}`);
const norms = await normsOf();
check(
  'data-norms 与值一一对应（关系弦 0..1 也正确归一）',
  norms.every((n, i) => Math.abs(n - normOf(initialValues[i], i)) < 1e-3),
  JSON.stringify(norms),
);
await page.screenshot({ path: 'artifacts/90-string-world.png' });

// tick 推进
const tickBefore = Number(await attr('data-tick'));
await page.waitForTimeout(1200);
const tickAfter = Number(await attr('data-tick'));
check('逐拍运行时在推进（tick 增长）', tickAfter > tickBefore, `${tickBefore} → ${tickAfter}`);

// ============ 2. 拖弦 = 写回世界，下一拍沿耦合传导 ============
await resetLocal();
const beforeDrag = await valuesOf();
const baseY = valueToY(beforeDrag[0], 0);
await page.mouse.move(720, Math.round(baseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(baseY) + 100, { steps: 10 });
await page.waitForTimeout(160);
check('拖弦时 data-pulling=true', (await attr('data-pulling')) === 'true');
const dragged = await valuesOf();
check('拖动把真实世界值改小', dragged[0] < beforeDrag[0] - 5, `${beforeDrag[0]} → ${dragged[0].toFixed(1)}`);
const plucksAtDrag = Number(await attr('data-plucks'));
await page.mouse.up();
await page.waitForTimeout(1200);
check('松手不额外拨弦', Number(await attr('data-plucks')) === plucksAtDrag);
const afterCoupling = await valuesOf();
const changedOthers = afterCoupling.filter((v, i) => {
  if (i === 0) return false;
  const [min, max] = RANGES[i];
  return Math.abs(v - beforeDrag[i]) / (max - min || 1) > 0.004;
}).length;
check(
  '世界耦合真的把变化传到了别的弦（不是本地假动画）',
  changedOthers >= 2,
  `变了 ${changedOthers} 根：${afterCoupling.map((v, i) => `${NAMES[i]}:${v.toFixed(3)}`).join(' ')}`,
);
const coupledCurves = await curves();
const colorLane = coupledCurves.find((c) => c.kind === '视觉');
const colorWave = colorLane ? Math.max(...colorLane.samples.map((v) => Math.abs(v))) : 0;
check('被耦合的弦上有视觉波（数据流变成涟漪）', colorWave > 1, `色温波幅 ${colorWave.toFixed(1)}px`);
await page.screenshot({ path: 'artifacts/91-string-coupling.png' });

// ============ 3. 拨弦：视觉 + 8% 量程的真实注入 ============
await resetLocal();
const beforePluck = await valuesOf();
const pluckBase = valueToY(beforePluck[0], 0);
const pluckPx = Math.round(pluckBase - 150);
await page.mouse.click(720, pluckPx);
await page.waitForTimeout(160);
check('点击拨弦计数 +1', Number(await attr('data-plucks')) === 1, String(await attr('data-plucks')));
check('点击在弦上方 → 向上拨', (await attr('data-last-direction')) === 'up', String(await attr('data-last-direction')));
const afterPluck = await valuesOf();
check(
  '拨弦会推动真实世界值（约 8% 量程）',
  Math.abs(afterPluck[0] - beforePluck[0]) > 1,
  `${beforePluck[0].toFixed(1)} → ${afterPluck[0].toFixed(1)}`,
);
const pluckState = await state();
check('拨动后弦在振动', pluckState.amplitude > 20, `amplitude=${pluckState.amplitude.toFixed(1)}`);
const pluckStats = await canvasStats();
check('拨动后墨量增加（残影/拖尾）', restStats !== null && pluckStats !== null && pluckStats.ink > restStats.ink * 1.1, `${restStats?.ink} → ${pluckStats?.ink}`);
await page.screenshot({ path: 'artifacts/92-string-pluck.png' });

// 键盘：同样写回世界（先把信任放回 55，保证 A 键与基线的距离足够产生 >1 的变化）
await resetLocal();
await page.evaluate(() => window.__neurouString.setValue('叙事', 55));
await page.waitForTimeout(150);
const beforeKey = await valuesOf();
await page.keyboard.press('a');
await page.waitForTimeout(160);
check('按 A 拨弦并映射到 KeyA', (await attr('data-last-key')) === 'KeyA' && Number(await attr('data-plucks')) === 1);
check('A 在信任弦下方 → 向下拨', (await attr('data-last-direction')) === 'down');
const afterKey = await valuesOf();
check('键盘拨动也写回真实值', Math.abs(afterKey[0] - beforeKey[0]) > 1, `${beforeKey[0].toFixed(1)} → ${afterKey[0].toFixed(1)}`);

// ============ 3b. 按住绷弦（鼠标/键盘长按） ============
await resetLocal();
const holdBaseY = valueToY((await valuesOf())[0], 0);
await page.mouse.move(720, Math.round(holdBaseY - 160));
await page.mouse.down();
await page.waitForTimeout(380);
check('按住不动 → 弦被绷住（data-holding=true）', (await attr('data-holding')) === 'true', String(await attr('data-holding')));
check('按住时只有一个 pin', Number(await attr('data-held-count')) === 1, String(await attr('data-held-count')));
check('按住期间还没有拨弦', Number(await attr('data-plucks')) === 0, String(await attr('data-plucks')));
const heldAmp = Number(await attr('data-held-amplitude'));
check('绷住的幅度接近按住点位移', Math.abs(heldAmp - 160) <= 25, String(heldAmp));
const pinNow = await page.evaluate(() => window.__neurouString.pinInfo());
check('pinInfo 指向按住点', pinNow.active === true && Math.abs(pinNow.x - 720) < 10, JSON.stringify(pinNow));
await page.screenshot({ path: 'artifacts/99-string-hold.png' });
await page.mouse.move(620, Math.round(holdBaseY - 110), { steps: 6 });
await page.waitForTimeout(160);
const pinMoved = await page.evaluate(() => window.__neurouString.pinInfo());
check(
  '按住后移动指针，波峰跟随',
  pinMoved.active === true && Math.abs(pinMoved.x - 620) < 15 && Math.abs(pinMoved.amplitude - 110) < 30,
  JSON.stringify(pinMoved),
);
await page.mouse.up();
await page.waitForTimeout(220);
check('松手释放一次拨弦', Number(await attr('data-plucks')) === 1 && (await attr('data-last-direction')) === 'up', String(await attr('data-plucks')));

await resetLocal();
await page.keyboard.down('a');
await page.waitForTimeout(380);
check('键盘长按也绷住', (await attr('data-holding')) === 'true', String(await attr('data-holding')));
check('键盘按住期间不拨弦', Number(await attr('data-plucks')) === 0, String(await attr('data-plucks')));
await page.keyboard.up('a');
await page.waitForTimeout(220);
check('键盘松手拨一次', Number(await attr('data-plucks')) === 1, String(await attr('data-plucks')));

// 键盘多键同时按：每键独立 pin / 独立拨弦
await resetLocal();
await page.keyboard.down('a');
await page.keyboard.down('d');
await page.waitForTimeout(380);
check('同时按住两键 → 两个 pin', Number(await attr('data-held-count')) === 2 && (await attr('data-holding')) === 'true', String(await attr('data-held-count')));
check('多键按住期间不拨弦', Number(await attr('data-plucks')) === 0, String(await attr('data-plucks')));
const pinsWhileHeld = await page.evaluate(() => window.__neurouString.pins());
check('pins() 给出两个按键 pin', Array.isArray(pinsWhileHeld) && pinsWhileHeld.length === 2, JSON.stringify(pinsWhileHeld));
await page.keyboard.up('a');
await page.waitForTimeout(160);
check('松开一键只拨一次、余键仍按住', Number(await attr('data-plucks')) === 1 && Number(await attr('data-held-count')) === 1, `${await attr('data-plucks')}/${await attr('data-held-count')}`);
await page.keyboard.up('d');
await page.waitForTimeout(200);
check('再松另一键 → 共拨两次', Number(await attr('data-plucks')) === 2 && Number(await attr('data-held-count')) === 0, String(await attr('data-plucks')));

// ============ 4. 阈值共振：共振点来自悬崖/安全线 ============
await resetLocal();
await page.evaluate(() => window.__neurouString.setValue('叙事', 26));
await page.waitForTimeout(180);
check(
  '信任靠近悬崖 25 → 进入驻波态',
  (await attr('data-resonant')) === 'true' && Math.abs(Number(await attr('data-resonance')) - 25) <= 0.6,
  `${await attr('data-resonant')} / ${await attr('data-resonance')}`,
);
await page.screenshot({ path: 'artifacts/93-string-threshold.png' });
await page.evaluate(() => window.__neurouString.setValue('叙事', 74));
await page.waitForTimeout(180);
check(
  '信任靠近安全线 75 → 也进入驻波态',
  (await attr('data-resonant')) === 'true' && Math.abs(Number(await attr('data-resonance')) - 75) <= 0.6,
  `${await attr('data-resonant')} / ${await attr('data-resonance')}`,
);
await page.evaluate(() => window.__neurouString.setValue('叙事', 50));
await page.waitForTimeout(180);
check('离开阈值带 → 回到普通态', (await attr('data-resonant')) === 'false', String(await attr('data-resonant')));

// ============ 5. Tab / 干涉 / ESC ============
await resetLocal();
const kindSequence = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  kindSequence.push(await attr('data-kind'));
}
check('Tab 依次切换 8 类弦焦点', JSON.stringify(kindSequence) === JSON.stringify([...KINDS.slice(1), KINDS[0]]));
await resetLocal();

// 把两根弦拉近并拨动 → 交点
await page.evaluate(() => {
  window.__neurouString.setValue('叙事', 60);
  window.__neurouString.setValue('视觉', 61);
});
await page.waitForTimeout(220);
const crossValues = await valuesOf();
const crossBase = valueToY(crossValues[0], 0);
await page.mouse.click(720, Math.round(crossBase - 220));
await page.waitForTimeout(320);
const crossings = Number(await attr('data-crossings'));
const crossDbg = {
  values: await valuesOf(),
  plucks: await attr('data-plucks'),
  lastAmp: await attr('data-last-amplitude'),
  clickY: Math.round(crossBase - 220),
};
check('两弦靠近后出现干涉奇点', crossings > 0, `crossings=${crossings} ${JSON.stringify(crossDbg)}`);
await page.screenshot({ path: 'artifacts/94-string-crossing.png' });

await page.keyboard.press('Escape');
await page.waitForTimeout(320);
check('ESC 进入总览', (await attr('data-mode')) === 'overview' && Number(await attr('data-overview-rows')) === 8);
await page.screenshot({ path: 'artifacts/95-string-overview.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(260);
check('再按 ESC 回到八弦', (await attr('data-mode')) === 'strings');

// ============ 7. 结构编辑：拖动阈值刻度 + 编译闸门 + 撤销/重做 ============
await page.waitForTimeout(1300); // 结清前面的写回，让 savedText 与磁盘一致
const thresholdPreText = readFileSync(WORLD_PATH, 'utf8');
const thresholdPre = (await thresholdsOf())[0];
check('拖动前：信任悬崖在 25', Math.abs(thresholdPre.verge - 25) < 1e-6, JSON.stringify(thresholdPre));
const vergeY0 = valueToY(thresholdPre.verge, 0);
const vergeY1 = valueToY(40, 0);
await page.mouse.move(46, Math.round(vergeY0));
await page.mouse.down();
await page.mouse.move(46, Math.round(vergeY1), { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1700);
const thresholdAfter = (await thresholdsOf())[0];
check(
  '拖动左侧悬崖刻度 → 阈值改变',
  Math.abs(thresholdAfter.verge - 40) <= 1.5,
  `25 → ${thresholdAfter.verge}`,
);
check('阈值编辑也会触发写回', (await appAttr('data-save-state')) === 'saved', String(await appAttr('data-save-state')));
const vergeInFile = readThresholdFromFile('verge');
check('文件里的悬崖线被重写', Math.abs(vergeInFile - thresholdAfter.verge) <= 0.01, `file=${vergeInFile}`);
const thresholdPostText = readFileSync(WORLD_PATH, 'utf8');
check(
  '阈值写回保留原文件注释（行级 patch）',
  thresholdPostText.includes('# 八弦调律台的默认世界') &&
    commentCount(thresholdPostText) === originalCommentCount &&
    !thresholdPostText.includes('由 neurou 序列化器生成'),
  `comments ${commentCount(thresholdPostText)}/${originalCommentCount}`,
);
await page.screenshot({ path: 'artifacts/96-string-threshold-edit.png' });

// Ctrl+Z 撤销 → 回到上一次保存的文本；Ctrl+Shift+Z 重做（必须在刷新前，历史在内存里）
await page.keyboard.press('Control+z');
await page.waitForTimeout(1200);
const thresholdUndone = (await thresholdsOf())[0];
check('Ctrl+Z 撤销阈值编辑', Math.abs(thresholdUndone.verge - 25) <= 0.01, `verge=${thresholdUndone.verge}`);
check('撤销后磁盘文件回到上一版', readFileSync(WORLD_PATH, 'utf8') === thresholdPreText);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(1200);
const thresholdRedone = (await thresholdsOf())[0];
check('Ctrl+Shift+Z 重做阈值编辑', Math.abs(thresholdRedone.verge - thresholdAfter.verge) <= 0.01, `verge=${thresholdRedone.verge}`);
check('重做后磁盘文件回到编辑版', readFileSync(WORLD_PATH, 'utf8') === thresholdPostText);

// 刷新后阈值保持
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
const thresholdReloaded = (await thresholdsOf())[0];
check(
  '刷新后阈值保持（写回持久化）',
  Math.abs(thresholdReloaded.verge - thresholdAfter.verge) <= 0.01,
  `${thresholdAfter.verge} / ${thresholdReloaded.verge}`,
);

// ============ 8. 耦合编辑：焦点弦耦合标记 + 悬停滚轮 ============
await page.waitForTimeout(800);
const couplingList = await couplingsOf();
check('data-couplings 包含世界里的 10 条耦合', couplingList.length === 10, String(couplingList.length));
const colorCoupling = couplingList.find((c) => c.from === '信任' && c.to === '色温');
check('耦合投影带两端 id 与强度', colorCoupling?.polarity === 1 && Math.abs(colorCoupling.strength - 0.5) < 1e-6, JSON.stringify(colorCoupling));
const marks = await page.evaluate(() => window.__neurouString.couplingMarks());
// 信任→恐惧 与 恐惧→信任 的中点重合；用 信任→色温（midY 唯一）避免命中歧义。
const trustColorMark = marks.find((m) => m.from === '信任' && m.to === '色温');
check('焦点弦画出了耦合标记', Boolean(trustColorMark), `${marks.length} 个`);
const couplingPreText = readFileSync(WORLD_PATH, 'utf8');
if (trustColorMark) {
  await page.mouse.move(trustColorMark.x, trustColorMark.y);
  await page.waitForTimeout(160);
  await page.screenshot({ path: 'artifacts/97-string-coupling-edit.png' });
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(300);
  const after = (await couplingsOf()).find((c) => c.from === '信任' && c.to === '色温');
  const delta = after ? after.strength - colorCoupling.strength : 0;
  check('滚轮改变耦合强度（3 格 ≈ ±0.15）', Math.abs(delta) >= 0.1 && Math.abs(delta) <= 0.25, `${colorCoupling.strength} → ${after?.strength}`);
  check('data-coupling-edits 计数增加', Number((await appAttr('data-coupling-edits')) ?? 0) >= 1, String(await appAttr('data-coupling-edits')));
  const lastEdit = JSON.parse(String((await appAttr('data-last-coupling')) || '{}'));
  check('data-last-coupling 指向被编辑的耦合', lastEdit.from === '信任' && lastEdit.to === '色温', JSON.stringify(lastEdit));
  await page.waitForTimeout(1700);
  const fileStrength = readCouplingStrengthFromFile('信任', '色温');
  check('文件里的耦合强度被重写', Math.abs(fileStrength - (after?.strength ?? NaN)) <= 0.01, `file=${fileStrength}`);
  check('耦合写回保留原文件注释（行级 patch）', commentCount(readFileSync(WORLD_PATH, 'utf8')) === originalCommentCount);
  check('耦合编辑写回状态 = saved', (await appAttr('data-save-state')) === 'saved', String(await appAttr('data-save-state')));
  // Ctrl+Z 撤销耦合编辑
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  const undone = (await couplingsOf()).find((c) => c.from === '信任' && c.to === '色温');
  check('Ctrl+Z 撤销耦合编辑', Math.abs((undone?.strength ?? NaN) - colorCoupling.strength) < 1e-6, `→ ${undone?.strength}`);
  check('撤销后耦合文件回到上一版', readFileSync(WORLD_PATH, 'utf8') === couplingPreText);
}

// ============ 8a. 增删耦合：Shift+↑/↓ 选目标，Shift+Enter 切换 ============
await page.waitForTimeout(300);
const linkPreFile = readFileSync(WORLD_PATH, 'utf8');
const linkPreCount = (await couplingsOf()).length;
check('初始没有 信任→步态 耦合', !(await couplingsOf()).some((c) => c.from === '信任' && c.to === '步态'));
// 其它 lanes 的顺序：色温、步态、重力……（信任为焦点）
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await page.waitForTimeout(120);
check('Shift+ArrowDown 选中耦合目标「步态」', (await attr('data-link-target')) === '步态', String(await attr('data-link-target')));
const linkTarget = await page.evaluate(() => window.__neurouString.linkTarget());
check('linkTarget 给出目标与是否已有耦合', linkTarget?.name === '步态' && linkTarget.existing === false, JSON.stringify(linkTarget));
await page.screenshot({ path: 'artifacts/98-string-link.png' });
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(180);
let linkList = await couplingsOf();
check('Shift+Enter 新增耦合 信任→步态', linkList.length === linkPreCount + 1 && linkList.some((c) => c.from === '信任' && c.to === '步态'), `${linkPreCount} → ${linkList.length}`);
check('data-coupling-adds 计数', Number((await appAttr('data-coupling-adds')) ?? 0) >= 1, String(await appAttr('data-coupling-adds')));
await page.waitForTimeout(1700);
const linkAddedText = readFileSync(WORLD_PATH, 'utf8');
check('新增耦合写回文件', linkAddedText.includes('耦合 信任 → 步态 同向 0.2'));
check('新增耦合保留注释', commentCount(linkAddedText) === originalCommentCount);
check('新增耦合走行级 patch', (await appAttr('data-save-mode')) === 'patch', String(await appAttr('data-save-mode')));
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(180);
linkList = await couplingsOf();
check('再次 Shift+Enter 删除耦合', linkList.length === linkPreCount && !linkList.some((c) => c.from === '信任' && c.to === '步态'), `${linkList.length}`);
await page.waitForTimeout(1700);
const linkRemovedText = readFileSync(WORLD_PATH, 'utf8');
check('删除耦合写回文件（行消失）', !linkRemovedText.includes('耦合 信任 → 步态'));
check('删除后文件恢复原排版', linkRemovedText === linkPreFile);
// 回路边删除被拒绝
await page.keyboard.press('Shift+ArrowUp');
await page.waitForTimeout(120);
check('目标切回「色温」', (await attr('data-link-target')) === '色温', String(await attr('data-link-target')));
const loopBefore = (await couplingsOf()).length;
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(300);
check('回路边删除被 App 拒绝', (await couplingsOf()).length === loopBefore && String(await appAttr('data-save-error')).length > 0, String(await appAttr('data-save-error')));
await page.keyboard.press('Escape');

// ============ 8c. 增删弦：Alt+Enter / Alt+Backspace ============
await page.waitForTimeout(300);
const stringPreFile = readFileSync(WORLD_PATH, 'utf8');
const lanePreCount = Number(await attr('data-lane-count'));
check('初始焦点 id = 信任', (await attr('data-focus-id')) === '信任', String(await attr('data-focus-id')));
await page.keyboard.press('Alt+Enter');
await page.waitForTimeout(280);
check('Alt+Enter 新增同类弦（同类多实例，视图仍每类一根）', Number((await appAttr('data-string-adds')) ?? 0) >= 1 && Number(await attr('data-lane-count')) === lanePreCount, String(await appAttr('data-string-adds')));
check('data-string-adds 计数', Number((await appAttr('data-string-adds')) ?? 0) >= 1, String(await appAttr('data-string-adds')));
await page.waitForTimeout(1700);
const stringAddedText = readFileSync(WORLD_PATH, 'utf8');
check('新增弦写回文件（整块插入）', stringAddedText.includes('叙事弦 信任新'));
check('新增弦保留注释', commentCount(stringAddedText) === originalCommentCount);
check('新增弦走行级 patch', (await appAttr('data-save-mode')) === 'patch', String(await appAttr('data-save-mode')));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(160);
check('ArrowRight 切到新弦', (await attr('data-focus-id')) === '信任新', String(await attr('data-focus-id')));
await page.keyboard.press('Alt+Backspace');
await page.waitForTimeout(280);
check('Alt+Backspace 删除新弦', Number(await attr('data-lane-count')) === lanePreCount && (await attr('data-focus-id')) === '信任', String(await attr('data-focus-id')));
check('data-string-removes 计数', Number((await appAttr('data-string-removes')) ?? 0) >= 1, String(await appAttr('data-string-removes')));
await page.waitForTimeout(1700);
check('删除弦后文件恢复原排版', readFileSync(WORLD_PATH, 'utf8') === stringPreFile);
// 被规则/回路引用的弦不能被删除
const focusNow = String(await attr('data-focus-id'));
if (focusNow !== '信任') {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
}
const laneBeforeRefuse = Number(await attr('data-lane-count'));
await page.keyboard.press('Alt+Backspace');
await page.waitForTimeout(300);
check('删除被引用/回路中的弦被拒绝', Number(await attr('data-lane-count')) === laneBeforeRefuse && String(await appAttr('data-save-error')).length > 0, String(await appAttr('data-save-error')));

// ============ 8b. 撤销缓动（不是闪回） ============
await page.waitForTimeout(300);
const easingPreFile = readFileSync(WORLD_PATH, 'utf8');
const easingTarget = parseTrustBaseline(easingPreFile);
const easFrom = (await valuesOf())[0];
const easBaseY = valueToY(easFrom, 0);
await page.mouse.move(720, Math.round(easBaseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(easBaseY) + 90, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1700);
const easEdited = (await valuesOf())[0];
check('缓动前：拖动写回了不同值', Math.abs(easEdited - easFrom) > 3, `${easFrom.toFixed(2)} → ${easEdited.toFixed(2)}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(110);
check('Ctrl+Z 进入缓动状态', (await appAttr('data-transition')) === 'undo', String(await appAttr('data-transition')));
const easMid1 = (await valuesOf())[0];
check(
  '缓动中途：值已开始回退但还没到终点',
  Math.abs(easMid1 - easEdited) > 0.05 && Math.abs(easMid1 - easingTarget) > 0.05,
  `${easEdited.toFixed(2)} → ${easMid1.toFixed(2)} → ${easingTarget}`,
);
await page.waitForTimeout(200);
const easMid2 = (await valuesOf())[0];
check('缓动是渐进的（两个采样点不同）', Math.abs(easMid2 - easMid1) > 0.02, `${easMid1.toFixed(2)} → ${easMid2.toFixed(2)}`);
await page.waitForTimeout(1000);
check('缓动结束，data-transition 清空', (await appAttr('data-transition')) === '');
const easFinal = (await valuesOf())[0];
check('缓动结束在目标基线', Math.abs(easFinal - easingTarget) < 0.02, `${easFinal.toFixed(2)} vs ${easingTarget}`);
check('撤销后的文件回到编辑前一版', readFileSync(WORLD_PATH, 'utf8') === easingPreFile);

// ============ 9. 写回 .nro（GUI → 运行时 → IR → 文本） ============
await page.waitForTimeout(1300); // 结清前面手势的 debounce 写回
const preFile = readFileSync(WORLD_PATH, 'utf8');
const preBaseline = parseTrustBaseline(preFile);
const savesBefore = Number((await appAttr('data-saves')) ?? 0);
const trustBefore = (await valuesOf())[0];
const dragBaseY = valueToY(trustBefore, 0);
await page.mouse.move(720, Math.round(dragBaseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(dragBaseY) + 64, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1700);
const savesAfter = Number((await appAttr('data-saves')) ?? 0);
check('用户松手后触发写回（data-saves 增加）', savesAfter > savesBefore, `${savesBefore} → ${savesAfter}`);
check('写回状态 = saved', (await appAttr('data-save-state')) === 'saved', String(await appAttr('data-save-state')));
const fileAfter = readFileSync(WORLD_PATH, 'utf8');
check(
  '拖弦写回保留原文件注释与排版（行级 patch）',
  fileAfter.includes('# 八弦调律台的默认世界') &&
    commentCount(fileAfter) === originalCommentCount &&
    !fileAfter.includes('由 neurou 序列化器生成'),
  `comments ${commentCount(fileAfter)}/${originalCommentCount}`,
);
const savedBaseline = parseTrustBaseline(fileAfter);
check('写回走行级 patch（data-save-mode=patch）', (await appAttr('data-save-mode')) === 'patch', String(await appAttr('data-save-mode')));
check(
  '文件里的「信任」基线被更新',
  Number.isFinite(savedBaseline) && Math.abs(savedBaseline - preBaseline) > 1,
  `写回前 ${preBaseline} → 写回后 ${savedBaseline}`,
);
await page.screenshot({ path: 'artifacts/96-string-saved.png' });

// 刷新页面：应从刚写下的基线开局（持久化生效）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
const reloaded = await valuesOf();
check(
  '刷新后从写回的基线开始（持久化生效）',
  Math.abs(reloaded[0] - savedBaseline) < 0.01,
  `文件基线=${savedBaseline} 刷新后=${reloaded[0].toFixed(3)}`,
);

// 恢复原始世界，再刷新，确认验收不会污染仓库
restoreWorld();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
const restored = await valuesOf();
check('恢复原文件后刷新回到原初值', restored.every((v, i) => Math.abs(v - VALUES[i]) < 1e-6), JSON.stringify(restored));

// ============ 8. 声音 / 性能 / 错误 ============
// 写回验收期间刷新过页面，AudioContext 需要一次手势才创建。
// 这里用 debug pluckAt（会发声、但不落盘），避免在验收收尾时又写一次 tuner.nro。
await page.evaluate(() => window.__neurouString.pluckAt(720, 300));
await page
  .waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="string-field"]');
      return el !== null && el.getAttribute('data-audio') !== 'off';
    },
    { timeout: 3000 },
  )
  .catch(() => {
    /* 超时后仍做一次断言，让失败信息可见 */
  });
const audioState = await attr('data-audio');
check('音频引擎可用', audioState === 'running' || audioState === 'suspended', String(audioState));
await page.waitForTimeout(240); // 等 pluck 真正进入 Analyser 窗口
const finalRms = await rms();
check('拨弦后有真实信号（rms>0.001）', finalRms > 0.001, finalRms.toFixed(6));
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const loop = (t) => {
        frames++;
        if (t - start < 1500) requestAnimationFrame(loop);
        else resolve(Math.round((frames / (t - start)) * 1000));
      };
      requestAnimationFrame(loop);
    }),
);
check('渲染帧率 ≥50fps', fps >= 50, `${fps}fps`);
const heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
check('堆内存可用', heap !== null, heap === null ? '未暴露' : `${heap}MB`);
const worldName = String(await attr('data-world'));
check('没有页面级报错', consoleErrors.length === 0, consoleErrors.join(' | '));

// ============ 9. 任意世界 + 同类多根弦 ============
// 先把 tuner.nro 恢复到干净状态，避免前面手势的 debounce 写回污染 §9 的副本。
await page.waitForTimeout(900);
restoreWorld();
const tunerClean = readFileSync(WORLD_PATH, 'utf8');
// 单实例世界里，左右方向键不应有任何副作用
const lanesBeforeArrow = await page.evaluate(() => window.__neurouString.state().lanes.map((l) => l.name));
const plucksBeforeArrow = Number(await attr('data-plucks'));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(180);
const lanesAfterArrow = await page.evaluate(() => window.__neurouString.state().lanes.map((l) => l.name));
check(
  '单实例世界里方向键无副作用',
  JSON.stringify(lanesBeforeArrow) === JSON.stringify(lanesAfterArrow) &&
    Number(await attr('data-plucks')) === plucksBeforeArrow,
  `${lanesBeforeArrow.join(',')} / ${lanesAfterArrow.join(',')}`,
);

const gotoWorld = async (file) => {
  await page.goto(`${URL}?world=${encodeURIComponent(file)}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
  await page.waitForTimeout(1000);
};

// A. 打开一个世界副本，写回目标跟随当前文件
copyFileSync(WORLD_PATH, TEMP_TUNER);
const tunerBeforeOtherWorld = readFileSync(WORLD_PATH, 'utf8');
await gotoWorld(TEMP_TUNER);
check(
  '?world= 打开任意世界',
  (await appAttr('data-world-file')) === TEMP_TUNER && (await attr('data-world')) === '调律台',
  String(await appAttr('data-world-file')),
);
check('该世界初值来自它的文件', JSON.stringify(await valuesOf()) === JSON.stringify(VALUES));
const tempBaseY = valueToY((await valuesOf())[0], 0);
await page.mouse.move(720, Math.round(tempBaseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(tempBaseY) + 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1700);
const tempText = readFileSync(TEMP_TUNER, 'utf8');
const tempTrust = parseTrustBaseline(tempText);
check(
  '写回目标是当前世界文件（保留其注释）',
  tempText.includes('# 八弦调律台的默认世界') &&
    !tempText.includes('由 neurou 序列化器生成') &&
    Math.abs(tempTrust - (await valuesOf())[0]) < 2,
  `file=${tempTrust} view=${(await valuesOf())[0].toFixed(2)}`,
);
check('原 tuner.nro 不被误写', readFileSync(WORLD_PATH, 'utf8') === tunerBeforeOtherWorld);

// B. 同类多根弦：ArrowLeft/Right 切换
writeFileSync(TEMP_TWO, TWO_WORLD_SOURCE, 'utf8');
await gotoWorld(TEMP_TWO);
check(
  '双弦世界加载（2 类共 3 根弦，界面每类一根）',
  (await attr('data-world')) === '双弦测试' && Number(await attr('data-lane-count')) === 2,
  `${await attr('data-world')} / ${await attr('data-lane-count')}`,
);
const tmpLanes = () => page.evaluate(() => window.__neurouString.state().lanes.map((l) => ({ kind: l.kind, name: l.name, value: l.value })));
const firstLane = (await tmpLanes())[0];
check('默认显示每类第一根', firstLane.kind === '叙事' && firstLane.name === '甲' && Math.abs(firstLane.value - 40) < 1e-6, JSON.stringify(firstLane));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(260);
const secondLane = (await tmpLanes())[0];
check(
  'ArrowRight 切到同类下一根',
  secondLane.name === '乙' && Math.abs(secondLane.value - 70) < 1e-6 && Number(await attr('data-plucks')) === 0,
  JSON.stringify(secondLane),
);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(260);
const backLane = (await tmpLanes())[0];
check('ArrowLeft 切回同类上一根', backLane.name === '甲' && Math.abs(backLane.value - 40) < 1e-6, JSON.stringify(backLane));
await page.screenshot({ path: 'artifacts/98-string-world-switch.png' });

// ============ 12. 谱模式：F2 进入、拖段点、行级写回、撤销 ============
const SPECTRA_PATH = 'examples/spectra.nro';
const spectraBefore = readFileSync(SPECTRA_PATH, 'utf8');
await page.goto('http://127.0.0.1:5188/?world=examples/spectra.nro', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(900);
check('谱示例世界可加载', (await attr('data-world')) === '谱之境', String(await attr('data-world')));
await page.keyboard.press('F2');
await page.waitForTimeout(500);
const spectrumField = page.locator('[data-testid="spectrum-field"]');
check('F2 进入谱模式', (await appAttr('data-screen')) === 'spectrum' && (await spectrumField.count()) === 1, String(await appAttr('data-screen')));
check('显示第一条谱「情绪地形」', (await spectrumField.getAttribute('data-spectrum-name')) === '情绪地形', String(await spectrumField.getAttribute('data-spectrum-name')));
const spectrumBandsBefore = JSON.parse(String((await spectrumField.getAttribute('data-band-values')) ?? '[]'));
check('初始 4 个段值', spectrumBandsBefore.length === 4, JSON.stringify(spectrumBandsBefore));
await page.screenshot({ path: 'artifacts/99-string-spectrum.png' });
const bandPositions = await page.evaluate(() => window.__neurouSpectrum?.bandPositions() ?? []);
const band1 = bandPositions[1];
if (band1) {
  await page.mouse.move(band1.x, band1.y);
  await page.mouse.down();
  await page.mouse.move(band1.x, band1.y - 100, { steps: 10 });
  await page.waitForTimeout(260);
  await page.mouse.up();
  await page.waitForTimeout(1400);
  const bandsAfter = JSON.parse(String((await spectrumField.getAttribute('data-band-values')) ?? '[]'));
  check('拖动段点改变曲线值', Math.abs(bandsAfter[1] - spectrumBandsBefore[1]) > 0.05, `${spectrumBandsBefore[1]} → ${bandsAfter[1]}`);
  check('段值写回走行级 patch', (await appAttr('data-save-mode')) === 'patch', String(await appAttr('data-save-mode')));
  const spectraAfterText = readFileSync(SPECTRA_PATH, 'utf8');
  const bandLine = spectraAfterText.split(/\r?\n/).find((line) => line.trimStart().startsWith('段')) ?? '';
  check('文件里的段行被更新、注释保留', /段 0\.1 0\.\d+ 0\.8 0\.5/.test(bandLine) && spectraAfterText.includes('# 谱（stage 1）'), bandLine);
  check('谱编辑计数', Number((await appAttr('data-spectrum-band-edits')) ?? 0) >= 1, String(await appAttr('data-spectrum-band-edits')));
  await page.screenshot({ path: 'artifacts/99-string-spectrum-edited.png' });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  const bandsUndo = JSON.parse(String((await spectrumField.getAttribute('data-band-values')) ?? '[]'));
  check('Ctrl+Z 撤销谱编辑', Math.abs(bandsUndo[1] - spectrumBandsBefore[1]) < 1e-6, JSON.stringify(bandsUndo));
  check('撤销后谱文件恢复原样', readFileSync(SPECTRA_PATH, 'utf8') === spectraBefore);
}
await page.keyboard.press('F2');
await page.waitForTimeout(300);
check('F2 退出谱模式回到八弦', (await appAttr('data-screen')) === 'strings', String(await appAttr('data-screen')));
execFileSync('git', ['checkout', '--', SPECTRA_PATH], { stdio: 'ignore' });

await browser.close();
// 关闭浏览器后可能还有一次 debounce 写回在飞，最后再恢复一次世界文件。
restoreWorld();

const summary = {
  when: new Date().toISOString(),
  world: { name: worldName },
  initial: { values: initialValues, bands: restBands.length, centers },
  focus: { focusInk, otherInk },
  drag: { before: beforeDrag[0], after: dragged[0], coupled: afterCoupling, changedOthers },
  pluck: { before: beforePluck[0], after: afterPluck[0], amplitude: pluckState.amplitude },
  threshold: { resonant: true },
  thresholdEdit: {
    pre: thresholdPre.verge,
    after: thresholdAfter.verge,
    inFile: vergeInFile,
    undone: thresholdUndone.verge,
    redone: thresholdRedone.verge,
    reloaded: thresholdReloaded.verge,
  },
  crossings,
  save: {
    beforeSaves: savesBefore,
    afterSaves: savesAfter,
    preBaseline,
    savedBaseline,
    reloadedTrust: reloaded[0],
    restored,
  },
  hold: { heldAmplitude: heldAmp, movedPin: pinMoved },
  links: {
    target: linkTarget?.name ?? null,
    before: linkPreCount,
    afterAdd: linkPreCount + 1,
    afterRemove: linkPreCount,
  },
  easing: {
    from: easEdited,
    mid1: easMid1,
    mid2: easMid2,
    target: easingTarget,
    final: easFinal,
  },
  audio: { state: audioState, rms: finalRms },
  worldSwitch: { file: TEMP_TUNER, trust: tempTrust, tunerUntouched: readFileSync(WORLD_PATH, 'utf8') === tunerBeforeOtherWorld },
  instances: { first: firstLane.name, second: secondLane.name, back: backLane.name },
  fps,
  heapMB: heap,
  consoleErrors,
  results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync('artifacts/string-test.json', JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.passed} passed / ${summary.failed} failed ===`);
if (summary.failed > 0) process.exitCode = 1;
