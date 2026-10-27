/**
 * 八弦调律台 v1.1 演示视频：真实世界驱动。
 * 默认八弦 → 拨动 → 拖弦写回世界 → 耦合波 → Tab 换焦点 → 阈值共振 → ESC 总谱。
 *
 * 注意：视频里的真实手势会写回 examples/tuner.nro；结束时用 git 恢复。
 *
 * 运行：node scripts/string-video.mjs
 * 产出：docs/media/string-9s.mp4（90 帧 × 100ms = 9s）
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const WORLD_FILE = 'examples/tuner.nro';
const restoreWorld = () => {
  try {
    execFileSync('git', ['checkout', '--', WORLD_FILE], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
};
process.on('exit', restoreWorld);

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

const baseY = await page.evaluate(() => {
  const lane = window.__neurouString.state().lanes[0];
  const norm = Math.min(1, Math.max(0, (lane.value - lane.min) / (lane.max - lane.min || 1)));
  return 790 - norm * 680;
});

const FRAMES = 90;
for (let i = 0; i < FRAMES; i++) {
  if (i === 6) await page.mouse.click(720, 300); // 拨动信任：值 + 视觉波
  if (i === 14) await page.mouse.move(720, Math.round(baseY));
  if (i === 16) await page.mouse.down();
  if (i >= 17 && i <= 24) await page.mouse.move(720, Math.round(baseY) + (i - 16) * 14, { steps: 0 });
  if (i === 26) await page.mouse.up(); // 写回世界；下一拍耦合
  if (i === 32) await page.mouse.click(560, 420); // 再拨一根
  if (i === 40) await page.keyboard.press('Tab'); // 焦点换到色温
  if (i === 48) await page.evaluate(() => window.__neurouString.setValue('叙事', 26)); // 阈值共振
  if (i === 52) await page.mouse.click(760, 360); // 共振和弦
  if (i === 60) {
    await page.evaluate(() => window.__neurouString.reset());
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape'); // 总谱
  }
  if (i === 76) await page.keyboard.press('Escape'); // 回到八弦
  if (i === 80) await page.keyboard.press('Tab');

  await page.screenshot({ path: `artifacts/string-frame-${String(i).padStart(3, '0')}.png` });
  await page.waitForTimeout(100);
}

await browser.close();
restoreWorld();

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
  'docs/media/string-9s.mp4',
];
const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('ffmpeg failed');
  process.exit(result.status ?? 1);
}
console.log('docs/media/string-9s.mp4');
