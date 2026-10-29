# Engine facade v5.2：Host 的唯一入口

> v5.1 把场景/系统放进了运行时；v5.2 把“Host 如何驱动它”收成一个门面。
> Host 不再直接拿 `Universe` 改状态；预览、CLI、未来 player 共用一套语义。

## 1. API

```ts
const engine = createEngine(ir, { seed: 1 });

engine.sceneName;
engine.activeSystems();
engine.availableActions();

engine.dispatch(actionId);     // 选择动作，下一拍结算
engine.step();                 // 推进一拍，广播帧
engine.transitionScene('昼');  // 切换场景
engine.snapshot();
engine.restore(state);

const frame = engine.observe();
const off = engine.subscribe((frame) => { ... });
off();
```

`SceneFrame`：

```ts
{
  scene?: string;
  tick: number;
  phase?: string;
  values: Record<string, RuntimeValue>;
  cues: EmittedCue[];
  activeSystems: string[];
  ended: { id; name; tick } | null;
}
```

- `observe()` 产生纯数据，渲染/音频由 Host 决定；
- `subscribe` 在 `step`、`transitionScene`、`restore` 后广播；
- `step` 仍返回 `TickResult`，方便 CLI 继续用已有 cue 逻辑；
- 门面不覆盖 `Universe` 内部能力；`Universe` 仍是内核。

## 2. CLI 已迁移

`neurou run` 现在使用 `createEngine`：

- 场景名进入拍头显示；
- 选择动作走 `engine.dispatch`；
- 推进走 `engine.step`；
- 不再直接 `new Universe`。

## 3. 还没做

- GUI 仍直接持有 `Universe`（v5.3 迁移为 Host）；
- 没有预览蒙版 / hot swap；
- 没有多 scenes 的 GUI 切换入口；
- `Engine` 还在 `@neurou/runtime` 包内，未拆独立 `@neurou/engine`；
- GLSL/Faust 后端适配尚未接入门面（v5.6+）。

## 4. 验收

- 单元 **325/325**：新增
  - facade step/observe/subscribe/unsubscribe；
  - facade 场景切换 + 快照恢复。
- 既有 CLI / 运行时 / GUI 行为不回归；
- `check` / `test` / `check:docs` 通过。

## 5. 边界

- 门面不是新模拟器；它只是 `Universe` 的稳定外表面；
- 不把渲染、音频、DOM、localStorage 拉进 runtime；
- 不承诺 API 已冻结到 1.0；v5.3 迁 GUI 时可能微调；
- 预览蒙版仍属于 Host 层协议。
