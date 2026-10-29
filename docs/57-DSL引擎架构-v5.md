# DSL 引擎架构 v5：弦网络是唯一本体，场景/系统是运行层

> 这份文档是 v5.0 的架构基线，不是新功能清单。
> 先冻结“引擎是什么”，再决定“下一行代码写哪里”。
> 依据是早期总览里的定位：**neurou 是编辑器/调律台，不是游戏**；
> 四视图、现象层、结构层、力迫层、总谱都是同一个宇宙的观察姿态。
> 见 [构想总览](00-总览.md)、[架构](02-架构.md)、[最小 GUI](03-最小GUI.md)、[编程范式](10-编程范式.md)。

## 0. 一句话结论

```text
弦网络 = 世界的本体（唯一真源）
场景   = 运行时状态作用域（不是世界本体）
系统   = 运行时调度单元（不是新弦类型）
宿主   = 观察/编辑/预览的容器（GUI 只是其中一个）
```

v4.x 的章节、存档、路线图、示例游戏都保留为**宿主层能力**；
它们不再决定 DSL 的演进，也不允许反向污染 IR 本体。

## 1. 为什么是 A，而不是 ECS/组件化

- 现有语言最独特的部分是“弦 + 耦合 + 回路 + 阈值 + 力迫 + 音准仪”，
  它描述的是**关系与张力**，不是“对象与组件”；
- 现有 14 个示例、编译器、运行时、参考谱、模拟器都建立在这套本体上；
- 如果切到 ECS，等于重写整个引擎，且丢掉“调律台”这个产品隐喻；
- 场景/系统足够表达“关卡/关卡内阶段/预览切换”，不需要把世界拆成组件。

结论：**弦网络继续是唯一本体；增长点放在运行层与宿主层。**

## 2. 五层架构（从下到上）

```text
① Language    .nro 文本 / AST / 诊断
② Graph       WorldIR：弦、耦合、回路、规则、谱、关系谱、场景、系统
③ Engine      SceneRuntime + TickPipeline + Universe + 观测帧
④ Host        editor / preview / CLI / service / player
⑤ Views       调律台 / 现象层 / 结构层 / 力迫层 / 总谱
```

严格边界：

- Engine 不 import GUI、不访问 DOM/Audio、不读写 localStorage；
- Graph 不包含“当前第几拍/当前场景”等运行时状态；
- Host 不直接改 `WorldState`，只通过 Engine API；
- Views 是 Host 的投影，不拥有自己的第二套模拟。

## 3. DSL 运行层原语（v5.1 提案）

### 3.1 场景 `场景`

场景是**运行时的状态作用域**，不复制弦定义。

```nro
场景 雨夜
  启用 系统 潮汐
  启用 系统 呼吸
  进入
    潮位 += 5
  离开
    灯影 -= 2
```

约束：

- 弦、耦合、谱仍是世界级唯一本体；
- 场景只选择/启用/禁用运行层系统；
- 进入/离开是效果列表，不改写作者结构；
- 世界至少有一个默认场景；未声明时使用隐式场景。

### 3.2 系统 `系统`

系统是**调度单元**，不是新弦，也不是新实体。

```nro
系统 潮汐
  阶段 传导
  每拍
  当 潮位 >= 30
  效果
    航向 -= 1
```

- `阶段`：`投递 / 输入 / 规则 / 传导 / 校验 / 终止 / 观测 / 收尾`；
- 多个系统在同阶段按声明顺序/优先级稳定排序；
- 系统可以有 `当`、`效果`、`每拍`、`冷却`；
- 现有力迫/和弦/动作/信号是默认系统管线里的规则，不是被删掉。

### 3.3 场景切换

推荐由规则效果/系统效果触发：

```nro
效果
  切换场景 雾港
```

过渡本身属于 Host（淡入/蒙版），Engine 只发 `sceneChanged` 帧事件。

## 4. TickPipeline：把固定顺序显式化

当前 `Universe.tick()` 的顺序是硬编码的：

