# Engine.describe Host 摘要（v5.51）

Host 集成现在可以通过 `Engine.describe()` 读取只读世界摘要：

```ts
interface EngineDescription {
  name: string;
  version: string;
  tick: number;
  scene?: string;
  scenes: string[];
  systems: string[];
  ports: { name: string; kind: '视觉' | '音频' }[];
  strings: number;
  audioAssets: number;
  textureAssets: number;
  functions: number;
}
```

用途：

- Host/播放器启动时探测世界能力；
- CLI/GUI 不需要直接读 IR 数组；
- 测试/诊断可快速断言场景、系统、端口、资源数量。

边界：

- 只读摘要，不包含值/谱/矩阵细节；
- 不替代 `observe()` 帧；
- 不承诺稳定 ABI。
