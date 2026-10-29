# 独立 `@neurou/engine` 包（v5.13）

> v5.2 的 Engine 门面原本住在 `@neurou/runtime` 里。v5.13 把它拆成独立包：
> runtime 只负责 Universe/执行，Host 只依赖 Engine。

## 1. 包边界

```text
@neurou/core      语言 + IR
@neurou/runtime   Universe、tick、simulate、report；不依赖 Engine
@neurou/engine    Engine facade、SceneFrame、BackendAdapter 契约
@neurou/cli       Host：CLI
@neurou/gui       Host：调律台 / 预览 / 编辑
```

依赖方向：

```text
cli  → engine → runtime → core
gui  → engine → runtime → core
```

- `runtime` 不再导出 `Engine`/`BackendAdapter`；
- GUI/CLI 从 `@neurou/engine` 导入 `Engine/createEngine`；
- Engine 仍通过 `Universe` 执行，不复制运行时；
- GUI 的 `glslBackend`/`faustBackend` 只依赖 Engine 的端口契约。

## 2. 验收

- 单元 **343/343**：Engine 测试迁移到 `packages/engine/test`，行为不回归；
- GUI 273（下一步回归）；
- workspace 新增 `packages/engine`，根 tsconfig/CLI tsconfig 引用；
- `check` / `test` / `check:gui` / 构建通过。

## 3. 边界

- 包名仍是 private workspace 包，没有发布 npm；
- `SceneFrame`/`BackendAdapter` API 未冻结；
- 没有 engine 独立版本号/CHANGELOG；
- GUI 仍直接依赖 runtime 类型（EmittedCue/WorldState）；
- 没有跨包循环依赖检查脚本。
