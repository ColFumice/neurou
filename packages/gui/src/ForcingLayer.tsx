import { useMemo, useState } from 'react';
import type { IRRule, WorldIR } from '@neurou/core';
import { formatEffect, formatExpr } from './format.js';
import { Term } from './Term.js';
import type { TermId } from './terms.js';

interface ForcingLayerProps {
  world: WorldIR;
  onOpenTerm: (id: TermId, rect: DOMRect | null) => void;
}

/**
 * 力迫层：把力迫条件按「先于」排成偏序图。
 * 点一个节点，看它在什么条件下触发、触发后改什么。
 */
export function ForcingLayer({ world, onOpenTerm }: ForcingLayerProps) {
  const forcings = world.rules.filter((r) => r.kind === 'forcing' && !r.name.startsWith('调性.'));
  const [selected, setSelected] = useState<string | null>(forcings[0]?.id ?? null);

  const layout = useMemo(() => {
    const byName = new Map(forcings.map((f) => [f.name, f]));
    const depth = new Map<string, number>();
    const visiting = new Set<string>();
    const compute = (f: IRRule): number => {
      const known = depth.get(f.id);
      if (known !== undefined) return known;
      if (visiting.has(f.id)) return 0;
      visiting.add(f.id);
      let d = 0;
      for (const b of f.before) {
        const target = byName.get(b);
        if (target) d = Math.max(d, compute(target) + 1);
      }
      visiting.delete(f.id);
      depth.set(f.id, d);
      return d;
    };
    for (const f of forcings) compute(f);
    const levels = new Map<number, IRRule[]>();
    for (const f of forcings) {
      const d = depth.get(f.id) ?? 0;
      const arr = levels.get(d) ?? [];
      arr.push(f);
      levels.set(d, arr);
    }
    const W = 1200;
    const H = 760;
    const positions = new Map<string, { x: number; y: number }>();
    const maxLevel = Math.max(0, ...[...levels.keys()]);
    for (const [level, list] of levels) {
      const usableTop = 120;
      const usableBottom = H - 100;
      const spacing = (usableBottom - usableTop) / Math.max(1, list.length);
      list.forEach((f, i) => {
        const x = 130 + (maxLevel === 0 ? 0 : (level / maxLevel) * (W - 560));
        const y = usableTop + (i + 0.5) * spacing;
        positions.set(f.id, { x, y });
      });
    }
    return { W, H, positions, byName };
  }, [forcings]);

  const selectedRule = forcings.find((f) => f.id === selected) ?? null;
  const guard = selectedRule?.guard ? formatExpr(world, selectedRule.guard) : '真';

  return (
    <div className="forcing-layer" data-testid="forcing-layer">
      <div className="forcing-layer__head">
        <Term id="力迫" onOpen={onOpenTerm} />
        <span>力迫层 · 偏序</span>
        <span className="forcing-layer__hint">Esc 返回调律台</span>
      </div>

      <svg className="forcing-layer__svg" viewBox={`0 0 ${layout.W} ${layout.H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="force-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
          </marker>
        </defs>
        {forcings.map((f) =>
          f.before.map((b) => {
            const target = layout.byName.get(b);
            if (!target) return null;
            const a = layout.positions.get(f.id);
            const c = layout.positions.get(target.id);
            if (!a || !c) return null;
            const mx = (a.x + c.x) / 2;
            return (
              <path
                key={`${f.id}->${target.id}`}
                d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${c.y}, ${c.x} ${c.y}`}
                className="force-edge"
                markerEnd="url(#force-arrow)"
              />
            );
          }),
        )}
        {forcings.map((f) => {
          const p = layout.positions.get(f.id);
          if (!p) return null;
          const active = selected === f.id;
          return (
            <g
              key={f.id}
              className={`force-node ${active ? 'is-on' : ''}`}
              data-force-node={f.id}
              onClick={() => setSelected(f.id)}
              transform={`translate(${p.x} ${p.y})`}
            >
              <rect x="-9" y="-9" width="18" height="18" transform="rotate(45)" />
              <text y="34" textAnchor="middle" className="force-node__name">
                {f.name}
              </text>
              {f.irreversible && <circle cx="13" cy="-13" r="2.5" className="force-node__irreversible" />}
            </g>
          );
        })}
      </svg>

      {selectedRule && (
        <div className="forcing-panel" data-testid="forcing-panel">
          <div className="forcing-panel__head">
            <strong>{selectedRule.name}</strong>
            <span>{selectedRule.irreversible ? '不可逆' : selectedRule.repeat ? '可重复' : '一次性'}</span>
          </div>
          <div className="forcing-panel__label">当</div>
          <div className="forcing-panel__code">{guard}</div>
          <div className="forcing-panel__label">效果</div>
          <div className="forcing-panel__effects">
            {selectedRule.effects.map((e, i) => (
              <div key={i}>{formatEffect(world, e)}</div>
            ))}
          </div>
          {selectedRule.before.length > 0 && (
            <div className="forcing-panel__order">先于：{selectedRule.before.join('、')}</div>
          )}
        </div>
      )}
    </div>
  );
}
