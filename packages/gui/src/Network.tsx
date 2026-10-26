import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { IRCoupling, IRString, LExpr, WorldIR } from '@neurou/core';
import { tensionOf, type ViewSnapshot } from './types.js';
import { Term } from './Term.js';
import type { TermId } from './terms.js';

const KIND_ORDER = ['叙事', '视觉', '物理', '认知', '空间', '关系', '动画', '控制'];

export interface NetworkProps {
  world: WorldIR;
  snap: ViewSnapshot;
  focused: string | null;
  full?: boolean;
  pulse: { strings: string[]; index: number } | null;
  onHoverString: (id: string | null, rect: DOMRect | null) => void;
  onAdjustString: (id: string, value: number) => void;
  onPluckLoop: (loopId: string) => void;
  onForcing: (forcingId: string, rect: DOMRect | null) => void;
  onFocusEntity: (entity: string) => void;
  onOpenTerm: (id: TermId, rect: DOMRect | null) => void;
}

interface Node {
  s: IRString;
  x: number;
  y0: number;
  h: number;
  vpos: number;
  tension: number;
  numeric: boolean;
  value: number | null;
  min: number;
  max: number;
  frets: { y: number; kind: 'verge' | 'safe' }[];
}

interface WaveEdge {
  id: string;
  start: number;
  dur: number;
}

interface WaveNode {
  id: string;
  at: number;
  source: boolean;
}

interface Wave {
  key: number;
  edges: WaveEdge[];
  nodes: WaveNode[];
}

function shortName(s: IRString): string {
  return s.name.length > 8 ? `${s.name.slice(0, 7)}…` : s.name;
}

function collectReads(e: LExpr, out: Set<string>): void {
  if (e.k === 'read') out.add(e.id);
  else if (e.k === 'bin') {
    collectReads(e.l, out);
    collectReads(e.r, out);
  } else if (e.k === 'un') collectReads(e.e, out);
  else if (e.k === 'call') e.args.forEach((a) => collectReads(a, out));
}

function smoothClosed(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
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

function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 10007;
  return h;
}

/**
 * 全屏弦网络：白纸、黑线、无侧栏。
 *
 * 弦不是直线：每根弦以不同的频率/振幅做贝塞尔震颤；
 * 拖动时出现黑色残影（模糊），拨回路时弦序列带墨迹拖影。
 */
