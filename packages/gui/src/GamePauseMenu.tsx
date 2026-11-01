interface GamePauseMenuProps {
  language: 'zh' | 'en';
  onResume: () => void;
  onSwitch: () => void;
  onWorld: () => void;
  onHelp?: () => void;
  onParams?: () => void;
}

/** v1.39：暂停菜单。继续 / 换游戏 / 参数 / 帮助 / 回世界。 */
export function GamePauseMenu({
  language,
  onResume,
  onSwitch,
  onWorld,
  onHelp,
  onParams,
}: GamePauseMenuProps): JSX.Element {
  const text =
    language === 'en'
      ? { resume: 'Resume', switch: 'Switch game', world: 'Back to world', help: 'Help', params: 'Parameters' }
      : { resume: '继续', switch: '换游戏', world: '回世界', help: '帮助', params: '参数' };
  return (
    <div className="game-pause-menu" data-testid="game-pause-menu">
      <button type="button" data-game-action="resume" onClick={onResume}>
        {text.resume}
      </button>
      <button type="button" data-game-action="switch" onClick={onSwitch}>
        {text.switch}
      </button>
      {onParams ? (
        <button type="button" data-game-action="params" onClick={onParams}>
          {text.params}
        </button>
      ) : null}
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
