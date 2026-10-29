# GLSL 多端口与时间/纹理 uniform（v5.27）

> v5.7 的 GLSL 后端只支持一个视觉端口、无时间、无纹理。v5.27 把它扩展为
> 多端口、多 canvas、动画时间与程序化纹理采样。

## 1. 多视觉端口

```nro
视觉端口 雨幕
  参数 强度 雨量

视觉端口 雾
  参数 浓度 雨量
```

- 每个视觉端口独立生成 GLSL 源码/编译/canvas；
- 现象层蒙版里多个 canvas 叠加（低透明度、灰度）；
- `data-glsl-ports` 是视觉端口总数；
- 任一端口编译失败 → `data-glsl-status="error"` 并汇总错误。

## 2. uTime

片元统一新增：

```glsl
uniform float uTime;
```

- Host 每帧传入秒数；
- 纹理坐标随 `uTime` 缓慢移动；
- 不使用随机数，动画只依赖时间与端口参数；
- 页面隐藏/卸载时取消 rAF。

## 3. 程序化纹理

```glsl
uniform sampler2D uTexture;
```

- Host 生成 64×64 棋盘灰度纹理（无外部资源）；
- 片元按 `vUv + uTime` 采样；
- 纹理采样只占输出权重 0.25，保持低饱和；
- 后续可替换为素材/端口纹理。

## 4. 顶点/片元

```glsl
out vec2 vUv;        // 顶点
vUv = aPosition * 0.5 + 0.5;
texture(uTexture, vec2(vUv.x + uTime * 0.02, vUv.y)).r;
```

## 5. 验收

- 单元 **360/360**：GLSL 源码生成新增 `uTime/uTexture/vUv` 断言；
- GUI **276/276**：临时世界两个视觉端口 → 2 个 canvas；
- 生产冒烟 / perf 通过。

## 6. 边界

- 纹理是内置棋盘，不是作者资产；
- 没有纹理端口/采样器声明；
- 没有多 pass/后处理/FBO；
- 所有端口共用同一片元模板，只是参数不同；
- 没有 GLSL 源码编辑/热重载。
