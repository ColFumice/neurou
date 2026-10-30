import { describe, expect, it } from 'vitest';
import { createExternalHost } from '../../../examples/external-host/sdk.js';

const SOURCE = `世界 SDK\n  版本 0.1\n\n叙事弦 信任\n  类型 数值 0..100\n  基线 30\n`;

describe('外部 Host SDK 示例（v6.20）', () => {
  it('驱动/快照/恢复/非法快照拒绝', () => {
    const host = createExternalHost(SOURCE, 'sdk.nro', { seed: 2 });
    expect(host.description.name).toBe('SDK');
    expect(host.description.strings).toBe(1);
    host.inject('信任', 70);
    host.step();
    const frame = host.observe();
    expect(frame.tick).toBeGreaterThan(0);
    expect(frame.values['信任']).toBe(70);
    const snapshot = host.snapshot();
    const other = createExternalHost(SOURCE, 'sdk.nro', { seed: 9 });
    expect(other.restore(JSON.stringify(snapshot))).toBe(true);
    expect(other.snapshot().values['信任']).toBe(70);
    expect(other.restore({ ...snapshot, abi: 'neurou-host/2' } as typeof snapshot)).toBe(false);
    expect(JSON.parse(host.exportJSON()).abi).toBe('neurou-host/1');
  });
});
