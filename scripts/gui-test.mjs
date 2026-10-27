/**
 * 八弦叠影（v0.7）验收：一张白纸上的 8 类弦、基线即设置、Tab 焦点、
 * 拨动/干涉/共振/D-膜/紧致化/对偶，以及 ESC 总谱。
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

// 与 stringMath 的 valueToY 一致：value 100 → y110，value 0 → y790。
const VALUE_TOP = 110;
const VALUE_BOTTOM = 790;
const valueToY = (value) => VALUE_BOTTOM - (value / 100) * (VALUE_BOTTOM - VALUE_TOP);
const DEFAULT_VALUES = [85, 76, 67, 58, 49, 40, 31, 22];

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
await page.waitForTimeout(1000);

const field = page.locator('[data-testid="string-field"]');
const attr = async (name) => field.getAttribute(name);
const state = () => page.evaluate(() => window.__neurouString.state());
const curves = () => page.evaluate(() => window.__neurouString.curves());
const lastTouch = () => page.evaluate(() => window.__neurouString.lastTouch());
const rms = () => page.evaluate(() => window.__neurouString.rms());
const reset = async () => {
  await page.evaluate(() => window.__neurouString.reset());
  await page.waitForTimeout(320);
};
const hash = async () => createHash('sha256').update(await page.screenshot()).digest('hex').slice(0, 10);
const valuesOf = async () => JSON.parse(String((await attr('data-values')) ?? '[]'));

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
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const rows = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] <= 10) continue;
        ink++;
        rows[y]++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (Math.abs(data[i] - data[i + 1]) > 1 || Math.abs(data[i + 1] - data[i + 2]) > 1) colored++;
      }
    }
    return {
      w: width,
      h: height,
      ink,
      colored,
      bbox: ink === 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      rows,
    };
  });

/** 横向带计数：连续有墨的行算一条带，允许 gap 断裂。 */
const countRowBands = (rows, threshold = 4, gapTolerance = 10) => {
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

/** 某 y 行附近的平均墨量（只看 x 300..1200，避开左侧类名）。 */
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

/** 某逻辑 x 处、y 区间内的墨像素数。 */
const columnInk = (xLogical, yMin, yMax) =>
  page.evaluate(
    ({ xLogical, yMin, yMax }) => {
      const canvas = document.querySelector('[data-testid="string-canvas"]');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const x = Math.round((xLogical / 1440) * (canvas.width - 1));
      let count = 0;
      for (let y = Math.max(0, yMin); y <= Math.min(canvas.height - 1, yMax); y++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 10) count++;
      }
      return count;
    },
    { xLogical, yMin, yMax },
  );

const strayInk = () =>
  page.evaluate(() => {
    const list = window.__neurouString.curves();
    const canvas = document.querySelector('[data-testid="string-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return -1;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let stray = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] <= 10) continue;
        const x01 = x / (width - 1);
        let nearest = 1e9;
        for (const curve of list) {
          const index = Math.round(x01 * (curve.samples.length - 1));
          const lineY = curve.baseline + curve.samples[index];
          const distance = Math.abs(y - lineY);
          if (distance < nearest) nearest = distance;
        }
        if (nearest > 8) stray++;
      }
    }
    return stray;
  });

