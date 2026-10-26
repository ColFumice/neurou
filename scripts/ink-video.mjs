/**
 * 墨网 v0.5 演示视频：呼吸 / 悬停 / 拖动 / 点击生墨 / 基准弦塑形 / Tab 反色 / Escape 复位。
 *
 * 运行：node scripts/ink-video.mjs
 * 产出：docs/media/ink-6s.mp4（64 帧 × 100ms = 6.4s）
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

mkdirSync('artifacts', { recursive: true });
mkdirSync('docs/media', { recursive: true });
for (const file of readdirSync('artifacts')) {
  if (file.startsWith('ink-frame-')) rmSync(`artifacts/${file}`, { force: true });
}

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="ink-app"]');
await page.waitForTimeout(1000);

const FRAMES = 64;
for (let i = 0; i < FRAMES; i++) {
  // 0–1s 静息呼吸（弦自己在动）
  if (i === 4) await page.mouse.move(700, 180);
  // 0.8–1.6s 悬停 → 拖动改值 → 回弹
  if (i === 8) await page.mouse.down();
  if (i >= 9 && i <= 14) await page.mouse.move(700, 180 - (i - 8) * 12, { steps: 0 });
  if (i === 16) await page.mouse.up();
  if (i === 18) await page.mouse.move(700, 180);
  // 2.2s 点击空白：墨从无到有生长，约 2.6s 内消散
  if (i === 22) await page.mouse.click(620, 520);
  // 3.2–3.6s 基准弦三次点击：塑形成波形 + 拨弦发声
  if (i === 32) await page.mouse.click(320, 838);
  if (i === 34) await page.mouse.click(720, 788);
  if (i === 36) await page.mouse.click(1120, 812);
  // 4.4s Tab 反色 + 失焦
  if (i === 44) await page.keyboard.press('Tab');
  // 5.2s 回白底；5.5s Escape 复位基准弦
  if (i === 52) await page.keyboard.press('Tab');
  if (i === 55) await page.keyboard.press('Escape');

  await page.screenshot({ path: `artifacts/ink-frame-${String(i).padStart(3, '0')}.png` });
  await page.waitForTimeout(100);
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
  'docs/media/ink-6s.mp4',
];
const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('ffmpeg failed');
  process.exit(result.status ?? 1);
}
console.log('docs/media/ink-6s.mp4');
