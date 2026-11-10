# neurou · 雨若

> 雨若弦，万物皆弦。  
> A declarative world-string language and a live tuning runtime.

<p align="center">
  <img src="雨若logo.png" width="88" alt="neurou" />
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.57.0-8a7f6a" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-8a7f6a" />
  <img alt="tests" src="https://img.shields.io/badge/unit%20tests-480%20passing-8a7f6a" />
  <img alt="gui" src="https://img.shields.io/badge/browser%20acceptance-431%20passing-8a7f6a" />
</p>

neurou 是一门用来写「世界如何运转」的语言，以及执行这些世界的运行时。

它不是剧情编辑器，也不是通用游戏引擎。它更接近 **GLSL 之于图形、Faust 之于音频**：
创作者用一门领域语言声明规则，编译器检查它会不会散架，运行时让它逐拍活起来，
批量模拟告诉你这个世界是否值得发布。

```text
.nro 源码 ──▶ 编译器 ──▶ 弦网络图（唯一真源） ──▶ 运行时 / 批量模拟 / 调律台 / 实时小游戏
                │
                └─ 三级诊断：语法 · 语义 · 体验
```

## 当前版本

**v1.57.0** — 游戏平台化五项能力收束。

最近五个版本：

| 版本 | 内容 |
|---|---|
| **v1.57.0** | 主题预设：默认 / 极光 / 余烬 / 单色 |
| v1.56.0 | 每款游戏独立色板 |
| v1.55.0 | 游戏内参数编辑（难度 / 波次） |
| v1.54.0 | 关卡 / 波次 |
| v1.53.0 | 外部游戏插件加载器（受限 API） |

完整历史见 [CHANGELOG.md](CHANGELOG.md)。

## 游戏平台能力

世界内可以绑定实时小游戏，游戏结果写回世界弦：

```text
俄罗斯方块 → 信任
贪吃蛇     → 色温
乒乓       → 步态
打砖块     → 重力
外部反应   → 重力（示例插件）
```

平台能力：

- **Game SDK**：`GameModule` / `GameSession` / `GameSave`，60Hz 固定步；
- **通用 GameHost**：Canvas、输入、暂停、重开、结果、存档、统一 HUD；
- **会话续局**：退出后自动保存，再次进入恢复上一局；
- **暂停菜单**：继续 / 换游戏 / 参数 / 帮助 / 回世界；
- **关卡 / 波次**：打砖块多波次，GameHost 统一 `WAVE n`；
- **参数编辑**：游戏内直接改难度与波次并重开；
- **独立色板**：每款游戏拥有自己的强调色；
- **主题预设**：默认 / 极光 / 余烬 / 单色，深色与浅色各一套；
- **外部插件**：`模块 外部` + `脚本 "plugins/*.js"`，受限 API 加载；
- **公开清单**：`packages/gui/public/games/manifest.json`，可生成、可校验。

插件示例：

```text
游戏 外部反应
  模块 外部
  脚本 "plugins/reaction.js"
  结果弦 重力
  胜利分数 30
```

## 快速开始

要求：Node.js **>= 22**、pnpm **11.22.0**。

```bash
pnpm install

pnpm check          # 内核类型检查 / 构建
pnpm check:gui      # GUI 类型检查
pnpm check:docs     # 文档相对链接检查
pnpm check:games    # 校验公开游戏清单
pnpm test           # 480 个单元测试

pnpm gui            # 调律台 GUI → http://127.0.0.1:5188/
pnpm test:gui       # 431 项真实浏览器验收（需要本机 Edge）
pnpm release        # 构建静态发布包 release/neurou/
```

生产预览与性能基线：

```bash
pnpm build
pnpm preview        # http://127.0.0.1:5189/
pnpm perf
```

## 架构

```text
packages/core       语言前端：词法 / 语法 / 语义 / 弦网络 IR / 谱 / 序列化 / 行级 patch
packages/runtime    运行时：逐拍状态机 / 快照 / 批量模拟 / 音准仪 / 谱求解器
packages/engine     独立 Engine 门面：Host 的唯一入口
packages/cli        命令行：check / sim / run / ir / fmt / init
packages/gui        Canvas 调律台 + 游戏平台 + 编辑器 + 主题
examples/           可运行世界（默认调律台 examples/tuner.nro）
docs/               语言、架构、调律台、游戏平台、发布与验收文档
```

## 一个世界长什么样

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

写回、编辑与调律手势详见 [八弦调律台](docs/07-八弦叠影.md)。

## 验收状态

| 项 | 当前结果 |
|---|---|
| 单元测试 | **480 / 480** |
| 真实浏览器验收 | **431 / 431** |
| 文档链接 | **209 条，全部存在（185 篇文档）** |
| 发布包 | **1.57.0 / 2 个世界** |
| 生产冒烟 | PASS |
| 生产世界冒烟 | PASS |
| 性能基线 | PASS（大世界 tick 吞吐约 3.6 万/秒） |

## 文档

- [总览](docs/00-总览.md)
- [语言规范 v0.1](docs/01-语言规范.md)
- [架构与路线](docs/02-架构.md)
- [编程范式：声明式 · 数据流 · 规则约束](docs/10-编程范式.md)
- [八弦调律台](docs/07-八弦叠影.md)
- [项目状态 v1.57](docs/37-项目状态-v2.18.md)
- [外部游戏插件加载器](docs/178-外部游戏插件加载器.md)
- [关卡 / 波次](docs/179-关卡波次.md)
- [游戏内参数编辑](docs/180-游戏内参数编辑.md)
- [每款游戏独立色板](docs/181-每款游戏独立色板.md)
- [主题预设](docs/182-主题预设.md)

## 这不是什么

- 不是「AI 生成游戏」——AI 只做状态解释器，不改规则。
- 不是通用引擎——物理、渲染、动画、网络同步都不在语言范围内。
- 不是脚本语言——它声明状态、阈值、回路与不变量，不写流程。
- 不是 100 分的世界——音准仪的绿区是 **60–85**，满分意味着没有意外。
- 不是完整编辑器——GUI 已能写回基线 / 阈值 / 耦合强度，并增删普通耦合与顶层弦；
  还不能增删规则、编辑回路、改极性 / 延迟。

## 贡献

欢迎 Issue 与 PR。提交前请运行：

```bash
pnpm check && pnpm check:gui && pnpm check:docs && pnpm check:games && pnpm test && pnpm build
```

详细约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开源协议

本项目以 [MIT License](LICENSE) 开源。

Copyright © 2026 ColFumice.
