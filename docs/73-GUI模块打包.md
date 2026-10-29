# GUI 模块打包（v5.16）

> v5.15 的模块依赖图属于 CLI；v5.16 让浏览器端也能打开多文件世界。
> 模块世界在 GUI 中是**只读**的：可以运行/预览/观察依赖，但不会写回任何文件。

## 1. 构建期打包

```ts
import.meta.glob('../../../examples/**/*.nro', { eager: true, query: '?raw' })
```

- 顶层文件仍作为世界选择项；
- 嵌套文件（如 `examples/modules/rain.nro`）只作为模块；
- 构建时把所有 raw 源码内联，生产包不依赖文件系统。

## 2. 入口编译

入口含 `引入` 时：

```ts
compileProjectFromFiles(WORLD_FILE, {
  ...BUNDLED_PROJECT,
  [WORLD_FILE]: source,
});
```

- 模块解析沿用 v5.9 的相对路径规则；
- 入口编辑仍在内存中生效；
- 模块源码是构建期快照，dev 下不热读嵌套文件。

## 3. 只读边界

模块世界：

- `data-project="true"`；
- `data-project-modules="examples/modules/rain.nro,examples/modular.nro"`；
- `doSave` / `scheduleSave` 直接置 `disabled`，不 PATCH 入口；
- 本地运行存档/续档仍可用；
- 结构编辑只在内存中，刷新回到文件基线。

## 4. 现象层依赖

Space 预览蒙版的左下角淡显示模块路径：

```text
modules/rain.nro
modular.nro
```

`[data-testid="preview-modules"]`，只读、不拦截指针。

## 5. 示例

新增：

- `examples/modular.nro`：入口，`引入 "modules/rain.nro"`，动作/结局；
- `examples/modules/rain.nro`：`命名空间 雨` + 导出 `雨量`。

## 6. 验收

- 单元 **345/345**：示例编译测试支持 `引入`（15 项）；
- GUI **276/276**：新增
  - 模块世界标记为项目；
  - 依赖可观测；
  - 现象层显示两条模块路径。
- 生产 release 世界数 **14**。

## 7. 边界

- 模块世界只读，不能从 GUI 编辑模块源；
- dev 下模块源码不热读，刷新才更新；
- 没有模块文件选择器/图形化依赖图；
- 浏览器端不做循环/缺失模块的交互诊断，只由编译结果显示；
- 世界选择仍只列顶层入口。
