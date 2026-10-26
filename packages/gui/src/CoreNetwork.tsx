import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IRString, WorldIR } from '@neurou/core';
import { tensionOf, type ViewSnapshot } from './types.js';

const W = 1440;
const H = 900;
const NODE_X = 112;
const LINE_START = 250;
const LINE_END = 1330;
const LOOP_X = 690;

const NODE_Y: Record<string, number> = {
  自我: 280,
  他人: 490,
  环境: 700,
};

const STRING_LAYOUT: Record<string, { y: number; node: string; seed: number }> = {
  '自我.信任': { y: 180, node: '自我', seed: 3 },
  '自我.恐惧': { y: 280, node: '自我', seed: 11 },
  '自我.能量': { y: 380, node: '自我', seed: 19 },
  '环境.压力': { y: 700, node: '环境', seed: 29 },
};

interface Sample {
  x: number;
  y: number;
  t: number;
}

interface Fret {
  x: number;
  y: number;
  kind: 'verge' | 'safe';
}

interface StringGeo {
  s: IRString;
  nodeY: number;
  lineY: number;
  value: number;
  min: number;
  max: number;
  norm: number;
  tension: number;
  bend: number;
  center: string;
  hitCenter: string;
  samples: Sample[];
  ribbon: string;
  markerX: number;
  markerY: number;
  frets: Fret[];
  namePoint: { x: number; y: number };
  baseWidth: number;
  opacity: number;
  flowDur: number;
  lifted: boolean;
}

interface NodeInfo {
  id: string;
  y: number;
}

function bezier(p0: { x: number; y: number }, c1: { x: number; y: number }, c2: { x: number; y: number }, p1: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

function sampleString(nodeY: number, lineY: number, bend: number): Sample[] {
  const vineP0 = { x: NODE_X, y: nodeY };
  const vineC1 = { x: 178, y: nodeY };
  const vineC2 = { x: 206, y: lineY };
  const vineP1 = { x: LINE_START, y: lineY };
  const hP0 = { x: LINE_START, y: lineY };
  const hC1 = { x: 560, y: lineY + bend };
  const hC2 = { x: 1020, y: lineY + bend };
  const hP1 = { x: LINE_END, y: lineY };
  const points: Sample[] = [];
  const N1 = 26;
  const N2 = 64;
  for (let i = 0; i < N1; i++) {
    const t = i / (N1 - 1);
    const p = bezier(vineP0, vineC1, vineC2, vineP1, t);
    points.push({ ...p, t: t * 0.27 });
  }
  for (let i = 0; i < N2; i++) {
    const t = i / (N2 - 1);
    const p = bezier(hP0, hC1, hC2, hP1, t);
    points.push({ ...p, t: 0.27 + 0.73 * t });
  }
  return points;
}

function centerlinePath(nodeY: number, lineY: number, bend: number): string {
  return `M ${NODE_X} ${nodeY} C 178 ${nodeY}, 206 ${lineY}, ${LINE_START} ${lineY} C 560 ${lineY + bend}, 1020 ${lineY + bend}, ${LINE_END} ${lineY}`;
}

function widthAt(t: number, seed: number): number {
  const bell = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.68);
  const wobble = 0.06 * Math.sin(t * 33 + seed * 2);
  return Math.max(0.08, 0.2 + 1.05 * bell * (0.65 + 0.35 * Math.sin(t * 6.2 + seed)) + wobble);
}

function ribbonPath(samples: Sample[], baseWidth: number, seed: number): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    const prev = samples[Math.max(0, i - 1)]!;
    const next = samples[Math.min(samples.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = baseWidth * widthAt(samples[i]!.t, seed);
    top.push(`${samples[i]!.x + nx * w * 0.5} ${samples[i]!.y + ny * w * 0.5}`);
    bottom.push(`${samples[i]!.x - nx * w * 0.5} ${samples[i]!.y - ny * w * 0.5}`);
  }
  return `M ${top.join(' L ')} L ${bottom.reverse().join(' L ')} Z`;
}

