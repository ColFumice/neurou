# IR Schema 稳定边界（v1.0）

`WorldIR` 是编译产物，也是 GUI 编辑/写回与 Engine 的输入。

## 顶层

| 字段 | 类型 | 说明 |
|---|---|---|
| `format` | string | IR 格式标识 |
| `name` | string | 世界名 |
| `meta` | object | 版本/描述等元数据 |
| `strings` | IRString[] | 弦网络，唯一本体 |
| `entities` | IREntity[] | 实体 |
| `spectra` | IRSpectrum[] | 谱 |
| `matrices` | IRMatrix[] | 关系谱 |
| `couplings` | IRCoupling[] | 耦合 |
| `rules` | IRRule[] | 动作/规则 |
| `scenes` | IRScene[] | 场景 |
| `systems` | IRSystem[] | 系统 |
| `ports` | IRPort[] | 视觉/音频端口 |
| `audioAssets` | IRAudioAsset[] | 音频资产 |
| `textureAssets` | IRTextureAsset[] | 纹理资产 |
| `functions` | IRFunction[] | 函数 |
| `namespaces` | IRNamespace[] | 命名空间/导出 |
| `loops` | IRLoop[] | 回路 |
| `axioms` | IRAxiom[] | 公理 |
| `signals` | IRSignal[] | 信号 |
| `phases` | IRPhase[] | 阶段 |
| `endings` | IREnding[] | 结局 |

## IRString

稳定字段：

```ts
id: string;
name: string;
kind: StringKind;              // 8 类
domain: { type: 'number'|'boolean'|'text'|'enum'|'ref'; ... };
baseline: RuntimeValue;
response: '线性'|'缓入'|'缓出'|'阶跃';
verge?: number;
safe?: number;
owner?: string;
namespace?: string;
target?: string;
timbre?: string;
waveform?: number[];           // v5.43，持续型弦
note?: string;
span?: { start: { offset: number }; end: { offset: number } };
```

## 稳定性承诺

- 字段语义在 v1.x 内保持；
- 新增字段必须可选；
- 破坏性变更需要迁移器 + 版本号提升；
- `span` 是源位置，跨文件写回时可能被重写；
- GUI 编辑走 `packages/core/src/edit.ts`，不直接改 IR。

## 序列化

- 规范序列化：`serialize(ir)`；
- 行级 patch：`patchWorldText` / `patchProjectEntry`；
- roundtrip 必须重新编译通过。

## 边界

- 不承诺 JSON 逐字节稳定；
- 未列出的内部字段可变；
- 多文件入口的 `span` 指向组合文本，写回需要入口映射。
