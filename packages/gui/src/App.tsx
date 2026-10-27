import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addCoupling,
  addString,
  compileText,
  findCoupling,
  patchWorldText,
  removeCoupling,
  removeString,
  serialize,
  setCouplingStrengthBetween,
  setStringThreshold,
  setSpectrumBand,
  setMatrixCell,
  setMatrixCurveBand,
  type StringKind,
  type WorldIR,
} from '@neurou/core';
import { Universe } from '@neurou/runtime';
import { StringField } from './StringField.js';
import { SpectrumField, type SpectrumView } from './SpectrumField.js';
import { MatrixField, type MatrixView } from './MatrixField.js';
import type { Lane, WorldView } from './stringMath.js';
import { collectLanes, couplingLanes, numericStringsByKind, withCurrentBaselines } from './worldView.js';
import bundledSource from '../../../examples/tuner.nro?raw';

const TICK_MS = 480;
const DEFAULT_WORLD_FILE = 'examples/tuner.nro';
const SAVE_DEBOUNCE_MS = 700;
const DEV = import.meta.env.DEV;

/**
 * 用 `?world=examples/xxx.nro` 打开任意示例世界（仅 dev；生产包固定默认世界）。
 * 只认 examples/ 下的一层 .nro，避免路径穿越。
 */
function worldFileFromUrl(): string {
  if (!DEV) return DEFAULT_WORLD_FILE;
  const raw = new URLSearchParams(window.location.search).get('world');
  if (raw && /^examples\/[^/\\]+\.nro$/.test(raw)) return raw;
  return DEFAULT_WORLD_FILE;
}

const WORLD_FILE = worldFileFromUrl();

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
  const [source, setSource] = useState<string | null>(DEV ? null : bundledSource);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!DEV) return;
    let alive = true;
    fetchWorld(file)
      .then((text) => {
        if (alive) setSource(text);
      })
      .catch(() => {
        if (alive) setSource(bundledSource);
      });
    return () => {
      alive = false;
    };
  }, [file]);
  const reload = async (): Promise<void> => {
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
  const compiled = useMemo(() => (source ? compileText(source, WORLD_FILE) : null), [source, rev]);
  const [universe, setUniverse] = useState<Universe | null>(null);
  /** 编辑后的图（阈值等结构编辑在它上面生效），写回以它为准。 */
  const [worldIR, setWorldIR] = useState<WorldIR | null>(null);
  /** 同类多根弦时，每类当前选中的是第几根（ArrowLeft/ArrowRight 切换）。 */
  const [selected, setSelected] = useState<Partial<Record<StringKind, number>>>({});
  const [version, setVersion] = useState(0);
  const [saves, setSaves] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMode, setSaveMode] = useState<'patch' | 'fallback' | ''>('');
  const [saveError, setSaveError] = useState('');
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
  const [spectrumIndex, setSpectrumIndex] = useState(0);
  const [matrixIndex, setMatrixIndex] = useState(0);
  const [bandEdits, setBandEdits] = useState(0);
  const [matrixEdits, setMatrixEdits] = useState(0);
  const [matrixCurveEdits, setMatrixCurveEdits] = useState(0);
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
    setUniverse(new Universe(compiled.ir, { seed: 7 }));
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
      universe.tick();
      setVersion((v) => v + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [universe]);

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
    if (!DEV) {
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
      const check = compileText(text, `${WORLD_FILE}.edit`);
      if (!check.ok) {
        const first = check.diagnostics.errors[0];
        setSaveError(first ? `${first.code}: ${first.message}` : '编辑后的世界编译不过去');
        setSaveState('error');
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
    if (!DEV) {
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
    const targetUniverse = new Universe(targetCompiled.ir, { seed: 7 });
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

  // F2：从八弦进入谱模式（世界里至少有一条谱）。谱模式内的 F2/Esc 由 SpectrumField 处理。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'F2' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (screenRef.current !== 'strings') return;
      if ((worldIRRef.current?.spectra.length ?? 0) === 0) return;
      event.preventDefault();
      setSpectrumIndex(0);
      setScreen('spectrum');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // F3：从八弦进入关系谱矩阵（世界里至少有关系谱）。矩阵内的 F3/Esc 由 MatrixField 处理。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'F3' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (screenRef.current !== 'strings') return;
      if ((worldIRRef.current?.matrices.length ?? 0) === 0) return;
      event.preventDefault();
      setMatrixIndex(0);
      setScreen('matrix');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const shell = (children: ReactNode | null, loading: boolean) => (
    <div
      className="ink-app"
      data-testid="ink-app"
      data-world-file={WORLD_FILE}
      data-saves={saves}
      data-save-state={saveState}
      data-save-mode={saveMode}
      data-save-error={saveError}
      data-undo-depth={undoDepth}
      data-redo-depth={redoDepth}
      data-coupling-edits={couplingEdits}
      data-coupling-adds={couplingAdds}
      data-coupling-removes={couplingRemoves}
      data-string-adds={stringAdds}
      data-string-removes={stringRemoves}
      data-screen={screen}
      data-spectrum-index={spectrumIndex}
      data-spectrum-count={worldIR?.spectra.length ?? 0}
      data-spectrum-band-edits={bandEdits}
      data-matrix-index={matrixIndex}
      data-matrix-count={worldIR?.matrices.length ?? 0}
      data-matrix-cell-edits={matrixEdits}
      data-matrix-curve-edits={matrixCurveEdits}
      data-last-coupling={lastCoupling ? JSON.stringify(lastCoupling) : ''}
      data-transition={transition ? transition.dir : ''}
      data-loading={loading ? 'true' : 'false'}
    >
      {children}
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
    lanes,
    couplings: couplingLanes(worldIR),
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
    curves: (m.curves ?? []).map((c) => ({ row: c.row, col: c.col, bands: [...c.bands] })),
    interpolation: m.interpolation,
    loop: m.loop,
  }));

  const onInject = (kind: StringKind, value: number, persist = false): void => {
    if (transitionRef.current) return;
    const lane = lanes.find((l) => l.kind === kind);
    if (!lane) return;
    universe.inject(lane.id, value);
    setVersion((v) => v + 1);
    if (persist) scheduleSave();
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
    const next = new Universe(ir, { seed: 7 });
    for (const string of ir.strings) {
      const value = universe.get(string.id);
      if (typeof value === 'number') next.inject(string.id, value);
    }
    setUniverse(next);
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

  return shell(
    screen === 'matrix' && matrices.length > 0 ? (
      <MatrixField
        matrices={matrices}
        index={Math.min(matrixIndex, matrices.length - 1)}
        onCycleMatrix={(dir) =>
          setMatrixIndex((current) => ((current + dir) % matrices.length + matrices.length) % matrices.length)
        }
        onEditCell={onEditMatrixCell}
        onEditCurveBand={onEditMatrixCurveBand}
        onExit={() => setScreen('strings')}
      />
    ) : screen === 'spectrum' && spectra.length > 0 ? (
      <SpectrumField
        spectra={spectra}
        index={Math.min(spectrumIndex, spectra.length - 1)}
        onCycleSpectrum={(dir) =>
          setSpectrumIndex((current) => ((current + dir) % spectra.length + spectra.length) % spectra.length)
        }
        onEditBand={onEditBand}
        onExit={exitSpectrum}
      />
    ) : (
      <StringField
        view={view}
        onInject={onInject}
        onEditThreshold={onEditThreshold}
        onCycleString={onCycleString}
        onEditCoupling={onEditCoupling}
        onToggleCoupling={onToggleCoupling}
        onAddString={onAddString}
        onRemoveString={onRemoveString}
      />
    ),
    false,
  );
}
