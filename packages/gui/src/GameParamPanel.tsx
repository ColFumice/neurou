interface GameParamPanelProps {
  language: 'zh' | 'en';
  difficulty: number;
  waves: number;
  onDifficulty: (value: number) => void;
  onWaves: (value: number) => void;
  onApply: () => void;
  onCancel: () => void;
}

/** v1.55：游戏内参数编辑（难度 / 波次）。 */
export function GameParamPanel({
  language,
  difficulty,
  waves,
  onDifficulty,
  onWaves,
  onApply,
  onCancel,
}: GameParamPanelProps): JSX.Element {
  const text =
    language === 'en'
      ? { title: 'Game parameters', difficulty: 'Difficulty', waves: 'Waves', apply: 'Apply & restart', cancel: 'Cancel' }
      : { title: '游戏参数', difficulty: '难度', waves: '波次', apply: '应用并重开', cancel: '取消' };
  return (
    <div className="game-params" data-testid="game-params">
      <div className="game-params__title">{text.title}</div>
      <label className="game-params__row">
        <span>{text.difficulty}</span>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={difficulty}
          data-param-difficulty
          onChange={(event) => onDifficulty(Number(event.target.value))}
        />
        <strong>{difficulty}</strong>
      </label>
      <label className="game-params__row">
        <span>{text.waves}</span>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={waves}
          data-param-waves
          onChange={(event) => onWaves(Number(event.target.value))}
        />
        <strong>{waves}</strong>
      </label>
      <div className="game-params__actions">
        <button type="button" data-param-apply onClick={onApply}>
          {text.apply}
        </button>
        <button type="button" data-param-cancel onClick={onCancel}>
          {text.cancel}
        </button>
      </div>
    </div>
  );
}
