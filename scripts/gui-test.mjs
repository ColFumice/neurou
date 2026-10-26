/**
 * 单弦调律台（v0.6）验收：一张白纸 + 一根黑弦 + 隐形键盘映射 + 8 类弦 + Tab/ESC。
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
const u = () => page.evaluate(() => window.__neurouString.u());
const lastTouch = () => page.evaluate(() => window.__neurouString.lastTouch());
const rms = () => page.evaluate(() => window.__neurouString.rms());
const reset = async () => {
  await page.evaluate(() => window.__neurouString.reset());
  await page.waitForTimeout(260);
};
const hash = async () => createHash('sha256').update(await page.screenshot()).digest('hex').slice(0, 10);

/** 画布墨迹统计：像素 alpha>10 视为墨。 */
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
    const rowCounts = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] <= 10) continue;
        ink++;
        rowCounts[y]++;
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
      rows: rowCounts,
    };
  });

/** 横向带计数（总览谱面用）：连续有墨的行算一条带，允许 2px 断裂。 */
const countRowBands = (rows, threshold = 4, gapTolerance = 26) => {
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

/** 某逻辑 x 处墨迹的纵向范围。 */
const columnExtent = (logicalX) =>
  page.evaluate((xLogical) => {
    const canvas = document.querySelector('[data-testid="string-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width, height } = canvas;
    const x = Math.round((xLogical / 1440) * (width - 1));
    const data = ctx.getImageData(0, 0, width, height).data;
    let count = 0;
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      if (data[(y * width + x) * 4 + 3] <= 10) continue;
      count++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { count, minY, maxY, span: maxY - minY + 1 };
  }, logicalX);

/** 不在当前弦几何上的残余墨像素（拖尾 / 帧残留）。 */
const strayInk = () =>
  page.evaluate(() => {
    const arr = window.__neurouString.u();
    const canvas = document.querySelector('[data-testid="string-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return -1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const n = arr.length;
    const center = height / 2;
    let stray = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] <= 10) continue;
        const idx = Math.round((x / (width - 1)) * (n - 1));
        const lineY = center + arr[idx] * (height / 900);
        if (Math.abs(y - lineY) > 8) stray++;
      }
    }
    return stray;
  });

