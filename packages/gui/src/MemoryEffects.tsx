import { useEffect, useState } from 'react';
import type { StringKind } from '@neurou/core';
import { getStringAudio, type KindEffects } from './stringAudio.js';

interface MemoryEffectsProps {
  open: boolean;
  kind: StringKind;
  onClose: () => void;
}

const FIELDS: Array<{ key: keyof KindEffects; label: string; step: number; min: number; max: number }> = [
  { key: 'reverb', label: '混响', step: 0.05, min: 0, max: 1 },
  { key: 'cutoff', label: '低通', step: 400, min: 200, max: 12000 },
  { key: 'resonance', label: '共振', step: 0.4, min: 0.1, max: 12 },
  { key: 'drive', label: '驱动', step: 0.05, min: 0, max: 1 },
  { key: 'lfoRate', label: 'LFO 速率', step: 0.04, min: 0, max: 1.2 },
  { key: 'lfoDepth', label: 'LFO 深度', step: 100, min: 0, max: 4000 },
];

function formatEffect(key: keyof KindEffects, effects: KindEffects): string {
  if (key === 'cutoff') return `${Math.round(effects.cutoff)} Hz`;
  if (key === 'resonance') return effects.resonance.toFixed(1);
  if (key === 'lfoDepth') return `${Math.round(effects.lfoDepth)} Hz`;
  if (key === 'lfoRate') return effects.lfoRate.toFixed(2);
  return effects[key].toFixed(2);
}

/** F9 记忆模式效果器：按当前弹奏弦类型调混响/低通。 */
export function MemoryEffects({ open, kind, onClose }: MemoryEffectsProps): JSX.Element | null {
  const [effects, setEffects] = useState<KindEffects>(() => getStringAudio().getKindEffects(kind));
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (open) setEffects(getStringAudio().getKindEffects(kind));
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'F9' || event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const step = event.code === 'ArrowDown' ? 1 : -1;
        setSelected((value) => (value + step + FIELDS.length) % FIELDS.length);
        return;
      }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        const field = FIELDS[selected];
        if (!field) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const delta = (event.code === 'ArrowRight' ? 1 : -1) * field.step;
        const next = getStringAudio().setKindEffects(kind, {
          [field.key]: Math.max(field.min, Math.min(field.max, effects[field.key] + delta)),
        });
        setEffects(next);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, selected, effects, kind, onClose]);

  if (!open) return null;
  return (
    <div className="memory-effects" data-testid="memory-effects" data-effect-kind={kind} data-effect-reverb={effects.reverb} data-effect-cutoff={Math.round(effects.cutoff)}>
      <div className="memory-effects__title">声场效果器 · {kind}</div>
      <div className="memory-effects__hint">↑/↓ 选参数 · ←/→ 调整 · F9/Esc 关闭</div>
      {FIELDS.map((field, index) => (
        <div key={field.key} className={`memory-effects__row${index === selected ? ' memory-effects__row--selected' : ''}`}>
          <span>{field.label}</span>
          <em>{formatEffect(field.key, effects)}</em>
        </div>
      ))}
    </div>
  );
}
