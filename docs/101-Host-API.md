# Host API 定稿（v1.0）

Host（GUI / CLI / 播放器 / 外部集成）只依赖 `@neurou/engine`。

## 1. 编译

```ts
import { compileText, compileProject } from '@neurou/core';

const compiled = compileText(source, 'world.nro');
if (!compiled.ok) {
  for (const diagnostic of compiled.diagnostics.errors) {
    console.error(diagnostic.code, diagnostic.message);
  }
}
```

多文件使用 `compileProject(entry, readFile)`。

## 2. 创建 Engine

```ts
import { createEngine } from '@neurou/engine';

const engine = createEngine(compiled.ir, { seed: 1 });
```

## 3. 只读摘要

```ts
engine.describe();
```

包含：`name / version / tick / phase / scene / ended / endedName /
scenes / systems / activeSystems / ports / strings / audioAssets /
textureAssets / functions`。

## 4. 驱动与观察

```ts
const result = engine.step();   // 推进一拍
const frame = engine.observe(); // 当前帧（值 / cues / 端口 / 结局）
```

- `step()` 不直接发声/绘制；
- Host 根据 cues 与 ports 驱动后端；
- 确定性：同 seed + 同输入序列 → 同状态。

## 5. 输入与动作

```ts
engine.inject('叙事.能量', 42);
engine.dispatch('action:推进');
```

## 6. 快照 / 回放

```ts
const state = engine.snapshot();
engine.restore(state);
```

## 7. 场景 / 矩阵

```ts
engine.scenes();
engine.transitionScene('夜');
engine.getMatrixCell('关系谱', '行', '列');
```

## 8. 订阅

```ts
const off = engine.subscribe((frame) => {
  // 每拍后回调
});
off();
```

## 9. 边界

- `describe()` 不替代 `observe()`；
- `ir` 可读但不承诺 ABI 冻结；
- 错误码集合见诊断文档；
- 后端接口由 `BackendAdapter` 描述，不在 Engine 内实现。

## 10. 示例

```bash
pnpm tsx examples/host-api.ts
```
