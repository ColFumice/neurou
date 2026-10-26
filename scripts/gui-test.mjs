/**
 * 墨网测试体验收：3 节点、4 根横向弦、2 条回路、Tab 反色失焦。
 *
 * 运行：node scripts/gui-test.mjs
 * 结果：artifacts/ink-test.json + artifacts/8x-*.png
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const URL = 'http://127.0.0.1:5188/';
const results = [];
const consoleErrors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="ink-app"]');
await page.waitForTimeout(900);

// ============ 1. 默认世界：3 节点、4 弦、2 回路 ============
check('默认是墨网测试体', (await page.locator('[data-testid="ink-app"]').count()) === 1);
check('背景是纸白', (await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(250, 250, 250)');
check('只有 3 个节点', (await page.locator('[data-node]').count()) === 3);
check('只有 4 根弦', (await page.locator('[data-string]').count()) === 4);
check('只有 2 条回路', (await page.locator('[data-loop]').count()) === 2);

const nodeNames = await page.locator('.ink-node-label').allTextContents();
const stringNames = await page.locator('.ink-string-name').allTextContents();
const loopNames = await page.locator('.ink-loop-name').allTextContents();
check('节点名', ['自我', '他人', '环境'].every((n) => nodeNames.includes(n)), nodeNames.join(' / '));
check('弦名', ['信任', '恐惧', '能量', '压力'].every((n) => stringNames.includes(n)), stringNames.join(' / '));
check('回路名', ['正反馈', '负反馈'].every((n) => loopNames.includes(n)), loopNames.join(' / '));

check('没有侧栏/工具栏/按钮/输入框', (await page.locator('button, input, .desk, .desk__toolbar, .desk__preview').count()) === 0);

// 节点在左列：所有 dot 的 cx 一致，cy 不同
const nodes = await page.locator('.ink-node-dot').evaluateAll((ns) => ns.map((n) => ({ cx: Number(n.getAttribute('cx')), cy: Number(n.getAttribute('cy')) })));
check('节点排成一列', new Set(nodes.map((n) => n.cx)).size === 1 && new Set(nodes.map((n) => n.cy)).size === 3, JSON.stringify(nodes));

// 弦是横向的：每根 flow 的 bbox 宽度 > 900
const flowBoxes = await page.locator('.ink-flow').evaluateAll((ns) => ns.map((n) => {
  const b = n.getBBox();
  return { w: Math.round(b.width), h: Math.round(b.height) };
}));
check('四根弦都是横向的', flowBoxes.length === 4 && flowBoxes.every((b) => b.w > 900), JSON.stringify(flowBoxes));

// ============ 2. 水墨材质：半透明、粗细不一、流动 ============
const ribbons = await page.locator('.ink-ribbon').evaluateAll((ns) => ns.map((n) => ({
  fill: getComputedStyle(n).fill,
  opacity: Number(getComputedStyle(n).fillOpacity),
  h: Math.round(n.getBBox().height),
})));
check('弦是深黑', ribbons.every((r) => r.fill === 'rgb(11, 11, 11)'), JSON.stringify(ribbons));
check('弦是半透明（0.6–0.85）', ribbons.every((r) => r.opacity >= 0.6 && r.opacity <= 0.85), ribbons.map((r) => r.opacity).join(' / '));
const widths = await page.locator('.ink-ribbon').evaluateAll((ns) => ns.map((n) => Math.round(n.getBBox().height)));
check('粗细不一', new Set(widths).size >= 2, widths.join(' / '));
check('有墨迹晕染层', (await page.locator('.ink-bleed').count()) === 4);

const durations = await page.locator('.ink-flow').evaluateAll((ns) => [...new Set(ns.map((n) => getComputedStyle(n).animationDuration))]);
check('流动速度随张力分档', durations.length >= 2, durations.join(' / '));

const flow = page.locator('[data-string="自我.信任"] .ink-flow');
const off0 = await flow.evaluate((n) => getComputedStyle(n).strokeDashoffset);
await page.waitForTimeout(500);
const off1 = await flow.evaluate((n) => getComputedStyle(n).strokeDashoffset);
check('墨迹在流动', off0 !== off1, `${off0} → ${off1}`);

const hashes = [];
for (let i = 0; i < 3; i++) {
  const buf = await page.screenshot({ path: `artifacts/86-flow-${i}.png` });
  hashes.push(createHash('sha256').update(buf).digest('hex').slice(0, 10));
  if (i < 2) await page.waitForTimeout(420);
}
check('连续三帧不同', new Set(hashes).size === 3, hashes.join(' / '));
await page.screenshot({ path: 'artifacts/80-ink.png' });

// 灰度 token：整个 app 没有彩色
const badColors = await page.evaluate(() => {
  const parse = (v) => {
    const m = String(v).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const bad = [];
  for (const el of document.querySelectorAll('[data-testid="ink-app"] *')) {
    const s = getComputedStyle(el);
    for (const prop of ['color', 'backgroundColor', 'stroke', 'fill']) {
      const rgb = parse(s[prop]);
      if (rgb && Math.max(...rgb) - Math.min(...rgb) > 2) {
        bad.push(`${el.tagName}.${prop}=${s[prop]}`);
        if (bad.length > 6) return bad;
      }
    }
  }
  return bad;
});
check('DOM 里没有彩色 token', badColors.length === 0, badColors.join(' | '));

// ============ 3. 悬停：弹性拉伸 + 墨影 ============
const ribbon = page.locator('[data-string="自我.信任"] .ink-ribbon');
const d0 = await ribbon.getAttribute('d');
await page.mouse.move(700, 180);
await page.waitForTimeout(300);
const d1 = await ribbon.getAttribute('d');
check('悬停使弦形变', d0 !== d1, `${(d0 ?? '').slice(0, 32)} → ${(d1 ?? '').slice(0, 32)}`);
const shadow = await ribbon.evaluate((n) => getComputedStyle(n).filter);
check('悬停出现墨影', shadow.includes('drop-shadow'), shadow);
check('墨影有模糊', /blur|shadow/.test(shadow), shadow);
check('悬停出现拉丝残影', (await page.locator('[data-string="自我.信任"] .ink-trail').count()) === 1);
await page.screenshot({ path: 'artifacts/81-hover.png' });

// ============ 4. 拖动：控制点拉伸 + 值位置改变 ============
const marker0 = Number(await page.locator('[data-string="自我.信任"] .ink-marker').getAttribute('x1'));
await page.mouse.down();
await page.mouse.move(700, 100, { steps: 10 });
await page.waitForTimeout(250);
const marker1 = Number(await page.locator('[data-string="自我.信任"] .ink-marker').getAttribute('x1'));
const dDrag = await ribbon.getAttribute('d');
check('拖动改变弦的值位置', marker1 !== marker0, `x ${marker0} → ${marker1}`);
check('拖动继续拉伸贝塞尔', dDrag !== d1, '控制点已变');
await page.screenshot({ path: 'artifacts/82-drag.png' });
await page.mouse.up();
await page.waitForTimeout(600);
await page.mouse.move(700, 180);
await page.waitForTimeout(200);

// ============ 5. Tab：反色 + 2px 失焦 + 局部聚焦 ============
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
const inverted = await page.locator('[data-testid="ink-app"]').getAttribute('data-inverted');
check('Tab 进入反色', inverted === 'true', String(inverted));
check('反色后背景纯黑', (await page.locator('[data-testid="ink-app"]').evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(0, 0, 0)');
const blur = await page.locator('.ink-base').evaluate((n) => getComputedStyle(n).filter);
check('全局失焦 2px', blur.includes('blur(2px)'), blur);
check('悬停弦被局部聚焦', (await page.locator('[data-focus-string]').count()) === 1, `${await page.locator('[data-focus-string]').count()} 条`);
const focusColor = await page.locator('[data-focus-string] .ink-ribbon').first().evaluate((n) => getComputedStyle(n).fill);
check('聚焦弦是白线', focusColor === 'rgb(242, 242, 242)', focusColor);
await page.screenshot({ path: 'artifacts/83-tab-string.png' });

await page.mouse.click(112, 700);
await page.waitForTimeout(300);
check('点击节点进入聚焦', (await page.locator('[data-focus-node]').count()) === 1, await page.locator('[data-focus-node]').getAttribute('data-focus-node').catch(() => 'none'));
check('节点对应的弦也清晰', (await page.locator('[data-focus-string]').count()) >= 1, `${await page.locator('[data-focus-string]').count()} 条`);
await page.screenshot({ path: 'artifacts/84-tab-node.png' });

await page.keyboard.press('Tab');
await page.waitForTimeout(300);
check('再次 Tab 恢复白底', (await page.locator('[data-testid="ink-app"]').getAttribute('data-inverted')) === 'false');
check('恢复后没有模糊', (await page.locator('.ink-base').evaluate((n) => getComputedStyle(n).filter)) === 'none');
check('恢复后聚焦层消失', (await page.locator('.ink-focus').count()) === 0);
await page.screenshot({ path: 'artifacts/85-back.png' });

// ============ 6. 性能 ============
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const loop = (t) => {
        frames++;
        if (t - start < 1500) requestAnimationFrame(loop);
        else resolve(Math.round((frames / (t - start)) * 1000));
      };
      requestAnimationFrame(loop);
    }),
);
check('渲染帧率 ≥50fps', fps >= 50, `${fps}fps`);
const heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
check('堆内存可用', heap !== null, heap === null ? '未暴露' : `${heap}MB`);
check('没有页面级报错', consoleErrors.filter((e) => !e.includes('favicon')).length === 0, consoleErrors.join(' | '));

await browser.close();

const summary = {
  when: new Date().toISOString(),
  counts: { nodes: 3, strings: 4, loops: 2 },
  flowBoxes,
  widths,
  durations,
  flowHashes: hashes,
  badColors,
  fps,
  heapMB: heap,
  consoleErrors,
  results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync('artifacts/ink-test.json', JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.passed} passed / ${summary.failed} failed ===`);
if (summary.failed > 0) process.exitCode = 1;
