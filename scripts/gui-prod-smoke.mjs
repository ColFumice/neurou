import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('http://127.0.0.1:5189/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="desk"]', { timeout: 10000 });
const hasDesk = (await page.locator('[data-testid="desk"]').count()) === 1;
const strings = await page.locator('[data-string]').count();
const loops = await page.locator('[data-loop]').count();
const forcings = await page.locator('[data-forcing]').count();
await page.keyboard.press('r');
await page.waitForSelector('[data-testid="publish-result"]', { timeout: 15000 });
const lines = await page.locator('[data-publish-line]').allInnerTexts();
const score = Number(lines[0]?.trim() ?? -1);
console.log(JSON.stringify({ hasDesk, strings, loops, forcings, score, lines, errors }, null, 2));
await browser.close();
process.exitCode = hasDesk && strings >= 15 && loops >= 5 && forcings >= 3 && score > 0 && errors.length === 0 ? 0 : 1;
