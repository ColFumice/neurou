import { useEffect, useMemo, useState } from 'react';
import type { IRGame } from '@neurou/core';
import type { Language } from './i18n.js';

interface GamePickerProps {
  games: readonly IRGame[];
  language: Language;
  /** 初始选中：匹配当前焦点弦的游戏。 */
  initialResultString?: string;
  onChoose: (game: IRGame) => void;
  onClose: () => void;
}

const TEXT = {
  zh: {
    title: '选择游戏',
    hint: '↑ / ↓ 选择 · Enter 进入 · Esc 返回',
    result: '结果弦',
    empty: '这个世界还没有声明游戏。',
  },
  en: {
    title: 'Choose a Game',
    hint: '↑ / ↓ choose · Enter open · Esc back',
    result: 'Result string',
    empty: 'This world has no declared games.',
  },
} as const;

/** v1.37：多游戏世界的显式选择层；不弹窗，沿用文本菜单风格。 */
export function GamePicker({ games, language, initialResultString, onChoose, onClose }: GamePickerProps): JSX.Element {
  const text = TEXT[language];
  const initial = useMemo(() => {
    if (!initialResultString) return 0;
    const found = games.findIndex(
      (game) => game.resultString === initialResultString || game.resultStringId === initialResultString,
    );
    return found >= 0 ? found : 0;
  }, [games, initialResultString]);
  const [selected, setSelected] = useState(initial);

  useEffect(() => {
    setSelected(initial);
  }, [initial]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Escape' || event.code === 'F6') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.code === 'ArrowUp' || event.code === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelected((current) => Math.max(0, current - 1));
        return;
      }
      if (event.code === 'ArrowDown' || event.code === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelected((current) => Math.min(Math.max(0, games.length - 1), current + 1));
        return;
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const game = games[selected];
        if (game) onChoose(game);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [games, onChoose, onClose, selected]);

  return (
    <div className="game-picker" data-testid="game-picker">
      <div className="game-picker__title">{text.title}</div>
      <div className="game-picker__list">
        {games.map((game, index) => {
          const active = index === selected;
          return (
            <button
              key={game.name}
              type="button"
              className={`game-picker__item${active ? ' game-picker__item--active' : ''}`}
              data-game-choice={game.name}
              data-game-module={game.module}
              onMouseEnter={() => setSelected(index)}
              onClick={() => onChoose(game)}
            >
              <span className="game-picker__name">{game.name}</span>
              <span className="game-picker__meta">
                {game.module} · {text.result} {game.resultString}
              </span>
              {game.description ? <span className="game-picker__desc">{game.description}</span> : null}
            </button>
          );
        })}
        {games.length === 0 ? <div className="game-picker__empty">{text.empty}</div> : null}
      </div>
      <div className="game-picker__hint">{text.hint}</div>
    </div>
  );
}