// ============ 1. 默认：一张白纸 + 一根水平黑弦 ============
check('首屏是弦场', (await page.locator('[data-testid="string-field"]').count()) === 1);
check('只有一张画布', (await page.locator('[data-testid="string-canvas"]').count()) === 1);
check(
  '没有任何按钮/输入框/面板',
  (await page.locator('button, input, textarea, select, .desk, .panel, [data-testid="ink-network"]').count()) === 0,
);
check('没有任何常驻文字', (await page.evaluate(() => document.body.innerText.trim())) === '');
check('背景是纸白', (await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(250, 250, 250)');
check('默认模式是单弦', (await attr('data-mode')) === 'string');
check('默认是第一类弦（叙事）', (await attr('data-kind')) === '叙事' && (await attr('data-kind-index')) === '0');
check('默认没有拨弦', (await attr('data-plucks')) === '0');
check('键盘映射共 46 键', (await attr('data-key-count')) === '46', String(await attr('data-key-count')));
check('默认是静止的', (await attr('data-resting')) === 'true');

const restStats = await canvasStats();
check('静止时只有一条横线', restStats !== null && restStats.bbox.h <= 6 && restStats.bbox.w >= 1400, JSON.stringify(restStats?.bbox));
check('横线在画面正中', restStats !== null && Math.abs(restStats.bbox.y + restStats.bbox.h / 2 - 450) <= 3, `中心 y=${restStats ? restStats.bbox.y + restStats.bbox.h / 2 : '?'}`);
check('静止画面没有彩色像素', restStats !== null && restStats.colored === 0, `${restStats?.colored ?? '?'} 个彩色像素`);

const idleA = await hash();
await page.waitForTimeout(450);
const idleB = await hash();
check('静止时没有 idle 动画', idleA === idleB, `${idleA} / ${idleB}`);
await page.screenshot({ path: 'artifacts/90-string-rest.png' });

// ============ 2. 点击：方向、幅度、振动 ============
await page.mouse.click(720, 250);
await page.waitForTimeout(140);
check('点击后累计一次拨弦', (await attr('data-plucks')) === '1', String(await attr('data-plucks')));
check('点击位置在弦上方 → 向上拨', (await attr('data-last-direction')) === 'up', String(await attr('data-last-direction')));
const amp = Number(await attr('data-last-amplitude'));
check('幅度 = 点击位置到弦的距离', Math.abs(amp - 200) <= 4, String(amp));
check('点击落在隐形键盘的某个键上', (await attr('data-last-key')) !== '', String(await attr('data-last-key')));

const pluckState = await state();
check('松手后弦在振动', pluckState.amplitude > 40 && pluckState.resting === false, `amplitude=${pluckState.amplitude.toFixed(1)}`);
const pluckStats = await canvasStats();
check('振动时墨迹不再是一条线', pluckStats !== null && pluckStats.bbox.h > 20, JSON.stringify(pluckStats?.bbox));
check('振动时墨量明显增加（拖影）', restStats !== null && pluckStats !== null && pluckStats.ink > restStats.ink * 2.2, `${restStats?.ink} → ${pluckStats?.ink}`);
/** 当前行波的波峰位置/强度；用于证明点击是局部行波而不是整弦同步摆。 */
const wavePeak = () =>
  page.evaluate(() => {
    const arr = window.__neurouString.u();
    const n = arr.length;
    let absMax = 0;
    let index = 0;
    let active = 0;
    for (let i = 0; i < n; i++) {
      const value = Math.abs(arr[i]);
      if (value > absMax) {
        absMax = value;
        index = i;
      }
      if (value > 10) active++;
    }
    return {
      amp: absMax,
      x: (index / (n - 1)) * 1440,
      ends: Math.max(Math.abs(arr[2]), Math.abs(arr[n - 3]), Math.abs(arr[8]), Math.abs(arr[n - 9])),
      activeRatio: active / n,
    };
  });
const waveA = await wavePeak();
check(
  '快速点触是局部行波（两端不动、只有一段弦在响）',
  waveA.ends < 5 && waveA.activeRatio < 0.6 && waveA.amp > 40,
  `两端 ${waveA.ends.toFixed(1)}px、活动弦长 ${(waveA.activeRatio * 100).toFixed(0)}%`,
);
await page.waitForTimeout(130);
const waveB = await wavePeak();
check(
  '波包沿弦传播（两个时刻的波峰位置不同）',
  Math.abs(waveA.x - waveB.x) > 50,
  `波峰 x ${waveA.x.toFixed(0)} → ${waveB.x.toFixed(0)}`,
);
await page.screenshot({ path: 'artifacts/91-string-pluck.png' });

const hash1 = await hash();
await page.waitForTimeout(170);
const hash2 = await hash();
check('弦在逐帧运动', hash1 !== hash2, `${hash1} / ${hash2}`);

await page.waitForTimeout(220);
const stray = await strayInk();
check('有运动模糊/黑色帧残留', stray > 500, `${stray} 个残余墨像素`);

const arr = await u();
let peakIndex = 0;
let peakValue = 0;
for (let i = 0; i < arr.length; i++) if (Math.abs(arr[i]) > peakValue) { peakValue = Math.abs(arr[i]); peakIndex = i; }
let flatIndex = -1;
for (let i = 0; i < arr.length; i++) if (Math.abs(arr[i]) < 2) { flatIndex = i; break; }
const peakX = (peakIndex / (arr.length - 1)) * 1440;
const flatX = flatIndex >= 0 ? (flatIndex / (arr.length - 1)) * 1440 : 40;
const peakCol = await columnExtent(peakX);
const flatCol = await columnExtent(flatX);
check(
  '波峰位置更粗',
  peakCol !== null && flatCol !== null && peakCol.span > Math.max(4, flatCol.span * 1.5),
  `峰 ${peakCol?.span}px vs 平 ${flatCol?.span}px`,
);
check('墨是灰度（无彩色）', pluckStats !== null && pluckStats.colored === 0, `${pluckStats?.colored ?? '?'} 个彩色像素`);
await page.screenshot({ path: 'artifacts/92-string-wave.png' });

// ============ 3. 拉弦：像拉弓一样弯曲 ============
await reset();
await page.mouse.move(400, 450);
await page.mouse.down();
await page.mouse.move(400, 190, { steps: 10 });
await page.waitForTimeout(180);
check('按住拖动=正在拉弦', (await attr('data-pulling')) === 'true');
const pullAmp = (await state()).amplitude;
check('拉弦位移足够大', pullAmp > 140, String(pullAmp.toFixed(1)));
const pulled = await page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="string-canvas"]');
  const ctx = canvas.getContext('2d');
  const x = Math.round((400 / 1440) * (canvas.width - 1));
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let y = 100; y < 430; y++) {
    if (data[(y * canvas.width + x) * 4 + 3] > 10) return y;
  }
  return -1;
});
check('弦在 x=400 处被拉起', pulled > 0, pulled > 0 ? `墨迹到 y=${pulled}` : '没有墨');
await page.screenshot({ path: 'artifacts/93-string-pull.png' });
const plucksBeforeRelease = Number(await attr('data-plucks'));
await page.mouse.up();
await page.waitForTimeout(160);
check('松手=一次拨弦', Number(await attr('data-plucks')) === plucksBeforeRelease + 1);
check('松手后开始振动', (await attr('data-pulling')) === 'false' && (await state()).amplitude > 60);
await page.screenshot({ path: 'artifacts/94-string-release.png' });

