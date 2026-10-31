# Game SDK v1：统一会话、模块注册、多游戏选择（v1.35.0）

## 目标

把俄罗斯方块里已经验证过的实时能力抽成可复用宿主契约，而不是每做一款游戏重写一套循环。

## 新增 `gameSdk.ts`

### GameModule

```ts
interface GameModule<TState, TCommand> {
  id: string;
  title: { zh: string; en: string };
  create(seed: number): TState;
  step(state: TState, command: TCommand | undefined, fixedMs: number): void;
  score(state): number;
  lines(state): number;
  level(state): number;
  isOver(state): boolean;
}
```

游戏模块只负责：

- 新局状态；
- 每个固定步；
- 分数/行数/等级/结束。

不负责：

- 调度；
- 输入队列；
- 暂停；
- 结果回传；
- 快照。

### GameSession

```ts
new GameSession(module, seed)
  .start(seed)
  .input(command)
  .advance(deltaMs)
  .pause() / .resume() / .togglePause()
  .finish(reason) // 只回传一次
  .snapshot()
```

GameSession 统一：

- 60Hz FixedStepLoop；
- 输入队列；
- 暂停/恢复；
- 结果只触发一次；
- tick/pending/paused 快照。

### 俄罗斯方块模块

```ts
TETRIS_MODULE: GameModule<TetrisModuleState, TetrisAction>
```

状态：

```ts
{
  engine: TetrisEngine;
  gravityAccumulator: number;
}
```

TetrisScene 现在只做：

- 键盘映射；
- Canvas 渲染；
- 覆盖层；
- 调用 GameSession。

不再自己维护 loop / 输入队列 / 结果去重。

## 模块注册表

```ts
GAME_MODULES = [
  { id: 'tetris', moduleName: '俄罗斯方块', title: ... }
]
```

`gameModuleForName()` 用于校验世界里的：

```text
游戏 X
  模块 俄罗斯方块
```

## 多游戏选择

```ts
selectGameForFocus(games, focus)
```

优先级：

1. 结果弦正好是当前弦（resultStringId）；
2. 结果弦名字匹配当前弦名；
3. 回退世界里的第一个游戏。

这为下一步多游戏注册做好了基础。

## 验收

核心单元新增 4 项：

```text
GameSession 开始/输入/推进/结果只回传一次
暂停不推进、快照包含 paused/queue
模块注册表按名字/ID 查询
多游戏按结果弦精确匹配、最后回退第一个
```

GUI 保持：

```text
F6 从世界启动绑定游戏
游戏结果写回世界弦
游戏结果提示带弦名
```

## 验收数字

- 单元 **448/448**；
- GUI **398/398**；
- 文档 **339 链接 / 163 文档**；
- release **1.35.0 / 2 世界**；
- 生产冒烟、世界冒烟、perf 通过。

## 当前边界

- 仍只有俄罗斯方块一个模块；
- 渲染未抽象成 Renderer 接口；
- 游戏快照还没有进入世界统一存档；
- 多游戏选择目前只用于 F6 启动，没有游戏切换 UI。

## 下一步

1. 增加第二款游戏模块，验证 GameModule 复用；
2. 抽 Renderer/InputProfile 接口；
3. 世界统一存档包含游戏会话快照；
4. 游戏结果触发结局/信号；
5. 游戏选择 UI 与多游戏世界。
