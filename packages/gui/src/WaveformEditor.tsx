import { useEffect, useMemo, useRef, useState } from 'react';
import type { StringKind } from '@neurou/core';
import { SUSTAINED_WAVE_BANDS, type WavePreset } from './sustainedWave.js';

export interface EditorString {
  id: string;
  name: string;
  kind: StringKind;
}

export interface EditorAsset {
  name: string;
  src: string;
  kind: '音频' | '纹理';
}

export interface WaveformEditorProps {
  strings: EditorString[];
  assets: EditorAsset[];
  getWave: (id: string, kind: StringKind) => readonly number[];
  onEdit: (id: string, kind: StringKind, wave: number[]) => void;
  onPreset: (id: string, kind: StringKind, preset: WavePreset) => void;
  onReset: (id: string, kind: StringKind) => void;
  onClose: () => void;
}

const W = 520;
const H = 170;

function trace(ctx: CanvasRenderingContext2D, wave: readonly number[]): void {
  ctx.beginPath();
  for (let i = 0; i < wave.length; i += 1) {
    const x = (i / (wave.length - 1)) * W;
    const y = (1 - (wave[i] ?? 0.5)) * H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

export function WaveformEditor({
  strings,
  assets,
  getWave,
  onEdit,
  onPreset,
  onReset,
  onClose,
}: WaveformEditorProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState(0);
  const current = strings[Math.min(selected, Math.max(0, strings.length - 1))];
  const [wave, setWave] = useState<number[]>(
    current ? [...getWave(current.id, current.kind)] : new Array(SUSTAINED_WAVE_BANDS).fill(0.5),
  );
  const waveRef = useRef(wave);
  waveRef.current = wave;

  useEffect(() => {
    if (!current) return;
    setWave([...getWave(current.id, current.kind)]);
  }, [current?.id, current?.kind, getWave]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(40, 38, 34, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = (i / 4) * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(40, 38, 34, 0.82)';
    ctx.lineWidth = 1.6;
    trace(ctx, waveRef.current);
    ctx.stroke();
  }, [wave, current?.id]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const paint = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x01 = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const value = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
    const next = [...waveRef.current];
    const center = x01 * (next.length - 1);
    for (let i = 0; i < next.length; i += 1) {
      const weight = Math.exp(-(((i - center) / 2.2) ** 2));
      if (weight < 0.02) continue;
      next[i] = (next[i] ?? 0.5) * (1 - weight * 0.6) + value * weight * 0.6;
    }
    waveRef.current = next;
    setWave(next);
  };

  const push = (): void => {
    if (!current) return;
    onEdit(current.id, current.kind, [...waveRef.current]);
  };

  const presetList: { label: string; value: WavePreset }[] = useMemo(
    () => [
      { label: '正弦', value: '正弦' },
      { label: '三角', value: '三角' },
      { label: '方波', value: '方波' },
      { label: '柔波', value: '柔波' },
    ],
    [],
  );

  return (
    <div
      className="waveform-editor"
      data-testid="waveform-editor"
      data-editor-strings={strings.map((item) => item.id).join(',')}
      data-editor-assets={assets.map((asset) => `${asset.kind}:${asset.name}`).join(',')}
      data-editor-selected={current?.id ?? ''}
      tabIndex={-1}
      ref={rootRef}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.code === 'Escape' || event.code === 'F6') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="waveform-editor__title">波形 / 资源</div>
      <div className="waveform-editor__body">
        <div className="waveform-editor__strings">
          {strings.map((item, index) => (
            <span
              key={item.id}
              className={`waveform-editor__string${index === selected ? ' waveform-editor__string--selected' : ''}`}
              data-editor-string={item.id}
              onClick={() => setSelected(index)}
            >
              {item.name}
              <em>{item.kind}</em>
            </span>
          ))}
        </div>
        <div className="waveform-editor__main">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            data-testid="waveform-editor-canvas"
            data-wave-values={wave.map((value) => Math.round(value * 1000) / 1000).join(',')}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              paint(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return;
              paint(event);
            }}
            onPointerUp={push}
          />
          <div className="waveform-editor__actions">
            {presetList.map((preset) => (
              <span
                key={preset.value}
                data-editor-preset={preset.value}
                onClick={() => {
                  if (!current) return;
                  onPreset(current.id, current.kind, preset.value);
                  setWave([...getWave(current.id, current.kind)]);
                }}
              >
                {preset.label}
              </span>
            ))}
            <span
              data-editor-reset="true"
              onClick={() => {
                if (!current) return;
                onReset(current.id, current.kind);
                setWave([...getWave(current.id, current.kind)]);
              }}
            >
              重置
            </span>
            <span data-editor-close="true" onClick={onClose}>
              关闭
            </span>
          </div>
        </div>
        <div className="waveform-editor__assets">
          <div className="waveform-editor__assets-title">资源</div>
          {assets.length === 0 ? <span className="waveform-editor__empty">无</span> : null}
          {assets.map((asset) => (
            <span key={`${asset.kind}:${asset.name}`} data-editor-asset={asset.name}>
              <em>{asset.kind}</em>
              {asset.name} · {asset.src}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
