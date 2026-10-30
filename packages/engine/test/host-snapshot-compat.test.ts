import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { createEngine, HOST_ABI, isHostSnapshotCompatible } from '../src/index.js';

const SOURCE = `世界 ABI\n  版本 0.1\n\n叙事弦 甲\n  类型 数值 0..100\n  基线 20\n`;

describe('Host 快照兼容性检查（v6.19）', () => {
  it('校验 ABI/stateVersion/state 并接受旧快照', () => {
    const compiled = compileText(SOURCE, 'abi.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const engine = createEngine(compiled.ir, { seed: 1 });
    const snapshot = engine.toHostSnapshot();
    expect(isHostSnapshotCompatible(snapshot)).toEqual({ ok: true });
    expect(isHostSnapshotCompatible({ ...snapshot, abi: 'neurou-host/2' }).ok).toBe(false);
    expect(isHostSnapshotCompatible({ ...snapshot, stateVersion: 2 }).ok).toBe(false);
    const legacy = { ...snapshot } as Record<string, unknown>;
    delete legacy.stateVersion;
    expect(isHostSnapshotCompatible(legacy).ok).toBe(true);
    expect(isHostSnapshotCompatible(null).ok).toBe(false);
    expect(snapshot.abi).toBe(HOST_ABI);
  });
});
