import { useEffect, useState } from 'react';
import type { GameThemePreference } from './gameTheme.js';
import { SETTINGS_TEXT, type Language } from './i18n.js';

interface SettingsScreenProps {
  language: Language;
  theme: GameThemePreference;
  onLanguage: (language: Language) => void;
  onTheme: (theme: GameThemePreference) => void;
  onClose: () => void;
}

/** 设置页：语言 + 游戏主题；沿用初始界面的文本菜单风格。 */
export function SettingsScreen({
  language,
  theme,
  onLanguage,
  onTheme,
  onClose,
}: SettingsScreenProps): JSX.Element {
  const text = SETTINGS_TEXT[language];
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const rows = [
    { kind: 'language' as const, id: 'zh' as Language, label: text.zh, note: '中文 · Microsoft YaHei Light' },
    { kind: 'language' as const, id: 'en' as Language, label: text.en, note: 'English · handwritten italic' },
    { kind: 'theme' as const, id: 'dark' as GameThemePreference, label: text.dark, note: 'Game theme · 深色' },
    { kind: 'theme' as const, id: 'light' as GameThemePreference, label: text.light, note: 'Game theme · 浅色' },
    { kind: 'theme' as const, id: 'auto' as GameThemePreference, label: text.auto, note: 'Game theme · 跟随系统' },
  ];
  const activeIndex = Math.max(
    0,
    rows.findIndex((row) => (row.kind === 'language' ? row.id === language : row.id === theme)),
  );
  const [selected, setSelected] = useState(activeIndex);

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
        setSelected((index) => (index + (event.code === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
        return;
      }
      const row = rows[selected];
      if (!row) return;
      if (row.kind === 'language') onLanguage(row.id);
      else onTheme(row.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, onLanguage, onTheme, onClose, rows]);

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
          {text.language} · {text.theme}
        </div>
        <div className="start-list" onMouseLeave={() => setHovered(null)}>
          {rows.map((row, index) => {
            const isActive = row.kind === 'language' ? row.id === language : row.id === theme;
            const active = hovered === index || (hovered === null && selected === index) || isActive;
            return (
              <button
                key={`${row.kind}-${row.id}`}
                type="button"
                className={`start-item${active ? ' start-item--selected' : ''}`}
                data-settings-language={row.kind === 'language' ? row.id : undefined}
                data-settings-theme={row.kind === 'theme' ? row.id : undefined}
                style={{
                  transform: `translate3d(${pointer.x * (active ? 30 : 8)}px, ${pointer.y * (active ? 16 : 5)}px, 0)`,
                }}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
                onClick={() => {
                  if (row.kind === 'language') onLanguage(row.id);
                  else onTheme(row.id);
                }}
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
        <div className="start-stage__hint">Language / Game theme</div>
      </div>
    </div>
  );
}
