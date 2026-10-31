import { useEffect, useRef, useState } from 'react';

const COLS = 64;
const ROWS = 36;
const LEVELS = 9;
const MAX_NODES = 16;
const STORAGE_PREFIX = 'neurou.flow.nodes:';

type ParamKey = 'radius' | 'cutoff' | 'resonance' | 'lfoRate' | 'lfoDepth' | 'attack' | 'release' | 'bits';

interface FlowNode {
  id: string;
  x: number;
  y: number;
  radius: number;
  tension: number;
  cutoff: number;
  resonance: number;
  lfoRate: number;
  lfoDepth: number;
  attack: number;
  release: number;
  bits: number;
}

interface ParamSpec {
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (node: FlowNode) => string;
}

const PARAMS: ParamSpec[] = [
  { key: 'radius', label: '声场半径', min: 2, max: 16, step: 0.5, format: (n) => n.radius.toFixed(1) },
  { key: 'cutoff', label: '滤波截止', min: 200, max: 12000, step: 300, format: (n) => `${Math.round(n.cutoff)}Hz` },
  { key: 'resonance', label: '滤波共振', min: 0.1, max: 12, step: 0.4, format: (n) => n.resonance.toFixed(1) },
  { key: 'attack', label: '包络攻击', min: 0.02, max: 1.2, step: 0.06, format: (n) => `${Math.round(n.attack * 1000)}ms` },
  { key: 'release', label: '包络释放', min: 0.04, max: 2.4, step: 0.08, format: (n) => `${Math.round(n.release * 1000)}ms` },
  { key: 'lfoRate', label: 'LFO 速率', min: 0.02, max: 1.2, step: 0.04, format: (n) => n.lfoRate.toFixed(2) },
  { key: 'lfoDepth', label: 'LFO 深度', min: 0, max: 8, step: 0.3, format: (n) => n.lfoDepth.toFixed(1) },
  { key: 'bits', label: 'LoFi 位深', min: 4, max: 16, step: 1, format: (n) => `${Math.round(n.bits)}bit` },
];

const DEFAULT_NODES: FlowNode[] = [
  { id: 'n1', x: 14, y: 10, radius: 6.4, tension: 0.45, cutoff: 3200, resonance: 2.4, lfoRate: 0.16, lfoDepth: 1.8, attack: 0.18, release: 0.8, bits: 12 },
  { id: 'n2', x: 32, y: 9, radius: 5.2, tension: 0.62, cutoff: 6200, resonance: 3.1, lfoRate: 0.11, lfoDepth: 1.2, attack: 0.32, release: 1.1, bits: 9 },
  { id: 'n3', x: 50, y: 12, radius: 7.1, tension: 0.38, cutoff: 1800, resonance: 1.8, lfoRate: 0.2, lfoDepth: 2.4, attack: 0.12, release: 0.6, bits: 14 },
  { id: 'n4', x: 18, y: 25, radius: 5.8, tension: 0.7, cutoff: 8600, resonance: 4.6, lfoRate: 0.09, lfoDepth: 1.5, attack: 0.42, release: 1.4, bits: 7 },
  { id: 'n5', x: 36, y: 26, radius: 6.6, tension: 0.52, cutoff: 4200, resonance: 2.8, lfoRate: 0.14, lfoDepth: 2.0, attack: 0.24, release: 0.9, bits: 11 },
  { id: 'n6', x: 54, y: 25, radius: 5.4, tension: 0.34, cutoff: 2400, resonance: 1.4, lfoRate: 0.18, lfoDepth: 1.3, attack: 0.08, release: 0.5, bits: 16 },
];

function makeNode(x: number, y: number, index: number): FlowNode {
  const base = DEFAULT_NODES[index % DEFAULT_NODES.length]!;
  return {
    ...base,
    id: `n${Date.now().toString(36)}${index}`,
    x: Math.max(1, Math.min(COLS - 2, x)),
    y: Math.max(1, Math.min(ROWS - 2, y)),
  };
}

