# 场景迁移 GameHost 与统一世界存档（v1.41.0）

## 1. 旧场景迁移到 GameHost

- `TetrisScene` 现在只保留：
  - 键位映射；
  - `drawTetris`；
  - 覆盖层文案。
- `SnakeScene` 现在只保留：
  - 键位映射；
  - `drawSnake`；
  - 覆盖层文案。

两者都不再自己维护：

- rAF / 60Hz；
- 输入队列；
- 暂停菜单；
- 结果回传；
- 存档/恢复；
- Canvas/DPR；
- 调试 API。

统一由 `GameHost` 负责。

同时 GameHost 增加：

```ts
debugSnapshot?: (state) => unknown
```

保证旧 GUI 验收 API 兼容：

```ts
window.__neurouTetris.snapshot().active.x
```

## 2. 游戏存档并入世界存档

`RunSave` 新增：

```ts
games?: Record<string, unknown>
```

- 自动叙事存档每 4s / pagehide 时收集：
  - `neurou.game.snapshot:<world>:<弦>:<模块>`；
  - 写入 `RunSave.games`。
- 世界恢复时：
  - 先恢复 `WorldState`；
  - 再 `restoreGameSaves` 把游戏快照写回 localStorage；
  - F6 进入游戏时可继续。
- 游戏结果保存时也会立即回写当前 RunSave，不必等下一次 4s 自动存档。

## 3. 当前结构

```text
RunSave {
  world state,
  tick,
  ended,
  games: {
    "<弦>:<模块>": GameSave
  }
}
```

## 验收

GUI 保持：

```text
再次进入恢复上一局
恢复的方块位置一致
暂停菜单出现
暂停菜单换游戏打开选择层
选择层启动第三款游戏
乒乓结果写回步态
```

单元/GUI 数字保持。

## 验收数字

- 单元 **461/461**；
- GUI **407/407**；
- 文档 **339 链接 / 169 文档**；
- release **1.41.0 / 2 世界**；
- 生产冒烟、世界冒烟、perf 通过。

## 剩余平台化

- GameHost 主题/HUD 统一；
- 游戏 DSL 难度/关卡参数；
- 第四款游戏；
- 叙事/游戏统一快照版本号与迁移；
- 游戏内关卡参数编辑。

## 下一步

1. GameHost 主题 token；
2. 难度参数；
3. 第四款游戏；
4. 统一 HUD；
5. 游戏 DSL 参数校验。
