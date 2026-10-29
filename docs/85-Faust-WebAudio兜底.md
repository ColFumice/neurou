# Faust WebAudio 兜底播放（v5.28）

> v5.8 只生成 Faust DSP 源码，不发声。v5.28 在预览里加一台
> **WebAudio 兜底声源**，让音频端口参数能试听；Faust 源码生成保持不变。

## 1. 明确边界

```text
音频端口 → Faust 源码（已有）
        → WebAudio 正弦兜底（v5.28，预览时）
```

- 这不是 Faust 编译器；
- 不使用 `faustwasm` / 外部服务；
- 音色是固定的低音量正弦，不是端口作者写的 DSP；
- 目的只是让参数联动可听，避免"只有源码没有现象"。

## 2. 映射

```ts
faustFallbackParams(values, volume):
  first = 第一个有限数值端口参数
  频率 = 110 + clamp(|first| / 100) * 220
  增益 = volume * 0.012
```

- 确定性映射，无随机；
- 音量继承调律台音量设置；
- 静音或音量为 0 时不启动；
- 关闭预览/切换世界/卸载时停止并关闭 AudioContext。

## 3. GUI

- 仅在 `Space` 预览打开且存在音频端口时启动；
- `data-faust-runtime="webaudio-fallback"`；
- `data-faust-audio`：`playing` / `suspended` / `unavailable` / `stopped`；
- 预览音频状态追加显示 WebAudio 状态。

## 4. 验收

- 单元 **361/361**：参数映射；
- GUI **277/277**：Faust 预览接线，状态实测 `playing`；
- 生产冒烟 / perf 通过。

## 5. 边界

- 无 Faust 编译、无真实 DSP；
- 只有一个正弦声源，无包络/滤波/复音；
- 浏览器自动播放策略可能使状态为 `suspended`；
- 不会替换 BGM/现有音频系统。
