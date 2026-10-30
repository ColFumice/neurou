# CLI describe（v5.53）

```bash
neurou describe examples/tuner.nro
```

输出 `Engine.describe()` 的 JSON：

```json
{
  "name": "调律台",
  "version": "0.1",
  "tick": 0,
  "scenes": [],
  "systems": [],
  "ports": [],
  "strings": 8,
  "audioAssets": 0,
  "textureAssets": 0,
  "functions": 0
}
```

用途：

- 脚本/CI 探测世界结构；
- 发布前检查端口/资源/函数数量；
- 不读 IR JSON 也能拿到 Host 关心的摘要。

边界：只读摘要，不含值/谱/矩阵细节。
