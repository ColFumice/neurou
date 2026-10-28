// v2.18 性能基线：生产预览的启动 / FPS / 堆，以及核心模拟吞吐。
// 用法：先 `pnpm build`，再 `pnpm preview`（localhost:5189），最后 `pnpm perf`。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { compileText } from '@neurou/core';
import { simulate } from '@neurou/runtime';

const URL = process.env.PERF_URL ?? 'http://127.0.0.1:5189/';

async function guiMetrics() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="string-field"]', { timeout: 15000 });
  await page.waitForTimeout(700);

  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paints = performance.getEntriesByType('paint').map((p) => ({ name: p.name, start: p.startTime }));
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      domContentLoaded: entry?.domContentLoadedEventEnd ?? null,
      load: entry?.loadEventEnd ?? null,
      firstPaint: paints.find((p) => p.name === 'first-paint')?.start ?? null,
      heapMB: memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null,
    };
  });

  const fps = async (seconds: number): Promise<number> =>
    Number(
      await page.evaluate(
        `new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const loop = (t) => {
            frames += 1;
            if (t - start < ${Math.round(seconds * 1000)}) requestAnimationFrame(loop);
            else resolve(Math.round((frames / ((t - start) / 1000)) * 10) / 10);
          };
          requestAnimationFrame(loop);
        })`,
      ),
    );

  const idleFps = await fps(2);
  await page.keyboard.press('F3');
  await page.waitForTimeout(900);
  const matrixFps = await fps(2);
  const screen = await page.locator('[data-testid="ink-app"]').getAttribute('data-screen');
  await browser.close();
  return { ...nav, idleFps, matrixFps, screen };
}

function simMetrics() {
  const out: { world: string; runs: number; ticks: number; ms: number; runsPerSec: number }[] = [];
  for (const file of ['tuner.nro', 'moon-tide.nro', 'rain-slice.nro']) {
    const source = readFileSync(join(process.cwd(), 'examples', file), 'utf8');
    const compiled = compileText(source, file);
    if (!compiled.ok) throw new Error(`${file} 编译失败`);
    const runs = 60;
    const ticks = 24;
    const started = performance.now();
    const result = simulate(compiled.ir, { runs, maxTicks: ticks, models: ['random'], seed: 7 });
    const ms = Math.round((performance.now() - started) * 10) / 10;
    out.push({ world: file, runs: result.runs.length, ticks, ms, runsPerSec: Math.round((result.runs.length / ms) * 10000) / 10 });
  }
  return out;
}

const gui = await guiMetrics();
const sim = simMetrics();

// v2.18.3：性能门禁阈值（保守值；本地基线见 docs/35）。
const thresholds = {
  domContentLoadedMs: 800,
  firstPaintMs: 1200,
  minFps: 45,
  maxHeapMB: 100,
  minRunsPerSec: 200,
};

const checks = [
  { name: 'DOMContentLoaded', value: gui.domContentLoaded, limit: thresholds.domContentLoadedMs, ok: gui.domContentLoaded !== null && gui.domContentLoaded <= thresholds.domContentLoadedMs },
  { name: 'First Paint', value: gui.firstPaint, limit: thresholds.firstPaintMs, ok: gui.firstPaint !== null && gui.firstPaint <= thresholds.firstPaintMs },
  { name: '空闲 FPS', value: gui.idleFps, limit: thresholds.minFps, ok: gui.idleFps >= thresholds.minFps },
  { name: '矩阵 FPS', value: gui.matrixFps, limit: thresholds.minFps, ok: gui.matrixFps >= thresholds.minFps },
  { name: 'JS 堆 (MB)', value: gui.heapMB, limit: thresholds.maxHeapMB, ok: gui.heapMB === null || gui.heapMB <= thresholds.maxHeapMB },
  ...sim.map((item) => ({
    name: `${item.world} 吞吐`,
    value: item.runsPerSec,
    limit: thresholds.minRunsPerSec,
    ok: item.runsPerSec >= thresholds.minRunsPerSec,
  })),
];
const pass = checks.every((check) => check.ok);
const result = { when: new Date().toISOString(), url: URL, gui, sim, thresholds, checks, pass };
mkdirSync('artifacts', { recursive: true });
writeFileSync(join('artifacts', 'perf.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${String(check.value)}（阈值 ${String(check.limit)}）`);
}
if (!pass) {
  console.error('性能门禁失败；如确认是机器波动，可先看 docs/35 的基线说明再调整阈值。');
  process.exitCode = 1;
}
