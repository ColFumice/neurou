/**
 * 八弦调律台 v1.1 验收：GUI 接回真实世界 + 写回 + 阈值编辑 + 任意世界/同类多根弦。
 *
 * 核心断言：
 *   - 8 根弦的值来自 examples/tuner.nro 的运行时，而不是本地演示数据；
 *   - 拖弦/拨弦通过 Universe.inject 写回世界，下一拍沿耦合传导；
 *   - 世界的逐拍变化会变成弦上的视觉波；
 *   - 共振点 = 接近悬崖/安全阈值，而不是预设的数字；
 *   - 阈值可拖、写回有编译闸门、Ctrl+Z 可撤销；
 *   - `?world=` 打开任意示例世界，写回目标跟随；同类多根弦用左右方向键切换。
 *
 * 运行：node scripts/gui-test.mjs（需要 127.0.0.1:5188 的 dev server）
 * 结果：artifacts/string-test.json + artifacts/9x-*.png
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

mkdirSync('artifacts', { recursive: true });

const URL = 'http://127.0.0.1:5188/';
const WORLD_PATH = 'examples/tuner.nro';
const TEMP_TUNER = 'examples/_acceptance-tuner.nro';
const TEMP_TWO = 'examples/_acceptance-two.nro';
const TEMP_PLAY = 'examples/_acceptance-play.nro';
const TEMP_AUDIO = 'examples/_acceptance-audio.nro';
const TEMP_CHAPTER = 'examples/_acceptance-chapter.nro';
const TEMP_CHOICES = 'examples/_acceptance-choices.nro';
const TEMP_GLSL = 'examples/_acceptance-glsl.nro';
const TEMP_FAUST = 'examples/_acceptance-faust.nro';
const TEMP_SCENES = 'examples/_acceptance-scenes.nro';
const TEMP_FILES = [TEMP_TUNER, TEMP_TWO, TEMP_PLAY, TEMP_AUDIO, TEMP_CHAPTER, TEMP_CHOICES, TEMP_GLSL, TEMP_FAUST, TEMP_SCENES];
const CHAPTER_WORLD_SOURCE = `世界 章节切换
  版本 0.1
  下一章 "examples/garden.nro"
  上一章 "examples/tuner.nro"

叙事弦 进度
  类型 数值 0..100
  基线 10

结局 终:
  当 进度 >= 0
  下一章 "examples/tuner.nro"
`;
const CHOICES_WORLD_SOURCE = `世界 多出口
  版本 0.1
  下一章 "examples/tuner.nro"

叙事弦 进度
  类型 数值 0..100
  基线 10

结局 终:
  当 进度 >= 0
  下一章 "examples/tuner.nro"
  下一章 "examples/garden.nro"
`;
const GLSL_WORLD_SOURCE = `世界 GLSL端口
  版本 0.1
  章节 "灰度"

叙事弦 雨量
  类型 数值 0..100
  基线 40

纹理资产 雨纹 "textures/rain.svg"

视觉端口 雨幕
  参数 强度 雨量
  纹理 条纹 6

视觉端口 雾
  参数 浓度 雨量
  纹理 渐变
  贴图 雨纹
`;
const FAUST_WORLD_SOURCE = `世界 Faust端口
  版本 0.1
  章节 "低鸣"

叙事弦 潮位
  类型 数值 0..100
  基线 35

音频端口 潮声
  参数 强度 潮位

音频端口 钟声
  参数 强度 潮位
`;
const SCENES_WORLD_SOURCE = `世界 场景切换
  版本 0.1
  初始场景 "夜"

叙事弦 值
  类型 数值 0..10
  基线 0

场景 夜

场景 昼
`;
const AUDIO_WORLD_SOURCE = `世界 音频测试
  版本 0.1

叙事弦 响度
  类型 数值 0..100
  基线 10
  悬崖 5
  安全 95

谱 钟
  段 0.1 0.4 0.9 0.5
  范围 0..1

动作 敲钟
  当 响度 >= 0
  耗时 1
  效果
    响度 += 40
  描述 "敲。"

信号 钟声
  当 响度 > 30
  音频 钟 0.8
`;
const PLAY_WORLD_SOURCE = `世界 可玩层测试
  版本 0.1

叙事弦 信任
  类型 数值 0..100
  基线 90
  悬崖 10
  安全 95

动作 松手
  当 信任 > 0
  耗时 1
  效果
    信任 -= 80
  描述 "松手。"

结局 落点: 当 信任 <= 10
`;
const TWO_WORLD_SOURCE = `世界 双弦测试
  版本 0.1

实体 对手
  是 角色

叙事弦 甲
  类型 数值 0..100
  基线 40
  悬崖 20
  安全 80

叙事弦 乙
  类型 数值 0..100
  基线 70
  悬崖 20
  安全 82

关系弦 丙
  类型 数值 0..1
  基线 0.5
  悬崖 0.8
  安全 0.2
  对象 对手
`;
const cleanupTempFiles = () => {
  for (const file of TEMP_FILES) {
    try {
      unlinkSync(file);
    } catch {
      /* 不存在就算了 */
    }
  }
};
process.on('exit', cleanupTempFiles);
const gitRestoreWorld = () => {
  try {
    execFileSync('git', ['checkout', '--', WORLD_PATH], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
// 自愈：如果上次验收把 tuner.nro 写脏了，先用 git 恢复干净基线，保证验收可重复。
gitRestoreWorld();
const worldBackup = readFileSync(WORLD_PATH, 'utf8');
const restoreWorld = () => {
  if (gitRestoreWorld()) return;
  try {
    writeFileSync(WORLD_PATH, worldBackup, 'utf8');
  } catch {
    /* ignore */
  }
};
process.on('exit', restoreWorld);

const results = [];
const consoleErrors = [];

const parseTrustBaseline = (text) => {
  // 兼容 Windows autocrlf 读出来的 CRLF 与写回的 LF。
  const match = /叙事弦 信任\r?\n(?:[^\r\n]*\r?\n)*?  基线 ([\d.]+)/.exec(text);
  return match ? Number(match[1]) : NaN;
};
const commentCount = (text) => text.split(/\r?\n/).filter((line) => /^\s*#/.test(line)).length;
const originalCommentCount = commentCount(worldBackup);

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// 与 examples/tuner.nro 一致：8 类弦各一根（KIND_ORDER 顺序）。
const VALUES = [55, 64, 50, 72, 44, 36, 28, 0.58];
const NAMES = ['信任', '色温', '步态', '重力', '灵敏度', '连通', '知情', '恐惧'];
const KINDS = ['叙事', '视觉', '动画', '物理', '控制', '空间', '认知', '关系'];
const VALUE_TOP = 110;
const VALUE_BOTTOM = 790;
const RANGES = [
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 100],
  [0, 1],
];
const valueToY = (value, i) => {
  const [min, max] = RANGES[i];
  const norm = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  return VALUE_BOTTOM - norm * (VALUE_BOTTOM - VALUE_TOP);
};
const normOf = (value, i) => {
  const [min, max] = RANGES[i];
  return Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
};

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(900);

const field = page.locator('[data-testid="string-field"]');
const app = page.locator('[data-testid="ink-app"]');
const attr = async (name) => field.getAttribute(name);
const appAttr = async (name) => app.getAttribute(name);
const state = () => page.evaluate(() => window.__neurouString.state());
const curves = () => page.evaluate(() => window.__neurouString.curves());
const lastTouch = () => page.evaluate(() => window.__neurouString.lastTouch());
const rms = () => page.evaluate(() => window.__neurouString.rms());
const valuesOf = async () => JSON.parse(String((await attr('data-values')) ?? '[]'));
const normsOf = async () => JSON.parse(String((await attr('data-norms')) ?? '[]'));
const thresholdsOf = async () => JSON.parse(String((await attr('data-thresholds')) ?? '[]'));
const couplingsOf = async () => JSON.parse(String((await attr('data-couplings')) ?? '[]'));
const readCouplingStrengthFromFile = (from, to) => {
  const text = readFileSync(WORLD_PATH, 'utf8');
  const pattern = new RegExp(`(?:耦合|边) ${from} → ${to}[^\\r\\n]*?(?:强度 )?([\\d.]+)`);
  const match = pattern.exec(text);
  return match ? Number(match[1]) : NaN;
};
const readThresholdFromFile = (which) => {
  const text = readFileSync(WORLD_PATH, 'utf8');
  const pattern = new RegExp(
    `叙事弦 信任\\r?\\n(?:[^\\r\\n]*\\r?\\n)*?  ${which === 'verge' ? '悬崖' : '安全'} ([\\d.]+)`,
  );
  const match = pattern.exec(text);
  return match ? Number(match[1]) : NaN;
};
const hash = async () => createHash('sha256').update(await page.screenshot()).digest('hex').slice(0, 10);
const resetLocal = async () => {
  await page.evaluate(() => window.__neurouString.reset());
  await page.waitForTimeout(260);
};

const canvasStats = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="string-canvas"]');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let ink = 0;
    let colored = 0;
    let minY = height;
    let maxY = -1;
    const rowsMid = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] <= 10) continue;
        ink++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x >= 300 && x < 1200) rowsMid[y]++;
        if (Math.abs(data[i] - data[i + 1]) > 1 || Math.abs(data[i + 1] - data[i + 2]) > 1) colored++;
      }
    }
    return { w: width, h: height, ink, colored, rows: rowsMid, bbox: { y: minY, h: maxY - minY + 1 } };
  });

const countRowBands = (rows, threshold = 200, gapTolerance = 10) => {
  const bands = [];
  let current = null;
  let gap = 0;
  for (let y = 0; y < rows.length; y++) {
    const hit = rows[y] > threshold;
    if (hit) {
      if (!current) current = { start: y, end: y, ink: rows[y] };
      else current.end = y;
      current.ink += rows[y];
      gap = 0;
    } else if (current) {
      gap++;
      if (gap > gapTolerance) {
        bands.push(current);
        current = null;
        gap = 0;
      }
    }
  }
  if (current) bands.push(current);
  return bands;
};

const rowInk = (yLogical, half = 2) =>
  page.evaluate(
    ({ y, half }) => {
      const canvas = document.querySelector('[data-testid="string-canvas"]');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      let count = 0;
      for (let row = Math.max(0, y - half); row <= Math.min(canvas.height - 1, y + half); row++) {
        for (let x = 300; x < 1200; x++) {
          sum += data[(row * canvas.width + x) * 4 + 3];
          count++;
        }
      }
      return sum / Math.max(1, count);
    },
    { y: Math.round(yLogical), half },
  );

// ============ 1. 世界接线：8 根弦来自 tuner.nro ============
check('首屏是八弦场', (await page.locator('[data-testid="string-field"]').count()) === 1);
check('没有按钮/输入框/面板', (await page.locator('button, input, textarea, select, .panel').count()) === 0);
check('没有任何常驻 DOM 文字', (await page.evaluate(() => document.body.innerText.trim())) === '');
check('GUI 读的是真实世界', (await attr('data-world')) === '调律台', String(await attr('data-world')));
check('弦的数量 = 世界里的 8 类弦', Number(await attr('data-lane-count')) === 8, String(await attr('data-lane-count')));
check('lane 顺序 = KIND_ORDER', JSON.stringify(JSON.parse(String(await attr('data-kinds')))) === JSON.stringify(KINDS));
check('Engine.describe 暴露在 GUI', (await appAttr('data-engine-strings')) === '8' && (await appAttr('data-engine-name')) === '调律台', `${await appAttr('data-engine-name')}/${await appAttr('data-engine-strings')}`);
check('Engine.describe 激活系统可观测', (await appAttr('data-engine-active-systems')) !== null, String(await appAttr('data-engine-active-systems')));
const initialValues = await valuesOf();
check(
  '8 个值是 tuner.nro 的运行时初值',
  initialValues.every((v, i) => Math.abs(v - VALUES[i]) < 1e-6),
  JSON.stringify(initialValues),
);
const initialThresholds = await thresholdsOf();
check(
  'data-thresholds 是 8 条弦的悬崖/安全线',
  initialThresholds.length === 8 &&
    initialThresholds[0].verge === 25 &&
    initialThresholds[0].safe === 75 &&
    Math.abs(initialThresholds[0].vergeNorm - 0.25) < 1e-6,
  JSON.stringify(initialThresholds[0]),
);
check('世界逐拍在走', Number(await attr('data-tick')) >= 0, `tick=${await attr('data-tick')}`);
check('世界没有结束', (await attr('data-ended')) === '', String(await attr('data-ended')));
check('有 46 键隐形键盘', (await attr('data-key-count')) === '46');
check('默认焦点是叙事弦（信任）', (await attr('data-kind')) === '叙事' && (await attr('data-kind-index')) === '0');
await resetLocal();

const restStats = await canvasStats();
const restBands = restStats ? countRowBands(restStats.rows) : [];
check('画布上画出 8 条基线', restBands.length === 8, restBands.map((b) => `${b.start}-${b.end}`).join(' | '));
const expectedYs = initialValues.map((v, i) => valueToY(v, i));
const centers = restBands.map((b) => (b.start + b.end) / 2);
check(
  '基线纵坐标 = 世界值的归一化投影',
  expectedYs.every((expected) => centers.some((center) => Math.abs(center - expected) <= 7)),
  `期望 ${expectedYs.map((y) => Math.round(y)).join(',')} / 实测 ${centers.map((y) => Math.round(y)).join(',')}`,
);
check('没有彩色像素', restStats !== null && restStats.colored === 0, `${restStats?.colored}`);
const focusInk = await rowInk(expectedYs[0]);
const otherInk = await rowInk(expectedYs[1]);
check('焦点弦明显比其它弦黑', focusInk > otherInk * 2, `${focusInk.toFixed(1)} vs ${otherInk.toFixed(1)}`);
const idleA = await hash();
await page.waitForTimeout(360);
const idleB = await hash();
check('焦点弦高频微颤（两帧不同）', idleA !== idleB, `${idleA} / ${idleB}`);
const norms = await normsOf();
check(
  'data-norms 与值一一对应（关系弦 0..1 也正确归一）',
  norms.every((n, i) => Math.abs(n - normOf(initialValues[i], i)) < 1e-3),
  JSON.stringify(norms),
);
await page.screenshot({ path: 'artifacts/90-string-world.png' });

// tick 推进
const tickBefore = Number(await attr('data-tick'));
await page.waitForTimeout(1200);
const tickAfter = Number(await attr('data-tick'));
check('逐拍运行时在推进（tick 增长）', tickAfter > tickBefore, `${tickBefore} → ${tickAfter}`);

