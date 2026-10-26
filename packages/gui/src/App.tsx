import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IRRule, WorldIR } from '@neurou/core';
import { Universe, type EmittedCue, type WorldState } from '@neurou/runtime';
import { WORLD_ORDER, WORLDS, type WorldKey } from './worlds.js';
import { DEFAULT_TUNING, tuneWorld, type Tuning } from './tuning.js';
import { registerExposure, type TermId } from './terms.js';
import { Scene } from './Scene.js';
import { TuningDesk } from './TuningDesk.js';
import { Network } from './Network.js';
import { ForcingLayer } from './ForcingLayer.js';
import { Play } from './Play.js';
import { Publish } from './Publish.js';
import { Hairlines } from './Hairlines.js';
import { Term, TermCardView, TermPopupView } from './Term.js';
import { formatEffect, formatExpr } from './format.js';
import {
  snapshotOf,
  type DisplayCue,
  type PublishSummary,
  type TermCardState,
  type TermPopup,
  type ViewSnapshot,
} from './types.js';

interface Runtime {
  ir: WorldIR;
  universe: Universe;
}

type Mode = 'desk' | 'phenomenon' | 'structure' | 'forcing' | 'play';

interface PublishState {
  open: boolean;
  status: 'idle' | 'running' | 'done' | 'error';
  summary?: PublishSummary;
  error?: string;
}

const TICK_MS = 420;
const PLAY_SECONDS = 120;

