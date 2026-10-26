import type { WorldIR } from '@neurou/core';
import { Network } from './Network.js';
import { Term } from './Term.js';
import type { ViewSnapshot } from './types.js';
import type { Tuning } from './tuning.js';
import type { TermId } from './terms.js';

interface TuningDeskProps {
  world: WorldIR;
  snap: ViewSnapshot;
  tuning: Tuning;
  paused: boolean;
  focused: string | null;
  pulse: { strings: string[]; index: number } | null;
  onTuning: (tuning: Tuning) => void;
  onTogglePause: () => void;
  onPublish: () => void;
  onFocus: (entity: string) => void;
  onHoverString: (id: string | null, rect: DOMRect | null) => void;
  onAdjustString: (id: string, value: number) => void;
  onPluckLoop: (loopId: string) => void;
  onForcing: (forcingId: string, rect: DOMRect | null) => void;
  onOpenTerm: (id: TermId, rect: DOMRect | null) => void;
}

/**
 * 调律台：白纸、黑线、全屏。
 *
 * 没有侧栏、没有底部暗条、没有画中画。
 * 屏幕上只有弦网络本身，以及右下角几行极淡的字。
 */
export function TuningDesk({
  world,
  snap,
  tuning,
  paused,
  focused,
  pulse,
  onTuning,
  onTogglePause,
  onPublish,
  onFocus,
  onHoverString,
  onAdjustString,
  onPluckLoop,
  onForcing,
  onOpenTerm,
}: TuningDeskProps) {
  return (
    <div className="desk" data-testid="desk">
      <Network
        world={world}
        snap={snap}
        focused={focused}
        pulse={pulse}
        onHoverString={onHoverString}
        onAdjustString={onAdjustString}
        onPluckLoop={onPluckLoop}
        onForcing={onForcing}
        onFocusEntity={onFocus}
        onOpenTerm={onOpenTerm}
      />

      <div className="desk__terms">
        <Term id="弦" onOpen={onOpenTerm} />
        <Term id="回路" onOpen={onOpenTerm} />
        <Term id="力迫" onOpen={onOpenTerm} />
      </div>

      <div className="desk__keys">空格 现象 · Tab 结构 · F 力迫</div>

      <div className="desk__floating" data-testid="desk-controls">
        <div className="desk__floating-row">
          <Term id="调性" onOpen={onOpenTerm} />
        </div>
        <label className="slider">
          <span className="slider__name">压力</span>
          <input
            type="range"
            min={0}
            max={100}
            value={tuning.pressure}
            aria-label="压力"
            data-testid="slider-pressure"
            onChange={(e) => onTuning({ ...tuning, pressure: Number(e.target.value) })}
          />
        </label>
        <label className="slider">
          <span className="slider__name">残酷</span>
          <input
            type="range"
            min={0}
            max={100}
            value={tuning.cruelty}
            aria-label="残酷"
            data-testid="slider-cruelty"
            onChange={(e) => onTuning({ ...tuning, cruelty: Number(e.target.value) })}
          />
        </label>
        <div className="desk__floating-row">
          <button className="desk-text" onClick={onTogglePause} data-testid="toggle-pause">
            {paused ? '运行' : '暂停'}
          </button>
          <span className="desk__dot">·</span>
          <button className="desk-text" onClick={onPublish} data-testid="open-publish">
            发布
          </button>
          <span className="desk__dot">·</span>
          <Term id="和弦" onOpen={onOpenTerm} />
        </div>
      </div>
    </div>
  );
}
