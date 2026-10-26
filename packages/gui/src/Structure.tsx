import { useMemo } from 'react';
import type { IRCoupling, IRString, WorldIR } from '@neurou/core';
import { Scene } from './Scene.js';
import type { ViewSnapshot } from './types.js';
import type { Tuning } from './tuning.js';

interface StructureProps {
  world: WorldIR;
  snap: ViewSnapshot;
  tuning: Tuning;
  visuals: Record<string, number>;
  activeLoop: string | null;
  pulse: { strings: string[]; index: number } | null;
  onHoverLoop: (id: string | null, rect: DOMRect | null) => void;
  onPluck: (loopId: string) => void;
}

interface Seg {
  s: IRString;
  x: number;
  y: number;
  w: number;
  min: number;
  max: number;
  value: number | null;
  frets: { v: number; kind: 'verge' | 'safe' }[];
}

const W = 1200;
const H = 700;
const LEFT = 250;
const RIGHT = 60;
const TOP = 118;
const ROW = 158;

function shortName(s: IRString): string {
  if (s.kind === '关系' && s.name.includes('的')) {
    const tail = s.name.split('的').pop();
    if (tail && tail.length > 0) return tail;
  }
  return s.name.length > 6 ? `${s.name.slice(0, 5)}…` : s.name;
}

function isNumeric(s: IRString): boolean {
  return s.domain.type === 'number';
}

function displayValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? '真' : '假';
  if (v instanceof Set) return v.size === 0 ? '∅' : `{${[...v].join('、')}}`;
  if (v === null || v === undefined) return '—';
  return String(v);
}

/**
 * 结构层：只读的弦网络。
 *
 * 声部线 = 实体；线上的刻度 = 阈值（品丝）；连线 = 回路。
 * 没有任何编辑入口——这一层只负责让人看见「世界是怎么接起来的」。
 */
