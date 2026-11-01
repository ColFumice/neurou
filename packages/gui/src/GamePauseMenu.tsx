interface GamePauseMenuProps {
  language: 'zh' | 'en';
  onResume: () => void;
  onSwitch: () => void;
  onWorld: () => void;
  onHelp?: () => void;
}

/** v1.39：暂停菜单。继续 / 换游戏 / 帮助 / 回世界。 */
export function GamePauseMenu({ language, onResume, onSwitch, onWorld, onHelp }: GamePauseMenuProps): JSX.Element {
  const text =
    language === 'en'
      ? { resume: 'Resume', switch: 'Switch game', world: 'Back to world', help: 'Help' }
      : { resume: '继续', switch: '换游戏', world: '回世界', help: '帮助' };
  return (
    <div className="game-pause-menu" data-testid="game-pause-menu">
      <button type="button" data-game-action="resume" onClick={onResume}>
        {text.resume}
      </button>
      <button type="button" data-game-action="switch" onClick={onSwitch}>
        {text.switch}
      </button>
      {onHelp ? (
        <button type="button" data-game-action="help" onClick={onHelp}>
          {text.help}
        </button>
      ) : null}
      <button type="button" data-game-action="world" onClick={onWorld}>
        {text.world}
      </button>
    </div>
  );
}
