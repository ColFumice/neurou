# 外部 Host SDK 示例（v6.20）

`examples/external-host/sdk.ts` 是一个不依赖 GUI 的宿主封装示例。

## 接口

```ts
const host = createExternalHost(source, 'world.nro', { seed: 7 });

host.description;  // Engine 摘要
host.ir;           // 世界 IR
host.observe();    // 当前帧
host.inject(...);  // 注入
host.dispatch(...);// 动作
host.step();       // 推进一拍
host.snapshot();   // HostSnapshot
host.restore(...); // JSON 或对象恢复
host.exportJSON(); // 可落盘快照
```

## 内部流程

```text
source → compileText → createEngine
→ observe / inject / dispatch / step
→ toHostSnapshot
→ isHostSnapshotCompatible + restoreHostSnapshot
```

## 示例

```bash
pnpm tsx examples/external-host/main.ts
```

输出包含：

- ABI / 世界名 / 版本；
- 端口 / 场景；
- 注入前后 values；
- 恢复后的 tick 与「色温」。

## 验证

- 单元 `packages/engine/test/external-sdk.test.ts`：
  - 驱动/观察；
  - 快照 JSON 恢复；
  - 错误 ABI 拒绝；
  - exportJSON。
- 示例实际运行 EXIT 0。

## 验收

- 单元 **412/412**；
- GUI **338/338**；
- 文档 336 链接 / 129 文档；
- release 18 世界。

## 边界

- SDK 是示例代码，不是 npm 包；
- 不包含后端渲染与 GUI；
- 只封装 Host 最小闭环。
