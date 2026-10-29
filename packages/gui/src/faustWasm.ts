/**
 * v5.32：真实 Faust 编译（@grame/faustwasm）+ AudioWorklet 节点。
 *
 * 编译器 wasm/数据从 `/faust/` 静态资源加载；只在存在音频端口且预览打开时
 * 动态加载，不进入首屏包。失败时由调用方回退到 v5.28 正弦兜底。
 */
import type { FaustArtifact } from './faustBackend.js';

type FaustApi = typeof import('@grame/faustwasm');
type MonoNode = Awaited<ReturnType<InstanceType<FaustApi['FaustMonoDspGenerator']>['createNode']>>;

let apiPromise: Promise<{ api: FaustApi; compiler: InstanceType<FaustApi['FaustCompiler']> }> | null = null;

async function loadCompiler(): Promise<{ api: FaustApi; compiler: InstanceType<FaustApi['FaustCompiler']> }> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = await import('@grame/faustwasm');
      const module = await api.instantiateFaustModuleFromFile('/faust/libfaust-wasm.js');
      const lib = new api.LibFaust(module);
      return { api, compiler: new api.FaustCompiler(lib) };
    })();
  }
  return apiPromise;
}

export interface FaustWasmCompileResult {
  ok: boolean;
  error?: string;
  version?: string;
}

/** 真正跑一次 Faust 编译器，供 GUI 状态与测试观测。 */
export async function compileFaustWasm(artifact: FaustArtifact): Promise<FaustWasmCompileResult> {
  try {
    const { api, compiler } = await loadCompiler();
    const generator = new api.FaustMonoDspGenerator();
    const compiled = await generator.compile(compiler, artifact.name, artifact.dspSource, '');
    if (!compiled) return { ok: false, error: 'Faust 编译返回空工厂' };
    return { ok: true, version: 'faustwasm' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export class FaustWasmHost {
  private context: AudioContext | null = null;
  private node: MonoNode = null;
  private gain: GainNode | null = null;
  private artifact: FaustArtifact | null = null;
  private name = '';
  state: 'stopped' | 'playing' | 'suspended' | 'unavailable' = 'stopped';
  compileError = '';
  compiled = false;

  async start(artifact: FaustArtifact, values: number[], volume: number): Promise<boolean> {
    this.stop();
    this.compiled = false;
    this.artifact = artifact;
    this.name = artifact.name;
    try {
      const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext;
      if (!Ctor) {
        this.state = 'unavailable';
        return false;
      }
      if (!this.context) this.context = new Ctor();
      const context = this.context;
      const { api, compiler } = await loadCompiler();
      const generator = new api.FaustMonoDspGenerator();
      const compiled = await generator.compile(compiler, artifact.name, artifact.dspSource, '');
      if (!compiled) {
        this.compileError = 'Faust 编译返回空工厂';
        return false;
      }
      this.compiled = true;
      const node = await generator.createNode(context, artifact.name);
      if (!node) {
        this.compileError = 'Faust AudioWorklet 节点创建失败';
        return false;
      }
      this.node = node;
      this.gain = context.createGain();
      this.gain.gain.value = Math.max(0, Math.min(1, volume)) * 0.5;
      node.connect(this.gain);
      this.gain.connect(context.destination);
      this.applyValues(values);
      await context.resume();
      this.state = context.state === 'running' ? 'playing' : 'suspended';
      return true;
    } catch (error) {
      this.compileError = error instanceof Error ? error.message : String(error);
      this.stop();
      return false;
    }
  }

  update(values: number[]): void {
    if (!this.node) return;
    this.applyValues(values);
  }

  setVolume(volume: number): void {
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 0.5, this.context.currentTime, 0.05);
    }
  }

  stop(): void {
    try {
      this.node?.disconnect();
      this.gain?.disconnect();
      this.node = null;
      this.gain = null;
      this.artifact = null;
      this.name = '';
    } catch {
      /* ignore */
    }
    this.state = 'stopped';
  }

  dispose(): void {
    this.stop();
    try {
      void this.context?.close();
    } catch {
      /* ignore */
    }
    this.context = null;
  }

  private applyValues(values: number[]): void {
    const artifact = this.artifact;
    if (!this.node || !artifact) return;
    artifact.bindings.forEach((binding, index) => {
      try {
        this.node?.setParamValue(`/${this.name}/${binding.control}`, values[index] ?? 0);
      } catch {
        /* 参数路径不匹配时忽略，不影响出声 */
      }
    });
  }
}
