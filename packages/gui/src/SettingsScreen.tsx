import { useEffect, useState } from 'react';
import { SETTINGS_TEXT, type Language } from './i18n.js';

interface SettingsScreenProps {
  language: Language;
  onLanguage: (language: Language) => void;
  onClose: () => void;
}

/** 设置页：沿用初始界面的文本菜单风格；不使用弹窗，光标继续跟随。 */
export function SettingsScreen({ language, onLanguage, onClose }: SettingsScreenProps): JSX.Element {
  const text = SETTINGS_TEXT[language];
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState(language === 'en' ? 1 : 0);

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
    const onKey = (event: KeyboardEvent): void => {
      if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.code)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setHovered(null);
      if (event.code === 'Escape') {
        onClose();
        return;
      }
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        setSelected((index) => (index + (event.code === 'ArrowDown' ? 1 : -1) + 2) % 2);
        return;
      }
      onLanguage(selected === 0 ? 'zh' : 'en');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, onLanguage, onClose]);

  const rows = [
    { id: 'zh' as Language, label: text.zh, note: '中文 · Microsoft YaHei Light' },
    { id: 'en' as Language, label: text.en, note: 'English · handwritten italic' },
  ];

  return (
    <div className="start-screen start-screen--settings" data-testid="settings-screen" data-language={language}>
      <div
        className="start-left"
        style={{ transform: `translate3d(${pointer.x * 3}px, ${pointer.y * 2}px, 0)` }}
      >
        <div className="start-title" style={{ transform: `translate3d(${pointer.x * 8}px, ${pointer.y * 5}px, 0)` }}>
          {text.title}
        </div>
        <div className="start-subtitle" style={{ transform: `translate3d(${pointer.x * 5}px, ${pointer.y * 3}px, 0)` }}>
          {text.language}
        </div>
        <div className="start-list" onMouseLeave={() => setHovered(null)}>
          {rows.map((row, index) => {
            const active = hovered === index || (hovered === null && selected === index) || language === row.id;
            return (
              <button
                key={row.id}
                type="button"
                className={`start-item${active ? ' start-item--selected' : ''}`}
                data-settings-language={row.id}
                style={{
                  transform: `translate3d(${pointer.x * (active ? 30 : 8)}px, ${pointer.y * (active ? 16 : 5)}px, 0)`,
                }}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
                onClick={() => onLanguage(row.id)}
              >
                <span>{row.label}</span>
                <em>{row.note}</em>
              </button>
            );
          })}
        </div>
        <div className="start-footer">
          <div>{text.note}</div>
          <div style={{ cursor: 'none' }} onClick={onClose}>
            {text.back}
          </div>
        </div>
      </div>
      <div className="start-stage">
        <div className="start-stage__hint">Language / Type</div>
      </div>
    </div>
  );
}
