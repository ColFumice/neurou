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
const result = { when: new Date().toISOString(), url: URL, gui, sim };
mkdirSync('artifacts', { recursive: true });
writeFileSync(join('artifacts', 'perf.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
