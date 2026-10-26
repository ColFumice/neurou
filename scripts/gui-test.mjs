/**
 * 白纸黑线验收：全屏弦网络，无侧栏/画中画，灰度类型，震颤与动态模糊。
 *
 * 运行：node scripts/gui-test.mjs
 * 结果：artifacts/paper-test.json + artifacts/5x-*.png
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

async function reload() {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="desk"]');
  await page.waitForTimeout(700);
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('neurou.terms.v1'));
await reload();

// ============ 1. 白纸全屏，无侧栏 / 无画中画 / 无底部暗条 ============
check('默认是调律台', (await page.locator('[data-testid="desk"]').count()) === 1);
check('背景是纸白', (await page.locator('[data-testid="desk"]').evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(250, 250, 250)');
check('没有实体侧栏', (await page.locator('.desk__entities').count()) === 0);
check('没有现象画中画', (await page.locator('.desk__preview').count()) === 0);
check('没有底部工具栏暗条', (await page.locator('.desk__toolbar').count()) === 0);

const networkBox = await page.locator('[data-testid="network"]').boundingBox();
check('弦网络铺满视口', Boolean(networkBox && networkBox.width === 1440 && networkBox.height === 900), networkBox ? `${Math.round(networkBox.width)}×${Math.round(networkBox.height)}` : '无');
const labelSpan = await page.locator('.voice__label').evaluateAll((ns) => {
  const rects = ns.map((n) => n.getBoundingClientRect());
  return { min: Math.min(...rects.map((r) => r.left)), max: Math.max(...rects.map((r) => r.right)), count: rects.length };
});
check('实体名从最左铺到最右', labelSpan.count === 7 && labelSpan.max - labelSpan.min >= 1300, JSON.stringify(labelSpan));

const stringCount = await page.locator('[data-string]').count();
const loopCount = await page.locator('[data-loop]').count();
const forceCount = await page.locator('[data-forcing]').count();
check('23 根弦', stringCount === 23, String(stringCount));
check('6 条回路', loopCount === 6, String(loopCount));
check('6 个力迫标记', forceCount === 6, String(forceCount));
check('7 个实体名', labelSpan.count === 7, String(labelSpan.count));

check('没有数字读数', !/\d/.test(await page.locator('[data-testid="desk"]').innerText()));
await page.screenshot({ path: 'artifacts/50-desk.png' });

// 左下排练记号
const hint = page.locator('.desk__keys');
const hintStyle = await hint.evaluate((n) => ({ opacity: Number(getComputedStyle(n).opacity), pe: getComputedStyle(n).pointerEvents }));
check('左下视图提示存在', (await hint.innerText()).includes('空格 现象'), await hint.innerText());
check('提示 opacity ≤0.25', hintStyle.opacity <= 0.25, String(hintStyle.opacity));
check('提示不挡交互', hintStyle.pe === 'none', hintStyle.pe);

// 右下浮动文字（不是暗条）
const controls = await page.locator('[data-testid="desk-controls"]').evaluate((n) => {
  const r = n.getBoundingClientRect();
  return { text: n.textContent ?? '', x: r.left, y: r.top, w: r.width, h: r.height, bg: getComputedStyle(n).backgroundColor, opacity: Number(getComputedStyle(n).opacity) };
});
check('右下有调性/压力/残酷/发布/和弦', ['调性', '压力', '残酷', '发布', '和弦'].every((t) => controls.text.includes(t)), controls.text.replace(/\s+/g, ' '));
check('浮动控件没有背景条', controls.bg === 'rgba(0, 0, 0, 0)', controls.bg);
check('浮动控件位于右下', controls.x > 1000 && controls.y > 750, `${Math.round(controls.x)},${Math.round(controls.y)}`);
check('浮动控件很淡', controls.opacity <= 0.5, String(controls.opacity));

// 五个术语
const terms = await page.locator('.desk .term').allInnerTexts();
check('五个术语常驻', ['弦', '回路', '调性', '力迫', '和弦'].every((t) => terms.includes(t)), terms.join(' / '));

// ============ 2. 像素级：DOM 里的颜色全部是灰 ============
const badColors = await page.evaluate(() => {
  const parse = (v) => {
    const m = String(v).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const bad = [];
  for (const el of document.querySelectorAll('[data-testid="desk"] *')) {
    const s = getComputedStyle(el);
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'stroke', 'fill', 'accentColor']) {
      const rgb = parse(s[prop]);
      if (!rgb) continue;
      if (Math.max(...rgb) - Math.min(...rgb) > 2) {
        bad.push(`${el.tagName}.${prop}=${s[prop]}`);
        if (bad.length > 8) return bad;
      }
    }
  }
  return bad;
});
check('DOM 里没有彩色 token', badColors.length === 0, badColors.join(' | '));
check('整棵 studio 被 grayscale', (await page.locator('.studio').evaluate((n) => getComputedStyle(n).filter)).includes('grayscale'));

// 类型不靠颜色：叙事实线 vs 视觉虚线
const dashPair = await page.evaluate(() => {
  const narr = document.querySelector('.string--narr .string__line');
  const vis = document.querySelector('.string--vis .string__line');
  return {
    narr: narr ? getComputedStyle(narr).strokeDasharray : '',
    vis: vis ? getComputedStyle(vis).strokeDasharray : '',
    narrOpacity: narr ? getComputedStyle(narr).opacity : '',
    visOpacity: vis ? getComputedStyle(vis).opacity : '',
  };
});
check('类型用虚线节奏区分', dashPair.narr !== dashPair.vis, JSON.stringify(dashPair));
check('类型用灰度区分', dashPair.narrOpacity !== dashPair.visOpacity, `${dashPair.narrOpacity} vs ${dashPair.visOpacity}`);

// ============ 3. 静止震颤：路径在动，三帧不同 ============
const beforeD = await page.locator('[data-string="蛞蝓猫.体力"] .string__line').getAttribute('d');
await page.waitForTimeout(350);
const afterD = await page.locator('[data-string="蛞蝓猫.体力"] .string__line').getAttribute('d');
check('弦不是静止直线', beforeD !== afterD, `${(beforeD ?? '').slice(0, 38)} → ${(afterD ?? '').slice(0, 38)}`);

await page.locator('[data-testid="toggle-pause"]').click();
await page.waitForTimeout(300);
const hashes = [];
for (let i = 0; i < 3; i++) {
  const buf = await page.locator('[data-testid="network"]').screenshot({ path: `artifacts/51-tremble-${i}.png` });
  hashes.push(createHash('sha256').update(buf).digest('hex').slice(0, 10));
  if (i < 2) await page.waitForTimeout(420);
}
check('暂停后连续三帧仍不同', new Set(hashes).size === 3, hashes.join(' / '));
await page.screenshot({ path: 'artifacts/51-still.png' });
await page.locator('[data-testid="toggle-pause"]').click();
await page.waitForTimeout(300);

// ============ 4. 悬停 / 拖动 / 动态模糊 / 因果波 ============
const hit = page.locator('[data-string="蜥蜴.饥饿"] .string__hit-area');
const hitBox = await hit.boundingBox();
if (!hitBox) throw new Error('饥饿弦不可见');
await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
await page.waitForTimeout(300);
const tip = page.locator('[data-testid="string-tip"]');
const tipText = await tip.innerText();
check('悬停出现读数', (await tip.count()) === 1);
check('读数含类型与拖动提示', tipText.includes('叙事弦') && tipText.includes('按住拖动可调'), tipText.replace(/\n/g, ' / '));
check('读数不含数字', !/\d/.test(tipText), tipText.replace(/\n/g, ' / '));
check('读数卡片是白底', (await tip.evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(255, 255, 255)');
await page.screenshot({ path: 'artifacts/52-hover.png' });

const markerBefore = Number(await page.locator('[data-string="蜥蜴.饥饿"] .string__marker').getAttribute('y1'));
await page.mouse.down();
await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2 - 80, { steps: 12 });
await page.waitForTimeout(420);
const dragState = await page.evaluate(() => {
  const dragging = document.querySelector('.string.is-dragging');
  const trail = dragging?.querySelector('.string__trail');
  const edges = [...document.querySelectorAll('[data-wave-edge]')];
  const nodes = [...document.querySelectorAll('[data-wave-node]')];
  return {
    draining: Boolean(dragging),
    trailOpacity: trail ? Number(getComputedStyle(trail).opacity) : 0,
    trailFilter: trail ? getComputedStyle(trail).filter : '',
    litEdges: edges.filter((n) => Number(getComputedStyle(n).opacity) > 0.05).length,
    litNeighbors: nodes.filter((n) => n.getAttribute('data-wave-source') !== 'true' && Number(getComputedStyle(n).opacity) > 0.05).length,
    source: nodes.filter((n) => n.getAttribute('data-wave-source') === 'true').length,
  };
});
check('拖动时出现残影层', dragState.draining && dragState.trailOpacity > 0, JSON.stringify(dragState));
check('残影带模糊', dragState.trailFilter.includes('blur') || dragState.trailFilter.includes('ink-blur'), dragState.trailFilter);
check('拖动时耦合脉冲可见', dragState.litEdges >= 1, String(dragState.litEdges));
check('拖动时至少 2 根相邻弦亮起', dragState.litNeighbors >= 2, String(dragState.litNeighbors));
check('因果波从源弦出发', dragState.source === 1, String(dragState.source));
await page.screenshot({ path: 'artifacts/52-drag.png' });
await page.mouse.up();
await page.waitForTimeout(350);
const markerAfter = Number(await page.locator('[data-string="蜥蜴.饥饿"] .string__marker').getAttribute('y1'));
check('拖动改变弦的值位置', markerAfter !== markerBefore, `y1 ${markerBefore} → ${markerAfter}`);

// ============ 5. 回路：黑墨闭环 + 拨动残影 ============
const loopPoint = await page.locator('[data-loop] .loop__hit').first().evaluate((p) => {
  const el = p;
  const pt = el.getPointAtLength(el.getTotalLength() * 0.5);
  const m = el.getScreenCTM();
  return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
});
await page.mouse.move(loopPoint.x, loopPoint.y);
await page.waitForTimeout(350);
const loopTip = page.locator('[data-testid="network-loop-tip"]');
check('悬停回路出现闭环提示', (await loopTip.count()) === 1);
check('回路提示含 A→B→C→A', (await loopTip.innerText()).includes('→'), (await loopTip.innerText()).replace(/\n/g, ' / '));
check('回路提示是白底', (await loopTip.evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(255, 255, 255)');
await page.mouse.click(loopPoint.x, loopPoint.y);
await page.waitForTimeout(400);
check('拨回路后弦序列亮起', (await page.locator('.string.is-pulse').count()) >= 3, `${await page.locator('.string.is-pulse').count()} 根`);
const pulseTrail = await page.locator('.string.is-pulse .string__trail').first().evaluate((n) => Number(getComputedStyle(n).opacity)).catch(() => 0);
check('回路脉冲带残影', pulseTrail > 0, String(pulseTrail));
await page.screenshot({ path: 'artifacts/53-loop.png' });
await page.waitForTimeout(1800);

// ============ 6. 力迫 / 实体聚焦 ============
await page.locator('[data-forcing]').first().click();
await page.waitForTimeout(300);
const forcePop = page.locator('[data-testid="forcing-pop"]');
check('力迫弹层出现', (await forcePop.count()) === 1);
check('力迫弹层是白底黑字', (await forcePop.evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(255, 255, 255)');
check('力迫弹层含条件与效果', (await forcePop.innerText()).includes('当') && (await forcePop.innerText()).includes('效果'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await page.locator('[data-entity-label="蜥蜴"]').click();
await page.waitForTimeout(300);
check('点实体名聚焦该列', (await page.locator('.voice.is-dim').count()) === 6, `${await page.locator('.voice.is-dim').count()} 列被压暗`);
await page.locator('[data-entity-label="蜥蜴"]').click();
await page.waitForTimeout(200);
check('再点取消聚焦', (await page.locator('.voice.is-dim').count()) === 0);

// ============ 7. 视图 / 工具 / 发布 / 试玩 ============
const pressureBox = await page.locator('[data-testid="slider-pressure"]').boundingBox();
if (pressureBox) {
  await page.mouse.move(pressureBox.x + pressureBox.width * 0.5, pressureBox.y + pressureBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(pressureBox.x + pressureBox.width * 0.9, pressureBox.y + pressureBox.height / 2, { steps: 8 });
  await page.mouse.up();
}
await page.waitForTimeout(300);
const pressure = Number(await page.locator('[data-testid="slider-pressure"]').inputValue());
check('压力滑块可用', pressure >= 85, String(pressure));
check('滑块旁没有数字', !/\d/.test(await page.locator('[data-testid="desk-controls"]').innerText()));

await page.keyboard.press(' ');
await page.waitForTimeout(500);
check('空格切到现象层', (await page.locator('[data-testid="phenomenon"]').count()) === 1);
await page.screenshot({ path: 'artifacts/56-phenomenon.png' });
await page.keyboard.press(' ');
await page.waitForTimeout(300);

await page.keyboard.press('Tab');
await page.waitForTimeout(400);
check('Tab 打开结构层', (await page.locator('[data-testid="structure"]').count()) === 1);
check('结构层也是白纸', (await page.locator('[data-testid="structure"]').evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(250, 250, 250)');
check('结构层仍是 23 根弦', (await page.locator('[data-testid="structure"] [data-string]').count()) === 23);
await page.screenshot({ path: 'artifacts/54-structure.png' });
await page.keyboard.press('Tab');
await page.waitForTimeout(300);

await page.keyboard.press('f');
await page.waitForTimeout(400);
check('F 打开力迫层', (await page.locator('[data-testid="forcing-layer"]').count()) === 1);
check('力迫层也是白纸', (await page.locator('[data-testid="forcing-layer"]').evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(250, 250, 250)');
check('力迫层节点 6 个', (await page.locator('[data-force-node]').count()) === 6);
await page.screenshot({ path: 'artifacts/55-forcing.png' });
await page.keyboard.press('f');
await page.waitForTimeout(300);

const publishStart = Date.now();
await page.locator('[data-testid="open-publish"]').click();
await page.waitForSelector('[data-testid="publish-result"]', { timeout: 20000 });
const publishWall = Date.now() - publishStart;
const lines = await page.locator('[data-publish-line]').allInnerTexts();
const score = Number(lines[0]?.trim() ?? -1);
check('发布页默认 ≤2 行', lines.length <= 2, lines.join(' / '));
check('发布分数 58', score === 58, String(score));
check('发布在秒级完成', publishWall < 5000, `${publishWall}ms`);
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/57-publish.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.keyboard.press('p');
await page.waitForSelector('[data-testid="play"]');
check('P 进入试玩', (await page.locator('[data-testid="play"]').count()) === 1);
check('试玩有两分钟计时', /\d:\d\d/.test(await page.locator('[data-testid="play-timer"]').innerText()));
check('试玩有动作', (await page.locator('[data-testid^="action-"]').count()) >= 3, String(await page.locator('[data-testid^="action-"]').count()));
await page.locator('[data-testid="play-exit"]').click();
await page.waitForTimeout(300);
check('试玩返回调律台', (await page.locator('[data-testid="desk"]').count()) === 1);

// ============ 8. 性能 ============
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
  counts: { strings: stringCount, loops: loopCount, forcings: forceCount, entities: labelSpan.count },
  layout: { networkBox, labelSpan, controls, hint: hintStyle },
  trembleHashes: hashes,
  dragState,
  published: { score, wallMs: publishWall, lines },
  fps,
  heapMB: heap,
  badColors,
  consoleErrors,
  results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync('artifacts/paper-test.json', JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.passed} passed / ${summary.failed} failed ===`);
if (summary.failed > 0) process.exitCode = 1;
