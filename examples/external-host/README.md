# 外部 Host SDK 示例

展示宿主如何只依赖 `@neurou/core` 与 `@neurou/engine` 驱动世界。

## 运行

仓库根目录：

```bash
pnpm tsx examples/external-host/main.ts
```

## 使用

```ts
import { createExternalHost } from './sdk.js';

const host = createExternalHost(source, 'world.nro', { seed: 7 });
host.description;      // 世界摘要
host.observe();        // 当前帧
host.inject('信任', 80);
host.step();
const snapshot = host.snapshot();
host.restore(snapshot);
```

## 流程

```text
source → compile → Engine
→ observe / inject / dispatch / step
→ toHostSnapshot
→ restoreHostSnapshot
```

## 边界

- SDK 是示例，不是发布包；
- 不包含 GUI/后端渲染；
- 快照兼容性由 `isHostSnapshotCompatible` 校验。
