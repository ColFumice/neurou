import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addCoupling,
  addString,
  compileProjectFromFiles,
  compileText,
  findCoupling,
  patchWorldText,
  patchProjectEntry,
  projectEntryStrings,
  projectEntryView,
  ruleBlockText,
  replaceRuleBlockText,
  patchRuleBlockText,
  projectGraph,
  removeCoupling,
  removeString,
  serialize,
  setCouplingStrengthBetween,
  setStringThreshold,
  setStringWaveform,
  setRuleNumberField,
  setAssetSource,
  renameAsset,
  removeAsset,
  assetReferences,
  replaceAssetReferences,
  STRING_INTERACTIONS,
  KIND_ORDER,
  setSpectrumBand,
  setSpectrumBands,
  setMatrixCell,
  setMatrixCurveBand,
  setMatrixCurveBands,
  addMatrixRow,
  removeMatrixRow,
  addMatrixCol,
  removeMatrixCol,
  renameMatrixRow,
  renameMatrixCol,
  addMatrixCurve,
  removeMatrixCurve,
  setMatrixTiming,
  type StringKind,
  type WorldIR,
} from '@neurou/core';
import { Engine, createEngine } from '@neurou/engine';
import { RuleEditor } from './RuleEditor.js';
import { Modal } from './Modal.js';
import { StartScreen, type StartItem } from './StartScreen.js';
import { FlowField } from './FlowField.js';
import { ContextDslEditor } from './ContextDslEditor.js';
import { WorldWizard, type WorldTemplate } from './WorldWizard.js';
import { CursorLayer } from './CursorLayer.js';
import { StringHighlight } from './StringHighlight.js';
import { MemoryMode } from './MemoryMode.js';
import { Metronome } from './Metronome.js';
import { MemoryEffects } from './MemoryEffects.js';
import type { EmittedCue, WorldState } from '@neurou/runtime';
import { StringField } from './StringField.js';
import type { SpectrumView } from './SpectrumField.js';
import type { MatrixView } from './MatrixField.js';
import type { Lane, TimbreCurve, WorldView } from './stringMath.js';
import { collectLanes, couplingLanes, numericStringsByKind, withCurrentBaselines } from './worldView.js';
import { getStringAudio, type KindEffects } from './stringAudio.js';
import { buildChapterGraph, type ChapterGraphNode } from './chapterGraph.js';
import { compileGlsl, type GlslArtifact } from './glslBackend.js';
import { GlslCanvas } from './GlslCanvas.js';
import { compileFaust, type FaustArtifact } from './faustBackend.js';
import { FaustFallback } from './faustAudio.js';
import { FaustWasmHost } from './faustWasm.js';
import { sustainedWaves, type WavePreset } from './sustainedWave.js';
import bundledSource from '../../../examples/testbed.nro?raw';

// v2.18：F2/F3 大组件按需加载，首屏只带八弦调律台；挂载后空闲预取，按键时无等待。
const SpectrumField = lazy(async () => ({ default: (await import('./SpectrumField.js')).SpectrumField }));
const MatrixField = lazy(async () => ({ default: (await import('./MatrixField.js')).MatrixField }));

const TICK_MS = 480;
const DEFAULT_WORLD_FILE = 'examples/testbed.nro';
const SAVE_DEBOUNCE_MS = 700;
const DEV = import.meta.env.DEV;

/** v3.6：F4 循环四档音量；0 档即静音。 */
const AUDIO_LEVELS = [1, 0.6, 0.3, 0] as const;
const AUDIO_PREF_KEY = 'neurou.audio.level';
const RUN_SAVE_PREFIX = 'neurou.run.';
const RUN_SAVE_INTERVAL_MS = 4000;

interface RunSave {
  v: 1;
  file: string;
  seed: number;
  slot: number;
  tick: number;
  ended: boolean;
  state: WorldState;
}

function slotFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('slot');
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 9 ? value : 0;
}

const RUN_SLOT = slotFromUrl();

function runSaveKey(file: string, seed: number, slot: number): string {
  return `${RUN_SAVE_PREFIX}${file}:${seed}:slot${slot}`;
}

function readRunSave(file: string, seed: number, slot: number): RunSave | null {
  try {
    const raw = window.localStorage.getItem(runSaveKey(file, seed, slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunSave>;
    if (parsed.v !== 1 || parsed.file !== file || parsed.seed !== seed || parsed.slot !== slot || !parsed.state) {
      return null;
    }
    return parsed as RunSave;
  } catch {
    return null;
  }
}

function clearRunSave(file: string, seed: number, slot: number): void {
  try {
    window.localStorage.removeItem(runSaveKey(file, seed, slot));
  } catch {
    /* 隐私模式 */
  }
}

interface SlotInfo {
  slot: number;
  exists: boolean;
  tick: number;
  ended: boolean;
}

function readAllSlots(file: string, seed: number): SlotInfo[] {
  return Array.from({ length: 10 }, (_, slot) => {
    const saved = readRunSave(file, seed, slot);
    return { slot, exists: Boolean(saved), tick: saved?.tick ?? 0, ended: saved?.ended ?? false };
  });
}

interface AudioPref {
  volume: number;
  muted: boolean;
}

function loadAudioPref(): AudioPref {
  try {
    const raw = window.localStorage.getItem(AUDIO_PREF_KEY);
    const value = raw === null ? 1 : Number(raw);
    if (AUDIO_LEVELS.some((level) => Math.abs(level - value) < 0.001)) {
      return value === 0 ? { volume: 1, muted: true } : { volume: value, muted: false };
    }
  } catch {
    /* 隐私模式/无 localStorage */
  }
  return { volume: 1, muted: false };
}

function audioLevel(pref: AudioPref): number {
  return pref.muted ? 0 : pref.volume;
}

/**
 * v3.4/v5.16：所有示例世界与模块在构建时内联；入口仍按 `?world=examples/xxx.nro`。
 * 嵌套文件只作为模块，不进入世界选择。
 */
const BUNDLED_PROJECT_MODULES = import.meta.glob('../../../examples/**/*.nro', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const BUNDLED_PROJECT: Record<string, string> = Object.fromEntries(
  Object.entries(BUNDLED_PROJECT_MODULES).map(([path, text]) => {
    const marker = path.lastIndexOf('/examples/');
    const relative = marker >= 0 ? path.slice(marker + '/examples/'.length) : path;
    return [`examples/${relative}`, text];
  }),
);
const BUNDLED_WORLDS: Record<string, string> = Object.fromEntries(
  Object.entries(BUNDLED_PROJECT).filter(([file]) => /^examples\/[^/]+\.nro$/.test(file)),
);
const CHAPTER_GRAPH: ChapterGraphNode[] = buildChapterGraph(BUNDLED_WORLDS);

const BASE_START_ITEMS: StartItem[] = [
  { id: 'tuner', label: '进入调律台', note: '八弦 · 默认', file: '' },
  {
    id: 'worlds',
    label: '世界',
    note: '1 个',
    children: [
      { id: 'testbed', label: '测试世界', note: '全能力试验场', file: 'examples/testbed.nro' },
      { id: 'ten-minute', label: '十分钟灯塔', note: '可通关示例', file: 'examples/ten-minute.nro' },
    ],
  },
  { id: 'graph', label: '章节路线', note: 'Shift+F9', file: '' },
  { id: 'help', label: '操作说明', note: '完整流程', file: '' },
];

function startItemsFor(localWorlds: LocalWorld[]): StartItem[] {
  return BASE_START_ITEMS.map((item) => {
    if (item.id !== 'worlds') return item;
    return {
      ...item,
      note: `${1 + localWorlds.length} 个`,
      children: [
        ...(item.children ?? []),
        ...localWorlds.map((world) => ({
          id: `local-${world.id}`,
          label: world.name,
          note: '本机',
          file: `local:${world.id}`,
          localId: world.id,
        })),
      ],
    };
  });
}

function chapterLabel(file: string): string {
  const node = CHAPTER_GRAPH.find((item) => item.file === file);
  return node?.title || node?.name || file.replace(/^examples\//, '').replace(/\.nro$/, '');
}

function previewCueText(cue: EmittedCue['cue']): string {
  if (cue.k === '台词') return `${cue.speaker ? `${cue.speaker}：` : ''}${cue.text ?? ''}`;
  if (cue.k === '视觉' || cue.k === '音频') return `${cue.k} ${cue.param} ${cue.value ?? ''}`;
  return cue.text ?? cue.k;
}

const LOCAL_WORLDS_KEY = 'neurou.localWorlds.v1';

interface LocalWorld {
  id: string;
  name: string;
  source: string;
  createdAt: number;
}

function readLocalWorlds(): LocalWorld[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_WORLDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is LocalWorld => Boolean(item && typeof item === 'object' && typeof (item as LocalWorld).id === 'string' && typeof (item as LocalWorld).source === 'string'))
      .map((item) => ({ ...item, name: item.name || item.id }));
  } catch {
    return [];
  }
}

function writeLocalWorlds(worlds: LocalWorld[]): void {
  try {
    window.localStorage.setItem(LOCAL_WORLDS_KEY, JSON.stringify(worlds));
  } catch {
    /* 隐私模式 */
  }
}

function localWorldFromFile(file: string): LocalWorld | null {
  if (!file.startsWith('local:')) return null;
  const id = file.slice('local:'.length);
  return readLocalWorlds().find((world) => world.id === id) ?? null;
}

function bundledSourceFor(file: string): string {
  const local = localWorldFromFile(file);
  if (local) return local.source;
  return BUNDLED_PROJECT[file] ?? bundledSource;
}

function isLocalWorldFile(file: string): boolean {
  return file.startsWith('local:');
}

const OVERLAY_AUDIO_PREFIX = '# @neurou:audio:';
const OVERLAY_FLOW_PREFIX = '# @neurou:flow:';

/** 把运行期音频配置与流场节点写进 .nro 注释侧车；这些行参与保存但仍可被编译器忽略。 */
function withRuntimeOverlay(text: string, worldFile: string): string {
  const lines = text.split(/\r?\n/).filter((line) => !line.startsWith(OVERLAY_AUDIO_PREFIX) && !line.startsWith(OVERLAY_FLOW_PREFIX));
  const overlays: string[] = ['# 音频配置（RuntimeOverlay）', '# 流场（RuntimeOverlay）'];
  const audio = getStringAudio();
  for (const kind of KIND_ORDER) {
    const effects = audio.getKindEffects(kind);
    overlays.push(`${OVERLAY_AUDIO_PREFIX}${kind} ${JSON.stringify(effects)}`);
    try {
      const raw = window.localStorage.getItem(`neurou.flow.nodes:${worldFile}:${kind}`);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { nodes?: unknown };
      if (Array.isArray(parsed.nodes)) overlays.push(`${OVERLAY_FLOW_PREFIX}${kind} ${JSON.stringify(parsed.nodes)}`);
    } catch {
      /* 忽略损坏的本地侧车 */
    }
  }
  return `${overlays.join('\n')}\n${lines.join('\n')}`;
}

/**
 * 用 `?world=examples/xxx.nro` 打开任意示例世界；dev 支持文件系统，生产只认内联世界。
 * `?world=local:<id>` 打开本机世界栏里新增的世界。
 */
function worldFileFromUrl(): string {
  const raw = new URLSearchParams(window.location.search).get('world');
  if (raw && /^examples\/[^/\\]+\.nro$/.test(raw) && (DEV || raw in BUNDLED_WORLDS)) return raw;
  if (raw && raw.startsWith('local:') && localWorldFromFile(raw)) return raw;
  return DEFAULT_WORLD_FILE;
}

/** v3.4：`?seed=42` 复现同一局；默认仍是 7。 */
function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 2147483647 ? value : 7;
}

const WORLD_FILE = worldFileFromUrl();
const HAS_WORLD_QUERY = new URLSearchParams(window.location.search).has('world');
const INITIAL_SEED = seedFromUrl();
sustainedWaves.configure(WORLD_FILE);

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'disabled';

/** 撤销/重做的缓动时长与类型。 */
const UNDO_TRANSITION_MS = 620;
type UndoDirection = 'undo' | 'redo';
interface UndoTransition {
  dir: UndoDirection;
  from: Lane[];
  to: Lane[];
  start: number;
  duration: number;
  text: string;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 撤消缓动：按类把 8 根弦的当前值与阈值插值回上一版。
 * id/name 取目标版本（真正切换世界在动画结束后发生，视觉上无缝）。
 */
function interpolateLanes(from: Lane[], to: Lane[], t: number): Lane[] {
  const fromByKind = new Map(from.map((lane) => [lane.kind, lane]));
  const toByKind = new Map(to.map((lane) => [lane.kind, lane]));
  const kinds = [...to.map((lane) => lane.kind), ...from.map((lane) => lane.kind)].filter(
    (kind, index, list) => list.indexOf(kind) === index,
  );
  const lanes: Lane[] = [];
  for (const kind of kinds) {
    const a = fromByKind.get(kind);
    const b = toByKind.get(kind);
    if (!a && b) {
      lanes.push(b);
      continue;
    }
    if (!b && a) {
      lanes.push(a);
      continue;
    }
    if (!a || !b) continue;
    const lane: Lane = {
      ...b,
      value: lerp(a.value, b.value, t),
      norm: lerp(a.norm, b.norm, t),
    };
    if (a.verge !== undefined && b.verge !== undefined) lane.verge = lerp(a.verge, b.verge, t);
    if (a.safe !== undefined && b.safe !== undefined) lane.safe = lerp(a.safe, b.safe, t);
    if (a.vergeNorm !== undefined && b.vergeNorm !== undefined) lane.vergeNorm = lerp(a.vergeNorm, b.vergeNorm, t);
    if (a.safeNorm !== undefined && b.safeNorm !== undefined) lane.safeNorm = lerp(a.safeNorm, b.safeNorm, t);
    lanes.push(lane);
  }
  return lanes;
}

function fetchWorld(file: string): Promise<string> {
  return fetch(`/__neurou/world?file=${encodeURIComponent(file)}`, { cache: 'no-store' }).then(
    (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    },
  );
}

/**
 * 世界源码：dev 下用 fetch 读文件（写回/撤销后能重新读取，不吃 Vite import 缓存）；
 * 生产包用构建时内联的 raw 文本。读不到时退回内联文本，页面不会白屏。
 */
function useWorldSource(file: string): {
  source: string | null;
  rev: number;
  reload: () => Promise<void>;
  apply: (text: string) => void;
} {
  const [source, setSource] = useState<string | null>(() =>
    isLocalWorldFile(file) ? bundledSourceFor(file) : DEV ? null : bundledSourceFor(file),
  );
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!DEV) return;
    if (isLocalWorldFile(file)) {
      setSource(bundledSourceFor(file));
      return;
    }
    let alive = true;
    fetchWorld(file)
      .then((text) => {
        if (alive) setSource(text);
      })
      .catch(() => {
        if (alive) setSource(bundledSourceFor(file));
      });
    return () => {
      alive = false;
    };
  }, [file]);
  const reload = async (): Promise<void> => {
    if (isLocalWorldFile(file)) {
      setSource(bundledSourceFor(file));
      setRev((r) => r + 1);
      return;
    }
    if (!DEV) return;
    try {
      const text = await fetchWorld(file);
      setSource(text);
      // 撤销可能把文件写回与当前 source 相同的文本；用 rev 强制重编译，
      // 否则 source 不变 → compiled 不重算 → worldIR/画布停在编辑后的状态。
      setRev((r) => r + 1);
    } catch {
      /* 保持当前世界 */
    }
  };
  /** 直接应用一段已知文本（撤销缓动结束后用，避免再发一次网络请求）。 */
  const apply = (text: string): void => {
    setSource(text);
    setRev((r) => r + 1);
  };
  return { source, rev, reload, apply };
}

