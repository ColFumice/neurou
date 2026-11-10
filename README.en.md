# neurou · 雨若

> Strings of the world; everything is a string.  
> A declarative world-string language and a live tuning runtime.

<p align="center">
  <img src="雨若logo.png" width="88" alt="neurou" />
</p>

<p align="center">
  <a href="https://github.com/ColFumice/neurou/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ColFumice/neurou/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/ColFumice/neurou/releases/tag/v1.57.0"><img alt="version" src="https://img.shields.io/badge/version-1.57.0-8a7f6a" /></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-8a7f6a" />
  <img alt="tests" src="https://img.shields.io/badge/unit%20tests-480%20passing-8a7f6a" />
  <img alt="gui" src="https://img.shields.io/badge/browser%20acceptance-431%20passing-8a7f6a" />
</p>

<p align="center">
  <a href="https://colfumice.github.io/neurou/">Live demo</a> ·
  <a href="https://github.com/ColFumice/neurou/releases/tag/v1.57.0">Release v1.57.0</a> ·
  <a href="README.md">中文</a>
</p>

neurou is a language for describing **how a world behaves**, together with a runtime
that keeps that world alive. It is not a story editor and not a general-purpose game engine.
It is closer to **GLSL for graphics or Faust for audio**: authors declare rules in a domain
language, the compiler checks that the world will not fall apart, and the runtime evolves it
tick by tick. Batch simulation tells you whether the world is worth publishing.

```text
.nro source ──▶ compiler ──▶ string-network IR (single source of truth) ──▶ runtime / simulation / tuner / games
                  │
                  └─ syntax · semantics · experience diagnostics
```

## Current version

**v1.57.0** — five game-platform capabilities complete.

| Version | Change |
|---|---|
| **v1.57.0** | Theme presets: default / aurora / ember / mono |
| v1.56.0 | Per-game accent palettes |
| v1.55.0 | In-game parameter editing (difficulty / waves) |
| v1.54.0 | Levels / waves |
| v1.53.0 | External game plugin loader (restricted API) |

See [CHANGELOG.md](CHANGELOG.md) for the full history.

## Game platform

Worlds can bind real-time mini-games; results write back into world strings:

```text
Tetris   → trust
Snake    → color temperature
Pong     → gait
Breakout → gravity
External reaction → gravity (example plugin)
```

Platform features:

- **Game SDK** — `GameModule` / `GameSession` / `GameSave`, fixed 60 Hz steps;
- **GameHost** — canvas, input, pause, restart, results, saves, unified HUD;
- **Session resume** — exit saves; re-entering resumes the previous run;
- **Pause menu** — resume / switch game / parameters / help / back to world;
- **Levels / waves** — multi-wave Breakout, unified `WAVE n` HUD;
- **Parameter editing** — change difficulty and waves in-game, then restart;
- **Per-game accents** — every game has its own accent color;
- **Theme presets** — default / aurora / ember / mono, each with dark and light variants;
- **External plugins** — `module external` + `script "plugins/*.js"` with a restricted API;
- **Public manifest** — `packages/gui/public/games/manifest.json`, generated and validated.

```text
game reaction_demo
  module external
  script "plugins/reaction.js"
  result-string gait
  win-score 30
```

## Quick start

Requirements: Node.js **>= 22**, pnpm **11.22.0**.

```bash
pnpm install

pnpm check          # type check / build
pnpm check:gui      # GUI type check
pnpm check:docs     # relative documentation links
pnpm check:games    # public game manifest
pnpm test           # 480 unit tests

pnpm gui            # tuner GUI → http://127.0.0.1:5188/
pnpm test:gui       # 431 browser acceptance checks (local Edge)
pnpm release        # static release at release/neurou/
```

Production preview / performance baseline:

```bash
pnpm build
pnpm preview        # http://127.0.0.1:5189/
pnpm perf
```

## Architecture

```text
packages/core       language frontend: lexer / parser / semantics / string-network IR / spectra / patch
packages/runtime    runtime: tick state machine / snapshots / batch simulation / tuner / spectrum solver
packages/engine     standalone Engine facade: the only Host entry point
packages/cli        CLI: check / sim / run / ir / fmt / init
packages/gui        canvas tuner + game platform + editors + themes
examples/           runnable worlds (default tuner: examples/tuner.nro)
docs/               language, architecture, tuner, game platform, release, acceptance
```

## A world

The DSL keywords are Chinese by design; this is the same world an author would write:

```text
世界 雨切片
  版本 0.1

叙事弦 信任
  类型 数值 0..100
  基线 40

叙事弦 色温
  类型 数值 0..100
  基线 60

耦合 信任 → 色温 同向 0.2

游戏 方块校准
  模块 俄罗斯方块
  结果弦 信任
  胜利分数 40
  难度 3
  主题 浅色
```

Tuning gestures are documented in [docs/07-八弦叠影.md](docs/07-八弦叠影.md).

## Acceptance

| Item | Current result |
|---|---|
| Unit tests | **480 / 480** |
| Browser acceptance | **431 / 431** |
| Documentation links | **209 existing (185 documents)** |
| Release | **1.57.0 / 2 worlds** |
| Production smoke | PASS |
| Production world smoke | PASS |
| Performance baseline | PASS (~36k large-world ticks/s) |

## Docs

- [Overview](docs/00-总览.md)
- [Language spec v0.1](docs/01-语言规范.md)
- [Architecture and roadmap](docs/02-架构.md)
- [Tuning philosophy](docs/10-编程范式.md)
- [Eight-string tuner](docs/07-八弦叠影.md)
- [Project status](docs/37-项目状态-v2.18.md)
- [External game plugins](docs/178-外部游戏插件加载器.md)
- [Levels / waves](docs/179-关卡波次.md)
- [In-game parameters](docs/180-游戏内参数编辑.md)
- [Per-game accents](docs/181-每款游戏独立色板.md)
- [Theme presets](docs/182-主题预设.md)

## What this is not

- Not "AI-generated games" — AI only interprets state, never changes rules.
- Not a general-purpose engine — physics, rendering, animation and networking are out of scope.
- Not a scripting language — it declares state, thresholds, loops and invariants, not procedures.
- Not a perfect world — the tuner's green zone is **60–85**; a perfect score means no surprises.
- Not a complete editor — the GUI writes back baselines / thresholds / coupling strength and can add
  or remove ordinary couplings and top-level strings; rules, loops, polarity and delay are not editable yet.

## Contributing

Issues and PRs are welcome. Before submitting:

```bash
pnpm check && pnpm check:gui && pnpm check:docs && pnpm check:games && pnpm test && pnpm build
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT License](LICENSE) © 2026 ColFumice.
