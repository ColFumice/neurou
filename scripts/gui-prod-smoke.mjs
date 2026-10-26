/**
 * 生产包冒烟：vite build 之后用 vite preview（5189）跑一遍核心交互。
 * 运行前先停掉 5188 的 dev server 或直接另开 5189：
 *   pnpm --filter @neurou/gui exec vite preview --host 127.0.0.1 --port 5189 --strictPort
 *   node scripts/gui-prod-smoke.mjs
 */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5189/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="ink-app"]', { timeout: 10000 });
await page.waitForTimeout(800);

const bg = await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor);
const nodes = await page.locator('[data-node]').count();
const strings = await page.locator('[data-string]').count();
const loops = await page.locator('[data-loop]').count();
const flows = await page.locator('.ink-flow').count();
const extraUi = await page.locator('button, input, .desk__toolbar, .desk__preview').count();
const blooms = await page.locator('[data-testid="ink-blooms"]').count();
const wave = page.locator('[data-testid="ink-wave"]');
const waveCount = await wave.count();
await page.screenshot({ path: 'artifacts/60-prod.png' });

// 墨晕：点空白 → 生长 → 消散
await page.mouse.click(620, 520);
await page.waitForTimeout(420);
const bloomLive = Number(await page.locator('[data-testid="ink-blooms"]').getAttribute('data-blooms'));
await page.waitForTimeout(2600);
const bloomGone = Number(await page.locator('[data-testid="ink-blooms"]').getAttribute('data-blooms'));

// 基准弦：三次点击塑形 + 发声 + Escape
await page.mouse.click(320, 838);
await page.waitForTimeout(160);
await page.mouse.click(720, 788);
await page.waitForTimeout(160);
await page.mouse.click(1120, 812);
await page.waitForTimeout(600);
const wavePoints = Number(await wave.getAttribute('data-wave-points'));
const wavePlucks = Number(await wave.getAttribute('data-wave-plucks'));
const audioState = await wave.getAttribute('data-wave-audio');
const rms = await page.evaluate(() => window.__neurouWave?.rms?.() ?? -1);
const waveBBox = await page.locator('.ink-wave-line').evaluate((n) => Math.round(n.getBBox().height));
await page.screenshot({ path: 'artifacts/61-prod-wave.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const waveReset = Number(await wave.getAttribute('data-wave-points'));

await page.mouse.move(700, 180);
await page.waitForTimeout(300);
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
const inverted = await page.locator('[data-testid="ink-app"]').getAttribute('data-inverted');
const blur = await page.locator('.ink-base').evaluate((n) => getComputedStyle(n).filter);
const focusStrings = await page.locator('[data-focus-string]').count();
await page.screenshot({ path: 'artifacts/62-prod-tab.png' });

console.log(
  JSON.stringify(
    {
      bg,
      nodes,
      strings,
      loops,
      flows,
      extraUi,
      blooms,
      waveCount,
      bloomLive,
      bloomGone,
      wavePoints,
      wavePlucks,
      audioState,
      rms,
      waveBBox,
      waveReset,
      inverted,
      blur,
      focusStrings,
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
process.exitCode =
  bg === 'rgb(250, 250, 250)' &&
  nodes === 3 &&
  strings === 4 &&
  loops === 2 &&
  flows === 4 &&
  extraUi === 0 &&
  blooms === 1 &&
  waveCount === 1 &&
  bloomLive >= 1 &&
  bloomGone === 0 &&
  wavePoints === 3 &&
  wavePlucks >= 3 &&
  (audioState === 'running' || audioState === 'suspended') &&
  waveBBox >= 25 &&
  waveReset === 0 &&
  inverted === 'true' &&
  blur.includes('blur(2px)') &&
  focusStrings >= 1 &&
  errors.length === 0
    ? 0
    : 1;
