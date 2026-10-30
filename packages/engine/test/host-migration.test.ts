import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { createEngine, migrateHostSnapshot } from '../src/index.js';

const SOURCE = `世界 迁移\n  版本 0.1\n\n叙事弦 甲\n  类型 数值 0..100\n  基线 20\n`;

describe('Host 快照迁移器（v6.21）', () => {
  it('当前快照/缺失 stateVersion/v0 快照可迁移', () => {
    const compiled = compileText(SOURCE, 'migrate.nro');
    if (!compiled.ok) throw new Error('compile failed');
    const engine = createEngine(compiled.ir, { seed: 1 });
    const current = engine.toHostSnapshot();
    const migrated = migrateHostSnapshot(current);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.snapshot.stateVersion).toBe(1);

    const legacy = { ...current } as Record<string, unknown>;
    delete legacy.stateVersion;
    const missing = migrateHostSnapshot(legacy);
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.notes.length).toBeGreaterThan(0);

    const v0 = { ...legacy, abi: 'neurou-host/0' };
    const promoted = migrateHostSnapshot(v0);
    expect(promoted.ok).toBe(true);
    if (promoted.ok) expect(promoted.snapshot.abi).toBe('neurou-host/1');
  });

  it('未知 ABI/版本拒绝', () => {
    expect(migrateHostSnapshot(null).ok).toBe(false);
    expect(migrateHostSnapshot({ abi: 'neurou-host/2', stateVersion: 1, state: {} }).ok).toBe(false);
    expect(migrateHostSnapshot({ abi: 'neurou-host/1', stateVersion: 2, state: {} }).ok).toBe(false);
  });
});
