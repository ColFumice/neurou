/**
 * neurou runtime —— 弦网络的执行与观测。
 *
 * 这里是「锁运行时」的那一半：图可以导出，行为不能。
 */

export {
  Universe,
  type EmittedCue,
  type AxiomViolation,
  type TickResult,
  type UniverseOptions,
} from './engine.js';
export { evalExpr, asNumber, truthy, equalValues, compareValues } from './eval.js';
export {
  type RuntimeValue,
  type WorldState,
  type SerializedState,
  type TimelineEvent,
  type PendingDelta,
  createState,
  cloneState,
  serializeState,
  deserializeState,
  initialValues,
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
} from './simulate.js';
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
