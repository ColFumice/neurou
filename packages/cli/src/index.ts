#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { SourceFile, compile, formatDiagnostic, type WorldIR } from '@neurou/core';
import {
  ANSI,
  Universe,
  modelLabel,
  padDisplay,
  renderBatchReport,
  simulate,
  type ModelKind,
} from '@neurou/runtime';

const VERSION = '0.1.0';

const HELP = `neurou ${VERSION} · 雨若

用法：
  neurou check <文件.nro>                检查一个世界（语法 / 语义 / 体验三级诊断）
  neurou sim <文件.nro> [选项]           跑批量模拟，出音准仪报告
  neurou run <文件.nro> [选项]           进入这个世界，逐拍游玩
  neurou ir <文件.nro> [--out 路径]      导出弦网络图（JSON）
  neurou init <名字>                     生成一个可运行的世界模板
  neurou help                            这张帮助

sim / run 选项：
  --runs <n>       模拟局数（默认 500）
  --ticks <n>      每局拍数上限（默认 120）
  --model <名字>   random | greedy | learner | all（默认 all）
  --seed <n>       随机种子（默认 1）
  --json           输出机器可读的摘要
  --no-color       关闭颜色

一个世界就是一个 .nro 文件。先从 examples/negotiation.nro 看起。
`;

interface Args {
  command: string;
  file?: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { command: positional[0] ?? 'help', file: positional[1], flags };
}

function colorEnabled(flags: Record<string, string | boolean>): boolean {
  if (flags['no-color']) return false;
  if (process.env['NO_COLOR']) return false;
  return Boolean(stdout.isTTY);
}

function paint(enabled: boolean, code: string, s: string): string {
  return enabled ? `${code}${s}${ANSI.reset}` : s;
}

function load(path: string): { ir: WorldIR; ok: boolean } | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.error(`读不到文件：${path}`);
    return undefined;
  }
  const result = compile(new SourceFile(path, text));
  const color = colorEnabled({});
  for (const d of result.diagnostics.sorted()) {
    const line = formatDiagnostic(result.source, d);
    const head = d.severity === 'error' ? ANSI.red : d.severity === 'warning' ? ANSI.yellow : ANSI.cyan;
    console.log(paint(color, head, line));
  }
  if (!result.ok) {
    const errs = result.diagnostics.count('error');
    console.log(`\n${paint(color, ANSI.red, `× ${errs} 个错误`)}——这个世界还编译不过去。`);
  }
  return { ir: result.ir, ok: result.ok };
}

