/**
 * 八弦叠影（v0.7）演示视频：默认八弦 → 拨动 → Tab 换焦点 → 干涉 → 共振 → ESC 总谱。
 *
 * 运行：node scripts/string-video.mjs
 * 产出：docs/media/string-8s.mp4（80 帧 × 100ms = 8s）
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

const FRAMES = 80;
for (let i = 0; i < FRAMES; i++) {
  if (i === 6) await page.mouse.click(720, 300); // 拨动焦点弦
  if (i === 14) await page.keyboard.press('Tab'); // 焦点换到视觉弦
  if (i === 18) await page.mouse.click(500, 560); // 再拨
  if (i === 24) {
    // 让叙事/视觉两根弦靠近，制造干涉
    await page.evaluate(() => {
      window.__neurouString.setValue('叙事', 50);
      window.__neurouString.setValue('视觉', 52);
    });
    await page.keyboard.press('Tab'); // 回到叙事
  }
  if (i === 28) await page.mouse.click(420, 360); // 拨动 → 波穿过交点
  if (i === 38) await page.evaluate(() => window.__neurouString.setValue('叙事', 50));
  if (i === 42) await page.mouse.click(760, 360); // 共振态拨弦 = 和弦
  if (i === 52) {
    await page.evaluate(() => window.__neurouString.reset());
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape'); // 总谱
  }
  if (i === 68) await page.keyboard.press('Escape'); // 回到八弦
  if (i === 72) await page.keyboard.press('Tab');

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
  'docs/media/string-8s.mp4',
];
const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('ffmpeg failed');
  process.exit(result.status ?? 1);
}
console.log('docs/media/string-8s.mp4');
