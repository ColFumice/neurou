/**
 * 生产包冒烟：vite build 之后用 vite preview（5189）跑一遍八弦叠影。
 * 运行前：
 *   pnpm --filter @neurou/gui exec vite preview --host 127.0.0.1 --port 5189 --strictPort
 *   node scripts/gui-prod-smoke.mjs
 */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5189/';
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);

const field = page.locator('[data-testid="string-field"]');
const attr = async (name) => field.getAttribute(name);
const bg = await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor);
const canvases = await page.locator('[data-testid="string-canvas"]').count();
const extraUi = await page.locator('button, input, textarea, select').count();
const values = JSON.parse(String(await attr('data-values')));
const rows = await page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="string-canvas"]');
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const counts = new Array(canvas.height).fill(0);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 10) counts[y]++;
    }
  }
  let bands = 0;
  let inBand = false;
  let gap = 0;
  for (const count of counts) {
    if (count > 120) {
      if (!inBand) bands++;
      inBand = true;
      gap = 0;
    } else if (inBand) {
      gap++;
      if (gap > 12) inBand = false;
    }
  }
  return bands;
});
await page.screenshot({ path: 'artifacts/60-prod-eight.png' });

await page.mouse.click(720, 300);
await page.waitForTimeout(160);
const afterClick = {
  plucks: Number(await attr('data-plucks')),
  direction: await attr('data-last-direction'),
  audio: await attr('data-audio'),
  rms: await page.evaluate(() => window.__neurouString?.rms?.() ?? -1),
  amplitude: await page.evaluate(() => window.__neurouString?.state?.().amplitude ?? 0),
};
await page.screenshot({ path: 'artifacts/61-prod-wave.png' });

await page.keyboard.press('Tab');
await page.waitForTimeout(200);
const kindAfterTab = await attr('data-kind');

// 焦点回到叙事弦，再把设置值调到共振点
await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(160);
await page.evaluate(() => window.__neurouString.setValue('叙事', 50));
await page.waitForTimeout(200);
const resonant = await attr('data-resonant');

await page.keyboard.press('Escape');
await page.waitForTimeout(320);
const overview = {
  mode: await attr('data-mode'),
  rows: Number(await attr('data-overview-rows')),
};
await page.screenshot({ path: 'artifacts/62-prod-overview.png' });

console.log(
  JSON.stringify(
    { bg, canvases, extraUi, values, rows, afterClick, kindAfterTab, resonant, overview, errors },
    null,
    2,
  ),
);
await browser.close();
process.exitCode =
  bg === 'rgb(250, 250, 250)' &&
  canvases === 1 &&
  extraUi === 0 &&
  JSON.stringify(values) === JSON.stringify([85, 76, 67, 58, 49, 40, 31, 22]) &&
  rows === 8 &&
  afterClick.plucks === 1 &&
  afterClick.audio !== 'unavailable' &&
  afterClick.amplitude > 40 &&
  kindAfterTab === '视觉' &&
  resonant === 'true' &&
  overview.mode === 'overview' &&
  overview.rows === 8 &&
  errors.length === 0
    ? 0
    : 1;
