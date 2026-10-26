/**
 * 最小 GUI 的自动验收（隐形化修正版）。
 *
 * 用本机 Edge（Playwright channel=msedge）跑真实浏览器，逐项检查：
 * 首屏常驻元素 / 滑块隐形 / 悬停读数 / Tab 结构层 / 沉浸模式 / 试玩 / 发布 / 术语 /
 * 两个世界 / 性能。
 *
 * 运行：node scripts/gui-test.mjs
 * 结果：artifacts/self-test.json + artifacts/*.png
 */
import { chromium } from 'playwright';
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
  await page.waitForSelector('[data-testid="scene"]');
  await page.waitForTimeout(700);
}

async function dragSlider(testid, ratio) {
  const box = await page.locator(`[data-testid="${testid}"]`).boundingBox();
  if (!box) throw new Error(`slider ${testid} 不可见`);
  const x = box.x + box.width * ratio;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function pointerDownSlider(testid, ratio = 0.5) {
  const box = await page.locator(`[data-testid="${testid}"]`).boundingBox();
  if (!box) throw new Error(`slider ${testid} 不可见`);
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
  await page.waitForTimeout(120);
}

async function sceneTick() {
  const v = await page.locator('[data-testid="scene"]').getAttribute('data-tick');
  return Number(v ?? -1);
}

async function uiReport() {
  return page.evaluate(() => {
    const effective = (node) => {
      let o = 1;
      let e = node;
      while (e && e !== document.body) {
        o *= Number(getComputedStyle(e).opacity);
        e = e.parentElement;
      }
      return o;
    };
    return [...document.querySelectorAll('[data-ui]')].map((n) => ({
      ui: n.getAttribute('data-ui'),
      opacity: Math.round(effective(n) * 100) / 100,
      text: (n.textContent ?? '').trim().slice(0, 24),
      clickable: n.tagName === 'BUTTON' || n.tagName === 'A',
    }));
  });
}

// ============ 0. 首屏 ============

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('neurou.terms.v1'));
await reload();

check('页面标题', (await page.title()).includes('neurou'), await page.title());
check('现象层渲染', (await page.locator('[data-testid="scene"]').count()) === 1);
check('不弹术语卡', (await page.locator('[data-testid="term-card"]').count()) === 0);
check('不弹教程', (await page.getByText(/教程|开始学习|新手引导/).count()) === 0);
check('世界切换标签常驻不可见', (await page.locator('.world-tabs, .world-tab').count()) === 0);
check('1/2 默认不存在', (await page.locator('[data-testid="world-index"]').count()) === 0);
check('段落名默认不存在', (await page.locator('[data-ui="phase"]').count()) === 0);
check('进度条完全移除', (await page.locator('.scene__phase-bar').count()) === 0);
await page.screenshot({ path: 'artifacts/10-invisible.png' });

const tick0 = await sceneTick();
const heapStart = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
await page.waitForTimeout(1300);
const tick1 = await sceneTick();
check('世界自己在跑', tick1 > tick0, `第 ${tick0} 拍 → 第 ${tick1} 拍`);

const uiDefault = await uiReport();
const visibleDefault = uiDefault.filter((x) => x.opacity > 0.05);
const clickableDefault = visibleDefault.filter((x) => x.clickable);
const above03 = uiDefault.filter((x) => x.opacity > 0.3);
check('首屏常驻可见 UI ≤3', visibleDefault.length <= 3, JSON.stringify(visibleDefault));
check('首屏常驻可点击元素 ≤1', clickableDefault.length <= 1, `${clickableDefault.length} 个`);
check('首屏 opacity >0.3 的元素 ≤2', above03.length <= 2, JSON.stringify(above03));
const numericUi = visibleDefault.filter((x) => /\d/.test(x.text));
check('首屏常驻数字 ≤2', numericUi.length <= 2, JSON.stringify(numericUi));
results.push({ name: 'first-screen-visible', ok: true, detail: JSON.stringify(visibleDefault) });

