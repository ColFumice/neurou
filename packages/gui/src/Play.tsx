import type { IRRule, WorldIR } from '@neurou/core';
import type { Universe } from '@neurou/runtime';
import { Scene } from './Scene.js';
import type { DisplayCue, ViewSnapshot } from './types.js';
import { stringLabel } from './types.js';
import type { Tuning } from './tuning.js';

interface PlayProps {
  world: WorldIR;
  universe: Universe;
  snap: ViewSnapshot;
  tuning: Tuning;
  visuals: Record<string, number>;
  cues: DisplayCue[];
  remaining: number;
  over: string | null;
  onAction: (rule: IRRule) => void;
  onWait: () => void;
  onExit: () => void;
  onTermHover: (term: '和弦' | '力迫', rect: DOMRect | null) => void;
  hasChord: (rule: IRRule) => boolean;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 试玩：把同一个宇宙暂停下来，让玩家逐拍介入。
 * 两分钟后自动收束，随时可以回到现象层——不改变世界本身。
 */
export function Play({
  world,
  universe,
  snap,
  tuning,
  visuals,
  cues,
  remaining,
  over,
  onAction,
  onWait,
  onExit,
  onTermHover,
  hasChord,
}: PlayProps) {
  const actions = universe.availableActions();
  const strings = world.strings.filter((s) => !s.id.startsWith('调性.') && s.domain.type === 'number');
  const finished = over !== null;

  return (
    <div className="layer layer--play" data-testid="play">
      <Scene world={world} snap={snap} tuning={tuning} visuals={visuals} />

      <div className="play__top">
        <div>
          <div className="play__kicker">试玩</div>
          <div className="play__title">{world.name}</div>
        </div>
        <div className="play__timer" data-testid="play-timer">
          {clock(remaining)}
        </div>
        <button className="ghost-btn" onClick={onExit} data-testid="play-exit">
          返回
        </button>
      </div>

      <div className="play__panel">
        <div className="play__panel-title">你可以做的</div>
        <div className="play__actions">
          {actions.length === 0 && !finished && <div className="muted">这一刻没有可做的事。</div>}
          {!finished &&
            actions.map((a, i) => (
              <button
                key={a.id}
                className="action-btn"
                onClick={() => onAction(a)}
                onMouseEnter={(e) => {
                  if (hasChord(a)) onTermHover('和弦', e.currentTarget.getBoundingClientRect());
                }}
                onMouseLeave={() => onTermHover('和弦', null)}
                data-testid={`action-${a.name}`}
              >
                <span className="action-btn__key">{i + 1}</span>
                <span className="action-btn__name">{a.name}</span>
                {a.note && <span className="action-btn__note">{a.note}</span>}
              </button>
            ))}
          {!finished && (
            <button className="action-btn action-btn--wait" onClick={onWait} data-testid="action-wait">
              <span className="action-btn__key">·</span>
              <span className="action-btn__name">等一拍</span>
              <span className="action-btn__note">让世界自己走一步</span>
            </button>
          )}
        </div>
      </div>

      <div className="play__strings">
        {strings.map((s) => {
          const v = snap.values[s.id];
          const n = typeof v === 'number' ? v : 0;
          const min = s.domain.type === 'number' ? (s.domain.min ?? 0) : 0;
          const max = s.domain.type === 'number' ? (s.domain.max ?? 100) : 100;
          const t = max > min ? (n - min) / (max - min) : 0;
          return (
            <div key={s.id} className="play__string">
              <span className="play__string-name">{stringLabel(world, s.id)}</span>
              <span className="play__string-track">
                <i style={{ transform: `scaleX(${Math.max(0.01, Math.min(1, t))})` }} />
                {s.verge !== undefined && <b className="tick tick--verge" style={{ left: `${((s.verge - min) / (max - min)) * 100}%` }} />}
                {s.safe !== undefined && <b className="tick tick--safe" style={{ left: `${((s.safe - min) / (max - min)) * 100}%` }} />}
              </span>
              <span className="play__string-value">{Math.round(n * 10) / 10}</span>
            </div>
          );
        })}
      </div>

      <div className="play__cues">
        {cues.slice(-2).map((c) => (
          <div key={c.id} className="cue">
            {c.text}
          </div>
        ))}
      </div>

      {finished && (
        <div className="play__ending" data-testid="play-ending">
          <div className="play__ending-kicker">结局</div>
          <div className="play__ending-name">{finished}</div>
          <button className="primary-btn" onClick={onExit}>
            返回现象层
          </button>
        </div>
      )}
    </div>
  );
}
