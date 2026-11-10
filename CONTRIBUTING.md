# 贡献指南

感谢你对 neurou 的兴趣。

## 开发环境

- Node.js >= 22
- pnpm 11.22.0

```bash
pnpm install
pnpm check
pnpm check:gui
pnpm check:docs
pnpm check:games
pnpm test
pnpm build
```

GUI 验收需要本机 Edge：

```bash
pnpm gui
pnpm test:gui
```

## 提交前

请确保以下命令全部通过：

```bash
pnpm check && pnpm check:gui && pnpm check:docs && pnpm check:games && pnpm test && pnpm build
```

涉及游戏清单的改动，请同时运行：

```bash
pnpm manifest:games
pnpm check:games
```

## 代码约定

- TypeScript strict；
- 新游戏优先实现 `GameModule` + `commandFor` + `draw`，由 `GameHost` 承载；
- 新 DSL 字段必须同时更新 AST / IR / parser / compiler / serializer / 测试；
- 文档改动必须保持相对链接有效（`pnpm check:docs`）；
- 不提交 `node_modules/`、`dist/`、`release/`、`artifacts/`。

## Issue / PR

- 描述复现步骤、期望行为、实际行为；
- 新功能请先开 Issue 讨论 DSL 与运行时边界；
- PR 尽量单一主题，并附上验收命令结果。
