import { useEffect, useRef, useState } from 'react';

const IDLE_MS = 1000;

/** 贯穿全屏的十字 + 中心实心准星（不使用原生光标）；静止 1s 后十字收拢。 */
export function CursorLayer(): JSX.Element {
  const [point, setPoint] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [idle, setIdle] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const arm = (): void => {
      setIdle(false);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    const onMove = (event: PointerEvent): void => {
      setPoint({ x: event.clientX, y: event.clientY });
      arm();
    };
    arm();
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', arm, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', arm);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      className={`cursor-layer${idle ? ' cursor-layer--idle' : ''}`}
      data-testid="cursor-layer"
      data-cursor-idle={idle ? 'true' : 'false'}
      aria-hidden="true"
    >
      <div className="cursor-layer__line cursor-layer__line--v" style={{ left: point.x }} />
      <div className="cursor-layer__line cursor-layer__line--h" style={{ top: point.y }} />
      <div className="cursor-layer__reticle" style={{ left: point.x, top: point.y }}>
        <span className="cursor-layer__arm cursor-layer__arm--u" />
        <span className="cursor-layer__arm cursor-layer__arm--d" />
        <span className="cursor-layer__arm cursor-layer__arm--l" />
        <span className="cursor-layer__arm cursor-layer__arm--r" />
        <span className="cursor-layer__dot" />
      </div>
    </div>
  );
}
