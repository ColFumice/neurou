/**
 * 生成 docs/images/string-*.png：八弦调律台 v1.1 的文档截图。
 *
 * 注意：脚本里的真实手势会让调律台写回 examples/tuner.nro。
 * 结束时用 git 恢复该文件（文档截图不需要留下副作用）。
 *
 * 运行：node scripts/string-shots.mjs（需要 127.0.0.1:5188 的 dev server）
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const WORLD_FILE = 'examples/tuner.nro';
const restoreWorld = () => {
  try {
    execFileSync('git', ['checkout', '--', WORLD_FILE], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
};
process.on('exit', restoreWorld);

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

const focusBaselineY = () =>
  page.evaluate(() => {
    const lane = window.__neurouString.state().lanes[0];
    const norm = Math.min(1, Math.max(0, (lane.value - lane.min) / (lane.max - lane.min || 1)));
    return 790 - norm * 680;
  });

// 1. 首屏：一张白纸 + 世界驱动的八根弦（焦点信任，左侧有极淡的耦合标记）
await page.screenshot({ path: 'docs/images/string-eight.png' });

// 1b. 耦合编辑：hover「信任↔色温」标记，滚一点强度，截图后把世界恢复干净
const colorMark = await page.evaluate(() => {
  const marks = window.__neurouString.couplingMarks();
  return marks.find((m) => m.from === '信任' && m.to === '色温') ?? null;
});
if (colorMark) {
  await page.mouse.move(colorMark.x, colorMark.y);
  await page.waitForTimeout(220);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'docs/images/string-coupling-edit.png' });
  restoreWorld();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="string-field"]');
  await page.waitForTimeout(1000);
}

// 1c. 按住绷弦：在弦上方按住不动，波峰被钉在按点，松手释放
const holdY = await focusBaselineY();
await page.mouse.move(720, Math.round(holdY - 150));
await page.mouse.down();
await page.waitForTimeout(380);
await page.screenshot({ path: 'docs/images/string-hold.png' });
await page.mouse.up();
await page.waitForTimeout(900);
// 1c2. 键盘多键同时按住：两个静态平滑峰
await page.keyboard.down('a');
await page.keyboard.down('d');
await page.waitForTimeout(420);
await page.screenshot({ path: 'docs/images/string-multikey.png' });
await page.keyboard.up('a');
await page.keyboard.up('d');
await page.waitForTimeout(500);
restoreWorld();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(1000);

// 1d. 增删耦合：Shift+↓ 选目标，右侧出现极淡连接线（不落盘，只展示手势）
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await page.waitForTimeout(220);
await page.screenshot({ path: 'docs/images/string-link.png' });
await page.keyboard.press('Escape');

// 1e. 增删弦：Alt+Enter 新增同类弦，ArrowRight 切到它，截图后删掉并恢复世界
await page.keyboard.press('Alt+Enter');
await page.waitForTimeout(1600);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(260);
await page.screenshot({ path: 'docs/images/string-addstring.png' });
await page.keyboard.press('Alt+Backspace');
await page.waitForTimeout(1600);
restoreWorld();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(1000);

// 2. 拖弦写回世界：信任下移 100px，等 1–2 拍看耦合弦自己波动
const baseY = await focusBaselineY();
await page.mouse.move(720, Math.round(baseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(baseY) + 100, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1300);
await page.screenshot({ path: 'docs/images/string-coupling.png' });

// 3. 阈值共振：信任拖到悬崖 25 附近
await page.evaluate(() => window.__neurouString.setValue('叙事', 26));
await page.waitForTimeout(320);
await page.screenshot({ path: 'docs/images/string-resonance.png' });

// 4. 干涉：两根弦靠近，波穿过交点
await page.evaluate(() => {
  window.__neurouString.setValue('叙事', 60);
  window.__neurouString.setValue('视觉', 61);
});
await page.waitForTimeout(260);
await page.mouse.click(720, 300);
await page.waitForTimeout(320);
await page.screenshot({ path: 'docs/images/string-interference.png' });

// 5. D-膜：缩短跨度（弦变短、音变高）
await page.evaluate(() => window.__neurouString.setSpan(0.72));
await page.waitForTimeout(320);
await page.screenshot({ path: 'docs/images/string-span.png' });
await page.evaluate(() => window.__neurouString.reset());

// 6. 紧致化结点：悬停展开 + 滚轮
const knotBaseY = await focusBaselineY();
await page.mouse.move(Math.round(1440 * 0.62), Math.round(knotBaseY));
await page.waitForTimeout(180);
await page.mouse.wheel(0, 140);
await page.waitForTimeout(240);
await page.screenshot({ path: 'docs/images/string-knot.png' });
await page.evaluate(() => window.__neurouString.reset());

// 7. 对偶翻转：极值重拨，弦塌缩成小环（同时翻真实值）
await page.evaluate(() => window.__neurouString.setValue('叙事', 99));
await page.waitForTimeout(180);
await page.evaluate(() => window.__neurouString.pluckAt(720, 800));
await page.waitForTimeout(260);
await page.screenshot({ path: 'docs/images/string-dual.png' });
await page.waitForTimeout(800);

// 8. ESC：8 类弦的总谱
await page.evaluate(() => window.__neurouString.reset());
await page.keyboard.press('Escape');
await page.waitForTimeout(380);
await page.screenshot({ path: 'docs/images/string-overview.png' });

await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 9. 打开任意世界 + 同类多根弦（v1.1）
await page.goto('http://127.0.0.1:5188/?world=examples/rain-slice.nro', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(1400);
await page.screenshot({ path: 'docs/images/string-worlds.png' });
// 雨循环里叙事弦有多根：方向键切到同类下一根
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/images/string-instance.png' });

await browser.close();
restoreWorld();
console.log('docs/images/string-*.png');
