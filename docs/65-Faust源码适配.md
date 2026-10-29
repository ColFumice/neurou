# Faust 源码适配层（v5.8）

> 与 GLSL 不同，Faust 没有可直接嵌进浏览器的官方编译服务。
> v5.8 **不假装有 Faust 编译器**：只把音频端口生成为合法 Faust DSP 源码，
> 交给未来的 Host 编译服务；现在只做源码/参数映射与状态诊断。

## 1. 链路

```text
音频端口
  → IRPort.params（弦 id）
  → Engine.observe().ports（当拍值）
  → Host 的 FaustBackend：生成 .dsp 源码
  → 未来：Faust 编译器 / AudioWorklet
```

## 2. 生成示例

```faust
declare name "neurou:潮声";
import("stdfaust.lib");
p0 = hslider("p0", 0.0, 0.0, 1.0, 0.001);
process = no.noise * (p0 * 0.08);
```

- 参数名映射为 `p0/p1/...` 控件，避免中文标识符；
- 只生成源码，不编译、不发声；
- 真正音频线程属于 Host；
- 端口读取仍来自 `Engine.observe().ports`。

## 3. Host 状态

| 属性 | 含义 |
|---|---|
| `data-faust-ports` | 音频端口数 |
| `data-faust-status` | `source` / `error` / 空 |
| `data-faust-error` | 适配错误 |
| `[data-testid="preview-audio"]` | 现象层里的音频端口状态 |

Faust 状态只在 Space 现象层淡显示，不自动播放。

## 4. 验收

- 单元 **334/334**：新增 Faust `.dsp` 源码生成（hslider、process、无中文标识符）；
- GUI **270/270**：新增
  - 音频端口进入 Faust 适配；
  - 源码生成成功；
  - 现象层显示音频端口状态。
- 没有音频自动播放，既有音频资产/BGM/cue 不回归。

## 5. 边界

- **没有 Faust 编译器，也没有真实 DSP 发声**；
- 只有一个音频端口、一个简单 process；
- 没有采样率/缓冲区/AudioWorklet 生命周期；
- 没有参数自动化/事件映射；
- 未来接入 Faust 编译器后，Host 仍需处理编译诊断与音频线程；
- runtime/IR 仍不依赖 Faust。
