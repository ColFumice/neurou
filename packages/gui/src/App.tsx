import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { compileText, serialize, setStringThreshold, type StringKind, type WorldIR } from '@neurou/core';
import { Universe } from '@neurou/runtime';
import { StringField } from './StringField.js';
import type { WorldView } from './stringMath.js';
import { collectLanes, withCurrentBaselines } from './worldView.js';
import bundledSource from '../../../examples/tuner.nro?raw';

const TICK_MS = 480;
const WORLD_FILE = 'examples/tuner.nro';
const SAVE_DEBOUNCE_MS = 700;
const DEV = import.meta.env.DEV;

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'disabled';

function fetchWorld(): Promise<string> {
  return fetch(`/__neurou/world?file=${encodeURIComponent(WORLD_FILE)}`, { cache: 'no-store' }).then(
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
function useWorldSource(): { source: string | null; rev: number; reload: () => Promise<void> } {
  const [source, setSource] = useState<string | null>(DEV ? null : bundledSource);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!DEV) return;
    let alive = true;
    fetchWorld()
      .then((text) => {
        if (alive) setSource(text);
      })
      .catch(() => {
        if (alive) setSource(bundledSource);
      });
    return () => {
      alive = false;
    };
  }, []);
  const reload = async (): Promise<void> => {
    if (!DEV) return;
    try {
      const text = await fetchWorld();
      setSource(text);
      // 撤销可能把文件写回与当前 source 相同的文本；用 rev 强制重编译，
      // 否则 source 不变 → compiled 不重算 → worldIR/画布停在编辑后的状态。
      setRev((r) => r + 1);
    } catch {
      /* 保持当前世界 */
    }
  };
  return { source, rev, reload };
}

/**
 * 调律台：一张白纸上叠着某个真实世界里的 8 类弦。
 * 视图之外的逻辑（编译、逐拍、注入、结构编辑、写回、撤销）都在这层；画布只负责乐器。
 */
export function App() {
  const { source, rev, reload } = useWorldSource();
  const compiled = useMemo(() => (source ? compileText(source, WORLD_FILE) : null), [source, rev]);
  const [universe, setUniverse] = useState<Universe | null>(null);
  /** 编辑后的图（阈值等结构编辑在它上面生效），写回以它为准。 */
  const [worldIR, setWorldIR] = useState<WorldIR | null>(null);
  const [version, setVersion] = useState(0);
  const [saves, setSaves] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const savedText = useRef('');
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const actions = useRef<{ undo: () => Promise<void>; redo: () => Promise<void> }>({
    undo: async () => {},
    redo: async () => {},
  });

  useEffect(() => {
    if (!compiled?.ok) return;
    setWorldIR(compiled.ir);
    setUniverse(new Universe(compiled.ir, { seed: 7 }));
    if (!savedText.current) savedText.current = source ?? '';
  }, [compiled, source]);

  useEffect(() => {
    if (!universe) return;
    const timer = window.setInterval(() => {
      if (universe.state.ended) return;
      universe.tick();
      setVersion((v) => v + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [universe]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const lanes = useMemo(
    () => (universe && worldIR ? collectLanes(universe, worldIR) : []),
    [universe, worldIR, version],
  );

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

  /** 写回闸门：序列化后必须重新编译通过，否则拒绝写文件。 */
  const doSave = async (): Promise<void> => {
    if (!DEV) {
      setSaveState('disabled');
      return;
    }
    if (!worldIR || !universe || saving.current) return;
    saving.current = true;
    setSaveState('saving');
    try {
      const candidate = withCurrentBaselines(worldIR, universe);
      const text = serialize(candidate);
      const check = compileText(text, `${WORLD_FILE}.edit`);
      if (!check.ok) {
        const first = check.diagnostics.errors[0];
        setSaveError(first ? `${first.code}: ${first.message}` : '编辑后的世界编译不过去');
        setSaveState('error');
        return;
      }
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

  const undo = async (): Promise<void> => {
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
    await reload();
  };

  const redo = async (): Promise<void> => {
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
    await reload();
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

  const shell = (children: ReactNode | null, loading: boolean) => (
    <div
      className="ink-app"
      data-testid="ink-app"
      data-world-file={WORLD_FILE}
      data-saves={saves}
      data-save-state={saveState}
      data-save-error={saveError}
      data-undo-depth={undoDepth}
      data-redo-depth={redoDepth}
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
  };

  const onInject = (kind: StringKind, value: number, persist = false): void => {
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
    const lane = lanes.find((l) => l.kind === kind);
    if (!lane) return;
    const result = setStringThreshold(worldIR, lane.id, which, value);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setWorldIR(result.ir);
    setSaveError('');
    setVersion((v) => v + 1);
    if (persist) scheduleSave();
  };

  return shell(
    <StringField view={view} onInject={onInject} onEditThreshold={onEditThreshold} />,
    false,
  );
}
