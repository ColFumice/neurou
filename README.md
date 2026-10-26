# neurou · 雨若

> 雨若弦，万物皆弦。

<img src="雨若logo.png" width="64" align="right" alt="雨若" />

neurou 是一门用来写「世界如何运转」的语言，以及执行这些世界的运行时。

它不是剧情编辑器，也不是通用游戏引擎。它更接近 **GLSL 之于图形、Faust 之于音频**：
创作者用一门领域语言声明规则，编译器检查它会不会散架，运行时让它逐拍活起来，
批量模拟告诉你这个世界是否值得发布。

```
.nro 源码 ──▶ 编译器 ──▶ 弦网络图（唯一真源） ──▶ 运行时 / 批量模拟 / 调律台
                 │
                 └─ 三级诊断：语法 · 语义 · 体验
```

**当前状态：v0.1 内核可用。** 语言前端、弦网络 IR、确定性运行时、三种玩家模型的批量模拟、
音准仪报告、命令行都已跑通；调律台 GUI 是下一步。

## 快速开始

```bash
pnpm install
pnpm check                     # 类型检查 / 构建
pnpm test                      # 31 个测试

# 检查一个世界
pnpm dev check examples/negotiation.nro

# 跑 600 局模拟，看音准仪
pnpm dev sim examples/negotiation.nro --runs 600

# 亲自进入这个世界，逐拍游玩
pnpm dev run examples/negotiation.nro

# 导出弦网络图
pnpm dev ir examples/rain-slice.nro --out world.json
```

两个示例世界：

| 文件 | 展示什么 |
|---|---|
| `examples/negotiation.nro` | 最小叙事沙盒：五根弦、两条回路、四条结局。信任与筹码互相消耗 |
| `examples/rain-slice.nro` | 首期品类切片：认知弦、关系弦、雨循环曲式、避难所与捕食 |

## 这不是什么

- 不是「AI 生成游戏」——AI 只做状态解释器，不改规则。
- 不是通用引擎——物理、渲染、动画、网络同步都不在语言范围内。
- 不是脚本语言——它声明状态、阈值、回路与不变量，不写流程。
- 不是 100 分的世界——音准仪的绿区是 **60–85**，满分意味着没有意外。

## 目录

```
packages/core       语言前端：词法 / 语法 / 名字解析 / 类型检查 / 结构分析 / 弦网络图
packages/runtime    运行时：逐拍状态机、快照分叉、批量模拟、音准仪
packages/cli        命令行：check / sim / run / ir / init
examples/           两个可运行的世界
docs/               总览、语言规范、架构
```

- [构想总览](docs/00-总览.md)
- [语言规范 v0.1](docs/01-语言规范.md)
- [架构与路线](docs/02-架构.md)
