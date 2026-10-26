import { useState, type ReactNode } from 'react';
import { TERMS, type TermId } from './terms.js';
import type { TermCardState, TermPopup } from './types.js';

export function Term({
  id,
  onOpen,
  children,
  className,
}: {
  id: TermId;
  onOpen: (id: TermId, rect: DOMRect | null) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`term ${className ?? ''}`}
      data-term={id}
      onMouseEnter={(e) => onOpen(id, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onOpen(id, null)}
    >
      {children ?? id}
    </span>
  );
}

/** 操作时顺手浮现的一小块字：极轻、不打断、三次之后不再出现。 */
export function TermPopupView({ popup }: { popup: TermPopup | null }) {
  if (!popup) return null;
  return (
    <div
      className="term-popup"
      style={{ left: Math.min(window.innerWidth - 80, popup.x), top: Math.min(window.innerHeight - 50, popup.y) }}
      data-testid="term-popup"
      data-term-id={popup.id}
      key={popup.nonce}
    >
      <span>{popup.id}</span>
    </div>
  );
}

/** 悬停 / 长按出现的术语卡片。不自动弹，不要求点击。 */
export function TermCardView({
  card,
  onClose,
  onEnter,
}: {
  card: TermCardState | null;
  onClose: () => void;
  onEnter: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!card) return null;
  const def = TERMS[card.id];
  const width = 300;
  const left = Math.min(window.innerWidth - width - 16, Math.max(16, card.left));
  const top = Math.min(window.innerHeight - 240, Math.max(16, card.top));
  return (
    <div
      className="term-card"
      style={{ left, top, width }}
      data-testid="term-card"
      data-term-id={card.id}
      onMouseEnter={onEnter}
      onMouseLeave={onClose}
      key={card.id}
    >
      <div className="term-card__head">
        <strong>{def.id}</strong>
        <button className="term-card__close" onClick={onClose} aria-label="收起">
          ×
        </button>
      </div>
      <p className="term-card__anchor">{def.anchor}</p>
      <p className="term-card__example">{def.example}</p>
      {expanded && <p className="term-card__detail">{def.detail}</p>}
      <button
        className="term-card__more"
        onClick={() => setExpanded((v) => !v)}
        data-testid="term-more"
      >
        {expanded ? '收起' : '展开更多'}
      </button>
    </div>
  );
}
