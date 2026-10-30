import { useEffect, useMemo, useRef, useState } from 'react';
import type { StringKind } from '@neurou/core';
import { SUSTAINED_WAVE_BANDS, type WavePreset } from './sustainedWave.js';

export interface EditorString {
  id: string;
  name: string;
  kind: StringKind;
}

export interface EditorAsset {
  id: string;
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
  onAssetSrc: (id: string, kind: '音频' | '纹理', src: string) => void;
  onAssetRename: (id: string, kind: '音频' | '纹理', name: string) => void;
  onAssetDelete: (id: string, kind: '音频' | '纹理') => void;
  getAssetRefs: (id: string, kind: '音频' | '纹理') => string[];
  getAssetChoices: (id: string, kind: '音频' | '纹理') => EditorAsset[];
  onAssetReplace: (id: string, kind: '音频' | '纹理', nextId: string) => void;
  postLevel: number;
  onPostLevel: (value: number) => void;
  errorLine?: number;
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
  onAssetSrc,
  onAssetRename,
  onAssetDelete,
  getAssetRefs,
  getAssetChoices,
  onAssetReplace,
  postLevel,
  onPostLevel,
  errorLine,
  onClose,
}: WaveformEditorProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState(0);
  const [assetSelected, setAssetSelected] = useState<string | null>(assets[0]?.id ?? null);
  const [assetSrc, setAssetSrc] = useState(assets[0]?.src ?? '');
  const [assetName, setAssetName] = useState(assets[0]?.name ?? '');
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
        if (event.code === 'Escape' || event.code === 'F6') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="waveform-editor__title">波形 / 资源</div>
      {errorLine ? (
        <div className="waveform-editor__error" data-editor-error-line={errorLine}>
          编译错误 · 第 {errorLine} 行
        </div>
      ) : null}
      <div className="waveform-editor__body">
        <div className="waveform-editor__strings">
          {strings.map((item, index) => (
            <span
              key={item.id}
              className={`waveform-editor__string${index === selected ? ' waveform-editor__string--selected' : ''}`}
              data-editor-string={item.id}
              data-modal-item
              role="button"
              tabIndex={0}
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
                data-modal-item
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!current) return;
                  onPreset(current.id, current.kind, preset.value);
                  setWave([...getWave(current.id, current.kind)]);
                }}
              >
                {preset.label}
              </span>
            ))}
            <span data-editor-reset="true" data-modal-item role="button" tabIndex={0} onClick={() => {
                if (!current) return;
                onReset(current.id, current.kind);
                setWave([...getWave(current.id, current.kind)]);
              }}
            >
              重置
            </span>
            <span data-editor-post={postLevel} data-modal-item role="button" tabIndex={0} onClick={() => onPostLevel((postLevel + 1) % 3)}>
              后处理 {postLevel.toFixed(2)}
            </span>
            <input
              className="waveform-editor__post-range"
              data-editor-post-range="true"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={postLevel}
              onChange={(event) => onPostLevel(Number(event.target.value))}
            />
            <span data-editor-close="true" data-modal-item role="button" tabIndex={0} onClick={onClose}>
              关闭
            </span>
          </div>
        </div>
        <div className="waveform-editor__assets">
          <div className="waveform-editor__assets-title">资源</div>
          {assets.length === 0 ? <span className="waveform-editor__empty">无</span> : null}
          {assets.map((asset) => (
            <span
              key={`${asset.kind}:${asset.name}`}
              className={assetSelected === asset.id ? 'waveform-editor__asset--selected' : ''}
              data-editor-asset={asset.name}
              data-modal-item
              role="button"
              tabIndex={0}
              onClick={() => {
                setAssetSelected(asset.id);
                setAssetSrc(asset.src);
                setAssetName(asset.name);
              }}
            >
              <em>{asset.kind}</em>
              {asset.name} · {asset.src}
            </span>
          ))}
          {assetSelected ? (
            <input
              className="waveform-editor__asset-input"
              data-editor-asset-name="true"
              value={assetName}
              onChange={(event) => setAssetName(event.target.value)}
              onBlur={() => {
                const asset = assets.find((item) => item.id === assetSelected);
                if (asset && assetName.trim() && assetName !== asset.name) onAssetRename(asset.id, asset.kind, assetName.trim());
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                else if (event.key === 'Escape') event.currentTarget.blur();
              }}
            />
          ) : null}
          {assetSelected ? (
            <input
              className="waveform-editor__asset-input"
              data-editor-asset-src="true"
              value={assetSrc}
              onChange={(event) => setAssetSrc(event.target.value)}
              onBlur={() => {
                const asset = assets.find((item) => item.id === assetSelected);
                if (asset && assetSrc.trim() && assetSrc !== asset.src) onAssetSrc(asset.id, asset.kind, assetSrc.trim());
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                else if (event.key === 'Escape') event.currentTarget.blur();
              }}
            />
          ) : null}
          {assetSelected ? (
            (() => {
              const asset = assets.find((item) => item.id === assetSelected);
              if (!asset) return null;
              const refs = getAssetRefs(asset.id, asset.kind);
              const choices = getAssetChoices(asset.id, asset.kind);
              return (
                <>
                  <div className="waveform-editor__asset-refs" data-editor-asset-refs={refs.length}>
                    引用：{refs.length === 0 ? '无' : refs.join(' / ')}
                  </div>
                  {refs.length > 0 && choices.length > 0 ? (
                    <div className="waveform-editor__asset-choices">
                      替换为：
                      {choices.map((choice) => (
                        <span
                          key={choice.id}
                          data-editor-asset-replace={choice.name}
                          data-modal-item
                          role="button"
                          tabIndex={0}
                          onClick={() => onAssetReplace(asset.id, asset.kind, choice.id)}
                        >
                          {choice.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {refs.length > 0 ? (
                    <span className="waveform-editor__asset-delete" data-editor-asset-delete-blocked="true">
                      被引用，不能删除
                    </span>
                  ) : (
                    <span
                      className="waveform-editor__asset-delete"
                      data-editor-asset-delete="true"
                      data-modal-item
                      role="button"
                      tabIndex={0}
                      onClick={() => onAssetDelete(asset.id, asset.kind)}
                    >
                      删除资产
                    </span>
                  )}
                </>
              );
            })()
          ) : null}
        </div>
      </div>
    </div>
  );
}
