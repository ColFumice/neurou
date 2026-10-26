import type { IRString, WorldIR } from '@neurou/core';
import type { ViewSnapshot } from './types.js';
import { Term } from './Term.js';
import type { TermId } from './terms.js';

interface HairlinesProps {
  world: WorldIR;
  entity: string;
  strings: IRString[];
  snap: ViewSnapshot;
  rect: DOMRect;
  onOpenTerm: (id: TermId, rect: DOMRect | null) => void;
  onEnter: () => void;
  onLeave: () => void;
}

function place(rect: DOMRect): { left: number; top: number } {
  const width = 300;
  const height = 260;
  const left = rect.right + 18 + width > window.innerWidth ? rect.left - width - 18 : rect.right + 18;
  const top = Math.min(window.innerHeight - height - 12, Math.max(64, rect.top - 30));
  return { left: Math.max(12, left), top };
}

/**
 * 悬停角色时浮现的「弦状态细线」。
 * 只给看，不给调——细线本身就是这一层的最小单位。
 */
export function Hairlines({ world, entity, strings, snap, rect, onOpenTerm, onEnter, onLeave }: HairlinesProps) {
  const pos = place(rect);
  return (
    <div
      className="hairlines"
      style={pos}
      data-testid="hairlines"
      data-entity={entity}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="hairlines__head">
        <span className="hairlines__name">{entity}</span>
        <Term id="弦" onOpen={onOpenTerm} className="hairlines__term" />
      </div>
      <div className="hairlines__body">
        {strings.map((s) => {
          const v = snap.values[s.id];
          if (s.domain.type === 'number' && typeof v === 'number') {
            const min = s.domain.min ?? 0;
            const max = s.domain.max ?? 100;
            const t = max > min ? (v - min) / (max - min) : 0;
            const verge = s.verge !== undefined ? ((s.verge - min) / (max - min)) * 100 : null;
            const safe = s.safe !== undefined ? ((s.safe - min) / (max - min)) * 100 : null;
            return (
              <div className="hline" key={s.id}>
                <span className="hline__name">{s.name}</span>
                <span className="hline__track">
                  <i style={{ transform: `scaleX(${Math.max(0.01, Math.min(1, t))})` }} />
                  {verge !== null && <b className="hline__fret hline__fret--verge" style={{ left: `${verge}%` }} />}
                  {safe !== null && <b className="hline__fret hline__fret--safe" style={{ left: `${safe}%` }} />}
                  <b className="hline__dot" style={{ left: `${Math.max(0, Math.min(100, t * 100))}%` }} />
                </span>
                <span className="hline__value">{Math.round(v * 10) / 10}</span>
              </div>
            );
          }
          let text = String(v);
          if (typeof v === 'boolean') text = v ? '真' : '假';
          else if (v instanceof Set) text = v.size === 0 ? '∅' : `{${[...v].join('、')}}`;
          return (
            <div className="hline hline--text" key={s.id}>
              <span className="hline__name">{s.name}</span>
              <span className="hline__text">{text}</span>
            </div>
          );
        })}
      </div>
      <div className="hairlines__hint">hover 收起</div>
    </div>
  );
}
