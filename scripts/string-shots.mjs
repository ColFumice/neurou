/**
 * 生成 docs/images/string-*.png：八弦叠影（v0.7）的文档截图。
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
const dbg = (fn) => page.evaluate(fn);
const reset = async () => {
  await dbg(() => window.__neurouString.reset());
  await page.waitForTimeout(320);
};

// 1. 首屏：一张白纸 + 八根叠影的弦（焦点叙事弦）
await page.screenshot({ path: 'docs/images/string-eight.png' });

// 2. 拨动 + 干涉：两根弦靠近，奇点与涟漪
await dbg(() => {
  window.__neurouString.setValue('叙事', 50);
  window.__neurouString.setValue('视觉', 52);
});
await page.waitForTimeout(260);
await page.mouse.click(720, 300);
await page.waitForTimeout(380);
await page.screenshot({ path: 'docs/images/string-interference.png' });
await reset();

// 3. 共鸣/泛音 + 和弦：设置值落在共振点，拨一下（其余弦一起被激发）
await dbg(() => window.__neurouString.setValue('叙事', 50));
await page.waitForTimeout(320);
await page.mouse.click(760, 360);
await page.waitForTimeout(300);
await page.screenshot({ path: 'docs/images/string-resonance.png' });
await reset();

// 4. 拖动弦 = 改设置值（基线上下移动）
const baseY = await page.evaluate(() => {
  const state = window.__neurouString.state();
  return 790 - (state.values[0] / 100) * 680;
});
await page.mouse.move(720, Math.round(baseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(baseY) + 110, { steps: 10 });
await page.waitForTimeout(200);
await page.screenshot({ path: 'docs/images/string-set.png' });
await page.mouse.up();
await reset();

// 5. D-膜：缩短跨度（弦变短、音变高）
await dbg(() => window.__neurouString.setSpan(0.72));
await page.waitForTimeout(320);
await page.screenshot({ path: 'docs/images/string-span.png' });
await reset();

// 6. 紧致化结点：悬停展开 + 滚轮
await page.mouse.move(Math.round(1440 * 0.62), 212);
await page.waitForTimeout(180);
await page.mouse.wheel(0, 140);
await page.waitForTimeout(240);
await page.screenshot({ path: 'docs/images/string-knot.png' });
await reset();

// 7. 对偶翻转：极值重拨，弦塌缩成小环
await dbg(() => window.__neurouString.setValue('叙事', 99));
await page.waitForTimeout(160);
await dbg(() => window.__neurouString.pluckAt(720, 800));
await page.waitForTimeout(260);
await page.screenshot({ path: 'docs/images/string-dual.png' });
await page.waitForTimeout(800);

// 8. ESC：8 类弦的总谱
await reset();
await page.keyboard.press('Escape');
await page.waitForTimeout(380);
await page.screenshot({ path: 'docs/images/string-overview.png' });

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await browser.close();
console.log('docs/images/string-*.png');
