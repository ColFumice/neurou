import { useEffect, useState } from 'react';
import { GameHost, type HostInput, type HostOverlayText } from './GameHost.js';
import type { GameResult } from './gameSdk.js';
import type { GameThemeName } from './gameTheme.js';
import {
  externalCommandSemantics,
  loadExternalPlugin,
  type ExternalGamePlugin,
} from './externalGame.js';
import type { Language } from './i18n.js';

interface ExternalSceneProps {
  script: string;
  language: Language;
  theme?: GameThemeName;
  bindingLabel?: string;
  resume?: unknown;
  onSave?: (data: unknown | null) => void;
  onResult?: (result: GameResult) => void;
  onPickGame?: () => void;
  onExit: () => void;
}

/** v1.53：外部插件场景。只通过受限 API 与插件交互。 */
export function ExternalScene({
  script,
  language,
  theme,
  bindingLabel,
  resume,
  onSave,
  onResult,
  onPickGame,
  onExit,
}: ExternalSceneProps): JSX.Element {
  const [plugin, setPlugin] = useState<ExternalGamePlugin | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setPlugin(null);
    setError('');
    loadExternalPlugin(script)
      .then((loaded) => {
        if (alive) setPlugin(loaded);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      alive = false;
    };
  }, [script]);

  if (error) {
    return (
      <div className="tetris-scene" data-testid="external-scene" data-phase="error">
        <div className="tetris-scene__overlay">
          <div className="tetris-scene__overlay-kicker">PLUGIN ERROR</div>
          <div className="tetris-scene__overlay-title">插件加载失败</div>
          <div className="tetris-scene__overlay-hint">{error}</div>
        </div>
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="tetris-scene" data-testid="external-scene" data-phase="loading">
        <div className="tetris-scene__overlay">
          <div className="tetris-scene__overlay-kicker">PLUGIN</div>
          <div className="tetris-scene__overlay-title">加载插件…</div>
          <div className="tetris-scene__overlay-hint">{script}</div>
        </div>
      </div>
    );
  }

  const overlay: HostOverlayText = {
    title: plugin.title[language],
    subtitle: `${plugin.moduleName} · EXTERNAL`,
    start: language === 'en' ? 'Enter to start' : 'Enter 开始',
    hint: language === 'en' ? 'Press Enter' : '按 Enter 开始',
    paused: language === 'en' ? 'Paused' : '暂停',
    pausedHint: language === 'en' ? 'P / Enter resume' : 'P / Enter 继续',
    over: language === 'en' ? 'Game Over' : '结束',
    overHint: language === 'en' ? 'Enter restart · Esc back' : 'Enter 重开 · Esc 返回',
    keys: plugin.controls[language],
  };

  return (
    <GameHost
      module={plugin}
      language={language}
      theme={theme}
      testId="external-scene"
      debugKey="__neurouExternal"
      bestKey={`neurou.external.best:${plugin.id}`}
      overlay={overlay}
      bindingLabel={bindingLabel}
      resume={resume}
      onSave={onSave}
      onResult={onResult}
      onPickGame={onPickGame}
      onExit={onExit}
      commandFor={(code, repeat): HostInput<string> | null => {
        const command = plugin.commandFor(code, repeat);
        if (!command) return null;
        const semantics = externalCommandSemantics(command);
        if (semantics === 'input') return { type: 'input', input: command };
        return { type: semantics };
      }}
      draw={(ctx, state, viewport, phase, best, tokens) =>
        plugin.draw(ctx, state, viewport, phase, best, tokens)
      }
      debugSnapshot={(state) => state}
    />
  );
}