// ============ 4. 键盘映射：点击哪里 = 按下哪个键 ============
await reset();
await page.keyboard.press('a');
await page.waitForTimeout(120);
check('按 A 也会拨弦', (await attr('data-plucks')) === '1', String(await attr('data-plucks')));
check('A 映射到 KeyA', (await attr('data-last-key')) === 'KeyA', String(await attr('data-last-key')));
const touchA = await lastTouch();
check('A 在弦下方 → 向下拨', (await attr('data-last-direction')) === 'down', String(await attr('data-last-direction')));
await page.mouse.click(touchA.x, touchA.y);
await page.waitForTimeout(80);
const touchClick = await lastTouch();
check(
  '鼠标点在键位中心与按 A 是同一个触点',
  touchClick.keyCode === 'KeyA' && Math.abs(touchClick.x - touchA.x) <= 2 && Math.abs(touchClick.amplitude - touchA.amplitude) <= 2,
  `键 (${touchA.x.toFixed(1)}, ${touchA.y.toFixed(1)}) vs 点 (${touchClick.x.toFixed(1)}, ${touchClick.y.toFixed(1)})`,
);
await reset();
await page.keyboard.press('1');
await page.waitForTimeout(100);
const upTouch = await lastTouch();
await page.keyboard.press('z');
await page.waitForTimeout(100);
const downTouch = await lastTouch();
check('数字键在上两行 → 向上拨', upTouch.direction === -1, `y=${upTouch.y.toFixed(1)}`);
check('底行字母键 → 向下拨', downTouch.direction === 1, `y=${downTouch.y.toFixed(1)}`);
check('不同键位对应不同弦位置', Math.abs(upTouch.x - downTouch.x) > 5, `${upTouch.x.toFixed(1)} / ${downTouch.x.toFixed(1)}`);