// ============ 2. 拖弦 = 写回世界，下一拍沿耦合传导 ============
await resetLocal();
const beforeDrag = await valuesOf();
const baseY = valueToY(beforeDrag[0], 0);
await page.mouse.move(720, Math.round(baseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(baseY) + 100, { steps: 10 });
await page.waitForTimeout(160);
check('拖弦时 data-pulling=true', (await attr('data-pulling')) === 'true');
const dragged = await valuesOf();
check('拖动把真实世界值改小', dragged[0] < beforeDrag[0] - 5, `${beforeDrag[0]} → ${dragged[0].toFixed(1)}`);
const plucksAtDrag = Number(await attr('data-plucks'));
await page.mouse.up();
await page.waitForTimeout(1200);
check('松手不额外拨弦', Number(await attr('data-plucks')) === plucksAtDrag);
const afterCoupling = await valuesOf();
const changedOthers = afterCoupling.filter((v, i) => {
  if (i === 0) return false;
  const [min, max] = RANGES[i];
  return Math.abs(v - beforeDrag[i]) / (max - min || 1) > 0.004;
}).length;
check(
  '世界耦合真的把变化传到了别的弦（不是本地假动画）',
  changedOthers >= 2,
  `变了 ${changedOthers} 根：${afterCoupling.map((v, i) => `${NAMES[i]}:${v.toFixed(3)}`).join(' ')}`,
);
const coupledCurves = await curves();
const colorLane = coupledCurves.find((c) => c.kind === '视觉');
const colorWave = colorLane ? Math.max(...colorLane.samples.map((v) => Math.abs(v))) : 0;
check('被耦合的弦上有视觉波（数据流变成涟漪）', colorWave > 1, `色温波幅 ${colorWave.toFixed(1)}px`);
await page.screenshot({ path: 'artifacts/91-string-coupling.png' });

// ============ 3. 拨弦：视觉 + 8% 量程的真实注入 ============
await resetLocal();
const beforePluck = await valuesOf();
const pluckBase = valueToY(beforePluck[0], 0);
const pluckPx = Math.round(pluckBase - 150);
await page.mouse.click(720, pluckPx);
await page.waitForTimeout(160);
check('点击拨弦计数 +1', Number(await attr('data-plucks')) === 1, String(await attr('data-plucks')));
check('点击在弦上方 → 向上拨', (await attr('data-last-direction')) === 'up', String(await attr('data-last-direction')));
const afterPluck = await valuesOf();
check(
  '拨弦会推动真实世界值（约 8% 量程）',
  Math.abs(afterPluck[0] - beforePluck[0]) > 1,
  `${beforePluck[0].toFixed(1)} → ${afterPluck[0].toFixed(1)}`,
);
const pluckState = await state();
check('拨动后弦在振动', pluckState.amplitude > 20, `amplitude=${pluckState.amplitude.toFixed(1)}`);
const pluckStats = await canvasStats();
check('拨动后墨量增加（残影/拖尾）', restStats !== null && pluckStats !== null && pluckStats.ink > restStats.ink * 1.1, `${restStats?.ink} → ${pluckStats?.ink}`);
await page.screenshot({ path: 'artifacts/92-string-pluck.png' });

// 键盘：同样写回世界（先把信任放回 55，保证 A 键与基线的距离足够产生 >1 的变化）
await resetLocal();
await page.evaluate(() => window.__neurouString.setValue('叙事', 55));
await page.waitForTimeout(150);
const beforeKey = await valuesOf();
await page.keyboard.press('a');
await page.waitForTimeout(160);
check('按 A 拨弦并映射到 KeyA', (await attr('data-last-key')) === 'KeyA' && Number(await attr('data-plucks')) === 1);
check('A 在信任弦下方 → 向下拨', (await attr('data-last-direction')) === 'down');
const afterKey = await valuesOf();
check('键盘拨动也写回真实值', Math.abs(afterKey[0] - beforeKey[0]) > 1, `${beforeKey[0].toFixed(1)} → ${afterKey[0].toFixed(1)}`);

// ============ 3b. 按住绷弦（鼠标/键盘长按） ============
await resetLocal();
const holdBaseY = valueToY((await valuesOf())[0], 0);
await page.mouse.move(720, Math.round(holdBaseY - 160));
await page.mouse.down();
await page.waitForTimeout(380);
check('按住不动 → 弦被绷住（data-holding=true）', (await attr('data-holding')) === 'true', String(await attr('data-holding')));
check('按住时只有一个 pin', Number(await attr('data-held-count')) === 1, String(await attr('data-held-count')));
check('按住期间还没有拨弦', Number(await attr('data-plucks')) === 0, String(await attr('data-plucks')));
const heldAmp = Number(await attr('data-held-amplitude'));
check('绷住的幅度接近按住点位移', Math.abs(heldAmp - 160) <= 25, String(heldAmp));
const pinNow = await page.evaluate(() => window.__neurouString.pinInfo());
check('pinInfo 指向按住点', pinNow.active === true && Math.abs(pinNow.x - 720) < 10, JSON.stringify(pinNow));
await page.screenshot({ path: 'artifacts/99-string-hold.png' });
await page.mouse.move(620, Math.round(holdBaseY - 110), { steps: 6 });
await page.waitForTimeout(160);
const pinMoved = await page.evaluate(() => window.__neurouString.pinInfo());
check(
  '按住后移动指针，波峰跟随',
  pinMoved.active === true && Math.abs(pinMoved.x - 620) < 15 && Math.abs(pinMoved.amplitude - 110) < 30,
  JSON.stringify(pinMoved),
);
await page.mouse.up();
await page.waitForTimeout(220);
check('松手释放一次拨弦', Number(await attr('data-plucks')) === 1 && (await attr('data-last-direction')) === 'up', String(await attr('data-plucks')));

await resetLocal();
await page.keyboard.down('a');
await page.waitForTimeout(380);
check('键盘长按也绷住', (await attr('data-holding')) === 'true', String(await attr('data-holding')));
check('键盘按住期间不拨弦', Number(await attr('data-plucks')) === 0, String(await attr('data-plucks')));
await page.keyboard.up('a');
await page.waitForTimeout(220);
check('键盘松手拨一次', Number(await attr('data-plucks')) === 1, String(await attr('data-plucks')));

// 键盘多键同时按：每键独立 pin / 独立拨弦
await resetLocal();
await page.keyboard.down('a');
await page.keyboard.down('d');
await page.waitForTimeout(380);
check('同时按住两键 → 两个 pin', Number(await attr('data-held-count')) === 2 && (await attr('data-holding')) === 'true', String(await attr('data-held-count')));
check('多键按住期间不拨弦', Number(await attr('data-plucks')) === 0, String(await attr('data-plucks')));
const pinsWhileHeld = await page.evaluate(() => window.__neurouString.pins());
check('pins() 给出两个按键 pin', Array.isArray(pinsWhileHeld) && pinsWhileHeld.length === 2, JSON.stringify(pinsWhileHeld));
await page.keyboard.up('a');
await page.waitForTimeout(160);
check('松开一键只拨一次、余键仍按住', Number(await attr('data-plucks')) === 1 && Number(await attr('data-held-count')) === 1, `${await attr('data-plucks')}/${await attr('data-held-count')}`);
await page.keyboard.up('d');
await page.waitForTimeout(200);
check('再松另一键 → 共拨两次', Number(await attr('data-plucks')) === 2 && Number(await attr('data-held-count')) === 0, String(await attr('data-plucks')));

// v5.34：弦类别决定交互方式
await resetLocal();
await page.keyboard.press('Tab'); // 叙事 → 视觉（持续）
await page.waitForTimeout(180);
const sustainPlucks = Number(await attr('data-plucks'));
await page.keyboard.down('a');
await page.waitForTimeout(220);
check('持续型：按下持续发声', (await page.evaluate(() => window.__neurouString.sustainedStrings())) === 1, 'sustained');
check('持续型：弦形状显示持续音波形', (await page.evaluate(() => window.__neurouString.focusWaveSpread())) > 20, String(await page.evaluate(() => window.__neurouString.focusWaveSpread())));
await page.keyboard.up('a');
await page.waitForTimeout(220);
check(
  '持续型：松手停止且不产生拨弦判定',
  Number(await page.evaluate(() => window.__neurouString.sustainedStrings())) === 0 && Number(await attr('data-plucks')) === sustainPlucks,
  String(await attr('data-plucks')),
);
await page.keyboard.down('a');
await page.keyboard.down('s');
await page.waitForTimeout(260);
check('持续型：多键同时按住为复音', Number(await page.evaluate(() => window.__neurouString.sustainedStrings())) >= 2, String(await page.evaluate(() => window.__neurouString.sustainedStrings())));
await page.keyboard.up('a');
await page.keyboard.up('s');
await page.waitForTimeout(220);
await page.keyboard.press('Alt+1');
await page.waitForTimeout(200);
check('持续型：Alt+1 应用正弦波形预设', (await page.evaluate(() => window.__neurouString.focusWaveSpread())) > 20, String(await page.evaluate(() => window.__neurouString.focusWaveSpread())));
await page.keyboard.press('Alt+R');
await page.waitForTimeout(200);
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab'); // 视觉 → 动画 → 物理 → 控制（头判）
await page.waitForTimeout(180);
const headBefore = Number(await attr('data-plucks'));
await page.keyboard.down('a');
await page.waitForTimeout(180);
const headAfterDown = Number(await attr('data-plucks'));
await page.keyboard.up('a');
await page.waitForTimeout(180);
check('头判型：按下即判定、松手不重复', headAfterDown === headBefore + 1 && Number(await attr('data-plucks')) === headAfterDown, `${headBefore}→${headAfterDown}`);

// ============ 4. 阈值共振：共振点来自悬崖/安全线 ============
await resetLocal();
await page.evaluate(() => window.__neurouString.setValue('叙事', 26));
await page.waitForTimeout(180);
check(
  '信任靠近悬崖 25 → 进入驻波态',
  (await attr('data-resonant')) === 'true' && Math.abs(Number(await attr('data-resonance')) - 25) <= 0.6,
  `${await attr('data-resonant')} / ${await attr('data-resonance')}`,
);
await page.screenshot({ path: 'artifacts/93-string-threshold.png' });
await page.evaluate(() => window.__neurouString.setValue('叙事', 74));
await page.waitForTimeout(180);
check(
  '信任靠近安全线 75 → 也进入驻波态',
  (await attr('data-resonant')) === 'true' && Math.abs(Number(await attr('data-resonance')) - 75) <= 0.6,
  `${await attr('data-resonant')} / ${await attr('data-resonance')}`,
);
await page.evaluate(() => window.__neurouString.setValue('叙事', 50));
await page.waitForTimeout(180);
check('离开阈值带 → 回到普通态', (await attr('data-resonant')) === 'false', String(await attr('data-resonant')));

// ============ 5. Tab / 干涉 / ESC ============
await resetLocal();
const kindSequence = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  kindSequence.push(await attr('data-kind'));
}
check('Tab 依次切换 8 类弦焦点', JSON.stringify(kindSequence) === JSON.stringify([...KINDS.slice(1), KINDS[0]]));
await resetLocal();

// 把两根弦拉近并拨动 → 交点
await page.evaluate(() => {
  window.__neurouString.setValue('叙事', 60);
  window.__neurouString.setValue('视觉', 61);
});
await page.waitForTimeout(220);
const crossValues = await valuesOf();
const crossBase = valueToY(crossValues[0], 0);
await page.mouse.click(720, Math.round(crossBase - 220));
await page.waitForTimeout(320);
const crossings = Number(await attr('data-crossings'));
const crossDbg = {
  values: await valuesOf(),
  plucks: await attr('data-plucks'),
  lastAmp: await attr('data-last-amplitude'),
  clickY: Math.round(crossBase - 220),
};
check('两弦靠近后出现干涉奇点', crossings > 0, `crossings=${crossings} ${JSON.stringify(crossDbg)}`);
await page.screenshot({ path: 'artifacts/94-string-crossing.png' });

