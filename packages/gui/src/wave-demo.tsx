/**
 * 基准弦的独立验证页：http://127.0.0.1:5188/wave-demo.html
 *
 * 全屏 .ink-app 容器 + WaveString 覆盖层 + demo 专用的反色按钮/提示。
 * 与主应用一样用 StrictMode，验证双挂载下音频单例与 effect 清理是幂等的。
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WaveString } from './WaveString.js';
import './styles.css';
import './core.css';

const hintStyle = {
  position: 'absolute',
  left: '20px',
  top: '18px',
  fontFamily: 'var(--serif)',
  fontSize: '11px',
  letterSpacing: '0.22em',
  color: 'var(--ink)',
  opacity: 0.32,
  pointerEvents: 'none',
  userSelect: 'none',
} as const;

const buttonStyle = {
  position: 'absolute',
  right: '22px',
  top: '16px',
  padding: '4px 12px',
  border: '1px solid var(--ink)',
  borderRadius: '999px',
  background: 'transparent',
  color: 'var(--ink)',
  fontFamily: 'var(--serif)',
  fontSize: '11px',
  letterSpacing: '0.2em',
  opacity: 0.34,
  cursor: 'pointer',
} as const;

function WaveDemo() {
  const [inverted, setInverted] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        setInverted((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={`ink-app ${inverted ? 'is-inverted' : ''}`}
      data-testid="ink-app"
      data-inverted={inverted}
    >
      <WaveString />
      <div style={hintStyle}>点击弦面塑形 · Esc 复位</div>
      <button
        type="button"
        data-testid="wave-demo-invert"
        style={buttonStyle}
        onClick={() => setInverted((value) => !value)}
      >
        反色
      </button>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');
createRoot(root).render(
  <StrictMode>
    <WaveDemo />
  </StrictMode>,
);
