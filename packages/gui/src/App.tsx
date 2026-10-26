import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IRRule, WorldIR } from '@neurou/core';
import { Universe, type EmittedCue, type WorldState } from '@neurou/runtime';
import { WORLD_ORDER, WORLDS, type WorldKey } from './worlds.js';
import { DEFAULT_TUNING, tuneWorld, type Tuning } from './tuning.js';
import { registerExposure, type TermId } from './terms.js';
import { Scene } from './Scene.js';
import { Structure } from './Structure.js';
import { Play } from './Play.js';
import { Publish } from './Publish.js';
import { Hairlines } from './Hairlines.js';
import { Term, TermCardView, TermPopupView } from './Term.js';
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

type Mode = 'phenomenon' | 'structure' | 'play';

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
  const [mode, setMode] = useState<Mode>('phenomenon');
  const [tuning, setTuning] = useState<Tuning>(DEFAULT_TUNING);
  const [version, setVersion] = useState(0);
  const [cues, setCues] = useState<DisplayCue[]>([]);
  const [visuals, setVisuals] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<{ name: string; at: number } | null>(null);
  const [hover, setHover] = useState<{ entity: string; rect: DOMRect } | null>(null);
  const [loopHover, setLoopHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [activeLoop, setActiveLoop] = useState<string | null>(null);
  const [pulse, setPulse] = useState<{ strings: string[]; index: number } | null>(null);
  const [termPopup, setTermPopup] = useState<TermPopup | null>(null);
  const [termCard, setTermCard] = useState<TermCardState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [playSnapshot, setPlaySnapshot] = useState<WorldState | null>(null);
  const [remaining, setRemaining] = useState(PLAY_SECONDS);
  const [playOver, setPlayOver] = useState<string | null>(null);
  const [publish, setPublish] = useState<PublishState>({ open: false, status: 'idle' });
  const [immersive, setImmersive] = useState(false);
  const [topReveal, setTopReveal] = useState(false);
  const [worldFlash, setWorldFlash] = useState(false);
  const [thumbFor, setThumbFor] = useState<'pressure' | 'cruelty' | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pulseTimers = useRef<number[]>([]);
  const hoverEntity = useRef<string | null>(null);
  const forceTermShown = useRef(false);
  const termClose = useRef<number | null>(null);
  const loopClose = useRef<number | null>(null);
  const hairlineClose = useRef<number | null>(null);
  const immersiveRef = useRef(false);
  const revealTimer = useRef<number | null>(null);
  const worldFlashTimer = useRef<number | null>(null);
  const thumbTimer = useRef<number | null>(null);
  const sliderDragging = useRef(false);
  const seenForcings = useRef<Set<string>>(new Set());

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
    setFlash(null);
    setHover(null);
    setLoopHover(null);
    setPulse(null);
    setActiveLoop(null);
    setPlaySnapshot(null);
    setPlayOver(null);
    setPublish({ open: false, status: 'idle' });
    setMode('phenomenon');
    setImmersive(false);
    immersiveRef.current = false;
    setTopReveal(false);
    setThumbFor(null);
    seenForcings.current = new Set();
    forceTermShown.current = false;
    setVersion((v) => v + 1);
  }, [worldKey]);

  const snap: ViewSnapshot | null = useMemo(
    () => (runtime ? snapshotOf(runtime.universe) : null),
    [runtime, version],
  );

  // —— 术语浮现 ——
  const exposeTerm = useCallback((id: TermId, x: number, y: number) => {
    if (immersiveRef.current) return;
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
        // 留一点时间把鼠标移进卡片；卡片自己的 onMouseEnter 会取消这次关闭。
        termClose.current = window.setTimeout(() => {
          setTermCard((c) => (c && c.id === id ? null : c));
        }, 260);
      }
    },
    [cancelTermClose],
  );

  // —— 提示条与 cue 的生命周期 ——
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCues((prev) => prev.filter((c) => Date.now() - c.at < 6200));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(timer);
  }, [flash]);

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
    if (!runtime || mode === 'play') return;
    if (publish.open && publish.status === 'running') return;
    const timer = window.setInterval(() => {
      const u = runtime.universe;
      if (u.state.ended) return;
      const result = u.tick();
      ingest(result.cues);
      const authored = result.fired.filter((name) => !name.startsWith('调性.') && !seenForcings.current.has(name));
      if (authored.length > 0) {
        const name = authored[authored.length - 1]!;
        seenForcings.current.add(name);
        setFlash({ name, at: Date.now() });
        if (!forceTermShown.current) {
          forceTermShown.current = true;
          exposeTerm('力迫', window.innerWidth - 96, 132);
        }
      }
      setVersion((v) => v + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [runtime, mode, publish.open, publish.status, ingest, exposeTerm]);

  // —— Tab：现象 / 结构 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (mode === 'play' || publish.open || immersiveRef.current) return;
      e.preventDefault();
      setMode((m) => (m === 'structure' ? 'phenomenon' : 'structure'));
      setHover(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, publish.open]);

  // —— ← →：切换示例世界；右下角 1/2 只浮现 1.2 秒 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (mode === 'play' || publish.open || immersiveRef.current) return;
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      const i = WORLD_ORDER.indexOf(worldKey);
      const next = e.key === 'ArrowRight' ? (i + 1) % WORLD_ORDER.length : (i - 1 + WORLD_ORDER.length) % WORLD_ORDER.length;
      if (worldFlashTimer.current !== null) window.clearTimeout(worldFlashTimer.current);
      setWorldFlash(true);
      worldFlashTimer.current = window.setTimeout(() => setWorldFlash(false), 1200);
      setWorldKey(WORLD_ORDER[next]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [worldKey, mode, publish.open]);

  // —— 试玩计时 ——
  useEffect(() => {
    if (mode !== 'play') return;
    const timer = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    if (mode === 'play' && remaining <= 0) setPlayOver('时间到');
  }, [mode, remaining]);

  // —— 清理 ——
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      for (const t of pulseTimers.current) window.clearTimeout(t);
    };
  }, []);

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

  const cancelHairlineClose = useCallback(() => {
    if (hairlineClose.current !== null) {
      window.clearTimeout(hairlineClose.current);
      hairlineClose.current = null;
    }
  }, []);

  const handleCharacterHover = useCallback(
    (entity: string | null, rect: DOMRect | null) => {
      cancelHairlineClose();
      if (immersiveRef.current) {
        setHover(null);
        return;
      }
      if (entity && rect) {
        setHover({ entity, rect });
        if (hoverEntity.current !== entity) {
          hoverEntity.current = entity;
          exposeTerm('弦', rect.right + 12, rect.top);
        }
      } else {
        // 给鼠标一点时间移到细线面板上；面板自己的 onMouseEnter 会取消这次关闭。
        hairlineClose.current = window.setTimeout(() => setHover(null), 240);
        hoverEntity.current = null;
      }
    },
    [exposeTerm, cancelHairlineClose],
  );

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
    setActiveLoop(loopId);
    seq.forEach((_, i) => {
      pulseTimers.current.push(window.setTimeout(() => setPulse({ strings: seq, index: i }), i * 300));
    });
    pulseTimers.current.push(
      window.setTimeout(() => {
        setPulse(null);
        setActiveLoop(null);
      }, seq.length * 300 + 1100),
    );
    exposeTerm('回路', window.innerWidth / 2, 120);
  };

  const cancelLoopClose = useCallback(() => {
    if (loopClose.current !== null) {
      window.clearTimeout(loopClose.current);
      loopClose.current = null;
    }
  }, []);

  const handleLoopHover = useCallback(
    (id: string | null, rect: DOMRect | null) => {
      cancelLoopClose();
      if (id && rect) {
        setLoopHover({ id, rect });
        setHover(null);
      } else {
        loopClose.current = window.setTimeout(() => setLoopHover(null), 240);
      }
    },
    [cancelLoopClose],
  );

  const enterPlay = () => {
    if (!runtime) return;
    immersiveRef.current = false;
    setImmersive(false);
    setPlaySnapshot(runtime.universe.snapshot());
    setRemaining(PLAY_SECONDS);
    setPlayOver(null);
    setTermCard(null);
    setTermPopup(null);
    setHover(null);
    setMode('play');
  };

  const exitPlay = () => {
    if (runtime && playSnapshot) runtime.universe.restore(playSnapshot);
    setPlaySnapshot(null);
    setMode('phenomenon');
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
    // 发布的是作品本身：调性旋钮是这一次现场调音，不写回 .nro，也不进入模拟。
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

  // —— 隐形化：角落按钮、滑块头、沉浸模式 ——
  const revealTop = () => {
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    setTopReveal(true);
  };

  const scheduleHideTop = () => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => setTopReveal(false), 1500);
  };

  const showThumbFor = (id: 'pressure' | 'cruelty') => {
    if (thumbTimer.current !== null) {
      window.clearTimeout(thumbTimer.current);
      thumbTimer.current = null;
    }
    setThumbFor(id);
  };

  const hideThumbAfter = (ms: number) => {
    if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
    thumbTimer.current = window.setTimeout(() => setThumbFor(null), ms);
  };

  const toggleImmersive = () => {
    const next = !immersiveRef.current;
    immersiveRef.current = next;
    setImmersive(next);
    if (next) {
      setTopReveal(false);
      setThumbFor(null);
      setTermPopup(null);
      setTermCard(null);
      setHover(null);
      setLoopHover(null);
      setFlash(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        if (mode !== 'phenomenon' || publish.open) return;
        e.preventDefault();
        toggleImmersive();
        return;
      }
      if (mode === 'play' || publish.open || immersiveRef.current) return;
      if (key === 'p') {
        e.preventDefault();
        enterPlay();
      } else if (key === 'r') {
        e.preventDefault();
        openPublish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, publish.open, runtime, tuning, worldKey]);

  const hasChord = (rule: IRRule) => rule.effects.some((e) => e.k === 'apply');

  if (!snap) return <div className="fatal">正在装载世界…</div>;

  const hoverStrings = hover ? world.ir.strings.filter((s) => s.owner === hover.entity && !s.id.startsWith('调性.')) : [];
  const loopInfo = loopHover ? runtime?.ir.loops.find((l) => l.id === loopHover.id) : undefined;

  return (
    <div
      className={`studio ${immersive ? 'is-immersive' : ''}`}
      data-testid="studio"
      data-mode={mode}
      data-immersive={immersive}
    >
      {mode === 'phenomenon' && (
        <div className="layer layer--phenomenon">
          <Scene
            world={runtime?.ir ?? world.ir}
            snap={snap}
            tuning={tuning}
            visuals={visuals}
            onCharacterHover={(entity, rect) => handleCharacterHover(entity, rect)}
          />
        </div>
      )}

      {mode === 'structure' && runtime && (
        <Structure
          world={runtime.ir}
          snap={snap}
          tuning={tuning}
          visuals={visuals}
          activeLoop={activeLoop}
          pulse={pulse}
          onHoverLoop={handleLoopHover}
          onPluck={pluckLoop}
        />
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

      {mode !== 'play' && (
        <header className="hud hud--top">
          <div
            className="reveal-zone"
            data-testid="reveal-zone"
            onMouseEnter={revealTop}
            onMouseLeave={scheduleHideTop}
          />
          <div className="hud__left">
            <span className="brand" data-ui="brand">
              neurou
            </span>
          </div>

          <div className={`hud__right ${topReveal ? 'is-revealed' : ''}`}>
            <button
              className="icon-btn"
              data-ui="play-btn"
              onClick={enterPlay}
              onMouseEnter={revealTop}
              data-testid="enter-play"
              aria-label="试玩"
              title="试玩（P）"
            >
              ▶
            </button>
            <button
              className="icon-btn"
              data-ui="publish-btn"
              onClick={openPublish}
              onMouseEnter={revealTop}
              data-testid="open-publish"
              aria-label="发布"
              title="发布（R）"
            >
              ↑
            </button>
          </div>
        </header>
      )}

      {mode === 'phenomenon' && (
        <footer className="hud hud--bottom">
          <div className="mixer" data-ui="tuner">
            <label
              className={`slider ${thumbFor === 'pressure' ? 'is-thumb' : ''}`}
              data-testid="slider-block-pressure"
              onPointerEnter={() => showThumbFor('pressure')}
              onPointerLeave={() => {
                if (sliderDragging.current) return;
                if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
                setThumbFor(null);
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
                onPointerDown={(e) => {
                  sliderDragging.current = true;
                  showThumbFor('pressure');
                  setDragging(true);
                  exposeTerm('调性', e.clientX + 12, e.clientY - 30);
                }}
                onPointerUp={() => {
                  sliderDragging.current = false;
                  setDragging(false);
                  hideThumbAfter(1000);
                }}
                onPointerCancel={() => {
                  sliderDragging.current = false;
                  setDragging(false);
                  hideThumbAfter(1000);
                }}
                onChange={(e) => changeTuning({ ...tuning, pressure: Number(e.target.value) })}
              />
            </label>
            <label
              className={`slider ${thumbFor === 'cruelty' ? 'is-thumb' : ''}`}
              data-testid="slider-block-cruelty"
              onPointerEnter={() => showThumbFor('cruelty')}
              onPointerLeave={() => {
                if (sliderDragging.current) return;
                if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
                setThumbFor(null);
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
                onPointerDown={(e) => {
                  sliderDragging.current = true;
                  showThumbFor('cruelty');
                  setDragging(true);
                  exposeTerm('调性', e.clientX + 12, e.clientY - 30);
                }}
                onPointerUp={() => {
                  sliderDragging.current = false;
                  setDragging(false);
                  hideThumbAfter(1000);
                }}
                onPointerCancel={() => {
                  sliderDragging.current = false;
                  setDragging(false);
                  hideThumbAfter(1000);
                }}
                onChange={(e) => changeTuning({ ...tuning, cruelty: Number(e.target.value) })}
              />
            </label>
          </div>
        </footer>
      )}

      {mode !== 'play' && worldFlash && (
        <div className="world-index" data-ui="world-index" data-testid="world-index">
          {WORLD_ORDER.indexOf(worldKey) + 1} / {WORLD_ORDER.length}
        </div>
      )}

      {mode === 'phenomenon' && (
        <div className="cues" data-testid="cues">
          {cues.slice(-2).map((c) => (
            <div key={c.id} className={`cue cue--${c.kind}`}>
              {c.text}
            </div>
          ))}
        </div>
      )}

      {hover && (
        <Hairlines
          entity={hover.entity}
          strings={hoverStrings}
          snap={snap}
          rect={hover.rect}
          onOpenTerm={openTerm}
          onEnter={cancelHairlineClose}
          onLeave={() => setHover(null)}
        />
      )}

      {loopHover && loopInfo && (
        <div
          className="loop-tip"
          data-testid="loop-tip"
          onMouseEnter={cancelLoopClose}
          onMouseLeave={() => setLoopHover(null)}
          style={{
            left: Math.min(window.innerWidth - 250, loopHover.rect.right + 12),
            top: Math.max(70, loopHover.rect.top - 104),
          }}
        >
          <div className="loop-tip__head">
            <Term id="回路" onOpen={openTerm} />
            <span>· {loopInfo.name}</span>
          </div>
          <div className="loop-tip__kind">{loopInfo.polarity === 1 ? '自我强化' : '自我校正'}</div>
          <div className="muted">按住拨一下，看连锁</div>
        </div>
      )}

      {flash && mode !== 'play' && (
        <div className="ticker" data-testid="forcing-ticker">
          <Term id="力迫" onOpen={openTerm} />
          <span>· {flash.name.replace(/^调性\./, '调性 · ')}</span>
        </div>
      )}

      <div className={`tab-hint ${dragging ? 'is-on' : ''}`} aria-hidden="true">
        Tab
      </div>

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

      {!world.ok && (
        <div className="fatal">
          <div>{world.title} 编译不过去</div>
          {world.diagnostics.slice(0, 3).map((d, i) => (
            <div key={i} className="muted">
              {d.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