function loadNodes(key: string): FlowNode[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return DEFAULT_NODES.map((node) => ({ ...node }));
    const parsed = JSON.parse(raw) as { nodes?: unknown };
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return DEFAULT_NODES.map((node) => ({ ...node }));
    return parsed.nodes.slice(0, MAX_NODES).map((node, index) => {
      const item = node as Partial<FlowNode>;
      return {
        ...makeNode(Number(item.x) || 10, Number(item.y) || 10, index),
        ...item,
        id: typeof item.id === 'string' ? item.id : `n${index}`,
        x: Number(item.x) || 10,
        y: Number(item.y) || 10,
        radius: Math.max(2, Math.min(16, Number(item.radius) || 5)),
      } as FlowNode;
    });
  } catch {
    return DEFAULT_NODES.map((node) => ({ ...node }));
  }
}

function saveNodes(key: string, nodes: FlowNode[]): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify({ nodes }));
  } catch {
    /* ignore */
  }
}

interface FlowFieldProps {
  worldFile: string;
  onClose: () => void;
}

interface FlowAudio {
  ctx: AudioContext;
  master: GainNode;
  voices: Map<string, { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode }>;
  muted: boolean;
}

/**
 * 流场统一模型：一个 FlowNode = 声场 + 滤波 + 包络 + LFO + LoFi。
 * 多个节点通过标量场融合成连续闭环。
 */