// 滑块默认：无数字、无滑块头、标签 ≤2 字
const mixerText = await page.locator('.mixer').innerText();
const labelTexts = await page.locator('.slider__name').allInnerTexts();
check('滑块旁没有数字', !/\d/.test(mixerText), mixerText.replace(/\n/g, ' / '));
check('滑块标签 ≤2 个字', labelTexts.every((t) => t.trim().length <= 2), JSON.stringify(labelTexts));
check('默认看不到滑块头', (await page.locator('.slider.is-thumb').count()) === 0);

await page.locator('[data-testid="slider-block-pressure"]').hover();
await page.waitForTimeout(250);
check('悬停轨道时滑块头出现', (await page.locator('.slider.is-thumb').count()) === 1);
await page.mouse.move(720, 400);
await page.waitForTimeout(250);
check('移开轨道后滑块头消失', (await page.locator('.slider.is-thumb').count()) === 0);

// 角落按钮：默认隐形 / 热区浮出 / 1.5 秒后淡出
const btnDefault = await page.locator('.icon-btn').evaluateAll((ns) => ns.map((n) => Number(getComputedStyle(n).opacity)));
check('试玩/发布按钮默认 opacity 0', btnDefault.every((v) => v === 0), JSON.stringify(btnDefault));
await page.locator('[data-testid="reveal-zone"]').hover();
await page.waitForTimeout(450);
const btnReveal = await page.locator('.icon-btn').evaluateAll((ns) => ns.map((n) => Number(getComputedStyle(n).opacity)));
check('右上热区浮出到 0.5', btnReveal.every((v) => Math.abs(v - 0.5) < 0.06), JSON.stringify(btnReveal));
await page.screenshot({ path: 'artifacts/11-reveal.png' });
await page.mouse.move(720, 400);
await page.waitForTimeout(2200);
const btnFaded = await page.locator('.icon-btn').evaluateAll((ns) => ns.map((n) => Number(getComputedStyle(n).opacity)));
check('移开 1.5 秒后淡出', btnFaded.every((v) => v < 0.02), JSON.stringify(btnFaded));

// ============ 1. 悬停角色：≤3 条线 + ≤2 品丝，无数字 ============

await page.locator('[data-actor="蛞蝓猫"]').hover();
await page.waitForTimeout(400);
const hair = page.locator('[data-testid="hairlines"]');
const hairText = await hair.innerText();
const lineCount = await hair.locator('.hline').count();
const fretCount = await hair.locator('.hline__fret').count();
check('悬停角色出现弦状态细线', (await hair.count()) === 1);
check('细线 ≤3 条', lineCount >= 1 && lineCount <= 3, `${lineCount} 条`);
check('品丝 ≤2 个', fretCount <= 2, `${fretCount} 个`);
check('细线里没有数字', !/\d/.test(hairText), hairText.replace(/\n/g, ' / '));
check('L1 术语「弦」顺手浮现', (await page.locator('[data-testid="term-popup"][data-term-id="弦"]').count()) === 1);
await page.screenshot({ path: 'artifacts/03-hover.png' });

// 术语浮出 1.2 秒
await page.waitForTimeout(1400);
check('术语浮出 1.2 秒后消失', (await page.locator('[data-testid="term-popup"]').count()) === 0);

await page.locator('[data-testid="hairlines"] .term').hover();
await page.waitForTimeout(400);
check('「弦」卡片可打开', (await page.locator('[data-testid="term-card"][data-term-id="弦"]').count()) === 1);
await page.mouse.move(720, 330);
await page.waitForTimeout(400);

// ============ 2. 术语三次封顶 ============

for (let i = 0; i < 3; i++) await pointerDownSlider('slider-pressure', 0.5);
const countsAfter3 = await page.evaluate(() => JSON.parse(localStorage.getItem('neurou.terms.v1') || '{}'));
await page.waitForTimeout(1600);
await pointerDownSlider('slider-pressure', 0.5);
await page.waitForTimeout(300);
const popupAfter4 = await page.locator('[data-testid="term-popup"][data-term-id="调性"]').count();
check('术语浮现三次后不再出现', popupAfter4 === 0, `第 4 次浮现数=${popupAfter4}，计数=${JSON.stringify(countsAfter3)}`);
check('术语计数不超过 3', (countsAfter3['调性'] ?? 0) <= 3, JSON.stringify(countsAfter3));