```text
投递耦合 → 执行动作 → 力迫/和弦 → 传导 → 校验公理
→ 判定结局 → 信号上升沿 → 阈值穿越 → 曲式 → tick+1
```

v5.1 改成显式阶段表，**默认阶段和现有顺序完全一致**，以保证所有旧测试不回归：

```ts
const DEFAULT_PIPELINE = [
  '投递', '输入', '规则', '传导', '校验', '终止', '观测', '收尾'
] as const;
```

每个阶段：

- 有稳定的系统列表；
- 系统按 `(phase, order, id)` 排序；
- 系统可以产生新事件，但不能在同阶段递归执行（保持确定性）；
- 引擎只暴露 `step()`，Host 不手动调各阶段。

## 5. SceneRuntime：场景运行

```ts
interface SceneFrame {
  scene: string;
  tick: number;
  values: Record<string, Value>;
  cues: EmittedCue[];
  activeSystems: string[];
  ended: EndingRef | null;
}
```

- `SceneRuntime` 持有当前场景、启用系统集合、进入/离开效果；
- 场景切换在当前 tick 的 `收尾` 阶段生效，下一 tick 用新系统集；
- 世界本体（IR）不变；`WorldState` 可快照，场景也随快照保存；
- 旧存档缺场景时回退默认场景。

## 6. Engine API（Host 唯一入口）

计划在 `@neurou/runtime` 之上提供稳定 facade（暂名 `Engine`）：

```ts
createEngine(ir, options)
engine.start(sceneId?)
engine.step()
engine.dispatch(actionId)
engine.transition(sceneId)
engine.snapshot() / engine.restore(s)
engine.observe(): SceneFrame
engine.subscribe(listener)
```

- **不会**让 Host 直接拿 `Universe` 改内部状态；
- CLI/GUI/未来 player 全部只依赖这一层；
- `observe()` 产生纯数据帧，渲染由 Host 负责。

## 7. 实时预览与蒙版叠加

这是 Host 层的协议，不是 DSL 语法。

```text
编辑器画布（默认）
   ↑ 同一屏
现象层蒙版（Space）
   = Engine.observe() 的视觉投影
```

要求：

1. 预览**复用同一个 Engine 实例**，不启动第二套模拟；
2. 蒙版是 Host 的全屏叠加层；默认仍能看见/操作底下的编辑器；
3. 蒙版可配置：
   - `opacity` / `grayscale` / `mask shape`；
   - 是否拦截指针；
   - 是否只显示某个场景的 frame；
4. 编辑与预览同时进行：
   - 编辑产生新 IR 时，Engine 尝试 **hot swap**：
     - 结构兼容 → 保留 tick/状态，替换 IR；
     - 结构不兼容 → 冻结一帧，重建 Engine，再恢复可见状态；
   - 预览显示“重建中”只能用帧数据（不弹窗、不面板）；
5. Space 的语义按旧四视图：默认编辑器 ↔ 现象层蒙版；
6. 预览层永远不写回、不拥有独立存档。

## 8. 包边界（长期）

```text
@neurou/core          语言 + IR（无运行时）
@neurou/runtime       当前 Universe/tick/simulate/report（将收敛为 Engine 内核）
@neurou/engine        Engine facade + SceneRuntime + TickPipeline
@neurou/cli           Host：终端
@neurou/gui           Host：调律台 + 现象蒙版 + 四视图
@neurou/language-service  未来的解析/诊断/模拟服务
```

短期可以先在 `runtime` 内做 `SceneRuntime`/`TickPipeline`，稳定后再抽 `engine` 包；
但 **GUI 不再直接依赖 Universe**。

## 9. 与旧架构叙述的对齐

| 旧叙述 | 本方案 |
|---|---|
| 图是唯一真源，文本是投影 | 仍是 `WorldIR` 唯一真源 |
| 调律台不是窗口，是同一宇宙的观察姿态 | Host 四视图只消费 Engine 帧 |
| 现象层是运行中的世界，是观察/试玩入口 | 现象层 = 全屏蒙版 PreviewHost |
| 结构层/力迫层/总谱 | 保持为 View 投影，不拥有模拟 |
| 前端极简、后端极繁 | 复杂性收敛到 Engine/Scene/System，UI 不再堆功能 |
| 演奏者/作曲家/制琴师 | 运行层原语服务于作曲家；制琴师接口后置 |
| 不锁知识，锁运行时 | Scene/System/Host 的实现留在引擎侧 |