await page.keyboard.press('Escape');
await page.waitForTimeout(320);
check('ESC 进入总览', (await attr('data-mode')) === 'overview' && Number(await attr('data-overview-rows')) === 8);
await page.screenshot({ path: 'artifacts/95-string-overview.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(260);
check('再按 ESC 回到八弦', (await attr('data-mode')) === 'strings');

// ============ 7. 结构编辑：拖动阈值刻度 + 编译闸门 + 撤销/重做 ============
await page.waitForTimeout(1300); // 结清前面的写回，让 savedText 与磁盘一致
const thresholdPreText = readFileSync(WORLD_PATH, 'utf8');
const thresholdPre = (await thresholdsOf())[0];
check('拖动前：信任悬崖在 25', Math.abs(thresholdPre.verge - 25) < 1e-6, JSON.stringify(thresholdPre));
const vergeY0 = valueToY(thresholdPre.verge, 0);
const vergeY1 = valueToY(40, 0);
await page.mouse.move(46, Math.round(vergeY0));
await page.mouse.down();
await page.mouse.move(46, Math.round(vergeY1), { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1700);
const thresholdAfter = (await thresholdsOf())[0];
check(
  '拖动左侧悬崖刻度 → 阈值改变',
  Math.abs(thresholdAfter.verge - 40) <= 1.5,
  `25 → ${thresholdAfter.verge}`,
);
check('阈值编辑也会触发写回', (await appAttr('data-save-state')) === 'saved', String(await appAttr('data-save-state')));
const vergeInFile = readThresholdFromFile('verge');
check('文件里的悬崖线被重写', Math.abs(vergeInFile - thresholdAfter.verge) <= 0.01, `file=${vergeInFile}`);
const thresholdPostText = readFileSync(WORLD_PATH, 'utf8');
check(
  '阈值写回保留原文件注释（行级 patch）',
  thresholdPostText.includes('# 八弦调律台的默认世界') &&
    commentCount(thresholdPostText) === originalCommentCount &&
    !thresholdPostText.includes('由 neurou 序列化器生成'),
  `comments ${commentCount(thresholdPostText)}/${originalCommentCount}`,
);
await page.screenshot({ path: 'artifacts/96-string-threshold-edit.png' });

// Ctrl+Z 撤销 → 回到上一次保存的文本；Ctrl+Shift+Z 重做（必须在刷新前，历史在内存里）
await page.keyboard.press('Control+z');
await page.waitForTimeout(1200);
const thresholdUndone = (await thresholdsOf())[0];
check('Ctrl+Z 撤销阈值编辑', Math.abs(thresholdUndone.verge - 25) <= 0.01, `verge=${thresholdUndone.verge}`);
check('撤销后磁盘文件回到上一版', readFileSync(WORLD_PATH, 'utf8') === thresholdPreText);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(1200);
const thresholdRedone = (await thresholdsOf())[0];
check('Ctrl+Shift+Z 重做阈值编辑', Math.abs(thresholdRedone.verge - thresholdAfter.verge) <= 0.01, `verge=${thresholdRedone.verge}`);
check('重做后磁盘文件回到编辑版', readFileSync(WORLD_PATH, 'utf8') === thresholdPostText);

// 刷新后阈值保持
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
const thresholdReloaded = (await thresholdsOf())[0];
check(
  '刷新后阈值保持（写回持久化）',
  Math.abs(thresholdReloaded.verge - thresholdAfter.verge) <= 0.01,
  `${thresholdAfter.verge} / ${thresholdReloaded.verge}`,
);

// ============ 8. 耦合编辑：焦点弦耦合标记 + 悬停滚轮 ============
await page.waitForTimeout(800);
const couplingList = await couplingsOf();
check('data-couplings 包含世界里的 10 条耦合', couplingList.length === 10, String(couplingList.length));
const colorCoupling = couplingList.find((c) => c.from === '信任' && c.to === '色温');
check('耦合投影带两端 id 与强度', colorCoupling?.polarity === 1 && Math.abs(colorCoupling.strength - 0.5) < 1e-6, JSON.stringify(colorCoupling));
const marks = await page.evaluate(() => window.__neurouString.couplingMarks());
// 信任→恐惧 与 恐惧→信任 的中点重合；用 信任→色温（midY 唯一）避免命中歧义。
const trustColorMark = marks.find((m) => m.from === '信任' && m.to === '色温');
check('焦点弦画出了耦合标记', Boolean(trustColorMark), `${marks.length} 个`);
const couplingPreText = readFileSync(WORLD_PATH, 'utf8');
if (trustColorMark) {
  await page.mouse.move(trustColorMark.x, trustColorMark.y);
  await page.waitForTimeout(160);
  await page.screenshot({ path: 'artifacts/97-string-coupling-edit.png' });
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(300);
  const after = (await couplingsOf()).find((c) => c.from === '信任' && c.to === '色温');
  const delta = after ? after.strength - colorCoupling.strength : 0;
  check('滚轮改变耦合强度（3 格 ≈ ±0.15）', Math.abs(delta) >= 0.1 && Math.abs(delta) <= 0.25, `${colorCoupling.strength} → ${after?.strength}`);
  check('data-coupling-edits 计数增加', Number((await appAttr('data-coupling-edits')) ?? 0) >= 1, String(await appAttr('data-coupling-edits')));
  const lastEdit = JSON.parse(String((await appAttr('data-last-coupling')) || '{}'));
  check('data-last-coupling 指向被编辑的耦合', lastEdit.from === '信任' && lastEdit.to === '色温', JSON.stringify(lastEdit));
  await page.waitForTimeout(1700);
  const fileStrength = readCouplingStrengthFromFile('信任', '色温');
  check('文件里的耦合强度被重写', Math.abs(fileStrength - (after?.strength ?? NaN)) <= 0.01, `file=${fileStrength}`);
  check('耦合写回保留原文件注释（行级 patch）', commentCount(readFileSync(WORLD_PATH, 'utf8')) === originalCommentCount);
  check('耦合编辑写回状态 = saved', (await appAttr('data-save-state')) === 'saved', String(await appAttr('data-save-state')));
  // Ctrl+Z 撤销耦合编辑
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  const undone = (await couplingsOf()).find((c) => c.from === '信任' && c.to === '色温');
  check('Ctrl+Z 撤销耦合编辑', Math.abs((undone?.strength ?? NaN) - colorCoupling.strength) < 1e-6, `→ ${undone?.strength}`);
  check('撤销后耦合文件回到上一版', readFileSync(WORLD_PATH, 'utf8') === couplingPreText);
}

// ============ 8a. 增删耦合：Shift+↑/↓ 选目标，Shift+Enter 切换 ============
await page.waitForTimeout(300);
const linkPreFile = readFileSync(WORLD_PATH, 'utf8');
const linkPreCount = (await couplingsOf()).length;
check('初始没有 信任→步态 耦合', !(await couplingsOf()).some((c) => c.from === '信任' && c.to === '步态'));
// 其它 lanes 的顺序：色温、步态、重力……（信任为焦点）
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await page.waitForTimeout(120);
check('Shift+ArrowDown 选中耦合目标「步态」', (await attr('data-link-target')) === '步态', String(await attr('data-link-target')));
const linkTarget = await page.evaluate(() => window.__neurouString.linkTarget());
check('linkTarget 给出目标与是否已有耦合', linkTarget?.name === '步态' && linkTarget.existing === false, JSON.stringify(linkTarget));
await page.screenshot({ path: 'artifacts/98-string-link.png' });
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(180);
let linkList = await couplingsOf();
check('Shift+Enter 新增耦合 信任→步态', linkList.length === linkPreCount + 1 && linkList.some((c) => c.from === '信任' && c.to === '步态'), `${linkPreCount} → ${linkList.length}`);
check('data-coupling-adds 计数', Number((await appAttr('data-coupling-adds')) ?? 0) >= 1, String(await appAttr('data-coupling-adds')));
await page.waitForTimeout(1700);
const linkAddedText = readFileSync(WORLD_PATH, 'utf8');
check('新增耦合写回文件', linkAddedText.includes('耦合 信任 → 步态 同向 0.2'));
check('新增耦合保留注释', commentCount(linkAddedText) === originalCommentCount);
check('新增耦合走行级 patch', (await appAttr('data-save-mode')) === 'patch', String(await appAttr('data-save-mode')));
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(180);
linkList = await couplingsOf();
check('再次 Shift+Enter 删除耦合', linkList.length === linkPreCount && !linkList.some((c) => c.from === '信任' && c.to === '步态'), `${linkList.length}`);
await page.waitForTimeout(1700);
const linkRemovedText = readFileSync(WORLD_PATH, 'utf8');
check('删除耦合写回文件（行消失）', !linkRemovedText.includes('耦合 信任 → 步态'));
check('删除后文件恢复原排版', linkRemovedText === linkPreFile);
// 回路边删除被拒绝
await page.keyboard.press('Shift+ArrowUp');
await page.waitForTimeout(120);
check('目标切回「色温」', (await attr('data-link-target')) === '色温', String(await attr('data-link-target')));
const loopBefore = (await couplingsOf()).length;
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(300);
check('回路边删除被 App 拒绝', (await couplingsOf()).length === loopBefore && String(await appAttr('data-save-error')).length > 0, String(await appAttr('data-save-error')));
await page.keyboard.press('Escape');

// ============ 8c. 增删弦：Alt+Enter / Alt+Backspace ============
await page.waitForTimeout(300);
const stringPreFile = readFileSync(WORLD_PATH, 'utf8');
const lanePreCount = Number(await attr('data-lane-count'));
check('初始焦点 id = 信任', (await attr('data-focus-id')) === '信任', String(await attr('data-focus-id')));
await page.keyboard.press('Alt+Enter');
await page.waitForTimeout(280);
check('Alt+Enter 新增同类弦（同类多实例，视图仍每类一根）', Number((await appAttr('data-string-adds')) ?? 0) >= 1 && Number(await attr('data-lane-count')) === lanePreCount, String(await appAttr('data-string-adds')));
check('data-string-adds 计数', Number((await appAttr('data-string-adds')) ?? 0) >= 1, String(await appAttr('data-string-adds')));
await page.waitForTimeout(1700);
const stringAddedText = readFileSync(WORLD_PATH, 'utf8');
check('新增弦写回文件（整块插入）', stringAddedText.includes('叙事弦 信任新'));
check('新增弦保留注释', commentCount(stringAddedText) === originalCommentCount);
check('新增弦走行级 patch', (await appAttr('data-save-mode')) === 'patch', String(await appAttr('data-save-mode')));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(160);
check('ArrowRight 切到新弦', (await attr('data-focus-id')) === '信任新', String(await attr('data-focus-id')));
await page.keyboard.press('Alt+Backspace');
await page.waitForTimeout(280);
check('Alt+Backspace 删除新弦', Number(await attr('data-lane-count')) === lanePreCount && (await attr('data-focus-id')) === '信任', String(await attr('data-focus-id')));
check('data-string-removes 计数', Number((await appAttr('data-string-removes')) ?? 0) >= 1, String(await appAttr('data-string-removes')));
await page.waitForTimeout(1700);
check('删除弦后文件恢复原排版', readFileSync(WORLD_PATH, 'utf8') === stringPreFile);
// 被规则/回路引用的弦不能被删除
const focusNow = String(await attr('data-focus-id'));
if (focusNow !== '信任') {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
}
const laneBeforeRefuse = Number(await attr('data-lane-count'));
await page.keyboard.press('Alt+Backspace');
await page.waitForTimeout(300);
check('删除被引用/回路中的弦被拒绝', Number(await attr('data-lane-count')) === laneBeforeRefuse && String(await appAttr('data-save-error')).length > 0, String(await appAttr('data-save-error')));

// ============ 8b. 撤销缓动（不是闪回） ============
await page.waitForTimeout(300);
const easingPreFile = readFileSync(WORLD_PATH, 'utf8');
const easingTarget = parseTrustBaseline(easingPreFile);
const easFrom = (await valuesOf())[0];
const easBaseY = valueToY(easFrom, 0);
await page.mouse.move(720, Math.round(easBaseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(easBaseY) + 90, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1700);
const easEdited = (await valuesOf())[0];
check('缓动前：拖动写回了不同值', Math.abs(easEdited - easFrom) > 3, `${easFrom.toFixed(2)} → ${easEdited.toFixed(2)}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(110);
check('Ctrl+Z 进入缓动状态', (await appAttr('data-transition')) === 'undo', String(await appAttr('data-transition')));
const easMid1 = (await valuesOf())[0];
check(
  '缓动中途：值已开始回退但还没到终点',
  Math.abs(easMid1 - easEdited) > 0.05 && Math.abs(easMid1 - easingTarget) > 0.05,
  `${easEdited.toFixed(2)} → ${easMid1.toFixed(2)} → ${easingTarget}`,
);
await page.waitForTimeout(200);
const easMid2 = (await valuesOf())[0];
check('缓动是渐进的（两个采样点不同）', Math.abs(easMid2 - easMid1) > 0.02, `${easMid1.toFixed(2)} → ${easMid2.toFixed(2)}`);
await page.waitForTimeout(1000);
check('缓动结束，data-transition 清空', (await appAttr('data-transition')) === '');
const easFinal = (await valuesOf())[0];
check('缓动结束在目标基线', Math.abs(easFinal - easingTarget) < 0.02, `${easFinal.toFixed(2)} vs ${easingTarget}`);
check('撤销后的文件回到编辑前一版', readFileSync(WORLD_PATH, 'utf8') === easingPreFile);

// ============ 9. 写回 .nro（GUI → 运行时 → IR → 文本） ============
await page.waitForTimeout(1300); // 结清前面手势的 debounce 写回
const preFile = readFileSync(WORLD_PATH, 'utf8');
const preBaseline = parseTrustBaseline(preFile);
const savesBefore = Number((await appAttr('data-saves')) ?? 0);
const trustBefore = (await valuesOf())[0];
const dragBaseY = valueToY(trustBefore, 0);
await page.mouse.move(720, Math.round(dragBaseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(dragBaseY) + 64, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1700);
const savesAfter = Number((await appAttr('data-saves')) ?? 0);
check('用户松手后触发写回（data-saves 增加）', savesAfter > savesBefore, `${savesBefore} → ${savesAfter}`);
check('写回状态 = saved', (await appAttr('data-save-state')) === 'saved', String(await appAttr('data-save-state')));
const fileAfter = readFileSync(WORLD_PATH, 'utf8');
check(
  '拖弦写回保留原文件注释与排版（行级 patch）',
  fileAfter.includes('# 八弦调律台的默认世界') &&
    commentCount(fileAfter) === originalCommentCount &&
    !fileAfter.includes('由 neurou 序列化器生成'),
  `comments ${commentCount(fileAfter)}/${originalCommentCount}`,
);
const savedBaseline = parseTrustBaseline(fileAfter);
check('写回走行级 patch（data-save-mode=patch）', (await appAttr('data-save-mode')) === 'patch', String(await appAttr('data-save-mode')));
check(
  '文件里的「信任」基线被更新',
  Number.isFinite(savedBaseline) && Math.abs(savedBaseline - preBaseline) > 1,
  `写回前 ${preBaseline} → 写回后 ${savedBaseline}`,
);
await page.screenshot({ path: 'artifacts/96-string-saved.png' });

// 刷新页面：应从刚写下的基线开局（持久化生效）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
const reloaded = await valuesOf();
check(
  '刷新后从写回的基线开始（持久化生效）',
  Math.abs(reloaded[0] - savedBaseline) < 0.01,
  `文件基线=${savedBaseline} 刷新后=${reloaded[0].toFixed(3)}`,
);

// 恢复原始世界，再刷新，确认验收不会污染仓库
restoreWorld();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
const restored = await valuesOf();
check('恢复原文件后刷新回到原初值', restored.every((v, i) => Math.abs(v - VALUES[i]) < 1e-6), JSON.stringify(restored));

// ============ 8. 声音 / 性能 / 错误 ============
// 写回验收期间刷新过页面，AudioContext 需要一次手势才创建。
// 这里用 debug pluckAt（会发声、但不落盘），避免在验收收尾时又写一次 tuner.nro。
await page.evaluate(() => window.__neurouString.pluckAt(720, 300));
await page
  .waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="string-field"]');
      return el !== null && el.getAttribute('data-audio') !== 'off';
    },
    { timeout: 3000 },
  )
  .catch(() => {
    /* 超时后仍做一次断言，让失败信息可见 */
  });
const audioState = await attr('data-audio');
check('音频引擎可用', audioState === 'running' || audioState === 'suspended', String(audioState));
await page.waitForTimeout(240); // 等 pluck 真正进入 Analyser 窗口
const finalRms = await rms();
check('拨弦后有真实信号（rms>0.001）', finalRms > 0.001, finalRms.toFixed(6));
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
const worldName = String(await attr('data-world'));
check('没有页面级报错', consoleErrors.length === 0, consoleErrors.join(' | '));

// ============ 9. 任意世界 + 同类多根弦 ============
// 先把 tuner.nro 恢复到干净状态，避免前面手势的 debounce 写回污染 §9 的副本。
await page.waitForTimeout(900);
restoreWorld();
const tunerClean = readFileSync(WORLD_PATH, 'utf8');
// 单实例世界里，左右方向键不应有任何副作用
const lanesBeforeArrow = await page.evaluate(() => window.__neurouString.state().lanes.map((l) => l.name));
const plucksBeforeArrow = Number(await attr('data-plucks'));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(180);
const lanesAfterArrow = await page.evaluate(() => window.__neurouString.state().lanes.map((l) => l.name));
check(
  '单实例世界里方向键无副作用',
  JSON.stringify(lanesBeforeArrow) === JSON.stringify(lanesAfterArrow) &&
    Number(await attr('data-plucks')) === plucksBeforeArrow,
  `${lanesBeforeArrow.join(',')} / ${lanesAfterArrow.join(',')}`,
);

const gotoWorld = async (file) => {
  await page.goto(`${URL}?world=${encodeURIComponent(file)}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
  await page.waitForTimeout(1000);
};

// A. 打开一个世界副本，写回目标跟随当前文件
copyFileSync(WORLD_PATH, TEMP_TUNER);
const tunerBeforeOtherWorld = readFileSync(WORLD_PATH, 'utf8');
await gotoWorld(TEMP_TUNER);
check(
  '?world= 打开任意世界',
  (await appAttr('data-world-file')) === TEMP_TUNER && (await attr('data-world')) === '调律台',
  String(await appAttr('data-world-file')),
);
check('该世界初值来自它的文件', JSON.stringify(await valuesOf()) === JSON.stringify(VALUES));
const tempBaseY = valueToY((await valuesOf())[0], 0);
await page.mouse.move(720, Math.round(tempBaseY));
await page.mouse.down();
await page.mouse.move(720, Math.round(tempBaseY) + 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1700);
const tempText = readFileSync(TEMP_TUNER, 'utf8');
const tempTrust = parseTrustBaseline(tempText);
check(
  '写回目标是当前世界文件（保留其注释）',
  tempText.includes('# 八弦调律台的默认世界') &&
    !tempText.includes('由 neurou 序列化器生成') &&
    Math.abs(tempTrust - (await valuesOf())[0]) < 2,
  `file=${tempTrust} view=${(await valuesOf())[0].toFixed(2)}`,
);
check('原 tuner.nro 不被误写', readFileSync(WORLD_PATH, 'utf8') === tunerBeforeOtherWorld);

// B. 同类多根弦：ArrowLeft/Right 切换
writeFileSync(TEMP_TWO, TWO_WORLD_SOURCE, 'utf8');
await gotoWorld(TEMP_TWO);
check(
  '双弦世界加载（2 类共 3 根弦，界面每类一根）',
  (await attr('data-world')) === '双弦测试' && Number(await attr('data-lane-count')) === 2,
  `${await attr('data-world')} / ${await attr('data-lane-count')}`,
);
const tmpLanes = () => page.evaluate(() => window.__neurouString.state().lanes.map((l) => ({ kind: l.kind, name: l.name, value: l.value })));
const firstLane = (await tmpLanes())[0];
check('默认显示每类第一根', firstLane.kind === '叙事' && firstLane.name === '甲' && Math.abs(firstLane.value - 40) < 1e-6, JSON.stringify(firstLane));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(260);
const secondLane = (await tmpLanes())[0];
check(
  'ArrowRight 切到同类下一根',
  secondLane.name === '乙' && Math.abs(secondLane.value - 70) < 1e-6 && Number(await attr('data-plucks')) === 0,
  JSON.stringify(secondLane),
);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(260);
const backLane = (await tmpLanes())[0];
check('ArrowLeft 切回同类上一根', backLane.name === '甲' && Math.abs(backLane.value - 40) < 1e-6, JSON.stringify(backLane));
await page.screenshot({ path: 'artifacts/98-string-world-switch.png' });

// ============ 12. 谱模式：F2 进入、拖段点、行级写回、撤销 ============
const SPECTRA_PATH = 'examples/spectra.nro';
const spectraBefore = readFileSync(SPECTRA_PATH, 'utf8');
await page.goto('http://127.0.0.1:5188/?world=examples/spectra.nro', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(900);
check('谱示例世界可加载', (await attr('data-world')) === '谱之境', String(await attr('data-world')));
await page.keyboard.press('F2');
await page.waitForTimeout(500);
const spectrumField = page.locator('[data-testid="spectrum-field"]');
check('F2 进入谱模式', (await appAttr('data-screen')) === 'spectrum' && (await spectrumField.count()) === 1, String(await appAttr('data-screen')));
check('显示第一条谱「情绪地形」', (await spectrumField.getAttribute('data-spectrum-name')) === '情绪地形', String(await spectrumField.getAttribute('data-spectrum-name')));
const spectrumBandsBefore = JSON.parse(String((await spectrumField.getAttribute('data-band-values')) ?? '[]'));
check('初始 4 个段值', spectrumBandsBefore.length === 4, JSON.stringify(spectrumBandsBefore));
await page.screenshot({ path: 'artifacts/99-string-spectrum.png' });
const bandPositions = await page.evaluate(() => window.__neurouSpectrum?.bandPositions() ?? []);
const band1 = bandPositions[1];
if (band1) {
  await page.mouse.move(band1.x, band1.y);
  await page.mouse.down();
  await page.mouse.move(band1.x, band1.y - 100, { steps: 10 });
  await page.waitForTimeout(260);
  await page.mouse.up();
  await page.waitForTimeout(1400);
  const bandsAfter = JSON.parse(String((await spectrumField.getAttribute('data-band-values')) ?? '[]'));
  check('拖动段点改变曲线值', Math.abs(bandsAfter[1] - spectrumBandsBefore[1]) > 0.05, `${spectrumBandsBefore[1]} → ${bandsAfter[1]}`);
  check('段值写回走行级 patch', (await appAttr('data-save-mode')) === 'patch', String(await appAttr('data-save-mode')));
  const spectraAfterText = readFileSync(SPECTRA_PATH, 'utf8');
  const bandLine = spectraAfterText.split(/\r?\n/).find((line) => line.trimStart().startsWith('段')) ?? '';
  check('文件里的段行被更新、注释保留', /段 0\.1 0\.\d+ 0\.8 0\.5/.test(bandLine) && spectraAfterText.includes('# 谱（stage 1）'), bandLine);
  check('谱编辑计数', Number((await appAttr('data-spectrum-band-edits')) ?? 0) >= 1, String(await appAttr('data-spectrum-band-edits')));
  await page.screenshot({ path: 'artifacts/99-string-spectrum-edited.png' });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  const bandsUndo = JSON.parse(String((await spectrumField.getAttribute('data-band-values')) ?? '[]'));
  check('Ctrl+Z 撤销谱编辑', Math.abs(bandsUndo[1] - spectrumBandsBefore[1]) < 1e-3, JSON.stringify(bandsUndo));
  check('撤销后谱文件恢复原样', readFileSync(SPECTRA_PATH, 'utf8') === spectraBefore);
}
await page.keyboard.press('F2');
await page.waitForTimeout(300);
check('F2 退出谱模式回到八弦', (await appAttr('data-screen')) === 'strings', String(await appAttr('data-screen')));
execFileSync('git', ['checkout', '--', SPECTRA_PATH], { stdio: 'ignore' });

// 默认 tuner 现在也带一条示例谱：首屏 F2 即可进入
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]');
await page.waitForTimeout(900);
await page.keyboard.press('F2');
await page.waitForTimeout(500);
check('默认 tuner 的 F2 也能进入谱模式', (await appAttr('data-screen')) === 'spectrum', String(await appAttr('data-screen')));
check('默认 tuner 的谱名为「情绪音色」', (await page.locator('[data-testid="spectrum-field"]').getAttribute('data-spectrum-name')) === '情绪音色', String(await page.locator('[data-testid="spectrum-field"]').getAttribute('data-spectrum-name')));
const spectrumRoot = page.locator('[data-testid="spectrum-field"]');
const bandsOf = async () => JSON.parse(String((await spectrumRoot.getAttribute('data-band-values')) ?? '[]'));
// v2.4.2：F2 谱双击空白增点 / Delete 删点
const bandsBeforeNodes = await bandsOf();
const spectrumPoints = await page.evaluate(() => window.__neurouSpectrum?.bandPositions() ?? []);
const sp0 = spectrumPoints.find((p) => p.index === 0);
const sp1 = spectrumPoints.find((p) => p.index === 1);
if (sp0 && sp1) {
  await page.mouse.dblclick((sp0.x + sp1.x) / 2, 250);
  await page.waitForTimeout(700);
}
const bandsAfterAdd = await bandsOf();
check('F2 谱双击空白新增段点', Number(await spectrumRoot.getAttribute('data-spectrum-band-adds')) >= 1 && bandsAfterAdd.length === bandsBeforeNodes.length + 1, `${bandsBeforeNodes.length}→${bandsAfterAdd.length}`);
await page.keyboard.press('Delete');
await page.waitForTimeout(700);
const bandsAfterRemove = await bandsOf();
check('F2 谱 Delete 删除段点', Number(await spectrumRoot.getAttribute('data-spectrum-band-removes')) >= 1 && bandsAfterRemove.length === bandsBeforeNodes.length, `${bandsAfterAdd.length}→${bandsAfterRemove.length}`);
const bandsBeforeKey = await bandsOf();
await page.keyboard.press('a');
await page.waitForTimeout(260);
check('谱模式按 a 触发音色试听', Number(await spectrumRoot.getAttribute('data-auditions')) >= 1 && (await spectrumRoot.getAttribute('data-last-key')) === 'KeyA', `${await spectrumRoot.getAttribute('data-auditions')}/${await spectrumRoot.getAttribute('data-last-key')}`);
const bandsAfterKey = await bandsOf();
const lastBand = Number(await spectrumRoot.getAttribute('data-last-band'));
check('键盘映射改了对应段的高低', Number.isInteger(lastBand) && lastBand >= 0 && Math.abs((bandsAfterKey[lastBand] ?? 0) - (bandsBeforeKey[lastBand] ?? 0)) > 0.005, `band=${lastBand} ${bandsBeforeKey[lastBand]}→${bandsAfterKey[lastBand]}`);
await page.waitForTimeout(1300);
check('键盘改段会持久化', (await appAttr('data-save-state')) === 'saved' && Number((await appAttr('data-spectrum-band-edits')) ?? 0) >= 1, String(await appAttr('data-spectrum-band-edits')));
// 上下键：按住连续加速、松开惯性减速
const inertiaStart = (await bandsOf())[lastBand] ?? 0;
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(120);
const inertiaEarly = (await bandsOf())[lastBand] ?? 0;
await page.waitForTimeout(240);
const inertiaLate = (await bandsOf())[lastBand] ?? 0;
await page.keyboard.up('ArrowUp');
await page.waitForTimeout(60);
const inertiaAfter = (await bandsOf())[lastBand] ?? 0;
await page.waitForTimeout(480);
const inertiaFinal = (await bandsOf())[lastBand] ?? 0;
check('方向键按住连续加速移动', inertiaEarly > inertiaStart + 1e-4 && inertiaLate > inertiaEarly + 1e-4, `${inertiaStart.toFixed(3)}→${inertiaEarly.toFixed(3)}→${inertiaLate.toFixed(3)}`);
check('松开后惯性继续滑行', inertiaAfter > inertiaLate + 1e-4, `${inertiaLate.toFixed(3)}→${inertiaAfter.toFixed(3)}`);
check('惯性平滑停下（位置连续、不跳变）', Math.abs(inertiaFinal - inertiaAfter) < 0.06 && inertiaFinal <= 1.0001, `${inertiaAfter.toFixed(3)}→${inertiaFinal.toFixed(3)}`);

// v5.34：按住 ↑/↓ 时按 ←/→ 切段，上下键必须跟着新段
const retargetBefore = await bandsOf();
const retargetSelectedBefore = await page.evaluate(() => window.__neurouSpectrum?.state().selected ?? null);
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(140);
check('F2 合奏 voice 带高优先级', (await page.evaluate(() => window.__neurouSpectrum?.voicePriorities() ?? [])).includes(10), JSON.stringify(await page.evaluate(() => window.__neurouSpectrum?.voicePriorities() ?? [])));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(160);
const retargetSelectedAfter = await page.evaluate(() => window.__neurouSpectrum?.state().selected ?? null);
const retargetMid = await bandsOf();
await page.waitForTimeout(220);
const retargetAfter = await bandsOf();
await page.keyboard.up('ArrowUp');
await page.waitForTimeout(700);
const retargetNext = Number(retargetSelectedAfter);
check(
  '按住上下键切段后控制新段',
  Number.isInteger(retargetSelectedAfter) &&
    retargetSelectedAfter !== retargetSelectedBefore &&
    Math.abs((retargetAfter[retargetNext] ?? 0) - (retargetBefore[retargetNext] ?? 0)) > 1e-4 &&
    Math.abs((retargetAfter[retargetNext] ?? 0) - (retargetMid[retargetNext] ?? 0)) > 1e-4,
  `sel ${retargetSelectedBefore}→${retargetSelectedAfter}, band=${retargetAfter[retargetNext]}`,
);
await page.keyboard.press('Tab');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(120);
check('Tab/方向键不会误触发试听', Number(await spectrumRoot.getAttribute('data-auditions')) === 1, String(await spectrumRoot.getAttribute('data-auditions')));
check('Tab 切到第二条谱「长音」（持续演奏）', (await spectrumRoot.getAttribute('data-spectrum-name')) === '长音' && (await spectrumRoot.getAttribute('data-articulation')) === '持续', `${await spectrumRoot.getAttribute('data-spectrum-name')}/${await spectrumRoot.getAttribute('data-articulation')}`);
await page.keyboard.down('a');
await page.waitForTimeout(260);
check('持续谱按住键持续发声', Number(await spectrumRoot.getAttribute('data-sustained-count')) === 1, String(await spectrumRoot.getAttribute('data-sustained-count')));
await page.keyboard.up('a');
await page.waitForTimeout(220);
check('松开后持续音停止', Number(await spectrumRoot.getAttribute('data-sustained-count')) === 0, String(await spectrumRoot.getAttribute('data-sustained-count')));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('谱模式 Esc 退出', (await appAttr('data-screen')) === 'strings', String(await appAttr('data-screen')));
// v2.4.5：F2 ↔ F3 模式互切
await page.keyboard.press('F2');
await page.waitForTimeout(500);
check('F2 可从八弦进入谱模式（模式切换起点）', (await appAttr('data-screen')) === 'spectrum', String(await appAttr('data-screen')));
await page.keyboard.press('F3');
await page.waitForTimeout(600);
check('谱模式按 F3 可切到关系谱矩阵', (await appAttr('data-screen')) === 'matrix', String(await appAttr('data-screen')));
await page.keyboard.press('F2');
await page.waitForTimeout(600);
check('矩阵按 F2 可切回谱模式', (await appAttr('data-screen')) === 'spectrum', String(await appAttr('data-screen')));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
restoreWorld();
await page.waitForTimeout(400);
// v2.2 关系谱：F3 黑底矩阵
await page.keyboard.press('F3');
await page.waitForTimeout(600);
const matrixRoot = page.locator('[data-testid="matrix-field"]');
check('F3 进入关系谱矩阵', (await appAttr('data-screen')) === 'matrix' && (await matrixRoot.getAttribute('data-matrix-name')) === '信任网', `${await appAttr('data-screen')}/${await matrixRoot.getAttribute('data-matrix-name')}`);
const matrixBefore = JSON.parse(String((await matrixRoot.getAttribute('data-cell-values')) ?? '[]'));
check('关系谱 3×3 初始值正确', matrixBefore.length === 3 && matrixBefore[0]?.length === 3 && Number(matrixBefore[1]?.[1]) === 1, JSON.stringify(matrixBefore));
check('关系谱默认时间轴速度为 1、相位为 0', Number(await matrixRoot.getAttribute('data-time-speed')) === 1 && Number(await matrixRoot.getAttribute('data-time-phase')) === 0, `${await matrixRoot.getAttribute('data-time-speed')}/${await matrixRoot.getAttribute('data-time-phase')}`);
// v2.3.2：曲线播放头 / Space 暂停
const playheadStart = Number(await matrixRoot.getAttribute('data-playhead'));
await page.waitForTimeout(520);
const playheadMoving = Number(await matrixRoot.getAttribute('data-playhead'));
check('曲线自动播放（播放头前进）', (await matrixRoot.getAttribute('data-playing')) === 'true' && Math.abs(playheadMoving - playheadStart) > 0.02, `${playheadStart}→${playheadMoving}`);
await page.keyboard.press('p');
await page.waitForTimeout(150);
const playheadGlide = Number(await matrixRoot.getAttribute('data-playhead'));
await page.waitForTimeout(520);
const playheadPaused = Number(await matrixRoot.getAttribute('data-playhead'));
await page.waitForTimeout(320);
const playheadPaused2 = Number(await matrixRoot.getAttribute('data-playhead'));
const playSpeed = Number(await matrixRoot.getAttribute('data-play-speed'));
check('Space 暂停带惯性滑行后停住', (await matrixRoot.getAttribute('data-playing')) === 'false' && playheadPaused > playheadGlide && Math.abs(playheadPaused2 - playheadPaused) < 1e-6 && playSpeed < 0.02, `${playheadGlide}→${playheadPaused}→${playheadPaused2}/v=${playSpeed}`);
await page.keyboard.press('p');
await page.waitForTimeout(320);
const playheadResumed = Number(await matrixRoot.getAttribute('data-playhead'));
check('Space 恢复播放', (await matrixRoot.getAttribute('data-playing')) === 'true' && Math.abs(playheadResumed - playheadPaused2) > 0.01, `${playheadPaused2}→${playheadResumed}`);
// v2.3：选中带曲线的格子，底部出现曲线编辑器
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(520);
const selectedCurveRaw = String((await matrixRoot.getAttribute('data-selected-curve')) ?? '');
const selectedCurve = selectedCurveRaw ? JSON.parse(selectedCurveRaw) : [];
check('选中曲线格出现底部曲线编辑器', Array.isArray(selectedCurve) && selectedCurve.length === 3, JSON.stringify(selectedCurve));
const curvePoints = await page.evaluate(() => window.__neurouMatrix?.curvePositions() ?? []);
const midPoint = curvePoints.find((p) => p.index === 1);
if (midPoint) {
  await page.mouse.move(midPoint.x, midPoint.y);
  await page.mouse.down();
  await page.mouse.move(midPoint.x, midPoint.y - 36, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}
const curveAfter = JSON.parse(String((await matrixRoot.getAttribute('data-selected-curve')) ?? '[]'));
check('拖动曲线段点改值并写回', Number(curveAfter[1]) > Number(selectedCurve[1]) + 0.1 && Number(await appAttr('data-matrix-curve-edits')) >= 1, `${JSON.stringify(selectedCurve)}→${JSON.stringify(curveAfter)}`);
check('曲线改段落盘为行级 patch', /曲线 信任 色温 0\.2 [0-9.]+ 0\.3/.test(readFileSync(WORLD_PATH, 'utf8')), '');
await page.keyboard.press('Control+z');
await page.waitForTimeout(800);
const curveUndo = JSON.parse(String((await matrixRoot.getAttribute('data-selected-curve')) ?? '[]'));
check('曲线 Ctrl+Z 撤销', Math.abs(Number(curveUndo[1]) - Number(selectedCurve[1])) < 1e-3, JSON.stringify(curveUndo));
// v2.3.3：关系谱曲线键盘映射（选中曲线格后在键盘上改段并发声）
await page.keyboard.press('a');
await page.waitForTimeout(360);
check('关系谱曲线键盘映射改段并写回', Number(await matrixRoot.getAttribute('data-curve-key-edits')) >= 1 && /曲线 信任 色温 [0-9.]+ 0\.5 0\.3/.test(readFileSync(WORLD_PATH, 'utf8')), String(await matrixRoot.getAttribute('data-curve-key-edits')));
await page.keyboard.press('Control+z');
await page.waitForTimeout(700);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(300);
// v2.3.1：选中曲线格按 Enter → 聚焦放大编辑
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(260);
await page.keyboard.press('Enter');
await page.waitForTimeout(760);
const focusActive = (await matrixRoot.getAttribute('data-focus')) === 'true';
const focusCurveRaw = String((await matrixRoot.getAttribute('data-focus-curve')) ?? '');
const focusCurve = focusCurveRaw ? JSON.parse(focusCurveRaw) : [];
const focusCell = String((await matrixRoot.getAttribute('data-focus-cell')) ?? '');
check('Enter 进入曲线聚焦编辑', focusActive && focusCell === '0,1' && focusCurve.length === 3, `${focusActive}/${focusCell}/${JSON.stringify(focusCurve)}`);
const focusPoints = await page.evaluate(() => window.__neurouMatrix?.focusCurvePositions() ?? []);
const focusMid = focusPoints.find((p) => p.index === 1);
if (focusMid) {
  await page.mouse.move(focusMid.x, focusMid.y);
  await page.mouse.down();
  await page.mouse.move(focusMid.x, focusMid.y - 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}
const focusAfterRaw = String((await matrixRoot.getAttribute('data-focus-curve')) ?? '');
const focusAfter = focusAfterRaw ? JSON.parse(focusAfterRaw) : [];
check('聚焦曲线拖点改值并写回', Number(focusAfter[1]) > Number(focusCurve[1]) + 0.05 && Number(await appAttr('data-matrix-curve-edits')) >= 2, `${JSON.stringify(focusCurve)}→${JSON.stringify(focusAfter)}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(760);
check('Esc 退出聚焦回到矩阵', (await matrixRoot.getAttribute('data-focus')) === 'false' && (await appAttr('data-screen')) === 'matrix', `${await matrixRoot.getAttribute('data-focus')}`);
// v2.4.1：双击空白增点 / Delete 删点
const editPoints = await page.evaluate(() => window.__neurouMatrix?.curvePositions() ?? []);
const p0 = editPoints.find((p) => p.index === 0);
const p1 = editPoints.find((p) => p.index === 1);
if (p0 && p1) {
  await page.mouse.dblclick((p0.x + p1.x) / 2, 850);
  await page.waitForTimeout(800);
}
const afterAddRaw = String((await matrixRoot.getAttribute('data-selected-curve')) ?? '');
const afterAdd = afterAddRaw ? JSON.parse(afterAddRaw) : [];
check('双击空白新增曲线节点', Number(await matrixRoot.getAttribute('data-curve-point-adds')) >= 1 && afterAdd.length === 4 && /曲线 信任 色温(?: [0-9.]+){4}/.test(readFileSync(WORLD_PATH, 'utf8')), `${afterAdd.length}/${await matrixRoot.getAttribute('data-curve-point-adds')}`);
await page.keyboard.press('Delete');
await page.waitForTimeout(800);
const afterRemoveRaw = String((await matrixRoot.getAttribute('data-selected-curve')) ?? '');
const afterRemove = afterRemoveRaw ? JSON.parse(afterRemoveRaw) : [];
check('Delete 删除曲线节点', Number(await matrixRoot.getAttribute('data-curve-point-removes')) >= 1 && afterRemove.length === 3, `${afterRemove.length}/${await matrixRoot.getAttribute('data-curve-point-removes')}`);
await page.mouse.move(720, 450);
await page.waitForTimeout(300);
await page.mouse.move(720, 450);
await page.waitForTimeout(400);
const sfxCells = await page.evaluate(() => window.__neurouMatrix?.cellPositions() ?? []);
for (const index of [0, 4, 8]) {
  const target = sfxCells[index];
  if (target) {
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(120);
  }
}
check('鼠标掠过格子有悬停音效', Number(await matrixRoot.getAttribute('data-hover-sfx')) >= 2, String(await matrixRoot.getAttribute('data-hover-sfx')));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(420);
check('方向键切换有音效且光标收拢隐藏', Number(await matrixRoot.getAttribute('data-nav-sfx')) >= 1 && (await matrixRoot.getAttribute('data-cursor-visible')) === 'false', `${await matrixRoot.getAttribute('data-nav-sfx')}/${await matrixRoot.getAttribute('data-cursor-visible')}`);
await page.mouse.move(760, 470);
await page.waitForTimeout(420);
check('鼠标再动光标重新展开', (await matrixRoot.getAttribute('data-cursor-visible')) === 'true' && Number(await matrixRoot.getAttribute('data-crosshair')) > 0.8, `${await matrixRoot.getAttribute('data-crosshair')}`);
await page.mouse.move(1100, 300);
await page.waitForTimeout(700);
const offsetRight = JSON.parse(String((await matrixRoot.getAttribute('data-matrix-offset')) ?? '[0,0]'));
await page.mouse.move(300, 650);
await page.waitForTimeout(700);
const offsetLeft = JSON.parse(String((await matrixRoot.getAttribute('data-matrix-offset')) ?? '[0,0]'));
check('矩阵随光标方向视差偏移', offsetRight[0] > 20 && offsetRight[1] < -5 && offsetLeft[0] < -20 && offsetLeft[1] > 5, `${JSON.stringify(offsetRight)} / ${JSON.stringify(offsetLeft)}`);
await page.mouse.move(1100, 300);
await page.waitForTimeout(700);
const depthCells = await page.evaluate(() => window.__neurouMatrix?.cellPositions() ?? []);
const whiteCell = depthCells.find((c) => c.row === 0 && c.col === 0);
const darkCell = depthCells.find((c) => c.row === 2 && c.col === 0);
check('越白的格子视差移动越快（伪 3D 差速）', (whiteCell?.dx ?? 0) > (darkCell?.dx ?? 0) + 5, `${whiteCell?.dx?.toFixed(2)} vs ${darkCell?.dx?.toFixed(2)}`);
check('越白的格子尺寸越大（大格覆盖层）', (whiteCell?.size ?? 0) > (darkCell?.size ?? 0) + 8, `${whiteCell?.size?.toFixed(1)} vs ${darkCell?.size?.toFixed(1)}`);
await page.mouse.move(720, 450);
await page.waitForTimeout(700);
const offsetCenter = JSON.parse(String((await matrixRoot.getAttribute('data-matrix-offset')) ?? '[0,0]'));
const cursorAttr = String((await matrixRoot.getAttribute('data-cursor')) ?? '');
check('矩阵中心无偏移、光标十字存在', Math.abs(offsetCenter[0] ?? 0) < 1 && Math.abs(offsetCenter[1] ?? 0) < 1 && cursorAttr.length > 0, `${JSON.stringify(offsetCenter)}/${cursorAttr}`);
const cells = await page.evaluate(() => window.__neurouMatrix?.cellPositions() ?? []);
check('矩阵格子可定位', cells.length === 9, String(cells.length));
const cell = cells.find((c) => c.row === 1 && c.col === 1);
if (cell) {
  await page.mouse.move(cell.x, cell.y);
  await page.mouse.down();
  await page.mouse.move(cell.x, cell.y + 80, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1100);
}
const matrixAfter = JSON.parse(String((await matrixRoot.getAttribute('data-cell-values')) ?? '[]'));
check('拖动格子改变关系值', Number(matrixAfter[1]?.[1]) < 0.95, JSON.stringify(matrixAfter));
check('矩阵编辑已写回', Number(await appAttr('data-matrix-cell-edits')) >= 1 && (await appAttr('data-save-state')) === 'saved', `${await appAttr('data-matrix-cell-edits')}/${await appAttr('data-save-state')}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(700);
const matrixUndo = JSON.parse(String((await matrixRoot.getAttribute('data-cell-values')) ?? '[]'));
check('矩阵 Ctrl+Z 撤销', Number(matrixUndo[1]?.[1]) > 0.95, JSON.stringify(matrixUndo));
// v2.4.3：行列增删 + 内联改名
const countLabels = async (kind) => {
  const labels = await page.evaluate(() => window.__neurouMatrix?.labelPositions() ?? []);
  return labels.filter((label) => label.kind === kind).length;
};
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(700);
check('Ctrl+Enter 插入一行', (await countLabels('row')) === 4 && Number(await appAttr('data-matrix-row-adds')) >= 1, String(await countLabels('row')));
await page.keyboard.press('Control+Shift+Enter');
await page.waitForTimeout(700);
check('Ctrl+Shift+Enter 插入一列', (await countLabels('col')) === 4 && Number(await appAttr('data-matrix-col-adds')) >= 1, String(await countLabels('col')));
await page.keyboard.press('Control+Backspace');
await page.waitForTimeout(600);
await page.keyboard.press('Control+Shift+Backspace');
await page.waitForTimeout(600);
check('Ctrl+Backspace 删除行列', (await countLabels('row')) === 3 && (await countLabels('col')) === 3, `${await countLabels('row')}/${await countLabels('col')}`);
const labelRows = await page.evaluate(() => window.__neurouMatrix?.labelPositions() ?? []);
const thirdRow = labelRows.filter((label) => label.kind === 'row')[2];
if (thirdRow) {
  await page.mouse.dblclick(thirdRow.x, thirdRow.y);
  await page.waitForTimeout(250);
  const input = page.locator('[data-testid="matrix-rename-input"]');
  await input.fill('信赖');
  await input.press('Enter');
  let renamedText = '';
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(400);
    renamedText = readFileSync(WORLD_PATH, 'utf8');
    if (/^\s*行 .* 信赖$/m.test(renamedText)) break;
  }
}
const renamedFinal = readFileSync(WORLD_PATH, 'utf8');
check('双击行标签可内联改名', Number(await appAttr('data-matrix-renames')) >= 1 && /^\s*行 .* 信赖$/m.test(renamedFinal), `${await appAttr('data-matrix-renames')}/${(/^\s*行 .*$/m.exec(renamedFinal) ?? [''])[0]}`);
// v2.4.5：Space 给格子增/删曲线 + 自动聚焦
const curveCells = await page.evaluate(() => window.__neurouMatrix?.cellPositions() ?? []);
const emptyCell = curveCells.find((c) => c.row === 0 && c.col === 0);
if (emptyCell) {
  await page.mouse.click(emptyCell.x, emptyCell.y);
  await page.waitForTimeout(250);
}
await page.keyboard.down('Space');
await page.waitForTimeout(650);
const addedCurveRaw = String((await matrixRoot.getAttribute('data-selected-curve')) ?? '');
const addedCurve = addedCurveRaw ? JSON.parse(addedCurveRaw) : [];
const addsHeld = Number(await appAttr('data-matrix-curve-adds'));
check('Space 给格子添加钟形曲线并自动聚焦', addsHeld >= 1 && addedCurve.length === 5 && (await matrixRoot.getAttribute('data-focus')) === 'true', `${addsHeld}/${addedCurve.length}/${await matrixRoot.getAttribute('data-focus')}`);
await page.waitForTimeout(320);
check('Space 长按忽略 repeat（不闪烁）', Number(await appAttr('data-matrix-curve-adds')) === addsHeld && (await matrixRoot.getAttribute('data-focus')) === 'true', `${await appAttr('data-matrix-curve-adds')}/${await matrixRoot.getAttribute('data-focus')}`);
await page.keyboard.up('Space');
await page.waitForTimeout(600);
const keptCurveRaw = String((await matrixRoot.getAttribute('data-selected-curve')) ?? '');
check('长按松开关闭聚焦但保留曲线', (await matrixRoot.getAttribute('data-focus')) === 'false' && keptCurveRaw !== '', `${await matrixRoot.getAttribute('data-focus')}/${keptCurveRaw}`);
await page.keyboard.press('Space');
await page.waitForTimeout(800);
const reopenedCurveRaw = String((await matrixRoot.getAttribute('data-selected-curve')) ?? '');
check('再次 Space 只重开聚焦不删除曲线', (await matrixRoot.getAttribute('data-focus')) === 'true' && reopenedCurveRaw !== '' && Number(await appAttr('data-matrix-curve-removes')) === 0, `${await matrixRoot.getAttribute('data-focus')}/${reopenedCurveRaw}/${await appAttr('data-matrix-curve-removes')}`);
await page.keyboard.press('Shift+Space');
await page.waitForTimeout(900);
const removedCurveRaw = String((await matrixRoot.getAttribute('data-selected-curve')) ?? '');
check('Shift+Space 移除格子曲线并退出聚焦', Number(await appAttr('data-matrix-curve-removes')) >= 1 && removedCurveRaw === '' && (await matrixRoot.getAttribute('data-focus')) === 'false', `${await appAttr('data-matrix-curve-removes')}/${removedCurveRaw}/${await matrixRoot.getAttribute('data-focus')}`);
await page.keyboard.press('F3');
await page.waitForTimeout(500);
check('矩阵 F3 退出', (await appAttr('data-screen')) === 'strings', String(await appAttr('data-screen')));
restoreWorld();

// v2.4：关系谱周期 → 播放头同步运行时 tick
await page.goto(`${URL}?world=${encodeURIComponent('examples/relations.nro')}`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
await page.keyboard.press('F3');
await page.waitForTimeout(700);
const syncedRoot = page.locator('[data-testid="matrix-field"]');
check('有周期时播放头同步运行时', (await syncedRoot.getAttribute('data-synced')) === 'true' && Number(await syncedRoot.getAttribute('data-period')) === 40, `${await syncedRoot.getAttribute('data-synced')}/${await syncedRoot.getAttribute('data-period')}`);
const syncHeadStart = Number(await syncedRoot.getAttribute('data-playhead'));
await page.waitForTimeout(1800);
const syncHeadAfter = Number(await syncedRoot.getAttribute('data-playhead'));
check('同步播放头随 tick 连续前进', Math.abs(syncHeadAfter - syncHeadStart) > 0.02 && syncHeadAfter !== syncHeadStart, `${syncHeadStart}→${syncHeadAfter}`);
await page.keyboard.press('p');
await page.waitForTimeout(180);
const syncPaused = Number(await syncedRoot.getAttribute('data-playhead'));
await page.waitForTimeout(650);
const syncPaused2 = Number(await syncedRoot.getAttribute('data-playhead'));
check('同步模式 Space 暂停冻结播放头', (await syncedRoot.getAttribute('data-playing')) === 'false' && Math.abs(syncPaused2 - syncPaused) < 1e-6, `${syncPaused}→${syncPaused2}`);
await page.keyboard.press('p');
await page.waitForTimeout(900);
const syncResumed = Number(await syncedRoot.getAttribute('data-playhead'));
check('同步模式恢复后追上实时 tick', (await syncedRoot.getAttribute('data-playing')) === 'true' && Math.abs(syncResumed - syncPaused2) > 0.01, `${syncPaused2}→${syncResumed}`);
await page.keyboard.press('F3');
await page.waitForTimeout(500);

// v2.6：关系谱速度/相位 —— moon-tide 的速度 1.4、相位 0.1
const moonTideBackup = readFileSync('examples/moon-tide.nro', 'utf8');
await page.goto(`${URL}?world=${encodeURIComponent('examples/moon-tide.nro')}`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
await page.keyboard.press('F3');
await page.waitForTimeout(1200);
const timeSpeed = Number(await matrixRoot.getAttribute('data-time-speed'));
const timePhase = Number(await matrixRoot.getAttribute('data-time-phase'));
check('moon-tide 关系谱速度/相位生效', (await matrixRoot.getAttribute('data-synced')) === 'true' && timeSpeed === 1.4 && Math.abs(timePhase - 0.1) < 1e-6, `${timeSpeed}/${timePhase}/${await matrixRoot.getAttribute('data-synced')}`);
const moonTime = await page.evaluate(() => {
  const state = window.__neurouMatrix?.state?.();
  return state ? { tick: state.tick, playhead: state.playhead, speed: state.speed, phase: state.phase } : null;
});
const moonTarget = moonTime && moonTime.tick !== undefined ? (((moonTime.tick / 30) * timeSpeed + timePhase) % 1 + 1) % 1 : -1;
check('moon-tide 播放头跟随速度/相位后的时间轴', moonTime !== null && Math.abs(Number(moonTime.playhead) - moonTarget) < 0.2, JSON.stringify(moonTime) + '/' + moonTarget.toFixed(3));
check('moon-tide 有两个关系谱', Number(await matrixRoot.getAttribute('data-matrix-count')) === 2, String(await matrixRoot.getAttribute('data-matrix-count')));
check('月潮无相位源（静态相位 0.1）', (await matrixRoot.getAttribute('data-phase-source')) === 'false' && Math.abs(Number(await matrixRoot.getAttribute('data-time-phase')) - 0.1) < 1e-6, `${await matrixRoot.getAttribute('data-phase-source')}/${await matrixRoot.getAttribute('data-time-phase')}`);
await page.keyboard.press('Tab');
await page.waitForTimeout(700);
const secondMatrix = { name: await matrixRoot.getAttribute('data-matrix-name'), speed: await matrixRoot.getAttribute('data-time-speed'), source: await matrixRoot.getAttribute('data-phase-source') };
const linkedPhase1 = Number(await matrixRoot.getAttribute('data-time-phase'));
await page.waitForTimeout(650);
const linkedPhase2 = Number(await matrixRoot.getAttribute('data-time-phase'));
check('Tab 切换到灯影：速度 0.8 + 相位源联动', secondMatrix.name === '灯影' && Number(secondMatrix.speed) === 0.8 && secondMatrix.source === 'true' && linkedPhase1 >= 0 && linkedPhase1 <= 1, JSON.stringify(secondMatrix) + '/' + linkedPhase1);
check('灯影有效相位随源谱曲线变化', Math.abs(linkedPhase2 - linkedPhase1) > 1e-5, `${linkedPhase1}→${linkedPhase2}`);
await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(700);
check('Shift+Tab 切回月潮并恢复静态相位', (await matrixRoot.getAttribute('data-matrix-name')) === '月潮' && (await matrixRoot.getAttribute('data-phase-source')) === 'false', `${await matrixRoot.getAttribute('data-matrix-name')}/${await matrixRoot.getAttribute('data-phase-source')}`);
// v2.8：] / [ 调速度，Shift 调相位
await page.keyboard.press(']');
await page.waitForTimeout(700);
check('] 提高关系谱速度', Math.abs(Number(await matrixRoot.getAttribute('data-time-speed')) - 1.6) < 1e-6, String(await matrixRoot.getAttribute('data-time-speed')));
await page.keyboard.press('[');
await page.waitForTimeout(700);
check('[ 降低关系谱速度回 1.4', Math.abs(Number(await matrixRoot.getAttribute('data-time-speed')) - 1.4) < 1e-6, String(await matrixRoot.getAttribute('data-time-speed')));
await page.keyboard.down('Shift');
await page.keyboard.press(']');
await page.keyboard.up('Shift');
await page.waitForTimeout(700);
check('Shift+] 提高相位到 0.15', Math.abs(Number(await matrixRoot.getAttribute('data-time-phase')) - 0.15) < 1e-6, String(await matrixRoot.getAttribute('data-time-phase')));
await page.keyboard.down('Shift');
await page.keyboard.press('[');
await page.keyboard.up('Shift');
await page.waitForTimeout(700);
check('Shift+[ 降低相位回 0.1', Math.abs(Number(await matrixRoot.getAttribute('data-time-phase')) - 0.1) < 1e-6, String(await matrixRoot.getAttribute('data-time-phase')));
await page.keyboard.press('F3');
await page.waitForTimeout(500);

// v2.17.3：lighthouse 示例的阶跃矩阵 + 相位源 Tab
await page.goto(`${URL}?world=${encodeURIComponent('examples/lighthouse.nro')}`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(800);
await page.keyboard.press('F3');
await page.waitForTimeout(900);
const lighthouseState = await page.evaluate(() => window.__neurouMatrix?.state?.() ?? null);
check('lighthouse 有两个关系谱（潮阶/心图）', Number(await matrixRoot.getAttribute('data-matrix-count')) === 2 && (await matrixRoot.getAttribute('data-matrix-name')) === '潮阶', `${await matrixRoot.getAttribute('data-matrix-count')}/${await matrixRoot.getAttribute('data-matrix-name')}`);
check('lighthouse 潮阶使用阶跃插值', lighthouseState?.interpolation === '阶跃', String(lighthouseState?.interpolation));
await page.keyboard.press('Tab');
await page.waitForTimeout(700);
check('lighthouse Tab 到心图且相位源生效', (await matrixRoot.getAttribute('data-matrix-name')) === '心图' && (await matrixRoot.getAttribute('data-phase-source')) === 'true', `${await matrixRoot.getAttribute('data-matrix-name')}/${await matrixRoot.getAttribute('data-phase-source')}`);

// v3.0：动作选择 + 结局 + 重开
writeFileSync(TEMP_PLAY, PLAY_WORLD_SOURCE, 'utf8');
await page.goto(`${URL}?world=${encodeURIComponent(TEMP_PLAY)}`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(900);
const playRoot = page.locator('[data-testid="string-field"]');
check('可玩层收到世界动作', Number(await playRoot.getAttribute('data-action-count')) === 1, String(await playRoot.getAttribute('data-action-count')));
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('Enter 打开极简动作列表', (await playRoot.getAttribute('data-action-open')) === 'true' && (await page.locator('[data-testid="string-actions"]').count()) === 1, String(await playRoot.getAttribute('data-action-open')));
check('动作列表显示选中动作描述', (await playRoot.getAttribute('data-action-note')) === '松手。', String(await playRoot.getAttribute('data-action-note')));
check('动作列表显示动作耗时', (await playRoot.getAttribute('data-action-cost')) === '1', String(await playRoot.getAttribute('data-action-cost')));
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
check('动作执行后淡显结局', (await playRoot.getAttribute('data-ending')) === '落点' && Number(await playRoot.getAttribute('data-action-count')) === 0, `${await playRoot.getAttribute('data-ending')}/${await playRoot.getAttribute('data-action-count')}`);
check('结局显示拍数与动作数', Number(await playRoot.getAttribute('data-ending-tick')) > 0 && Number(await playRoot.getAttribute('data-ending-actions')) === 1, `${await playRoot.getAttribute('data-ending-tick')}/${await playRoot.getAttribute('data-ending-actions')}`);
await page.keyboard.press('r');
await page.waitForTimeout(1000);
check('R 重开清结局并恢复动作', (await playRoot.getAttribute('data-ending')) === '' && Number(await playRoot.getAttribute('data-action-count')) === 1, `${await playRoot.getAttribute('data-ending')}/${await playRoot.getAttribute('data-action-count')}`);

// v3.1：F3 V 运行期只读叠加（relational 动态格）
await page.goto(`${URL}?world=${encodeURIComponent('examples/relational.nro')}`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await page.waitForTimeout(800);
await page.keyboard.press('F3');
await page.waitForTimeout(900);
check('矩阵默认不是运行期只读叠加', (await matrixRoot.getAttribute('data-live-values')) === 'false', String(await matrixRoot.getAttribute('data-live-values')));
await page.keyboard.press('v');
await page.waitForTimeout(600);
check('V 打开运行期只读叠加', (await matrixRoot.getAttribute('data-live-values')) === 'true', String(await matrixRoot.getAttribute('data-live-values')));
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
check('运行期只读模式禁止聚焦编辑', (await matrixRoot.getAttribute('data-focus')) === 'false', String(await matrixRoot.getAttribute('data-focus')));
await page.keyboard.press('v');
await page.waitForTimeout(500);
check('V 关闭后恢复静态 editable 状态', (await matrixRoot.getAttribute('data-live-values')) === 'false', String(await matrixRoot.getAttribute('data-live-values')));

// v3.3：移动端 390×844 触控——底部 16% 长按打开动作、点选执行
const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(`${URL}?world=${encodeURIComponent(TEMP_PLAY)}`, { waitUntil: 'networkidle' });
await mobilePage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await mobilePage.waitForTimeout(900);
const mobileRoot = mobilePage.locator('[data-testid="string-field"]');
check('移动端标记 data-touch=true', (await mobileRoot.getAttribute('data-touch')) === 'true', String(await mobileRoot.getAttribute('data-touch')));
check('移动端无横向滚动', await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '');
const mobileClient = await mobileContext.newCDPSession(mobilePage);
await mobileClient.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 790, radiusX: 1, radiusY: 1, force: 1 }] });
await mobilePage.waitForTimeout(760);
await mobileClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await mobilePage.waitForTimeout(350);
check('移动端底部 16% 长按打开动作列表', (await mobileRoot.getAttribute('data-action-open')) === 'true', String(await mobileRoot.getAttribute('data-action-open')));
const mobileAction = mobilePage.locator('[data-testid="string-actions"] .string-action-row').first();
await mobileAction.tap();
await mobilePage.waitForTimeout(1100);
check('移动端点击动作执行并出现结局', (await mobileRoot.getAttribute('data-ending')) === '落点' && Number(await mobileRoot.getAttribute('data-action-count')) === 0, `${await mobileRoot.getAttribute('data-ending')}/${await mobileRoot.getAttribute('data-action-count')}`);
await mobileContext.close();

// v3.4：生产同款 URL world/seed 选择（dev 也验证）
const worldPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await worldPage.goto(`${URL}?world=${encodeURIComponent('examples/relational.nro')}&seed=42`, { waitUntil: 'networkidle' });
await worldPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await worldPage.waitForTimeout(700);
const worldApp = worldPage.locator('[data-testid="ink-app"]');
check('URL 选择世界（data-world-file）', (await worldApp.getAttribute('data-world-file')) === 'examples/relational.nro', String(await worldApp.getAttribute('data-world-file')));
check('URL seed 复现（data-seed）', (await worldApp.getAttribute('data-seed')) === '42', String(await worldApp.getAttribute('data-seed')));
await worldPage.close();

// v3.5：世界「音频」cue 接到本地声音层
writeFileSync(TEMP_AUDIO, AUDIO_WORLD_SOURCE, 'utf8');
const audioPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await audioPage.goto(`${URL}?world=${encodeURIComponent(TEMP_AUDIO)}`, { waitUntil: 'networkidle' });
await audioPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await audioPage.waitForTimeout(700);
await audioPage.mouse.click(720, 450);
await audioPage.waitForTimeout(300);
await audioPage.keyboard.press('Enter');
await audioPage.waitForTimeout(250);
await audioPage.keyboard.press('Enter');
await audioPage.waitForTimeout(1400);
const audioApp = audioPage.locator('[data-testid="ink-app"]');
check('世界音频 cue 被 GUI 消费', Number(await audioApp.getAttribute('data-cue-audio')) >= 1, String(await audioApp.getAttribute('data-cue-audio')));
check('音频 cue 命中谱名', (await audioApp.getAttribute('data-last-cue')) === '钟:0.8', String(await audioApp.getAttribute('data-last-cue')));
await audioPage.close();

// v3.6：F4 四档音量 + localStorage 持久化
const audioControlPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await audioControlPage.goto(URL, { waitUntil: 'networkidle' });
await audioControlPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await audioControlPage.evaluate(() => window.localStorage.removeItem('neurou.audio.level'));
await audioControlPage.reload({ waitUntil: 'networkidle' });
await audioControlPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await audioControlPage.waitForTimeout(500);
const audioControlApp = audioControlPage.locator('[data-testid="ink-app"]');
check('默认音量档 1', (await audioControlApp.getAttribute('data-audio-level')) === '1' && (await audioControlApp.getAttribute('data-audio-muted')) === 'false', String(await audioControlApp.getAttribute('data-audio-level')));
await audioControlPage.keyboard.press('F4');
await audioControlPage.waitForTimeout(150);
check('F4 降到 0.6 档', (await audioControlApp.getAttribute('data-audio-level')) === '0.6', String(await audioControlApp.getAttribute('data-audio-level')));
await audioControlPage.keyboard.press('F4');
await audioControlPage.keyboard.press('F4');
await audioControlPage.waitForTimeout(150);
check('F4 降到静音档', (await audioControlApp.getAttribute('data-audio-level')) === '0' && (await audioControlApp.getAttribute('data-audio-muted')) === 'true', `${await audioControlApp.getAttribute('data-audio-level')}/${await audioControlApp.getAttribute('data-audio-muted')}`);
await audioControlPage.keyboard.press('F4');
await audioControlPage.keyboard.press('F4');
await audioControlPage.reload({ waitUntil: 'networkidle' });
await audioControlPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await audioControlPage.waitForTimeout(400);
check('音量档 localStorage 持久化', (await audioControlApp.getAttribute('data-audio-level')) === '0.6', String(await audioControlApp.getAttribute('data-audio-level')));
await audioControlPage.close();

// v3.7：音频资产 cue（soundscape 的钟鸣改播 audio/clock.wav）
const assetPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await assetPage.goto(`${URL}?world=${encodeURIComponent('examples/soundscape.nro')}`, { waitUntil: 'networkidle' });
await assetPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await assetPage.waitForTimeout(700);
const assetApp = assetPage.locator('[data-testid="ink-app"]');
check('世界配乐 BGM 被识别', (await assetApp.getAttribute('data-bgm')) === '雨幕', String(await assetApp.getAttribute('data-bgm')));
check('配乐解析到音频资产路径', (await assetApp.getAttribute('data-bgm-src')) === 'audio/rain.wav', String(await assetApp.getAttribute('data-bgm-src')));
const bgmStatus = await assetPage.evaluate(async () => (await fetch('/audio/rain.wav')).status);
check('配乐音频资源可加载', bgmStatus === 200, String(bgmStatus));
const clockStatus = await assetPage.evaluate(async () => (await fetch('/audio/clock.wav')).status);
check('cue 音频资源可加载', clockStatus === 200, String(clockStatus));
await assetPage.mouse.click(720, 450);
await assetPage.waitForTimeout(300);
await assetPage.keyboard.press('Enter');
await assetPage.waitForTimeout(250);
await assetPage.keyboard.press('Enter');
await assetPage.waitForTimeout(1400);
check('音频资产 cue 被消费', Number(await assetApp.getAttribute('data-cue-assets')) >= 1, String(await assetApp.getAttribute('data-cue-assets')));
check('音频资产 cue 来源标记', (await assetApp.getAttribute('data-last-cue-kind')) === 'asset', String(await assetApp.getAttribute('data-last-cue-kind')));
check('音频资产 cue 参数/strength', (await assetApp.getAttribute('data-last-cue')) === '钟声采样:0.8', String(await assetApp.getAttribute('data-last-cue')));
await assetPage.close();

// v3.5：F3 S 关系谱听音开关
const listenPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await listenPage.goto(`${URL}?world=${encodeURIComponent('examples/soundscape.nro')}`, { waitUntil: 'networkidle' });
await listenPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await listenPage.waitForTimeout(700);
await listenPage.keyboard.press('F3');
await listenPage.waitForTimeout(700);
const listenRoot = listenPage.locator('[data-testid="matrix-field"]');
await listenPage.keyboard.press('s');
await listenPage.waitForTimeout(600);
check('S 打开关系谱听音', (await listenRoot.getAttribute('data-matrix-listen')) === 'true', String(await listenRoot.getAttribute('data-matrix-listen')));
await listenPage.keyboard.press('s');
await listenPage.waitForTimeout(300);
check('再按 S 关闭关系谱听音', (await listenRoot.getAttribute('data-matrix-listen')) === 'false', String(await listenRoot.getAttribute('data-matrix-listen')));
await listenPage.close();

// v4.0：章节切换 + 自动存档/续档
writeFileSync(TEMP_CHAPTER, CHAPTER_WORLD_SOURCE, 'utf8');
const chapterPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await chapterPage.goto(`${URL}?world=${encodeURIComponent(TEMP_CHAPTER)}&fresh=1`, { waitUntil: 'networkidle' });
await chapterPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await chapterPage.waitForTimeout(1100);
const chapterApp = chapterPage.locator('[data-testid="ink-app"]');
check('世界元数据带下一章', (await chapterApp.getAttribute('data-next-chapter')) === 'examples/tuner.nro', String(await chapterApp.getAttribute('data-next-chapter')));
check('世界元数据带上一章', (await chapterApp.getAttribute('data-prev-chapter')) === 'examples/tuner.nro', String(await chapterApp.getAttribute('data-prev-chapter')));
await chapterPage.keyboard.press('n');
await chapterPage.waitForTimeout(1200);
check('结局后 N 切到下一章', (await chapterApp.getAttribute('data-world-file')) === 'examples/tuner.nro', String(await chapterApp.getAttribute('data-world-file')));
await chapterPage.close();

const prevPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await prevPage.goto(`${URL}?world=${encodeURIComponent(TEMP_CHAPTER)}&fresh=1`, { waitUntil: 'networkidle' });
await prevPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await prevPage.waitForTimeout(1100);
const prevApp = prevPage.locator('[data-testid="ink-app"]');
await prevPage.keyboard.press('b');
await prevPage.waitForTimeout(1200);
check('结局后 B 回到上一章', (await prevApp.getAttribute('data-world-file')) === 'examples/tuner.nro', String(await prevApp.getAttribute('data-world-file')));
await prevPage.close();

// v4.2：结局点击右半屏切下一章 + 章节标题短暂浮现
const clickChapterPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await clickChapterPage.goto(`${URL}?world=${encodeURIComponent(TEMP_CHAPTER)}&fresh=1`, { waitUntil: 'networkidle' });
await clickChapterPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await clickChapterPage.waitForTimeout(1100);
const clickChapterApp = clickChapterPage.locator('[data-testid="ink-app"]');
await clickChapterPage.mouse.click(1100, 450);
await clickChapterPage.waitForTimeout(1200);
check('结局点击右半屏切下一章', (await clickChapterApp.getAttribute('data-world-file')) === 'examples/tuner.nro', String(await clickChapterApp.getAttribute('data-world-file')));
await clickChapterPage.close();

const introPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await introPage.goto(`${URL}?world=${encodeURIComponent('examples/garden.nro')}&fresh=1`, { waitUntil: 'networkidle' });
await introPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await introPage.waitForSelector('[data-testid="chapter-intro"]', { timeout: 2500 });
check('章节标题短暂浮现', (await introPage.locator('[data-testid="chapter-intro"]').textContent()) === '温室', String(await introPage.locator('[data-testid="chapter-intro"]').textContent()));
await introPage.waitForTimeout(2100);
check('章节标题不常驻', (await introPage.locator('[data-testid="chapter-intro"]').count()) === 0, String(await introPage.locator('[data-testid="chapter-intro"]').count()));
await introPage.close();

const savePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await savePage.goto(`${URL}?world=${encodeURIComponent('examples/garden.nro')}&fresh=1`, { waitUntil: 'networkidle' });
await savePage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await savePage.waitForTimeout(800);
await savePage.evaluate(() => window.__neurouString?.setValue?.('叙事', 33));
await savePage.waitForTimeout(4600);
const saveApp = savePage.locator('[data-testid="ink-app"]');
const savedTick = Number(await saveApp.getAttribute('data-save-tick'));
check('运行期自动存档产生 save-tick', savedTick > 0, String(savedTick));
await savePage.goto(`${URL}?world=${encodeURIComponent('examples/garden.nro')}&resume=1`, { waitUntil: 'networkidle' });
await savePage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await savePage.waitForTimeout(800);
check('刷新后自动续档', (await saveApp.getAttribute('data-resumed')) === 'true', String(await saveApp.getAttribute('data-resumed')));
await savePage.close();

// v4.1：多槽存档 ?slot=N 独立隔离
const slotPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await slotPage.goto(`${URL}?world=${encodeURIComponent('examples/garden.nro')}&slot=2&fresh=1`, { waitUntil: 'networkidle' });
await slotPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await slotPage.waitForTimeout(800);
await slotPage.evaluate(() => window.__neurouString?.setValue?.('叙事', 35));
await slotPage.waitForTimeout(4600);
const slotApp = slotPage.locator('[data-testid="ink-app"]');
const slotTick = Number(await slotApp.getAttribute('data-save-tick'));
check('slot=2 独立存档产生 tick', (await slotApp.getAttribute('data-slot')) === '2' && slotTick > 0, `${await slotApp.getAttribute('data-slot')}/${slotTick}`);
await slotPage.goto(`${URL}?world=${encodeURIComponent('examples/garden.nro')}&slot=2&resume=1`, { waitUntil: 'networkidle' });
await slotPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await slotPage.waitForTimeout(800);
check('slot=2 刷新后续档', (await slotApp.getAttribute('data-slot')) === '2' && (await slotApp.getAttribute('data-resumed')) === 'true', `${await slotApp.getAttribute('data-slot')}/${await slotApp.getAttribute('data-resumed')}`);
await slotPage.close();

// v4.4：Backquote 存档槽淡列表
const slotMenuPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await slotMenuPage.goto(`${URL}?world=${encodeURIComponent('examples/garden.nro')}&slot=0&fresh=1`, { waitUntil: 'networkidle' });
await slotMenuPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await slotMenuPage.waitForTimeout(700);
const slotMenuApp = slotMenuPage.locator('[data-testid="ink-app"]');
await slotMenuPage.keyboard.press('Backquote');
await slotMenuPage.waitForTimeout(250);
check('Backquote 打开存档槽列表', (await slotMenuApp.getAttribute('data-slot-menu-open')) === 'true' && (await slotMenuPage.locator('[data-testid="slot-menu"] .slot-row').count()) === 10, String(await slotMenuPage.locator('[data-testid="slot-menu"] .slot-row').count()));
await slotMenuPage.keyboard.press('ArrowDown');
await slotMenuPage.keyboard.press('ArrowDown');
await slotMenuPage.waitForTimeout(120);
check('存档槽上下选择', (await slotMenuApp.getAttribute('data-slot-menu-selected')) === '2', String(await slotMenuApp.getAttribute('data-slot-menu-selected')));
await slotMenuPage.keyboard.press('Enter');
await slotMenuPage.waitForTimeout(900);
check('Enter 切到 slot=2', (await slotMenuApp.getAttribute('data-slot')) === '2', String(await slotMenuApp.getAttribute('data-slot')));
await slotMenuPage.close();

// v4.5：结局多出口选择
writeFileSync(TEMP_CHOICES, CHOICES_WORLD_SOURCE, 'utf8');
const choicesPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await choicesPage.goto(`${URL}?world=${encodeURIComponent(TEMP_CHOICES)}&fresh=1`, { waitUntil: 'networkidle' });
await choicesPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await choicesPage.waitForTimeout(1100);
const choicesApp = choicesPage.locator('[data-testid="ink-app"]');
check('结局多出口显示两个选择', Number(await choicesApp.getAttribute('data-chapter-choices')) === 2 && (await choicesPage.locator('[data-testid="chapter-choices"] .chapter-choice').count()) === 2, `${await choicesApp.getAttribute('data-chapter-choices')}`);
await choicesPage.keyboard.press('ArrowDown');
await choicesPage.waitForTimeout(150);
check('多出口方向键选择', (await choicesApp.getAttribute('data-chapter-choice-selected')) === '1', String(await choicesApp.getAttribute('data-chapter-choice-selected')));
await choicesPage.keyboard.press('Enter');
await choicesPage.waitForTimeout(1200);
check('多出口 Enter 去第二个世界', (await choicesApp.getAttribute('data-world-file')) === 'examples/garden.nro', String(await choicesApp.getAttribute('data-world-file')));
await choicesPage.close();

// v4.6：F9 章节路线图
const graphPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await graphPage.goto(`${URL}?world=${encodeURIComponent('examples/garden.nro')}&fresh=1`, { waitUntil: 'networkidle' });
await graphPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await graphPage.waitForTimeout(700);
const graphApp = graphPage.locator('[data-testid="ink-app"]');
await graphPage.keyboard.press('F9');
await graphPage.waitForTimeout(300);
check('F9 打开章节路线图', (await graphApp.getAttribute('data-chapter-graph-open')) === 'true' && (await graphPage.locator('[data-testid="chapter-graph"] .chapter-graph-node').count()) >= 13, `${await graphApp.getAttribute('data-chapter-graph-open')}/${await graphPage.locator('[data-testid="chapter-graph"] .chapter-graph-node').count()}`);
check('章节图高亮当前章节', (await graphPage.locator('[data-chapter-file="examples/garden.nro"]').getAttribute('class'))?.includes('chapter-graph-node--current') === true, '');
await graphPage.keyboard.press('Escape');
await graphPage.waitForTimeout(250);
check('Esc 关闭章节路线图', (await graphApp.getAttribute('data-chapter-graph-open')) === 'false', String(await graphApp.getAttribute('data-chapter-graph-open')));
await graphPage.close();

// v5.4：Space 现象层预览蒙版
const previewPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await previewPage.goto(`${URL}?world=${encodeURIComponent('examples/garden.nro')}&fresh=1`, { waitUntil: 'networkidle' });
await previewPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await previewPage.waitForTimeout(700);
const previewApp = previewPage.locator('[data-testid="ink-app"]');
await previewPage.keyboard.press('Space');
await previewPage.waitForTimeout(250);
check('Space 打开现象层蒙版', (await previewApp.getAttribute('data-preview-open')) === 'true' && (await previewPage.locator('[data-testid="preview-mask"]').count()) === 1, String(await previewApp.getAttribute('data-preview-open')));
check('现象层显示章节', (await previewPage.locator('[data-testid="preview-scene"]').textContent()) === '温室', String(await previewPage.locator('[data-testid="preview-scene"]').textContent()));
await previewPage.keyboard.press('Space');
await previewPage.waitForTimeout(250);
check('再按 Space 关闭现象层', (await previewApp.getAttribute('data-preview-open')) === 'false', String(await previewApp.getAttribute('data-preview-open')));
await previewPage.close();

// v5.7：视觉端口 → GLSL 后端编译 + 预览 canvas
writeFileSync(TEMP_GLSL, GLSL_WORLD_SOURCE, 'utf8');
const glslPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await glslPage.goto(`${URL}?world=${encodeURIComponent(TEMP_GLSL)}&fresh=1`, { waitUntil: 'networkidle' });
await glslPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await glslPage.waitForTimeout(700);
const glslApp = glslPage.locator('[data-testid="ink-app"]');
check('视觉端口进入 GLSL 后端', Number(await glslApp.getAttribute('data-glsl-ports')) === 2, String(await glslApp.getAttribute('data-glsl-ports')));
check('视觉端口纹理可观测', (await glslApp.getAttribute('data-glsl-textures')) === '条纹,渐变', String(await glslApp.getAttribute('data-glsl-textures')));
check('纹理资产端口可观测', (await glslApp.getAttribute('data-glsl-assets')) === '雨纹', String(await glslApp.getAttribute('data-glsl-assets')));
check('GLSL 编译成功', (await glslApp.getAttribute('data-glsl-status')) === 'ok', String(await glslApp.getAttribute('data-glsl-error')));
await glslPage.keyboard.press('Space');
await glslPage.waitForTimeout(300);
check('预览蒙版出现多端口 GLSL canvas', (await glslPage.locator('[data-testid="preview-glsl"]').count()) === 2, String(await glslPage.locator('[data-testid="preview-glsl"]').count()));
check('GLSL 预览为两 pass（FBO + 后处理）', (await glslPage.locator('[data-testid="preview-glsl"][data-glsl-passes="2"]').count()) === 2, String(await glslPage.locator('[data-testid="preview-glsl"][data-glsl-passes="2"]').count()));
await glslPage.close();

// v5.8：音频端口 → Faust 源码适配
writeFileSync(TEMP_FAUST, FAUST_WORLD_SOURCE, 'utf8');
const faustPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await faustPage.goto(`${URL}?world=${encodeURIComponent(TEMP_FAUST)}&fresh=1`, { waitUntil: 'networkidle' });
await faustPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await faustPage.waitForTimeout(700);
const faustApp = faustPage.locator('[data-testid="ink-app"]');
check('音频端口进入 Faust 适配', Number(await faustApp.getAttribute('data-faust-ports')) === 2, String(await faustApp.getAttribute('data-faust-ports')));
check('Faust 源码生成成功', (await faustApp.getAttribute('data-faust-status')) === 'source', String(await faustApp.getAttribute('data-faust-error')));
await faustPage.keyboard.press('Space');
await faustPage.waitForTimeout(4000);
check('现象层显示音频端口状态', (await faustPage.locator('[data-testid="preview-audio"]').count()) === 1, String(await faustPage.locator('[data-testid="preview-audio"]').count()));
check('Faust wasm 真实编译', (await faustApp.getAttribute('data-faust-compile')) === 'ok', `${await faustApp.getAttribute('data-faust-runtime')}/${await faustApp.getAttribute('data-faust-compile')}`);
check('多个音频端口各自建节点', Number(await faustApp.getAttribute('data-faust-nodes')) === 2, String(await faustApp.getAttribute('data-faust-nodes')));
check('WebAudio 兜底已接线', (await faustApp.getAttribute('data-faust-runtime')) === 'faust-wasm', String(await faustApp.getAttribute('data-faust-runtime')));
await faustPage.close();

// v5.10：F8 场景切换
writeFileSync(TEMP_SCENES, SCENES_WORLD_SOURCE, 'utf8');
const scenesPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await scenesPage.goto(`${URL}?world=${encodeURIComponent(TEMP_SCENES)}&fresh=1`, { waitUntil: 'networkidle' });
await scenesPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await scenesPage.waitForTimeout(700);
const scenesApp = scenesPage.locator('[data-testid="ink-app"]');
check('场景世界有两场景', Number(await scenesApp.getAttribute('data-scene-count')) === 2 && (await scenesApp.getAttribute('data-preview-scene')) === '夜', `${await scenesApp.getAttribute('data-scene-count')}/${await scenesApp.getAttribute('data-preview-scene')}`);
await scenesPage.keyboard.press('F8');
await scenesPage.waitForTimeout(250);
check('F8 打开场景列表', (await scenesApp.getAttribute('data-scene-menu-open')) === 'true' && (await scenesPage.locator('[data-testid="scene-menu"] .scene-row').count()) === 2, String(await scenesPage.locator('[data-testid="scene-menu"] .scene-row').count()));
await scenesPage.keyboard.press('ArrowDown');
await scenesPage.waitForTimeout(120);
await scenesPage.keyboard.press('Enter');
await scenesPage.waitForTimeout(300);
check('Enter 切到昼场景', (await scenesApp.getAttribute('data-preview-scene')) === '昼', String(await scenesApp.getAttribute('data-preview-scene')));
await scenesPage.close();

// v6.14：垂直故事——两条路线
const storyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await storyPage.goto(`${URL}?world=${encodeURIComponent('examples/vertical-story.nro')}&fresh=1`, { waitUntil: 'networkidle' });
await storyPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await storyPage.waitForTimeout(700);
const storyApp = storyPage.locator('[data-testid="ink-app"]');
const storyField = storyPage.locator('[data-testid="string-field"]');
check('垂直故事：世界与 8 弦', (await storyField.getAttribute('data-world')) === '潮汐之间' && Number(await storyField.getAttribute('data-lane-count')) === 8, `${await storyField.getAttribute('data-world')}/${await storyField.getAttribute('data-lane-count')}`);
check('垂直故事：两场景与视/音频端口', (await storyApp.getAttribute('data-engine-scenes')) === '夜,昼' && (await storyApp.getAttribute('data-glsl-ports')) === '1' && (await storyApp.getAttribute('data-faust-ports')) === '1', `${await storyApp.getAttribute('data-engine-scenes')}/${await storyApp.getAttribute('data-glsl-ports')}/${await storyApp.getAttribute('data-faust-ports')}`);
check('垂直故事：音频端口带自动化曲线', (await storyApp.getAttribute('data-faust-automation')) === '潮声', String(await storyApp.getAttribute('data-faust-automation')));
await storyPage.evaluate(() => window.__neurouString.setValue('叙事', 90));
await storyPage.waitForTimeout(1200);
check('垂直故事：高信任走到安顿', (await storyField.getAttribute('data-ending')) === '安顿', String(await storyField.getAttribute('data-ending')));
check('垂直故事：结局在拍内触发', Number(await storyField.getAttribute('data-ending-tick')) > 0, String(await storyField.getAttribute('data-ending-tick')));
await storyPage.keyboard.press('Space');
await storyPage.waitForTimeout(500);
check(
  '垂直故事：视觉后处理链生效',
  Number(await storyApp.getAttribute('data-glsl-post-ports')) === 1 &&
    String(await storyPage.locator('[data-testid="preview-glsl"]').first().getAttribute('data-glsl-post')) === '0.4,0.2,0.15',
  `${await storyApp.getAttribute('data-glsl-post-ports')}/${await storyPage.locator('[data-testid="preview-glsl"]').first().getAttribute('data-glsl-post')}`,
);
await storyPage.close();

// v5.16：多文件模块世界在 GUI 中只读打开，依赖可观测
const modularPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await modularPage.goto(`${URL}?world=${encodeURIComponent('examples/modular.nro')}&fresh=1`, { waitUntil: 'networkidle' });
await modularPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await modularPage.waitForTimeout(800);
const modularApp = modularPage.locator('[data-testid="ink-app"]');
check('模块世界标记为项目', (await modularApp.getAttribute('data-project')) === 'true', String(await modularApp.getAttribute('data-project')));
check('模块世界可观测依赖', (await modularApp.getAttribute('data-project-modules'))?.includes('examples/modules/rain.nro') === true, String(await modularApp.getAttribute('data-project-modules')));
check('模块弦被标记为只读', (await modularApp.getAttribute('data-module-strings'))?.includes('雨.雨量') === true, String(await modularApp.getAttribute('data-module-strings')));
const modularFileBefore = readFileSync('examples/modular.nro', 'utf8');
await modularPage.evaluate(() => window.__neurouString.setValue('叙事', 40));
await modularPage.waitForTimeout(300);
check(
  '模块弦编辑被拒绝且文件不变',
  ((await modularApp.getAttribute('data-save-error')) ?? '').includes('模块') && readFileSync('examples/modular.nro', 'utf8') === modularFileBefore,
  String(await modularApp.getAttribute('data-save-error')),
);
await modularPage.keyboard.press('Space');
await modularPage.waitForTimeout(300);
check('现象层显示模块依赖', (await modularPage.locator('[data-testid="preview-modules"] span').count()) === 2, String(await modularPage.locator('[data-testid="preview-modules"] span').count()));
await modularPage.close();

// v1.0：模块入口的非弦结构写回（谱段点）
const PROJECT_STRUCT_PATH = 'examples/_acceptance-project-struct.nro';
const PROJECT_STRUCT_SOURCE = `引入 "modules/rain.nro"

# 入口结构注释
世界 入口结构
  版本 0.1

叙事弦 甲
  类型 数值 0..100
  基线 20

叙事弦 乙
  类型 数值 0..100
  基线 40

谱 地形
  段 0.1 0.2 0.3
  范围 0..100

耦合 甲 → 乙 同向 0.3
`;
writeFileSync(PROJECT_STRUCT_PATH, PROJECT_STRUCT_SOURCE, 'utf8');
const structurePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await structurePage.goto(`${URL}?world=${encodeURIComponent(PROJECT_STRUCT_PATH)}&fresh=1`, { waitUntil: 'networkidle' });
await structurePage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await structurePage.waitForTimeout(700);
const structureApp = structurePage.locator('[data-testid="ink-app"]');
check('入口结构世界按项目打开', (await structureApp.getAttribute('data-project')) === 'true', String(await structureApp.getAttribute('data-project')));
await structurePage.keyboard.press('F2');
await structurePage.waitForTimeout(400);
const structurePositions = await structurePage.evaluate(() => window.__neurouSpectrum?.bandPositions() ?? []);
const structBand = structurePositions[1];
if (structBand) {
  await structurePage.mouse.move(structBand.x, structBand.y);
  await structurePage.mouse.down();
  await structurePage.mouse.move(structBand.x, structBand.y - 90, { steps: 8 });
  await structurePage.waitForTimeout(260);
  await structurePage.mouse.up();
  await structurePage.waitForTimeout(1200);
}
check('入口谱编辑写回状态 = saved', (await structureApp.getAttribute('data-save-state')) === 'saved', String(await structureApp.getAttribute('data-save-state')));
check('入口谱写回走行级 patch', (await structureApp.getAttribute('data-save-mode')) === 'patch', `${await structureApp.getAttribute('data-save-mode')}/${await structureApp.getAttribute('data-save-error')}`);
const structText = readFileSync(PROJECT_STRUCT_PATH, 'utf8');
check(
  '入口谱行更新且注释/引入保留',
  /段 0\.1 \d+(?:\.\d+)? 0\.3/.test(structText) && structText.includes('# 入口结构注释') && structText.includes('引入 "modules/rain.nro"') && !structText.includes('命名空间 雨'),
  structText.split(/\r?\n/).find((line) => line.trimStart().startsWith('段')) ?? '',
);
await structurePage.close();
try { unlinkSync(PROJECT_STRUCT_PATH); } catch { /* 清理临时入口 */ }

// v6.2：完整垂直切片（弦/谱/关系谱/场景/端口/资源/动作/结局）
const slicePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await slicePage.goto(`${URL}?world=${encodeURIComponent('examples/vertical-slice.nro')}&fresh=1`, { waitUntil: 'networkidle' });
await slicePage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await slicePage.waitForTimeout(700);
const sliceApp = slicePage.locator('[data-testid="ink-app"]');
const sliceField = slicePage.locator('[data-testid="string-field"]');
check('垂直切片：8 弦世界', Number(await sliceField.getAttribute('data-lane-count')) === 8 && (await sliceField.getAttribute('data-world')) === '垂直切片', `${await sliceField.getAttribute('data-world')}/${await sliceField.getAttribute('data-lane-count')}`);
check('垂直切片：谱/关系谱/场景', (await sliceApp.getAttribute('data-spectrum-count')) === '1' && (await sliceApp.getAttribute('data-matrix-count')) === '1' && (await sliceApp.getAttribute('data-engine-scenes')) === '夜,昼', `${await sliceApp.getAttribute('data-spectrum-count')}/${await sliceApp.getAttribute('data-matrix-count')}/${await sliceApp.getAttribute('data-engine-scenes')}`);
check('垂直切片：视觉/音频端口与资源', (await sliceApp.getAttribute('data-glsl-ports')) === '1' && (await sliceApp.getAttribute('data-faust-ports')) === '1' && (await sliceApp.getAttribute('data-glsl-assets'))?.includes('雨纹') === true, `${await sliceApp.getAttribute('data-glsl-ports')}/${await sliceApp.getAttribute('data-faust-ports')}/${await sliceApp.getAttribute('data-glsl-assets')}`);
await slicePage.keyboard.press('Space');
await slicePage.waitForTimeout(500);
check('垂直切片：预览同时出现视觉与音频', (await slicePage.locator('[data-testid="preview-glsl"]').count()) === 1 && (await slicePage.locator('[data-testid="preview-audio"]').count()) === 1, String(await slicePage.locator('[data-testid="preview-glsl"]').count()));
check('垂直切片：两 pass 与 Faust 节点', (await slicePage.locator('[data-testid="preview-glsl"][data-glsl-passes="2"]').count()) === 1 && Number(await sliceApp.getAttribute('data-faust-nodes')) >= 1 && (await slicePage.locator('[data-testid="preview-glsl"]').first().getAttribute('data-post-level')) === '1', `${await sliceApp.getAttribute('data-faust-nodes')}`);
const sliceFileBeforeAssetEdit = readFileSync('examples/vertical-slice.nro', 'utf8');
await slicePage.keyboard.press('F6');
await slicePage.waitForTimeout(300);
check('F6 编辑器列出资源', (await slicePage.locator('[data-testid="waveform-editor"]').count()) === 1 && (await slicePage.locator('[data-editor-asset]').count()) >= 2, String(await slicePage.locator('[data-editor-asset]').count()));
const assetSrcInput = slicePage.locator('[data-editor-asset-src="true"]');
check('资源编辑器有路径输入', (await assetSrcInput.count()) === 1);
await assetSrcInput.fill('audio/clock.wav');
await assetSrcInput.press('Enter');
await slicePage.waitForTimeout(1100);
const sliceFileAfterAssetEdit = readFileSync('examples/vertical-slice.nro', 'utf8');
check('资源路径写回文件', sliceFileAfterAssetEdit.includes('audio/clock.wav') && sliceFileAfterAssetEdit !== sliceFileBeforeAssetEdit, `${await sliceApp.getAttribute('data-save-state')}/${await sliceApp.getAttribute('data-save-error')}`);
writeFileSync('examples/vertical-slice.nro', sliceFileBeforeAssetEdit, 'utf8');
await slicePage.locator('[data-editor-asset="雨纹"]').click();
await slicePage.waitForTimeout(200);
check(
  '资产引用图显示贴图引用',
  Number(await slicePage.locator('[data-editor-asset-refs]').getAttribute('data-editor-asset-refs')) > 0 && (await slicePage.locator('[data-editor-asset-delete-blocked="true"]').count()) === 1,
  String(await slicePage.locator('[data-editor-asset-refs]').getAttribute('data-editor-asset-refs')),
);
await slicePage.locator('[data-editor-asset-replace="备用纹"]').click();
await slicePage.waitForTimeout(1100);
const sliceFileAfterReplace = readFileSync('examples/vertical-slice.nro', 'utf8');
check(
  '资产引用替换写回贴图',
  sliceFileAfterReplace.includes('贴图 备用纹') && (await sliceApp.getAttribute('data-save-error')) === '',
  `${await sliceApp.getAttribute('data-save-state')}/${await sliceApp.getAttribute('data-save-error')}`,
);
writeFileSync('examples/vertical-slice.nro', sliceFileBeforeAssetEdit, 'utf8');
await slicePage.locator('[data-editor-asset="雨声"]').click();
await slicePage.waitForTimeout(200);
const assetNameInput = slicePage.locator('[data-editor-asset-name="true"]');
if ((await assetNameInput.count()) > 0) {
  await assetNameInput.fill('新雨声');
  await assetNameInput.press('Enter');
  await slicePage.waitForTimeout(1100);
  const sliceFileAfterRename = readFileSync('examples/vertical-slice.nro', 'utf8');
  check('资产重命名写回文件', sliceFileAfterRename.includes('音频资产 新雨声'), `${await sliceApp.getAttribute('data-save-state')}/${await sliceApp.getAttribute('data-save-error')}`);
  writeFileSync('examples/vertical-slice.nro', sliceFileBeforeAssetEdit, 'utf8');
}
await slicePage.keyboard.press('Escape');
await slicePage.waitForTimeout(200);
await slicePage.keyboard.press('Space');
await slicePage.waitForTimeout(300);
const sliceFileBeforeRuleEdit = readFileSync('examples/vertical-slice.nro', 'utf8');
await slicePage.keyboard.press('F7');
await slicePage.waitForTimeout(300);
const ruleOverlay = slicePage.locator('[data-testid="rule-editor"]');
check('F7 打开规则/动作编辑器', (await sliceApp.getAttribute('data-rule-editor-open')) === 'true' && (await ruleOverlay.count()) === 1, String(await sliceApp.getAttribute('data-rule-editor-open')));
check('规则编辑器列出动作', Number(await ruleOverlay.getAttribute('data-rule-count')) >= 1 && (await ruleOverlay.locator('[data-rule-id="action:安抚"]').count()) === 1, String(await ruleOverlay.getAttribute('data-rule-count')));
await ruleOverlay.locator('[data-rule-id="action:安抚"] [data-rule-field="cost"] button[data-rule-step="1"]').click();
await slicePage.waitForTimeout(1100);
const sliceFileAfterRuleEdit = readFileSync('examples/vertical-slice.nro', 'utf8');
check('规则编辑写回状态 = saved', (await sliceApp.getAttribute('data-save-state')) === 'saved' && (await sliceApp.getAttribute('data-save-mode')) === 'patch', `${await sliceApp.getAttribute('data-save-state')}/${await sliceApp.getAttribute('data-save-mode')}/${await sliceApp.getAttribute('data-save-error')}`);
check('规则编辑更新耗时行', sliceFileAfterRuleEdit.includes('耗时 2') && sliceFileAfterRuleEdit !== sliceFileBeforeRuleEdit);
writeFileSync('examples/vertical-slice.nro', sliceFileBeforeRuleEdit, 'utf8');
await slicePage.keyboard.press('Escape');
await slicePage.waitForTimeout(200);
check('Esc 关闭规则编辑器', (await sliceApp.getAttribute('data-rule-editor-open')) === 'false' && (await ruleOverlay.count()) === 0);
await slicePage.keyboard.press('F7');
await slicePage.waitForTimeout(300);
const ruleSource = slicePage.locator('[data-rule-source="true"]');
check('F7 可编辑规则源文本', (await ruleSource.count()) === 1 && String(await ruleSource.inputValue()).includes('信任 += 6'), String(await ruleSource.inputValue()).slice(0, 40));
const editedRuleSource = String(await ruleSource.inputValue()).replace('信任 += 6', '信任 += 8');
const sliceFileBeforeRawRule = readFileSync('examples/vertical-slice.nro', 'utf8');
await ruleSource.fill(editedRuleSource);
await slicePage.locator('[data-rule-apply="true"]').click();
await slicePage.waitForTimeout(900);
const sliceFileAfterRawRule = readFileSync('examples/vertical-slice.nro', 'utf8');
check('规则源文本应用并写回', sliceFileAfterRawRule.includes('信任 += 8') && (await sliceApp.getAttribute('data-save-mode')) === 'rule-source' && (await sliceApp.getAttribute('data-save-error')) === '', `${await sliceApp.getAttribute('data-save-mode')}/${await sliceApp.getAttribute('data-save-error')}`);
check('规则源应用后关闭编辑器', (await sliceApp.getAttribute('data-rule-editor-open')) === 'false' && (await ruleOverlay.count()) === 0);
writeFileSync('examples/vertical-slice.nro', sliceFileBeforeRawRule, 'utf8');
await slicePage.keyboard.press('F7');
await slicePage.waitForTimeout(300);
const invalidRuleSource = slicePage.locator('[data-rule-source="true"]');
const invalidSource = String(await invalidRuleSource.inputValue()).replace('信任 += 8', '信任 +=');
await invalidRuleSource.fill(invalidSource);
await slicePage.locator('[data-rule-apply="true"]').click();
await slicePage.waitForTimeout(300);
check(
  '规则源编译错误带行号',
  String(await sliceApp.getAttribute('data-save-error-line')) !== '' && String(await sliceApp.getAttribute('data-save-error')).includes('行'),
  `${await sliceApp.getAttribute('data-save-error-line')}/${await sliceApp.getAttribute('data-save-error')}`,
);
check('规则编辑器显示错误行', Number(await slicePage.locator('[data-rule-error-line]').getAttribute('data-rule-error-line')) > 0, String(await slicePage.locator('[data-rule-error-line]').count()));
await slicePage.keyboard.press('Escape');
await slicePage.waitForTimeout(200);
await slicePage.close();

// v5.59：F6 波形 / 资源编辑器
const editorPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await editorPage.goto(`${URL}?world=${encodeURIComponent('examples/tuner.nro')}&fresh=1`, { waitUntil: 'networkidle' });
await editorPage.waitForSelector('[data-testid="string-field"]', { timeout: 10000 });
await editorPage.waitForTimeout(500);
const editorApp = editorPage.locator('[data-testid="ink-app"]');
const tunerFileBeforeEditor = readFileSync('examples/tuner.nro', 'utf8');
await editorPage.keyboard.press('F6');
await editorPage.waitForTimeout(300);
const editorOverlay = editorPage.locator('[data-testid="waveform-editor"]');
check('F6 打开波形/资源编辑器', (await editorApp.getAttribute('data-editor-open')) === 'true' && (await editorOverlay.count()) === 1, String(await editorApp.getAttribute('data-editor-open')));
const editorStringsAttr = String((await editorOverlay.getAttribute('data-editor-strings')) ?? '');
check('编辑器列出持续弦与资源', editorStringsAttr.split(',').filter(Boolean).length >= 4 && Boolean(await editorOverlay.getAttribute('data-editor-selected')), editorStringsAttr);
const bandValuesBeforeEditor = String(await editorPage.locator('[data-testid="waveform-editor-canvas"]').getAttribute('data-wave-values'));
await editorPage.locator('[data-editor-preset="方波"]').click();
await editorPage.waitForTimeout(1100);
const postBefore = String(await editorPage.locator('[data-editor-post]').getAttribute('data-editor-post'));
await editorPage.locator('[data-editor-post]').click();
await editorPage.waitForTimeout(150);
check('编辑器可循环后处理档位', String(await editorPage.locator('[data-editor-post]').getAttribute('data-editor-post')) !== postBefore, postBefore);
const postRange = editorPage.locator('[data-editor-post-range="true"]');
if ((await postRange.count()) > 0) {
  await postRange.evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, '1.35');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await editorPage.waitForTimeout(150);
  check('后处理可任意调参', String(await editorPage.locator('[data-editor-post]').getAttribute('data-editor-post')) === '1.35', String(await editorPage.locator('[data-editor-post]').getAttribute('data-editor-post')));
  check(
    '后处理参数按世界持久化',
    (await editorPage.evaluate(() => window.localStorage.getItem('neurou.post.level:examples/tuner.nro'))) === '1.35',
    String(await editorPage.evaluate(() => window.localStorage.getItem('neurou.post.level:examples/tuner.nro'))),
  );
}
const bandValuesAfterEditor = String(await editorPage.locator('[data-testid="waveform-editor-canvas"]').getAttribute('data-wave-values'));
check('编辑器预设改变波形', bandValuesAfterEditor !== bandValuesBeforeEditor);
check('编辑器预设写回保存', (await editorApp.getAttribute('data-save-state')) === 'saved', `${await editorApp.getAttribute('data-save-state')}/${await editorApp.getAttribute('data-save-error')}`);
const editorBox = await editorPage.locator('[data-testid="waveform-editor-canvas"]').boundingBox();
if (editorBox) {
  await editorPage.mouse.move(editorBox.x + editorBox.width * 0.3, editorBox.y + editorBox.height * 0.2);
  await editorPage.mouse.down();
  await editorPage.mouse.move(editorBox.x + editorBox.width * 0.5, editorBox.y + editorBox.height * 0.8, { steps: 8 });
  await editorPage.mouse.up();
  await editorPage.waitForTimeout(1100);
}
const tunerFileAfterEditor = readFileSync('examples/tuner.nro', 'utf8');
check('编辑器绘制写回文件波形', /波形 /s.test(tunerFileAfterEditor) && tunerFileAfterEditor !== tunerFileBeforeEditor);
await editorPage.keyboard.press('Escape');
await editorPage.waitForTimeout(250);
check('Esc 关闭编辑器', (await editorApp.getAttribute('data-editor-open')) === 'false' && (await editorOverlay.count()) === 0);
await editorPage.keyboard.press('?');
await editorPage.waitForTimeout(200);
check('? 打开手势帮助层', (await editorApp.getAttribute('data-help-open')) === 'true' && (await editorPage.locator('[data-testid="help-overlay"]').count()) === 1);
await editorPage.keyboard.press('Escape');
await editorPage.waitForTimeout(200);
check('Esc 关闭手势帮助层', (await editorApp.getAttribute('data-help-open')) === 'false' && (await editorPage.locator('[data-testid="help-overlay"]').count()) === 0);
await editorPage.close();

await browser.close();
// 关闭浏览器后可能还有一次 debounce 写回在飞，最后再恢复一次世界文件。
restoreWorld();
writeFileSync('examples/moon-tide.nro', moonTideBackup);

const summary = {
  when: new Date().toISOString(),
  world: { name: worldName },
  initial: { values: initialValues, bands: restBands.length, centers },
  focus: { focusInk, otherInk },
  drag: { before: beforeDrag[0], after: dragged[0], coupled: afterCoupling, changedOthers },
  pluck: { before: beforePluck[0], after: afterPluck[0], amplitude: pluckState.amplitude },
  threshold: { resonant: true },
  thresholdEdit: {
    pre: thresholdPre.verge,
    after: thresholdAfter.verge,
    inFile: vergeInFile,
    undone: thresholdUndone.verge,
    redone: thresholdRedone.verge,
    reloaded: thresholdReloaded.verge,
  },
  crossings,
  save: {
    beforeSaves: savesBefore,
    afterSaves: savesAfter,
    preBaseline,
    savedBaseline,
    reloadedTrust: reloaded[0],
    restored,
  },
  hold: { heldAmplitude: heldAmp, movedPin: pinMoved },
  links: {
    target: linkTarget?.name ?? null,
    before: linkPreCount,
    afterAdd: linkPreCount + 1,
    afterRemove: linkPreCount,
  },
  easing: {
    from: easEdited,
    mid1: easMid1,
    mid2: easMid2,
    target: easingTarget,
    final: easFinal,
  },
  audio: { state: audioState, rms: finalRms },
  worldSwitch: { file: TEMP_TUNER, trust: tempTrust, tunerUntouched: readFileSync(WORLD_PATH, 'utf8') === tunerBeforeOtherWorld },
  instances: { first: firstLane.name, second: secondLane.name, back: backLane.name },
  fps,
  heapMB: heap,
  consoleErrors,
  results,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync('artifacts/string-test.json', JSON.stringify(summary, null, 2));
console.log(`\n=== ${summary.passed} passed / ${summary.failed} failed ===`);
if (summary.failed > 0) process.exitCode = 1;