/**
 * 调律台：一张白纸上叠着某个真实世界里的 8 类弦。
 * 视图之外的逻辑（编译、逐拍、注入、结构编辑、写回、撤销）都在这层；画布只负责乐器。
 */
export function App() {
  const { source, rev, reload, apply } = useWorldSource(WORLD_FILE);
  /** v5.16：含 `引入` 的入口按多文件项目编译；模块源来自构建期内联。 */
  const projectMode = useMemo(() => /^\s*引入\s+/m.test(source ?? ''), [source]);
  const projectSources = useMemo(
    () => ({ ...BUNDLED_PROJECT, [WORLD_FILE]: source ?? '' }),
    [source],
  );
  const compiled = useMemo(
    () => (source ? (projectMode ? compileProjectFromFiles(WORLD_FILE, projectSources) : compileText(source, WORLD_FILE)) : null),
    [source, rev, projectMode, projectSources],
  );
  const projectModules = useMemo(() => {
    if (!projectMode) return [];
    try {
      return projectGraph(WORLD_FILE, (path) => projectSources[path] ?? '');
    } catch {
      return [];
    }
  }, [projectMode, projectSources]);
  const [universe, setUniverse] = useState<Engine | null>(null);
  /** 编辑后的图（阈值等结构编辑在它上面生效），写回以它为准。 */
  const [worldIR, setWorldIR] = useState<WorldIR | null>(null);
  /** v5.48：模块弦只读保护。 */
  const moduleStringIds = useMemo(() => {
    if (!projectMode || !source || !worldIR) return new Set<string>();
    const entryIds = new Set(projectEntryStrings(WORLD_FILE, source, worldIR).map((string) => string.id));
    return new Set(worldIR.strings.filter((string) => !entryIds.has(string.id)).map((string) => string.id));
  }, [projectMode, source, worldIR]);

  /** 同类多根弦时，每类当前选中的是第几根（ArrowLeft/ArrowRight 切换）。 */
  const [selected, setSelected] = useState<Partial<Record<StringKind, number>>>({});
  const [version, setVersion] = useState(0);
  const [playReset, setPlayReset] = useState(0);
  /** v3.5：已播放的世界音频 cue 数/最近一条（仅用于可观测验收）。 */
  const [cueAudio, setCueAudio] = useState(0);
  const [lastCue, setLastCue] = useState('');
  /** v3.7：音频资产 cue 次数/最近 cue 来源。 */
  const [assetCues, setAssetCues] = useState(0);
  const [lastCueKind, setLastCueKind] = useState('');
  /** v3.6：F4 音量档位，localStorage 持久化。 */
  const [audioPref, setAudioPref] = useState<AudioPref>(loadAudioPref);
  /** v4.0：一局自动存档/恢复。 */
  const bootedRef = useRef(false);
  const saveRunRef = useRef<() => void>(() => {});
  const [resumed, setResumed] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  /** v4.2：章节标题的短暂淡入。 */
  const [chapterIntro, setChapterIntro] = useState(false);
  /** v4.4：存档槽淡列表（Backquote）。 */
  const [slotMenuOpen, setSlotMenuOpen] = useState(false);
  const [slotSelected, setSlotSelected] = useState(0);
  const [slotInfos, setSlotInfos] = useState<SlotInfo[]>([]);
  /** v4.5：结局多出口选择。 */
  const [choiceSelected, setChoiceSelected] = useState(0);
  /** v4.6：F9 章节路线图。 */
  const [chapterGraphOpen, setChapterGraphOpen] = useState(false);
  /** v5.4：现象层预览蒙版；Space 切换，与编辑器同屏。 */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCues, setPreviewCues] = useState<string[]>([]);
  /** v5.10：F8 场景列表。 */
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [sceneSelected, setSceneSelected] = useState(0);
  /** v5.7：GLSL 后端端口编译结果。 */
  const [glslArtifacts, setGlslArtifacts] = useState<GlslArtifact[]>([]);
  const [glslStatus, setGlslStatus] = useState('');
  const [glslError, setGlslError] = useState('');
  /** v5.8：音频端口 → Faust 源码适配（不含实际 Faust 编译）。 */
  const [faustArtifact, setFaustArtifact] = useState<FaustArtifact | null>(null);
  const [faustStatus, setFaustStatus] = useState('');
  const [faustError, setFaustError] = useState('');
  const [faustAudioState, setFaustAudioState] = useState('stopped');
  const [faustRuntime, setFaustRuntime] = useState('stopped');
  const [faustCompile, setFaustCompile] = useState('');
  const [faustNodes, setFaustNodes] = useState(0);
  const faustAudioRef = useRef<FaustFallback[]>([]);
  const faustWasmRef = useRef<FaustWasmHost[]>([]);
  const [saves, setSaves] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMode, setSaveMode] = useState<'patch' | 'fallback' | 'rule-source' | 'f7-dsl' | ''>('');
  const [saveError, setSaveError] = useState('');
  const [saveErrorLine, setSaveErrorLine] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [flowMode, setFlowMode] = useState(() => /flow-field\.nro$/.test(WORLD_FILE));
  const [startOpen, setStartOpen] = useState(!HAS_WORLD_QUERY);
  const [startLeaving, setStartLeaving] = useState(false);
  const [startEntering, setStartEntering] = useState(false);
  const [localWorlds, setLocalWorlds] = useState<LocalWorld[]>(() => readLocalWorlds());
  const startItems = useMemo(() => startItemsFor(localWorlds), [localWorlds]);
  const [worldWizardOpen, setWorldWizardOpen] = useState(false);
  const importWorldRef = useRef<HTMLInputElement | null>(null);
  const [memoryMode, setMemoryMode] = useState(false);
  const [memoryKind, setMemoryKind] = useState<StringKind>('叙事');
  const [focusKind, setFocusKind] = useState<StringKind>('叙事');
  const [memoryFxOpen, setMemoryFxOpen] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  /** 耦合编辑计数与最后一次编辑（供验收/调试）。 */
  const [couplingEdits, setCouplingEdits] = useState(0);
  const [couplingAdds, setCouplingAdds] = useState(0);
  const [couplingRemoves, setCouplingRemoves] = useState(0);
  const [stringAdds, setStringAdds] = useState(0);
  const [stringRemoves, setStringRemoves] = useState(0);
  /** 谱模式（v1.9）：'strings' 八弦 / 'spectrum' 谱编辑 / 'matrix' 关系谱。 */
  const [screen, setScreen] = useState<'strings' | 'spectrum' | 'matrix'>('strings');
  const [ruleOpen, setRuleOpen] = useState(false);
  const [dslOpen, setDslOpen] = useState(false);
  const [dslError, setDslError] = useState('');
  const POST_LEVEL_KEY = `neurou.post.level:${WORLD_FILE}`;
  const [postLevel, setPostLevelState] = useState(() => {
    try {
      const raw = window.localStorage.getItem(POST_LEVEL_KEY);
      const value = raw === null ? 1 : Number(raw);
      return Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1;
    } catch {
      return 1;
    }
  });
  const setPostLevel = (value: number): void => {
    setPostLevelState(value);
    try {
      window.localStorage.setItem(POST_LEVEL_KEY, String(value));
    } catch {
      /* 隐私模式忽略 */
    }
  };
  const [spectrumIndex, setSpectrumIndex] = useState(0);
  const [matrixIndex, setMatrixIndex] = useState(0);
  const [bandEdits, setBandEdits] = useState(0);
  const [matrixEdits, setMatrixEdits] = useState(0);
  const [matrixCurveEdits, setMatrixCurveEdits] = useState(0);
  const [matrixRowAdds, setMatrixRowAdds] = useState(0);
  const [matrixRowRemoves, setMatrixRowRemoves] = useState(0);
  const [matrixColAdds, setMatrixColAdds] = useState(0);
  const [matrixColRemoves, setMatrixColRemoves] = useState(0);
  const [matrixRenames, setMatrixRenames] = useState(0);
  const [matrixCurveAdds, setMatrixCurveAdds] = useState(0);
  const [matrixCurveRemoves, setMatrixCurveRemoves] = useState(0);
  const [matrixTimingEdits, setMatrixTimingEdits] = useState(0);
  const screenRef = useRef<'strings' | 'spectrum' | 'matrix'>('strings');
  screenRef.current = screen;
  const [lastCoupling, setLastCoupling] = useState<{ from: string; to: string; strength: number } | null>(null);
  /** 撤销/重做的缓动状态。 */
  const [transition, setTransition] = useState<UndoTransition | null>(null);
  const [frame, setFrame] = useState(0);

  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const savedText = useRef('');
  /** doSave 在 debounce 计时器里执行，必须读「最新」的图，不能用本帧闭包里的旧值。 */
  const worldIRRef = useRef<WorldIR | null>(null);
  /** 写回保真：磁盘上当前文本 + 它编译出的图；只对它们做「行级 patch」。 */
  const baseText = useRef('');
  const baseIR = useRef<WorldIR | null>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const transitionRef = useRef<UndoTransition | null>(null);
  /** 缓动结束、等待新世界编译完成后再清掉 transition（避免最后一帧闪回旧值）。 */
  const finishRef = useRef<UndoTransition | null>(null);
  const applyRef = useRef<(text: string) => void>(() => {});
  applyRef.current = apply;
  const actions = useRef<{ undo: () => Promise<void>; redo: () => Promise<void> }>({
    undo: async () => {},
    redo: async () => {},
  });

  const applyWorldIR = (next: WorldIR): void => {
    worldIRRef.current = next;
    setWorldIR(next);
  };

  useEffect(() => {
    if (!compiled?.ok) return;
    applyWorldIR(compiled.ir);
    sustainedWaves.loadFromIR(compiled.ir.strings);
    const nextUniverse = createEngine(compiled.ir, { seed: INITIAL_SEED });
    if (!bootedRef.current) {
      bootedRef.current = true;
      const params = new URLSearchParams(window.location.search);
      const fresh = params.get('fresh') === '1';
      const wantResume = params.get('resume') === '1';
      if (fresh) {
        clearRunSave(WORLD_FILE, INITIAL_SEED, RUN_SLOT);
      } else if (wantResume) {
        const saved = readRunSave(WORLD_FILE, INITIAL_SEED, RUN_SLOT);
        if (saved) {
          try {
            nextUniverse.restore(saved.state);
            setResumed(true);
            setSavedTick(saved.tick);
          } catch {
            clearRunSave(WORLD_FILE, INITIAL_SEED, RUN_SLOT);
          }
        }
      }
    }
    setUniverse(nextUniverse);
    setSelected({});
    if (!savedText.current) savedText.current = source ?? '';
    if (source) {
      baseText.current = source;
      baseIR.current = compiled.ir;
    }
    if (finishRef.current) {
      finishRef.current = null;
      transitionRef.current = null;
      setTransition(null);
    }
  }, [compiled, source]);

  useEffect(() => {
    if (!universe) return;
    const timer = window.setInterval(() => {
      if (transitionRef.current) return; // 缓动期间暂停逐拍
      if (universe.state.ended) return;
      const result = universe.step();
      if (result.cues.length > 0) {
        setPreviewCues(result.cues.map((item) => previewCueText(item.cue)).slice(-4));
      }
      // v3.5/v3.7：把世界信号的「音频」cue 接到本地声音层。
      // 优先级：音频资产（外部文件） > 同名的谱（合成音色） > 名字哈希。
      for (const emitted of result.cues) {
        const cue = emitted.cue;
        if (cue.k !== '音频' || !cue.param) continue;
        const audio = getStringAudio();
        const asset = worldIRRef.current?.audioAssets?.find(
          (item) => item.id === cue.param || item.name === cue.param,
        );
        if (asset) {
          setLastCueKind('asset');
          setAssetCues((n) => n + 1);
          void audio.playAsset(`/${asset.src}`, cue.value ?? 0.5);
        } else {
          const spectrum = worldIRRef.current?.spectra.find(
            (item) => item.id === cue.param || item.name === cue.param,
          );
          const timbre: TimbreCurve | undefined = spectrum
            ? {
                bands: [...spectrum.bands],
                min: spectrum.min,
                max: spectrum.max,
                smooth: spectrum.interpolation === '平滑',
                loop: spectrum.loop,
              }
            : undefined;
          audio.playCue(cue.param, cue.value ?? 0.5, timbre);
          setLastCueKind(spectrum ? 'spectrum' : 'synth');
        }
        setCueAudio((n) => n + 1);
        setLastCue(`${cue.param}:${cue.value ?? ''}`);
      }
      setVersion((v) => v + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [universe]);

  // v4.0：一局自动存档——每 4s 与离页时写 localStorage；刷新后自动续上。
  useEffect(() => {
    if (!universe) return;
    const save = (): void => {
      try {
        const payload: RunSave = {
          v: 1,
          file: WORLD_FILE,
          seed: INITIAL_SEED,
          slot: RUN_SLOT,
          tick: universe.state.tick,
          ended: universe.state.ended !== null,
          state: universe.snapshot(),
        };
        window.localStorage.setItem(runSaveKey(WORLD_FILE, INITIAL_SEED, RUN_SLOT), JSON.stringify(payload));
        setSavedTick(payload.tick);
      } catch {
        /* 隐私模式/配额满：静默降级 */
      }
    };
    saveRunRef.current = save;
    const timer = window.setInterval(save, RUN_SAVE_INTERVAL_MS);
    window.addEventListener('pagehide', save);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [universe]);

  // v3.8：世界配乐——引用音频资产，循环播放；首次手势后由引擎自动启动。
  const bgm = worldIR?.bgm;
  const bgmAsset = bgm ? worldIR?.audioAssets?.find((item) => item.id === bgm.asset || item.name === bgm.asset) : undefined;
  const bgmSrc = bgmAsset?.src;
  useEffect(() => {
    const audio = getStringAudio();
    if (!bgm || !bgmSrc) {
      audio.stopLoop();
      return;
    }
    void audio.playLoop(`/${bgmSrc}`, bgm.volume, bgm.loop);
  }, [bgm?.asset, bgm?.volume, bgm?.loop, bgmSrc]);
  useEffect(() => () => getStringAudio().stopLoop(), []);

  // v4.1/v4.3/v4.5：上一章 / 下一章；结局多出口。
  const worldNextRaw = worldIR?.meta['下一章'];
  const worldNextChapter =
    typeof worldNextRaw === 'string' && /^examples\/[^/\\]+\.nro$/.test(worldNextRaw) ? worldNextRaw : '';
  const endedId = universe?.state.ended?.id;
  const endedEnding = endedId ? worldIR?.endings.find((ending) => ending.id === endedId) : undefined;
  const choiceRaw = endedEnding?.nextChapters ?? (endedEnding?.nextChapter ? [endedEnding.nextChapter] : []);
  const chapterChoices = Array.from(
    new Set(choiceRaw.filter((path) => /^examples\/[^/\\]+\.nro$/.test(path))),
  );
  const nextChapter = chapterChoices[0] ?? worldNextChapter;
  const prevChapterRaw = worldIR?.meta['上一章'];
  const prevChapter =
    typeof prevChapterRaw === 'string' && /^examples\/[^/\\]+\.nro$/.test(prevChapterRaw) ? prevChapterRaw : '';
  const chapterTitle = typeof worldIR?.meta['章节'] === 'string' ? String(worldIR.meta['章节']) : '';
  const goChapter = (chapter: string): void => {
    if (!chapter) return;
    saveRunRef.current();
    window.location.assign(
      `${window.location.pathname}?world=${encodeURIComponent(chapter)}&seed=${INITIAL_SEED}&slot=${RUN_SLOT}`,
    );
  };
  useEffect(() => {
    setChoiceSelected(0);
  }, [endedId, chapterChoices.length]);
  useEffect(() => {
    if (!chapterTitle) {
      setChapterIntro(false);
      return;
    }
    setChapterIntro(true);
    const timer = window.setTimeout(() => setChapterIntro(false), 1800);
    return () => window.clearTimeout(timer);
  }, [chapterTitle]);
  useEffect(() => {
    const onChapterKey = (event: KeyboardEvent): void => {
      if (!universe?.state.ended) return;
      if (chapterChoices.length > 1) {
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
          event.preventDefault();
          event.stopImmediatePropagation();
          const step = event.code === 'ArrowDown' ? 1 : -1;
          setChoiceSelected((current) => (current + step + chapterChoices.length) % chapterChoices.length);
          return;
        }
        if (event.code === 'Enter') {
          event.preventDefault();
          event.stopImmediatePropagation();
          goChapter(chapterChoices[choiceSelected] ?? chapterChoices[0]!);
        }
        return;
      }
      const target = event.code === 'KeyN' ? nextChapter : event.code === 'KeyB' ? prevChapter : '';
      if (!target || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      goChapter(target);
    };
    window.addEventListener('keydown', onChapterKey, true);
    return () => window.removeEventListener('keydown', onChapterKey, true);
  }, [chapterChoices, choiceSelected, nextChapter, prevChapter, universe]);

  // v4.2：触控/鼠标结局点击——右半屏下一章、左半屏上一章（桌面 N/B 仍保留）。
  useEffect(() => {
    const onClickChapter = (event: MouseEvent): void => {
      if (!universe?.state.ended || screenRef.current !== 'strings') return;
      if (chapterChoices.length > 1) return; // 多出口用选择列表
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-testid="matrix-field"], [data-testid="spectrum-field"]')) return;
      const chapter = event.clientX >= window.innerWidth / 2 ? nextChapter : prevChapter;
      if (!chapter) return;
      event.preventDefault();
      event.stopPropagation();
      goChapter(chapter);
    };
    window.addEventListener('click', onClickChapter, true);
    return () => window.removeEventListener('click', onClickChapter, true);
  }, [chapterChoices, nextChapter, prevChapter, universe]);

  // v4.4：Backquote 打开 0..9 存档槽淡列表；上下选择，Enter 切换/新建。
  useEffect(() => {
    const onSlotKey = (event: KeyboardEvent): void => {
      if (event.code === 'Backquote' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (slotMenuOpen) {
          setSlotMenuOpen(false);
        } else if (screenRef.current === 'strings') {
          setSlotInfos(readAllSlots(WORLD_FILE, INITIAL_SEED));
          setSlotSelected(RUN_SLOT);
          setSlotMenuOpen(true);
        }
        return;
      }
      if (!slotMenuOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') {
        setSlotMenuOpen(false);
      } else if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        const step = event.code === 'ArrowDown' ? 1 : -1;
        setSlotSelected((current) => (current + step + 10) % 10);
      } else if (event.code === 'Enter') {
        saveRunRef.current();
        const saved = readRunSave(WORLD_FILE, INITIAL_SEED, slotSelected);
        const mode = saved ? 'resume=1' : 'fresh=1';
        window.location.assign(
          `${window.location.pathname}?world=${encodeURIComponent(WORLD_FILE)}&seed=${INITIAL_SEED}&slot=${slotSelected}&${mode}`,
        );
      }
    };
    window.addEventListener('keydown', onSlotKey, true);
    return () => window.removeEventListener('keydown', onSlotKey, true);
  }, [slotMenuOpen, slotSelected]);

  // v4.6：F9 显示章节路线图；Esc/F9 关闭。
  useEffect(() => {
    const onGraphKey = (event: KeyboardEvent): void => {
      if (event.code === 'F9' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (memoryMode) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setMemoryFxOpen((open) => !open);
          return;
        }
        if (!event.shiftKey) return;
        if (!chapterGraphOpen && screenRef.current !== 'strings') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setChapterGraphOpen((open) => !open);
        return;
      }
      if (!chapterGraphOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') setChapterGraphOpen(false);
    };
    window.addEventListener('keydown', onGraphKey, true);
    return () => window.removeEventListener('keydown', onGraphKey, true);
  }, [chapterGraphOpen, memoryMode]);

  // v1.6：F10 进入全屏可绘制流场；流场内部自己处理 F10/Esc 退出。
  useEffect(() => {
    const onFlowKey = (event: KeyboardEvent): void => {
      if (flowMode) return;
      if (event.code === 'F10' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPreviewOpen(false);
        setFlowMode(true);
      }
    };
    window.addEventListener('keydown', onFlowKey, true);
    return () => window.removeEventListener('keydown', onFlowKey, true);
  }, [flowMode]);

  // v1.7：F12 记忆模式；其他元素界面切换时自动退出。
  useEffect(() => {
    const onMemoryKey = (event: KeyboardEvent): void => {
      if (event.code !== 'F12' || event.altKey || event.ctrlKey || event.metaKey) return;
      if (flowMode || startOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!memoryMode) setMemoryKind(focusKind);
      setMemoryMode((value) => !value);
    };
    window.addEventListener('keydown', onMemoryKey, true);
    return () => window.removeEventListener('keydown', onMemoryKey, true);
  }, [flowMode, startOpen, memoryMode, focusKind]);

  useEffect(() => {
    if (memoryMode) setMemoryKind(focusKind);
  }, [focusKind, memoryMode]);

  useEffect(() => {
    if (
      memoryMode &&
      (screen === 'matrix' ||
        ruleOpen ||
        helpOpen ||
        chapterGraphOpen ||
        sceneMenuOpen ||
        slotMenuOpen)
    ) {
      setMemoryMode(false);
      setMemoryFxOpen(false);
    }
  }, [memoryMode, screen, ruleOpen, helpOpen, chapterGraphOpen, sceneMenuOpen, slotMenuOpen]);

  useEffect(() => {
    if (!memoryMode || screen !== 'strings' || memoryFxOpen || flowMode) return;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.code !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMemoryMode(false);
      setMemoryFxOpen(false);
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [memoryMode, screen, memoryFxOpen, flowMode]);

  const createLocalWorld = (name: string, source: string, enter = true): void => {
    const id = `w${Date.now().toString(36)}`;
    const worlds = [...readLocalWorlds(), { id, name, source, createdAt: Date.now() }];
    writeLocalWorlds(worlds);
    setLocalWorlds(worlds);
    if (enter) window.location.assign(`?world=${encodeURIComponent(`local:${id}`)}&fresh=1`);
  };

  const createFromWizard = (name: string, template: WorldTemplate): void => {
    const templateSource =
      template === 'game'
        ? (BUNDLED_PROJECT['examples/ten-minute.nro'] ?? bundledSource)
        : template === 'testbed'
          ? bundledSource
          : `世界 ${name}\n  版本 0.1\n  调性 小调\n\n叙事弦 状态\n  类型 数值 0..100\n  基线 50\n`;
    const source = templateSource.replace(/^世界\s+.*$/m, `世界 ${name}`);
    setWorldWizardOpen(false);
    createLocalWorld(name, source);
  };

  const renameLocalWorld = (item: StartItem): void => {
    const id = item.localId;
    if (!id) return;
    const name = window.prompt('重命名世界', item.label)?.trim();
    if (!name) return;
    const worlds = readLocalWorlds().map((world) =>
      world.id === id
        ? { ...world, name, source: world.source.replace(/^世界\s+.*$/m, `世界 ${name}`) }
        : world,
    );
    writeLocalWorlds(worlds);
    setLocalWorlds(worlds);
    if (WORLD_FILE === `local:${id}`) window.location.reload();
  };

  const deleteLocalWorld = (item: StartItem): void => {
    const id = item.localId;
    if (!id) return;
    if (!window.confirm(`删除世界「${item.label}」？`)) return;
    const worlds = readLocalWorlds().filter((world) => world.id !== id);
    writeLocalWorlds(worlds);
    setLocalWorlds(worlds);
    if (WORLD_FILE === `local:${id}`) window.location.assign('?fresh=1');
  };

  const importWorldFile = async (file: File): Promise<void> => {
    const text = await file.text();
    const check = compileText(text, file.name);
    if (!check.ok) {
      setSaveError(check.diagnostics.errors[0]?.message ?? '导入失败：DSL 编译错误');
      setSaveState('error');
      return;
    }
    const name = text.match(/^\s*世界\s+(.+)$/m)?.[1]?.trim() || file.name.replace(/\.nro$/, '');
    createLocalWorld(name, text);
  };

  useEffect(() => {
    if (!source) return;
    for (const line of source.split(/\r?\n/)) {
      if (line.startsWith(OVERLAY_AUDIO_PREFIX)) {
        const rest = line.slice(OVERLAY_AUDIO_PREFIX.length);
        const space = rest.indexOf(' ');
        if (space < 0) continue;
        const kind = rest.slice(0, space) as StringKind;
        try {
          const effects = JSON.parse(rest.slice(space + 1)) as Partial<KindEffects>;
          if (KIND_ORDER.includes(kind)) getStringAudio().setKindEffects(kind, effects);
        } catch {
          /* 忽略损坏的音频侧车 */
        }
      } else if (line.startsWith(OVERLAY_FLOW_PREFIX)) {
        const rest = line.slice(OVERLAY_FLOW_PREFIX.length);
        const space = rest.indexOf(' ');
        if (space < 0) continue;
        const kind = rest.slice(0, space);
        try {
          const nodes = JSON.parse(rest.slice(space + 1)) as unknown;
          if (Array.isArray(nodes)) {
            window.localStorage.setItem(`neurou.flow.nodes:${WORLD_FILE}:${kind}`, JSON.stringify({ nodes }));
          }
        } catch {
          /* 忽略损坏的流场侧车 */
        }
      }
    }
  }, [source]);

  const chooseStart = (item: StartItem): void => {
    if (startLeaving) return;
    setStartLeaving(true);
    window.setTimeout(() => {
      setStartOpen(false);
      setStartLeaving(false);
      if (item.id === 'graph') setChapterGraphOpen(true);
      else if (item.id === 'help') setHelpOpen(true);
      else if (item.file) window.location.assign(`?world=${encodeURIComponent(item.file)}&fresh=1`);
    }, 470);
  };

  const dslContext = useMemo(() => {
    const text = (source ?? '').replace(/\r\n?/g, '\n');
    const blockOf = (span: { start: { offset: number }; end: { offset: number } } | undefined): string =>
      span ? text.slice(span.start.offset, span.end.offset).trimEnd() : '';
    let label = '世界声明';
    let block = '';
    let readOnly = false;
    let kind: 'source' | 'flow' = 'source';
    if (flowMode) {
      label = `流场 · ${focusKind} · .nrm`;
      kind = 'flow';
      try {
        const raw = window.localStorage.getItem(`neurou.flow.nodes:${WORLD_FILE}:${focusKind}`);
        const nodes = raw ? JSON.parse(raw) : null;
        block = JSON.stringify({ version: 1, target: focusKind, nodes: nodes?.nodes ?? [] }, null, 2);
      } catch {
        block = JSON.stringify({ version: 1, target: focusKind, nodes: [] }, null, 2);
      }
    } else if (screen === 'spectrum' && worldIR) {
      const spectrum = worldIR.spectra[Math.min(spectrumIndex, worldIR.spectra.length - 1)];
      if (spectrum) {
        label = `谱 · ${spectrum.name}`;
        block = blockOf(spectrum.span);
      }
    } else if (screen === 'matrix' && worldIR) {
      const matrix = worldIR.matrices[Math.min(matrixIndex, worldIR.matrices.length - 1)];
      if (matrix) {
        label = `关系谱 · ${matrix.name}`;
        block = blockOf(matrix.span);
      }
    } else if (worldIR) {
      const string = worldIR.strings.find((item) => item.kind === focusKind);
      if (string) {
        label = `${focusKind}弦 · ${string.name}`;
        block = blockOf(string.span);
      }
    }
    if (!block) readOnly = true;
    if (!block) block = `# ${label}\n# 当前界面没有可独立编辑的 DSL 块。`;
    return { label, block, readOnly, text, kind };
  }, [source, worldIR, screen, spectrumIndex, matrixIndex, focusKind, flowMode]);

  const applyDsl = (next: string): void => {
    if (dslContext.kind === 'flow') {
      try {
        const parsed = JSON.parse(next) as { nodes?: unknown };
        if (!Array.isArray(parsed.nodes)) throw new Error('缺少 nodes 数组');
        window.localStorage.setItem(`neurou.flow.nodes:${WORLD_FILE}:${focusKind}`, JSON.stringify({ nodes: parsed.nodes }));
        const marker = `# @neurou:flow:${focusKind} `;
        const lines = (source ?? '').split(/\r?\n/).filter((line) => !line.startsWith(marker));
        lines.unshift(`${marker}${JSON.stringify(parsed.nodes)}`);
        const nextSource = lines.join('\n');
        void (async () => {
          if (await writeFile(nextSource)) {
            apply(nextSource);
            savedText.current = nextSource;
          }
          setDslError('');
          setDslOpen(false);
        })();
      } catch (error) {
        setDslError(error instanceof Error ? error.message : 'FlowNode JSON 无效');
      }
      return;
    }
    if (dslContext.readOnly || !source) return;
    const current = dslContext.text;
    const labelIndex = current.indexOf(dslContext.block);
    if (labelIndex < 0) {
      setDslError('无法定位当前元素声明，请刷新后重试');
      return;
    }
    const nextSource = current.slice(0, labelIndex) + next + current.slice(labelIndex + dslContext.block.length);
    const check = compileText(nextSource, `${WORLD_FILE}.f7`);
    if (!check.ok) {
      setDslError(check.diagnostics.errors[0]?.message ?? 'DSL 编译失败');
      return;
    }
    void (async () => {
      if (!(await writeFile(nextSource))) {
        setDslError('写回失败');
        return;
      }
      undoStack.current.push(savedText.current);
      savedText.current = nextSource;
      redoStack.current = [];
      setUndoDepth(undoStack.current.length);
      setRedoDepth(0);
      setSaves((count) => count + 1);
      setSaveMode('f7-dsl');
      setSaveError('');
      setSaveState('saved');
      setDslError('');
      setDslOpen(false);
      apply(nextSource);
    })();
  };

  const enterStart = (): void => {
    if (startOpen) return;
    setStartEntering(true);
    setStartOpen(true);
    window.setTimeout(() => setStartEntering(false), 520);
  };
  useEffect(() => {
    const visualPorts = (worldIR?.ports ?? []).filter((port) => port.kind === '视觉');
    if (visualPorts.length === 0 || !universe) {
      setGlslArtifacts([]);
      setGlslStatus('');
      setGlslError('');
      return;
    }
    const artifacts: GlslArtifact[] = [];
    const errors: string[] = [];
    for (const port of visualPorts) {
      const params: Record<string, ReturnType<typeof universe.get>> = {};
      for (const param of port.params) params[param.name] = universe.get(param.string);
      const compiled = compileGlsl({
        id: port.id,
        name: port.name,
        kind: port.kind,
        params,
        ...(port.texture ? { texture: port.texture } : {}),
        ...(port.textureAsset ? { textureAsset: port.textureAsset } : {}),
      });
      if (compiled.artifact) artifacts.push(compiled.artifact);
      if (!compiled.result.ok) errors.push(`${port.name}: ${compiled.result.error}`);
    }
    setGlslArtifacts(artifacts);
    setGlslStatus(errors.length === 0 ? 'ok' : 'error');
    setGlslError(errors.join('; '));
  }, [worldIR, universe]);

  // v5.8：音频端口 → Faust 源码；只生成源码，真正编译/发声由未来 Host 服务负责。
  useEffect(() => {
    const audioPorts = (worldIR?.ports ?? []).filter((port) => port.kind === '音频');
    if (audioPorts.length === 0 || !universe) {
      setFaustArtifact(null);
      setFaustStatus('');
      setFaustError('');
      return;
    }
    const first = audioPorts[0]!;
    const params: Record<string, ReturnType<typeof universe.get>> = {};
    for (const param of first.params) params[param.name] = universe.get(param.string);
    const compiled = compileFaust({ id: first.id, name: first.name, kind: first.kind, params });
    setFaustArtifact(compiled.artifact);
    setFaustStatus(compiled.result.ok ? 'source' : 'error');
    setFaustError(compiled.result.ok ? '' : compiled.result.error);
  }, [worldIR, universe]);

  // v5.28/v5.32/v5.33：每个音频端口一个真实 Faust 节点；失败回退正弦兜底。
  useEffect(() => {
    const audioPorts = (worldIR?.ports ?? []).filter((port) => port.kind === '音频');
    let cancelled = false;
    const stopAll = (): void => {
      for (const host of faustWasmRef.current) host.dispose();
      for (const fallback of faustAudioRef.current) fallback.stop();
      faustWasmRef.current = [];
      faustAudioRef.current = [];
      setFaustRuntime('stopped');
      setFaustAudioState('stopped');
      setFaustNodes(0);
    };
    if (
      !previewOpen ||
      faustStatus !== 'source' ||
      audioPorts.length === 0 ||
      !universe ||
      audioPref.muted ||
      audioPref.volume <= 0
    ) {
      stopAll();
      if (!previewOpen || audioPref.muted || audioPref.volume <= 0) setFaustCompile('');
      return stopAll;
    }
    const values = audioPorts.map((port) => {
      const list: number[] = [];
      for (const param of port.params) {
        const value = universe.get(param.string);
        list.push(typeof value === 'number' ? value : 0);
      }
      return list;
    });
    const artifacts = audioPorts.map((port) => {
      const params: Record<string, ReturnType<typeof universe.get>> = {};
      for (const param of port.params) params[param.name] = universe.get(param.string);
      return compileFaust({ id: port.id, name: port.name, kind: port.kind, params }).artifact;
    });
    const hosts = audioPorts.map(() => new FaustWasmHost());
    const fallbacks = audioPorts.map(() => new FaustFallback());
    faustWasmRef.current = hosts;
    faustAudioRef.current = fallbacks;
    void Promise.all(
      hosts.map(async (host, index) => {
        const ok = await host.start(artifacts[index]!, values[index]!, audioPref.volume);
        if (!ok) fallbacks[index]!.start(values[index]!, audioPref.volume);
        return ok;
      }),
    ).then((results) => {
      if (cancelled) return;
      const real = results.filter(Boolean).length;
      setFaustNodes(real);
      setFaustCompile(
        hosts.every((host) => host.compiled) ? 'ok' : hosts.find((host) => host.compileError)?.compileError || 'error',
      );
      if (real === hosts.length) {
        setFaustRuntime('faust-wasm');
        setFaustAudioState(hosts[0]?.state ?? 'playing');
      } else if (real > 0) {
        setFaustRuntime('mixed');
        setFaustAudioState(hosts.find((host) => host.state !== 'stopped')?.state ?? 'playing');
      } else {
        setFaustRuntime('webaudio-fallback');
        setFaustAudioState(fallbacks[0]?.state ?? 'stopped');
      }
    });
    return () => {
      cancelled = true;
      for (const host of hosts) host.dispose();
      for (const fallback of fallbacks) fallback.stop();
      setFaustRuntime('stopped');
      setFaustAudioState('stopped');
      setFaustNodes(0);
    };
  }, [previewOpen, faustStatus, audioPref.muted, audioPref.volume, worldIR, universe]);

  // v5.33：每拍把端口参数写进 Faust 参数路径。
  useEffect(() => {
    const audioPorts = (worldIR?.ports ?? []).filter((port) => port.kind === '音频');
    if (!universe) return;
    audioPorts.forEach((port, index) => {
      const automation = universe.observe().ports[port.id]?.automation ?? 1;
      const values = port.params.map((param) => {
        const value = universe.get(param.string);
        return typeof value === 'number' ? value * automation : 0;
      });
      faustWasmRef.current[index]?.update(values);
      faustAudioRef.current[index]?.update(values, audioPref.volume);
    });
  }, [frame, worldIR, universe, audioPref.volume]);

  useEffect(() => () => {
    for (const host of faustWasmRef.current) host.dispose();
    for (const fallback of faustAudioRef.current) fallback.stop();
  }, []);

  useEffect(() => {
    const onPreviewKey = (event: KeyboardEvent): void => {
      if (flowMode) return;
      if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey) return;
      if (screenRef.current !== 'strings') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPreviewOpen((open) => !open);
    };
    window.addEventListener('keydown', onPreviewKey, true);
    return () => window.removeEventListener('keydown', onPreviewKey, true);
  }, [flowMode]);

  // v5.10：F8 切换运行场景；只在世界有多个场景时生效。
  useEffect(() => {
    const onSceneKey = (event: KeyboardEvent): void => {
      if (!universe) return;
      const scenes = universe.scenes();
      if (event.code === 'F8' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (scenes.length === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (sceneMenuOpen) {
          setSceneMenuOpen(false);
        } else {
          const current = scenes.findIndex((scene) => scene.id === universe.currentSceneId);
          setSceneSelected(Math.max(0, current));
          setSceneMenuOpen(true);
        }
        return;
      }
      if (!sceneMenuOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') {
        setSceneMenuOpen(false);
      } else if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        const step = event.code === 'ArrowDown' ? 1 : -1;
        setSceneSelected((current) => (current + step + scenes.length) % scenes.length);
      } else if (event.code === 'Enter') {
        const scene = scenes[sceneSelected];
        if (scene && universe.transitionScene(scene.id)) setVersion((value) => value + 1);
        setSceneMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onSceneKey, true);
    return () => window.removeEventListener('keydown', onSceneKey, true);
  }, [sceneMenuOpen, sceneSelected, universe]);

  // v3.6：音量/静音只改本地 master gain，不进入世界状态；F4 循环四档。
  useEffect(() => {
    const audio = getStringAudio();
    audio.setVolume(audioPref.volume);
    audio.setMuted(audioPref.muted);
    try {
      window.localStorage.setItem(AUDIO_PREF_KEY, String(audioLevel(audioPref)));
    } catch {
      /* 隐私模式 */
    }
  }, [audioPref]);

  useEffect(() => {
    const onAudioKey = (event: KeyboardEvent): void => {
      if (event.code !== 'F4' || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      setAudioPref((previous) => {
        const current = audioLevel(previous);
        const index = AUDIO_LEVELS.findIndex((level) => Math.abs(level - current) < 0.001);
        const next = AUDIO_LEVELS[(index + 1 + AUDIO_LEVELS.length) % AUDIO_LEVELS.length] ?? 1;
        return next === 0 ? { volume: 1, muted: true } : { volume: next, muted: false };
      });
    };
    window.addEventListener('keydown', onAudioKey, true);
    return () => window.removeEventListener('keydown', onAudioKey, true);
  }, []);

  // 首屏稳定后预取 F2/F3 组件：主包首屏更轻，按键时已经加载好。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./MatrixField.js');
      void import('./SpectrumField.js');
    }, 350);
    return () => window.clearTimeout(timer);
  }, []);

  // 撤销/重做缓动：每帧重绘插值后的 lanes，结束时应用目标文本并等待新世界就绪。
  useEffect(() => {
    if (!transition) return;
    let raf = 0;
    let finished = false;
    const step = (): void => {
      const elapsed = performance.now() - transition.start;
      if (elapsed < transition.duration) {
        setFrame((v) => v + 1);
        raf = window.requestAnimationFrame(step);
        return;
      }
      if (!finished) {
        finished = true;
        finishRef.current = transition;
        setFrame((v) => v + 1);
        applyRef.current(transition.text);
      }
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [transition]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (screen === 'spectrum' && (worldIR?.spectra.length ?? 0) === 0) setScreen('strings');
  }, [screen, worldIR]);

  const lanes = useMemo(() => {
    if (transition) {
      const raw = Math.min(1, Math.max(0, (performance.now() - transition.start) / transition.duration));
      return interpolateLanes(transition.from, transition.to, easeInOutCubic(raw));
    }
    return universe && worldIR ? collectLanes(universe, worldIR, selected) : [];
  }, [universe, worldIR, version, selected, transition, frame]);

  const writeFile = async (text: string): Promise<boolean> => {
    if (isLocalWorldFile(WORLD_FILE)) {
      const id = WORLD_FILE.slice('local:'.length);
      const worlds = readLocalWorlds();
      const next = worlds.map((world) => (world.id === id ? { ...world, source: text } : world));
      writeLocalWorlds(next);
      return next.some((world) => world.id === id);
    }
    if (!DEV) {
      setSaveState('disabled');
      return false;
    }
    try {
      const response = await fetch('/__neurou/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: WORLD_FILE, text }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      return response.ok && Boolean(payload.ok);
    } catch {
      return false;
    }
  };

  /** 写回闸门：先尝试行级 patch（保注释/排版），失败回退规范序列化；结果必须编译通过。 */
  const doSave = async (): Promise<void> => {
    if (!DEV && !isLocalWorldFile(WORLD_FILE)) {
      setSaveState('disabled');
      return;
    }
    const latestIR = worldIRRef.current;
    if (!latestIR || !universe || saving.current) return;
    saving.current = true;
    setSaveState('saving');
    try {
      const candidate = withCurrentBaselines(latestIR, universe);
      let text: string | null = null;
      // v5.47：模块世界只允许入口文件的弦字段写回；模块/其它结构保持只读。
      if (projectMode) {
        const baseSource = baseText.current;
        const baseProjectIR = baseIR.current;
        if (!baseSource || !baseProjectIR) {
          setSaveError('模块世界缺少入口源文本');
          setSaveState('error');
          return;
        }
        const baseCompiled = compileProjectFromFiles(WORLD_FILE, { ...projectSources, [WORLD_FILE]: baseSource });
        const entryOffset = baseCompiled.entryOffset;
        if (typeof entryOffset !== 'number') {
          setSaveError('模块世界缺少入口偏移');
          setSaveState('error');
          return;
        }
        const entryBase = projectEntryStrings(WORLD_FILE, baseSource, baseProjectIR);
        const baseEntryIds = new Set(entryBase.map((string) => string.id));
        const baseProjectIds = new Set(baseProjectIR.strings.map((string) => string.id));
        const moduleIds = new Set(
          baseProjectIR.strings.filter((string) => !baseEntryIds.has(string.id)).map((string) => string.id),
        );
        const addedEntry = candidate.strings.filter((string) => !baseProjectIds.has(string.id));
        const moduleChanged =
          [...moduleIds].some((id) => {
            const before = baseProjectIR.strings.find((string) => string.id === id);
            const after = candidate.strings.find((string) => string.id === id);
            return !before || !after || JSON.stringify(before) !== JSON.stringify(after);
          }) ||
          candidate.strings.some((string) => {
            if (!moduleIds.has(string.id)) return false;
            const before = baseProjectIR.strings.find((item) => item.id === string.id);
            return !before || JSON.stringify(before) !== JSON.stringify(string);
          });
        if (moduleChanged) {
          setSaveError('模块内的弦是只读的；只能在入口文件里编辑');
          setSaveState('error');
          return;
        }
        // v1.0：入口声明视图——弦/谱/关系谱/耦合等所有入口声明。
        const baseView = projectEntryView(baseProjectIR, entryOffset, baseSource.length);
        const candidateView = projectEntryView(candidate, entryOffset, baseSource.length);
        candidateView.strings.push(...addedEntry);
        if (baseView.strings.length === 0 && baseView.spectra.length === 0 && baseView.couplings.length === 0) {
          setSaveError('入口文件没有可写回的结构');
          setSaveState('error');
          return;
        }
        const patch = patchWorldText(baseSource, baseView, candidateView);
        if (!patch.ok) {
          setSaveError(`入口写回失败：${patch.reason}`);
          setSaveState('error');
          return;
        }
        const check = compileProjectFromFiles(WORLD_FILE, { ...projectSources, [WORLD_FILE]: patch.text });
        if (!check.ok) {
          recordDiagnostic(check.diagnostics.errors[0]);
          return;
        }
        if (!(await writeFile(patch.text))) throw new Error('写回失败');
        baseText.current = patch.text;
        baseIR.current = check.ir;
        setSaveMode('patch');
        undoStack.current.push(savedText.current);
        savedText.current = patch.text;
        redoStack.current = [];
        setUndoDepth(undoStack.current.length);
        setRedoDepth(0);
        setSaveError('');
        setSaves((n) => n + 1);
        setSaveState('saved');
        return;
      }
      // 1) 行级 patch：只改被编辑的行，保留注释与排版
      if (baseText.current && baseIR.current) {
        const patch = patchWorldText(baseText.current, baseIR.current, candidate);
        if (patch.ok) {
          const check = compileText(patch.text, `${WORLD_FILE}.patch`);
          if (check.ok) {
            text = patch.text;
            baseText.current = patch.text;
            baseIR.current = check.ir;
            setSaveMode('patch');
          } else {
            console.info('[tuner] patch 编译失败，回退规范序列化');
          }
        } else {
          console.info('[tuner] patch 回退：', patch.reason);
        }
      }
      // 2) 回退：规范序列化整张图
      if (text === null) {
        text = serialize(candidate);
        setSaveMode('fallback');
      }
      if (isLocalWorldFile(WORLD_FILE) || WORLD_FILE.includes('testbed') || WORLD_FILE.includes('ten-minute')) {
        text = withRuntimeOverlay(text, WORLD_FILE);
      }
      const check = compileText(text, `${WORLD_FILE}.edit`);
      if (!check.ok) {
        const first = check.diagnostics.errors[0];
        recordDiagnostic(first);
        return;
      }
      baseText.current = text;
      baseIR.current = check.ir;
      if (!(await writeFile(text))) throw new Error('写回失败');
      undoStack.current.push(savedText.current);
      savedText.current = text;
      redoStack.current = [];
      setUndoDepth(undoStack.current.length);
      setRedoDepth(0);
      setSaveError('');
      setSaves((n) => n + 1);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    } finally {
      saving.current = false;
    }
  };

  const scheduleSave = (): void => {
    if (!DEV && !isLocalWorldFile(WORLD_FILE)) {
      setSaveState('disabled');
      return;
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void doSave();
    }, SAVE_DEBOUNCE_MS);
  };

  /** 启动撤销/重做缓动：先按目标文本算目标 lanes，再让画布插值过去。 */
  const beginTransition = (text: string, dir: UndoDirection): boolean => {
    if (!universe || !worldIRRef.current || transitionRef.current) return false;
    const targetCompiled = compileText(text, `${WORLD_FILE}.${dir}`);
    if (!targetCompiled.ok) return false;
    const targetUniverse = createEngine(targetCompiled.ir, { seed: INITIAL_SEED });
    const to = collectLanes(targetUniverse, targetCompiled.ir, selected);
    const next: UndoTransition = {
      dir,
      from: lanes,
      to,
      start: performance.now(),
      duration: UNDO_TRANSITION_MS,
      text,
    };
    transitionRef.current = next;
    setTransition(next);
    setFrame((v) => v + 1);
    return true;
  };

  const undo = async (): Promise<void> => {
    if (transitionRef.current) return;
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(savedText.current);
    if (!(await writeFile(previous))) {
      undoStack.current.push(previous);
      redoStack.current.pop();
      return;
    }
    savedText.current = previous;
    setUndoDepth(undoStack.current.length);
    setRedoDepth(redoStack.current.length);
    setSaveState('saved');
    setSaveError('');
    if (screenRef.current !== 'strings') apply(previous);
    else if (!beginTransition(previous, 'undo')) await reload();
  };

  const redo = async (): Promise<void> => {
    if (transitionRef.current) return;
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(savedText.current);
    if (!(await writeFile(next))) {
      redoStack.current.push(next);
      undoStack.current.pop();
      return;
    }
    savedText.current = next;
    setUndoDepth(undoStack.current.length);
    setRedoDepth(redoStack.current.length);
    setSaveState('saved');
    setSaveError('');
    if (screenRef.current !== 'strings') apply(next);
    else if (!beginTransition(next, 'redo')) await reload();
  };
  actions.current = { undo, redo };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) void actions.current.redo();
      else void actions.current.undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // F2：从八弦或关系谱进入谱模式；记忆模式下自动选当前弦类型绑定的音色谱。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'F2' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (screenRef.current === 'spectrum') return;
      const ir = worldIRRef.current;
      if ((ir?.spectra.length ?? 0) === 0) return;
      event.preventDefault();
      if (memoryMode && ir) {
        const targetKind = memoryMode ? memoryKind : focusKind;
        const bound = ir.strings.find((item) => item.kind === targetKind && item.timbre);
        const index = bound
          ? ir.spectra.findIndex((item) => item.id === bound.timbre || item.name === bound.timbre)
          : -1;
        setSpectrumIndex(index >= 0 ? index : 0);
      } else {
        setSpectrumIndex(0);
      }
      setScreen('spectrum');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [memoryMode, memoryKind, focusKind]);

  // F3：从八弦或谱模式进入关系谱矩阵（世界里至少有关系谱）。矩阵内的 F3/Esc 由 MatrixField 处理。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'F3' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (screenRef.current === 'matrix') return;
      if ((worldIRRef.current?.matrices.length ?? 0) === 0) return;
      event.preventDefault();
      setMatrixIndex(0);
      setScreen('matrix');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);


  // F7：当前界面元素的 DSL 声明编辑；Shift+F7 保留规则/动作编辑器。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'F7' || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) {
        setDslOpen(false);
        setRuleOpen((open) => !open);
      } else {
        setRuleOpen(false);
        setDslError('');
        setDslOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // 规则编辑器 / F7 DSL 打开时 Esc 关闭。
  useEffect(() => {
    if (!ruleOpen && !dslOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      setRuleOpen(false);
      setDslOpen(false);
      setDslError('');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [ruleOpen, dslOpen]);

  // F1 / ?：手势帮助层（无常驻文字）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      setHelpOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      setHelpOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen]);

  const recordDiagnostic = (diagnostic?: {
    code: string;
    message: string;
    span?: { start: { line: number } };
  }): void => {
    if (!diagnostic) {
      setSaveError('编辑后的世界编译不过去');
      setSaveErrorLine(null);
      setSaveState('error');
      return;
    }
    const line = diagnostic.span ? diagnostic.span.start.line + 1 : null;
    setSaveError(`${diagnostic.code}: ${diagnostic.message}${line ? ` · 第 ${line} 行` : ''}`);
    setSaveErrorLine(line);
    setSaveState('error');
  };

  const shell = (children: ReactNode | null, loading: boolean) => (
    <div
      className="ink-app"
      data-testid="ink-app"
      data-world-file={WORLD_FILE}
      data-project={projectMode ? 'true' : 'false'}
      data-engine-name={universe?.describe().name ?? ''}
      data-engine-strings={universe?.describe().strings ?? 0}
      data-engine-scenes={universe?.describe().scenes.join(',') ?? ''}
      data-engine-active-systems={universe?.describe().activeSystems.join(',') ?? ''}
      data-module-strings={[...moduleStringIds].join(',')}
      data-project-modules={projectModules.map((module) => module.path).join(',')}
      data-seed={INITIAL_SEED}
      data-version={__NEUROU_VERSION__}
      data-cue-audio={cueAudio}
      data-last-cue={lastCue}
      data-cue-assets={assetCues}
      data-last-cue-kind={lastCueKind}
      data-audio-volume={audioPref.volume}
      data-audio-muted={audioPref.muted ? 'true' : 'false'}
      data-audio-level={audioLevel(audioPref)}
      data-bgm={bgm?.asset ?? ''}
      data-bgm-volume={bgm?.volume ?? 0}
      data-bgm-loop={bgm?.loop ? 'true' : 'false'}
      data-bgm-src={bgmSrc ?? ''}
      data-next-chapter={nextChapter}
      data-prev-chapter={prevChapter}
      data-chapter-choices={chapterChoices.length}
      data-chapter-choice-selected={chapterChoices.length > 1 ? choiceSelected : ''}
      data-chapter-graph-open={chapterGraphOpen ? 'true' : 'false'}
      data-chapter-graph-nodes={CHAPTER_GRAPH.length}
      data-preview-open={previewOpen ? 'true' : 'false'}
      data-preview-scene={universe?.sceneName ?? ''}
      data-preview-tick={universe?.state.tick ?? 0}
      data-scene-menu-open={sceneMenuOpen ? 'true' : 'false'}
      data-scene-menu-selected={sceneMenuOpen ? sceneSelected : ''}
      data-scene-count={universe?.scenes().length ?? 0}
      data-glsl-status={glslStatus}
      data-glsl-ports={(worldIR?.ports ?? []).filter((port) => port.kind === '视觉').length}
      data-glsl-error={glslError}
      data-faust-audio={faustAudioState}
      data-faust-runtime={faustRuntime}
      data-faust-compile={faustCompile}
      data-faust-nodes={faustNodes}
      data-glsl-textures={(worldIR?.ports ?? [])
        .filter((port) => port.kind === '视觉')
        .map((port) => port.texture?.pattern ?? '棋盘')
        .join(',')}
      data-glsl-assets={(worldIR?.ports ?? [])
        .filter((port) => port.kind === '视觉' && port.textureAsset)
        .map((port) => port.textureAsset!.name)
        .join(',')}
      data-glsl-post-ports={(worldIR?.ports ?? []).filter((port) => port.kind === '视觉' && port.post).length}
      data-faust-status={faustStatus}
      data-faust-ports={(worldIR?.ports ?? []).filter((port) => port.kind === '音频').length}
      data-faust-automation={(worldIR?.ports ?? [])
        .filter((port) => port.kind === '音频' && port.automation)
        .map((port) => port.name)
        .join(',')}
      data-faust-error={faustError}
      data-chapter-title={chapterTitle}
      data-chapter-intro={chapterIntro ? 'true' : 'false'}
      data-slot-menu-open={slotMenuOpen ? 'true' : 'false'}
      data-slot-menu-selected={slotMenuOpen ? slotSelected : ''}
      data-resumed={resumed ? 'true' : 'false'}
      data-save-tick={savedTick}
      data-slot={RUN_SLOT}
      data-saves={saves}
      data-save-state={saveState}
      data-save-mode={saveMode}
      data-save-error={saveError}
      data-save-error-line={saveErrorLine ?? ''}
      data-help-open={helpOpen ? 'true' : 'false'}
      data-flow-mode={flowMode ? 'true' : 'false'}
      data-memory-mode={memoryMode ? 'true' : 'false'}
      data-start-open={startOpen ? 'true' : 'false'}
      data-undo-depth={undoDepth}
      data-redo-depth={redoDepth}
      data-coupling-edits={couplingEdits}
      data-coupling-adds={couplingAdds}
      data-coupling-removes={couplingRemoves}
      data-string-adds={stringAdds}
      data-string-removes={stringRemoves}
      data-screen={screen}
      data-focus-kind={focusKind}
      data-memory-kind={memoryKind}
      data-rule-editor-open={ruleOpen ? 'true' : 'false'}
      data-spectrum-index={spectrumIndex}
      data-spectrum-count={worldIR?.spectra.length ?? 0}
      data-spectrum-band-edits={bandEdits}
      data-matrix-index={matrixIndex}
      data-matrix-count={worldIR?.matrices.length ?? 0}
      data-matrix-cell-edits={matrixEdits}
      data-matrix-curve-edits={matrixCurveEdits}
      data-matrix-row-adds={matrixRowAdds}
      data-matrix-row-removes={matrixRowRemoves}
      data-matrix-col-adds={matrixColAdds}
      data-matrix-col-removes={matrixColRemoves}
      data-matrix-renames={matrixRenames}
      data-matrix-curve-adds={matrixCurveAdds}
      data-matrix-curve-removes={matrixCurveRemoves}
      data-matrix-timing-edits={matrixTimingEdits}
      data-last-coupling={lastCoupling ? JSON.stringify(lastCoupling) : ''}
      data-transition={transition ? transition.dir : ''}
      data-loading={loading ? 'true' : 'false'}
    >
      <div
        className={`scene-layer${startOpen ? ' scene-layer--start' : ''}${flowMode ? ' scene-layer--flow-hidden' : ''}${
          helpOpen || ruleOpen || chapterGraphOpen || sceneMenuOpen || slotMenuOpen ? ' scene-layer--inverted' : ''
        }`}
      >
        {flowMode ? null : children}
      </div>
      {flowMode ? (
        <FlowField
          worldFile={WORLD_FILE}
          targetKind={memoryMode ? memoryKind : focusKind}
          kinds={KIND_ORDER}
          onTargetKindChange={(kind) => {
            setFocusKind(kind);
            if (memoryMode) setMemoryKind(kind);
          }}
          onClose={() => setFlowMode(false)}
        />
      ) : null}
      {startOpen ? (
        <>
          <StartScreen
            items={startItems}
            onAddWorld={() => setWorldWizardOpen(true)}
            onRenameWorld={renameLocalWorld}
            onDeleteWorld={deleteLocalWorld}
            onImportWorld={() => importWorldRef.current?.click()}
            leaving={startLeaving}
            entering={startEntering}
            onChoose={chooseStart}
          />
          <input
            ref={importWorldRef}
            type="file"
            accept=".nro"
            style={{ display: 'none' }}
            data-testid="world-import-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importWorldFile(file);
              event.target.value = '';
            }}
          />
          {worldWizardOpen ? (
            <WorldWizard onCreate={createFromWizard} onClose={() => setWorldWizardOpen(false)} />
          ) : null}
        </>
      ) : null}
      {helpOpen ? (
        <Modal onClose={() => setHelpOpen(false)} className="help-modal" testId="help-modal">
          <div className="help-overlay" data-testid="help-overlay">
            <div className="help-overlay__title">操作说明 · 从世界到发布</div>
            <div className="help-section">
              <div className="help-section__title">1 · 进入世界</div>
              <div>初始界面 ↑/↓ 选择，→ 展开「世界」文件夹，Enter 进入；Esc 直接回默认调律台。</div>
            </div>
            <div className="help-section">
              <div className="help-section__title">2 · 调律弦</div>
              <div>Tab 切弦 · ←/→ 同类弦 · 拖动改基线 · 按住拨弦 · F2 谱 · F3 关系谱。</div>
            </div>
            <div className="help-section">
              <div className="help-section__title">3 · 编辑元素</div>
              <div>F7 当前元素 DSL · Shift+F7 规则/动作 · Shift+F9 章节路线。</div>
            </div>
            <div className="help-section">
              <div className="help-section__title">4 · 流场</div>
              <div>F10 进入全屏声场画布：鼠标拖拽、方向键移动、空格落笔、字母键映射声场，F10/Esc 返回。</div>
            </div>
            <div className="help-section">
              <div className="help-section__title">5 · 记忆与发布</div>
              <div>F11 节拍器可设 BPM 与每几拍响一次；F12 记忆模式录制当前界面演奏为循环声部，切换界面自动退出。完成后 pnpm build && pnpm release。</div>
            </div>
            <div
              data-modal-item
              data-modal-no-arrow
              tabIndex={0}
              role="button"
              onClick={() => setHelpOpen(false)}
              onKeyDown={() => undefined}
            >
              关闭
            </div>
          </div>
        </Modal>
      ) : null}
      {dslOpen ? (
        <ContextDslEditor
          context={dslContext.label}
          hint="当前界面元素对应的声明式源码；只替换这一块，编译通过后写回世界。"
          source={dslContext.block}
          readOnly={dslContext.readOnly}
          error={dslError}
          onApply={applyDsl}
          onClose={() => {
            setDslOpen(false);
            setDslError('');
          }}
        />
      ) : null}
      {ruleOpen ? (
        <Modal onClose={() => setRuleOpen(false)} className="rule-modal" testId="rule-modal">
          <RuleEditor
          rules={(() => {
            let rules = worldIR?.rules ?? [];
            if (projectMode && source && worldIR) {
              try {
                const base = compileProjectFromFiles(WORLD_FILE, projectSources);
                if (typeof base.entryOffset === 'number') {
                  rules = projectEntryView(worldIR, base.entryOffset, source.length).rules;
                }
              } catch {
                /* 项目入口视图不可用时只读主图规则 */
              }
            }
            return rules.map((rule) => ({
              id: rule.id,
              name: rule.name,
              kind: rule.kind,
              cost: rule.cost,
              priority: rule.priority,
              cooldown: rule.cooldown,
            }));
          })()}
          onAdjust={(id, field, delta) => {
            const current = worldIRRef.current;
            const rule = current?.rules.find((item) => item.id === id);
            if (!current || !rule) return;
            const result = setRuleNumberField(current, id, field, Math.max(0, rule[field] + delta));
            if (!result.ok) return;
            applyWorldIR(result.ir);
            scheduleSave();
          }}
          getSource={(id) => {
            const text = baseText.current;
            const ir = baseIR.current;
            if (!text || !ir) return '';
            let rule = ir.rules.find((item) => item.id === id);
            if (projectMode) {
              try {
                const base = compileProjectFromFiles(WORLD_FILE, { ...projectSources, [WORLD_FILE]: text });
                if (typeof base.entryOffset === 'number') {
                  rule = projectEntryView(ir, base.entryOffset, text.length).rules.find((item) => item.id === id);
                }
              } catch {
                return '';
              }
            }
            return rule ? (ruleBlockText(text, rule) ?? '') : '';
          }}
          onApplySource={(id, next) => {
            void (async () => {
              const text = baseText.current;
              const ir = baseIR.current;
              if (!text || !ir) return;
              let rule = ir.rules.find((item) => item.id === id);
              if (projectMode) {
                try {
                  const base = compileProjectFromFiles(WORLD_FILE, { ...projectSources, [WORLD_FILE]: text });
                  if (typeof base.entryOffset !== 'number') throw new Error('缺少入口偏移');
                  rule = projectEntryView(ir, base.entryOffset, text.length).rules.find((item) => item.id === id);
                } catch (error) {
                  setSaveError(String(error));
                  setSaveState('error');
                  return;
                }
              }
              if (!rule) {
                setSaveError('找不到入口规则');
                setSaveState('error');
                return;
              }
              const replaced = patchRuleBlockText(text, rule, next);
              if (!replaced.ok) {
                setSaveError(replaced.reason);
                setSaveState('error');
                return;
              }
              const check = projectMode
                ? compileProjectFromFiles(WORLD_FILE, { ...projectSources, [WORLD_FILE]: replaced.text })
                : compileText(replaced.text, `${WORLD_FILE}.rule-source`);
              if (!check.ok) {
                recordDiagnostic(check.diagnostics.errors[0]);
                return;
              }
              if (!(await writeFile(replaced.text))) throw new Error('写回失败');
              undoStack.current.push(savedText.current);
              savedText.current = replaced.text;
              redoStack.current = [];
              setUndoDepth(undoStack.current.length);
              setRedoDepth(0);
              setSaves((count) => count + 1);
              setSaveMode('rule-source');
              setSaveError('');
              setSaveState('saved');
              setRuleOpen(false);
              apply(replaced.text);
            })();
          }}
          errorLine={saveErrorLine ?? undefined}
          onClose={() => setRuleOpen(false)}
        />
        </Modal>
      ) : null}
            {chapterIntro && chapterTitle ? (
        <div className="chapter-intro" data-testid="chapter-intro">
          {chapterTitle}
        </div>
      ) : null}
      {chapterChoices.length > 1 && universe?.state.ended ? (
        <div className="chapter-choices" data-testid="chapter-choices">
          {chapterChoices.map((path, index) => (
            <span
              key={path}
              className={`chapter-choice${index === choiceSelected ? ' chapter-choice--selected' : ''}`}
              data-chapter-choice={path}
              onClick={(event) => {
                event.stopPropagation();
                goChapter(path);
              }}
            >
              {path.replace(/^examples\//, '').replace(/\.nro$/, '')}
            </span>
          ))}
        </div>
      ) : null}
      {chapterGraphOpen ? (
        <Modal onClose={() => setChapterGraphOpen(false)} className="chapter-modal" testId="chapter-modal">
          <div className="chapter-graph" data-testid="chapter-graph">
            <div className="chapter-graph-title">章节路线</div>
            {CHAPTER_GRAPH.length === 0 ? (
              <div className="chapter-graph-empty">这个世界还没有章节路线图。</div>
            ) : null}
            {CHAPTER_GRAPH.map((node) => (
              <div
                key={node.file}
                className={`chapter-graph-node${node.file === WORLD_FILE ? ' chapter-graph-node--current' : ''}`}
                data-chapter-file={node.file}
                data-modal-item
                data-modal-no-arrow
                role="button"
                tabIndex={0}
                onClick={() => goChapter(node.file)}
              >
                <span>{chapterLabel(node.file)}</span>
                {node.next.length > 0 ? (
                  <span className="chapter-graph-next">→ {node.next.map((file) => chapterLabel(file)).join(' / ')}</span>
                ) : null}
              </div>
            ))}
            <div
              className="chapter-graph-close"
              data-modal-item
              data-modal-no-arrow
              role="button"
              tabIndex={0}
              onClick={() => setChapterGraphOpen(false)}
            >
              关闭
            </div>
          </div>
        </Modal>
      ) : null}
      {sceneMenuOpen ? (
        <>
          <div className="popup-scrim" data-testid="scene-scrim" onMouseDown={() => setSceneMenuOpen(false)} />
          <div className="scene-menu" data-testid="scene-menu">
            {universe?.scenes().map((scene, index) => (
              <span
                key={scene.id}
                className={`scene-row${index === sceneSelected ? ' scene-row--selected' : ''}`}
                data-scene-row={scene.id}
              >
                {scene.name}
              </span>
            ))}
          </div>
        </>
      ) : null}
      {previewOpen && screen === 'strings' ? (
        <div
          className={`preview-mask${
            (worldIR?.ports ?? []).some((port) => port.texture?.pattern === '流场') ? ' preview-mask--flow' : ''
          }`}
          data-testid="preview-mask"
        >
          {glslStatus === 'ok'
            ? glslArtifacts.map((artifact, index) => (
                <GlslCanvas
                  key={`${index}-${artifact.bindings.map((binding) => binding.uniform).join(',')}`}
                  artifact={artifact}
                  postLevel={postLevel}
                  post={(worldIR?.ports ?? []).filter((port) => port.kind === '视觉')[index]?.post}
                  values={artifact.bindings.map((binding) => {
                    const value = universe?.get(binding.string);
                    return typeof value === 'number' ? value : 0;
                  })}
                />
              ))
            : null}
          <div className="preview-scene" data-testid="preview-scene">
            {universe?.sceneName || chapterTitle || worldIR?.name || ''}
          </div>
          <div className="preview-meta">
            {universe ? `第 ${universe.state.tick} 拍` : ''}
            {universe && universe.activeSystems().length > 0 ? ` · ${universe.activeSystems().join(' / ')}` : ''}
          </div>
          <div className="preview-cues">
            {previewCues.map((cue, index) => (
              <span key={`${index}-${cue}`}>{cue}</span>
            ))}
          </div>
          {faustStatus === 'source' && faustArtifact ? (
            <div className="preview-audio" data-testid="preview-audio">
              音频 {faustArtifact.name} ·{' '}
              {faustArtifact.bindings.map((binding) => `${binding.param} ${binding.control}`).join(' / ')}
              {' '}· WebAudio {faustAudioState}
            </div>
          ) : null}
          {projectMode ? (
            <div className="preview-modules" data-testid="preview-modules">
              {projectModules.map((module) => (
                <span key={module.path}>{module.path.replace(/^examples\//, '')}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {slotMenuOpen ? (
        <>
          <div className="popup-scrim" data-testid="slot-scrim" onMouseDown={() => setSlotMenuOpen(false)} />
          <div className="slot-menu" data-testid="slot-menu">
            {slotInfos.map((info) => (
              <span
                key={info.slot}
                className={`slot-row${info.slot === slotSelected ? ' slot-row--selected' : ''}`}
                data-slot-row={info.slot}
              >
                {info.slot} · {info.exists ? `${info.tick} 拍${info.ended ? ' · 完' : ''}` : '空'}
              </span>
            ))}
          </div>
        </>
      ) : null}
      <MemoryMode active={memoryMode} screen={screen} onExit={() => setMemoryMode(false)} />
      <MemoryEffects open={memoryMode && memoryFxOpen} kind={memoryMode ? memoryKind : focusKind} onClose={() => setMemoryFxOpen(false)} />
      <Metronome />
      <StringHighlight />
      <CursorLayer />
    </div>
  );

  if (!compiled) return shell(null, true);

  if (!compiled.ok) {
    return shell(
      <div className="ink-fatal" data-testid="ink-fatal">
        <div>{compiled.ir.name || '世界'} 编译不过去</div>
        {compiled.diagnostics.errors.slice(0, 6).map((d, i) => (
          <div key={i}>{d.message}</div>
        ))}
      </div>,
      false,
    );
  }

  if (!universe || !worldIR) return shell(null, true);

  const view: WorldView = {
    name: worldIR.name,
    tick: universe.state.tick,
    ended: universe.state.ended?.name ?? null,
    endedTick: universe.state.ended?.tick ?? null,
    actionsTaken: [...universe.stats.actionUsed.values()].reduce((sum, count) => sum + count, 0),
    lanes,
    couplings: couplingLanes(worldIR),
    actions: universe.availableActions().map((action) => ({
      id: action.id,
      name: action.name,
      cost: action.cost,
      ...(action.note ? { note: action.note } : {}),
    })),
  };

  const spectra: SpectrumView[] = worldIR.spectra.map((s) => ({
    id: s.id,
    name: s.name,
    bands: [...s.bands],
    min: s.min,
    max: s.max,
    interpolation: s.interpolation,
    loop: s.loop,
    mode: s.mode,
    articulation: s.articulation,
  }));

  const matrices: MatrixView[] = worldIR.matrices.map((m) => ({
    id: m.id,
    name: m.name,
    rows: [...m.rows],
    cols: [...m.cols],
    values: m.values.map((row) => [...row]),
    runtimeValues: m.rows.map((row) =>
      m.cols.map((col) => {
        const position = universe.getMatrixPosition(m.id);
        const value = universe.getMatrixCell(m.id, row, col, position);
        return typeof value === 'number' && Number.isFinite(value) ? value : 0;
      }),
    ),
    curves: (m.curves ?? []).map((c) => ({
      row: c.row,
      col: c.col,
      bands: [...c.bands],
      ...(c.interpolation ? { interpolation: c.interpolation } : {}),
      ...(c.loop !== undefined ? { loop: c.loop } : {}),
      ...(c.speed !== undefined ? { speed: c.speed } : {}),
      ...(c.phase !== undefined ? { phase: c.phase } : {}),
    })),
    interpolation: m.interpolation,
    loop: m.loop,
    ...(m.period !== undefined ? { period: m.period } : {}),
    speed: m.speed ?? 1,
    phase: m.phase ?? 0,
    ...(m.phaseSource ? { phaseSource: m.phaseSource } : {}),
  }));

  const onInject = (kind: StringKind, value: number, persist = false): void => {
    if (transitionRef.current) return;
    const lane = lanes.find((l) => l.kind === kind);
    if (!lane) return;
    if (moduleStringIds.has(lane.id)) {
      setSaveError('模块内的弦是只读的');
      setSaveState('error');
      return;
    }
    universe.inject(lane.id, value);
    setVersion((v) => v + 1);
    if (persist) scheduleSave();
  };

  /** v3.0：可玩层——把动作排队到下一拍；GUI 只发意图，规则由运行时执行。 */
  const performAction = (id: string): void => {
    if (transitionRef.current || !universe) return;
    if (universe.dispatch(id)) setVersion((v) => v + 1);
  };

  /** v3.0：结局后重开当前世界（不写回，只重建运行时）。 */
  const restartWorld = (): void => {
    const ir = worldIRRef.current ?? worldIR;
    if (!ir) return;
    setUniverse(createEngine(ir, { seed: INITIAL_SEED }));
    setPlayReset((n) => n + 1);
    setVersion((v) => v + 1);
  };

  const onEditWaveform = (stringId: string, waveform: number[]): void => {
    if (transitionRef.current) return;
    if (moduleStringIds.has(stringId)) {
      setSaveError('模块内的弦是只读的');
      setSaveState('error');
      return;
    }
    const current = worldIRRef.current;
    if (!current) return;
    const result = setStringWaveform(current, stringId, waveform);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    scheduleSave();
  };

  const onEditThreshold = (
    kind: StringKind,
    which: 'verge' | 'safe',
    value: number,
    persist = false,
  ): void => {
    if (transitionRef.current) return;
    const lane = lanes.find((l) => l.kind === kind);
    if (!lane) return;
    if (moduleStringIds.has(lane.id)) {
      setSaveError('模块内的弦是只读的');
      setSaveState('error');
      return;
    }
    const result = setStringThreshold(worldIR, lane.id, which, value);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setVersion((v) => v + 1);
    if (persist) scheduleSave();
  };

  /** 同类多根弦时，左右方向键切换这一类的哪一根（只切换视图，不改世界）。 */
  const onCycleString = (kind: StringKind, dir: 1 | -1): void => {
    if (transitionRef.current) return;
    const candidates = numericStringsByKind(worldIR)[kind];
    if (!candidates || candidates.length <= 1) return;
    const count = candidates.length;
    const current = selected[kind] ?? 0;
    setSelected({ ...selected, [kind]: ((current + dir) % count + count) % count });
  };

  /** 滚轮调一条耦合的强度（0..2）；写回前同样走编译闸门。 */
  const onEditCoupling = (from: string, to: string, strength: number, persist = false): void => {
    if (transitionRef.current) return;
    const result = setCouplingStrengthBetween(worldIR, from, to, strength);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    const updated = result.ir.couplings.find((c) => c.from === from && c.to === to);
    applyWorldIR(result.ir);
    setSaveError('');
    setCouplingEdits((n) => n + 1);
    setLastCoupling({ from, to, strength: updated?.strength ?? strength });
    setVersion((v) => v + 1);
    if (persist) scheduleSave();
  };

  /** Shift+Enter：已有方向上的耦合则删除，否则新增（默认同向 0.2）。 */
  const onToggleCoupling = (fromId: string, toId: string): void => {
    if (transitionRef.current) return;
    const existing = findCoupling(worldIR, fromId, toId);
    const result = existing ? removeCoupling(worldIR, fromId, toId) : addCoupling(worldIR, fromId, toId);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setCouplingEdits((n) => n + 1);
    if (existing) setCouplingRemoves((n) => n + 1);
    else setCouplingAdds((n) => n + 1);
    const updated = findCoupling(result.ir, fromId, toId);
    setLastCoupling({ from: fromId, to: toId, strength: updated?.strength ?? 0 });
    setVersion((v) => v + 1);
    scheduleSave();
  };

  /** 弦结构变化后重建 Universe（保留仍在的弦的当前值；新弦从基线开始）。 */
  const rebuildUniverse = (ir: WorldIR): void => {
    if (!universe) return;
    universe.replaceWorld(ir);
  };

  /** Alt+Enter：新增一根同类弦（继承焦点弦的类型/阈值/基线）。 */
  const onAddString = (focusId: string): void => {
    if (transitionRef.current) return;
    const result = addString(worldIR, focusId);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    rebuildUniverse(result.ir);
    setSaveError('');
    setStringAdds((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  /** Alt+Backspace：删除焦点弦；有引用/回路时 core 会拒绝。 */
  const onRemoveString = (focusId: string): void => {
    if (transitionRef.current) return;
    const result = removeString(worldIR, focusId);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    rebuildUniverse(result.ir);
    setSaveError('');
    setStringRemoves((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  /** 谱模式：拖动一个段值（persist 时 debounce 写回，patch 只改 段 行数字）。 */
  const onEditBand = (spectrumId: string, bandIndex: number, value: number, persist = false): void => {
    if (transitionRef.current) return;
    const result = setSpectrumBand(worldIR, spectrumId, bandIndex, value);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setBandEdits((n) => n + 1);
    setVersion((v) => v + 1);
    if (memoryMode) {
      const edited = result.ir.spectra.find((item) => item.id === spectrumId);
      if (edited) {
        getStringAudio().setKindTimbre(focusKind, edited.bands, edited.interpolation !== '阶跃', edited.loop);
      }
    }
    if (persist) scheduleSave();
  };

  /** 谱模式：插入/删除段点后整条写回。 */
  const onEditSpectrumBands = (spectrumId: string, bands: number[], persist = false): void => {
    if (transitionRef.current) return;
    const result = setSpectrumBands(worldIR, spectrumId, bands);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setBandEdits((n) => n + 1);
    setVersion((v) => v + 1);
    if (memoryMode) {
      const edited = result.ir.spectra.find((item) => item.id === spectrumId);
      if (edited) {
        getStringAudio().setKindTimbre(focusKind, edited.bands, edited.interpolation !== '阶跃', edited.loop);
      }
    }
    if (persist) scheduleSave();
  };

  const exitSpectrum = (): void => setScreen('strings');

  /** 矩阵模式：改一个格（persist 时 debounce 写回，patch 只改对应 `段` 行的数字）。 */
  const onEditMatrixCell = (matrixId: string, row: number, col: number, value: number, persist = false): void => {
    if (transitionRef.current) return;
    const result = setMatrixCell(worldIR, matrixId, row, col, value);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixEdits((n) => n + 1);
    setVersion((v) => v + 1);
    if (persist) scheduleSave();
  };

  /** 矩阵曲线：拖动某段后写回，patch 只改 `曲线` 行的数字。 */
  const onEditMatrixCurveBand = (
    matrixId: string,
    row: string,
    col: string,
    index: number,
    value: number,
    persist = false,
  ): void => {
    if (transitionRef.current) return;
    const result = setMatrixCurveBand(worldIR, matrixId, row, col, index, value);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixCurveEdits((n) => n + 1);
    setVersion((v) => v + 1);
    if (persist) scheduleSave();
  };

  /** 矩阵曲线：插入/删除节点后整条写回。 */
  const onEditMatrixCurveBands = (
    matrixId: string,
    row: string,
    col: string,
    bands: number[],
    persist = false,
  ): void => {
    if (transitionRef.current) return;
    const result = setMatrixCurveBands(worldIR, matrixId, row, col, bands);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixCurveEdits((n) => n + 1);
    setVersion((v) => v + 1);
    if (persist) scheduleSave();
  };

  const uniqueMatrixLabel = (existing: string[], prefix: string): string => {
    let i = 1;
    while (existing.includes(`${prefix}${i}`)) i += 1;
    return `${prefix}${i}`;
  };

  /** 矩阵结构编辑：行列增删/改名（结构变化走规范序列化）。 */
  const onAddMatrixRow = (matrixId: string, index: number): void => {
    const matrix = worldIR.matrices.find((m) => m.id === matrixId);
    if (!matrix) return;
    const label = uniqueMatrixLabel(matrix.rows, '新行');
    const result = addMatrixRow(worldIR, matrixId, label, index);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixRowAdds((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  const onRemoveMatrixRow = (matrixId: string, index: number): void => {
    const result = removeMatrixRow(worldIR, matrixId, index);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixRowRemoves((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  const onAddMatrixCol = (matrixId: string, index: number): void => {
    const matrix = worldIR.matrices.find((m) => m.id === matrixId);
    if (!matrix) return;
    const label = uniqueMatrixLabel(matrix.cols, '新列');
    const result = addMatrixCol(worldIR, matrixId, label, index);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixColAdds((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  const onRemoveMatrixCol = (matrixId: string, index: number): void => {
    const result = removeMatrixCol(worldIR, matrixId, index);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixColRemoves((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  const onRenameMatrixRow = (matrixId: string, index: number, label: string): void => {
    const result = renameMatrixRow(worldIR, matrixId, index, label);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixRenames((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  const onRenameMatrixCol = (matrixId: string, index: number, label: string): void => {
    const result = renameMatrixCol(worldIR, matrixId, index, label);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixRenames((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  const onAddMatrixCurve = (matrixId: string, row: string, col: string): void => {
    const result = addMatrixCurve(worldIR, matrixId, row, col);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixCurveAdds((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  const onRemoveMatrixCurve = (matrixId: string, row: string, col: string): void => {
    const result = removeMatrixCurve(worldIR, matrixId, row, col);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixCurveRemoves((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  const onEditMatrixTiming = (matrixId: string, speed: number, phase: number): void => {
    const result = setMatrixTiming(worldIR, matrixId, speed, phase);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    applyWorldIR(result.ir);
    setSaveError('');
    setMatrixTimingEdits((n) => n + 1);
    setVersion((v) => v + 1);
    scheduleSave();
  };

  return shell(
    screen === 'matrix' && matrices.length > 0 ? (
      <Suspense fallback={null}>
      <MatrixField
        matrices={matrices}
        index={Math.min(matrixIndex, matrices.length - 1)}
        tick={view.tick}
        onCycleMatrix={(dir) =>
          setMatrixIndex((current) => ((current + dir) % matrices.length + matrices.length) % matrices.length)
        }
        onEditCell={onEditMatrixCell}
        onEditCurveBand={onEditMatrixCurveBand}
        onEditCurveBands={onEditMatrixCurveBands}
        onAddRow={onAddMatrixRow}
        onRemoveRow={onRemoveMatrixRow}
        onAddCol={onAddMatrixCol}
        onRemoveCol={onRemoveMatrixCol}
        onRenameRow={onRenameMatrixRow}
        onRenameCol={onRenameMatrixCol}
        onAddCurve={onAddMatrixCurve}
        onRemoveCurve={onRemoveMatrixCurve}
        onEditTiming={onEditMatrixTiming}
        onExit={() => setScreen('strings')}
      />
      </Suspense>
    ) : screen === 'spectrum' && spectra.length > 0 ? (
      <Suspense fallback={null}>
      <SpectrumField
        spectra={spectra}
        index={Math.min(spectrumIndex, spectra.length - 1)}
        onCycleSpectrum={(dir) =>
          setSpectrumIndex((current) => ((current + dir) % spectra.length + spectra.length) % spectra.length)
        }
        onEditBand={onEditBand}
        onEditBands={onEditSpectrumBands}
        onExit={exitSpectrum}
      />
      </Suspense>
    ) : (
      <StringField
        view={view}
        onInject={onInject}
        onEditThreshold={onEditThreshold}
        onEditWaveform={onEditWaveform}
        readOnlyIds={[...moduleStringIds]}
        onCycleString={onCycleString}
        onEditCoupling={onEditCoupling}
        onToggleCoupling={onToggleCoupling}
        onAddString={onAddString}
        onRemoveString={onRemoveString}
        onPerformAction={performAction}
        onRestart={restartWorld}
        resetSignal={playReset}
        onExitToStart={
          helpOpen || ruleOpen || chapterGraphOpen ? undefined : enterStart
        }
        onFocusKindChange={setFocusKind}
        initialFocusKind={focusKind}
      />
    ),
    false,
  );
}
