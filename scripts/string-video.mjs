/**
 * 单弦调律台（v0.6）演示视频：
 * 白纸 → 点击波颤 → 拉弓释放 → 键盘触点 → Tab 换弦类 → ESC 总谱 → 回来。
 *
 * 运行：node scripts/string-video.mjs
 * 产出：docs/media/string-7s.mp4（72 帧 × 100ms = 7.2s）
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

mkdirSync('artifacts', { recursive: true });
mkdirSync('docs/media', { recursive: true });
for (const file of readdirSync('artifacts')) {
  if (file.startsWith('string-frame-')) rmSync(`artifacts/${file}`, { force: true });
}

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(1000);

const FRAMES = 72;
for (let i = 0; i < FRAMES; i++) {
  if (i === 6) await page.mouse.click(720, 250); // 点击：波形颤动
  if (i === 16) await page.mouse.click(420, 690); // 点击另一处：方向相反
  if (i === 24) {
    await page.mouse.move(560, 450);
    await page.mouse.down();
  }
  if (i >= 25 && i <= 29) await page.mouse.move(560, 450 - (i - 24) * 42, { steps: 0 });
  if (i === 31) await page.mouse.up(); // 拉弓释放
  if (i === 38) await page.keyboard.press('a'); // 键盘触点淡字 + 局部行波
  if (i === 40) await page.keyboard.press('s');
  if (i === 42) await page.keyboard.press('d');
  if (i === 48) await page.keyboard.press('Tab'); // 切换弦类
  if (i === 50) await page.keyboard.press('Tab');
  if (i === 58) await page.keyboard.press('Escape'); // 总谱
  if (i === 66) await page.keyboard.press('Escape'); // 回到单弦

  await page.screenshot({ path: `artifacts/string-frame-${String(i).padStart(3, '0')}.png` });
  await page.waitForTimeout(100);
}

await browser.close();

const args = [
  '-y',
  '-framerate',
  '10',
  '-i',
  'artifacts/string-frame-%03d.png',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  'docs/media/string-7s.mp4',
];
const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('ffmpeg failed');
  process.exit(result.status ?? 1);
}
console.log('docs/media/string-7s.mp4');