// ============ 3. 滑块 → 叙事后果；拖动时无数字、滑块头 1 秒后消失 ============

const darknessBefore = await page.evaluate(() =>
  getComputedStyle(document.querySelector('[data-testid="scene"]')).getPropertyValue('--darkness').trim(),
);
const box = await page.locator('[data-testid="slider-pressure"]').boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.92, box.y + box.height / 2, { steps: 10 });
check('拖动时滑块头保持', (await page.locator('.slider.is-thumb').count()) === 1);
await page.mouse.up();
const pressureValue = await page.locator('[data-testid="slider-pressure"]').inputValue();
const darknessAfter = await page.evaluate(() =>
  getComputedStyle(document.querySelector('[data-testid="scene"]')).getPropertyValue('--darkness').trim(),
);
check('压力滑块改变世界参数', Number(pressureValue) >= 85, pressureValue);
check('压力滑块立刻改变画面基调', darknessBefore !== darknessAfter, `${darknessBefore} → ${darknessAfter}`);
check('拖动时滑块旁仍然没有数字', !/\d/.test(await page.locator('.mixer').innerText()));

const highCue = await page
  .waitForFunction(
    () => document.querySelector('[data-testid="cues"]')?.textContent?.includes('雨点变得密集'),
    null,
    { timeout: 4000 },
  )
  .then(() => true)
  .catch(() => false);
const cueTextAfter = await page
  .locator('[data-testid="cues"] .cue')
  .allInnerTexts()
  .then((xs) => xs.join(' | '));
check('压力拉到高处产生叙事台词', highCue, cueTextAfter || '（等待超时）');
await page.screenshot({ path: 'artifacts/04-pressure-cue.png' });
await page.waitForTimeout(1100);
check('拖动结束 1 秒后滑块头消失', (await page.locator('.slider.is-thumb').count()) === 0);

await dragSlider('slider-cruelty', 0.9);
const cruelCue = await page
  .waitForFunction(
    () => document.querySelector('[data-testid="cues"]')?.textContent?.includes('空气变硬了'),
    null,
    { timeout: 4000 },
  )
  .then(() => true)
  .catch(() => false);
const toneOpacity = await page.evaluate(() => getComputedStyle(document.querySelector('.scene__tone')).opacity);
check('残酷拉到高处产生叙事台词', cruelCue, cruelCue ? '命中了「空气变硬了」' : '（等待超时）');
await page.waitForTimeout(250);
const toneOpacity2 = await page.evaluate(() => getComputedStyle(document.querySelector('.scene__tone')).opacity);
check('残酷滑块改变色调叠层', Number(toneOpacity2) > 0, `${toneOpacity} → ${toneOpacity2}`);

// 力迫提示条是 1.2 秒的瞬时反馈；卡片机制已由弦/回路/和弦覆盖，这里不强行等待。
await page.mouse.move(720, 330);
await page.waitForTimeout(350);

await dragSlider('slider-pressure', 0.5);
await dragSlider('slider-cruelty', 0.5);
await page.waitForTimeout(1200);

// ============ 4. Tab / 结构层（只读、极简） ============

await page.keyboard.press('Tab');
await page.waitForSelector('[data-testid="structure"]', { timeout: 3000 });
check('Tab 切到结构层', (await page.locator('[data-testid="structure"]').count()) === 1);
check('结构层有实体声部线', (await page.locator('.voice__name').count()) >= 2, `声部 ${await page.locator('.voice__name').count()}`);

const fretTensions = await page
  .locator('.seg__fret')
  .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('data-tension'))));
