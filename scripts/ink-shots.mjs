/**
 * 生成 docs/images/ink-*.png：v0.5 墨网测试体的文档截图。
 *
 * 运行：node scripts/ink-shots.mjs（需要 127.0.0.1:5188 的 dev server）
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('docs/images', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="ink-app"]');
await page.waitForTimeout(1200);

// 1. 默认：白纸、四根横弦、回路、底部基准弦
await page.screenshot({ path: 'docs/images/ink-desk.png' });

// 2. 悬停：弦被拉成拱形，墨影 + 拉丝
await page.mouse.move(700, 180);
await page.waitForTimeout(360);
await page.screenshot({ path: 'docs/images/ink-hover.png' });

// 3. 拖动：控制点继续被拉，值刻度移动
await page.mouse.down();
await page.mouse.move(700, 110, { steps: 8 });
await page.waitForTimeout(320);
await page.screenshot({ path: 'docs/images/ink-drag.png' });
await page.mouse.up();
await page.waitForTimeout(450);

// 4. 点击空白：墨从该点生长（0.95s 约为绽放峰值）
await page.mouse.move(1300, 560);
await page.waitForTimeout(200);
await page.mouse.click(620, 520);
await page.waitForTimeout(950);
await page.screenshot({ path: 'docs/images/ink-bloom.png' });
await page.waitForTimeout(2300);

// 5. 基准弦：三次点击塑形成波形（同时发声）
await page.mouse.click(320, 838);
await page.waitForTimeout(200);
await page.mouse.click(720, 788);
await page.waitForTimeout(200);
await page.mouse.click(1120, 812);
await page.waitForTimeout(900);
await page.screenshot({ path: 'docs/images/ink-wave.png' });

// 6. Tab 反色：黑底白线、基础层失焦、悬停弦清晰（基准弦保持清晰）
await page.mouse.move(700, 180);
await page.waitForTimeout(260);
await page.keyboard.press('Tab');
await page.waitForTimeout(380);
await page.screenshot({ path: 'docs/images/ink-tab.png' });

// 7. Tab 中点击「环境」节点：节点与压力弦聚焦
await page.mouse.click(112, 700);
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/images/ink-tab-node.png' });

// 复位
await page.keyboard.press('Tab');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await browser.close();
console.log('docs/images/ink-*.png');
