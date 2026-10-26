/**
 * 最小 GUI 的自动验收。
 *
 * 用本机 Edge（Playwright channel=msedge）跑真实浏览器，逐项检查：
 * 现象层 / 滑块叙事后果 / Tab 结构层 / 拨回路 / 试玩 / 发布 / 术语 / 两个世界 / 性能。
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  await page.waitForTimeout(600);
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

async function tickText() {
  const text = await page.locator('.hud__mid').innerText();
  const m = text.match(/第\s*(\d+)\s*拍/);
  return m ? Number(m[1]) : -1;
}

// ============ 0. 首屏与教程 ============

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('neurou.terms.v1'));
await reload();

check('页面标题', (await page.title()).includes('neurou'), await page.title());
check('现象层渲染', (await page.locator('[data-testid="scene"]').count()) === 1);
check('不弹术语卡', (await page.locator('[data-testid="term-card"]').count()) === 0);
check('不弹教程', (await page.getByText(/教程|开始学习|新手引导/).count()) === 0);
await page.screenshot({ path: 'artifacts/02-phenomenon.png' });

const tick0 = await tickText();
const heapStart = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
await page.waitForTimeout(1200);
const tick1 = await tickText();
check('世界自己在跑', tick1 > tick0, `第 ${tick0} 拍 → 第 ${tick1} 拍`);

// ============ 1. 悬停角色 → 弦状态细线 ============

await page.locator('[data-actor="蛞蝓猫"]').hover();
await page.waitForTimeout(350);
const hair = page.locator('[data-testid="hairlines"]');
check('悬停角色出现弦状态细线', (await hair.count()) === 1);
check('细线含该角色的弦', (await hair.innerText()).includes('体力'), (await hair.innerText()).split('\n').slice(0, 4).join(' / '));
check('细线含阈值品丝', (await hair.locator('.hline__fret').count()) >= 2);
check('L1 术语「弦」顺手浮现', (await page.locator('[data-testid="term-popup"][data-term-id="弦"]').count()) === 1);
await page.screenshot({ path: 'artifacts/03-hover.png' });

// 弦卡片：悬停细线标题里的「弦」
await page.locator('[data-testid="hairlines"] .term').hover();
await page.waitForTimeout(400);
check('「弦」卡片可打开', (await page.locator('[data-testid="term-card"][data-term-id="弦"]').count()) === 1);
await page.mouse.move(700, 300);
await page.waitForTimeout(400);
await page.mouse.move(700, 300);
await page.waitForTimeout(300);

// ============ 2. 术语三次封顶 ============

// 用滑块触发「调性」浮现三次，第四次不该再出现
for (let i = 0; i < 3; i++) {
  await pointerDownSlider('slider-pressure', 0.5);
}
const countsAfter3 = await page.evaluate(() => JSON.parse(localStorage.getItem('neurou.terms.v1') || '{}'));
await page.waitForTimeout(2900);
await pointerDownSlider('slider-pressure', 0.5);
await page.waitForTimeout(350);
const popupAfter4 = await page.locator('[data-testid="term-popup"][data-term-id="调性"]').count();
check('术语浮现三次后不再出现', popupAfter4 === 0, `第 4 次浮现数=${popupAfter4}，计数=${JSON.stringify(countsAfter3)}`);
check('术语计数不超过 3', (countsAfter3['调性'] ?? 0) <= 3, JSON.stringify(countsAfter3));

// ============ 3. 滑块 → 可感知的叙事后果 ============

const darknessBefore = await page.evaluate(() =>
  getComputedStyle(document.querySelector('[data-testid="scene"]')).getPropertyValue('--darkness').trim(),
);
await dragSlider('slider-pressure', 0.92);
const pressureValue = await page.locator('[data-testid="slider-pressure"]').inputValue();
const darknessAfter = await page.evaluate(() =>
  getComputedStyle(document.querySelector('[data-testid="scene"]')).getPropertyValue('--darkness').trim(),
);
check('压力滑块改变数值', Number(pressureValue) >= 85, pressureValue);
check('压力滑块立刻改变画面基调', darknessBefore !== darknessAfter, `${darknessBefore} → ${darknessAfter}`);

const cueTextBefore = await page
  .locator('[data-testid="cues"] .cue')
  .allInnerTexts()
  .then((xs) => xs.join(' | '));
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
check('压力拉到高处产生叙事台词', highCue, cueTextAfter || cueTextBefore || '（等待超时）');
await page.screenshot({ path: 'artifacts/04-pressure-cue.png' });

await dragSlider('slider-cruelty', 0.9);
const cruelCue = await page
  .waitForFunction(
    () => document.querySelector('[data-testid="cues"]')?.textContent?.includes('空气变硬了'),
    null,
    { timeout: 4000 },
  )
  .then(() => true)
  .catch(() => false);
const toneOpacity = await page.evaluate(
  () => getComputedStyle(document.querySelector('.scene__tone')).opacity,
);
check('残酷拉到高处产生叙事台词', cruelCue, cruelCue ? '命中了「空气变硬了」' : '（等待超时）');
check('残酷滑块改变色调叠层', Number(toneOpacity) > 0, toneOpacity);

// 调性 / 力迫 的卡片
await page.locator('.mixer__label .term').hover();
await page.waitForTimeout(400);
check('「调性」卡片可打开', (await page.locator('[data-testid="term-card"][data-term-id="调性"]').count()) === 1);
await page.mouse.move(720, 320);
await page.waitForTimeout(350);
const tickerVisible = (await page.locator('[data-testid="forcing-ticker"]').count()) === 1;
if (tickerVisible) {
  await page.locator('[data-testid="forcing-ticker"] .term').hover();
  await page.waitForTimeout(400);
  check('「力迫」卡片可打开', (await page.locator('[data-testid="term-card"][data-term-id="力迫"]').count()) === 1);
} else {
  check('「力迫」卡片可打开', false, '力迫提示条没有出现');
}
await page.mouse.move(720, 320);
await page.waitForTimeout(350);

// 回中位，避免世界在后续测试里过早结束
await dragSlider('slider-pressure', 0.5);
await dragSlider('slider-cruelty', 0.5);
await page.screenshot({ path: 'artifacts/05-after-sliders.png' });

// ============ 4. Tab / 结构层（只读） ============

await page.keyboard.press('Tab');
await page.waitForSelector('[data-testid="structure"]', { timeout: 3000 });
check('Tab 切到结构层', (await page.locator('[data-testid="structure"]').count()) === 1);
check('结构层有实体声部线', (await page.locator('.voice__name').count()) >= 2, `声部 ${await page.locator('.voice__name').count()}`);
check('结构层有阈值品丝', (await page.locator('.seg__fret').count()) > 0, `品丝 ${await page.locator('.seg__fret').count()}`);
check('结构层有回路连线', (await page.locator('.loop').count()) >= 2, `回路 ${await page.locator('.loop').count()}`);
check('结构层没有任何输入控件', (await page.locator('[data-testid="structure"] input, [data-testid="structure"] textarea, [data-testid="structure"] [contenteditable="true"]').count()) === 0);
const editButtons = await page.getByRole('button', { name: /删除|添加|新建|保存|编辑|拖拽/ }).count();
check('结构层没有编辑入口', editButtons === 0, `可疑按钮 ${editButtons}`);

await page.locator('[data-loop-legend]').first().hover();
await page.waitForTimeout(300);
check('悬停回路出现回路提示', (await page.locator('[data-testid="loop-tip"]').count()) === 1);

// 术语卡片（回路）
await page.locator('[data-testid="loop-tip"] .term').hover();
await page.waitForTimeout(400);
const card = page.locator('[data-testid="term-card"]');
check('悬停术语出现卡片', (await card.count()) === 1);
if (await card.count()) {
  const cardText = await card.innerText();
  check('卡片刻有锚点与例子', cardText.includes('几件事互相牵着') && cardText.includes('你越虚弱'), cardText.replace(/\n/g, ' / ').slice(0, 80));
  await page.locator('[data-testid="term-more"]').click();
  check('卡片可以展开更多', (await card.innerText()).includes('牵成一个圈'));
}
await page.mouse.move(30, 700);
await page.waitForTimeout(200);

await page.locator('[data-loop-legend]').first().click();
await page.waitForTimeout(350);
const chain = page.locator('[data-testid="chain"]');
check('拨回路出现连锁提示', (await chain.count()) === 1, (await chain.innerText().catch(() => '')) || '');
await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/06-structure.png' });

await page.keyboard.press('Tab');
await page.waitForTimeout(500);
check('Tab 回到现象层', (await page.locator('[data-testid="structure"]').count()) === 0);

// ============ 5. 试玩 ============

await reload();
await page.locator('[data-testid="enter-play"]').click();
await page.waitForSelector('[data-testid="play"]');
check('进入试玩', (await page.locator('[data-testid="play"]').count()) === 1);
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

// ============ 6. 发布（Worker 快速模拟） ============

const publishStart = Date.now();
await page.locator('[data-testid="open-publish"]').click();
check('发布进入运行态', (await page.locator('[data-testid="publish-running"]').count()) === 1);
await page.waitForSelector('[data-testid="publish-result"]', { timeout: 20000 });
const publishWall = Date.now() - publishStart;
const publishText = await page.locator('[data-testid="publish-result"]').innerText();
const scoreMatch = publishText.match(/(\d+)\s*\/100/);
const score = scoreMatch ? Number(scoreMatch[1]) : -1;
check('音准仪给出分数', score >= 0, `${score}`);
check('音准仪给出绿/红/黄区', /绿区|红区|黄区/.test(publishText));
check('音准仪给出命运分布', (await page.locator('.publish__bar').count()) >= 2, `${await page.locator('.publish__bar').count()} 条`);
check('音准仪用文字诊断', publishText.includes('维度') || publishText.includes('文字诊断'));
check('发布在秒级完成', publishWall < 5000, `${publishWall}ms（含渲染）`);
await page.waitForTimeout(750);
await page.screenshot({ path: 'artifacts/08-publish.png' });
await page.locator('[data-testid="publish-close"]').click();
await page.waitForTimeout(300);
check('发布关闭后世界继续', (await page.locator('[data-testid="scene"]').count()) === 1);

const published = { score, wallMs: publishWall };

// ============ 7. 第二个世界 + 和弦术语 ============

await page.locator('[data-testid="world-negotiation"]').click();
await page.waitForTimeout(900);
check('能加载第二个世界', (await page.locator('.brand').count()) === 1 && (await page.locator('.world-tab.is-on').innerText()).includes('谈判'), await page.locator('.world-tab.is-on').innerText());
await page.locator('[data-actor="使者"]').hover();
await page.waitForTimeout(300);
check('第二个世界也能悬停角色', (await page.locator('[data-testid="hairlines"]').count()) === 1);
await page.mouse.move(700, 300);

await page.locator('[data-testid="enter-play"]').click();
await page.waitForSelector('[data-testid="play"]');
await page.locator('[data-testid="action-提出交换"]').hover();
await page.waitForTimeout(500);
const chordPopup = await page.locator('[data-testid="term-popup"][data-term-id="和弦"]').count();
const chordCard = await page.locator('[data-testid="term-card"]').count();
check('和弦在动作悬停时被暴露', chordPopup === 1 || chordCard === 1, `popup=${chordPopup} card=${chordCard}`);
await page.screenshot({ path: 'artifacts/09-negotiation-play.png' });
await page.locator('[data-testid="play-exit"]').click();
await page.waitForTimeout(300);

// ============ 8. 性能与内存 ============

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
if (heapGrowthMB !== null) {
  check('整轮测试内存无明显增长', heapGrowthMB < 40, `+${heapGrowthMB} MB`);
}

await page.waitForTimeout(2000);
const termCounts = await page.evaluate(() => JSON.parse(localStorage.getItem('neurou.terms.v1') || '{}'));
check('术语计数全部 ≤ 3', Object.values(termCounts).every((v) => typeof v === 'number' && v <= 3), JSON.stringify(termCounts));

check('没有页面级报错', consoleErrors.filter((e) => !e.includes('favicon')).length === 0, consoleErrors.join(' | '));

await browser.close();

const summary = {
  when: new Date().toISOString(),
  published,
  fps,
  heapMB: heap,
  termCounts,
  consoleErrors,
  results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync('artifacts/self-test.json', JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.passed} passed / ${summary.failed} failed ===`);
if (summary.failed > 0) process.exitCode = 1;