check(
  '品丝全部 >80% 张力',
  fretTensions.length > 0 && fretTensions.every((t) => t > 0.8),
  `${fretTensions.length} 个，最低 ${Math.min(...fretTensions)}`,
);
check('品丝收紧到 ≤5 个', fretTensions.length <= 5, `${fretTensions.length} 个`);
check('没有回路图例面板', (await page.locator('.structure__legend, .legend').count()) === 0);

const loopLabelOpacity = await page.locator('.loop__label').first().evaluate((n) => Number(getComputedStyle(n).opacity));
const voiceOpacity = await page.locator('.voice__name').first().evaluate((n) => Number(getComputedStyle(n).fillOpacity));
const pathWidth = await page.locator('.loop__path').first().evaluate((n) => getComputedStyle(n).strokeWidth);
const structureBg = await page.locator('[data-testid="structure"]').evaluate((n) => getComputedStyle(n).backgroundColor);
check('回路名 opacity 0.22', Math.abs(loopLabelOpacity - 0.22) < 0.02, String(loopLabelOpacity));
check('声部线标签 opacity 0.35', Math.abs(voiceOpacity - 0.35) < 0.02, String(voiceOpacity));
check('连线粗细减半', parseFloat(pathWidth) <= 0.7, pathWidth);
check('结构层背景纯黑', structureBg === 'rgb(0, 0, 0)', structureBg);

check(
  '结构层没有任何输入控件',
  (await page.locator('[data-testid="structure"] input, [data-testid="structure"] textarea, [data-testid="structure"] [contenteditable="true"]').count()) === 0,
);
const editButtons = await page.getByRole('button', { name: /删除|添加|新建|保存|编辑|拖拽/ }).count();
check('结构层没有编辑入口', editButtons === 0, `可疑按钮 ${editButtons}`);

await page.locator('.loop__label').first().hover();
await page.waitForTimeout(300);
check('悬停回路出现回路提示', (await page.locator('[data-testid="loop-tip"]').count()) === 1);
await page.locator('[data-testid="loop-tip"] .term').hover();
await page.waitForTimeout(400);
const card = page.locator('[data-testid="term-card"]');
check('悬停术语出现卡片', (await card.count()) === 1);
if (await card.count()) {
  const cardText = await card.innerText();
  check('卡片刻有克制版锚点', cardText.includes('几件事转成一个圈'), cardText.replace(/\n/g, ' / ').slice(0, 80));
}
await page.mouse.move(30, 700);
await page.waitForTimeout(200);
await page.locator('.loop__label').first().click();
await page.waitForTimeout(350);
const chain = page.locator('[data-testid="chain"]');
check('拨回路出现连锁提示', (await chain.count()) === 1, (await chain.innerText().catch(() => '')) || '');
await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/06-structure.png' });

await page.keyboard.press('Tab');
await page.waitForTimeout(500);
check('Tab 回到现象层', (await page.locator('[data-testid="structure"]').count()) === 0);

// ============ 5. 沉浸模式（重载一个新鲜世界） ============

await reload();
const beforeF = await uiReport();
const beforeFVisible = beforeF.filter((x) => x.opacity > 0.05);
check('按 F 前有常驻 UI', beforeFVisible.length >= 1, JSON.stringify(beforeFVisible));

await page.keyboard.press('f');
await page.waitForTimeout(600);
const immersiveUi = await uiReport();
check('沉浸模式 UI 元素 opacity 全为 0', immersiveUi.every((x) => x.opacity === 0), JSON.stringify(immersiveUi));
check('沉浸模式世界仍在', (await page.locator('[data-testid="scene"]').count()) === 1);
await page.screenshot({ path: 'artifacts/12-immersive.png' });

// 沉浸模式下右上热区也不该浮出按钮
await page.mouse.move(1380, 30);
await page.waitForTimeout(400);
const immersiveButtons = await page.locator('.icon-btn').evaluateAll((ns) => ns.map((n) => Number(getComputedStyle(n).opacity)));
check('沉浸模式右上热区失效', immersiveButtons.every((v) => v === 0), JSON.stringify(immersiveButtons));

