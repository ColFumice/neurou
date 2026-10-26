import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="scene"]', { timeout: 10000 });
const hasScene = (await page.locator('[data-testid="scene"]').count()) === 1;
await page.locator('[data-testid="open-publish"]').click();
await page.waitForSelector('[data-testid="publish-result"]', { timeout: 15000 });
const text = await page.locator('[data-testid="publish-result"]').innerText();
const score = Number((text.match(/(\d+)\s*\/100/) ?? [])[1] ?? -1);
console.log(JSON.stringify({ hasScene, score, errors }, null, 2));
await browser.close();
process.exitCode = hasScene && score > 0 && errors.length === 0 ? 0 : 1;
