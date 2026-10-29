# 真实 Faust wasm 编译与 AudioWorklet（v5.32）

> v5.28 只有 WebAudio 正弦兜底，v5.31 只有音频资产。v5.32 接入官方
> [`@grame/faustwasm`](https://www.npmjs.com/package/@grame/faustwasm)：
> 浏览器里真实运行 Faust 编译器，生成 AudioWorklet 节点。

## 1. 依赖与资源

- npm 依赖：`@grame/faustwasm@0.19.3`（LGPL-2.1）；
- 编译器静态资源：
  - `packages/gui/public/faust/libfaust-wasm.js`
  - `libfaust-wasm.data`（约 2.8MB）
  - `libfaust-wasm.wasm`（约 3.4MB）
- 只有存在音频端口、进入预览时才动态加载；
- 首屏 bundle 不包含编译器 wasm。

## 2. 编译链路

```text
音频端口 → buildFaustArtifact(dspSource)
  → dynamic import('@grame/faustwasm')
  → instantiateFaustModuleFromFile('/faust/libfaust-wasm.js')
  → FaustCompiler + FaustMonoDspGenerator.compile()
  → AudioWorkletNode
  → GainNode → destination
```

- `FaustWasmHost` 管理 AudioContext、节点、增益、参数；
- 端口参数写到 `/<dsp>/<p0>` Faust 参数路径；
- 音量继承调律台音量；
- 编译/节点失败时回退 v5.28 正弦兜底；
- 退出预览/切换世界/静音停止节点。

## 3. 可观测状态

| 属性 | 含义 |
|---|---|
| `data-faust-compile` | `ok` / 错误 |
| `data-faust-runtime` | `faust-wasm` / `webaudio-fallback` / `stopped` |
| `data-faust-audio` | `playing` / `suspended` / `stopped` |

GUI 验收实测：`faust-wasm/ok`，即编译与 AudioWorklet 节点都成功。

## 4. 验收

- 单元 **369/369**：Node 里用 libfaust wasm 编译端口 DSP；
- GUI **282/282**：
  - `data-faust-compile=ok`；
  - `data-faust-runtime=faust-wasm`；
  - 音频端口预览仍显示；
- 构建/发布包含 `faust/` 运行资源；
- 生产冒烟 / perf 通过。

## 5. 边界

- 编译器资源较大（约 6.6MB），首次预览有加载成本；
- 不做 Faust DSP 源码编辑器/热重载；
- 只创建 mono AudioWorklet 节点，不处理 poly/MIDI；
- 参数更新只在预览启动时写一次，后续可接每拍更新；
- 依赖/编译器为 LGPL-2.1，分发时需保留其许可信息。
