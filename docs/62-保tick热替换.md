# 保 tick 热替换（v5.5）

> v5.4 的预览蒙版已经和编辑器同屏，但结构编辑会重建 Engine，tick 归零。
> v5.5 让结构编辑走 `Engine.replaceWorld(ir)`：同一 Engine、同一 tick、同一预览。

## 1. 语义

```ts
engine.replaceWorld(newIR);
```

- **保留**：tick、当前值、pending 耦合、RNG、场景、谱/矩阵状态；
- **保留**：仍存在的弦的值；
- **新增**：新弦取自己的基线；
- **裁掉**：已消失弦的值、已消失谱/矩阵的状态、失效的 pending；
- **结局**：旧结局在新 IR 中不存在时清空；
- **场景**：当前场景不存在时回退第一个场景；
- **不重放**：场景进入效果不会因热替换重新执行；
- **统计**：Engine 内部计数随新 Universe 重建（不是世界状态）。

## 2. GUI

`rebuildUniverse` 不再 `createEngine`，改成：

```ts
universe.replaceWorld(ir);
```

因此：

- Alt+Enter/Alt+Backspace 增删弦时，画面、tick、预览蒙版都不断；
- 预览中的拍数继续走，不会跳回 0；
- 编辑器与现象层可以长期同屏。

## 3. 边界

- 不是“迁移整个 Engine 实例”：内部仍新建 Universe，再把状态恢复进去；对 Host 透明；
- 结构兼容性只做弦 id 级别；类型改变时保留旧值可能被运行时夹取/转换；
- 规则 fired/cooldown 以原样保留，名字重新解析后可能语义漂移；
- 没有规则/场景级别的迁移诊断；复杂编辑仍可能产生不直观状态；
- 真正拆分 `@neurou/engine` 包仍未做。

## 4. 验收

- 单元 **329/329**：新增
  - `replaceWorld` 保 tick；
  - 旧值保留；
  - 新弦基线；
  - 场景保留。
- GUI **264/264**：Alt+Enter/Alt+Backspace 增删弦不回归；
- `check` / `test` / `check:docs` / 生产冒烟通过。
