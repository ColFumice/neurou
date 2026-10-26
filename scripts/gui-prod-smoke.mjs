import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="ink-app"]', { timeout: 10000 });

const bg = await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor);
const nodes = await page.locator('[data-node]').count();
const strings = await page.locator('[data-string]').count();
const loops = await page.locator('[data-loop]').count();
const flows = await page.locator('.ink-flow').count();
const extraUi = await page.locator('button, input, .desk__toolbar, .desk__preview').count();
await page.screenshot({ path: 'artifacts/60-prod.png' });

await page.mouse.move(700, 180);
await page.waitForTimeout(300);
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
const inverted = await page.locator('[data-testid="ink-app"]').getAttribute('data-inverted');
const blur = await page.locator('.ink-base').evaluate((n) => getComputedStyle(n).filter);
const focusStrings = await page.locator('[data-focus-string]').count();
await page.screenshot({ path: 'artifacts/61-prod-tab.png' });

console.log(
  JSON.stringify(
    { bg, nodes, strings, loops, flows, extraUi, inverted, blur, focusStrings, errors },
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
  inverted === 'true' &&
  blur.includes('blur(2px)') &&
  focusStrings >= 1 &&
  errors.length === 0
    ? 0
    : 1;