// ============ 1. 首屏：白纸上的八根弦 ============
check('首屏是八弦场', (await page.locator('[data-testid="string-field"]').count()) === 1);
check('只有一张画布', (await page.locator('[data-testid="string-canvas"]').count()) === 1);
check('没有按钮/输入框/面板', (await page.locator('button, input, textarea, select, .panel').count()) === 0);
check('没有任何常驻 DOM 文字', (await page.evaluate(() => document.body.innerText.trim())) === '');
check('背景是纸白', (await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(250, 250, 250)');
check('默认模式是八弦', (await attr('data-mode')) === 'strings', String(await attr('data-mode')));
check('默认焦点是叙事弦', (await attr('data-kind')) === '叙事' && (await attr('data-kind-index')) === '0');
check('默认 8 个设置值', JSON.stringify(await valuesOf()) === JSON.stringify(DEFAULT_VALUES), JSON.stringify(await valuesOf()));
check('默认没有拨弦', (await attr('data-plucks')) === '0');
check('键盘映射共 46 键', (await attr('data-key-count')) === '46');
check('默认跨度满弦', Number(await attr('data-span')) === 1, String(await attr('data-span')));
check('默认不共振', (await attr('data-resonant')) === 'false');
check('默认紧致化参数 0.50', Number(await attr('data-micro')) === 0.5, String(await attr('data-micro')));
check('默认无对偶', (await attr('data-dual')) === 'false');

const restStats = await canvasStats();
const restBands = restStats ? countRowBands(restStats.rows, 120, 12) : [];
check('画布上有 8 条弦的基线', restBands.length === 8, restBands.map((b) => `${b.start}-${b.end}`).join(' | '));
const expectedYs = DEFAULT_VALUES.map((value) => valueToY(value));
const bandCenters = restBands.map((band) => (band.start + band.end) / 2);
check(
  '每根弦的基线纵坐标 = 它的设置值',
  expectedYs.every((expected) => bandCenters.some((center) => Math.abs(center - expected) <= 6)),
  `期望 ${expectedYs.map((y) => Math.round(y)).join(',')} / 实测 ${bandCenters.map((y) => Math.round(y)).join(',')}`,
);
check('静止画面没有彩色像素', restStats !== null && restStats.colored === 0, `${restStats?.colored ?? '?'}`);

const focusY = expectedYs[0];
const otherY = expectedYs[1];
const focusInk = await rowInk(focusY);
const otherInk = await rowInk(otherY);
check('焦点弦更黑更粗（其余半透明）', focusInk > otherInk * 2, `焦点 ${focusInk.toFixed(1)} vs 其它 ${otherInk.toFixed(1)}`);
const idleA = await hash();
await page.waitForTimeout(420);
const idleB = await hash();
check('焦点弦有高频微颤（两帧不同）', idleA !== idleB, `${idleA} / ${idleB}`);
await page.screenshot({ path: 'artifacts/90-string-eight.png' });

// ============ 2. Tab：焦点切换 ============
const kinds = ['叙事', '视觉', '动画', '物理', '控制', '空间', '认知', '关系'];
let tabOk = true;
const seen = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(130);
  const kind = await attr('data-kind');
  const index = Number(await attr('data-kind-index'));
  seen.push(kind);
  if (kind !== kinds[(i + 1) % 8] || index !== (i + 1) % 8) tabOk = false;
}
check('Tab 按顺序切换 8 类弦焦点', tabOk, seen.join(' → '));
check('Tab 每次演示一次拨弦', Number(await attr('data-plucks')) === 8, String(await attr('data-plucks')));
await reset();

// ============ 3. 拨动：方向、幅度、局部行波 ============
const pluckBase = valueToY((await valuesOf())[0]);
await page.mouse.click(720, Math.round(pluckBase - 150));
await page.waitForTimeout(150);
check('点击后累计一次拨弦', Number(await attr('data-plucks')) === 1, String(await attr('data-plucks')));
check('点击在弦上方 → 向上拨', (await attr('data-last-direction')) === 'up', String(await attr('data-last-direction')));
const amp = Number(await attr('data-last-amplitude'));
check('幅度 = 点击位置到该弦基线的距离', Math.abs(amp - 150) <= 5, String(amp));
const pluckState = await state();
check('松手后弦在振动', pluckState.amplitude > 40, `amplitude=${pluckState.amplitude.toFixed(1)}`);
const pluckStats = await canvasStats();
check('振动时墨量明显增加', restStats !== null && pluckStats !== null && pluckStats.ink > restStats.ink * 1.25, `${restStats?.ink} → ${pluckStats?.ink}`);
const stray = await strayInk();
check('有运动模糊/帧残留', stray > 500, `${stray}`);
await page.screenshot({ path: 'artifacts/91-string-pluck.png' });

// ============ 4. 拖动 = 改设置值（基线纵坐标） ============
await reset();
const beforeDrag = await valuesOf();
const baseY = valueToY(beforeDrag[0]);
await page.mouse.move(720, Math.round(baseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(baseY) + 102, { steps: 8 });
await page.waitForTimeout(140);
check('拖动弦时 data-pulling=true', (await attr('data-pulling')) === 'true');
const midDrag = await valuesOf();
check('向下拖 → 设置值变小', midDrag[0] < beforeDrag[0] - 5, `${beforeDrag[0]} → ${midDrag[0].toFixed(1)}`);
check('只有焦点弦的值改变，其它弦不动', midDrag.slice(1).every((v, i) => Math.abs(v - beforeDrag[i + 1]) < 0.01));
const plucksAtDrag = Number(await attr('data-plucks'));
await page.mouse.up();
await page.waitForTimeout(220);
check('松手不额外拨弦', Number(await attr('data-plucks')) === plucksAtDrag);
const draggedBands = countRowBands((await canvasStats()).rows, 120, 12);
check(
  '基线的确移动了（仍是 8 条）',
  draggedBands.length === 8 && draggedBands.some((band) => Math.abs((band.start + band.end) / 2 - valueToY(midDrag[0])) <= 6),
  `新基线 ${Math.round(valueToY(midDrag[0]))}`,
);
const plucksBeforeTap = Number(await attr('data-plucks'));
const tapValues = await valuesOf();
await page.mouse.click(720, Math.round(valueToY(tapValues[0])));
await page.waitForTimeout(120);
check('在弦上快速点触=拨弦而不是改值', Number(await attr('data-plucks')) === plucksBeforeTap + 1 && Math.abs((await valuesOf())[0] - tapValues[0]) < 0.01);
await reset();

// ============ 5. 键盘映射（相对焦点弦基线） ============
await page.keyboard.press('a');
await page.waitForTimeout(120);
check('按 A 也会拨弦', Number(await attr('data-plucks')) === 1);
check('A 映射到 KeyA', (await attr('data-last-key')) === 'KeyA');
const touchA = await lastTouch();
check('A 在焦点弦下方 → 向下拨', (await attr('data-last-direction')) === 'down', `keyY=${touchA.y.toFixed(0)} baseline=${Math.round(valueToY(85))}`);
await page.keyboard.press('1');
await page.waitForTimeout(100);
check('数字键在焦点弦上方 → 向上拨', (await attr('data-last-direction')) === 'up', String(await attr('data-last-direction')));
await page.mouse.click(touchA.x, touchA.y);
await page.waitForTimeout(80);
const touchClick = await lastTouch();
check('鼠标点在键位中心与按 A 是同一个触点', touchClick.keyCode === 'KeyA' && Math.abs(touchClick.x - touchA.x) <= 2);
await reset();

// ============ 6. 干涉：交点/奇点/跨弦耦合 ============
await page.evaluate(() => {
  window.__neurouString.setValue('叙事', 50);
  window.__neurouString.setValue('视觉', 52);
});
await page.waitForTimeout(260);
const crossBefore = Number(await attr('data-crossings'));
await page.mouse.click(720, 300);
await page.waitForTimeout(420);
const crossAfter = Number(await attr('data-crossings'));
check('拨动后出现奇点（两弦交点）', crossAfter > crossBefore, `${crossBefore} → ${crossAfter}`);
const allCurves = await curves();
const vision = allCurves.find((c) => c.kind === '视觉');
const visionAmp = vision ? Math.max(...vision.samples.map((v) => Math.abs(v))) : 0;
check('波经过交点后另一根弦被带动（半透明弦有波动）', visionAmp > 1.5, `视觉弦振幅 ${visionAmp.toFixed(1)}px`);
const crossList = await page.evaluate(() => window.__neurouString.crossings());
check('debug 能读到交点坐标', crossList.length > 0, `${crossList.length} 个`);
if (crossList.length > 0) {
  const point = crossList[0];
  await page.mouse.move(point.x * 1440, point.y);
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'artifacts/92-string-crossing.png' });
}
await reset();

