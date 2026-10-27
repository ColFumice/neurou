import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KIND_ORDER, compileText, serialize, type StringKind, type WorldIR } from '@neurou/core';
import { Universe } from '@neurou/runtime';
import { StringField } from './StringField.js';
import { clamp, type Lane, type WorldView } from './stringMath.js';
import bundledSource from '../../../examples/tuner.nro?raw';

const TICK_MS = 480;
const WORLD_FILE = 'examples/tuner.nro';
const SAVE_DEBOUNCE_MS = 700;
const DEV = import.meta.env.DEV;

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'disabled';

/**
 * 世界源码：dev 下用 fetch 读文件（写回后刷新能拿到新文件，不吃 Vite 的 import 缓存）；
 * 生产包用构建时内联的 raw 文本。读不到时退回内联文本，页面不会白屏。
 */
function useWorldSource(): string | null {
  const [source, setSource] = useState<string | null>(DEV ? null : bundledSource);
  useEffect(() => {
    if (!DEV) return;
    let alive = true;
    fetch(`/__neurou/world?file=${encodeURIComponent(WORLD_FILE)}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
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
  return source;
}

/**
 * 把世界里的弦投影成调律台的 8 根弦：
 * 每类弦取第一根数值弦；基线纵坐标 = 归一化值；阈值归一化后作为共振点。
 */
export function collectLanes(universe: Universe, ir: WorldIR): Lane[] {
  const lanes: Lane[] = [];
  for (const kind of KIND_ORDER) {
    const string = ir.strings.find((s) => s.kind === kind && s.domain.type === 'number');
    if (!string || string.domain.type !== 'number') continue;
    const min = string.domain.min ?? 0;
    const max = string.domain.max ?? 100;
    const span = max - min || 1;
    const raw = universe.get(string.id);
    const value = typeof raw === 'number' ? raw : min;
    const norm = clamp((value - min) / span, 0, 1);
    const lane: Lane = { kind, id: string.id, name: string.name, value, min, max, norm };
    if (string.verge !== undefined) lane.vergeNorm = clamp((string.verge - min) / span, 0, 1);
    if (string.safe !== undefined) lane.safeNorm = clamp((string.safe - min) / span, 0, 1);
    lanes.push(lane);
  }
  return lanes;
}

/**
 * 写回时把「这一拍的运行时值」冻结成新的基线：调律台调的是世界的初值，
 * 刷新后世界从这里开始。只改数值弦；其它类型的基线保持原样。
 */
export function withCurrentBaselines(ir: WorldIR, universe: Universe): WorldIR {
  return {
    ...ir,
    strings: ir.strings.map((string) => {
      if (string.domain.type !== 'number') return string;
      const raw = universe.get(string.id);
      if (typeof raw !== 'number') return string;
      const baseline = Math.round(raw * 1000) / 1000;
      return baseline === string.baseline ? string : { ...string, baseline };
    }),
  };
}

/**
 * 调律台：一张白纸上叠着某个真实世界里的 8 类弦。
 * 视图之外的逻辑（编译、逐拍、注入、写回）都在这层；画布只负责乐器。
 */
export function App() {
  const source = useWorldSource();
  const compiled = useMemo(() => (source ? compileText(source, WORLD_FILE) : null), [source]);
  const [universe, setUniverse] = useState<Universe | null>(null);
  const [version, setVersion] = useState(0);
  const [saves, setSaves] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<number | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (compiled?.ok) setUniverse(new Universe(compiled.ir, { seed: 7 }));
  }, [compiled]);

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
    () => (universe && compiled ? collectLanes(universe, compiled.ir) : []),
    [universe, compiled, version],
  );

  const doSave = async (): Promise<void> => {
    if (!DEV) {
      setSaveState('disabled');
      return;
    }
    if (!compiled?.ok || !universe || saving.current) return;
    saving.current = true;
    setSaveState('saving');
    try {
      const text = serialize(withCurrentBaselines(compiled.ir, universe));
      const response = await fetch('/__neurou/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: WORLD_FILE, text }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? '写回失败');
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

  const shell = (children: ReactNode | null, loading: boolean) => (
    <div
      className="ink-app"
      data-testid="ink-app"
      data-world-file={WORLD_FILE}
      data-saves={saves}
      data-save-state={saveState}
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

  if (!universe) return shell(null, true);

  const view: WorldView = {
    name: compiled.ir.name,
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

  return shell(<StringField view={view} onInject={onInject} />, false);
}