function pointAtX(samples: Sample[], x: number): Sample {
  let best = samples[0]!;
  let distance = Math.abs(best.x - x);
  for (const p of samples) {
    const d = Math.abs(p.x - x);
    if (d < distance) {
      best = p;
      distance = d;
    }
  }
  return best;
}

function smoothClosed(points: { x: number; y: number }[]): string {
  const n = points.length;
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return `${d} Z`;
}

interface CoreNetworkProps {
  world: WorldIR;
  snap: ViewSnapshot;
  inverted: boolean;
  onAdjust: (id: string, value: number) => void;
}

/**
 * 墨网：3 个节点、4 根横向弦、2 条回路。
 * Tab 由 App 控制：反色 + 全局失焦；这里负责聚焦层。
 */
export function CoreNetwork({ world, snap, inverted, onAdjust }: CoreNetworkProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; bend: number } | null>(null);
  const [release, setRelease] = useState<{ id: string; bend: number } | null>(null);
  const dragRef = useRef<{ id: string; startY: number; startValue: number; range: number } | null>(null);
  const springFrame = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (springFrame.current !== null) cancelAnimationFrame(springFrame.current);
    };
  }, []);

  const nodes: NodeInfo[] = world.entities.map((e, i) => ({ id: e.id, y: NODE_Y[e.id] ?? 220 + i * 190 }));

  const bendFor = (id: string): number => {
    if (dragging?.id === id) return dragging.bend;
    if (release?.id === id) return release.bend;
    if (hovered === id) return -38;
    return 0;
  };

  const geoFor = (s: IRString): StringGeo => {
    const layout = STRING_LAYOUT[s.id] ?? { y: 160 + world.strings.findIndex((x) => x.id === s.id) * 100, node: s.owner ?? '自我', seed: 7 };
    const nodeY = NODE_Y[layout.node] ?? layout.y;
    const raw = snap.values[s.id];
    const value = typeof raw === 'number' ? raw : 0;
    const min = s.domain.type === 'number' ? (s.domain.min ?? 0) : 0;
    const max = s.domain.type === 'number' ? (s.domain.max ?? 100) : 100;
    const norm = Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
    const tension = tensionOf(s, raw)?.tension ?? 0;
    const bend = bendFor(s.id);
    const samples = sampleString(nodeY, layout.y, bend);
    const markerX = LINE_START + norm * (LINE_END - LINE_START);
    const marker = pointAtX(samples, markerX);
    const frets: Fret[] = [];
    for (const [threshold, kind] of [
      [s.verge, 'verge'],
      [s.safe, 'safe'],
    ] as const) {
      if (threshold === undefined) continue;
      const x = LINE_START + ((threshold - min) / (max - min || 1)) * (LINE_END - LINE_START);
      frets.push({ x, y: pointAtX(samples, x).y, kind });
    }
    const nameX = LINE_START + 38;
    const name = pointAtX(samples, nameX);
    return {
      s,
      nodeY,
      lineY: layout.y,
      value,
      min,
      max,
      norm,
      tension,
      bend,
      center: centerlinePath(nodeY, layout.y, bend),
      hitCenter: centerlinePath(nodeY, layout.y, 0),
      samples,
      ribbon: ribbonPath(samples, 3.2 + tension * 5.8, layout.seed),
      markerX,
      markerY: marker.y,
      frets,
      namePoint: { x: nameX, y: name.y - 13 },
      baseWidth: 3.2 + tension * 5.8,
      opacity: 0.58 + tension * 0.27,
      flowDur: 3.6 - tension * 2.5,
      lifted: hovered === s.id || dragging?.id === s.id,
    };
  };

  const geos = world.strings.map(geoFor);
  const geoById = new Map(geos.map((g) => [g.s.id, g]));

  const loopGeos = world.loops.map((loop) => {
    const ids = new Set<string>();
    for (const edgeId of loop.edges) {
      const c = world.couplings.find((x) => x.id === edgeId);
      if (c) {
        ids.add(c.from);
        ids.add(c.to);
      }
    }
    const points = [...ids]
      .map((id) => geoById.get(id))
      .filter((g): g is StringGeo => Boolean(g))
      .map((g) => {
        const p = pointAtX(g.samples, LOOP_X);
        return { x: p.x, y: p.y };
      });
    return { loop, points };
  });

  const focus = hovered
    ? ({ type: 'string', id: hovered } as const)
    : selectedNode
      ? ({ type: 'node', id: selectedNode } as const)
      : inverted
        ? ({ type: 'node', id: '自我' } as const)
        : null;

  const startSpring = (id: string, from: number, to: number) => {
    if (springFrame.current !== null) cancelAnimationFrame(springFrame.current);
    const started = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / 360);
      if (p >= 1) {
        setRelease(null);
        springFrame.current = null;
        return;
      }
      const bend = to + (from - to) * Math.pow(1 - p, 2);
      setRelease({ id, bend });
      springFrame.current = requestAnimationFrame(step);
    };
    setRelease({ id, bend: from });
    springFrame.current = requestAnimationFrame(step);
  };

  const onDown = (e: ReactPointerEvent<SVGGElement>, s: IRString, geo: StringGeo) => {
    e.stopPropagation();
    e.preventDefault();
    if (springFrame.current !== null) cancelAnimationFrame(springFrame.current);
    setRelease(null);
    setHovered(s.id);
    dragRef.current = { id: s.id, startY: e.clientY, startValue: geo.value, range: geo.max - geo.min };
    setDragging({ id: s.id, bend: 0 });
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    const value = Math.min(100, Math.max(0, d.startValue + (dy / 260) * d.range));
    onAdjust(d.id, value);
    const bend = Math.max(-72, Math.min(72, -dy * 0.55));
    setDragging({ id: d.id, bend });
  };

  const onUp = (e: ReactPointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    try {
      (e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const b0 = dragging?.id === d.id ? dragging.bend : 0;
    dragRef.current = null;
    setDragging(null);
    startSpring(d.id, b0, hovered === d.id ? -38 : 0);
  };

  const onCancel = () => {
    dragRef.current = null;
    setDragging(null);
    setRelease(null);
  };

  const stringNode = (s: IRString) => (
    <g
      key={s.id}
      className="ink-string"
      data-string={s.id}
      data-kind={s.kind}
      onMouseEnter={() => setHovered(s.id)}
      onMouseLeave={() => {
        if (!dragRef.current) setHovered(null);
      }}
      onPointerDown={(e) => onDown(e, s, geoById.get(s.id)!)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
    >
      {stringVisual(geoById.get(s.id)!, 'base')}
    </g>
  );

  return (
    <div className="ink-net" data-testid="ink-network" data-inverted={inverted}>
      <svg
        className="ink-base"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ filter: inverted ? 'blur(2px)' : 'none' }}
      >
        {loopGeos.map(({ loop, points }) => (
          <g
            key={loop.id}
            className={`ink-loop ink-loop--${loop.polarity === 1 ? 'reinforce' : 'balance'}`}
            data-loop={loop.id}
          >
            {points.length >= 2 && (
              <>
                <path
                  d={smoothClosed([
                    points[0]!,
                    { x: Math.max(points[0]!.x, points[1]!.x) + 170, y: (points[0]!.y + points[1]!.y) / 2 },
                    points[1]!,
                    { x: Math.min(points[0]!.x, points[1]!.x) - 170, y: (points[0]!.y + points[1]!.y) / 2 },
                  ])}
                />
                <text
                  x={(points[0]!.x + points[1]!.x) / 2}
                  y={(points[0]!.y + points[1]!.y) / 2 - 12}
                  textAnchor="middle"
                  className="ink-loop-name"
                >
                  {loop.name}
                </text>
              </>
            )}
          </g>
        ))}

        {world.strings.map(stringNode)}

        {nodes.map((node) => (
          <g
            key={node.id}
            className="ink-node"
            data-node={node.id}
            onClick={() => {
              setSelectedNode(node.id);
              setHovered(null);
            }}
          >
            <circle cx={NODE_X} cy={node.y} r={24} className="ink-node-hit" />
            <line x1={NODE_X} y1={node.y - 24} x2={NODE_X} y2={node.y + 24} className="ink-node-spine" />
            <circle cx={NODE_X} cy={node.y} r={3.6} className="ink-node-dot" />
            {selectedNode === node.id && <circle cx={NODE_X} cy={node.y} r={10} className="ink-node-ring" />}
            <text x={NODE_X - 20} y={node.y + 4} textAnchor="end" className="ink-node-label">
              {node.id}
            </text>
          </g>
        ))}
      </svg>

      {inverted && focus && (
        <svg className="ink-focus" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {focus.type === 'string' && geoById.get(focus.id) && (
            <g data-focus-string={focus.id} className="ink-focus-string">
              {stringVisual(geoById.get(focus.id)!, 'focus')}
            </g>
          )}
          {focus.type === 'node' && (
            <>
              <g data-focus-node={focus.id} className="ink-focus-node">
                <line
                  x1={NODE_X}
                  y1={(NODE_Y[focus.id] ?? 280) - 24}
                  x2={NODE_X}
                  y2={(NODE_Y[focus.id] ?? 280) + 24}
                  className="ink-node-spine"
                />
                <circle cx={NODE_X} cy={NODE_Y[focus.id] ?? 280} r={3.6} className="ink-node-dot" />
                <circle cx={NODE_X} cy={NODE_Y[focus.id] ?? 280} r={10} className="ink-node-ring" />
                <text x={NODE_X - 20} y={(NODE_Y[focus.id] ?? 280) + 4} textAnchor="end" className="ink-node-label">
                  {focus.id}
                </text>
              </g>
              {world.strings
                .filter((s) => s.owner === focus.id)
                .map((s) => (
                  <g key={s.id} data-focus-string={s.id} className="ink-focus-string">
                    {stringVisual(geoById.get(s.id)!, 'focus')}
                  </g>
                ))}
            </>
          )}
        </svg>
      )}
    </div>
  );
}