export function Structure({ world, snap, tuning, visuals, activeLoop, pulse, onHoverLoop, onPluck }: StructureProps) {
  const layout = useMemo(() => {
    const rows: { owner: string; strings: IRString[] }[] = [];
    const map = new Map<string, IRString[]>();
    for (const s of world.strings) {
      if (s.id.startsWith('调性.')) continue;
      const owner = s.owner ?? '世界';
      const arr = map.get(owner) ?? [];
      arr.push(s);
      map.set(owner, arr);
    }
    for (const [owner, strings] of map) rows.push({ owner, strings });

    const segs = new Map<string, Seg>();
    rows.forEach((row, rowIndex) => {
      const y = TOP + rowIndex * ROW;
      const count = Math.max(1, row.strings.length);
      const usable = W - LEFT - RIGHT;
      const gap = 18;
      const width = usable / count - gap;
      row.strings.forEach((s, i) => {
        const x = LEFT + i * (width + gap);
        const min = isNumeric(s) && s.domain.type === 'number' ? (s.domain.min ?? 0) : 0;
        const max = isNumeric(s) && s.domain.type === 'number' ? (s.domain.max ?? 100) : 100;
        const val = snap.values[s.id];
        const value = typeof val === 'number' ? Math.min(max, Math.max(min, val)) : null;
        const frets: Seg['frets'] = [];
        if (s.verge !== undefined) frets.push({ v: s.verge, kind: 'verge' });
        if (s.safe !== undefined) frets.push({ v: s.safe, kind: 'safe' });
        segs.set(s.id, { s, x, y, w: width, min, max, value, frets });
      });
    });
    return { rows, segs };
  }, [world, snap]);

  const pulseSet = useMemo(() => new Set(pulse?.strings ?? []), [pulse]);
  const activeString = pulse && pulse.strings[pulse.index] ? pulse.strings[pulse.index]! : null;
  const pulseOwner = activeString ? world.strings.find((s) => s.id === activeString)?.owner ?? null : null;
  void pulseSet;

  return (
    <div className="layer layer--structure" data-testid="structure">
      <div className="ghost" aria-hidden="true">
        <Scene world={world} snap={snap} tuning={tuning} visuals={visuals} ghost pulseEntity={pulseOwner} />
      </div>

      <div className="structure__note">
        只读结构 · 拨一条回路看连锁 · <span className="kbd">Tab</span> 回到现象
      </div>

      <svg className="structure__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="loop-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {layout.rows.map((row, i) => (
          <g key={row.owner} className="voice">
            <text x={70} y={TOP + i * ROW - 4} className="voice__name">
              {row.owner}
            </text>
            <line x1={70} y1={TOP + i * ROW + 40} x2={W - 40} y2={TOP + i * ROW + 40} className="voice__line" />
          </g>
        ))}

        {[...layout.segs.values()].map((seg) => {
          const numeric = isNumeric(seg.s);
          const t = numeric && seg.value !== null && seg.max > seg.min ? (seg.value - seg.min) / (seg.max - seg.min) : 0.5;
          const active = activeString === seg.s.id;
          return (
            <g key={seg.s.id} className={`seg ${active ? 'seg--pulse' : ''}`} data-string={seg.s.id}>
              <text x={seg.x} y={seg.y - 10} className="seg__name">
                {shortName(seg.s)}
              </text>
              <line x1={seg.x} y1={seg.y + 22} x2={seg.x + seg.w} y2={seg.y + 22} className="seg__track" />
              {numeric &&
                seg.frets.map((f, i) => {
                  const ft = (f.v - seg.min) / (seg.max - seg.min || 1);
                  return (
                    <line
                      key={i}
                      x1={seg.x + ft * seg.w}
                      y1={seg.y + 14}
                      x2={seg.x + ft * seg.w}
                      y2={seg.y + 30}
                      className={`seg__fret seg__fret--${f.kind}`}
                    />
                  );
                })}
              {numeric && seg.value !== null && (
                <g className="seg__marker">
                  <circle cx={seg.x + t * seg.w} cy={seg.y + 22} r={5} />
                  <text x={seg.x + t * seg.w} y={seg.y + 48} textAnchor="middle" className="seg__value">
                    {Math.round(seg.value * 10) / 10}
                  </text>
                </g>
              )}
              {!numeric && (
                <text x={seg.x + seg.w / 2} y={seg.y + 26} textAnchor="middle" className="seg__value">
                  {displayValue(snap.values[seg.s.id])}
                </text>
              )}
            </g>
          );
        })}

        {world.loops.map((loop) => {
          const edges = loop.edges
            .map((id) => world.couplings.find((c) => c.id === id))
            .filter((c): c is IRCoupling => !!c);
          const paths: string[] = [];
          for (const e of edges) {
            const a = layout.segs.get(e.from);
            const b = layout.segs.get(e.to);
            if (!a || !b) continue;
            const x1 = a.x + a.w / 2;
            const y1 = a.y + 22;
            const x2 = b.x + b.w / 2;
            const y2 = b.y + 22;
            if (a === b) {
              paths.push(`M ${x1 - 30} ${y1 - 18} C ${x1 - 50} ${y1 - 70}, ${x1 + 50} ${y1 - 70}, ${x1 + 30} ${y1 - 18}`);
            } else if (Math.abs(y1 - y2) < 2) {
              paths.push(`M ${x1} ${y1 - 6} C ${x1} ${y1 - 48}, ${x2} ${y2 - 48}, ${x2} ${y2 - 6}`);
            } else {
              const mx = (x1 + x2) / 2 + (y2 > y1 ? 70 : -70);
              const my = (y1 + y2) / 2;
              paths.push(`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
            }
          }
          const active = activeLoop === loop.id;
          return (
            <g
              key={loop.id}
              className={`loop loop--${loop.polarity === 1 ? 'reinforce' : 'balance'} ${active ? 'loop--active' : ''}`}
              data-loop={loop.id}
              onMouseEnter={(e) => onHoverLoop(loop.id, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => onHoverLoop(null, null)}
              onPointerDown={() => onPluck(loop.id)}
              role="button"
              tabIndex={0}
              aria-label={`拨动回路 ${loop.name}`}
            >
              {paths.map((d, i) => (
                <g key={i}>
                  <path d={d} className="loop__hit" />
                  <path d={d} className="loop__path" markerEnd="url(#loop-arrow)" />
                </g>
              ))}
            </g>
          );
        })}
      </svg>

      {pulse && pulse.strings.length > 0 && (
        <div className="structure__chain" data-testid="chain">
          连锁：{pulse.strings.map((id) => world.strings.find((s) => s.id === id)?.name ?? id).join(' → ')}
        </div>
      )}

      <div className="structure__legend">
        <span className="structure__legend-title">回路</span>
        {world.loops.map((loop) => (
          <button
            key={loop.id}
            className={`legend legend--${loop.polarity === 1 ? 'reinforce' : 'balance'} ${
              activeLoop === loop.id ? 'is-on' : ''
            }`}
            data-loop-legend={loop.id}
            onMouseEnter={(e) => onHoverLoop(loop.id, e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => onHoverLoop(null, null)}
            onClick={() => onPluck(loop.id)}
          >
            <i />
            <span>{loop.name}</span>
            <em>{loop.polarity === 1 ? '自我强化' : '自我校正'}</em>
          </button>
        ))}
      </div>
    </div>
  );
}
