import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

mkdirSync('artifacts', { recursive: true });
mkdirSync('docs/media', { recursive: true });
rmSync('artifacts/ink-frame-000.png', { force: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="ink-app"]');
await page.waitForTimeout(900);

const FRAMES = 30;
for (let i = 0; i < FRAMES; i++) {
  if (i === 4) await page.mouse.move(700, 180);
  if (i === 9) {
    await page.mouse.down();
    await page.mouse.move(700, 100, { steps: 6 });
  }
  if (i === 15) await page.mouse.up();
  if (i === 17) await page.mouse.move(700, 180);
  if (i === 20) await page.keyboard.press('Tab');
  if (i === 24) await page.keyboard.press('Tab');
  await page.screenshot({ path: `artifacts/ink-frame-${String(i).padStart(3, '0')}.png` });
  await page.waitForTimeout(90);
}

await browser.close();

const args = [
  '-y',
  '-framerate',
  '10',
  '-i',
  'artifacts/ink-frame-%03d.png',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  'docs/media/ink-3s.mp4',
];
const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('ffmpeg failed');
  process.exit(result.status ?? 1);
}
console.log('docs/media/ink-3s.mp4');
