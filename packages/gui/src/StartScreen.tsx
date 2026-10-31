import { useEffect, useRef, useState } from 'react';
import { START_TEXT, type Language } from './i18n.js';

export interface StartItem {
  id: string;
  label: string;
  note: string;
  file?: string;
  children?: StartItem[];
  localId?: string;
}

export interface StartScreenProps {
  items: StartItem[];
  onChoose: (item: StartItem) => void;
  onAddWorld?: () => void;
  onRenameWorld?: (item: StartItem) => void;
  onDeleteWorld?: (item: StartItem) => void;
  onExportWorld?: (item: StartItem) => void;
  onImportWorld?: () => void;
  language?: Language;
  leaving?: boolean;
  entering?: boolean;
}

/**
 * 进入界面：左半屏白底黑字文本菜单；世界收进二级文件夹。
 * 方向键 + Enter / 鼠标都可以选择。
 */
export function StartScreen({
  items,
  onChoose,
  onAddWorld,
  onRenameWorld,
  onDeleteWorld,
  onExportWorld,
  onImportWorld,
  language = 'zh',
  leaving = false,
  entering = false,
}: StartScreenProps): JSX.Element {
  const text = START_TEXT[language];
  const [selected, setSelected] = useState(0);
  const [folderIndex, setFolderIndex] = useState<number | null>(null);
  const [folderSelected, setFolderSelected] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [folderHovered, setFolderHovered] = useState<number | null>(null);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);

  const folder = folderIndex === null ? null : items[folderIndex] ?? null;
  const children = folder?.children ?? [];
  const inFolder = folder !== null;
  const activeIndex = inFolder ? folderSelected : selected;
  const activeLength = inFolder ? children.length : items.length;

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      setPointer({
        x: (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2,
        y: (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2,
      });
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const codes = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'];
      if (!codes.includes(event.code)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setHovered(null);
      setFolderHovered(null);
      setKeyboardActive(true);
      if (inFolder) {
        if (event.code === 'ArrowUp') {
          setFolderSelected((index) => (index - 1 + children.length) % Math.max(1, children.length));
        } else if (event.code === 'ArrowDown') {
          setFolderSelected((index) => (index + 1) % Math.max(1, children.length));
        } else if (event.code === 'ArrowLeft' || event.code === 'Escape') {
          setFolderIndex(null);
        } else {
          const item = children[folderSelected];
          if (item) onChoose(item);
        }
        return;
      }
      if (event.code === 'ArrowUp') setSelected((index) => (index - 1 + items.length) % items.length);
      else if (event.code === 'ArrowDown') setSelected((index) => (index + 1) % items.length);
      else if (event.code === 'ArrowRight') {
        const item = items[selected];
        if (item?.children?.length) {
          setFolderIndex(selected);
          setFolderSelected(0);
        }
      } else {
        const item = items[selected];
        if (!item) return;
        if (item.children?.length) {
          setFolderIndex(selected);
          setFolderSelected(0);
        } else {
          onChoose(item);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [items, selected, inFolder, folderSelected, children, onChoose]);

  const highlightTop = (index: number): boolean =>
    (keyboardActive && index === selected) || index === hovered || (folderIndex === index && !inFolder);
  const highlightChild = (index: number): boolean =>
    (keyboardActive && index === folderSelected) || index === folderHovered;

  return (
    <div
      className={`start-screen${leaving ? ' start-screen--leaving' : ''}${entering ? ' start-screen--entering' : ''}`}
      data-testid="start-screen"
      data-start-selected={selected}
      data-start-folder={folderIndex ?? ''}
      data-folder-selected={inFolder ? folderSelected : ''}
      ref={rootRef}
    >
      <div
        className="start-left"
        style={{ transform: `translate3d(${pointer.x * 3}px, ${pointer.y * 2}px, 0)` }}
      >
        <div
          className="start-title"
          style={{ transform: `translate3d(${pointer.x * 8}px, ${pointer.y * 5}px, 0)` }}
        >
          雨若
        </div>
        <div className="start-subtitle" style={{ transform: `translate3d(${pointer.x * 5}px, ${pointer.y * 3}px, 0)` }}>
          neurou · 弦网络世界
        </div>
        <div className="start-list" onMouseLeave={() => setHovered(null)}>
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`start-item${highlightTop(index) ? ' start-item--selected' : ''}`}
              data-start-item={item.id}
              style={{
                transform: `translate3d(${pointer.x * (highlightTop(index) ? 30 : 8)}px, ${pointer.y * (highlightTop(index) ? 16 : 5)}px, 0)`,
              }}
              onMouseEnter={() => {
                setKeyboardActive(false);
                setHovered(index);
                if (item.children?.length) {
                  setFolderIndex(index);
                  setFolderSelected(0);
                }
              }}
              onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
              onClick={() => {
                setHovered(null);
                if (item.children?.length) {
                  setFolderIndex(index);
                  setFolderSelected(0);
                  return;
                }
                setFolderIndex(null);
                onChoose(item);
              }}
            >
              <span>{item.label}</span>
              <em>{item.note}</em>
            </button>
          ))}
        </div>
        <div className="start-footer">
          <div>{inFolder ? text.footerFolder : text.footerTop}</div>
          <div>{language === 'en' ? 'right side plays strings' : '右侧可直接弹奏弦与持续音'}</div>
        </div>
      </div>
      <div className="start-stage">
        <div className="start-stage__hint">{text.rightHint}</div>
      </div>
      {folder && children.length > 0 ? (
        <div
          className="start-folder"
          data-testid="start-folder"
          style={{
            transform: `translate3d(${pointer.x * 18}px, ${pointer.y * 10}px, 0)`,
          }}
        >
          <div className="start-folder__title">{folder.label}</div>
          {children.map((child, index) => (
            <div className="start-folder__row" key={child.id}>
              <button
                type="button"
                className={`start-folder__item${highlightChild(index) ? ' start-folder__item--selected' : ''}`}
                data-start-child={child.id}
                onMouseEnter={() => {
                  setKeyboardActive(false);
                  setFolderHovered(index);
                }}
                onMouseLeave={() => setFolderHovered((current) => (current === index ? null : current))}
                onClick={() => {
                  setFolderHovered(null);
                  onChoose(child);
                }}
              >
                <span>{child.label}</span>
                <em>{child.note}</em>
              </button>
              {child.localId ? (
                <span className="start-folder__actions">
                  <button type="button" title="导出 .nro" onClick={() => onExportWorld?.(child)}>
                    ↓
                  </button>
                  <button type="button" title="重命名" onClick={() => onRenameWorld?.(child)}>
                    ✎
                  </button>
                  <button type="button" title="删除" onClick={() => onDeleteWorld?.(child)}>
                    ×
                  </button>
                </span>
              ) : null}
            </div>
          ))}
          <div className="start-folder__footer">
            {onAddWorld ? (
              <button
                type="button"
                className="start-folder__add"
                data-testid="add-world"
                onClick={() => {
                  setFolderHovered(null);
                  onAddWorld();
                }}
              >
                <span>＋ 添加世界</span>
                <em>模板向导</em>
              </button>
            ) : null}
            {onImportWorld ? (
              <button
                type="button"
                className="start-folder__import"
                data-testid="import-world"
                onClick={() => onImportWorld()}
              >
                <span>导入 .nro</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
