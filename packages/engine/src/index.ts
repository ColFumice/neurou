/**
 * v5.13：独立引擎包。
 *
 * Host（GUI/CLI/未来的 player）只依赖这一层；Universe 仍是内部内核。
 */
export {
  Engine,
  createEngine,
  type SceneFrame,
  type EngineListener,
  type EngineDescription,
} from './engine.js';
export {
  type BackendAdapter,
  type BackendPortFrame,
  type BackendCompileResult,
} from './backend.js';