/**
 * 八弦调律台 v0.8 验收：GUI 接回真实世界。
 *
 * 核心断言：
 *   - 8 根弦的值来自 examples/tuner.nro 的运行时，而不是本地演示数据；
 *   - 拖弦/拨弦通过 Universe.inject 写回世界，下一拍沿耦合传导；
 *   - 世界的逐拍变化会变成弦上的视觉波；
 *   - 共振点 = 接近悬崖/安全阈值，而不是预设的数字。
 *
 * 运行：node scripts/gui-test.mjs（需要 127.0.0.1:5188 的 dev server）
 * 结果：artifacts/string-test.json + artifacts/9x-*.png
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const URL = 'http://127.0.0.1:5188/';
const results = [];
const consoleErrors = [];

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
const attr = async (name) => field.getAttribute(name);
const state = () => page.evaluate(() => window.__neurouString.state());
const curves = () => page.evaluate(() => window.__neurouString.curves());
const lastTouch = () => page.evaluate(() => window.__neurouString.lastTouch());
const rms = () => page.evaluate(() => window.__neurouString.rms());
const valuesOf = async () => JSON.parse(String((await attr('data-values')) ?? '[]'));
const normsOf = async () => JSON.parse(String((await attr('data-norms')) ?? '[]'));
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

// 键盘：同样写回世界
await resetLocal();
const beforeKey = await valuesOf();
await page.keyboard.press('a');
await page.waitForTimeout(160);
check('按 A 拨弦并映射到 KeyA', (await attr('data-last-key')) === 'KeyA' && Number(await attr('data-plucks')) === 1);
check('A 在信任弦下方 → 向下拨', (await attr('data-last-direction')) === 'down');
const afterKey = await valuesOf();
check('键盘拨动也写回真实值', Math.abs(afterKey[0] - beforeKey[0]) > 1, `${beforeKey[0].toFixed(1)} → ${afterKey[0].toFixed(1)}`);

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

// ============ 6. 声音 / 性能 / 错误 ============
const audioState = await attr('data-audio');
check('音频引擎可用', audioState === 'running' || audioState === 'suspended', String(audioState));
await page.mouse.click(720, 300);
await page.waitForTimeout(120);
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

await browser.close();

const summary = {
  when: new Date().toISOString(),
  world: { name: worldName },
  initial: { values: initialValues, bands: restBands.length, centers },
  focus: { focusInk, otherInk },
  drag: { before: beforeDrag[0], after: dragged[0], coupled: afterCoupling, changedOthers },
  pluck: { before: beforePluck[0], after: afterPluck[0], amplitude: pluckState.amplitude },
  threshold: { resonant: true },
  crossings,
  audio: { state: audioState, rms: finalRms },
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
