/**
 * 调律台验收：默认视图必须是弦网络，不是现象层。
 *
 * 运行：node scripts/gui-test.mjs
 * 结果：artifacts/desk-test.json + artifacts/2x-*.png
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

// ============ 1. 默认是调律台，不是现象层 ============
check('默认视图是调律台', (await page.locator('[data-testid="desk"]').count()) === 1);
check('默认不显示全屏现象层', (await page.locator('[data-testid="phenomenon"]').count()) === 0);
check('主区是弦网络', (await page.locator('[data-testid="network"]').count()) === 1);
check('右下有现象残影窗', (await page.locator('[data-testid="preview"]').count()) === 1);
check('左上有实体列表', (await page.locator('.entity-btn').count()) === 7, `${await page.locator('.entity-btn').count()} 个`);
check('底部有工具栏', (await page.locator('.desk__toolbar').count()) === 1);
const termTexts = await page.locator('.desk .term').allInnerTexts();
const fiveTerms = ['弦', '回路', '调性', '力迫', '和弦'];
check('五个术语常驻可见', fiveTerms.every((t) => termTexts.includes(t)), termTexts.join(' / '));

const stringCount = await page.locator('[data-string]').count();
const loopCount = await page.locator('[data-loop]').count();
const forceCount = await page.locator('[data-forcing]').count();
check('弦 ≥15 根', stringCount >= 15, `${stringCount} 根`);
check('回路 ≥5 条', loopCount >= 5, `${loopCount} 条`);
check('力迫标记 ≥3 个', forceCount >= 3, `${forceCount} 个`);
check('世界自己开始跑了', Number(await page.locator('[data-testid="preview"] [data-testid="scene"]').getAttribute('data-tick')) >= 0);

const deskText = await page.locator('[data-testid="desk"]').innerText();
check('首屏没有数字读数', !/\d/.test(deskText), deskText.replace(/\n/g, ' / ').slice(0, 120));

// 预览窗放大 + 左下角极淡视图提示
const previewBox = await page.locator('[data-testid="preview"]').boundingBox();
const previewRatio = previewBox ? (previewBox.width * previewBox.height) / (1440 * 900) : 0;
check('预览窗 ≥420×320', Boolean(previewBox && previewBox.width >= 420 && previewBox.height >= 320), previewBox ? `${Math.round(previewBox.width)}×${Math.round(previewBox.height)}` : '无');
check('预览窗面积 ≥14%', previewRatio >= 0.14, `${(previewRatio * 100).toFixed(1)}%`);
const hint = page.locator('.desk__keys');
check('左下角视图提示存在', (await hint.count()) === 1, await hint.innerText());
const hintStyle = await hint.evaluate((n) => ({ opacity: Number(getComputedStyle(n).opacity), pe: getComputedStyle(n).pointerEvents }));
check('提示 opacity ≤0.25', hintStyle.opacity <= 0.25, String(hintStyle.opacity));
check('提示不挡交互', hintStyle.pe === 'none', hintStyle.pe);
const hintBlocks = await page.evaluate(() => {
  const el = document.querySelector('.desk__keys');
  if (!el) return true;
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top === el || el.contains(top);
});
check('提示下方仍可点到弦网络', !hintBlocks, hintBlocks ? '被提示遮挡' : '未遮挡');

// 每根弦都有流动与呼吸
const flowCount = await page.locator('.string__flow').count();
const glowCount = await page.locator('.string__glow').count();
check('每根弦都有流动层', flowCount === stringCount, `${flowCount}/${stringCount}`);
check('每根弦都有呼吸层', glowCount === stringCount, `${glowCount}/${stringCount}`);
const flowDurations = await page.locator('.string__flow').evaluateAll((ns) => [...new Set(ns.map((n) => getComputedStyle(n).animationDuration))]);
check('流动速度随张力分档', flowDurations.length >= 2, flowDurations.join(' / '));
await page.screenshot({ path: 'artifacts/20-desk.png' });

// 暂停后连拍三帧：数值不动，只有弦在流动
await page.locator('[data-testid="toggle-pause"]').click();
await page.waitForTimeout(350);
const frameHashes = [];
const flowOffsets = [];
for (let i = 0; i < 3; i++) {
  const buf = await page.locator('[data-testid="network"]').screenshot({ path: `artifacts/30-frame-${i}.png` });
  frameHashes.push(createHash('sha256').update(buf).digest('hex').slice(0, 12));
  flowOffsets.push(await page.locator('[data-string="蛞蝓猫.体力"] .string__flow').evaluate((n) => getComputedStyle(n).strokeDashoffset));
  if (i < 2) await page.waitForTimeout(520);
}
check('静止态连续三帧不完全相同', new Set(frameHashes).size === 3, frameHashes.join(' / '));
check('弦的流动偏移在三帧间变化', new Set(flowOffsets).size >= 2, flowOffsets.join(' / '));
await page.screenshot({ path: 'artifacts/31-static.png' });
await page.locator('[data-testid="toggle-pause"]').click();
await page.waitForTimeout(400);

// ============ 2. 实体聚焦 ============
await page.locator('[data-testid="entity-蜥蜴"]').click();
await page.waitForTimeout(300);
check('点击实体后该实体被聚焦', (await page.locator('.entity-btn.is-on').count()) === 1, await page.locator('.entity-btn.is-on').innerText());
check('聚焦后其他声部变淡', (await page.locator('.voice.is-dim').count()) >= 3, `${await page.locator('.voice.is-dim').count()} 条被压暗`);
await page.screenshot({ path: 'artifacts/27-entity-focus.png' });
await page.locator('[data-testid="entity-蜥蜴"]').click();
await page.waitForTimeout(200);
check('再次点击取消聚焦', (await page.locator('.entity-btn.is-on').count()) === 0);

// ============ 3. 悬停弦：类型 + 当前值位置 + 拖动提示 ============
const strLine = page.locator('[data-string="蛞蝓猫.体力"] .string__line');
check('体力弦在网络上', (await strLine.count()) === 1);
const lineBox = await strLine.boundingBox();
if (!lineBox) throw new Error('体力弦不可见');
await page.mouse.move(lineBox.x + 1, lineBox.y + lineBox.height / 2);
await page.waitForTimeout(300);
const tip = page.locator('[data-testid="string-tip"]');
check('悬停出现弦读数', (await tip.count()) === 1);
const tipText = await tip.innerText();
check('读数含类型标签', tipText.includes('叙事弦'), tipText.replace(/\n/g, ' / '));
check('读数含拖动提示', tipText.includes('按住拖动可调'), tipText.replace(/\n/g, ' / '));
check('读数不含数字', !/\d/.test(tipText), tipText.replace(/\n/g, ' / '));
await page.screenshot({ path: 'artifacts/21-string-hover.png' });

// ============ 4. 拖动弦：值位置变化 + 现象残影立刻反应 ============
const markerBefore = Number(await page.locator('[data-string="蛞蝓猫.体力"] .string__marker').getAttribute('y1'));
const actorBefore = await page.locator('[data-testid="preview"] [data-actor="蛞蝓猫"]').getAttribute('opacity');
await page.mouse.move(lineBox.x + 1, lineBox.y + lineBox.height / 2);
await page.mouse.down();
await page.mouse.move(lineBox.x + 1, lineBox.y + lineBox.height / 2 - 30, { steps: 10 });
await page.waitForTimeout(520);
const waveInfo = await page.evaluate(() => {
  const edges = [...document.querySelectorAll('[data-wave-edge]')];
  const nodes = [...document.querySelectorAll('[data-wave-node]')];
  return {
    edges: edges.length,
    litEdges: edges.filter((n) => Number(getComputedStyle(n).opacity) > 0.05).length,
    nodes: nodes.length,
    litNodes: nodes.filter((n) => Number(getComputedStyle(n).opacity) > 0.05).length,
    source: nodes.filter((n) => n.getAttribute('data-wave-source') === 'true').length,
    litNeighbors: nodes.filter((n) => n.getAttribute('data-wave-source') !== 'true' && Number(getComputedStyle(n).opacity) > 0.05).length,
  };
});
check('拖动时至少 2 条耦合线出现脉冲', waveInfo.litEdges >= 2, JSON.stringify(waveInfo));
check('拖动时至少 2 根相邻弦亮起', waveInfo.litNeighbors >= 2, JSON.stringify(waveInfo));
check('传播从被拖的源弦出发', waveInfo.source === 1, String(waveInfo.source));
await page.screenshot({ path: 'artifacts/32-wave-0.5s.png' });
await page.locator('[data-testid="network"]').screenshot({ path: 'artifacts/32-wave-network.png' });
await page.mouse.up();
await page.waitForTimeout(350);
const markerAfter = Number(await page.locator('[data-string="蛞蝓猫.体力"] .string__marker').getAttribute('y1'));
const actorAfter = await page.locator('[data-testid="preview"] [data-actor="蛞蝓猫"]').getAttribute('opacity');
check('拖动后弦上的值位置改变', markerAfter < markerBefore, `y1 ${markerBefore} → ${markerAfter}`);
check('现象残影里的角色立刻反应', actorBefore !== actorAfter, `opacity ${actorBefore} → ${actorAfter}`);
await page.screenshot({ path: 'artifacts/22-string-drag.png' });

// 拖动是现场调音，不写回文件；重载回到基线
await reload();

// ============ 5. 回路：闭环、悬停连锁、点击拨动 ============
const loopHit = page.locator('[data-loop] .loop__hit').first();
const loopPoint = await loopHit.evaluate((p) => {
  const el = p;
  const pt = el.getPointAtLength(el.getTotalLength() * 0.5);
  const m = el.getScreenCTM();
  return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
});
await page.mouse.move(loopPoint.x, loopPoint.y);
await page.waitForTimeout(350);
const loopTip = page.locator('[data-testid="network-loop-tip"]');
check('悬停回路出现闭环提示', (await loopTip.count()) === 1);
const loopText = await loopTip.innerText();
check('回路提示含 A→B→C→A', loopText.includes('→'), loopText.replace(/\n/g, ' / '));
await page.screenshot({ path: 'artifacts/23-loop-hover.png' });
await page.mouse.click(loopPoint.x, loopPoint.y);
await page.waitForTimeout(450);
check('拨回路后弦序列亮起', (await page.locator('.string.is-pulse').count()) >= 3, `${await page.locator('.string.is-pulse').count()} 根`);
check('残影里的角色收到连锁', (await page.locator('[data-testid="preview"] .actor--pulse').count()) >= 1);
await page.waitForTimeout(1800);

// ============ 6. 力迫：菱形 → 条件/效果 ============
await page.locator('[data-forcing]').first().click();
await page.waitForTimeout(300);
const forcePop = page.locator('[data-testid="forcing-pop"]');
check('点击力迫出现弹层', (await forcePop.count()) === 1);
const forceText = await forcePop.innerText();
check('弹层含「当」与条件', forceText.includes('当') && (forceText.includes('>=') || forceText.includes('>') || forceText.includes('==')), forceText.replace(/\n/g, ' / '));
check('弹层含「效果」', forceText.includes('效果'), forceText.replace(/\n/g, ' / '));
await page.screenshot({ path: 'artifacts/24-forcing-pop.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Esc 关闭力迫弹层', (await forcePop.count()) === 0);

// ============ 7. 工具栏：暂停 / 滑块 / 发布 ============
const tickA = Number(await page.locator('[data-testid="preview"] [data-testid="scene"]').getAttribute('data-tick'));
await page.locator('[data-testid="toggle-pause"]').click();
await page.waitForTimeout(1100);
const tickB = Number(await page.locator('[data-testid="preview"] [data-testid="scene"]').getAttribute('data-tick'));
check('暂停后世界不再走', tickA === tickB, `${tickA} → ${tickB}`);
await page.locator('[data-testid="toggle-pause"]').click();
await page.waitForTimeout(900);
const tickC = Number(await page.locator('[data-testid="preview"] [data-testid="scene"]').getAttribute('data-tick'));
check('恢复后世界继续走', tickC > tickB, `${tickB} → ${tickC}`);

const pressureBox = await page.locator('[data-testid="slider-pressure"]').boundingBox();
if (!pressureBox) throw new Error('压力滑块不可见');
await page.mouse.move(pressureBox.x + pressureBox.width * 0.5, pressureBox.y + pressureBox.height / 2);
await page.mouse.down();
await page.mouse.move(pressureBox.x + pressureBox.width * 0.9, pressureBox.y + pressureBox.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const pressure = Number(await page.locator('[data-testid="slider-pressure"]').inputValue());
check('底部压力滑块可用', pressure >= 85, String(pressure));
check('滑块旁仍没有数字', !/\d/.test(await page.locator('.desk__tuning').innerText()), await page.locator('.desk__tuning').innerText());
await page.waitForTimeout(1200);

const publishStart = Date.now();
await page.locator('[data-testid="open-publish"]').click();
await page.waitForSelector('[data-testid="publish-result"]', { timeout: 20000 });
const publishWall = Date.now() - publishStart;
const lines = await page.locator('[data-publish-line]').allInnerTexts();
const score = Number(lines[0]?.trim() ?? -1);
check('发布页是全屏纯黑', (await page.locator('[data-testid="publish"]').evaluate((n) => getComputedStyle(n).backgroundColor)) === 'rgb(0, 0, 0)');
check('发布页默认 ≤2 行', lines.length <= 2, lines.join(' / '));
check('发布分数合法', score >= 0 && score <= 100, String(score));
check('发布诊断 ≤20 字', (lines[1] ?? '').trim().length <= 20, lines[1] ?? '');
check('发布在秒级完成', publishWall < 5000, `${publishWall}ms`);
await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/28-publish.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Esc 从发布返回调律台', (await page.locator('[data-testid="publish"]').count()) === 0 && (await page.locator('[data-testid="desk"]').count()) === 1);

// ============ 8. 预览 / 空格 / Tab / F ============
await page.locator('[data-testid="preview"]').click();
await page.waitForTimeout(400);
check('点预览放大成现象层', (await page.locator('[data-testid="phenomenon"]').count()) === 1);
await page.screenshot({ path: 'artifacts/25-phenomenon.png' });
await page.keyboard.press(' ');
await page.waitForTimeout(400);
check('空格返回调律台', (await page.locator('[data-testid="desk"]').count()) === 1);

await page.keyboard.press('Tab');
await page.waitForTimeout(400);
check('Tab 打开结构层全屏', (await page.locator('[data-testid="structure"]').count()) === 1);
check('结构层仍是同一张弦网络', (await page.locator('[data-testid="structure"] [data-string]').count()) === stringCount, `${await page.locator('[data-testid="structure"] [data-string]').count()} 根`);
await page.screenshot({ path: 'artifacts/26-structure.png' });
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
check('Tab 回到调律台', (await page.locator('[data-testid="desk"]').count()) === 1);

await page.keyboard.press('f');
await page.waitForTimeout(400);
check('F 打开力迫层', (await page.locator('[data-testid="forcing-layer"]').count()) === 1);
check('力迫层节点 ≥3', (await page.locator('[data-force-node]').count()) >= 3, `${await page.locator('[data-force-node]').count()} 个`);
await page.locator('[data-force-node]').last().click();
await page.waitForTimeout(300);
check('力迫层可看条件/效果', (await page.locator('[data-testid="forcing-panel"]').innerText()).includes('效果'));
await page.screenshot({ path: 'artifacts/29-forcing-layer.png' });
await page.keyboard.press('f');
await page.waitForTimeout(400);
check('F 返回调律台', (await page.locator('[data-testid="desk"]').count()) === 1);

// ============ 9. 试玩 ============
await page.keyboard.press('p');
await page.waitForSelector('[data-testid="play"]');
check('P 进入试玩', (await page.locator('[data-testid="play"]').count()) === 1);
check('试玩有两分钟计时', /\d:\d\d/.test(await page.locator('[data-testid="play-timer"]').innerText()));
const actionCount = await page.locator('[data-testid^="action-"]').count();
check('试玩有动作', actionCount >= 3, `${actionCount} 个`);
await page.locator('[data-testid^="action-"]').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'artifacts/30-play.png' });
await page.locator('[data-testid="play-exit"]').click();
await page.waitForTimeout(400);
check('试玩返回调律台', (await page.locator('[data-testid="desk"]').count()) === 1);

// ============ 10. 首屏可点击清单 + 性能 ============
const clickables = await page.evaluate(() => ({
  entities: document.querySelectorAll('.entity-btn').length,
  strings: document.querySelectorAll('[data-string]').length,
  loops: document.querySelectorAll('[data-loop]').length,
  forcings: document.querySelectorAll('[data-forcing]').length,
  preview: document.querySelectorAll('[data-testid="preview"]').length,
  toolbarButtons: document.querySelectorAll('.desk-btn').length,
  sliders: document.querySelectorAll('.desk__toolbar input[type="range"]').length,
  terms: document.querySelectorAll('.desk .term').length,
}));
check('实体列表项可点', clickables.entities === 7, JSON.stringify(clickables));
check('弦本身可拖', clickables.strings === stringCount, String(clickables.strings));
check('预览窗可点', clickables.preview === 1);
check('工具按钮存在', clickables.toolbarButtons >= 2, String(clickables.toolbarButtons));

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
  counts: { strings: stringCount, loops: loopCount, forcings: forceCount, entities: 7 },
  clickables,
  published: { score, wallMs: publishWall, lines },
  fps,
  heapMB: heap,
  consoleErrors,
  results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync('artifacts/desk-test.json', JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.passed} passed / ${summary.failed} failed ===`);
if (summary.failed > 0) process.exitCode = 1;
