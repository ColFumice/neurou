import { useEffect, useRef, useState } from 'react';
import { STRING_INTERACTIONS, type StringKind } from '@neurou/core';
import { KIND_VISUAL, LOGICAL_H, LOGICAL_W, layoutKeyboard, valueToY, type TimbreCurve } from './stringMath.js';
import { sustainedWaves } from './sustainedWave.js';
import { getStringAudio } from './stringAudio.js';

const COLS = 64;
const ROWS = 36;
const LEVELS = 7;
const MAX_NODES = 16;
const STORAGE_PREFIX = 'neurou.flow.nodes:';

type ParamKey =
  | 'radius'
  | 'depth'
  | 'diffusion'
  | 'cutoff'
  | 'resonance'
  | 'attack'
  | 'decay'
  | 'sustain'
  | 'release'
  | 'lfoRate'
  | 'lfoDepth'
  | 'bits'
  | 'sampleRate'
  | 'layer';

interface FlowNode {
  id: string;
  x: number;
  y: number;
  radius: number;
  tension: number;
  depth: number;
  diffusion: number;
  cutoff: number;
  resonance: number;
  lfoRate: number;
  lfoDepth: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  bits: number;
  sampleRate: number;
  layer: number;
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
  { key: 'depth', label: '声场深度', min: 0, max: 1, step: 0.05, format: (n) => n.depth.toFixed(2) },
  { key: 'diffusion', label: '混响扩散', min: 0, max: 1, step: 0.05, format: (n) => n.diffusion.toFixed(2) },
  { key: 'cutoff', label: '滤波截止', min: 200, max: 12000, step: 300, format: (n) => `${Math.round(n.cutoff)}Hz` },
  { key: 'resonance', label: '滤波共振', min: 0.1, max: 12, step: 0.4, format: (n) => n.resonance.toFixed(1) },
  { key: 'attack', label: '包络攻击', min: 0.02, max: 1.2, step: 0.06, format: (n) => `${Math.round(n.attack * 1000)}ms` },
  { key: 'decay', label: '包络衰减', min: 0.02, max: 1.6, step: 0.06, format: (n) => `${Math.round(n.decay * 1000)}ms` },
  { key: 'sustain', label: '包络延持', min: 0, max: 1, step: 0.05, format: (n) => n.sustain.toFixed(2) },
  { key: 'release', label: '包络释放', min: 0.04, max: 2.4, step: 0.08, format: (n) => `${Math.round(n.release * 1000)}ms` },
  { key: 'lfoRate', label: 'LFO 速率', min: 0.02, max: 1.2, step: 0.04, format: (n) => n.lfoRate.toFixed(2) },
  { key: 'lfoDepth', label: 'LFO 深度', min: 0, max: 8, step: 0.3, format: (n) => n.lfoDepth.toFixed(1) },
  { key: 'bits', label: 'LoFi 位深', min: 4, max: 16, step: 1, format: (n) => `${Math.round(n.bits)}bit` },
  { key: 'sampleRate', label: 'LoFi 采样率', min: 4000, max: 44100, step: 2000, format: (n) => `${Math.round(n.sampleRate / 1000)}kHz` },
  { key: 'layer', label: '层级', min: 0, max: 2, step: 1, format: (n) => `L${Math.round(n.layer)}` },
];

const DEFAULT_NODES: FlowNode[] = [
  { id: 'n1', x: 14, y: 10, radius: 6.4, tension: 0.45, depth: 0.55, diffusion: 0.62, cutoff: 3200, resonance: 2.4, lfoRate: 0.16, lfoDepth: 1.8, attack: 0.18, decay: 0.4, sustain: 0.45, release: 0.8, bits: 12, sampleRate: 32000, layer: 0 },
  { id: 'n2', x: 32, y: 9, radius: 5.2, tension: 0.62, depth: 0.25, diffusion: 0.32, cutoff: 6200, resonance: 3.1, lfoRate: 0.11, lfoDepth: 1.2, attack: 0.32, decay: 0.55, sustain: 0.6, release: 1.1, bits: 9, sampleRate: 16000, layer: 0 },
  { id: 'n3', x: 50, y: 12, radius: 7.1, tension: 0.38, depth: 0.42, diffusion: 0.75, cutoff: 1800, resonance: 1.8, lfoRate: 0.2, lfoDepth: 2.4, attack: 0.12, decay: 0.3, sustain: 0.35, release: 0.6, bits: 14, sampleRate: 44100, layer: 0 },
  { id: 'n4', x: 18, y: 25, radius: 5.8, tension: 0.7, depth: 0.78, diffusion: 0.48, cutoff: 8600, resonance: 4.6, lfoRate: 0.09, lfoDepth: 1.5, attack: 0.42, decay: 0.7, sustain: 0.3, release: 1.4, bits: 7, sampleRate: 12000, layer: 1 },
  { id: 'n5', x: 36, y: 26, radius: 6.6, tension: 0.52, depth: 0.35, diffusion: 0.58, cutoff: 4200, resonance: 2.8, lfoRate: 0.14, lfoDepth: 2.0, attack: 0.24, decay: 0.45, sustain: 0.55, release: 0.9, bits: 11, sampleRate: 22050, layer: 1 },
  { id: 'n6', x: 54, y: 25, radius: 5.4, tension: 0.34, depth: 0.62, diffusion: 0.22, cutoff: 2400, resonance: 1.4, lfoRate: 0.18, lfoDepth: 1.3, attack: 0.08, decay: 0.18, sustain: 0.4, release: 0.5, bits: 16, sampleRate: 44100, layer: 1 },
].map((node) => ({ ...node, bits: 16, sampleRate: 44100, attack: 0.01, decay: 0.1, sustain: 1, release: 0.4 }));

