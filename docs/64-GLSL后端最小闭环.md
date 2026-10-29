# GLSL 后端最小闭环（v5.7）

> v5.6 有了端口契约；v5.7 把视觉端口接到真正的 WebGL2 片元着色器，
> 并在现象层蒙版里跑出灰度预览。GLSL 仍然只在 Host，不进入 runtime/IR。

## 1. 链路

```text
视觉端口声明
  ↓
IRPort.params（弦 id）
  ↓
Engine.observe().ports（当拍弦值）
  ↓
Host 的 GLSLBackend：生成 GLSL ES 3.0 源码 → WebGL2 编译
  ↓
现象层蒙版里的全屏 canvas（灰度、低透明度、pointer-events:none）
```

## 2. 生成规则

```glsl
#version 300 es
precision highp float;
uniform float u0;
uniform float u1;
out vec4 outColor;
void main() {
  float v = 0.0;
  v += u0;
  v += u1 * 0.35;
  v = clamp(v, 0.0, 1.0);
  outColor = vec4(vec3(0.09 + v * 0.26), 0.55);
}
```

- 参数名统一映射为 `u0/u1/...`，避免中文/特殊标识符；
- 只输出灰度，保持调律台的低饱和视觉；
- 第一个参数权重 1.0，其余 0.35；
- 顶点着色器只画全屏三角带。

## 3. Host 状态

| 属性 | 含义 |
|---|---|
| `data-glsl-ports` | 视觉端口数 |
| `data-glsl-status` | `ok` / `error` / `''` |
| `data-glsl-error` | 编译日志 |
| `[data-testid="preview-glsl"]` | 预览 canvas |

Space 打开现象层后才会渲染 canvas；没有视觉端口时不编译、不显示。

## 4. 验收

- 单元 **333/333**：新增 GLSL 源码生成（uniform 映射、无中文标识符、灰度输出）；
- GUI **267/267**：新增
  - 视觉端口进入 GLSL 后端；
  - 编译成功；
  - 预览蒙版出现 GLSL canvas。
- WebGL2 不可用时状态为 `error`，不影响世界运行。

## 5. 边界

- 只有一个视觉端口、一个片元、无纹理/采样；
- uniform 只取数值弦；非数值按 0；
- 没有 GLSL 源码编辑器/热重载/多 pass；
- 没有 SPIR-V/离线编译；
- 预览 canvas 只读，不写回 WorldState；
- Faust 尚未接入（v5.8）。