// ============ 7. 共振/泛音 ============
await page.evaluate(() => window.__neurouString.setValue('叙事', 40));
await page.waitForTimeout(220);
const calmInk = (await canvasStats()).ink;
check('远离共振点时不共振', (await attr('data-resonant')) === 'false', String(await attr('data-resonant')));
await page.evaluate(() => window.__neurouString.setValue('叙事', 50));
await page.waitForTimeout(260);
check(
  '设置值到共振点 → 驻波态',
  (await attr('data-resonant')) === 'true' && Math.abs(Number(await attr('data-resonance')) - 50) < 0.01,
  `${await attr('data-resonant')} / ${await attr('data-resonance')}`,
);
const resonantInk = (await canvasStats()).ink;
check('共振态出现虚影/泛音（墨量增加）', resonantInk > calmInk * 1.05, `${calmInk} → ${resonantInk}`);
await page.screenshot({ path: 'artifacts/93-string-resonance.png' });
const plucksBeforeChord = Number(await attr('data-plucks'));
await page.mouse.click(720, 300);
await page.waitForTimeout(300);
check('共振态拨弦 = 一次和弦（焦点弦计数 +1）', Number(await attr('data-plucks')) === plucksBeforeChord + 1);
const chordCurves = await curves();
const awakened = chordCurves.filter((c) => Math.max(...c.samples.map((v) => Math.abs(v))) > 0.8);
check('和弦同时激发多根弦', awakened.length >= 3, `${awakened.length} 根在动`);
const chordRms = await rms();
check('和弦有真实声音信号', chordRms > 0.001, chordRms.toFixed(6));
await reset();

