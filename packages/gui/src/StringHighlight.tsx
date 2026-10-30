import { useEffect, useState } from 'react';

interface HighlightTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  key: number;
}

const SELECTOR = [
  '[data-modal-item]',
  'button',
  '.start-item',
  '.scene-row',
  '.slot-row',
  '.chapter-choice',
  '.chapter-graph-node',
].join(',');

function matchesTarget(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (!element.matches(SELECTOR)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

/**
 * 选中高亮：在目标周围生成一簇橙色弦，做差速弹动。
 * 监听焦点、点击和 class 变化，覆盖弹窗、初始菜单和列表。
 */
export function StringHighlight(): JSX.Element | null {
  const [target, setTarget] = useState<HighlightTarget | null>(null);

  useEffect(() => {
    let timer = 0;
    const show = (element: Element | null): void => {
      if (!matchesTarget(element)) return;
      const rect = element.getBoundingClientRect();
      setTarget({ x: rect.left, y: rect.top, w: rect.width, h: rect.height, key: Date.now() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTarget(null), 920);
    };
    const onFocus = (event: FocusEvent): void => show(event.target as Element | null);
    const onClick = (event: MouseEvent): void => show(event.target as Element | null);
    window.addEventListener('focusin', onFocus, true);
    window.addEventListener('click', onClick, true);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof HTMLElement) {
          const element = record.target;
          if (
            element.className.toString().includes('--selected') ||
            element.getAttribute('aria-selected') === 'true'
          ) {
            show(element);
            return;
          }
        }
        if (record.type === 'childList') {
          const selected = document.querySelector(
            '.start-item--selected, .scene-row--selected, .slot-row--selected, .chapter-choice--selected, .chapter-graph-node--current',
          );
          if (matchesTarget(selected)) show(selected);
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'aria-selected'], subtree: true, childList: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('click', onClick, true);
      observer.disconnect();
    };
  }, []);

  if (!target) return null;
  const { x, y, w, h, key } = target;
  const arcs = [
    { o: 0.95, c: '#ff7a1a', d: 0, lift: 18 },
    { o: 0.72, c: '#ff9b3d', d: 40, lift: 28 },
    { o: 0.55, c: '#ffb35c', d: 80, lift: 38 },
    { o: 0.4, c: '#ffc77d', d: 120, lift: 46 },
    { o: 0.28, c: '#ffd7a1', d: 170, lift: 54 },
    { o: 0.18, c: '#ffe4bd', d: 220, lift: 62 },
  ];
  return (
    <svg
      key={key}
      className="string-highlight"
      data-testid="string-highlight"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      {arcs.map((arc, index) => {
        const up = index % 2 === 0;
        const yy = up ? y - arc.lift : y + h + arc.lift;
        const c1 = up ? y - h * 0.7 - arc.lift : y + h * 1.7 + arc.lift;
        return (
          <path
            key={index}
            d={`M ${x - 18} ${yy} C ${x + w * 0.2} ${c1}, ${x + w * 0.8} ${c1}, ${x + w + 18} ${yy}`}
            fill="none"
            stroke={arc.c}
            strokeOpacity={arc.o}
            strokeWidth={1.4 - index * 0.12}
            strokeLinecap="round"
            className="string-highlight__arc"
            style={{ animationDelay: `${arc.d}ms` }}
          />
        );
      })}
    </svg>
  );
}