const KEY_ORDER = '1234567890qwertyuiopasdfghjklzxcvbnm';

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
    const parsed = JSON.parse(raw) as { nodes?: unknown; version?: number };     if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return DEFAULT_NODES.map((node) => ({ ...node }));     const legacyAudio = parsed.version !== 2;
    return parsed.nodes.slice(0, MAX_NODES).map((node, index) => {
      const item = node as Partial<FlowNode>;
      return {
        ...makeNode(Number(item.x) || 10, Number(item.y) || 10, index),
        ...item,
        id: typeof item.id === 'string' ? item.id : `n${index}`,
        x: Number(item.x) || 10,
        y: Number(item.y) || 10,
        radius: Math.max(2, Math.min(16, Number(item.radius) || 5)),
        depth: Math.max(0, Math.min(1, Number(item.depth) || 0.5)),
        diffusion: Math.max(0, Math.min(1, Number(item.diffusion) || 0.4)),
        decay: Math.max(0.02, Math.min(1.6, Number(item.decay) || 0.4)),
        sustain: Math.max(0, Math.min(1, Number(item.sustain) || 0.45)),
        sampleRate: legacyAudio ? 44100 : Math.max(4000, Math.min(44100, Number(item.sampleRate) || 44100)),         ...(legacyAudio ? { bits: 16, attack: 0.01, decay: 0.1, sustain: 1, release: 0.4 } : {}),         layer: Math.max(0, Math.min(2, Math.round(Number(item.layer) || 0))),
      } as FlowNode;
    });
  } catch {
    return DEFAULT_NODES.map((node) => ({ ...node }));
  }
}

function saveNodes(key: string, nodes: FlowNode[]): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify({ version: 2, nodes }));
  } catch {
    /* ignore */
  }
}

interface FlowFieldProps {
  worldFile: string;
  targetKind?: StringKind;
  kinds?: readonly StringKind[];
  kindLabels?: Partial<Record<StringKind, string>>;
  targetStringId?: string;
  targetTimbre?: TimbreCurve;
  targetNorm?: number;
  onTargetKindChange?: (kind: StringKind) => void;
  onClose: () => void;
}

interface FlowAudio {
  ctx: AudioContext;
  master: GainNode;
  voices: Map<
    string,
    {
      osc: OscillatorNode;
      filter: BiquadFilterNode;
      down: ScriptProcessorNode;
      shaper: WaveShaperNode;
      gain: GainNode;
      pan: StereoPannerNode;
      dry: GainNode;
      send: GainNode;
      convolver: ConvolverNode;
      held: number;
      counter: number;
      lastBits: number;
      lastDiffusion: number;
    }
  >;
  muted: boolean;
}

function makeImpulse(ctx: AudioContext, diffusion: number): AudioBuffer {
  const seconds = 0.25 + diffusion * 1.9;
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.4 + diffusion * 2);
    }
  }
  return buffer;
}

