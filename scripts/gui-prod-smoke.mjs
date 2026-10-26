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
const bg = await page.locator('[data-testid="desk"]').evaluate((n) => getComputedStyle(n).backgroundColor);
const network = await page.locator('[data-testid="network"]').boundingBox();
const strings = await page.locator('[data-string]').count();
const flows = await page.locator('.string__flow').count();
const loops = await page.locator('[data-loop]').count();
const forcings = await page.locator('[data-forcing]').count();
const labels = await page.locator('.voice__label').count();
const sidebars = await page.locator('.desk__entities, .desk__preview, .desk__toolbar').count();
const hint = await page.locator('.desk__keys').evaluate((n) => ({
  opacity: Number(getComputedStyle(n).opacity),
  pe: getComputedStyle(n).pointerEvents,
}));
const controls = await page.locator('[data-testid="desk-controls"]').evaluate((n) => {
  const r = n.getBoundingClientRect();
  return { x: r.left, y: r.top, bg: getComputedStyle(n).backgroundColor, opacity: Number(getComputedStyle(n).opacity) };
});
await page.screenshot({ path: 'artifacts/60-prod.png' });

await page.keyboard.press('r');
await page.waitForSelector('[data-testid="publish-result"]', { timeout: 15000 });
const lines = await page.locator('[data-publish-line]').allInnerTexts();
const score = Number(lines[0]?.trim() ?? -1);

console.log(
  JSON.stringify(
    {
      hasDesk,
      bg,
      network: network ? `${Math.round(network.width)}×${Math.round(network.height)}` : 'none',
      strings,
      flows,
      loops,
      forcings,
      labels,
      sidebars,
      hint,
      controls,
      score,
      lines,
      errors,
    },
    null,
    2,
  ),
);
await browser.close();
process.exitCode =
  hasDesk &&
  bg === 'rgb(250, 250, 250)' &&
  network?.width === 1440 &&
  network?.height === 900 &&
  strings === 23 &&
  flows === strings &&
  loops === 6 &&
  forcings === 6 &&
  labels === 7 &&
  sidebars === 0 &&
  hint.opacity <= 0.25 &&
  hint.pe === 'none' &&
  controls.bg === 'rgba(0, 0, 0, 0)' &&
  controls.opacity <= 0.5 &&
  score === 58 &&
  lines.length <= 2 &&
  errors.length === 0
    ? 0
    : 1;
