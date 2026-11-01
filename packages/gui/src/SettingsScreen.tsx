import { useEffect, useState } from 'react';
import type { GameThemePreference } from './gameTheme.js';
import { GAME_THEME_PRESETS, type GameThemePresetName } from './gameThemePreset.js';
import { SETTINGS_TEXT, type Language } from './i18n.js';

interface SettingsScreenProps {
  language: Language;
  theme: GameThemePreference;
  preset: GameThemePresetName;
  onLanguage: (language: Language) => void;
  onTheme: (theme: GameThemePreference) => void;
  onPreset: (preset: GameThemePresetName) => void;
  onClose: () => void;
}

type Row =
  | { kind: 'language'; id: Language; label: string; note: string }
  | { kind: 'theme'; id: GameThemePreference; label: string; note: string }
  | { kind: 'preset'; id: GameThemePresetName; label: string; note: string };

/** 设置页：语言 + 游戏主题 + 主题预设；沿用初始界面的文本菜单风格。 */
export function SettingsScreen({
  language,
  theme,
  preset,
  onLanguage,
  onTheme,
  onPreset,
  onClose,
}: SettingsScreenProps): JSX.Element {
  const text = SETTINGS_TEXT[language];
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const rows: Row[] = [
    { kind: 'language', id: 'zh', label: text.zh, note: '中文 · Microsoft YaHei Light' },
    { kind: 'language', id: 'en', label: text.en, note: 'English · handwritten italic' },
    { kind: 'theme', id: 'dark', label: text.dark, note: 'Game theme · 深色' },
    { kind: 'theme', id: 'light', label: text.light, note: 'Game theme · 浅色' },
    { kind: 'theme', id: 'auto', label: text.auto, note: 'Game theme · 跟随系统' },
    ...GAME_THEME_PRESETS.map<Row>((item) => ({
      kind: 'preset',
      id: item.id,
      label: item.label[language],
      note: `Preset · ${item.id}`,
    })),
  ];
  const isActive = (row: Row): boolean =>
    row.kind === 'language' ? row.id === language : row.kind === 'theme' ? row.id === theme : row.id === preset;
  const activeIndex = Math.max(0, rows.findIndex(isActive));
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
      else if (row.kind === 'theme') onTheme(row.id);
      else onPreset(row.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // rows 由当前 language/theme/preset 派生。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, onLanguage, onTheme, onPreset, onClose, language, theme, preset]);

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
            const active = hovered === index || (hovered === null && selected === index) || isActive(row);
            return (
              <button
                key={`${row.kind}-${row.id}`}
                type="button"
                className={`start-item${active ? ' start-item--selected' : ''}`}
                data-settings-language={row.kind === 'language' ? row.id : undefined}
                data-settings-theme={row.kind === 'theme' ? row.id : undefined}
                data-settings-preset={row.kind === 'preset' ? row.id : undefined}
                style={{
                  transform: `translate3d(${pointer.x * (active ? 30 : 8)}px, ${pointer.y * (active ? 16 : 5)}px, 0)`,
                }}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
                onClick={() => {
                  if (row.kind === 'language') onLanguage(row.id);
                  else if (row.kind === 'theme') onTheme(row.id);
                  else onPreset(row.id);
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
        <div className="start-stage__hint">Language / Game theme / Preset</div>
      </div>
    </div>
  );
}
