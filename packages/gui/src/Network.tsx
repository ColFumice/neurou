import { useMemo, useRef, useState } from 'react';
import type { IRString, LExpr, WorldIR } from '@neurou/core';
import { tensionOf, type ViewSnapshot } from './types.js';
import { Term } from './Term.js';
import type { TermId } from './terms.js';

const KIND_CLASS: Record<string, string> = {
  叙事: 'narr',
  视觉: 'vis',
  物理: 'phys',
  认知: 'cog',
  空间: 'space',
  关系: 'rel',
  动画: 'anim',
  控制: 'ctrl',
};

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

function shortName(s: IRString): string {
  return s.name.length > 7 ? `${s.name.slice(0, 6)}…` : s.name;
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
  if (points.length === 0) return '';
  if (points.length === 1) return '';
  if (points.length === 2) {
    const a = points[0]!;
    const b = points[1]!;
    const dx = 18;
    const dy = 12;
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y - dy}, ${b.x + dx} ${b.y + dy}, ${b.x} ${b.y} C ${b.x - dx} ${b.y + dy}, ${a.x - dx} ${a.y - dy}, ${a.x} ${a.y} Z`;
  }
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

/**
 * 弦网络：竖向声部线、横向耦合、常驻品丝、回路闭环、力迫菱形。
 * 这是 neurou 的主界面；现象层只是它右下角的一扇窗。
 */
export function Network({
  world,
  snap,
  focused,
  full,
  pulse,
  onHoverString,
  onAdjustString,
  onPluckLoop,
  onForcing,
  onOpenTerm,
}: NetworkProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; startY: number; startX: number; startValue: number; range: number; screenH: number } | null>(null);
  const [dragState, setDragState] = useState<{ id: string; dx: number } | null>(null);
  const [hoverLoop, setHoverLoop] = useState<{ id: string; x: number; y: number } | null>(null);

  const W = 1200;
  const H = full ? 800 : 720;

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
    const maxCount = Math.max(1, ...columns.map((c) => c.strings.length));
    const top = 92;
    const bottom = H - 36;
    const gap = 14;
    const segH = Math.min(full ? 84 : 72, (bottom - top - (maxCount - 1) * gap) / maxCount);
    const left = 70;
    const right = 50;
    const colW = (W - left - right) / Math.max(1, columns.length);
    const nodes = new Map<string, Node>();

    columns.forEach((col, i) => {
      const x = left + (i + 0.5) * colW;
      const yStart = top + ((maxCount - col.strings.length) * (segH + gap)) / 2;
      col.strings.forEach((s, j) => {
        const y0 = yStart + j * (segH + gap);
        const numeric = s.domain.type === 'number';
        const min = numeric && s.domain.type === 'number' ? (s.domain.min ?? 0) : 0;
        const max = numeric && s.domain.type === 'number' ? (s.domain.max ?? 100) : 100;
        const raw = snap.values[s.id];
        const value = typeof raw === 'number' ? raw : null;
        const norm = numeric && value !== null && max > min ? (value - min) / (max - min) : 0.5;
        const vpos = y0 + (1 - Math.min(1, Math.max(0, norm))) * segH;
        const tension = tensionOf(s, raw)?.tension ?? 0;
        const frets: Node['frets'] = [];
        if (numeric) {
          for (const [v, kind] of [
            [s.verge, 'verge'],
            [s.safe, 'safe'],
          ] as const) {
            if (v === undefined) continue;
            const p = (v - min) / (max - min || 1);
            frets.push({ y: y0 + (1 - Math.min(1, Math.max(0, p))) * segH, kind });
          }
        }
        nodes.set(s.id, { s, x, y0, h: segH, vpos, tension, numeric, value, min, max, frets });
      });
    });

    return { columns, nodes, colW, top, bottom, segH };
  }, [world, snap, full, H]);

  const pulseSet = useMemo(() => new Set(pulse?.strings ?? []), [pulse]);
  const activePulse = pulse && pulse.strings[pulse.index] ? pulse.strings[pulse.index]! : null;

  const isDim = (owner: string | undefined): boolean => Boolean(focused) && (owner ?? '世界') !== focused;

  const nodeFor = (id: string): Node | undefined => layout.nodes.get(id);

  const couplingPath = (from: Node, to: Node): string => {
    if (Math.abs(from.x - to.x) < 1) {
      const dir = from.vpos < to.vpos ? 1 : -1;
      return `M ${from.x} ${from.vpos} C ${from.x + 34} ${from.vpos}, ${to.x + 34} ${to.vpos}, ${to.x} ${to.vpos + dir * 6}`;
    }
    const dx = (to.x - from.x) * 0.42;
    return `M ${from.x} ${from.vpos} C ${from.x + dx} ${from.vpos}, ${to.x - dx} ${to.vpos}, ${to.x} ${to.vpos}`;
  };

  return (
    <div className={`network ${full ? 'network--full' : ''}`} data-testid="network">
      <svg ref={svgRef} className="network__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="net-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
          </marker>
        </defs>

        {/* 横向耦合 */}
        <g className="couplings">
          {world.couplings.map((c) => {
            const a = nodeFor(c.from);
            const b = nodeFor(c.to);
            if (!a || !b) return null;
            const dim = isDim(a.s.owner) && isDim(b.s.owner);
            const hot = Boolean(focused) && !dim;
            return (
              <path
                key={c.id}
                d={couplingPath(a, b)}
                className={`coupling coupling--${c.polarity === 1 ? 'pos' : 'neg'} ${dim ? 'is-dim' : ''} ${hot ? 'is-hot' : ''}`}
                markerEnd="url(#net-arrow)"
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
            <line x1={col.strings[0] ? layout.nodes.get(col.strings[0].id)?.x ?? 0 : 0} y1={layout.top - 34} x2={col.strings[0] ? layout.nodes.get(col.strings[0].id)?.x ?? 0 : 0} y2={layout.bottom} className="voice__spine" />
            <text x={col.strings[0] ? layout.nodes.get(col.strings[0].id)?.x ?? 0 : 0} y={layout.top - 48} textAnchor="middle" className="voice__label">
              {col.owner}
            </text>
            {col.strings.map((s) => {
              const n = nodeFor(s.id);
              if (!n) return null;
              const pulseActive = activePulse === s.id;
              return (
                <g
                  key={s.id}
                  className={`string string--${KIND_CLASS[s.kind] ?? 'narr'} ${pulseSet.has(s.id) ? 'is-pulse' : ''} ${pulseActive ? 'is-pulse-active' : ''}`}
                  data-string={s.id}
                  onMouseEnter={(e) => onHoverString(s.id, e.currentTarget.getBoundingClientRect())}
                  onMouseLeave={() => onHoverString(null, null)}
                  onPointerDown={(e) => {
                    if (!n.numeric || n.value === null) return;
                    const svg = svgRef.current;
                    const rect = svg?.getBoundingClientRect();
                    const scale = rect ? Math.min(rect.width / W, rect.height / H) : 1;
                    drag.current = {
                      id: s.id,
                      startY: e.clientY,
                      startX: e.clientX,
                      startValue: n.value,
                      range: n.max - n.min,
                      screenH: Math.max(1, n.h * scale),
                    };
                    setDragState({ id: s.id, dx: 0 });
                    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
                    e.preventDefault();
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current;
                    if (!d) return;
                    const dy = (d.startY - e.clientY) / d.screenH;
                    const next = d.startValue + dy * d.range * 0.65;
                    onAdjustString(d.id, next);
                    setDragState({ id: d.id, dx: Math.max(-6, Math.min(6, (e.clientX - d.startX) * 0.18)) });
                  }}
                  onPointerUp={(e) => {
                    if (drag.current) {
                      try {
                        (e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId);
                      } catch {
                        /* ignore */
                      }
                      drag.current = null;
                      setDragState(null);
                    }
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDragState(null);
                  }}
                >
                  <line x1={n.x} y1={n.y0 - 4} x2={n.x} y2={n.y0 + n.h + 4} className="string__hit" />
                  <rect x={n.x - 13} y={n.y0 - 4} width={26} height={n.h + 8} className="string__hit-area" />
                  {dragState?.id === s.id ? (
                    <path
                      d={`M ${n.x} ${n.y0} Q ${n.x + dragState.dx} ${n.y0 + n.h / 2} ${n.x} ${n.y0 + n.h}`}
                      className="string__line"
                      fill="none"
                      strokeWidth={1 + n.tension * 2.4}
                    />
                  ) : (
                    <line x1={n.x} y1={n.y0} x2={n.x} y2={n.y0 + n.h} className="string__line" strokeWidth={1 + n.tension * 2.4} />
                  )}
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
