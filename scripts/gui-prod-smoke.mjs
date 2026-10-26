/**
 * 生产包冒烟：vite build 之后用 vite preview（5189）跑一遍单弦调律台。
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
const bg = await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor);
const canvases = await page.locator('[data-testid="string-canvas"]').count();
const extraUi = await page.locator('button, input, textarea, select').count();
const keyCount = Number(await field.getAttribute('data-key-count'));
const initial = {
  mode: await field.getAttribute('data-mode'),
  kind: await field.getAttribute('data-kind'),
  plucks: Number(await field.getAttribute('data-plucks')),
};
await page.screenshot({ path: 'artifacts/60-prod-rest.png' });

// 点击 → 波形
await page.mouse.click(720, 250);
await page.waitForTimeout(160);
const afterClick = {
  plucks: Number(await field.getAttribute('data-plucks')),
  direction: await field.getAttribute('data-last-direction'),
  amplitude: Number(await field.getAttribute('data-last-amplitude')),
  audio: await field.getAttribute('data-audio'),
  rms: await page.evaluate(() => window.__neurouString?.rms?.() ?? -1),
  amplitudeNow: await page.evaluate(() => window.__neurouString?.state?.().amplitude ?? 0),
};
await page.screenshot({ path: 'artifacts/61-prod-wave.png' });

// Tab → 换弦类
await page.keyboard.press('Tab');
await page.waitForTimeout(200);
const kindAfterTab = await field.getAttribute('data-kind');

// ESC → 总谱
await page.keyboard.press('Escape');
await page.waitForTimeout(320);
const overview = {
  mode: await field.getAttribute('data-mode'),
  rows: Number(await field.getAttribute('data-overview-rows')),
};
await page.screenshot({ path: 'artifacts/62-prod-overview.png' });

console.log(
  JSON.stringify(
    { bg, canvases, extraUi, keyCount, initial, afterClick, kindAfterTab, overview, errors },
    null,
    2,
  ),
);
await browser.close();
process.exitCode =
  bg === 'rgb(250, 250, 250)' &&
  canvases === 1 &&
  extraUi === 0 &&
  keyCount === 46 &&
  initial.mode === 'string' &&
  initial.kind === '叙事' &&
  initial.plucks === 0 &&
  afterClick.plucks === 1 &&
  afterClick.direction === 'up' &&
  afterClick.amplitude > 100 &&
  (afterClick.audio === 'running' || afterClick.audio === 'suspended') &&
  afterClick.amplitudeNow > 40 &&
  kindAfterTab === '视觉' &&
  overview.mode === 'overview' &&
  overview.rows === 8 &&
  errors.length === 0
    ? 0
    : 1;