function quantizeCurve(bits: number): Float32Array {
  const size = 1024;
  const curve = new Float32Array(size);
  const steps = Math.pow(2, Math.max(2, Math.min(16, Math.round(bits))));
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

/**
 * 流场统一模型：一个 FlowNode = 声场 + 滤波 + 包络 + LFO + LoFi。
 * 多个节点通过标量场融合成连续闭环。
 */
export function FlowField({ worldFile, targetKind, kinds, kindLabels, targetStringId, targetTimbre, targetNorm, onTargetKindChange, onClose }: FlowFieldProps): JSX.Element {
  const storageKey = targetKind ? `${worldFile}:${targetKind}` : worldFile;
  const keyFor = (kind?: StringKind): string => (kind ? `${worldFile}:${kind}` : worldFile);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<FlowNode[]>(loadNodes(storageKey));
  const ripplesRef = useRef<Array<{ x: number; y: number; start: number }>>([]);
  const selectedRef = useRef(0);
  const paramRef = useRef(0);
  const dragRef = useRef<{ nodeId: string | null; pointerId: number | null }>({ nodeId: null, pointerId: null });
  const audioRef = useRef<FlowAudio | null>(null);
  const gateRef = useRef(new Map<string, { triggeredAt: number; releasedAt: number; held: boolean; releaseLevel: number }>());
  const sustainedVoicesRef = useRef(new Map<string, number>());
  const stringKeyVoicesRef = useRef(new Map<string, number>());
  const previousTargetRef = useRef(targetKind);
  const lastAuditionRef = useRef(new Map<string, number>());
  const fixedWavesRef = useRef(new Map<StringKind, { bands: number[]; smooth: boolean; loop: boolean }>());
  const keyLayout = layoutKeyboard(LOGICAL_W, LOGICAL_H, false);
  const sustainLayout = layoutKeyboard(LOGICAL_W, LOGICAL_H, true);
  const heldKeysRef = useRef(new Map<string, string>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState(0);
  const [param, setParam] = useState(0);
  const [version, setVersion] = useState(0);
  const [audioState, setAudioState] = useState('off');
  const [audition, setAudition] = useState('');

  const fixedWaveFor = (kind: StringKind): { bands: number[]; smooth: boolean; loop: boolean } => {
    const existing = fixedWavesRef.current.get(kind);
    if (existing) return existing;
    const sustained = STRING_INTERACTIONS[kind] === '持续';
    const sustainedWave = sustained && targetStringId ? sustainedWaves.getFor(targetStringId, kind) : null;
    const timbre = getStringAudio().getKindTimbre(kind);
    const fixed = {
      bands: sustainedWave
        ? [...sustainedWave]
        : targetTimbre?.bands
          ? [...targetTimbre.bands]
          : timbre?.bands
            ? [...timbre.bands]
            : [0.22, 0.34, 0.52, 0.7, 0.84, 0.66, 0.46, 0.3],
      smooth: timbre?.smooth ?? true,
      loop: timbre?.loop ?? true,
    };
    fixedWavesRef.current.set(kind, fixed);
    return fixed;
  };

  const applyNodeEffects = (node: FlowNode): void => {
    if (!targetKind) return;
    const bitDrive = 1 - Math.max(0, Math.min(1, (node.bits - 4) / 12));
    const rateDrive = 1 - Math.max(0, Math.min(1, (node.sampleRate - 4000) / 40100));
    getStringAudio().setKindEffects(targetKind, {
      reverb: node.depth,
      cutoff: node.cutoff,
      resonance: node.resonance,
      drive: Math.max(0, Math.min(1, bitDrive * 0.7 + rateDrive * 0.2 + node.tension * 0.1)),
      lfoRate: node.lfoRate,
      lfoDepth: node.lfoDepth * 140,
      attack: node.attack,
      decay: node.decay,
      sustain: node.sustain,
      release: node.release,
      diffusion: node.diffusion,
      level: Math.max(0.6, Math.min(1.4, 0.7 + node.radius * 0.04)),
      sampleRate: node.sampleRate,
    });
  };

  const commit = (): void => {
    saveNodes(storageKey, nodesRef.current);
    const node = nodesRef.current[selectedRef.current];
    if (node) applyNodeEffects(node);
    setVersion((value) => value + 1);
  };

  const stopStringKeys = (): void => {
    const audio = getStringAudio();
    for (const voiceId of stringKeyVoicesRef.current.values()) audio.stopSustainedSpectrum(voiceId);
    stringKeyVoicesRef.current.clear();
  };

  const playTargetKey = (code: string): boolean => {
    if (!targetKind) return false;
    const sustained = STRING_INTERACTIONS[targetKind] === '持续';
    const layout = sustained ? sustainLayout : keyLayout;
    const cell = layout.find((item) => item.code === code);
    if (!cell) return false;
    if (!cell) return false;
    const now = performance.now();
    const last = lastAuditionRef.current.get(code) ?? 0;
    if (now - last < 90) return false;
    lastAuditionRef.current.set(code, now);
    setAudition(code);
    const audio = getStringAudio();
    const x = cell.cx / LOGICAL_W;
    const y = cell.cy / LOGICAL_H;
    const norm = Math.max(0, Math.min(1, targetNorm ?? 0.5));
    const baseline = valueToY(norm * 100);
    const maxPull = KIND_VISUAL[targetKind].maxPull;
    if (sustained) {
      const maxKeyDistance = Math.max(1, ...layout.map((item) => Math.abs(item.cy - baseline)));
      const amp = Math.max(0, Math.min(1, Math.abs(cell.cy - baseline) / maxKeyDistance));
      const fixed = fixedWaveFor(targetKind);
      const voiceId = audio.startSustainedSpectrum(fixed.bands, x, y, fixed.smooth, fixed.loop, amp, 0, targetKind);
      stringKeyVoicesRef.current.set(code, voiceId);
    } else {
      const amp = Math.max(0, Math.min(1, Math.abs(cell.cy - baseline) / Math.max(1, maxPull)));
      audio.pluck(targetKind, x, y, amp, 1, targetTimbre);
    }
    return true;
  };

  useEffect(() => {
    const previous = previousTargetRef.current;
    if (previous === targetKind) return;
    saveNodes(keyFor(previous), nodesRef.current);
    stopStringKeys();
    for (const voiceId of sustainedVoicesRef.current.values()) getStringAudio().stopSustainedSpectrum(voiceId);
    sustainedVoicesRef.current.clear();
    gateRef.current.clear();
    nodesRef.current = loadNodes(keyFor(targetKind));
    previousTargetRef.current = targetKind;
    fixedWavesRef.current.clear();
    if (targetKind) fixedWaveFor(targetKind);
    selectedRef.current = 0;
    setSelected(0);
    setVersion((value) => value + 1);
  }, [targetKind]);

  const envelopeOf = (node: FlowNode, now: number): number => {
    const ms = now;
    const state = gateRef.current.get(node.id);
    if (!state) return node.sustain;
    if (state.held) {
      const elapsed = Math.max(0, ms - state.triggeredAt) / 1000;
      if (elapsed < node.attack) return elapsed / Math.max(0.001, node.attack);
      if (elapsed < node.attack + node.decay) {
        const progress = (elapsed - node.attack) / Math.max(0.001, node.decay);
        return 1 - (1 - node.sustain) * progress;
      }
      return node.sustain;
    }
    const elapsed = Math.max(0, ms - state.releasedAt) / 1000;
    const level = state.releaseLevel * Math.max(0, 1 - elapsed / Math.max(0.001, node.release));
    return level;
  };

  const gateNode = (node: FlowNode): void => {
    gateRef.current.set(node.id, { triggeredAt: performance.now(), releasedAt: 0, held: true, releaseLevel: 1 });
    setVersion((value) => value + 1);
    ripplesRef.current.push({
      x: ((node.x + 0.5) / COLS) * window.innerWidth,
      y: ((node.y + 0.5) / ROWS) * window.innerHeight,
      start: performance.now(),
    });
    if (targetKind) {
      const audio = getStringAudio();
      applyNodeEffects(node);
      if (STRING_INTERACTIONS[targetKind] === '持续') {
        const fixed = fixedWaveFor(targetKind);
        const voiceId = audio.startSustainedSpectrum(
          fixed.bands,
          node.x / COLS,
          1 - node.y / ROWS,
          fixed.smooth,
          fixed.loop,
          0.72,
          0,
          targetKind,
        );
        sustainedVoicesRef.current.set(node.id, voiceId);
      } else {
        audio.pluck(targetKind, node.x / COLS, 1 - node.y / ROWS, 0.82, 1, targetTimbre);
      }
      return;
    }
    startAudio();
    syncAudio();
  };

  const releaseNode = (node: FlowNode): void => {
    const state = gateRef.current.get(node.id);
    const level = envelopeOf(node, performance.now());
    gateRef.current.set(node.id, { triggeredAt: state?.triggeredAt ?? 0, releasedAt: performance.now(), held: false, releaseLevel: level });
    const voiceId = sustainedVoicesRef.current.get(node.id);
    if (voiceId !== undefined) {
      getStringAudio().stopSustainedSpectrum(voiceId);
      sustainedVoicesRef.current.delete(node.id);
    }
    setVersion((value) => value + 1);
  };

  const copySelected = (): void => {
    const source = nodesRef.current[selectedRef.current];
    if (!source || nodesRef.current.length >= MAX_NODES) return;
    const copy: FlowNode = {
      ...source,
      id: `n${Date.now().toString(36)}${nodesRef.current.length}`,
      x: Math.min(COLS - 2, source.x + 1.5),
      y: Math.min(ROWS - 2, source.y + 1.5),
    };
    nodesRef.current = [...nodesRef.current.slice(0, selectedRef.current + 1), copy, ...nodesRef.current.slice(selectedRef.current + 1)];
    selectedRef.current += 1;
    setSelected(selectedRef.current);
    gateNode(copy);
    commit();
    syncAudio();
  };

  const deleteSelected = (): void => {
    if (nodesRef.current.length <= 1) return;
    const node = nodesRef.current[selectedRef.current];
    if (!node) return;
    removeVoice(node.id);
    gateRef.current.delete(node.id);
    nodesRef.current = nodesRef.current.filter((item) => item.id !== node.id);
    selectedRef.current = Math.min(selectedRef.current, nodesRef.current.length - 1);
    setSelected(selectedRef.current);
    commit();
  };

  const changeLayer = (direction: 1 | -1): void => {
    const node = nodesRef.current[selectedRef.current];
    if (!node) return;
    node.layer = Math.max(0, Math.min(2, Math.round(node.layer) + direction));
    commit();
  };

  const exportNodes = (): void => {
    const payload = { version: 1, world: worldFile, nodes: nodesRef.current };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${worldFile.split('/').pop()?.replace(/\.nro$/, '') ?? 'flow-field'}.nrm`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importNodes = async (file: File): Promise<void> => {
    try {
      const parsed = JSON.parse(await file.text()) as { nodes?: unknown };
      const raw = Array.isArray(parsed.nodes) ? parsed.nodes : Array.isArray(parsed) ? parsed : null;
      if (!raw) return;
      nodesRef.current = raw.slice(0, MAX_NODES).map((item, index) => {
        const node = item as Partial<FlowNode>;
        return {
          ...makeNode(Number(node.x) || 10, Number(node.y) || 10, index),
          ...node,
          id: typeof node.id === 'string' ? node.id : `n${index}`,
          radius: Math.max(2, Math.min(16, Number(node.radius) || 5)),
          depth: Math.max(0, Math.min(1, Number(node.depth) || 0.5)),
          diffusion: Math.max(0, Math.min(1, Number(node.diffusion) || 0.4)),
          decay: Math.max(0.02, Math.min(1.6, Number(node.decay) || 0.4)),
          sustain: Math.max(0, Math.min(1, Number(node.sustain) || 0.45)),
          sampleRate: Math.max(4000, Math.min(44100, Number(node.sampleRate) || 44100)),
          layer: Math.max(0, Math.min(2, Math.round(Number(node.layer) || 0))),
        } as FlowNode;
      });
      if (nodesRef.current.length === 0) return;
      selectedRef.current = 0;
      setSelected(0);
      gateRef.current.clear();
      commit();
      syncAudio();
    } catch {
      /* 非法 .nrm 保持现状 */
    }
  };

  const removeVoice = (id: string): void => {
    const audio = audioRef.current;
    const voice = audio?.voices.get(id);
    if (!audio || !voice) return;
    try {
      voice.osc.stop();
      voice.osc.disconnect();
      voice.filter.disconnect();
      voice.down.disconnect();
      voice.shaper.disconnect();
      voice.gain.disconnect();
      voice.pan.disconnect();
      voice.dry.disconnect();
      voice.send.disconnect();
      voice.convolver.disconnect();
    } catch {
      /* ignore */
    }
    audio.voices.delete(id);
  };

  const startAudio = (): void => {
    if (targetKind) return;
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
    if (targetKind) return;
    const audio = audioRef.current;
    if (!audio) return;
    for (const node of nodesRef.current) {
      if (!audio.voices.has(node.id)) {
        const osc = audio.ctx.createOscillator();
        const filter = audio.ctx.createBiquadFilter();
        const down = audio.ctx.createScriptProcessor(256, 1, 1);
        const shaper = audio.ctx.createWaveShaper();
        const gain = audio.ctx.createGain();
        const pan = audio.ctx.createStereoPanner();
        const dry = audio.ctx.createGain();
        const send = audio.ctx.createGain();
        const convolver = audio.ctx.createConvolver();
        const voice = {
          osc,
          filter,
          down,
          shaper,
          gain,
          pan,
          dry,
          send,
          convolver,
          held: 0,
          counter: 0,
          lastBits: node.bits,
          lastDiffusion: node.diffusion,
        };
        osc.type = 'sine';
        osc.frequency.value = 90 + (node.y / ROWS) * 420;
        gain.gain.value = 0.0001;
        filter.type = 'lowpass';
        shaper.curve = quantizeCurve(node.bits);
        convolver.buffer = makeImpulse(audio.ctx, node.diffusion);
        osc.connect(filter);
        filter.connect(down);
        down.connect(shaper);
        shaper.connect(gain);
        gain.connect(pan);
        pan.connect(dry);
        dry.connect(audio.master);
        pan.connect(send);
        send.connect(convolver);
        convolver.connect(audio.master);
        osc.start();
        down.onaudioprocess = (event) => {
          const current = nodesRef.current.find((item) => item.id === node.id);
          if (!current) return;
          const input = event.inputBuffer.getChannelData(0);
          const output = event.outputBuffer.getChannelData(0);
          const step = Math.max(1, Math.round(audio.ctx.sampleRate / Math.max(1000, current.sampleRate)));
          for (let i = 0; i < input.length; i += 1) {
            if (voice.counter <= 0) {
              voice.held = input[i] ?? 0;
              voice.counter = step;
            }
            voice.counter -= 1;
            output[i] = voice.held;
          }
        };
        audio.voices.set(node.id, voice);
      }
    }
  };

  const updateAudio = (now: number): void => {
    if (targetKind) return;
    const audio = audioRef.current;
    if (!audio) return;
    for (const node of nodesRef.current) {
      const voice = audio.voices.get(node.id);
      if (!voice) continue;
      const phase = now * 0.001 * node.lfoRate + node.x * 0.13;
      const env = envelopeOf(node, now);
      voice.filter.frequency.value = Math.max(80, Math.min(18000, node.cutoff + Math.sin(phase) * node.cutoff * 0.18));
      voice.filter.Q.value = node.resonance;
      voice.pan.pan.value = Math.max(-1, Math.min(1, (node.x / COLS) * 2 - 1 + Math.sin(phase) * 0.1));
      voice.gain.gain.value = audio.muted ? 0 : (0.006 + node.radius * 0.0013) * Math.max(0, env);
      voice.dry.gain.value = 1 - node.depth * 0.35;
      voice.send.gain.value = node.depth * 0.55;
      if (Math.abs(voice.lastBits - node.bits) >= 0.5) {
        voice.lastBits = node.bits;
        voice.shaper.curve = quantizeCurve(node.bits);
      }
      if (Math.abs(voice.lastDiffusion - node.diffusion) >= 0.02) {
        voice.lastDiffusion = node.diffusion;
        voice.convolver.buffer = makeImpulse(audio.ctx, node.diffusion);
      }
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
      if (event.repeat) return;
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
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.code === 'ArrowLeft' || event.code === 'ArrowRight') &&
        kinds &&
        kinds.length > 0 &&
        onTargetKindChange
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const index = Math.max(0, kinds.indexOf(targetKind ?? kinds[0]!));
        const direction = event.code === 'ArrowRight' ? 1 : -1;
        onTargetKindChange(kinds[(index + direction + kinds.length) % kinds.length]!);
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
      if (event.ctrlKey || event.metaKey) {
        if (event.code === 'KeyM') {
          startAudio();
          if (audioRef.current) audioRef.current.muted = !audioRef.current.muted;
          setAudioState(audioRef.current?.muted ? 'muted' : 'on');
          event.preventDefault();
          return;
        }
        if (event.code === 'KeyC') {
          copySelected();
          event.preventDefault();
          return;
        }
        if (event.code === 'KeyE') {
          exportNodes();
          event.preventDefault();
          return;
        }
        if (event.code === 'KeyI') {
          fileInputRef.current?.click();
          event.preventDefault();
          return;
        }
        if (event.code === 'KeyR') {
          nodesRef.current = DEFAULT_NODES.map((node) => ({ ...node }));
          selectedRef.current = 0;
          setSelected(0);
          gateRef.current.clear();
          commit();
          event.preventDefault();
          return;
        }
        if (event.code === 'KeyS') {
          saveNodes(storageKey, nodesRef.current);
          event.preventDefault();
          return;
        }
      }
      if (event.code === 'Delete' || event.code === 'Backspace') {
        deleteSelected();
        return;
      }
      if (event.code === 'PageUp' || event.code === 'PageDown') {
        changeLayer(event.code === 'PageUp' ? 1 : -1);
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
      if (!event.ctrlKey && !event.metaKey && !event.altKey && targetKind && playTargetKey(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
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
    const onKeyUp = (event: KeyboardEvent): void => {
      const voiceId = stringKeyVoicesRef.current.get(event.code);
      if (voiceId !== undefined) {
        getStringAudio().stopSustainedSpectrum(voiceId);
        stringKeyVoicesRef.current.delete(event.code);
      }
      const nodeId = heldKeysRef.current.get(event.code);
      if (!nodeId) return;
      heldKeysRef.current.delete(event.code);
      if ([...heldKeysRef.current.values()].includes(nodeId)) return;
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (node) releaseNode(node);
    };
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [worldFile, onClose, targetKind, kinds, onTargetKindChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const resize = (): void => {
      const dpr = Math.min(1.25, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    let lastRender = 0;
    let frameCount = 0;

    const fieldAt = (gx: number, gy: number, now: number): number => {
      const t = now * 0.001;
      let value = 0.015;
      for (const node of nodesRef.current) {
        const phase = t * node.lfoRate * Math.PI * 2 + node.x * 0.08;
        const cx = node.x + Math.sin(phase) * node.lfoDepth;
        const cy = node.y + Math.cos(phase * 0.77 + node.radius) * node.lfoDepth;
        const srStep = Math.max(1, Math.round(44100 / Math.max(4000, node.sampleRate)));
        const qgx = Math.round(gx / srStep) * srStep;
        const qgy = Math.round(gy / srStep) * srStep;
        const sampleX = gx * 0.72 + qgx * 0.28;
        const sampleY = gy * 0.72 + qgy * 0.28;
        const dx = (sampleX - cx) / node.radius;
        const dy = (sampleY - cy) / node.radius;
        const dist = dx * dx + dy * dy;
        if (dist > 6) continue;
        const env = Math.max(0.01, envelopeOf(node, now));
        let contribution = Math.exp(-dist * (0.7 + node.tension * 1.1)) * (0.52 + env * 0.42);
        contribution *= 0.68 + node.layer * 0.16;
        const ring = 0.85 + 0.15 * Math.sin(Math.sqrt(dist) * (node.cutoff / 1500) + node.resonance);
        contribution *= ring;
        if (node.bits < 11) {
          const steps = Math.pow(2, Math.max(1, Math.min(11, node.bits)));
          const quantized = Math.round(contribution * steps) / steps;
          contribution = contribution * 0.72 + quantized * 0.28;
        }
        value += contribution;
      }
      return Math.max(0, Math.min(1, value));
    };

    const draw = (now: number): void => {
      raf = window.requestAnimationFrame(draw);
      if (now - lastRender < 30) return;
      lastRender = now;
      frameCount += 1;
      if (frameCount % 3 === 0) updateAudio(now);
      const width = canvas.width;
      const height = canvas.height;
      const dpr = Math.min(1.25, Math.max(1, window.devicePixelRatio || 1));
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
            const candidates = (byPoint.get(key) ?? []).filter((index) => !used[index]);
            if (candidates.length !== 1) return;
            if ((byPoint.get(key) ?? []).length > 2) return;
            const found = candidates[0]!;
            const previous = points[atStart ? 0 : points.length - 1]!;
            const candidate = segments[found]!;
            const next = other(candidate, key);
            if (Math.hypot(next.x - previous.x, next.y - previous.y) > Math.max(cellW, cellH) * 2.2) return;
            used[found] = 1;
            if (atStart) points.unshift(next);
            else points.push(next);
            if (keyOf(next) === keyOf(atStart ? points[points.length - 1]! : points[0]!)) return;
          }
        };

        let pathIndex = 0;
        const smoothPoints = (input: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => {
          let current = input;
          for (let pass = 0; pass < 2; pass += 1) {
            if (current.length < 3) break;
            const next: Array<{ x: number; y: number }> = [current[0]!];
            for (let i = 0; i < current.length - 1; i += 1) {
              const p = current[i]!;
              const q = current[i + 1]!;
              next.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
              next.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
            }
            next.push(current[current.length - 1]!);
            current = next;
          }
          return current;
        };
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
          const smooth = smoothPoints(points);
          const width = 1.8 + 1.8 * (0.5 + 0.5 * Math.sin(t * 1.9 + level * 0.9 + pathIndex * 0.33));
          ctx.shadowBlur = 0;
          ctx.strokeStyle = `hsla(${hue}, 92%, 62%, 0.12)`;
          ctx.lineWidth = width + 5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(smooth[0]!.x, smooth[0]!.y);
          for (let k = 1; k < smooth.length - 1; k += 1) {
            const current = smooth[k]!;
            const next = smooth[k + 1]!;
            ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
          }
          ctx.lineTo(smooth[smooth.length - 1]!.x, smooth[smooth.length - 1]!.y);
          ctx.stroke();
          ctx.strokeStyle = `hsla(${hue}, 92%, ${64 + (level % 3) * 5}%, ${0.72 - level * 0.025})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(smooth[0]!.x, smooth[0]!.y);
          for (let k = 1; k < smooth.length - 1; k += 1) {
            const current = smooth[k]!;
            const next = smooth[k + 1]!;
            ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
          }
          ctx.lineTo(smooth[smooth.length - 1]!.x, smooth[smooth.length - 1]!.y);
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

      const nowMs = performance.now();
      ripplesRef.current = ripplesRef.current.filter((ripple) => nowMs - ripple.start < 900);
      for (const ripple of ripplesRef.current) {
        const progress = Math.max(0, Math.min(1, (nowMs - ripple.start) / 900));
        const eased = 1 - Math.pow(1 - progress, 3);
        const radius = 10 + eased * 90;
        ctx.strokeStyle = `rgba(255, 150, 70, ${(1 - progress) * 0.5})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 230, 200, ${(1 - progress) * 0.22})`;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius * 0.62, 0, Math.PI * 2);
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
  const gateCount = [...gateRef.current.values()].filter((state) => state.held).length;

  return (
    <div
      className="flow-screen"
      data-testid="flow-screen"
      data-flow-version={version}
      data-flow-nodes={nodesRef.current.length}
      data-flow-selected={selected}
      data-flow-param={param}
      data-flow-audio={audioState}
      data-flow-gates={gateCount}
      data-flow-layer={selectedNode?.layer ?? 0}
      data-flow-target={targetKind ?? ''}
      data-flow-audition={audition}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".nrm,.json"
        style={{ display: 'none' }}
        data-testid="flow-import"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importNodes(file);
          event.target.value = '';
        }}
      />
      <canvas
        ref={canvasRef}
        className="flow-screen__canvas"
        data-testid="flow-canvas"
        data-flow-cells={COLS * ROWS}
        onPointerDown={(event) => {
          startAudio();
          syncAudio();
          ripplesRef.current.push({ x: event.clientX, y: event.clientY, start: performance.now() });
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointerToCell(event);
          const hit = nodesRef.current.findIndex(
            (node) => Math.hypot(node.x - point.x, node.y - point.y) <= Math.max(2, node.radius * 0.7),
          );
          if (hit >= 0) {
            selectedRef.current = hit;
            setSelected(hit);
            const node = nodesRef.current[hit]!;
            gateNode(node);
            dragRef.current = { nodeId: node.id, pointerId: event.pointerId };
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
        }}
        onPointerUp={() => {
          const released = nodesRef.current.find((node) => node.id === dragRef.current.nodeId);
          if (released) releaseNode(released);
          if (dragRef.current.nodeId) commit();
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
        <strong>{targetKind ? `流场 · ${targetKind}${kindLabels?.[targetKind] ? ` · ${kindLabels[targetKind]}` : ''} 音色目标` : '流场统一节点 · 声场 / 滤波 / ADSR / LFO / LoFi'}</strong>
        <span>键盘沿用弦界面映射实时试听 · Ctrl+←/→ 切换音色目标 · 拖节点 · Tab 切节点 · [ ] 参数 · - = 调整 · Ctrl+C 复制 · Delete 删除 · PageUp/Down 层级 · Ctrl+E 导出 · Ctrl+I 导入 · Ctrl+M 静音 · Ctrl+S 保存 · Ctrl+R 重置 · F10/Esc 返回</span>
      </div>
      <div className="flow-screen__node-panel" data-testid="flow-node-panel">
        <div className="flow-screen__node-title">
          节点 {selected + 1}/{nodesRef.current.length} · L{selectedNode?.layer ?? 0} · {selectedNode ? `${selectedNode.x.toFixed(1)},${selectedNode.y.toFixed(1)}` : '—'}
        </div>
        {kinds && kinds.length > 0 ? (
          <div className="flow-screen__targets" data-testid="flow-targets">
            {kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`flow-screen__target${kind === targetKind ? ' flow-screen__target--active' : ''}`}
                data-flow-target-kind={kind}
                onClick={() => onTargetKindChange?.(kind)}
              >
                {kindLabels?.[kind] ?? kind}
              </button>
            ))}
          </div>
        ) : null}
        {PARAMS.map((spec, index) => (
          <div
            key={spec.key}
            className={`flow-screen__param${index === param ? ' flow-screen__param--selected' : ''}`}
            data-flow-param-name={spec.key}
            onClick={() => {
              paramRef.current = index;
              setParam(index);
            }}
          >
            <span>{spec.label}</span>
            <em>{selectedNode ? spec.format(selectedNode) : '—'}</em>
            <span className="flow-screen__param-actions">
              <button
                type="button"
                aria-label={`${spec.label}-`}
                onClick={(event) => {
                  event.stopPropagation();
                  paramRef.current = index;
                  setParam(index);
                  adjustParam(-1);
                }}
              >
                −
              </button>
              <button
                type="button"
                aria-label={`${spec.label}+`}
                onClick={(event) => {
                  event.stopPropagation();
                  paramRef.current = index;
                  setParam(index);
                  adjustParam(1);
                }}
              >
                +
              </button>
            </span>
          </div>
        ))}
        <div className="flow-screen__actions">
          <button type="button" onClick={exportNodes}>导出 .nrm</button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>导入 .nrm</button>
        </div>
      </div>
    </div>
  );
}
