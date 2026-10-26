/**
 * 生成 docs/images/string-*.png：单弦调律台（v0.6）的文档截图。
 *
 * 运行：node scripts/string-shots.mjs（需要 127.0.0.1:5188 的 dev server）
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('docs/images', { recursive: true });
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(1000);

// 1. 首屏：一张白纸 + 正中一根墨线
await page.screenshot({ path: 'docs/images/string-rest.png' });

// 2. 拉弦：按住向上拉成弓形（近黑、峰部变粗）
await page.mouse.move(420, 450);
await page.mouse.down();
await page.mouse.move(420, 200, { steps: 12 });
await page.waitForTimeout(260);
await page.screenshot({ path: 'docs/images/string-pull.png' });

// 3. 点击：局部行波、波峰更粗、黑色帧残留（比拉弓释放更像“弦在颤”）
await page.mouse.up();
await page.waitForTimeout(600);
await page.evaluate(() => window.__neurouString.reset());
await page.waitForTimeout(220);
await page.mouse.click(720, 250);
await page.waitForTimeout(160);
await page.screenshot({ path: 'docs/images/string-wave.png' });
await page.waitForTimeout(900);

// 4. 键盘：触点处浮现键字（隐形键盘映射）
await page.evaluate(() => window.__neurouString.reset());
await page.waitForTimeout(220);
await page.keyboard.press('g');
await page.waitForTimeout(90);
await page.screenshot({ path: 'docs/images/string-key.png' });

// 5. Tab：切换弦类（类名浮现 + 新波种演示）
await page.keyboard.press('Tab');
await page.waitForTimeout(240);
await page.keyboard.press('Tab');
await page.waitForTimeout(260);
await page.screenshot({ path: 'docs/images/string-tab.png' });

// 6. ESC：8 类弦签名波总谱
await page.keyboard.press('Escape');
await page.waitForTimeout(380);
await page.screenshot({ path: 'docs/images/string-overview.png' });

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await browser.close();
console.log('docs/images/string-*.png');