function pickModels(flags: Record<string, string | boolean>): ModelKind[] {
  const m = String(flags['model'] ?? 'all');
  if (m === 'all') return ['random', 'greedy', 'learner'];
  if (m === 'random' || m === 'greedy' || m === 'learner') return [m];
  console.error(`不认识的模型「${m}」。可用：random、greedy、learner、all。`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const color = colorEnabled(args.flags);

  switch (args.command) {
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;
    case 'version':
    case '--version':
      console.log(VERSION);
      return;
    case 'check': {
      if (!args.file) {
        console.error('用法：neurou check <文件.nro>');
        process.exitCode = 2;
        return;
      }
      const world = load(args.file);
      if (!world) {
        process.exitCode = 2;
        return;
      }
      if (world.ok) {
        const ir = world.ir;
        console.log(
          paint(color, ANSI.green, `✓ ${ir.name}`) +
            `  ${paint(color, ANSI.gray, `${ir.stats.strings} 弦 · ${ir.stats.couplings} 耦合 · ${ir.stats.loops} 回路 · ${ir.stats.rules} 规则 · ${ir.stats.signals} 信号 · ${ir.stats.endings} 结局`)}`,
        );
      } else {
        process.exitCode = 1;
      }
      return;
    }
    case 'sim': {
      if (!args.file) {
        console.error('用法：neurou sim <文件.nro> [--runs 500]');
        process.exitCode = 2;
        return;
      }
      const world = load(args.file);
      if (!world) {
        process.exitCode = 2;
        return;
      }
      if (!world.ok) {
        process.exitCode = 1;
        return;
      }
      const runs = Number(args.flags['runs'] ?? 500);
      const maxTicks = Number(args.flags['ticks'] ?? 120);
      const seed = Number(args.flags['seed'] ?? 1);
      const models = pickModels(args.flags);
      const result = simulate(world.ir, { runs, maxTicks, seed, models });
      if (args.flags['json']) {
        const payload = {
          world: world.ir.name,
          score: result.health.score,
          grade: result.health.grade,
          runs: result.overall.runs,
          endings: result.overall.endings,
          entropy: result.overall.entropy,
          deadForcings: result.overall.deadForcings,
          deadSignals: result.overall.deadSignals,
          unusedActions: result.overall.unusedActions,
          deadStateRuns: result.overall.deadStateRuns,
          violations: result.overall.violations,
          notes: result.health.notes,
          models: result.models.map((m) => ({ model: m.model, endings: m.endings, meanTicks: m.meanTicks })),
        };
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log(renderBatchReport(result, { color }));
      return;
    }
    case 'run': {
      if (!args.file) {
        console.error('用法：neurou run <文件.nro>');
        process.exitCode = 2;
        return;
      }
      const world = load(args.file);
      if (!world) {
        process.exitCode = 2;
        return;
      }
      if (!world.ok) {
        process.exitCode = 1;
        return;
      }
      await play(world.ir, color);
      return;
    }
    case 'ir': {
      if (!args.file) {
        console.error('用法：neurou ir <文件.nro> [--out 路径]');
        process.exitCode = 2;
        return;
      }
      const world = load(args.file);
      if (!world || !world.ok) {
        process.exitCode = 1;
        return;
      }
      const json = JSON.stringify(world.ir, null, 2);
      const out = args.flags['out'];
      if (typeof out === 'string') {
        writeFileSync(out, json, 'utf8');
        console.log(`弦网络图已写入 ${resolve(out)}`);
      } else {
        console.log(json);
      }
      return;
    }
    case 'init': {
      const name = args.file ?? '新世界';
      const path = args.flags['out'] && typeof args.flags['out'] === 'string' ? args.flags['out'] : `${name}.nro`;
      writeFileSync(path, TEMPLATE.replaceAll('{{名字}}', name), 'utf8');
      console.log(`已生成 ${resolve(path)}，用 neurou run 打开它。`);
      return;
    }
    default:
      console.error(`不认识的命令「${args.command}」。`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

async function play(ir: WorldIR, color: boolean): Promise<void> {
  const u = new Universe(ir, { seed: Number(1), log: false });
  const rl = createInterface({ input: stdin, output: stdout });
  console.log('');
  console.log(paint(color, ANSI.bold + ANSI.cyan, `  ${ir.name}`) + paint(color, ANSI.gray, `   ${String(ir.meta['调性'] ?? '')}`));
  console.log(paint(color, ANSI.gray, '  输入编号做选择，回车进入下一拍，q 退出。'));
  console.log('');

  let pending: string[] = [];
  try {
    while (!u.ended) {
      const cues = pending.length > 0 ? pending : [];
      pending = [];
      const actions = u.availableActions();
      console.log(
        paint(color, ANSI.gray, `  ── 第 ${u.state.tick} 拍${u.phaseName ? ` · ${u.phaseName}` : ''} ──`),
      );
      for (const line of renderState(u)) console.log(line);
      for (const cue of cues) console.log(`  ${paint(color, ANSI.magenta, '♪')} ${cue}`);

      if (actions.length === 0) {
        console.log(paint(color, ANSI.yellow, '  这一段你没有可做的事。'));
      } else {
        actions.forEach((a, i) => {
          console.log(`  ${paint(color, ANSI.cyan, String(i + 1))} ${a.name}${a.note ? paint(color, ANSI.gray, `  ${a.note}`) : ''}`);
        });
      }
      const answer = (await rl.question(paint(color, ANSI.green, '  > '))).trim();
      if (answer === 'q' || answer === 'quit' || answer === '退出') break;
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= actions.length) {
        const action = actions[n - 1]!;
        u.act(action.id);
        console.log(paint(color, ANSI.gray, `  …${action.name}`));
      }
      const result = u.tick();
      for (const cue of result.cues) pending.push(cueText(cue.cue));
      if (result.ending) {
        console.log('');
        console.log(paint(color, ANSI.bold + ANSI.yellow, `  结局：${result.ending.name}`) + paint(color, ANSI.gray, `（第 ${result.ending.tick} 拍）`));
        break;
      }
    }
    if (!u.state.ended) {
      console.log(paint(color, ANSI.gray, `  你在第 ${u.state.tick} 拍离开了这场谈判。`));
    }
  } finally {
    rl.close();
  }
}

function cueText(cue: { k: string; speaker?: string; text?: string; param?: string; value?: number }): string {
  if (cue.k === '台词') return `${cue.speaker ? `${cue.speaker}：` : ''}「${cue.text ?? ''}」`;
  if (cue.k === '视觉') return `[视觉] ${cue.param} ${cue.value}`;
  if (cue.k === '音频') return `[音频] ${cue.param} ${cue.value}`;
  if (cue.k === '触觉') return `[触觉] ${cue.text ?? ''}`;
  return `[${cue.k}] ${cue.text ?? ''}`;
}

function renderState(u: Universe): string[] {
  const lines: string[] = [];
  for (const s of u.ir.strings) {
    const v = u.get(s.id);
    if (typeof v === 'number') {
      const min = s.domain.type === 'number' ? (s.domain.min ?? 0) : 0;
      const max = s.domain.type === 'number' ? (s.domain.max ?? 100) : 100;
      const t = max > min ? (v - min) / (max - min) : 0;
      const width = 14;
      const filled = Math.round(Math.max(0, Math.min(1, t)) * width);
      lines.push(
        `  ${padDisplay(s.id, 16)} ${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${String(Math.round(v * 10) / 10).padStart(5)}`,
      );
    } else if (v instanceof Set) {
      lines.push(`  ${padDisplay(s.id, 16)} {${[...v].join(', ')} }`);
    } else {
      lines.push(`  ${padDisplay(s.id, 16)} ${String(v)}`);
    }
  }
  return lines;
}

const TEMPLATE = `# {{名字}} —— 由 neurou init 生成
#
# 一个最小世界：两根弦、一条自我强化回路、两个动作、两个结局。
# 先把它跑起来，再改数字——你会看到结局分布跟着变。

世界 {{名字}}
  版本 0.1
  调性 小调

实体 甲
  叙事弦 信任
    类型 数值 0..100
    基线 50
    悬崖 30
    安全 70
  叙事弦 恐惧
    类型 数值 0..100
    基线 30
    悬崖 60
    安全 30

# 信任一跌，恐惧就涨；恐惧一涨，信任又跌。
回路 猜忌: 信任↓ → 恐惧↑ → 信任↓

动作 靠近
  效果
    信任 += 6
    恐惧 -= 4

动作 试探
  效果
    信任 -= 5
    恐惧 += 5

信号 信任告急
  当 信任 < 35
  台词 甲: "……"
  视觉 色调 -0.2

信号 恐惧逼近
  当 恐惧 > 60
  视觉 暗角 0.5
  触觉 轻微震动

结局 和解
  当 信任 >= 80

结局 决裂
  当 信任 <= 10 或 恐惧 >= 85

曲式 三段
  段落 起 时长 20
  段落 承 时长 20
  段落 转 时长 20
`;

void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
