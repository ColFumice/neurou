import { useRef, useState } from 'react';
import type { WorldIR } from '@neurou/core';
import { Scene } from './Scene.js';
import { Network } from './Network.js';
import { Term } from './Term.js';
import type { DisplayCue, ViewSnapshot } from './types.js';
import type { Tuning } from './tuning.js';
import type { TermId } from './terms.js';

interface TuningDeskProps {
  world: WorldIR;
  snap: ViewSnapshot;
  tuning: Tuning;
  visuals: Record<string, number>;
  paused: boolean;
  focused: string | null;
  cues: DisplayCue[];
  pulse: { strings: string[]; index: number } | null;
  pulseEntity: string | null;
  onFocus: (entity: string) => void;
  onTuning: (tuning: Tuning) => void;
  onTogglePause: () => void;
  onPublish: () => void;
  onExpandPreview: () => void;
  onHoverString: (id: string | null, rect: DOMRect | null) => void;
  onAdjustString: (id: string, value: number) => void;
  onPluckLoop: (loopId: string) => void;
  onForcing: (forcingId: string, rect: DOMRect | null) => void;
  onOpenTerm: (id: TermId, rect: DOMRect | null) => void;
}

/**
 * 调律台：neurou 的默认界面。
 *
 * 主区是弦网络；右下角是现象残影；底部是一排极淡的工具；左侧是实体。
 * 现象层不再是主画面——它只是一扇预览窗。
 */
export function TuningDesk({
  world,
  snap,
  tuning,
  visuals,
  paused,
  focused,
  cues,
  pulse,
  pulseEntity,
  onFocus,
  onTuning,
  onTogglePause,
  onPublish,
  onExpandPreview,
  onHoverString,
  onAdjustString,
  onPluckLoop,
  onForcing,
  onOpenTerm,
}: TuningDeskProps) {
  const [thumb, setThumb] = useState<'pressure' | 'cruelty' | null>(null);
  const thumbTimer = useRef<number | null>(null);
  const dragging = useRef(false);
  const latestCue = cues[cues.length - 1];

  const showThumb = (id: 'pressure' | 'cruelty') => {
    if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
    setThumb(id);
  };
  const hideThumbAfter = (ms: number) => {
    if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
    thumbTimer.current = window.setTimeout(() => setThumb(null), ms);
  };

  const entities = world.entities.filter((e) => world.strings.some((s) => s.owner === e.id && !s.id.startsWith('调性.')));

  return (
    <div className="desk" data-testid="desk">
      <aside className="desk__entities">
        <div className="desk__side-label">实体</div>
        {entities.map((e) => (
          <button
            key={e.id}
            className={`entity-btn ${focused === e.id ? 'is-on' : ''}`}
            onClick={() => onFocus(e.id)}
            data-testid={`entity-${e.name}`}
          >
            {e.name}
          </button>
        ))}
      </aside>

      <main className="desk__main">
        <div className="desk__terms">
          <Term id="弦" onOpen={onOpenTerm} />
          <Term id="回路" onOpen={onOpenTerm} />
          <Term id="力迫" onOpen={onOpenTerm} />
        </div>
        <Network
          world={world}
          snap={snap}
          focused={focused}
          pulse={pulse}
          onHoverString={onHoverString}
          onAdjustString={onAdjustString}
          onPluckLoop={onPluckLoop}
          onForcing={onForcing}
          onOpenTerm={onOpenTerm}
        />
      </main>

      <aside className="desk__side">
        <div className="desk__preview" onClick={onExpandPreview} data-testid="preview" title="点击或按空格放大">
          <Scene world={world} snap={snap} tuning={tuning} visuals={visuals} pulseEntity={pulseEntity} />
          <div className="desk__preview-label">现象 · 空格</div>
          {latestCue && <div className="desk__preview-cue">{latestCue.text}</div>}
        </div>
      </aside>

      <footer className="desk__toolbar">
        <div className="desk__world">
          <span className="desk__world-name">{world.name}</span>
          <span className="desk__world-meta">{String(world.meta['调性'] ?? '')}</span>
        </div>

        <div className="desk__tuning">
          <Term id="调性" onOpen={onOpenTerm} />
          <label
            className={`slider ${thumb === 'pressure' ? 'is-thumb' : ''}`}
            onPointerEnter={() => showThumb('pressure')}
            onPointerLeave={() => {
              if (!dragging.current) setThumb(null);
            }}
          >
            <span className="slider__name">压力</span>
            <input
              type="range"
              min={0}
              max={100}
              value={tuning.pressure}
              aria-label="压力"
              data-testid="slider-pressure"
              onPointerDown={() => {
                dragging.current = true;
                showThumb('pressure');
              }}
              onPointerUp={() => {
                dragging.current = false;
                hideThumbAfter(1000);
              }}
              onChange={(e) => onTuning({ ...tuning, pressure: Number(e.target.value) })}
            />
          </label>
          <label
            className={`slider ${thumb === 'cruelty' ? 'is-thumb' : ''}`}
            onPointerEnter={() => showThumb('cruelty')}
            onPointerLeave={() => {
              if (!dragging.current) setThumb(null);
            }}
          >
            <span className="slider__name">残酷</span>
            <input
              type="range"
              min={0}
              max={100}
              value={tuning.cruelty}
              aria-label="残酷"
              data-testid="slider-cruelty"
              onPointerDown={() => {
                dragging.current = true;
                showThumb('cruelty');
              }}
              onPointerUp={() => {
                dragging.current = false;
                hideThumbAfter(1000);
              }}
              onChange={(e) => onTuning({ ...tuning, cruelty: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="desk__transport">
          <button className="desk-btn" onClick={onTogglePause} data-testid="toggle-pause" aria-label={paused ? '运行' : '暂停'}>
            {paused ? '▶' : '⏸'}
          </button>
          <button className="desk-btn" onClick={onPublish} data-testid="open-publish">
            发布
          </button>
          <Term id="和弦" onOpen={onOpenTerm} />
        </div>
      </footer>
    </div>
  );
}
