import { useEffect, useMemo, useState } from 'react';
import { KIND_ORDER, compileText, type StringKind, type WorldIR } from '@neurou/core';
import { Universe } from '@neurou/runtime';
import { StringField } from './StringField.js';
import { clamp, type Lane, type WorldView } from './stringMath.js';
import worldSource from '../../../examples/tuner.nro?raw';

const TICK_MS = 480;
const compiled = compileText(worldSource, 'examples/tuner.nro');

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
 * 调律台：一张白纸上叠着某个真实世界里的 8 类弦。
 * 视图之外的逻辑（编译、逐拍、注入）都在这层；画布只负责乐器。
 */
export function App() {
  const [universe] = useState(() => new Universe(compiled.ir, { seed: 7 }));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!compiled.ok) return;
    const timer = window.setInterval(() => {
      if (universe.state.ended) return;
      universe.tick();
      setVersion((v) => v + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [universe]);

  const lanes = useMemo(() => collectLanes(universe, compiled.ir), [universe, version]);
  const view: WorldView = {
    name: compiled.ir.name,
    tick: universe.state.tick,
    ended: universe.state.ended?.name ?? null,
    lanes,
  };

  if (!compiled.ok) {
    return (
      <div className="ink-fatal" data-testid="ink-fatal">
        <div>{compiled.ir.name || '世界'} 编译不过去</div>
        {compiled.diagnostics.errors.slice(0, 6).map((d, i) => (
          <div key={i}>{d.message}</div>
        ))}
      </div>
    );
  }

  const onInject = (kind: StringKind, value: number): void => {
    const lane = lanes.find((l) => l.kind === kind);
    if (!lane) return;
    universe.inject(lane.id, value);
    setVersion((v) => v + 1);
  };

  return (
    <div className="ink-app" data-testid="ink-app">
      <StringField view={view} onInject={onInject} />
    </div>
  );
}
