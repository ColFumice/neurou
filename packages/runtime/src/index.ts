/**
 * neurou runtime —— 弦网络的执行与观测。
 *
 * 这里是「锁运行时」的那一半：图可以导出，行为不能。
 */

export {
  Universe,
  FORCED_DECAY,
  type EmittedCue,
  type AxiomViolation,
  type TickResult,
  type UniverseOptions,
  type SpectrumSnapshot,
  type SpectrumTarget,
  type SpectrumResult,
} from './engine.js';
export { evalExpr, asNumber, truthy, equalValues, compareValues } from './eval.js';
export {
  type RuntimeValue,
  type WorldState,
  type SerializedState,
  type TimelineEvent,
  type PendingDelta,
  type SpectrumMode,
  type SpectrumState,
  type MatrixCurveState,
  type MatrixState,
  createState,
  cloneState,
  serializeState,
  deserializeState,
  createMatrixState,
  sampleMatrixCurve,
  initialValues,
  initialFunctions,
  type RuntimeFunction,
  numberRange,
  clampString,
} from './state.js';
export {
  simulate,
  runOnce,
  diagnose,
  wellness,
  scoreEffects,
  Rng,
  RandomPolicy,
  GreedyPolicy,
  LearnerPolicy,
  type Policy,
  type ModelKind,
  type RunSummary,
  type RunOptions,
  type SimOptions,
  type ModelStats,
  type HealthReport,
  type HealthDimension,
  type BatchResult,
  type ReferenceBatch,
} from './simulate.js';
export { sampleReference, scoreReference, type ReferenceSpec, type ReferenceScore } from './reference.js';
export {
  renderBatchReport,
  renderRun,
  modelLabel,
  bar,
  stateLines,
  padDisplay,
  displayWidth,
  ANSI,
  type RenderOptions,
} from './report.js';
