/**
 * v5.8：Faust 源码适配层。
 *
 * 这里**不**假装有 Faust 编译器：只把音频端口生成为合法 Faust DSP 源码，
 * 交给未来的 Host 编译服务。runtime 仍然只提供端口帧。
 */
import type { BackendAdapter, BackendCompileResult, BackendPortFrame } from '@neurou/runtime';

export interface FaustBinding {
  control: string;
  param: string;
  string: string;
}

export interface FaustArtifact {
  name: string;
  dspSource: string;
  bindings: FaustBinding[];
}

function identifier(index: number): string {
  return `p${index}`;
}

/** 纯函数：音频端口 → Faust DSP 源码；参数写成 hslider 控件。 */
export function buildFaustArtifact(port: BackendPortFrame): FaustArtifact {
  const params = Object.entries(port.params);
  const controls = params.map((_, index) => identifier(index));
  const lines = [
    `declare name "neurou:${port.name}";`,
    'import("stdfaust.lib");',
    ...controls.map((control) => `${control} = hslider("${control}", 0.0, 0.0, 1.0, 0.001);`),
    `process = no.noise * (${controls.length > 0 ? controls.map((control) => `${control} * 0.08`).join(' + ') : '0.0'});`,
    '',
  ];
  return {
    name: port.name,
    dspSource: lines.join('\n'),
    bindings: params.map(([param, value], index) => ({
      control: controls[index]!,
      param,
      string: typeof value === 'string' ? value : '',
    })),
  };
}

/** 只做源码生成；真正的 Faust 编译、音频线程由 Host 负责。 */
export function compileFaust(port: BackendPortFrame): { result: BackendCompileResult; artifact: FaustArtifact } {
  const artifact = buildFaustArtifact(port);
  return {
    result: { ok: true, artifact: { kind: 'faust-source', source: artifact.dspSource } },
    artifact,
  };
}

export function createFaustBackend(): BackendAdapter {
  return {
    id: 'faust-source',
    kind: '音频',
    compile(port) {
      return compileFaust(port).result;
    },
  };
}