// ============ 5. Tab：8 类弦循环 ============
await reset();
const kindOrder = ['叙事', '视觉', '动画', '物理', '控制', '空间', '认知', '关系'];
let kindOk = true;
const seenKinds = [];
const plucksBeforeTab = Number(await attr('data-plucks'));
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(140);
  const kind = await attr('data-kind');
  const index = Number(await attr('data-kind-index'));
  seenKinds.push(kind);
  if (kind !== kindOrder[(i + 1) % 8] || index !== (i + 1) % 8) kindOk = false;
}
check('Tab 依次切换 8 类弦', kindOk, seenKinds.join(' → '));
check('Tab 每次都会演示一次拨弦', Number(await attr('data-plucks')) === plucksBeforeTab + 8, `${plucksBeforeTab} → ${await attr('data-plucks')}`);
await page.screenshot({ path: 'artifacts/95-string-kind.png' });

// ============ 6. ESC：8 类弦总谱 ============
await reset();
await page.keyboard.press('Escape');
await page.waitForTimeout(320);
check('ESC 进入总览', (await attr('data-mode')) === 'overview', String(await attr('data-mode')));
check('总览有 8 行', (await attr('data-overview-rows')) === '8', String(await attr('data-overview-rows')));
const overviewStats = await canvasStats();
const bands = overviewStats ? countRowBands(overviewStats.rows) : [];
check('画布上确实画出 8 条谱线', bands.length === 8, bands.length ? bands.map((b) => `${b.start}-${b.end}`).join(' | ') : '0 条');
const overviewState = await state();
const currentBand = bands[overviewState.kindIndex] ?? null;
if (overviewStats && currentBand && bands.length === 8) {
  // 当前类那一行应该最深：在 x=300..1200 的中间段比较平均墨量。
  const bandInk = await page.evaluate(
    ({ bands: all, kindIndex }) => {
      const canvas = document.querySelector('[data-testid="string-canvas"]');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const measure = (band) => {
        let total = 0;
        for (let y = band.start; y <= band.end; y++) {
          for (let x = 300; x < 1200; x++) total += data[(y * canvas.width + x) * 4 + 3];
        }
        return total / ((band.end - band.start + 1) * 900);
      };
      return { current: measure(all[kindIndex]), others: all.filter((_, i) => i !== kindIndex).map(measure) };
    },
    { bands, kindIndex: overviewState.kindIndex },
  );
  check(
    '当前类在总览里最黑',
    bandInk.current > Math.max(...bandInk.others) * 1.6,
    `当前 ${bandInk.current.toFixed(1)} vs 其余最大 ${Math.max(...bandInk.others).toFixed(1)}`,
  );
} else {
  check('当前类在总览里最黑', false, '谱带读取失败');
}
await page.screenshot({ path: 'artifacts/96-string-overview.png' });

await page.keyboard.press('Tab');
await page.waitForTimeout(160);
check('总览里 Tab 仍切换当前类', Number(await attr('data-kind-index')) === (overviewState.kindIndex + 1) % 8, String(await attr('data-kind-index')));

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('再按 ESC 回到单弦', (await attr('data-mode')) === 'string');
check('回到单弦后又是一根线', (await canvasStats())?.bbox.h <= 8, JSON.stringify((await canvasStats())?.bbox));

// ============ 7. 声音（本地合成，不验证听感，只验证非静音） ============
const audioState = await attr('data-audio');
check('音频引擎可用', audioState === 'running' || audioState === 'suspended', String(audioState));
await page.mouse.click(900, 250);
await page.waitForTimeout(120);
const rmsValue = await rms();
check('拨弦后 master 有真实信号（rms>0.001）', rmsValue > 0.001, rmsValue.toFixed(6));
await reset();

// ============ 8. 性能与错误 ============
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
  default: { restInk: restStats?.ink ?? null, restBBox: restStats?.bbox ?? null },
  pluck: { amplitude: pluckState.amplitude, peakSpan: peakCol?.span ?? null, flatSpan: flatCol?.span ?? null, stray },
  keyboard: { keyCount: 46, touchA, upTouch, downTouch },
  kinds: seenKinds,
  overview: { bands: bands.length, kindIndex: overviewState.kindIndex },
  audio: { state: audioState, rms: rmsValue },
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
