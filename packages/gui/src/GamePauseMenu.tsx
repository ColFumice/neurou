interface GamePauseMenuProps {
  language: 'zh' | 'en';
  onResume: () => void;
  onSwitch: () => void;
  onWorld: () => void;
}

/** v1.39：暂停菜单。继续 / 换游戏 / 回世界。 */
export function GamePauseMenu({ language, onResume, onSwitch, onWorld }: GamePauseMenuProps): JSX.Element {
  const text =
    language === 'en'
      ? { resume: 'Resume', switch: 'Switch game', world: 'Back to world' }
      : { resume: '继续', switch: '换游戏', world: '回世界' };
  return (
    <div className="game-pause-menu" data-testid="game-pause-menu">
      <button type="button" data-game-action="resume" onClick={onResume}>
        {text.resume}
      </button>
      <button type="button" data-game-action="switch" onClick={onSwitch}>
        {text.switch}
      </button>
      <button type="button" data-game-action="world" onClick={onWorld}>
        {text.world}
      </button>
    </div>
  );
}
