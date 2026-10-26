import { useEffect, useMemo, useState } from 'react';
import { Universe } from '@neurou/runtime';
import { CORE_TEST } from './coreWorld.js';
import { CoreNetwork } from './CoreNetwork.js';
import { snapshotOf } from './types.js';

const TICK_MS = 420;

export function App() {
  const [universe] = useState(() => new Universe(CORE_TEST.ir, { seed: 7, log: false }));
  const [version, setVersion] = useState(0);
  const [inverted, setInverted] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (universe.state.ended) return;
      universe.tick();
      setVersion((v) => v + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [universe]);

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

  const snap = useMemo(() => snapshotOf(universe), [universe, version]);

  if (!CORE_TEST.ok) {
    return (
      <div className="ink-fatal" data-testid="ink-fatal">
        <div>{CORE_TEST.title} 编译不过去</div>
        {CORE_TEST.diagnostics.slice(0, 6).map((d, i) => (
          <div key={i}>{d.message}</div>
        ))}
      </div>
    );
  }

  const adjust = (id: string, value: number) => {
    const s = CORE_TEST.ir.strings.find((x) => x.id === id);
    if (!s || s.domain.type !== 'number') return;
    const min = s.domain.min ?? 0;
    const max = s.domain.max ?? 100;
    universe.state.values[id] = Math.min(max, Math.max(min, value));
    setVersion((v) => v + 1);
  };

  return (
    <div className={`ink-app ${inverted ? 'is-inverted' : ''}`} data-testid="ink-app" data-inverted={inverted}>
      <CoreNetwork world={CORE_TEST.ir} snap={snap} inverted={inverted} onAdjust={adjust} />
    </div>
  );
}
