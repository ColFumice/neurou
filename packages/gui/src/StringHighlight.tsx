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
    let lastElement: Element | null = null;
    let lastAt = 0;
    const show = (element: Element | null): void => {
      if (!matchesTarget(element)) return;
      const now = Date.now();
      if (element === lastElement && now - lastAt < 900) return;
      lastElement = element;
      lastAt = now;
      const rect = element.getBoundingClientRect();
      setTarget({ x: rect.left, y: rect.top, w: rect.width, h: rect.height, key: now });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTarget(null), 920);
    };
    const targetOf = (event: Event): HTMLElement | null => {
      const element = event.target;
      return element instanceof Element ? element.closest(SELECTOR) : null;
    };
    const onFocus = (event: FocusEvent): void => show(targetOf(event));
    const onClick = (event: MouseEvent): void => show(targetOf(event));
    const onPointerOver = (event: PointerEvent): void => show(targetOf(event));
    const onPointerOut = (event: PointerEvent): void => {
      const element = targetOf(event);
      const related = event.relatedTarget;
      if (element && (!(related instanceof Node) || !element.contains(related))) lastElement = null;
    };
    window.addEventListener('focusin', onFocus, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('pointerover', onPointerOver, true);
    window.addEventListener('pointerout', onPointerOut, true);
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
      window.removeEventListener('pointerover', onPointerOver, true);
      window.removeEventListener('pointerout', onPointerOut, true);
      observer.disconnect();
    };
  }, []);

  if (!target) return null;
  const { x, y, w, h, key } = target;
  const rnd = (index: number): number => {
    const value = Math.sin(key * 0.0013 + index * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  const centerY = y + h / 2;
  const arcs = Array.from({ length: 6 }, (_, index) => {
    const offset = (index - 2.5) * 3.2 + (rnd(index) - 0.5) * 2;
    const amp = 5 + rnd(index + 10) * 12;
    const phase = rnd(index + 20) * Math.PI * 2;
    const stretch = 0.18 + rnd(index + 30) * 0.34;
    const c1x = x + w * stretch;
    const c2x = x + w * (1 - stretch);
    return {
      d: `M ${x - 22} ${centerY + offset} C ${c1x} ${centerY + offset - amp * Math.cos(phase)}, ${c2x} ${centerY + offset + amp * Math.sin(phase)}, ${x + w + 22} ${centerY - offset}`,
      opacity: 0.85 - index * 0.1,
      color: index % 2 === 0 ? '#ff7a1a' : '#ffb15a',
      delay: Math.round(rnd(index + 40) * 160),
    };
  });
  return (
    <svg
      key={key}
      className="string-highlight"
      data-testid="string-highlight"
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      {arcs.map((arc, index) => (
        <path
          key={index}
          d={arc.d}
          fill="none"
          stroke={arc.color}
          strokeOpacity={arc.opacity}
          strokeWidth={1.5 - index * 0.13}
          strokeLinecap="round"
          className="string-highlight__arc"
          style={{ animationDelay: `${arc.delay}ms` }}
        />
      ))}
    </svg>
  );
}
