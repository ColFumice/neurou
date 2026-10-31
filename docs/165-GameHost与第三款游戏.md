# Renderer / InputProfile 与第三款游戏（v1.40.0）

## 阶段 3：通用 GameHost

新增 `packages/gui/src/GameHost.tsx`。

GameHost 统一负责：

- Canvas 尺寸 / DPR / resize；
- GameSession 60Hz；
- 输入事件到 HostInput 的消费；
- 开始 / 暂停 / 继续 / 重开 / 退出；
- 结果回传与存档；
- 暂停菜单（继续 / 换游戏 / 回世界）；
- 通用覆盖层；
- 调试 API。

新游戏只需要提供：

```ts
GameModule      // 规则
commandFor      // InputProfile
draw(ctx, ...)  // Renderer
overlay         // 文案
```

不再重复写调度、输入队列、暂停、结果、存档。

## 阶段 5：第三款游戏 · 乒乓

新增：

```text
packages/gui/src/pongEngine.ts
packages/gui/src/PongScene.tsx
```

### 规则

- 120×70 场地；
- 玩家球拍 / AI 球拍；
- 球反弹、加速、角度；
- 先到 5 分结束；
- 确定性 PRNG；
- 序列化/恢复。

### 场景

`PongScene` 只做：

```tsx
<GameHost
  module={PONG_MODULE}
  commandFor={commandFor}
  draw={drawPong}
  overlay={...}
/>
```

没有自己的 rAF、输入队列、暂停、结果、存档代码。

### DSL 注册

`GAME_MODULES` 现在包含：

```text
俄罗斯方块
贪吃蛇
乒乓
```

`examples/tuner.nro` 新增：

```text
游戏 对拍
  模块 乒乓
  结果弦 步态
  胜利分数 300
  描述 "方向键移动球拍，得分写回步态弦"
```

## GameHost 带来的复用

| 能力 | 旧场景手写 | 新 GameHost |
|---|---|---|
| 60Hz 循环 | ✓ | ✓ 统一 |
| 输入队列 | ✓ | ✓ 统一 |
| 暂停菜单 | 各写 | ✓ 统一 |
| 结果回传 | 各写 | ✓ 统一 |
| 存档/恢复 | 各写 | ✓ 统一 |
| Canvas/DPR | 各写 | ✓ 统一 |
| 调试 API | 各写 | ✓ 统一 |

新游戏代码量：

```text
规则模块 ~150 行
绘制函数 ~100 行
场景包装 ~60 行
```

## 验收

新增单元：

```text
乒乓初始状态
球拍移动与边界
触顶反弹
AI 达到 5 分结束
存档序列化/恢复
```

新增 GUI：

```text
选择层启动第三款游戏
乒乓结果写回步态
```

原有：

```text
再次进入恢复上一局
暂停菜单出现
暂停菜单换游戏打开选择层
Shift+F6 打开多游戏选择
```

## 验收数字

- 单元 **461/461**；
- GUI **407/407**；
- 文档 **339 链接 / 168 文档**；
- release **1.40.0 / 2 世界**；
- 生产冒烟、世界冒烟、perf 通过。

## 当前边界

- TetrisScene / SnakeScene 仍是旧宿主，尚未迁移到 GameHost；
- GameHost 只覆盖实时 Canvas 游戏；
- 游戏会话存档按世界/弦单独存，还没有和叙事快照合并；
- 游戏结果仍只写回弦/动作/结局/信号；
- 没有 GameHost 的主题系统。

## 下一步

1. 迁移 TetrisScene / SnakeScene 到 GameHost；
2. 合并叙事存档 + 游戏存档为一个世界快照；
3. GameHost 主题与统一 HUD；
4. 第四款游戏或者游戏内关卡参数；
5. 游戏 DSL 支持每局参数/难度。
