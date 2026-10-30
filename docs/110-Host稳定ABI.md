# Host 稳定 ABI（v6.1）

Host 只通过 `@neurou/engine` 读取/驱动世界，不直接改 Universe。

## ABI 标识

```ts
import { HOST_ABI } from '@neurou/engine';
// 'neurou-host/1'
```

`Engine.describe().abi` 与 `toHostSnapshot().abi` 都带这个标识。

## HostSnapshot

```ts
interface HostSnapshot {
  abi: 'neurou-host/1';
  description: EngineDescription;
  values: Record<string, RuntimeValue>;
  state: WorldState;
}
```

```ts
const snapshot = engine.toHostSnapshot();
const json = JSON.stringify(snapshot);
```

字段承诺：

| 字段 | 稳定性 |
|---|---|
| `abi` | v1 内不变 |
| `description.name/version/tick/scenes/systems/ports` | 稳定 |
| `values` | 键 = 弦 id，值 = number/boolean/string/array |
| `state` | 快照用；跨版本可能新增字段 |

## 外部示例

```bash
pnpm tsx examples/external-host/main.ts
```

输出：

- ABI 标识；
- 世界名/版本；
- 注入前后两帧 values；
- scenes / ports。

该示例只 import `@neurou/core`、`@neurou/engine`，不依赖 GUI。

## 边界

- ABI v1 只承诺读/驱动，不承诺 IR JSON 结构；
- `state` 不承诺跨大版本恢复；
- 破坏性变更需提升 `neurou-host/2` 并提供迁移。
