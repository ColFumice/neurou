/**
 * 外部 Host SDK 示例（v6.20）
 *
 * 这不是新的引擎实现，而是展示宿主如何只依赖 @neurou/core + @neurou/engine：
 * 编译 → Engine → 观察 → 注入/推进 → 快照 → 恢复。
 */
import { compileText, type WorldIR } from '@neurou/core';
import {
  HOST_ABI,
  createEngine,
  isHostSnapshotCompatible,
  type Engine,
  type EngineDescription,
  type HostSnapshot,
  type SceneFrame,
  type TickResult,
} from '@neurou/engine';

export interface ExternalHostOptions {
  seed?: number;
}

export interface ExternalHost {
  engine: Engine;
  ir: WorldIR;
  description: EngineDescription;
  step: () => TickResult;
  observe: () => SceneFrame;
  inject: (id: string, value: number | string | boolean) => number;
  dispatch: (actionId: string) => boolean;
  snapshot: () => HostSnapshot;
  restore: (snapshot: HostSnapshot | string) => boolean;
  exportJSON: () => string;
}

function compileOrThrow(source: string, name: string): WorldIR {
  const compiled = compileText(source, name);
  if (!compiled.ok) {
    const first = compiled.diagnostics.errors[0];
    throw new Error(first ? `${first.code}: ${first.message}` : '世界编译失败');
  }
  return compiled.ir;
}

/** 创建一个不依赖 GUI 的外部宿主。 */
export function createExternalHost(
  source: string,
  name = 'world.nro',
  options: ExternalHostOptions = {},
): ExternalHost {
  const ir = compileOrThrow(source, name);
  const engine = createEngine(ir, { seed: options.seed ?? 1 });
  return {
    engine,
    ir,
    description: engine.describe(),
    step: () => engine.step(),
    observe: () => engine.observe(),
    inject: (id, value) => engine.inject(id, value),
    dispatch: (id) => engine.dispatch(id),
    snapshot: () => engine.toHostSnapshot(),
    restore: (snapshot) => {
      let value: unknown = snapshot;
      if (typeof snapshot === 'string') {
        try {
          value = JSON.parse(snapshot);
        } catch {
          return false;
        }
      }
      if (!isHostSnapshotCompatible(value).ok) return false;
      return engine.restoreHostSnapshot(value as HostSnapshot);
    },
    exportJSON: () => JSON.stringify(engine.toHostSnapshot(), null, 2),
  };
}

export { HOST_ABI };
