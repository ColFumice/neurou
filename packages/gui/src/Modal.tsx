import { useEffect, useRef, type ReactNode } from 'react';

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * 黑色圆角弹窗：周围暗化、点击外部关闭；
 * 方向键在弹窗内按钮之间移动，Enter 触发。
 */
export function Modal({ onClose, children, className = '', testId }: ModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const items = (): HTMLElement[] => {
    const root = dialogRef.current;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>('[data-modal-item], button')].filter(
      (element) => !element.hasAttribute('disabled') && element.offsetParent !== null,
    );
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const first = items()[0] ?? dialogRef.current;
      first?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="modal-backdrop" data-testid={testId ?? 'modal'} onMouseDown={onClose}>
      <div
        className={`modal-window ${className}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        data-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement | null;
          const editing = Boolean(target?.closest('input, textarea, select'));
          if (event.code === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (editing && event.code !== 'Enter') return;
          const list = items();
          if (list.length === 0) return;
          const active = document.activeElement as HTMLElement | null;
          const index = active ? list.indexOf(active) : -1;
          if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            const step = event.code === 'ArrowDown' ? 1 : -1;
            const next = index < 0 ? 0 : (index + step + list.length) % list.length;
            list[next]?.focus();
          } else if (event.code === 'Home' || event.code === 'End') {
            event.preventDefault();
            list[event.code === 'Home' ? 0 : list.length - 1]?.focus();
          } else if (event.code === 'Enter' && active && active.tagName !== 'BUTTON' && active.dataset.modalItem) {
            event.preventDefault();
            active.click();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
