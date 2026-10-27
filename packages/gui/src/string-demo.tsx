/**
 * 单弦调律台的独立验证页：http://127.0.0.1:5188/string-demo.html
 *
 * 只有一张白纸 + StringField，不设任何演示工具栏（用户明确不要多余界面）。
 * 这里自造一份 8 lane 的假 WorldView + 本地 onInject，让 demo 页可以独立打开；
 * 真实世界接线看主应用 `/`（App.tsx 编译 examples/tuner.nro）。
 * 与主应用一样用 StrictMode，验证双挂载下音频单例与 effect 清理是幂等的。
 */
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { StringKind } from '@neurou/core';
import { StringField } from './StringField.js';
import { clamp, type Lane, type WorldView } from './stringMath.js';
import './core.css';
interface FakeLaneSpec {
  kind: StringKind;
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  verge?: number;
  safe?: number;
}

/** 与 examples/tuner.nro 相近的一份假世界（8 类弦各一根）。 */
const FAKE_SPECS: readonly FakeLaneSpec[] = [
  { kind: '叙事', id: 'demo.trust', name: '信任', value: 55, min: 0, max: 100, verge: 25, safe: 75 },
  { kind: '视觉', id: 'demo.warmth', name: '色温', value: 64, min: 0, max: 100, verge: 35, safe: 80 },
  { kind: '动画', id: 'demo.gait', name: '步态', value: 50, min: 0, max: 100, verge: 20, safe: 80 },
  { kind: '物理', id: 'demo.gravity', name: '重力', value: 72, min: 0, max: 100, verge: 78, safe: 35 },
  { kind: '控制', id: 'demo.sensitivity', name: '灵敏度', value: 44, min: 0, max: 100, verge: 30, safe: 78 },
  { kind: '空间', id: 'demo.connect', name: '连通', value: 36, min: 0, max: 100, verge: 28, safe: 72 },
  { kind: '认知', id: 'demo.aware', name: '知情', value: 28, min: 0, max: 100, verge: 22, safe: 70 },
  { kind: '关系', id: 'demo.fear', name: '恐惧', value: 0.58, min: 0, max: 1, verge: 0.8, safe: 0.2 },
];

function buildLanes(): Lane[] {
  return FAKE_SPECS.map((spec) => {
    const span = spec.max - spec.min || 1;
    const lane: Lane = {
      kind: spec.kind,
      id: spec.id,
      name: spec.name,
      value: spec.value,
      min: spec.min,
      max: spec.max,
      norm: clamp((spec.value - spec.min) / span, 0, 1),
    };
    if (spec.verge !== undefined) {
      lane.verge = spec.verge;
      lane.vergeNorm = clamp((spec.verge - spec.min) / span, 0, 1);
    }
    if (spec.safe !== undefined) {
      lane.safe = spec.safe;
      lane.safeNorm = clamp((spec.safe - spec.min) / span, 0, 1);
    }
    return lane;
  });
}

function StringDemo() {
  const [lanes, setLanes] = useState<Lane[]>(buildLanes);
  const [tick, setTick] = useState(0);

  // 假世界也逐拍走：这样拖完一根弦、下一拍能看到它自己泛起的视觉波。
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 480);
    return () => window.clearInterval(timer);
  }, []);

  const view = useMemo<WorldView>(
    () => ({ name: '调律台·演示', tick, ended: null, lanes, couplings: [] }),
    [lanes, tick],
  );
  const onInject = (kind: StringKind, raw: number): void => {
    setLanes((previous) =>
      previous.map((lane) => {
        if (lane.kind !== kind) return lane;
        const value = clamp(raw, lane.min, lane.max);
        const span = lane.max - lane.min || 1;
        return { ...lane, value, norm: clamp((value - lane.min) / span, 0, 1) };
      }),
    );
  };
  // demo 页没有 IR：本地改阈值就够了（persist 参数忽略）。
  const onEditThreshold = (kind: StringKind, which: 'verge' | 'safe', raw: number): void => {
    setLanes((previous) =>
      previous.map((lane) => {
        if (lane.kind !== kind) return lane;
        const value = clamp(raw, lane.min, lane.max);
        const span = lane.max - lane.min || 1;
        const norm = clamp((value - lane.min) / span, 0, 1);
        return which === 'verge'
          ? { ...lane, verge: value, vergeNorm: norm }
          : { ...lane, safe: value, safeNorm: norm };
      }),
    );
  };

  return (
    <div className="ink-app" data-testid="ink-app">
      <StringField view={view} onInject={onInject} onEditThreshold={onEditThreshold} />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');
createRoot(root).render(
  <StrictMode>
    <StringDemo />
  </StrictMode>,
);