export function App() {
  const [worldKey, setWorldKey] = useState<WorldKey>('rain');
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [mode, setMode] = useState<Mode>('desk');
  const [paused, setPaused] = useState(false);
  const [tuning, setTuning] = useState<Tuning>(DEFAULT_TUNING);
  const [focused, setFocused] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [cues, setCues] = useState<DisplayCue[]>([]);
  const [visuals, setVisuals] = useState<Record<string, number>>({});
  const [hover, setHover] = useState<{ entity: string; rect: DOMRect } | null>(null);
  const [hoverString, setHoverString] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [termPopup, setTermPopup] = useState<TermPopup | null>(null);
  const [termCard, setTermCard] = useState<TermCardState | null>(null);
  const [pulse, setPulse] = useState<{ strings: string[]; index: number } | null>(null);
  const [forcingPopup, setForcingPopup] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [playSnapshot, setPlaySnapshot] = useState<WorldState | null>(null);
  const [remaining, setRemaining] = useState(PLAY_SECONDS);
  const [playOver, setPlayOver] = useState<string | null>(null);
  const [publish, setPublish] = useState<PublishState>({ open: false, status: 'idle' });

  const workerRef = useRef<Worker | null>(null);
  const pulseTimers = useRef<number[]>([]);
  const hoverEntity = useRef<string | null>(null);
  const termClose = useRef<number | null>(null);
  const hairlineClose = useRef<number | null>(null);
  const playReturn = useRef<Mode>('desk');

  const world = WORLDS[worldKey];

  // —— 世界装载 ——
  useEffect(() => {
    const base = WORLDS[worldKey].ir;
    const ir = tuneWorld(base, worldKey, DEFAULT_TUNING);
    const universe = new Universe(ir, { seed: 7, log: false });
    setRuntime({ ir, universe });
    setTuning(DEFAULT_TUNING);
    setCues([]);
    setVisuals({});
    setHover(null);
    setHoverString(null);
    setFocused(null);
    setPulse(null);
    setPaused(false);
    setPlaySnapshot(null);
    setPlayOver(null);
    setPublish({ open: false, status: 'idle' });
    setMode('desk');
    setVersion((v) => v + 1);
  }, [worldKey]);

  const snap: ViewSnapshot | null = useMemo(
    () => (runtime ? snapshotOf(runtime.universe) : null),
    [runtime, version],
  );

  useEffect(() => {
    setHoverString(null);
    setForcingPopup(null);
  }, [mode]);

  // —— 术语浮现 ——
  const exposeTerm = useCallback((id: TermId, x: number, y: number) => {
    if (!registerExposure(id)) return;
    setTermPopup({ id, x, y, nonce: Date.now() });
  }, []);

  useEffect(() => {
    if (!termPopup) return;
    const timer = window.setTimeout(() => setTermPopup(null), 1200);
    return () => window.clearTimeout(timer);
  }, [termPopup]);

  const cancelTermClose = useCallback(() => {
    if (termClose.current !== null) {
      window.clearTimeout(termClose.current);
      termClose.current = null;
    }
  }, []);

  const openTerm = useCallback(
    (id: TermId, rect: DOMRect | null) => {
      cancelTermClose();
      if (rect) {
        const left = rect.right + 312 > window.innerWidth ? Math.max(16, rect.left - 312) : rect.right + 12;
        setTermCard({ id, left, top: rect.top - 6 });
      } else {
        termClose.current = window.setTimeout(() => {
          setTermCard((c) => (c && c.id === id ? null : c));
        }, 260);
      }
    },
    [cancelTermClose],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCues((prev) => prev.filter((c) => Date.now() - c.at < 6200));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // —— 世界自己走 ——
  const ingest = useCallback((items: EmittedCue[]) => {
    if (items.length === 0) return;
    const visualUpdates: Record<string, number> = {};
    const display: DisplayCue[] = [];
    for (const it of items) {
      const cue = it.cue;
      if (cue.k === '视觉') {
        if (cue.param !== undefined) visualUpdates[cue.param] = cue.value ?? 0;
        continue;
      }
      let text = '';
      if (cue.k === '台词') text = `${cue.speaker ? `${cue.speaker}：` : ''}「${cue.text ?? ''}」`;
      else if (cue.k === '音频') text = `♪ ${cue.param ?? ''}`;
      else if (cue.k === '触觉') text = `◦ ${cue.text ?? ''}`;
      else text = cue.text ?? '';
      if (text) {
        display.push({
          id: `${it.tick}-${it.signal}-${Math.random().toString(36).slice(2, 7)}`,
          at: Date.now(),
          kind: cue.k,
          text,
          signal: it.signal,
          param: cue.param,
          value: cue.value,
        });
      }
    }
    if (Object.keys(visualUpdates).length > 0) setVisuals((v) => ({ ...v, ...visualUpdates }));
    if (display.length > 0) setCues((prev) => [...prev, ...display].slice(-4));
  }, []);

  useEffect(() => {
    if (!runtime || mode === 'play' || paused) return;
    if (publish.open && publish.status === 'running') return;
    const timer = window.setInterval(() => {
      const u = runtime.universe;
      if (u.state.ended) return;
      const result = u.tick();
      ingest(result.cues);
      setVersion((v) => v + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [runtime, mode, paused, publish.open, publish.status, ingest]);

  // —— 试玩计时 ——
  useEffect(() => {
    if (mode !== 'play') return;
    const timer = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    if (mode === 'play' && remaining <= 0) setPlayOver('时间到');
  }, [mode, remaining]);

  // —— 操作 ——
  const changeTuning = (next: Tuning) => {
    setTuning(next);
    const u = runtime?.universe;
    if (u) {
      u.state.values['调性.压力'] = next.pressure;
      u.state.values['调性.残酷'] = next.cruelty;
    }
    setVersion((v) => v + 1);
  };

  const handleCharacterHover = useCallback(
    (entity: string | null, rect: DOMRect | null) => {
      if (hairlineClose.current !== null) {
        window.clearTimeout(hairlineClose.current);
        hairlineClose.current = null;
      }
      if (entity && rect) {
        setHover({ entity, rect });
        if (hoverEntity.current !== entity) {
          hoverEntity.current = entity;
          exposeTerm('弦', rect.right + 12, rect.top);
        }
      } else {
        hairlineClose.current = window.setTimeout(() => setHover(null), 240);
        hoverEntity.current = null;
      }
    },
    [exposeTerm],
  );

  const adjustString = (id: string, value: number) => {
    const u = runtime?.universe;
    if (!u) return;
    const s = u.ir.strings.find((x) => x.id === id);
    if (!s || s.domain.type !== 'number') return;
    const min = s.domain.min ?? -Infinity;
    const max = s.domain.max ?? Infinity;
    u.state.values[id] = Math.min(max, Math.max(min, value));
    setVersion((v) => v + 1);
  };

  const pluckLoop = (loopId: string) => {
    if (!runtime) return;
    const loop = runtime.ir.loops.find((l) => l.id === loopId);
    if (!loop) return;
    const edges = loop.edges
      .map((id) => runtime.ir.couplings.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const start = edges[0]?.from;
    if (!start) return;
    const byFrom = new Map(edges.map((e) => [e.from, e]));
    const seq: string[] = [];
    let cur = start;
    for (let i = 0; i < edges.length; i++) {
      seq.push(cur);
      cur = byFrom.get(cur)?.to ?? start;
    }
    for (const t of pulseTimers.current) window.clearTimeout(t);
    pulseTimers.current = [];
    seq.forEach((_, i) => {
      pulseTimers.current.push(window.setTimeout(() => setPulse({ strings: seq, index: i }), i * 300));
    });
    pulseTimers.current.push(window.setTimeout(() => setPulse(null), seq.length * 300 + 900));
  };

  const enterPlay = () => {
    if (!runtime) return;
    playReturn.current = mode === 'play' ? 'desk' : mode;
    setPlaySnapshot(runtime.universe.snapshot());
    setRemaining(PLAY_SECONDS);
    setPlayOver(null);
    setTermCard(null);
    setTermPopup(null);
    setHover(null);
    setHoverString(null);
    setMode('play');
  };

  const exitPlay = () => {
    if (runtime && playSnapshot) runtime.universe.restore(playSnapshot);
    setPlaySnapshot(null);
    setMode(playReturn.current);
    setVersion((v) => v + 1);
  };

  const playAction = (rule: IRRule) => {
    if (!runtime) return;
    runtime.universe.act(rule.id);
    const result = runtime.universe.tick();
    ingest(result.cues);
    setVersion((v) => v + 1);
  };

  const waitOne = () => {
    if (!runtime) return;
    const result = runtime.universe.tick();
    ingest(result.cues);
    setVersion((v) => v + 1);
  };

  const startWorker = () => {
    if (!runtime) return;
    workerRef.current?.terminate();
    const ir = WORLDS[worldKey].ir;
    const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PublishSummary | { error: string }>) => {
      const data = e.data;
      if ('error' in data) setPublish((p) => ({ ...p, status: 'error', error: data.error }));
      else setPublish((p) => ({ ...p, status: 'done', summary: data }));
      worker.terminate();
    };
    worker.onerror = () => {
      setPublish((p) => ({ ...p, status: 'error', error: '模拟进程没有启动' }));
      worker.terminate();
    };
    worker.postMessage({ ir, world: WORLDS[worldKey].title, runs: 600, maxTicks: 120, seed: 7 });
    workerRef.current = worker;
  };

  const openPublish = () => {
    setPublish({ open: true, status: 'running' });
    startWorker();
  };

  // —— 快捷键：默认调律台 / 空格现象 / Tab 结构 / F 力迫 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLInputElement) {
        // 滑块里按左右键是调值；其他键仍然交给全局视图切换。
        if (target.type === 'range' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        if (target.type !== 'range') return;
      }
      if (e.key === 'Escape') {
        if (publish.open) {
          setPublish((p) => ({ ...p, open: false }));
          return;
        }
        if (mode === 'play') {
          exitPlay();
          return;
        }
        setMode('desk');
        setForcingPopup(null);
        return;
      }
      if (publish.open) return;

      if (e.key === ' ') {
        if (mode === 'play') return;
        e.preventDefault();
        setMode((m) => (m === 'phenomenon' ? 'desk' : 'phenomenon'));
        return;
      }
      if (e.key === 'Tab') {
        if (mode === 'play') return;
        e.preventDefault();
        setMode((m) => (m === 'structure' ? 'desk' : 'structure'));
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        if (mode === 'play') return;
        e.preventDefault();
        setMode((m) => (m === 'forcing' ? 'desk' : 'forcing'));
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        if (mode === 'play') return;
        e.preventDefault();
        enterPlay();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        if (mode === 'play') return;
        e.preventDefault();
        openPublish();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (mode === 'play') return;
        e.preventDefault();
        const i = WORLD_ORDER.indexOf(worldKey);
        const next = e.key === 'ArrowRight' ? (i + 1) % WORLD_ORDER.length : (i - 1 + WORLD_ORDER.length) % WORLD_ORDER.length;
        setWorldKey(WORLD_ORDER[next]!);
        setMode('desk');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, publish.open, runtime, tuning, worldKey]);

  // —— 清理 ——
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      for (const t of pulseTimers.current) window.clearTimeout(t);
    };
  }, []);

  const hasChord = (rule: IRRule) => rule.effects.some((e) => e.k === 'apply');

  if (!snap) return <div className="fatal">正在装载世界…</div>;

  const hoverStrings = hover ? (runtime?.ir ?? world.ir).strings.filter((s) => s.owner === hover.entity && !s.id.startsWith('调性.')) : [];
  const pulseEntity = pulse ? (runtime?.ir ?? world.ir).strings.find((s) => s.id === pulse.strings[pulse.index])?.owner ?? null : null;
  const forcingRule = forcingPopup ? (runtime?.ir ?? world.ir).rules.find((r) => r.id === forcingPopup.id) : undefined;

  const networkProps = {
    world: runtime?.ir ?? world.ir,
    snap,
    focused,
    pulse,
    onHoverString: (id: string | null, rect: DOMRect | null) => {
      setHoverString(id && rect ? { id, rect } : null);
    },
    onAdjustString: adjustString,
    onPluckLoop: pluckLoop,
    onForcing: (id: string, rect: DOMRect | null) => {
      setForcingPopup(rect ? { id, rect } : null);
    },
    onFocusEntity: (entity: string) => {
      setFocused((cur) => (cur === entity ? null : entity));
    },
    onOpenTerm: openTerm,
  };

  return (
    <div className="studio" data-testid="studio" data-mode={mode}>
      {mode === 'desk' && (
        <TuningDesk
          world={runtime?.ir ?? world.ir}
          snap={snap}
          tuning={tuning}
          paused={paused}
          focused={focused}
          pulse={pulse}
          onFocus={(entity) => setFocused((cur) => (cur === entity ? null : entity))}
          onTuning={changeTuning}
          onTogglePause={() => setPaused((p) => !p)}
          onPublish={openPublish}
          onHoverString={networkProps.onHoverString}
          onAdjustString={adjustString}
          onPluckLoop={pluckLoop}
          onForcing={networkProps.onForcing}
          onOpenTerm={openTerm}
        />
      )}

      {mode === 'phenomenon' && (
        <div className="phenomenon" data-testid="phenomenon">
          <Scene
            world={runtime?.ir ?? world.ir}
            snap={snap}
            tuning={tuning}
            visuals={visuals}
            pulseEntity={pulseEntity}
            onCharacterHover={(entity, rect) => handleCharacterHover(entity, rect)}
          />
          <div className="phenomenon__hint">空格 / Esc 返回调律台 · P 试玩</div>
          <div className="cues">
            {cues.slice(-2).map((c) => (
              <div key={c.id} className={`cue cue--${c.kind}`}>
                {c.text}
              </div>
            ))}
          </div>
          {hover && (
            <Hairlines
              entity={hover.entity}
              strings={hoverStrings}
              snap={snap}
              rect={hover.rect}
              onOpenTerm={openTerm}
              onEnter={() => {
                if (hairlineClose.current !== null) window.clearTimeout(hairlineClose.current);
              }}
              onLeave={() => setHover(null)}
            />
          )}
        </div>
      )}

      {mode === 'structure' && (
        <div className="structure-full" data-testid="structure">
          <div className="structure-full__head">
            <span className="structure-full__title">{world.title}</span>
            <span className="structure-full__terms">
              <Term id="弦" onOpen={openTerm} />
              <Term id="回路" onOpen={openTerm} />
              <Term id="力迫" onOpen={openTerm} />
            </span>
            <span className="structure-full__hint">Tab 返回调律台 · F 力迫层</span>
          </div>
          <Network {...networkProps} full />
        </div>
      )}

      {mode === 'forcing' && (
        <div className="forcing-full">
          <ForcingLayer world={runtime?.ir ?? world.ir} onOpenTerm={openTerm} />
        </div>
      )}

      {mode === 'play' && runtime && (
        <Play
          world={runtime.ir}
          universe={runtime.universe}
          snap={snap}
          tuning={tuning}
          visuals={visuals}
          cues={cues}
          remaining={remaining}
          over={snap.ended ?? playOver}
          onAction={playAction}
          onWait={waitOne}
          onExit={exitPlay}
          onTermHover={(term, rect) => {
            if (rect) {
              exposeTerm(term, rect.right + 8, rect.top);
              openTerm(term, rect);
            } else {
              openTerm(term, null);
            }
          }}
          hasChord={hasChord}
        />
      )}

      {hoverString && (
        <StringTip
          world={runtime?.ir ?? world.ir}
          snap={snap}
          id={hoverString.id}
          rect={hoverString.rect}
          onOpenTerm={openTerm}
        />
      )}

      {forcingPopup && forcingRule && (
        <ForcingPopup
          world={runtime?.ir ?? world.ir}
          rule={forcingRule}
          rect={forcingPopup.rect}
          onClose={() => setForcingPopup(null)}
        />
      )}

      <TermPopupView popup={termPopup} />
      <TermCardView card={termCard} onEnter={cancelTermClose} onClose={() => setTermCard(null)} />

      {publish.open && (
        <Publish
          status={publish.status}
          summary={publish.summary}
          error={publish.error}
          onRun={startWorker}
          onClose={() => setPublish((p) => ({ ...p, open: false }))}
        />
      )}
    </div>
  );
}

// —— 弦的悬停读数：类型、当前值（用位置表示）、可拖动提示 ——
function StringTip({
  world,
  snap,
  id,
  rect,
  onOpenTerm,
}: {
  world: WorldIR;
  snap: ViewSnapshot;
  id: string;
  rect: DOMRect;
  onOpenTerm: (id: TermId, rect: DOMRect | null) => void;
}) {
  const s = world.strings.find((x) => x.id === id);
  if (!s) return null;
  const raw = snap.values[id];
  const numeric = s.domain.type === 'number' && typeof raw === 'number';
  const min = numeric && s.domain.type === 'number' ? (s.domain.min ?? 0) : 0;
  const max = numeric && s.domain.type === 'number' ? (s.domain.max ?? 100) : 100;
  const t = numeric ? Math.min(1, Math.max(0, (raw as number - min) / (max - min || 1))) : 0;
  const left = Math.min(window.innerWidth - 190, rect.right + 12);
  const top = Math.min(window.innerHeight - 150, Math.max(70, rect.top - 20));
  return (
    <div className="string-tip" style={{ left, top }} data-testid="string-tip" data-string-tip={id}>
      <div className="string-tip__head">
        <Term id="弦" onOpen={onOpenTerm} />
        <span>{s.kind}弦</span>
      </div>
      {numeric ? (
        <div className="string-tip__rail">
          <i style={{ bottom: `${t * 100}%` }} />
        </div>
      ) : (
        <div className="string-tip__text">这根弦不是数值</div>
      )}
      <div className="string-tip__hint">{numeric ? '按住拖动可调' : '不可拖动'}</div>
    </div>
  );
}

function ForcingPopup({
  world,
  rule,
  rect,
  onClose,
}: {
  world: WorldIR;
  rule: IRRule;
  rect: DOMRect;
  onClose: () => void;
}) {
  const left = Math.min(window.innerWidth - 340, Math.max(16, rect.right + 14));
  const top = Math.min(window.innerHeight - 260, Math.max(70, rect.top - 20));
  return (
    <>
      <div className="popup-veil" onClick={onClose} />
      <div className="forcing-pop" style={{ left, top }} data-testid="forcing-pop">
        <div className="forcing-pop__head">
          <span>力迫 · {rule.name}</span>
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="forcing-pop__label">当</div>
        <div className="forcing-pop__code">{rule.guard ? formatExpr(world, rule.guard) : '真'}</div>
        <div className="forcing-pop__label">效果</div>
        <div className="forcing-pop__code">
          {rule.effects.map((e, i) => (
            <div key={i}>{formatEffect(world, e)}</div>
          ))}
        </div>
        {rule.before.length > 0 && <div className="forcing-pop__order">先于：{rule.before.join('、')}</div>}
      </div>
    </>
  );
}