function stringVisual(geo: StringGeo, mode: 'base' | 'focus') {
  const hit = mode === 'base';
  return (
    <>
      {geo.lifted && (
        <path
          d={geo.ribbon}
          className="ink-trail"
          transform={`translate(0 ${geo.bend < 0 ? 9 : -9})`}
        />
      )}
      <path d={geo.ribbon} className="ink-bleed" />
      <path
        d={geo.ribbon}
        className={`ink-ribbon ${geo.lifted ? 'is-lifted' : ''}`}
        fill="var(--ink)"
        fillOpacity={geo.opacity}
      />
      <path
        d={geo.center}
        className="ink-flow"
        style={{ animationDuration: `${Math.max(1.1, geo.flowDur)}s` }}
      />
      {geo.frets.map((f, i) => (
        <line
          key={i}
          x1={f.x}
          y1={f.y - (f.kind === 'verge' ? 6 : 3)}
          x2={f.x}
          y2={f.y + (f.kind === 'verge' ? 6 : 3)}
          className={`ink-fret ink-fret--${f.kind}`}
        />
      ))}
      <line x1={geo.markerX} y1={geo.markerY - 6} x2={geo.markerX} y2={geo.markerY + 6} className="ink-marker" />
      <text x={geo.namePoint.x} y={geo.namePoint.y} className="ink-string-name">
        {geo.s.name}
      </text>
      {hit && (
        <path
          d={geo.hitCenter}
          className="ink-hit"
          fill="none"
          stroke="transparent"
          strokeWidth={34}
          pointerEvents="stroke"
        />
      )}
    </>
  );
}