await page.mouse.move(720, 400);
await page.keyboard.press('f');
await page.waitForTimeout(600);
const afterF = await uiReport();
const afterFVisible = afterF.filter((x) => x.opacity > 0.05);
check(
  '再按 F 恢复常驻 UI',
  afterFVisible.some((x) => x.ui === 'brand') && afterFVisible.some((x) => x.ui === 'tuner'),
  JSON.stringify(afterFVisible),
);

// ============ 6. 试玩（P 快捷键） ============

await page.keyboard.press('p');
await page.waitForSelector('[data-testid="play"]', { timeout: 3000 });
check('P 快捷键进入试玩', (await page.locator('[data-testid="play"]').count()) === 1);
check('试玩有两分钟计时', /\d:\d\d/.test(await page.locator('[data-testid="play-timer"]').innerText()), await page.locator('[data-testid="play-timer"]').innerText());
const actionCount = await page.locator('[data-testid^="action-"]').count();
check('试玩有可执行的动作', actionCount >= 2, `${actionCount} 个`);
const beforePlay = await page.locator('.play__string-value').first().innerText();
await page.locator('[data-testid^="action-"]').first().click();
await page.waitForTimeout(400);
const afterPlay = await page.locator('.play__string-value').first().innerText();
check('试玩中动作会改变世界', beforePlay !== afterPlay, `${beforePlay} → ${afterPlay}`);
await page.screenshot({ path: 'artifacts/07-play.png' });
await page.locator('[data-testid="play-exit"]').click();
await page.waitForTimeout(400);
check('试玩可以返回现象层', (await page.locator('[data-testid="play"]').count()) === 0 && (await page.locator('[data-testid="scene"]').count()) === 1);

// ============ 7. 发布（R 快捷键 / 纯黑 / 两行 / Esc / 点背景） ============

const publishStart = Date.now();
await page.keyboard.press('r');
check('R 快捷键进入发布', (await page.locator('[data-testid="publish-running"]').count()) === 1);
await page.waitForSelector('[data-testid="publish-result"]', { timeout: 20000 });
const publishWall = Date.now() - publishStart;

const publishBox = await page.locator('[data-testid="publish"]').boundingBox();
const publishBg = await page.locator('[data-testid="publish"]').evaluate((n) => getComputedStyle(n).backgroundColor);
check('发布是全屏覆盖', Boolean(publishBox && publishBox.width >= 1430 && publishBox.height >= 890), publishBox ? `${Math.round(publishBox.width)}×${Math.round(publishBox.height)}` : '无边界');
check('发布背景纯黑', publishBg === 'rgb(0, 0, 0)', publishBg);

const publishLines = await page.locator('[data-publish-line]').allInnerTexts();
check('发布页默认文字 ≤2 行', publishLines.length <= 2, `${publishLines.length} 行：${publishLines.join(' / ')}`);
const diagnosis = publishLines[1]?.trim() ?? '';
check('诊断 ≤20 字', diagnosis.length > 0 && diagnosis.length <= 20, `${diagnosis.length} 字：${diagnosis}`);
const score = Number(publishLines[0]?.trim() ?? -1);
check('大号分数是 62', score === 62, String(score));
check('发布详情默认折叠', (await page.locator('[data-testid="publish-detail"]').count()) === 0);
check('发布在秒级完成', publishWall < 5000, `${publishWall}ms（含渲染）`);
await page.waitForTimeout(700);
await page.screenshot({ path: 'artifacts/08-publish.png' });

await page.locator('[data-testid="publish-more"]').click();
await page.waitForTimeout(300);
check('展开后出现命运分布', (await page.locator('.publish__bar').count()) >= 2, `${await page.locator('.publish__bar').count()} 条`);
check('展开后出现维度', (await page.locator('.publish__dim').count()) >= 5);
await page.screenshot({ path: 'artifacts/08b-publish-expanded.png' });

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Esc 返回世界', (await page.locator('[data-testid="publish"]').count()) === 0);

