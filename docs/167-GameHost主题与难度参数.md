# GameHost 主题与难度参数（v1.42.0）

## 1. 统一主题 / HUD

新增 `packages/gui/src/gameTheme.ts`：

```ts
GameTheme {
  background, ink, dim, line, accent,
  titleFont, monoFont
}

paintGameBackdrop(ctx, width, height, vignette)
paintGameBoard(ctx, x, y, w, h)
drawGameChrome(ctx, width, height, {
  title, subtitle, keys, best, bestLabel
})
```

统一：

- 背景色；
- 暗角；
- 网格底板；
- 标题 / 副标题字体；
- 页脚键位；
- 最高分。

Pong 已完全使用主题；Tetris / Snake 复用背景与暗角，保留各自 HUD 指标。

## 2. 游戏 DSL 难度

新增字段：

```text
游戏 对拍
  模块 乒乓
  结果弦 步态
  胜利分数 300
  难度 4
```

编译期把难度限制在 1..5，序列化往返保留。

SDK：

```ts
interface GameParams {
  difficulty?: number;
}

GameSession.start(seed, { difficulty })
GameModule.create(seed, params)
```

具体模块：

| 游戏 | 难度效果 |
|---|---|
| 俄罗斯方块 | 重力更快 |
| 贪吃蛇 | 初始速度更快 |
| 乒乓 | AI 跟随速度更快 |

`examples/tuner.nro`：

```text
方块校准 难度 3
蛇行     难度 2
对拍     难度 4
```

## 3. GameHost 继续收敛

- GameHost 负责传 difficulty；
- 三个场景都只保留 commandFor + draw + overlay；
- 主题与 HUD 样式不再散落三份。

## 验收

- 单元测试保持 **461/461**；
- GUI **407/407**；
- 文档 **340 链接 / 170 文档**；
- release **1.42.0 / 2 世界**；
- 生产冒烟、世界冒烟、perf 通过。

## 当前边界

- 主题仍是固定深色一套，没有浅色/玩家主题；
- 难度仅影响速度和 AI，不影响关卡结构；
- 尚未做难度编辑 UI；
- 第四款游戏尚未加入（当前三款）。

## 下一步

1. 第四款游戏；
2. 难度编辑 UI；
3. 游戏内关卡参数；
4. 主题切换；
5. 统一快照版本迁移。
