import { useEffect, useState } from 'react';

/** 贯穿全屏的十字 + 中心实心准星（不使用原生光标）。 */
export function CursorLayer(): JSX.Element {
  const [point, setPoint] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      setPoint({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return (
    <div className="cursor-layer" data-testid="cursor-layer" aria-hidden="true">
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
