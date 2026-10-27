/**
 * 生产包冒烟：vite build 之后用 vite preview（5189）跑一遍八弦调律台 v0.8。
 * 运行前：
 *   pnpm --filter @neurou/gui exec vite preview --host 127.0.0.1 --port 5189 --strictPort
 *   node scripts/gui-prod-smoke.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5189/';
const WORLD_PATH = 'examples/tuner.nro';
const worldBefore = readFileSync(WORLD_PATH, 'utf8');
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
const values = async () => JSON.parse(String((await attr('data-values')) ?? '[]'));
const bg = await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor);
const canvases = await page.locator('[data-testid="string-canvas"]').count();
const extraUi = await page.locator('button, input, textarea, select').count();
const world = await attr('data-world');
const lanes = Number(await attr('data-lane-count'));
const initial = await values();
const app = page.locator('[data-testid="ink-app"]');
const loading = await app.getAttribute('data-loading');
await page.screenshot({ path: 'artifacts/60-prod-world.png' });

// 拖弦写回世界 → 下一拍耦合传导
const baseY = await page.evaluate(() => {
  const lane = window.__neurouString.state().lanes[0];
  const norm = Math.min(1, Math.max(0, (lane.value - lane.min) / (lane.max - lane.min || 1)));
  return 790 - norm * 680;
});
await page.mouse.move(720, Math.round(baseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(baseY) + 90, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1200);
const afterDrag = await values();
const coupled = afterDrag.filter((v, i) => i > 0 && Math.abs(v - initial[i]) > 0.5).length;
// 生产包没有写回中间件：手势只能改运行时，文件必须原样
const prodSave = {
  state: await app.getAttribute('data-save-state'),
  saves: Number(await app.getAttribute('data-saves')),
  fileUnchanged: readFileSync(WORLD_PATH, 'utf8') === worldBefore,
};

// 阈值共振
await page.evaluate(() => window.__neurouString.setValue('叙事', 26));
await page.waitForTimeout(200);
const threshold = { resonant: await attr('data-resonant'), value: await attr('data-resonance') };
await page.screenshot({ path: 'artifacts/61-prod-threshold.png' });

// Tab / ESC
await page.keyboard.press('Tab');
await page.waitForTimeout(180);
const kindAfterTab = await attr('data-kind');
await page.keyboard.press('Escape');
await page.waitForTimeout(320);
const overview = { mode: await attr('data-mode'), rows: Number(await attr('data-overview-rows')) };
await page.screenshot({ path: 'artifacts/62-prod-overview.png' });

const audioState = await attr('data-audio');
const rms = await page.evaluate(() => window.__neurouString?.rms?.() ?? -1);
console.log(
  JSON.stringify(
    {
      bg,
      canvases,
      extraUi,
      world,
      lanes,
      loading,
      initial,
      afterDrag,
      coupled,
      prodSave,
      threshold,
      kindAfterTab,
      overview,
      audioState,
      rms,
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
process.exitCode =
  bg === 'rgb(250, 250, 250)' &&
  canvases === 1 &&
  extraUi === 0 &&
  world === '调律台' &&
  lanes === 8 &&
  loading === 'false' &&
  initial.length === 8 &&
  Math.abs(initial[0] - 55) < 1 &&
  Math.abs(initial[7] - 0.58) < 0.05 &&
  coupled >= 2 &&
  prodSave.state === 'disabled' &&
  prodSave.saves === 0 &&
  prodSave.fileUnchanged &&
  threshold.resonant === 'true' &&
  Math.abs(Number(threshold.value) - 25) <= 0.6 &&
  kindAfterTab === '视觉' &&
  overview.mode === 'overview' &&
  overview.rows === 8 &&
  errors.length === 0
    ? 0
    : 1;
