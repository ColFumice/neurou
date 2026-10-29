/**
 * 生产包世界选择冒烟（v3.4）：验证 build 里内联了所有示例世界，
 * `?world=` 与 `?seed=` 在生产包同样生效。
 */
import { chromium } from 'playwright';

const URL = `${process.argv[2] ?? 'http://127.0.0.1:5189/'}?world=${encodeURIComponent('examples/relational.nro')}&seed=42`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});
try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
  await page.waitForTimeout(900);
  const app = page.locator('[data-testid="ink-app"]');
  const worldFile = await app.getAttribute('data-world-file');
  const seed = await app.getAttribute('data-seed');
  const world = await page.locator('[data-testid="string-field"]').getAttribute('data-world');
  await page.keyboard.press('F3');
  await page.waitForTimeout(800);
  const matrixCount = await page.locator('[data-testid="matrix-field"]').getAttribute('data-matrix-count');
  await page.screenshot({ path: 'artifacts/62-prod-world-select.png' });
  const ok = worldFile === 'examples/relational.nro' && seed === '42' && matrixCount === '2' && errors.length === 0;
  console.log(JSON.stringify({ worldFile, seed, world, matrixCount, errors }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
}
