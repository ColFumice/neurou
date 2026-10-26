import type { IRString } from '@neurou/core';
import type { ViewSnapshot } from './types.js';
import { tensionOf } from './types.js';
import { Term } from './Term.js';
import type { TermId } from './terms.js';

interface HairlinesProps {
  entity: string;
  strings: IRString[];
  snap: ViewSnapshot;
  rect: DOMRect;
  onOpenTerm: (id: TermId, rect: DOMRect | null) => void;
  onEnter: () => void;
  onLeave: () => void;
}

function place(rect: DOMRect): { left: number; top: number } {
  const width = 244;
  const height = 170;
  const left = rect.right + 18 + width > window.innerWidth ? rect.left - width - 18 : rect.right + 18;
  const top = Math.min(window.innerHeight - height - 12, Math.max(64, rect.top - 30));
  return { left: Math.max(12, left), top };
}

/**
 * 悬停角色时浮现的最小读数：
 * 只留 2–3 根离阈值最近的弦，用线的粗细和冷暖表示张力，不出现任何数字。
 */
export function Hairlines({ entity, strings, snap, rect, onOpenTerm, onEnter, onLeave }: HairlinesProps) {
  const pos = place(rect);

  const ranked = strings
    .map((s) => ({ s, t: tensionOf(s, snap.values[s.id]) }))
    .filter((x): x is { s: IRString; t: NonNullable<ReturnType<typeof tensionOf>> } => x.t !== null)
    .sort((a, b) => b.t.tension - a.t.tension);

  const hot = ranked.filter((x) => x.t.tension > 0.6);
  const shown = (hot.length > 0 ? hot : ranked.slice(0, 1)).slice(0, 3);

  // 全部品丝预算 2 个：只标出离玩家最近的那两条线。
  const frets = [...shown]
    .sort((a, b) => b.t.tension - a.t.tension)
    .slice(0, 2)
    .map((x) => x.s.id);

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
        {shown.map(({ s, t }) => (
          <div className="hline" key={s.id}>
            <span className="hline__name">{s.name}</span>
            <span className="hline__track">
              <i
                className="hline__stroke"
                style={{
                  height: `${1 + t.tension * 2.6}px`,
                  opacity: 0.35 + t.tension * 0.55,
                  background: `hsl(28, ${Math.round(15 + t.tension * 40)}%, ${Math.round(45 + t.tension * 18)}%)`,
                }}
              />
              {frets.includes(s.id) && <b className={`hline__fret hline__fret--${t.kind}`} style={{ left: `${t.position * 100}%` }} />}
            </span>
          </div>
        ))}
        {shown.length === 0 && <div className="hline hline--quiet">还没有接近阈值的弦</div>}
      </div>
    </div>
  );
}