// ============ 8. D-膜：跨度与端点 ============
await page.evaluate(() => window.__neurouString.setSpan(0.7));
await page.waitForTimeout(260);
check('setSpan 后 data-span=0.70', Math.abs(Number(await attr('data-span')) - 0.7) < 0.01, String(await attr('data-span')));
const spanY = Math.round(valueToY(85));
const outsideLeft = await columnInk(200, spanY - 30, spanY + 30);
const insideLeft = await columnInk(260, spanY - 30, spanY + 30);
check('缩短跨度后弦的左端点内移', outsideLeft <= 1 && insideLeft > 2, `x=200:${outsideLeft} x=260:${insideLeft}`);
await page.screenshot({ path: 'artifacts/94-string-span.png' });
await page.evaluate(() => window.__neurouString.setSpan(1));
await page.waitForTimeout(220);
await page.mouse.move(8, spanY);
await page.mouse.down();
await page.mouse.move(8 + 130, spanY, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(220);
check('拖动 D-膜改变跨度', Number(await attr('data-span')) < 0.96, String(await attr('data-span')));
await reset();

// ============ 9. 紧致化结点：悬停 + 滚轮 ============
const knotX = 1440 * 0.62;
await page.mouse.move(Math.round(knotX), Math.round(valueToY(85)));
await page.waitForTimeout(160);
const microBefore = Number(await attr('data-micro'));
await page.mouse.wheel(0, 140);
await page.waitForTimeout(180);
const microAfter = Number(await attr('data-micro'));
check('悬停结点滚轮调整微观参数', Math.abs(microAfter - microBefore) > 0.03, `${microBefore} → ${microAfter}`);
await page.screenshot({ path: 'artifacts/95-string-knot.png' });
await reset();

// ============ 10. 对偶翻转：极值 + 重拨 ============
await page.evaluate(() => window.__neurouString.setValue('叙事', 99));
await page.waitForTimeout(160);
await page.evaluate(() => window.__neurouString.pluckAt(720, 800));
await page.waitForTimeout(200);
check('极值重拨触发对偶翻转', (await attr('data-dual')) === 'true', String(await attr('data-dual')));
await page.screenshot({ path: 'artifacts/96-string-dual.png' });
await page.waitForTimeout(800);
check('对偶结束后值翻到对侧', Math.abs((await valuesOf())[0] - 1) < 1.5, String((await valuesOf())[0]));
check('对偶动画结束后状态复位', (await attr('data-dual')) === 'false');
await reset();

// ============ 11. ESC 总谱 ============
await page.keyboard.press('Escape');
await page.waitForTimeout(320);
check('ESC 进入总览', (await attr('data-mode')) === 'overview', String(await attr('data-mode')));
check('总览有 8 行', (await attr('data-overview-rows')) === '8');
const overviewStats = await canvasStats();
const overviewBands = overviewStats ? countRowBands(overviewStats.rows, 4, 26) : [];
check('画布上画出 8 条谱线', overviewBands.length === 8, `${overviewBands.length} 条`);
await page.screenshot({ path: 'artifacts/97-string-overview.png' });
await page.keyboard.press('Tab');
await page.waitForTimeout(140);
check('总览里 Tab 仍切换当前类', (await attr('data-kind')) === '视觉', String(await attr('data-kind')));
await page.keyboard.press('Escape');
await page.waitForTimeout(260);
check('再按 ESC 回到八弦视图', (await attr('data-mode')) === 'strings');

// ============ 12. 声音 / 性能 / 错误 ============
const audioState = await attr('data-audio');
check('音频引擎可用', audioState === 'running' || audioState === 'suspended', String(audioState));
await page.mouse.click(720, 300);
await page.waitForTimeout(120);
const finalRms = await rms();
check('拨弦后 master 有真实信号（rms>0.001）', finalRms > 0.001, finalRms.toFixed(6));
await reset();
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
check('没有页面级报错', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

const summary = {
  when: new Date().toISOString(),
  rest: { ink: restStats?.ink ?? null, bands: restBands.length, centers: bandCenters },
  focus: { focusInk, otherInk },
  pluck: { amp, amplitude: pluckState.amplitude, stray },
  drag: { before: beforeDrag[0], after: midDrag[0], y: valueToY(midDrag[0]) },
  keyboard: { touchA },
  interference: { crossBefore, crossAfter, visionAmp, crossings: crossList.length },
  resonance: { calmInk, resonantInk, awakened: awakened.length, rms: chordRms },
  knot: { microBefore, microAfter },
  overview: { bands: overviewBands.length },
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