export function Network({
  world,
  snap,
  focused,
  pulse,
  onHoverString,
  onAdjustString,
  onPluckLoop,
  onForcing,
  onFocusEntity,
  onOpenTerm,
}: NetworkProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; startY: number; startX: number; startValue: number; range: number; screenH: number; dx: number } | null>(null);
  const reboundFrame = useRef<number | null>(null);
  const waveTimer = useRef<number | null>(null);
  const [dragState, setDragState] = useState<{ id: string; dx: number } | null>(null);
  const [wave, setWave] = useState<Wave | null>(null);
  const [hoverLoop, setHoverLoop] = useState<{ id: string; x: number; y: number } | null>(null);
  const [phase, setPhase] = useState(0);

  const W = 1600;
  const H = 1000;

  // 静止时弦也在呼吸：30fps 更新相位，所有弦用各自的频率/相位画出贝塞尔曲线。
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 33) {
        setPhase(t / 1000);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    return () => {
      if (waveTimer.current !== null) window.clearTimeout(waveTimer.current);
      if (reboundFrame.current !== null) cancelAnimationFrame(reboundFrame.current);
    };
  }, []);

  const layout = useMemo(() => {
    const strings = world.strings.filter((s) => !s.id.startsWith('调性.'));
    const entityOrder = world.entities.map((e) => e.id).filter((id) => strings.some((s) => s.owner === id));
    const ownerSet = new Set(entityOrder);
    for (const s of strings) {
      const o = s.owner ?? '世界';
      if (!ownerSet.has(o)) {
        ownerSet.add(o);
        entityOrder.push(o);
      }
    }
    const columns = entityOrder.map((owner) => ({
      owner,
      strings: strings
        .filter((s) => (s.owner ?? '世界') === owner)
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)),
    }));
    const top = 92;
    const bottom = H - 28;
    const gap = 14;
    const available = bottom - top;
    const left = 36;
    const right = 36;
    const nodes = new Map<string, Node>();

    columns.forEach((col, i) => {
      const x = columns.length <= 1 ? W / 2 : left + (i / (columns.length - 1)) * (W - left - right);
      const count = Math.max(1, col.strings.length);
      const h = (available - (count - 1) * gap) / count;
      col.strings.forEach((s, j) => {
        const y0 = top + j * (h + gap);
        const numeric = s.domain.type === 'number';
        const min = numeric && s.domain.type === 'number' ? (s.domain.min ?? 0) : 0;
        const max = numeric && s.domain.type === 'number' ? (s.domain.max ?? 100) : 100;
        const raw = snap.values[s.id];
        const value = typeof raw === 'number' ? raw : null;
        const norm = numeric && value !== null && max > min ? (value - min) / (max - min) : 0.5;
        const vpos = y0 + (1 - Math.min(1, Math.max(0, norm))) * h;
        const tension = tensionOf(s, raw)?.tension ?? 0;
        const frets: Node['frets'] = [];
        if (numeric) {
          for (const [v, kind] of [
            [s.verge, 'verge'],
            [s.safe, 'safe'],
          ] as const) {
            if (v === undefined) continue;
            const p = (v - min) / (max - min || 1);
            frets.push({ y: y0 + (1 - Math.min(1, Math.max(0, p))) * h, kind });
          }
        }
        nodes.set(s.id, { s, x, y0, h, vpos, tension, numeric, value, min, max, frets });
      });
    });

    return { columns, nodes, top, bottom };
  }, [world, snap, H]);

  const pulseSet = useMemo(() => new Set(pulse?.strings ?? []), [pulse]);
  const activePulse = pulse && pulse.strings[pulse.index] ? pulse.strings[pulse.index]! : null;

  const isDim = (owner: string | undefined): boolean => Boolean(focused) && (owner ?? '世界') !== focused;

  const nodeFor = (id: string): Node | undefined => layout.nodes.get(id);

  const couplingPath = (from: Node, to: Node): string => {
    if (Math.abs(from.x - to.x) < 1) {
      const dir = from.vpos < to.vpos ? 1 : -1;
      return `M ${from.x} ${from.vpos} C ${from.x + 36} ${from.vpos}, ${to.x + 36} ${to.vpos}, ${to.x} ${to.vpos + dir * 6}`;
    }
    const dx = (to.x - from.x) * 0.42;
    return `M ${from.x} ${from.vpos} C ${from.x + dx} ${from.vpos}, ${to.x - dx} ${to.vpos}, ${to.x} ${to.vpos}`;
  };

  /**
   * 拖弦时的因果波：从源弦出发，沿耦合走三跳。
   * 每条边的传播时间由耦合强度与延迟决定：越强越快，延迟越大越慢。
   */
  const startWave = (sourceId: string) => {
    const adj = new Map<string, IRCoupling[]>();
    for (const c of world.couplings) {
      const list = adj.get(c.from) ?? [];
      list.push(c);
      adj.set(c.from, list);
    }
    const arrival = new Map<string, number>([[sourceId, 0]]);
    const hops = new Map<string, number>([[sourceId, 0]]);
    const nodeMap = new Map<string, WaveNode>([[sourceId, { id: sourceId, at: 0, source: true }]]);
    const edges: WaveEdge[] = [];
    const seenEdges = new Set<string>();
    const queue: string[] = [sourceId];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const t = arrival.get(cur)!;
      const hop = hops.get(cur)!;
      if (hop >= 3) continue;
      for (const c of adj.get(cur) ?? []) {
        if (seenEdges.has(c.id)) continue;
        seenEdges.add(c.id);
        const strength = Math.min(1, Math.max(0, Number(c.strength) || 0));
        const delay = Math.max(0, Number(c.delay) || 0);
        const dur = 220 + delay * 200 + (1 - strength) * 140;
        const at = t + dur;
        edges.push({ id: c.id, start: t, dur });
        const known = arrival.get(c.to);
        if (known === undefined || at < known) {
          arrival.set(c.to, at);
          hops.set(c.to, hop + 1);
          queue.push(c.to);
          const existing = nodeMap.get(c.to);
          if (!existing || at < existing.at) nodeMap.set(c.to, { id: c.to, at, source: false });
        }
      }
    }

    const maxAt = Math.max(0, ...edges.map((e) => e.start + e.dur), ...[...nodeMap.values()].map((n) => n.at));
    if (waveTimer.current !== null) window.clearTimeout(waveTimer.current);
    setWave({ key: Date.now(), edges, nodes: [...nodeMap.values()] });
    waveTimer.current = window.setTimeout(() => setWave(null), maxAt + 900);
  };

  const stringPath = (n: Node, s: IRString, dragDx: number): string => {
    const seed = seedOf(s.id);
    const amp = 1.1 + n.tension * 3.2;
    const freq = 0.45 + n.tension * 1.7;
    const sway = Math.sin(phase * freq * Math.PI * 2 + seed) * amp;
    const sway2 = Math.sin(phase * freq * 1.37 * Math.PI * 2 + seed * 1.7) * amp * 0.45;
    return `M ${n.x} ${n.y0} C ${n.x + sway + dragDx} ${n.y0 + n.h * 0.32}, ${n.x + sway2 - dragDx * 0.6} ${n.y0 + n.h * 0.68}, ${n.x} ${n.y0 + n.h}`;
  };

  return (
    <div className="network" data-testid="network">
      <svg ref={svgRef} className="network__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <marker id="net-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
          </marker>
          <filter id="ink-blur" x="-30%" y="-10%" width="160%" height="120%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
          <filter id="ink-blur-wide" x="-40%" y="-15%" width="180%" height="130%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {/* 横向耦合 */}
        <g className="couplings">
          {world.couplings.map((c) => {
            const a = nodeFor(c.from);
            const b = nodeFor(c.to);
            if (!a || !b) return null;
            const dim = isDim(a.s.owner) && isDim(b.s.owner);
            const hot = Boolean(focused) && !dim;
            const strength = Math.min(1, Math.max(0, Number(c.strength) || 0));
            return (
              <path
                key={c.id}
                d={couplingPath(a, b)}
                className={`coupling coupling--${c.polarity === 1 ? 'pos' : 'neg'} ${dim ? 'is-dim' : ''} ${hot ? 'is-hot' : ''}`}
                markerEnd="url(#net-arrow)"
                style={{ '--strength': strength } as CSSProperties}
              />
            );
          })}
        </g>

        {/* 回路闭环 */}
        {world.loops.map((loop) => {
          const edges = loop.edges
            .map((id) => world.couplings.find((c) => c.id === id))
            .filter((c): c is NonNullable<typeof c> => !!c);
          const seq: string[] = [];
          const byFrom = new Map(edges.map((e) => [e.from, e]));
          let cur = edges[0]?.from;
          for (let i = 0; i < edges.length && cur; i++) {
            seq.push(cur);
            cur = byFrom.get(cur)?.to;
          }
          const pts = seq.map((id) => nodeFor(id)).filter((n): n is Node => !!n).map((n) => ({ x: n.x, y: n.vpos }));
          if (pts.length < 2) return null;
          const d = smoothClosed(pts);
          const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
          const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
          const dim = focused ? seq.every((id) => (nodeFor(id)?.s.owner ?? '世界') !== focused) : false;
          return (
            <g
              key={loop.id}
              className={`loop loop--${loop.polarity === 1 ? 'reinforce' : 'balance'} ${dim ? 'is-dim' : ''}`}
              data-loop={loop.id}
            >
              <path d={d} className="loop__halo" />
              <path d={d} className="loop__line" />
              <path
                d={d}
                className="loop__hit"
                onMouseEnter={(e) => setHoverLoop({ id: loop.id, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHoverLoop({ id: loop.id, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoverLoop(null)}
                onClick={() => onPluckLoop(loop.id)}
              />
              <text x={cx} y={cy} textAnchor="middle" className="loop__name">
                {loop.name}
              </text>
            </g>
          );
        })}

        {/* 竖向声部线与弦 */}
        {layout.columns.map((col) => (
          <g key={col.owner} className={`voice ${isDim(col.owner) ? 'is-dim' : ''}`} data-entity={col.owner}>
            <line
              x1={col.strings[0] ? layout.nodes.get(col.strings[0].id)?.x ?? 0 : 0}
              y1={layout.top - 34}
              x2={col.strings[0] ? layout.nodes.get(col.strings[0].id)?.x ?? 0 : 0}
              y2={layout.bottom}
              className="voice__spine"
            />
            <text
              x={col.strings[0] ? layout.nodes.get(col.strings[0].id)?.x ?? 0 : 0}
              y={layout.top - 24}
              textAnchor="middle"
              className="voice__label"
              data-entity-label={col.owner}
              onClick={() => onFocusEntity(col.owner)}
            >
              {col.owner}
            </text>
            {col.strings.map((s) => {
              const n = nodeFor(s.id);
              if (!n) return null;
              const pulseActive = activePulse === s.id;
              const dragging = dragState?.id === s.id;
              const d = stringPath(n, s, dragging ? dragState.dx : 0);
              const flowDur = Math.max(1.1, 3.6 - n.tension * 2.5);
              return (
                <g
                  key={s.id}
                  className={`string string--${kindClass(s.kind)} ${pulseSet.has(s.id) ? 'is-pulse' : ''} ${pulseActive ? 'is-pulse-active' : ''} ${dragging ? 'is-dragging' : ''}`}
                  data-string={s.id}
                  data-kind={s.kind}
                  data-tension={n.tension.toFixed(2)}
                  onMouseEnter={(e) => onHoverString(s.id, e.currentTarget.getBoundingClientRect())}
                  onMouseLeave={() => onHoverString(null, null)}
                  onPointerDown={(e) => {
                    if (!n.numeric || n.value === null) return;
                    if (reboundFrame.current !== null) cancelAnimationFrame(reboundFrame.current);
                    const svg = svgRef.current;
                    const rect = svg?.getBoundingClientRect();
                    const scale = rect ? rect.height / H : 1;
                    drag.current = {
                      id: s.id,
                      startY: e.clientY,
                      startX: e.clientX,
                      startValue: n.value,
                      range: n.max - n.min,
                      screenH: Math.max(1, n.h * scale),
                      dx: 0,
                    };
                    setDragState({ id: s.id, dx: 0 });
                    onHoverString(null, null);
                    startWave(s.id);
                    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
                    e.preventDefault();
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current;
                    if (!d) return;
                    const dy = (d.startY - e.clientY) / d.screenH;
                    const next = d.startValue + dy * d.range * 0.65;
                    onAdjustString(d.id, next);
                    d.dx = Math.max(-8, Math.min(8, (e.clientX - d.startX) * 0.2));
                    setDragState({ id: d.id, dx: d.dx });
                  }}
                  onPointerUp={(e) => {
                    const d = drag.current;
                    if (!d) return;
                    try {
                      (e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId);
                    } catch {
                      /* ignore */
                    }
                    drag.current = null;
                    const dx0 = d.dx;
                    const id = d.id;
                    const started = performance.now();
                    const step = (now: number) => {
                      const p = Math.min(1, (now - started) / 460);
                      if (p >= 1) {
                        setDragState(null);
                        reboundFrame.current = null;
                        return;
                      }
                      setDragState({ id, dx: dx0 * (1 - p) * Math.cos(p * Math.PI * 3) });
                      reboundFrame.current = requestAnimationFrame(step);
                    };
                    reboundFrame.current = requestAnimationFrame(step);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDragState(null);
                  }}
                >
                  <line x1={n.x} y1={n.y0 - 4} x2={n.x} y2={n.y0 + n.h + 4} className="string__hit" />
                  <rect x={n.x - 13} y={n.y0 - 4} width={26} height={n.h + 8} className="string__hit-area" />

                  {/* 墨迹拖影：拖动/脉冲时出现；平时不可见 */}
                  <path d={d} className="string__trail" filter="url(#ink-blur)" strokeWidth={3 + n.tension * 2} fill="none" />
                  <path
                    d={d}
                    className="string__trail string__trail--wide"
                    filter="url(#ink-blur-wide)"
                    strokeWidth={5 + n.tension * 3}
                    fill="none"
                    transform={dragging ? `translate(${dragState.dx * 0.7} 0)` : undefined}
                  />

                  <path
                    d={d}
                    className="string__glow"
                    fill="none"
                    style={{ animationDuration: `${Math.max(2.2, 5.2 - n.tension * 2.6)}s` }}
                  />
                  <path d={d} className="string__line" fill="none" strokeWidth={1 + n.tension * 2.4} />
                  <path
                    d={d}
                    className="string__flow"
                    fill="none"
                    style={{ animationDuration: `${flowDur}s` }}
                  />

                  {n.frets.map((f, i) => (
                    <line key={i} x1={n.x - 5} y1={f.y} x2={n.x + 5} y2={f.y} className={`string__fret string__fret--${f.kind}`} />
                  ))}
                  <line x1={n.x - 5} y1={n.vpos} x2={n.x + 5} y2={n.vpos} className="string__marker" />
                  <text x={n.x + 9} y={n.vpos + 3} className="string__name">
                    {shortName(s)}
                  </text>
                </g>
              );
            })}
          </g>
        ))}

        {/* 力迫菱形 */}
        {world.rules
          .filter((r) => r.kind === 'forcing' && !r.name.startsWith('调性.'))
          .map((rule, idx) => {
            const reads = new Set<string>();
            if (rule.guard) collectReads(rule.guard, reads);
            for (const e of rule.effects) if (e.k !== 'apply') reads.add(e.id);
            const first = [...reads][0];
            const node = first ? nodeFor(first) : undefined;
            if (!node) return null;
            const fx = node.x + 16 + (idx % 3) * 10;
            const fy = Math.max(56, node.vpos - 14 - (idx % 4) * 6);
            return (
              <g
                key={rule.id}
                className="force"
                data-forcing={rule.id}
                onClick={(e) => onForcing(rule.id, e.currentTarget.getBoundingClientRect())}
              >
                <title>{`力迫 · ${rule.name}`}</title>
                <rect x={fx - 4} y={fy - 4} width="8" height="8" transform={`rotate(45 ${fx} ${fy})`} />
              </g>
            );
          })}

        {/* 因果波：黑色墨迹，不用彩色 */}
        {wave && (
          <g className="wave-layer" pointerEvents="none">
            {wave.edges.map((w) => {
              const c = world.couplings.find((x) => x.id === w.id);
              if (!c) return null;
              const a = nodeFor(c.from);
              const b = nodeFor(c.to);
              if (!a || !b) return null;
              return (
                <path
                  key={`${wave.key}-${w.id}`}
                  d={couplingPath(a, b)}
                  pathLength={1}
                  className="coupling-wave"
                  data-wave-edge={w.id}
                  style={{ animationDelay: `${Math.round(w.start)}ms`, animationDuration: `${Math.round(w.dur)}ms` }}
                />
              );
            })}
            {wave.nodes.map((w) => {
              const n = nodeFor(w.id);
              if (!n) return null;
              return (
                <circle
                  key={`${wave.key}-${w.id}`}
                  cx={n.x}
                  cy={n.vpos}
                  r={5}
                  className="node-wave"
                  data-wave-node={w.id}
                  data-wave-source={w.source ? 'true' : undefined}
                  style={{ animationDelay: `${Math.round(w.at)}ms` }}
                />
              );
            })}
          </g>
        )}
      </svg>

      {hoverLoop && (
        <div className="network__loop-tip" style={{ left: hoverLoop.x + 14, top: hoverLoop.y - 12 }} data-testid="network-loop-tip">
          <div className="network__loop-head">
            <Term id="回路" onOpen={onOpenTerm} />
            <span>· {world.loops.find((l) => l.id === hoverLoop.id)?.name}</span>
          </div>
          <div className="network__loop-chain">
            {(() => {
              const loop = world.loops.find((l) => l.id === hoverLoop.id);
              if (!loop) return null;
              const edges = loop.edges.map((id) => world.couplings.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
              const seq: string[] = [];
              const byFrom = new Map(edges.map((e) => [e.from, e]));
              let cur = edges[0]?.from;
              for (let i = 0; i < edges.length && cur; i++) {
                seq.push(cur);
                cur = byFrom.get(cur)?.to;
              }
              return seq.map((id) => world.strings.find((s) => s.id === id)?.name ?? id).join(' → ');
            })()}
          </div>
          <div className="network__loop-kind">
            {world.loops.find((l) => l.id === hoverLoop.id)?.polarity === 1 ? '自我强化' : '自我校正'} · 点击拨一下
          </div>
        </div>
      )}
    </div>
  );
}

function kindClass(kind: string): string {
  switch (kind) {
    case '叙事':
      return 'narr';
    case '视觉':
      return 'vis';
    case '物理':
      return 'phys';
    case '认知':
      return 'cog';
    case '空间':
      return 'space';
    case '关系':
      return 'rel';
    case '动画':
      return 'anim';
    default:
      return 'ctrl';
  }
}
