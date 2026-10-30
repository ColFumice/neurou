# Host 快照恢复（v6.5）

## 1. 快照结构

```ts
interface HostSnapshot {
  abi: 'neurou-host/1';
  stateVersion: 1;
  description: EngineDescription;
  values: Record<string, RuntimeValue>;
  state: WorldState;
}
```

## 2. 恢复

```ts
const snapshot = JSON.parse(text) as HostSnapshot;
const engine = createEngine(ir);
const ok = engine.restoreHostSnapshot(snapshot);
```

- 校验 `abi === 'neurou-host/1'`；
- 校验 `stateVersion === 1`；
- 成功后恢复 tick / scene / values / 冷却 / 延迟耦合；
- 失败返回 `false`，不修改当前状态。

## 3. 外部示例

`examples/external-host/main.ts` 现在还会：

- 在另一台 Engine 上恢复快照；
- 输出恢复后的 tick 与「视觉.色温」；
- 验证 ABI/stateVersion 拒绝不匹配快照。

## 4. 验收

- 单元：快照 JSON roundtrip、恢复后 tick/values 一致、错误 ABI 拒绝；
- 外部示例可运行；
- 单元 **391/391**，GUI **319/319**。

## 5. 边界

- 只支持同一 ABI 的 stateVersion 1；
- 不承诺跨大版本状态迁移；
- `description` 不参与恢复校验（只恢复 state）。