## 10. 迁移计划

- **v5.0（本文件）**：冻结边界，停止新增游戏层功能；
- **v5.1**：IR 增加 `scenes`/`systems`；`TickPipeline` 显式化；默认行为与旧测试一致；
- **v5.2**：`Engine` facade；CLI 改用 facade；
- **v5.3**：场景切换 DSL（初始场景、切换场景、收尾生效）；
- **v5.4**：GUI 改为 Host：调律台 + Space 现象层蒙版（已完成；结构编辑仍是重建 Engine，真正保 tick 热替换后置）；
- **v5.5**：保 tick 热替换（已完成）；模块/命名空间/用户函数（语言层，不与场景混在一起）；
- **v5.12**：全声明命名空间（已完成：限定名 + 点号解析；导出表/私有性后置）；

## 11. 后端 DSL 适配层（GLSL / Faust，v5.6+）

GLSL 与 Faust 是**后端/宿主侧的编译目标**，不是弦网络本体的新弦类型。
它们不应该迫使 `WorldIR` 变成一个着色器图或音频图；否则又会回到“表现层反向污染本体”。

拟定的边界：

```text
WorldIR（弦/耦合/场景/系统）
   │ 发出类型化端口：
   │   视觉端口：uniforms / 纹理 / pass
   │   音频端口：参数 / 事件 / 采样
   ▼
BackendAdapter（Host 注入）
   ├─ GLSLBackend：源码/SPIR-V/WebGL2 编译，端口映射
   └─ FaustBackend：dsp 编译，参数/事件映射
```

原则：

1. **端口先于代码**：DSL 只声明“这里有一个视觉/音频端口”，不把着色器或 dsp 源码写进弦定义；
2. **后端是 Host 服务**：Engine 不 import WebGL/音频编译器，也不依赖网络；
3. **编译失败是体验级诊断**：GLSL/Faust 的编译日志映射回端口位置，而不是 engine 崩溃；
4. **确定性不被后端破坏**：视觉/音频后端只读端口，不写回 `WorldState`；
5. **资产可导出**：原始 GLSL/Faust 源码、端口映射和编译产物都属于可导出素材；
6. **版本隔离**：后端目标版本（GLSL ES 3.0 / Faust 2.x）由 Host 声明，IR 只保存端口契约。

未来的 DSL 表面可能是：

```nro
视觉端口 雨幕
  类型 片元
  参数 强度: 数值
  绑定 系统 雨幕

音频端口 潮声
  类型 dsp
  参数 潮位: 数值
  绑定 系统 潮汐
```

但这些声明仍然是**运行层端口**，不是新的世界本体。GLSL/Faust 源码作为资产放在 Host 侧，
通过端口 id 引用；Engine 只验端口名/类型/方向。

## 12. 明确暂缓（防止再偏离）

在 v5.1 完成前，不再：

- 新增示例世界/关卡内容；
- 在 GUI 里加章节、存档槽、路线图、结局选择等游戏功能；
- 把任何“表现层状态”塞进 `WorldIR`；
- 用 GUI 手势需求反向定义 DSL 语法。

## 13. 待确认的开放点

1. `场景` 是否允许声明**场景局部弦**？本方案选择“不允许，弦仍是世界级”；
2. `系统` 是否允许 `每 N 拍`/`当`/效果之外的系统级状态？建议先只做调度与效果；
3. 预览蒙版的默认观感：全屏灰阶蒙版 / 半透明纸感 / 仅边缘；
4. `Engine` 是否用现有 `Universe` 改名，还是保持 `Universe` 作为内部内核、`Engine` 作为 facade。

这些确认后再进入 v5.1 的 IR/运行时改造。
