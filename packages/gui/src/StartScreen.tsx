import { useEffect, useRef, useState } from 'react';

export interface StartItem {
  id: string;
  label: string;
  note: string;
  file?: string;
}

export interface StartScreenProps {
  items: StartItem[];
  onChoose: (item: StartItem) => void;
}

/**
 * 进入界面：左半屏白底黑字文本菜单；右半屏保留弦/音乐交互。
 * 方向键 + Enter / 鼠标都可以选择。
 */
export function StartScreen({ items, onChoose }: StartScreenProps): JSX.Element {
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const codes = ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'];
      if (!codes.includes(event.code)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setHovered(null);
      setKeyboardActive(true);
      if (event.code === 'ArrowUp') setSelected((index) => (index - 1 + items.length) % items.length);
      else if (event.code === 'ArrowDown') setSelected((index) => (index + 1) % items.length);
      else {
        const item = items[selected];
        if (item) onChoose(item);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [items, selected, onChoose]);

  return (
    <div className="start-screen" data-testid="start-screen" data-start-selected={selected} ref={rootRef}>
      <div className="start-left">
        <div className="start-title">雨若</div>
        <div className="start-subtitle">neurou · 弦网络世界</div>
        <div className="start-list" onMouseLeave={() => setHovered(null)}>
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`start-item${index === hovered || (keyboardActive && index === selected) ? ' start-item--selected' : ''}`}
              data-start-item={item.id}
              onMouseEnter={() => {
                setKeyboardActive(false);
                setHovered(index);
              }}
              onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
              onClick={() => {
                setHovered(null);
                onChoose(item);
              }}
            >
              <span>{item.label}</span>
              <em>{item.note}</em>
            </button>
          ))}
        </div>
        <div className="start-footer">
          <div>↑/↓ 选择 · Enter 进入 · Esc 进入默认世界</div>
          <div>右侧可直接弹奏弦与持续音</div>
        </div>
      </div>
      <div className="start-stage">
        <div className="start-stage__hint">弦 / 音乐</div>
      </div>
    </div>
  );
}