export function FlowField({ worldFile, onClose }: FlowFieldProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<FlowNode[]>(loadNodes(worldFile));
  const selectedRef = useRef(0);
  const paramRef = useRef(0);
  const dragRef = useRef<{ nodeId: string | null; pointerId: number | null }>({ nodeId: null, pointerId: null });
  const audioRef = useRef<FlowAudio | null>(null);
  const [selected, setSelected] = useState(0);
  const [param, setParam] = useState(0);
  const [version, setVersion] = useState(0);
  const [audioState, setAudioState] = useState('off');

  const commit = (): void => {
    saveNodes(worldFile, nodesRef.current);
    setVersion((value) => value + 1);
  };

  const startAudio = (): void => {
    if (audioRef.current) return;
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.045;
      master.connect(ctx.destination);
      audioRef.current = { ctx, master, voices: new Map(), muted: false };
      setAudioState('on');
      void ctx.resume();
    } catch {
      setAudioState('unavailable');
    }
  };

  const syncAudio = (): void => {
    const audio = audioRef.current;
    if (!audio) return;
    for (const node of nodesRef.current) {
      if (!audio.voices.has(node.id)) {
        const osc = audio.ctx.createOscillator();
        const filter = audio.ctx.createBiquadFilter();
        const gain = audio.ctx.createGain();
        const pan = audio.ctx.createStereoPanner();
        osc.type = 'sine';
        osc.frequency.value = 90 + (node.y / ROWS) * 380;
        gain.gain.value = 0.012;
        filter.type = 'lowpass';
        pan.pan.value = (node.x / COLS) * 2 - 1;
        osc.connect(filter).connect(gain).connect(pan).connect(audio.master);
        osc.start();
        audio.voices.set(node.id, { osc, filter, gain, pan });
      }
    }
  };

  const updateAudio = (now: number): void => {
    const audio = audioRef.current;
    if (!audio) return;
    for (const node of nodesRef.current) {
      const voice = audio.voices.get(node.id);
      if (!voice) continue;
      const phase = now * 0.001 * node.lfoRate + node.x * 0.13;
      voice.filter.frequency.value = node.cutoff;
      voice.filter.Q.value = node.resonance;
      voice.pan.pan.value = Math.max(-1, Math.min(1, (node.x / COLS) * 2 - 1 + Math.sin(phase) * 0.12));
      voice.gain.gain.value = audio.muted ? 0 : 0.008 + node.radius * 0.0015 + Math.sin(phase * 1.7) * 0.003;
    }
  };

  const moveSelected = (dx: number, dy: number): void => {
    const node = nodesRef.current[selectedRef.current];
    if (!node) return;
    node.x = Math.max(1, Math.min(COLS - 2, node.x + dx));
    node.y = Math.max(1, Math.min(ROWS - 2, node.y + dy));
    commit();
  };

  const adjustParam = (direction: 1 | -1): void => {
    const node = nodesRef.current[selectedRef.current];
    const spec = PARAMS[paramRef.current];
    if (!node || !spec) return;
    node[spec.key] = Math.max(spec.min, Math.min(spec.max, node[spec.key] + direction * spec.step));
    commit();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'F10' || event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.code === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectedRef.current = (selectedRef.current + 1) % Math.max(1, nodesRef.current.length);
        setSelected(selectedRef.current);
        return;
      }
      if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        event.preventDefault();
        paramRef.current = (paramRef.current + (event.code === 'BracketRight' ? 1 : -1) + PARAMS.length) % PARAMS.length;
        setParam(paramRef.current);
        return;
      }
      if (event.code === 'Minus' || event.code === 'Equal') {
        event.preventDefault();
        adjustParam(event.code === 'Equal' ? 1 : -1);
        return;
      }
      if (event.code === 'KeyM') {
        startAudio();
        if (audioRef.current) audioRef.current.muted = !audioRef.current.muted;
        setAudioState(audioRef.current?.muted ? 'muted' : 'on');
        return;
      }
      if (event.code === 'KeyR') {
        nodesRef.current = DEFAULT_NODES.map((node) => ({ ...node }));
        selectedRef.current = 0;
        setSelected(0);
        commit();
        return;
      }
      if (event.code === 'KeyS') {
        saveNodes(worldFile, nodesRef.current);
        return;
      }
      if (event.code === 'Enter') {
        if (nodesRef.current.length >= MAX_NODES) return;
        const node = makeNode(COLS / 2, ROWS / 2, nodesRef.current.length);
        nodesRef.current = [...nodesRef.current, node];
        selectedRef.current = nodesRef.current.length - 1;
        setSelected(selectedRef.current);
        commit();
        return;
      }
      const step = event.shiftKey ? 2 : 0.7;
      if (event.code === 'ArrowLeft') moveSelected(-step, 0);
      else if (event.code === 'ArrowRight') moveSelected(step, 0);
      else if (event.code === 'ArrowUp') moveSelected(0, -step);
      else if (event.code === 'ArrowDown') moveSelected(0, step);
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [worldFile, onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const resize = (): void => {
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    const fieldAt = (gx: number, gy: number, now: number): number => {
      const t = now * 0.001;
      let value = 0.015;
      for (const node of nodesRef.current) {
        const phase = t * node.lfoRate * Math.PI * 2 + node.x * 0.08;
        const cx = node.x + Math.sin(phase) * node.lfoDepth;
        const cy = node.y + Math.cos(phase * 0.77 + node.radius) * node.lfoDepth;
        const dx = (gx - cx) / node.radius;
        const dy = (gy - cy) / node.radius;
        const dist = dx * dx + dy * dy;
        if (dist > 6) continue;
        const attack = Math.max(0.05, node.attack);
        const env = Math.pow(0.5 + 0.5 * Math.sin(t * (0.4 + attack * 2) + node.y), Math.max(0.2, Math.min(2, node.release)));
        let contribution = Math.exp(-dist * (0.7 + node.tension * 1.1)) * (0.52 + env * 0.38);
        const ring = 0.85 + 0.15 * Math.sin(Math.sqrt(dist) * (node.cutoff / 1500) + node.resonance);
        contribution *= ring;
        if (node.bits < 11) {
          const steps = Math.pow(2, Math.max(1, Math.min(11, node.bits)));
          contribution = Math.round(contribution * steps) / steps;
        }
        value += contribution;
      }
      return Math.max(0, Math.min(1, value));
    };

    const draw = (now: number): void => {
      raf = window.requestAnimationFrame(draw);
      updateAudio(now);
      const width = canvas.width;
      const height = canvas.height;
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#04050b');
      bg.addColorStop(1, '#090513');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = width / dpr;
      const h = height / dpr;
      const cellW = w / COLS;
      const cellH = h / ROWS;
      const t = now * 0.001;
      const sample = (gx: number, gy: number): number =>
        fieldAt(
          gx + Math.sin(gy * 0.25 + t * 0.4) * 0.35,
          gy + Math.cos(gx * 0.22 - t * 0.32) * 0.3,
          now,
        );

      for (let level = 0; level < LEVELS; level += 1) {
        const value = 0.08 + (level / (LEVELS - 1)) * 0.84;
        const hue = 182 + level * 17;
        const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
        for (let gy = 0; gy < ROWS - 1; gy += 1) {
          for (let gx = 0; gx < COLS - 1; gx += 1) {
            const ax = sample(gx, gy);
            const bx = sample(gx + 1, gy);
            const cx = sample(gx + 1, gy + 1);
            const dx = sample(gx, gy + 1);
            const cross = (
              x1: number,
              y1: number,
              v1: number,
              x2: number,
              y2: number,
              v2: number,
            ): { x: number; y: number } | null => {
              if ((v1 > value) === (v2 > value)) return null;
              const ratio = (value - v1) / (v2 - v1 || 1);
              return { x: (x1 + (x2 - x1) * ratio) * cellW, y: (y1 + (y2 - y1) * ratio) * cellH };
            };
            const edges = {
              top: cross(gx, gy, ax, gx + 1, gy, bx),
              right: cross(gx + 1, gy, bx, gx + 1, gy + 1, cx),
              bottom: cross(gx + 1, gy + 1, cx, gx, gy + 1, dx),
              left: cross(gx, gy + 1, dx, gx, gy, ax),
            };
            const idx =
              (ax > value ? 1 : 0) | (bx > value ? 2 : 0) | (cx > value ? 4 : 0) | (dx > value ? 8 : 0);
            const add = (p: { x: number; y: number } | null, q: { x: number; y: number } | null): void => {
              if (p && q) segments.push([p, q]);
            };
            if (idx === 1 || idx === 14) add(edges.left, edges.top);
            else if (idx === 2 || idx === 13) add(edges.top, edges.right);
            else if (idx === 3 || idx === 12) add(edges.left, edges.right);
            else if (idx === 4 || idx === 11) add(edges.right, edges.bottom);
            else if (idx === 6 || idx === 9) add(edges.top, edges.bottom);
            else if (idx === 7 || idx === 8) add(edges.left, edges.bottom);
            else if (idx === 5) {
              add(edges.left, edges.top);
              add(edges.right, edges.bottom);
            } else if (idx === 10) {
              add(edges.top, edges.right);
              add(edges.bottom, edges.left);
            }
          }
        }

        const keyOf = (point: { x: number; y: number }): string =>
          `${Math.round(point.x * 2)},${Math.round(point.y * 2)}`;
        const byPoint = new Map<string, number[]>();
        segments.forEach((segment, index) => {
          for (const point of segment) {
            const key = keyOf(point);
            const list = byPoint.get(key);
            if (list) list.push(index);
            else byPoint.set(key, [index]);
          }
        });
        const used = new Uint8Array(segments.length);
        const other = (segment: [{ x: number; y: number }, { x: number; y: number }], point: string): { x: number; y: number } =>
          keyOf(segment[0]) === point ? segment[1] : segment[0];
        const extend = (points: Array<{ x: number; y: number }>, atStart: boolean): void => {
          for (let guard = 0; guard < segments.length; guard += 1) {
            const endpoint = atStart ? points[0]! : points[points.length - 1]!;
            const key = keyOf(endpoint);
            const found = (byPoint.get(key) ?? []).find((index) => !used[index]);
            if (found === undefined) return;
            used[found] = 1;
            const next = other(segments[found]!, key);
            if (atStart) points.unshift(next);
            else points.push(next);
            if (keyOf(next) === keyOf(atStart ? points[points.length - 1]! : points[0]!)) return;
          }
        };

        let pathIndex = 0;
        for (let index = 0; index < segments.length; index += 1) {
          if (used[index]) continue;
          used[index] = 1;
          const segment = segments[index]!;
          const points = [segment[0], segment[1]];
          extend(points, false);
          extend(points, true);
          if (points.length < 2) continue;
          let length = 0;
          for (let k = 1; k < points.length; k += 1) {
            length += Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.y - points[k - 1]!.y);
          }
          if (length < 18) continue;
          const width = 1.8 + 1.8 * (0.5 + 0.5 * Math.sin(t * 1.9 + level * 0.9 + pathIndex * 0.33));
          ctx.strokeStyle = `hsla(${hue}, 92%, ${62 + (level % 3) * 5}%, ${0.7 - level * 0.02})`;
          ctx.lineWidth = width;
          ctx.shadowBlur = 12;
          ctx.shadowColor = `hsla(${hue}, 95%, 68%, 0.52)`;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(points[0]!.x, points[0]!.y);
          for (let k = 1; k < points.length - 1; k += 1) {
            const current = points[k]!;
            const next = points[k + 1]!;
            ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
          }
          ctx.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
          ctx.stroke();
          pathIndex += 1;
        }
        ctx.shadowBlur = 0;
      }

      const selectedNode = nodesRef.current[selectedRef.current];
      if (selectedNode) {
        const nx = ((selectedNode.x + 0.5) / COLS) * w;
        const ny = ((selectedNode.y + 0.5) / ROWS) * h;
        const rr = (selectedNode.radius / COLS) * w;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(nx, ny, Math.max(8, rr), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255, 138, 60, 0.85)';
        ctx.beginPath();
        ctx.moveTo(nx - 6, ny);
        ctx.lineTo(nx + 6, ny);
        ctx.moveTo(nx, ny - 6);
        ctx.lineTo(nx, ny + 6);
        ctx.stroke();
      }
    };
    raf = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      const audio = audioRef.current;
      if (audio) {
        for (const voice of audio.voices.values()) {
          try {
            voice.osc.stop();
            voice.osc.disconnect();
            voice.filter.disconnect();
            voice.gain.disconnect();
            voice.pan.disconnect();
          } catch {
            /* ignore */
          }
        }
        void audio.ctx.close();
        audioRef.current = null;
      }
    };
  }, []);

  const pointerToCell = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * COLS,
      y: ((event.clientY - rect.top) / rect.height) * ROWS,
    };
  };

  const selectedNode = nodesRef.current[selected] ?? nodesRef.current[0];

  return (
    <div
      className="flow-screen"
      data-testid="flow-screen"
      data-flow-version={version}
      data-flow-nodes={nodesRef.current.length}
      data-flow-selected={selected}
      data-flow-param={param}
      data-flow-audio={audioState}
    >
      <canvas
        ref={canvasRef}
        className="flow-screen__canvas"
        data-testid="flow-canvas"
        data-flow-cells={COLS * ROWS}
        onPointerDown={(event) => {
          startAudio();
          syncAudio();
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointerToCell(event);
          const hit = nodesRef.current.findIndex(
            (node) => Math.hypot(node.x - point.x, node.y - point.y) <= Math.max(2, node.radius * 0.7),
          );
          if (hit >= 0) {
            selectedRef.current = hit;
            setSelected(hit);
            dragRef.current = { nodeId: nodesRef.current[hit]!.id, pointerId: event.pointerId };
            return;
          }
          if (nodesRef.current.length < MAX_NODES) {
            const node = makeNode(point.x, point.y, nodesRef.current.length);
            nodesRef.current = [...nodesRef.current, node];
            selectedRef.current = nodesRef.current.length - 1;
            setSelected(selectedRef.current);
            dragRef.current = { nodeId: node.id, pointerId: event.pointerId };
            commit();
            syncAudio();
          }
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0 || dragRef.current.pointerId !== event.pointerId) return;
          const point = pointerToCell(event);
          const node = nodesRef.current.find((item) => item.id === dragRef.current.nodeId);
          if (!node) return;
          node.x = Math.max(1, Math.min(COLS - 2, point.x));
          node.y = Math.max(1, Math.min(ROWS - 2, point.y));
          commit();
        }}
        onPointerUp={() => {
          dragRef.current = { nodeId: null, pointerId: null };
        }}
        onWheel={(event) => {
          const node = nodesRef.current[selectedRef.current];
          if (!node) return;
          event.preventDefault();
          node.radius = Math.max(2, Math.min(16, node.radius + (event.deltaY > 0 ? 0.5 : -0.5)));
          commit();
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="flow-screen__hud">
        <strong>流场统一节点 · 声场 / 滤波 / 包络 / LFO / LoFi</strong>
        <span>拖节点移动 · 滚轮半径 · Tab 切换 · [ ] 选参数 · - = 调整 · 方向键移动 · Enter 新节点 · M 静音 · F10/Esc 返回</span>
      </div>
      <div className="flow-screen__node-panel" data-testid="flow-node-panel">
        <div className="flow-screen__node-title">
          节点 {selected + 1}/{nodesRef.current.length} · {selectedNode ? `${selectedNode.x.toFixed(1)},${selectedNode.y.toFixed(1)}` : '—'}
        </div>
        {PARAMS.map((spec, index) => (
          <div
            key={spec.key}
            className={`flow-screen__param${index === param ? ' flow-screen__param--selected' : ''}`}
            data-flow-param-name={spec.key}
          >
            <span>{spec.label}</span>
            <em>{selectedNode ? spec.format(selectedNode) : '—'}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