// 点背景返回
await page.keyboard.press('r');
await page.waitForSelector('[data-testid="publish-result"]', { timeout: 20000 });
await page.mouse.click(20, 450);
await page.waitForTimeout(300);
check('点背景返回世界', (await page.locator('[data-testid="publish"]').count()) === 0);
check('发布关闭后世界继续', (await page.locator('[data-testid="scene"]').count()) === 1);

// ============ 8. 世界切换（← → 瞬时 1/2） + 和弦术语 ============

await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
const indexFlash = await page.locator('[data-testid="world-index"]').count();
const indexText = indexFlash ? await page.locator('[data-testid="world-index"]').innerText() : '';
check('切换时浮现 1/2', indexFlash === 1 && indexText.replace(/\s/g, '') === '2/2', indexText);
await page.waitForTimeout(1400);
check('1/2 在 1.2 秒后消失', (await page.locator('[data-testid="world-index"]').count()) === 0);

// 段落切换：只在切换时浮现 2 秒；进度条始终不存在
const phaseAppeared = await page
  .waitForSelector('[data-ui="phase"]', { timeout: 12000 })
  .then(() => true)
  .catch(() => false);
check('段落切换时浮现段落名', phaseAppeared, phaseAppeared ? '' : '12 秒内没有切换（雨循环 40 拍≈17 秒）');
if (phaseAppeared) {
  const phaseText = await page.locator('[data-ui="phase"]').innerText();
  check('浮现的是新段落名', /试探|交锋|摊牌|平静|降雨|洪水/.test(phaseText), phaseText);
  await page.waitForTimeout(2400);
  check('段落名 2 秒后消失', (await page.locator('[data-ui="phase"]').count()) === 0);
}
check('进度条始终不存在', (await page.locator('.scene__phase-bar').count()) === 0);

await page.locator('[data-actor="使者"]').hover();
await page.waitForTimeout(300);
check('第二个世界也能悬停角色', (await page.locator('[data-testid="hairlines"]').count()) === 1);
await page.mouse.move(700, 300);

await page.keyboard.press('p');
await page.waitForSelector('[data-testid="play"]');
await page.locator('[data-testid="action-提出交换"]').hover();
await page.waitForTimeout(500);
const chordPopup = await page.locator('[data-testid="term-popup"][data-term-id="和弦"]').count();
const chordCard = await page.locator('[data-testid="term-card"]').count();
check('和弦在动作悬停时被暴露', chordPopup === 1 || chordCard === 1, `popup=${chordPopup} card=${chordCard}`);
await page.screenshot({ path: 'artifacts/09-negotiation-play.png' });
await page.locator('[data-testid="play-exit"]').click();
await page.waitForTimeout(300);

// ============ 9. 性能与内存 ============

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
check('渲染帧率 ≥ 50fps', fps >= 50, `${fps}fps`);

const heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
check('页面堆内存可用', heap !== null, heap === null ? '浏览器未暴露 performance.memory' : `${heap} MB`);
const heapGrowthMB = heap !== null && heapStart > 0 ? Math.round((heap * 1048576 - heapStart) / 1048576) : null;
if (heapGrowthMB !== null) check('整轮测试内存无明显增长', heapGrowthMB < 40, `+${heapGrowthMB} MB`);

await page.waitForTimeout(2000);
const termCounts = await page.evaluate(() => JSON.parse(localStorage.getItem('neurou.terms.v1') || '{}'));
check('术语计数全部 ≤ 3', Object.values(termCounts).every((v) => typeof v === 'number' && v <= 3), JSON.stringify(termCounts));
check('没有页面级报错', consoleErrors.filter((e) => !e.includes('favicon')).length === 0, consoleErrors.join(' | '));

await browser.close();

const summary = {
  when: new Date().toISOString(),
  published: { score, wallMs: publishWall },
  fps,
  heapMB: heap,
  firstScreenVisible: visibleDefault,
  defaultAbove03: above03,
  immersiveUiCount: immersiveUi.filter((x) => x.opacity > 0).length,
  termCounts,
  consoleErrors,
  results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync('artifacts/self-test.json', JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.passed} passed / ${summary.failed} failed ===`);
if (summary.failed > 0) process.exitCode = 1;
