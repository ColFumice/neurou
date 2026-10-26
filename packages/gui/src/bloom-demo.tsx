/**
 * 墨晕生长独立验证页（demo 专用，不参与正式集成）
 * ---------------------------------------------------------------
 * 地址：http://127.0.0.1:5188/bloom-demo.html
 * 交互：在纸面上点击 → 该位置长出一簇墨；Tab / 按钮切反色；
 *       「连点 ×4」用于同屏 4 簇的帧率验证。
 * 页面多出来的工具栏只属于 demo，不影响 InkBloom 集成。
 */
import { StrictMode, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { InkBloom, type InkBloomHandle } from './InkBloom.js';
import './styles.css';
import './core.css';

const PANEL: CSSProperties = {
  position: 'absolute',
  top: 18,
  left: 18,
  zIndex: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '9px 14px',
  border: '1px solid var(--ink-faint)',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--paper) 72%, transparent)',
  color: 'var(--ink-soft)',
  fontFamily: 'var(--sans)',
  fontSize: 11,
  letterSpacing: '0.08em',
  pointerEvents: 'auto',
};

const BTN: CSSProperties = {
  border: '1px solid var(--ink-faint)',
  background: 'transparent',
  color: 'var(--ink)',
  padding: '4px 10px',
  borderRadius: 999,
  fontFamily: 'var(--sans)',
  fontSize: 11,
  letterSpacing: '0.08em',
  cursor: 'pointer',
};

const META: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.06em',
  color: 'var(--ink-soft)',
};

const HINT: CSSProperties = {
  position: 'absolute',
  bottom: 22,
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 11,
  letterSpacing: '0.16em',
  color: 'var(--ink-faint)',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
};

function Demo() {
  const bloom = useRef<InkBloomHandle | null>(null);
  const [inverted, setInverted] = useState(false);
  const [meta, setMeta] = useState({ blooms: 0, spawned: 0 });

  useEffect(() => {
    (window as Window & { __inkBloom?: InkBloomHandle | null }).__inkBloom = bloom.current ?? null;
    const timer = window.setInterval(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="ink-blooms"]');
      if (!canvas) return;
      setMeta({
        blooms: Number(canvas.dataset.blooms ?? 0),
        spawned: Number(canvas.dataset.spawned ?? 0),
      });
    }, 150);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setInverted((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    bloom.current?.spawn(e.clientX, e.clientY);
  };

  const burst = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const points: [number, number][] = [
      [w * 0.34, h * 0.38],
      [w * 0.66, h * 0.38],
      [w * 0.34, h * 0.68],
      [w * 0.66, h * 0.68],
    ];
    let i = 0;
    const tick = () => {
      const p = points[i];
      i += 1;
      if (p) bloom.current?.spawn(p[0], p[1]);
      if (i < points.length) window.setTimeout(tick, 90);
    };
    tick();
  };

  return (
    <div
      className={`ink-app ${inverted ? 'is-inverted' : ''}`}
      data-testid="ink-app"
      data-inverted={inverted}
      onPointerDown={onPointerDown}
    >
      <InkBloom ref={bloom} inverted={inverted} />
      <div style={PANEL} onPointerDown={(e) => e.stopPropagation()}>
        <span style={{ color: 'var(--ink)', letterSpacing: '0.18em' }}>墨晕生长</span>
        <button type="button" data-testid="demo-invert" style={BTN} onClick={() => setInverted((v) => !v)}>
          反色
        </button>
        <button type="button" data-testid="demo-burst" style={BTN} onClick={burst}>
          连点 ×4
        </button>
        <span data-testid="demo-meta" style={META}>
          簇 {meta.blooms} · 累计 {meta.spawned}
        </span>
      </div>
      <div style={HINT}>点击纸面任意位置生长 · Tab 反色</div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');
createRoot(root).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
